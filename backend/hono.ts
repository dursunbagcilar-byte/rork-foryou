import { trpcServer } from "@hono/trpc-server";
import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";

import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";
import { db, initializeStore, bootstrapDbConfig, reinitializeStore, forceReloadStore, getPersistentStoreStatus } from "./db/store";
import { setDbConfig, isDbConfigured, getCachedDbConfig } from "./db/rork-db";
import type { User, Driver, Business, BusinessMenuItem, Session } from "./db/types";
import { checkRateLimit, getClientIP, isIPBlocked, trackSuspiciousActivity, sanitizeInput } from "./utils/security";
import { getTurkishPhoneValidationError, normalizeTurkishPhone } from "../utils/phone";
import {
  SUPPORT_WHATSAPP_DISPLAY,
  SUPPORT_WHATSAPP_NUMBER,
  buildPasswordResetSupportWhatsAppUrl,
  getWhatsAppDeliveryNote,
  getWhatsAppSupportDeliveryNote,
  normalizePhoneForWhatsApp,
} from "../constants/support";
import { getWhatsAppResetFallbackMessage, sendPasswordResetWhatsAppCode } from "./utils/whatsapp";

const app = new Hono();

console.log("[SERVER] Hono v67 started - improved DB config detection + snapshot persistence");

let _dbReady = false;
let _dbInitPromise: Promise<void> | null = null;

function maskPhoneNumber(phone: string | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 4) return digits;

  const prefixLength = Math.min(2, digits.length - 2);
  const prefix = digits.slice(0, prefixLength);
  const suffix = digits.slice(-2);
  const hiddenLength = Math.max(digits.length - (prefix.length + suffix.length), 2);
  return `${prefix}${'•'.repeat(hiddenLength)}${suffix}`;
}

function buildPasswordResetWhatsAppUrl(identifier: string, maskedPhone: string | null, reason?: string): string {
  return buildPasswordResetSupportWhatsAppUrl(identifier, maskedPhone, reason);
}

function getEmailSendErrorMessage(errorCode: string | null | undefined): string {
  if (errorCode === 'missing_from_email' || errorCode === 'invalid_from_email') {
    return 'E-posta servisi henüz tamamlanmadı. Lütfen daha sonra tekrar deneyin.';
  }

  if (errorCode === 'missing_api_key') {
    return 'E-posta servisi geçici olarak kullanılamıyor. Lütfen daha sonra tekrar deneyin.';
  }

  return 'E-posta gönderilemedi. Lütfen e-posta adresinizi kontrol edin veya daha sonra tekrar deneyin.';
}

function isEmailIdentifier(value: string): boolean {
  return value.includes('@');
}

function normalizePhoneForLookup(phone: string | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return normalizePhoneForWhatsApp(phone) ?? digits;
}

function normalizePhoneForComparison(phone: string | undefined): string {
  return normalizeTurkishPhone(phone);
}

function isPhoneTakenByAnotherAccount(phone: string, excludedId?: string): boolean {
  const normalizedPhone = normalizePhoneForComparison(phone);
  return [...db.users.getAll(), ...db.drivers.getAll()].some((item) => {
    return item.id !== excludedId && normalizePhoneForComparison(item.phone) === normalizedPhone;
  });
}

function findStoredAccountByPhone(phone: string): { account: User | Driver | null; emailKey: string | null } {
  const normalizedPhone = normalizePhoneForLookup(phone);
  if (!normalizedPhone) {
    return { account: null, emailKey: null };
  }

  const exactUser = db.users.getByPhone(phone);
  if (exactUser?.email) {
    return { account: exactUser, emailKey: exactUser.email.toLowerCase().trim() };
  }

  const exactDriver = db.drivers.getByPhone(phone);
  if (exactDriver?.email) {
    return { account: exactDriver, emailKey: exactDriver.email.toLowerCase().trim() };
  }

  const storedAccount = [...db.users.getAll(), ...db.drivers.getAll()].find((item) => {
    const storedPhone = typeof item.phone === 'string' ? item.phone : undefined;
    return normalizePhoneForLookup(storedPhone) === normalizedPhone;
  }) ?? null;

  const emailKey = typeof storedAccount?.email === 'string'
    ? storedAccount.email.toLowerCase().trim()
    : null;

  return { account: storedAccount, emailKey };
}

function resolveResetAccount(identifier: string): {
  account: User | Driver | null;
  emailKey: string | null;
  identifierType: 'email' | 'phone';
  normalizedIdentifier: string;
} {
  const trimmedIdentifier = identifier.trim();
  if (isEmailIdentifier(trimmedIdentifier)) {
    const cleanEmail = trimmedIdentifier.toLowerCase().trim();
    return {
      account: db.users.getByEmail(cleanEmail) || db.drivers.getByEmail(cleanEmail) || null,
      emailKey: cleanEmail,
      identifierType: 'email',
      normalizedIdentifier: cleanEmail,
    };
  }

  const phoneResult = findStoredAccountByPhone(trimmedIdentifier);
  return {
    ...phoneResult,
    identifierType: 'phone',
    normalizedIdentifier: normalizePhoneForLookup(trimmedIdentifier) ?? trimmedIdentifier,
  };
}

function buildResetLookupKey(identifier: string): string {
  const resolved = resolveResetAccount(identifier);
  return `resetcode_${resolved.normalizedIdentifier}`;
}

function normalizeBusinessWebsite(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function buildDefaultBusinessMenu(name: string, image: string, category: string): BusinessMenuItem[] {
  const categoryLabel = category || 'İşletme';
  return [
    {
      id: `menu_${Date.now()}_standard`,
      name: `${categoryLabel} Standart Teslimat`,
      description: `${name} için standart kurye teslimat siparişi`,
      price: 120,
      image,
    },
    {
      id: `menu_${Date.now()}_express`,
      name: `${categoryLabel} Express Teslimat`,
      description: `${name} için öncelikli ve hızlı teslimat seçeneği`,
      price: 180,
      image,
    },
    {
      id: `menu_${Date.now()}_bulk`,
      name: `${categoryLabel} Toplu Sipariş`,
      description: `${name} için çoklu paket veya büyük sepet teslimatı`,
      price: 240,
      image,
    },
  ];
}

initializeStore()
  .then(() => {
    _dbReady = isDbConfigured();
    console.log('[SERVER] Initial store ready, dbConfigured:', _dbReady);
  })
  .catch(e => console.log('[SERVER] Initial store err:', e));

function isValidDbUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function ensureDbReady(dbEp?: string, dbNs?: string, dbTk?: string): Promise<boolean> {
  if (dbEp && dbNs && dbTk) {
    if (!isValidDbUrl(dbEp)) {
      console.log('[SERVER] Invalid DB endpoint URL, skipping DB init:', dbEp);
      return _dbReady;
    }
    const wasConfigured = isDbConfigured();
    setDbConfig(dbEp, dbNs, dbTk);

    if (!_dbReady) {
      if (_dbInitPromise) {
        await _dbInitPromise;
        if (_dbReady) return true;
      }

      const initStart = Date.now();
      _dbInitPromise = (async () => {
        try {
          setDbConfig(dbEp, dbNs, dbTk);
          await reinitializeStore();
          _dbReady = true;
          console.log('[SERVER] DB ready from headers in', Date.now() - initStart, 'ms, users:', db.users.getAll().length, 'drivers:', db.drivers.getAll().length);
        } catch (e) {
          console.log('[SERVER] DB init error:', e, 'elapsed:', Date.now() - initStart, 'ms');
          setDbConfig(dbEp, dbNs, dbTk);
          try {
            await bootstrapDbConfig(dbEp, dbNs, dbTk);
            _dbReady = isDbConfigured();
            if (_dbReady) {
              console.log('[SERVER] DB recovered via bootstrap fallback in', Date.now() - initStart, 'ms');
            }
          } catch (e2) {
            console.log('[SERVER] DB bootstrap fallback also failed:', e2);
          }
        }
      })();
      await _dbInitPromise;
      _dbInitPromise = null;
    } else if (!wasConfigured) {
      setDbConfig(dbEp, dbNs, dbTk);
    }
  }
  return _dbReady;
}

function getCurrentStorageMode(): 'database' | 'snapshot' | 'memory' {
  const persistentStore = getPersistentStoreStatus();
  if (_dbReady || isDbConfigured()) {
    return 'database';
  }
  return persistentStore.available ? 'snapshot' : 'memory';
}

async function resolveValidSession(sessionToken: string): Promise<Session | null> {
  let session = db.sessions.get(sessionToken);

  if (!session) {
    console.log('[SERVER] Session not found in memory, attempting reload for token');
    try {
      await initializeStore();
      await forceReloadStore();
      session = db.sessions.get(sessionToken);
      console.log('[SERVER] Session reload result:', !!session);
    } catch (error) {
      console.log('[SERVER] Session reload error:', error);
    }
  }

  if (!session) {
    return null;
  }

  const isExpired = new Date(session.expiresAt).getTime() < Date.now();
  if (isExpired) {
    db.sessions.delete(sessionToken);
    console.log('[SERVER] Session expired during lookup for:', session.userId);
    return null;
  }

  return session;
}

app.use("*", cors({
  origin: (origin) => origin || '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'x-db-endpoint', 'x-db-namespace', 'x-db-token'],
  maxAge: 86400,
}));

app.use("*", async (c, next) => {
  const ip = getClientIP(c.req.raw);
  if (isIPBlocked(ip)) return c.json({ error: "Blocked" }, 403);
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    c.header('Retry-After', retryAfter.toString());
    return c.json({ error: "Rate limited", retryAfter }, 429);
  }
  trackSuspiciousActivity(ip);
  await next();
});

function readServerEnv(key: string): string {
  try {
    const d = (globalThis as any).Deno;
    if (d?.env?.get) {
      const val = d.env.get(key);
      if (val) return val;
    }
  } catch {}
  try {
    if (typeof process !== 'undefined' && process.env) {
      const val = (process.env as Record<string, string | undefined>)[key];
      if (val) return val;
    }
  } catch {}
  return '';
}

function resolveDbHeaders(c: Context): { ep: string; ns: string; tk: string } {
  let ep = c.req.header('x-db-endpoint') || '';
  let ns = c.req.header('x-db-namespace') || '';
  let tk = c.req.header('x-db-token') || '';

  if (!ep) ep = readServerEnv('EXPO_PUBLIC_RORK_DB_ENDPOINT') || readServerEnv('RORK_DB_ENDPOINT');
  if (!ns) ns = readServerEnv('EXPO_PUBLIC_RORK_DB_NAMESPACE') || readServerEnv('RORK_DB_NAMESPACE');
  if (!tk) tk = readServerEnv('EXPO_PUBLIC_RORK_DB_TOKEN') || readServerEnv('RORK_DB_TOKEN');

  if (!ep || !ns || !tk) {
    const cached = getCachedDbConfig();
    if (cached) {
      if (!ep && cached.endpoint) ep = cached.endpoint;
      if (!ns && cached.namespace) ns = cached.namespace;
      if (!tk && cached.token) tk = cached.token;
      console.log('[SERVER] resolveDbHeaders: recovered from cached config, ep:', !!ep, 'ns:', !!ns, 'tk:', !!tk);
    }
  }

  return { ep, ns, tk };
}

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveBootstrapDbConfig(c: Context, body: unknown): { ep: string; ns: string; tk: string } {
  const headerConfig = resolveDbHeaders(c);
  const bodyRecord = typeof body === 'object' && body !== null
    ? body as Record<string, unknown>
    : null;

  const ep = normalizeOptionalString(bodyRecord?.endpoint) || headerConfig.ep;
  const ns = normalizeOptionalString(bodyRecord?.namespace) || headerConfig.ns;
  const tk = normalizeOptionalString(bodyRecord?.token) || headerConfig.tk;

  return { ep, ns, tk };
}

app.use("*", async (c, next) => {
  const { ep, ns, tk } = resolveDbHeaders(c);
  if (ep && ns && tk) {
    await ensureDbReady(ep, ns, tk);
  }
  await next();
});

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`[API] ${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`);
});

app.get("/", (c) => {
  const storageMode = getCurrentStorageMode();
  const persistentStore = getPersistentStoreStatus();
  return c.json({
    status: "ok",
    version: "67",
    dbConfigured: isDbConfigured(),
    dbReady: storageMode !== 'memory',
    storageMode,
    persistentStoreAvailable: persistentStore.available,
    persistentStoreLastSavedAt: persistentStore.lastSavedAt,
  });
});
app.get("/health", async (c) => {
  const { ep, ns, tk } = resolveDbHeaders(c);
  console.log('[SERVER] Health check - ep:', ep ? ep.substring(0, 30) + '...' : 'MISSING', 'ns:', ns ? 'YES' : 'MISSING', 'tk:', tk ? 'YES' : 'MISSING');

  if (ep && ns && tk) {
    try {
      await ensureDbReady(ep, ns, tk);
    } catch (e) {
      console.log('[SERVER] Health: ensureDbReady error:', e);
    }
    if (!_dbReady && !isDbConfigured()) {
      try {
        const bootstrapResult = await bootstrapDbConfig(ep, ns, tk);
        if (bootstrapResult) {
          _dbReady = true;
          console.log('[SERVER] Health: DB bootstrapped');
        }
      } catch (e) {
        console.log('[SERVER] Health: bootstrap fallback failed:', e);
      }
    }
    if (!_dbReady) {
      setDbConfig(ep, ns, tk);
      _dbReady = isDbConfigured();
      console.log('[SERVER] Health: forced dbReady after setDbConfig:', _dbReady);
    }
  } else {
    console.log('[SERVER] Health: DB config incomplete - endpoint:', !!ep, 'namespace:', !!ns, 'token:', !!tk);
  }

  const configured = isDbConfigured();
  const persistentStore = getPersistentStoreStatus();
  const storageMode = getCurrentStorageMode();
  const ready = storageMode !== 'memory';
  console.log('[SERVER] Health response: configured:', configured, 'ready:', ready, 'storageMode:', storageMode, 'snapshotAvailable:', persistentStore.available, 'users:', db.users.getAll().length, 'drivers:', db.drivers.getAll().length);
  return c.json({
    status: "ok",
    version: "67",
    dbConfigured: configured,
    dbReady: ready,
    storageMode,
    persistentStoreAvailable: persistentStore.available,
    persistentStoreLastSavedAt: persistentStore.lastSavedAt,
    dbMissing: (!ep || !ns || !tk) ? { endpoint: !ep, namespace: !ns, token: !tk } : undefined,
    drivers: db.drivers.getAll().length,
    users: db.users.getAll().length,
  });
});

app.post("/auth/register-customer", async (c) => {
  const startTime = Date.now();
  try {
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await ensureDbReady(dbEp, dbNs, dbTk);

    const body = await c.req.json();
    console.log('[REST] register-customer start:', body.email, 'dbReady:', _dbReady, 'dbConfigured:', isDbConfigured());
    const { sanitizeInput, validateEmail, validatePassword, hashPassword, generateSecureToken } = await import('./utils/security');

    const cleanName = sanitizeInput(body.name || '');
    const cleanPhone = sanitizeInput(body.phone || '');
    const cleanEmail = (body.email || '').toLowerCase().trim();

    if (!cleanName || !cleanPhone || !cleanEmail || !body.password || !body.gender || !body.city || !body.district) {
      return c.json({ success: false, error: 'Tüm alanlar zorunludur', user: null, token: null });
    }
    if (!validateEmail(cleanEmail)) return c.json({ success: false, error: 'Geçersiz e-posta adresi', user: null, token: null });
    const pwdCheck = validatePassword(body.password);
    if (!pwdCheck.valid) return c.json({ success: false, error: pwdCheck.reason, user: null, token: null });

    const existingUser = db.users.getByEmail(cleanEmail);
    const existingDriver = db.drivers.getByEmail(cleanEmail);
    if (existingUser || existingDriver) return c.json({ success: false, error: 'Bu e-posta zaten kayıtlı', user: null, token: null });

    const id = 'c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let myCode = 'FY';
    for (let i = 0; i < 5; i++) myCode += chars.charAt(Math.floor(Math.random() * chars.length));

    let referrerUserId: string | undefined;
    if (body.referralCode) {
      referrerUserId = db.referralCodeIndex.get(body.referralCode.toUpperCase().trim());
    }
    const freeRides = referrerUserId ? 2 : 0;

    const user = {
      id, name: cleanName, phone: cleanPhone, email: cleanEmail,
      type: 'customer' as const, gender: body.gender,
      city: sanitizeInput(body.city), district: sanitizeInput(body.district),
      referralCode: myCode, referredBy: referrerUserId, freeRidesRemaining: freeRides,
      createdAt: new Date().toISOString(),
    };

    await db.users.setSync(id, user);
    db.referralCodeIndex.set(myCode, id);

    if (referrerUserId) {
      const referrer = db.users.get(referrerUserId);
      if (referrer) await db.users.setSync(referrerUserId, { ...referrer, freeRidesRemaining: (referrer.freeRidesRemaining || 0) + 2 });
      const refId = 'ref_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      db.referrals.set(refId, { id: refId, referrerUserId, referredUserId: id, referredName: cleanName, freeRidesAwarded: 2, createdAt: new Date().toISOString() });
    }

    let hashedPwd: string;
    try {
      hashedPwd = await hashPassword(body.password);
    } catch (hashErr) {
      console.log('[REST] hashPassword error, using fallback:', hashErr);
      let hash = 0;
      for (let i = 0; i < body.password.length; i++) {
        const char = body.password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      hashedPwd = 'h_' + Math.abs(hash).toString(36);
    }
    await db.passwords.setSync(cleanEmail, hashedPwd);

    const sessionToken = generateSecureToken(64);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.sessions.setSync(sessionToken, { token: sessionToken, userId: id, userType: 'customer', createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() });

    if (isDbConfigured()) {
      try {
        const { flushPendingOps, getPendingOpsCount } = await import('./db/rork-db');
        const pending = getPendingOpsCount();
        if (pending > 0) {
          console.log('[REST] Flushing', pending, 'pending ops after customer register');
          await flushPendingOps();
        }
      } catch (flushErr) {
        console.log('[REST] Post-register flush error (non-critical):', flushErr);
      }
    }

    console.log('[REST] Customer registered:', id, 'in', Date.now() - startTime, 'ms, dbConfigured:', isDbConfigured(), 'dbReady:', _dbReady);
    return c.json({ success: true, error: null, user, token: sessionToken });
  } catch (err: any) {
    console.log('[REST] register-customer error:', err?.message, 'elapsed:', Date.now() - startTime, 'ms');
    const msg = err?.message || '';
    if (msg.includes('zaten') || msg.includes('Geçersiz') || msg.includes('Şifre')) return c.json({ success: false, error: msg, user: null, token: null });
    return c.json({ success: false, error: 'Kayıt hatası oluştu. Lütfen tekrar deneyin.', user: null, token: null }, 500);
  }
});

app.post("/auth/register-driver", async (c) => {
  const startTime = Date.now();
  try {
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await ensureDbReady(dbEp, dbNs, dbTk);

    const body = await c.req.json();
    console.log('[REST] register-driver start:', body.email, 'dbReady:', _dbReady, 'dbConfigured:', isDbConfigured());
    const { sanitizeInput, validateEmail, validatePassword, hashPassword, generateSecureToken } = await import('./utils/security');

    const cleanName = sanitizeInput(body.name || '');
    const cleanEmail = (body.email || '').toLowerCase().trim();

    if (!cleanName || !cleanEmail || !body.password || !body.vehicleModel || !body.vehicleColor || !body.city || !body.district) {
      return c.json({ success: false, error: 'Tüm alanlar zorunludur', driver: null, token: null });
    }
    if (!validateEmail(cleanEmail)) return c.json({ success: false, error: 'Geçersiz e-posta adresi', driver: null, token: null });
    const pwdCheck = validatePassword(body.password);
    if (!pwdCheck.valid) return c.json({ success: false, error: pwdCheck.reason, driver: null, token: null });

    const existingDriver = db.drivers.getByEmail(cleanEmail);
    const existingUser = db.users.getByEmail(cleanEmail);
    if (existingDriver || existingUser) return c.json({ success: false, error: 'Bu e-posta zaten kayıtlı', driver: null, token: null });

    const id = 'd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const driver = {
      id, name: cleanName, phone: sanitizeInput(body.phone || ''), email: cleanEmail,
      type: 'driver' as const, driverCategory: body.driverCategory || 'driver',
      vehiclePlate: body.vehiclePlate ? sanitizeInput(body.vehiclePlate).toUpperCase() : '',
      vehicleModel: sanitizeInput(body.vehicleModel), vehicleColor: sanitizeInput(body.vehicleColor),
      rating: 5.0, totalRides: 0, isOnline: false, isApproved: true,
      approvedAt: new Date().toISOString(), licenseIssueDate: body.licenseIssueDate,
      partnerDriverName: body.partnerDriverName ? sanitizeInput(body.partnerDriverName) : undefined,
      dailyEarnings: 0, weeklyEarnings: 0, monthlyEarnings: 0,
      city: sanitizeInput(body.city), district: sanitizeInput(body.district),
      createdAt: new Date().toISOString(),
    };

    await db.drivers.setSync(id, driver);

    let hashedPwd: string;
    try {
      hashedPwd = await hashPassword(body.password);
    } catch (hashErr) {
      console.log('[REST] hashPassword error for driver, using fallback:', hashErr);
      let hash = 0;
      for (let i = 0; i < body.password.length; i++) {
        const char = body.password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      hashedPwd = 'h_' + Math.abs(hash).toString(36);
    }
    await db.passwords.setSync(cleanEmail, hashedPwd);

    const sessionToken = generateSecureToken(64);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.sessions.setSync(sessionToken, { token: sessionToken, userId: id, userType: 'driver', createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() });

    if (isDbConfigured()) {
      try {
        const { flushPendingOps, getPendingOpsCount } = await import('./db/rork-db');
        const pending = getPendingOpsCount();
        if (pending > 0) {
          console.log('[REST] Flushing', pending, 'pending ops after driver register');
          await flushPendingOps();
        }
      } catch (flushErr) {
        console.log('[REST] Post-register flush error (non-critical):', flushErr);
      }
    }

    console.log('[REST] Driver registered:', id, 'in', Date.now() - startTime, 'ms, dbConfigured:', isDbConfigured(), 'dbReady:', _dbReady);
    return c.json({ success: true, error: null, driver, token: sessionToken });
  } catch (err: any) {
    console.log('[REST] register-driver error:', err?.message, 'elapsed:', Date.now() - startTime, 'ms');
    const msg = err?.message || '';
    if (msg.includes('zaten') || msg.includes('Geçersiz') || msg.includes('Şifre')) return c.json({ success: false, error: msg, driver: null, token: null });
    return c.json({ success: false, error: 'Kayıt hatası oluştu. Lütfen tekrar deneyin.', driver: null, token: null }, 500);
  }
});

app.post("/auth/login", async (c) => {
  try {
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await ensureDbReady(dbEp, dbNs, dbTk);

    const body = await c.req.json();
    console.log('[REST] login:', body.email, 'type:', body.type, 'dbReady:', _dbReady, 'users:', db.users.getAll().length, 'drivers:', db.drivers.getAll().length);
    const { verifyPassword, generateSecureToken, checkLoginAttempt, recordLoginFailure, recordLoginSuccess } = await import('./utils/security');

    const cleanEmail = (body.email || '').toLowerCase().trim();
    if (!cleanEmail || !body.password) return c.json({ success: false, error: 'E-posta ve şifre gerekli', user: null, token: null });

    const loginCheck = checkLoginAttempt(cleanEmail);
    if (!loginCheck.allowed) {
      const mins = Math.ceil((loginCheck.lockedUntil - Date.now()) / 60000);
      return c.json({ success: false, error: `Çok fazla başarısız giriş. ${mins} dk sonra deneyin.`, user: null, token: null });
    }

    let storedHash = db.passwords.get(cleanEmail);
    let user = db.users.getByEmail(cleanEmail);
    let driver = db.drivers.getByEmail(cleanEmail);

    if (!storedHash || (!user && !driver)) {
      try {
        const { initializeStore } = await import('./db/store');
        await initializeStore();
        storedHash = db.passwords.get(cleanEmail);
        user = db.users.getByEmail(cleanEmail);
        driver = db.drivers.getByEmail(cleanEmail);
      } catch (e) { console.log('[REST] init err:', e); }
    }

    if (!storedHash || (!user && !driver)) {
      try {
        const { dbSearchPasswordByEmail, dbFindByEmail } = await import('./db/rork-db');
        if (!storedHash) {
          const r = await dbSearchPasswordByEmail(cleanEmail);
          if (r?.hash) { storedHash = r.hash; db.passwords.set(cleanEmail, r.hash); }
        }
        if (!user && !driver) {
          const dbU = await dbFindByEmail<any>('users', cleanEmail);
          if (dbU) { const uid = dbU.rorkId || dbU._originalId || dbU.id; if (uid) { dbU.id = uid; user = dbU; db.users.set(uid, dbU); } }
          if (!user) {
            const dbD = await dbFindByEmail<any>('drivers', cleanEmail);
            if (dbD) { const did = dbD.rorkId || dbD._originalId || dbD.id; if (did) { dbD.id = did; driver = dbD; db.drivers.set(did, dbD); } }
          }
        }
      } catch (e) { console.log('[REST] db lookup err:', e); }
    }

    if (!storedHash) {
      recordLoginFailure(cleanEmail);
      return c.json({ success: false, error: "Kullanıcı bulunamadı. 'Şifremi Unuttum' ile yeni şifre oluşturun.", user: null, token: null });
    }

    const match = await verifyPassword(body.password, storedHash);
    if (!match) {
      recordLoginFailure(cleanEmail);
      const uc = checkLoginAttempt(cleanEmail);
      return c.json({ success: false, error: uc.remainingAttempts <= 2 && uc.remainingAttempts > 0 ? `Şifre hatalı. ${uc.remainingAttempts} deneme kaldı.` : 'Şifre hatalı', user: null, token: null });
    }

    recordLoginSuccess(cleanEmail);
    const account = (body.type === 'driver' && driver) ? driver : (user || driver);
    const accountType = (account === driver) ? 'driver' : 'customer';
    if (!account) return c.json({ success: false, error: 'Hesap bulunamadı', user: null, token: null });
    if (accountType === 'driver' && (account as any).isSuspended) return c.json({ success: false, error: 'Hesabınız askıya alınmış', user: null, token: null });

    const sessionToken = generateSecureToken(64);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.sessions.setSync(sessionToken, { token: sessionToken, userId: account.id, userType: accountType, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() });

    console.log('[REST] Login OK:', account.id, accountType, 'dbConfigured:', isDbConfigured(), 'dbReady:', _dbReady);
    return c.json({ success: true, error: null, user: { ...account, type: accountType }, token: sessionToken });
  } catch (err: any) {
    console.log('[REST] login error:', err?.message);
    return c.json({ success: false, error: 'Giriş hatası. Tekrar deneyin.', user: null, token: null }, 500);
  }
});

app.post("/auth/send-reset-code", async (c) => {
  try {
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await ensureDbReady(dbEp, dbNs, dbTk);

    const body = await c.req.json();
    const rawIdentifier = typeof body.contact === 'string' && body.contact.trim()
      ? body.contact
      : typeof body.phone === 'string' && body.phone.trim()
        ? body.phone
        : body.email;
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
    const deliveryMethod = body.deliveryMethod === 'email' ? 'email' : 'whatsapp';
    if (!identifier) return c.json({ success: false, error: 'E-posta veya telefon numarası gerekli' });

    console.log('[REST] send-reset-code:', identifier, 'deliveryMethod:', deliveryMethod);
    const { checkLoginAttempt, recordLoginFailure, recordLoginSuccess } = await import('./utils/security');
    const { sendEmail, generateResetCode, buildResetCodeEmail } = await import('./utils/email');

    const resetLookupKey = buildResetLookupKey(identifier);
    const loginCheck = checkLoginAttempt(resetLookupKey);
    if (!loginCheck.allowed) {
      return c.json({ success: false, error: 'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.' });
    }

    let resolvedAccount = resolveResetAccount(identifier);
    let account = resolvedAccount.account;
    let accountEmail = resolvedAccount.emailKey;
    let hasPassword = accountEmail ? db.passwords.get(accountEmail) : null;

    if (!account || !hasPassword) {
      try {
        await initializeStore();
        resolvedAccount = resolveResetAccount(identifier);
        account = resolvedAccount.account;
        accountEmail = resolvedAccount.emailKey;
        hasPassword = accountEmail ? db.passwords.get(accountEmail) : null;
      } catch (e) {
        console.log('[REST] send-reset-code init err:', e);
      }
    }

    if ((!account || !hasPassword) && resolvedAccount.identifierType === 'email' && accountEmail) {
      try {
        const { dbFindByEmail, dbSearchPasswordByEmail } = await import('./db/rork-db');
        if (!account) {
          const dbUser = await dbFindByEmail<Record<string, unknown>>('users', accountEmail);
          if (dbUser) {
            const userId = dbUser.rorkId || dbUser._originalId || dbUser.id;
            if (typeof userId === 'string') {
              const hydratedUser = { ...dbUser, id: userId } as User;
              account = hydratedUser;
              accountEmail = hydratedUser.email.toLowerCase().trim();
              db.users.set(userId, hydratedUser);
            }
          }
        }
        if (!account) {
          const dbDriver = await dbFindByEmail<Record<string, unknown>>('drivers', accountEmail);
          if (dbDriver) {
            const driverId = dbDriver.rorkId || dbDriver._originalId || dbDriver.id;
            if (typeof driverId === 'string') {
              const hydratedDriver = { ...dbDriver, id: driverId } as Driver;
              account = hydratedDriver;
              accountEmail = hydratedDriver.email.toLowerCase().trim();
              db.drivers.set(driverId, hydratedDriver);
            }
          }
        }
        if (!hasPassword && accountEmail) {
          const passwordResult = await dbSearchPasswordByEmail(accountEmail);
          if (passwordResult?.hash) {
            hasPassword = passwordResult.hash;
            db.passwords.set(accountEmail, passwordResult.hash);
          }
        }
      } catch (e) {
        console.log('[REST] send-reset-code db lookup err:', e);
      }
    }

    if (!account || !accountEmail || !hasPassword) {
      recordLoginFailure(resetLookupKey);
      return c.json({
        success: false,
        error: resolvedAccount.identifierType === 'phone'
          ? 'Bu telefon numarasıyla kayıtlı hesap bulunamadı'
          : 'Bu e-posta adresiyle kayıtlı hesap bulunamadı',
      });
    }

    const accountName = account.name || accountEmail.split('@')[0];
    const code = generateResetCode();
    db.resetCodes.set(accountEmail, code);
    console.log('[REST] send-reset-code stored code for:', accountEmail, 'identifier:', identifier);

    const maskedPhone = maskPhoneNumber(typeof account.phone === 'string' ? account.phone : undefined);
    const whatsappTargetPhone = normalizePhoneForWhatsApp(typeof account.phone === 'string' ? account.phone : undefined);
    const directDeliveryNote = getWhatsAppDeliveryNote(maskedPhone);
    const supportDeliveryNote = getWhatsAppSupportDeliveryNote(maskedPhone);
    const whatsappUrl = buildPasswordResetWhatsAppUrl(accountEmail, maskedPhone, 'Şifre sıfırlama doğrulama kodu talebi');

    if (deliveryMethod === 'whatsapp') {
      if (whatsappTargetPhone) {
        const whatsappResult = await sendPasswordResetWhatsAppCode({
          toPhone: whatsappTargetPhone,
          code,
        });

        if (whatsappResult.success) {
          recordLoginSuccess(resetLookupKey);
          console.log('[REST] Reset code sent via WhatsApp:', accountEmail, 'maskedPhone:', maskedPhone, 'messageId:', whatsappResult.messageId);
          return c.json({
            success: true,
            error: null,
            emailSent: false,
            deliveryChannel: 'whatsapp',
            whatsappDeliveryMode: 'auto',
            supportPhone: SUPPORT_WHATSAPP_NUMBER,
            supportPhoneDisplay: SUPPORT_WHATSAPP_DISPLAY,
            whatsappUrl,
            maskedPhone,
            whatsappTargetPhone,
            deliveryNote: directDeliveryNote,
          });
        }

        recordLoginSuccess(resetLookupKey);
        console.log('[REST] WhatsApp reset delivery failed, falling back to support:', accountEmail, whatsappResult.errorCode, whatsappResult.providerMessage);
        return c.json({
          success: true,
          error: getWhatsAppResetFallbackMessage(whatsappResult),
          emailSent: false,
          deliveryChannel: 'whatsapp',
          whatsappDeliveryMode: 'support',
          supportPhone: SUPPORT_WHATSAPP_NUMBER,
          supportPhoneDisplay: SUPPORT_WHATSAPP_DISPLAY,
          whatsappUrl,
          maskedPhone,
          whatsappTargetPhone,
          deliveryNote: supportDeliveryNote,
        });
      }

      recordLoginSuccess(resetLookupKey);
      console.log('[REST] Reset code missing WhatsApp target phone, falling back to support:', accountEmail);
      return c.json({
        success: true,
        error: 'Kayıtlı WhatsApp numarası bulunamadı. Kod talebiniz destek hattına yönlendirildi.',
        emailSent: false,
        deliveryChannel: 'whatsapp',
        whatsappDeliveryMode: 'support',
        supportPhone: SUPPORT_WHATSAPP_NUMBER,
        supportPhoneDisplay: SUPPORT_WHATSAPP_DISPLAY,
        whatsappUrl,
        maskedPhone,
        whatsappTargetPhone,
        deliveryNote: supportDeliveryNote,
      });
    }

    const emailResult = await sendEmail({
      to: accountEmail,
      subject: '2GO - Şifre Sıfırlama Kodu',
      html: buildResetCodeEmail(code, accountName),
    });

    if (!emailResult.success) {
      console.log('[REST] Reset email failed:', emailResult.errorCode, emailResult.providerMessage);
      return c.json({
        success: true,
        error: getEmailSendErrorMessage(emailResult.errorCode),
        emailSent: false,
        deliveryChannel: 'whatsapp',
        whatsappDeliveryMode: 'support',
        supportPhone: SUPPORT_WHATSAPP_NUMBER,
        supportPhoneDisplay: SUPPORT_WHATSAPP_DISPLAY,
        whatsappUrl,
        maskedPhone,
        whatsappTargetPhone,
        deliveryNote: supportDeliveryNote,
      });
    }

    recordLoginSuccess(resetLookupKey);
    console.log('[REST] Reset code sent to:', accountEmail, 'channel: email');
    return c.json({
      success: true,
      error: null,
      emailSent: true,
      deliveryChannel: 'email',
      supportPhone: SUPPORT_WHATSAPP_NUMBER,
      supportPhoneDisplay: SUPPORT_WHATSAPP_DISPLAY,
      maskedPhone,
      whatsappTargetPhone,
      deliveryNote: directDeliveryNote,
    });
  } catch (err: unknown) {
    console.log('[REST] send-reset-code error:', err instanceof Error ? err.message : err);
    return c.json({ success: false, error: 'Bir hata oluştu. Lütfen tekrar deneyin.' }, 500);
  }
});

app.post("/auth/verify-reset-code", async (c) => {
  try {
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await ensureDbReady(dbEp, dbNs, dbTk);

    const body = await c.req.json();
    const rawIdentifier = typeof body.contact === 'string' && body.contact.trim()
      ? body.contact
      : typeof body.phone === 'string' && body.phone.trim()
        ? body.phone
        : body.email;
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
    const inputCode = typeof body.code === 'string' ? body.code.trim() : '';
    if (!identifier || !inputCode) return c.json({ success: false, error: 'E-posta veya telefon numarası ile kod gerekli' });

    let resolvedAccount = resolveResetAccount(identifier);
    let accountEmail = resolvedAccount.emailKey;

    if (!accountEmail && resolvedAccount.identifierType === 'phone') {
      try {
        await initializeStore();
        resolvedAccount = resolveResetAccount(identifier);
        accountEmail = resolvedAccount.emailKey;
      } catch (e) {
        console.log('[REST] verify-reset-code init err:', e);
      }
    }

    if (!accountEmail && isEmailIdentifier(identifier)) {
      accountEmail = identifier.toLowerCase().trim();
    }

    if (!accountEmail) {
      return c.json({ success: false, error: 'Bu telefon numarasıyla kayıtlı hesap bulunamadı' });
    }

    console.log('[REST] verify-reset-code:', accountEmail, 'identifier:', identifier);

    const stored = await db.resetCodes.getAsync(accountEmail);
    if (!stored) {
      return c.json({ success: false, error: 'Doğrulama kodu bulunamadı veya süresi dolmuş. Lütfen yeni kod talep edin.' });
    }

    if (stored.attempts >= 5) {
      db.resetCodes.delete(accountEmail);
      return c.json({ success: false, error: 'Çok fazla hatalı deneme. Yeni kod talep edin.' });
    }

    if (stored.code !== inputCode) {
      await db.resetCodes.incrementAttemptsAsync(accountEmail);
      const remaining = 4 - stored.attempts;
      return c.json({ success: false, error: remaining > 0 ? `Doğrulama kodu hatalı. ${remaining} deneme hakkınız kaldı.` : 'Doğrulama kodu hatalı. Yeni kod talep edin.' });
    }

    console.log('[REST] Reset code verified for:', accountEmail);
    return c.json({ success: true, error: null });
  } catch (err: unknown) {
    console.log('[REST] verify-reset-code error:', err instanceof Error ? err.message : err);
    return c.json({ success: false, error: 'Bir hata oluştu. Lütfen tekrar deneyin.' }, 500);
  }
});

app.post("/auth/reset-password", async (c) => {
  try {
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await ensureDbReady(dbEp, dbNs, dbTk);

    const body = await c.req.json();
    const rawIdentifier = typeof body.contact === 'string' && body.contact.trim()
      ? body.contact
      : typeof body.phone === 'string' && body.phone.trim()
        ? body.phone
        : body.email;
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
    const inputCode = typeof body.code === 'string' ? body.code.trim() : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!identifier || !inputCode || !newPassword) return c.json({ success: false, error: 'Tüm alanlar gerekli' });

    let resolvedAccount = resolveResetAccount(identifier);
    let accountEmail = resolvedAccount.emailKey;

    if (!accountEmail && resolvedAccount.identifierType === 'phone') {
      try {
        await initializeStore();
        resolvedAccount = resolveResetAccount(identifier);
        accountEmail = resolvedAccount.emailKey;
      } catch (e) {
        console.log('[REST] reset-password init err:', e);
      }
    }

    if (!accountEmail && isEmailIdentifier(identifier)) {
      accountEmail = identifier.toLowerCase().trim();
    }

    if (!accountEmail) {
      return c.json({ success: false, error: 'Bu telefon numarasıyla kayıtlı hesap bulunamadı' });
    }

    console.log('[REST] reset-password:', accountEmail, 'identifier:', identifier);
    const { validatePassword, hashPassword } = await import('./utils/security');

    const stored = await db.resetCodes.getAsync(accountEmail);
    if (!stored) {
      return c.json({ success: false, error: 'Doğrulama kodu bulunamadı veya süresi dolmuş. Lütfen yeni kod talep edin.' });
    }

    if (stored.code !== inputCode) {
      return c.json({ success: false, error: 'Doğrulama kodu hatalı' });
    }

    const pwdCheck = validatePassword(newPassword);
    if (!pwdCheck.valid) {
      return c.json({ success: false, error: pwdCheck.reason });
    }

    const hashedPwd = await hashPassword(newPassword);
    await db.passwords.setSync(accountEmail, hashedPwd);
    db.resetCodes.delete(accountEmail);

    console.log('[REST] Password reset OK for:', accountEmail);
    return c.json({ success: true, error: null });
  } catch (err: unknown) {
    console.log('[REST] reset-password error:', err instanceof Error ? err.message : err);
    return c.json({ success: false, error: 'Bir hata oluştu. Lütfen tekrar deneyin.' }, 500);
  }
});

app.post("/auth/register-business", async (c) => {
  const startTime = Date.now();
  try {
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await ensureDbReady(dbEp, dbNs, dbTk);

    const authHeader = c.req.header('authorization') || c.req.header('Authorization') || '';
    const sessionToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!sessionToken) {
      return c.json({ success: false, error: 'Oturum bulunamadı', business: null }, 401);
    }

    const session = db.sessions.get(sessionToken);
    const isExpired = session ? new Date(session.expiresAt).getTime() < Date.now() : true;
    if (!session || isExpired || session.userType !== 'driver') {
      if (session && isExpired) {
        db.sessions.delete(sessionToken);
      }
      return c.json({ success: false, error: 'Geçersiz oturum', business: null }, 401);
    }

    const ownerDriver = db.drivers.get(session.userId);
    if (!ownerDriver) {
      return c.json({ success: false, error: 'Şoför hesabı bulunamadı', business: null }, 404);
    }

    const body = await c.req.json();
    const { sanitizeInput } = await import('./utils/security');
    const safeName = sanitizeInput(body.name || '');
    const safeWebsite = sanitizeInput(body.website || '');
    const safeImage = sanitizeInput(body.image || '');
    const safeCategory = sanitizeInput(body.category || '');
    const safeAddress = sanitizeInput(body.address || '');
    const safeCity = sanitizeInput(body.city || ownerDriver.city || '');
    const safeDistrict = sanitizeInput(body.district || ownerDriver.district || '');
    const safeDescription = sanitizeInput(body.description || '');

    if (!safeName || !safeWebsite || !safeImage || !safeCategory || !safeAddress || !safeCity || !safeDistrict) {
      return c.json({ success: false, error: 'İşletme alanları eksik', business: null }, 400);
    }

    const existingBusiness = db.businesses.getByOwner(session.userId);
    const now = new Date().toISOString();
    const businessId = existingBusiness?.id ?? `biz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const business: Business = {
      id: businessId,
      ownerDriverId: session.userId,
      name: safeName,
      website: normalizeBusinessWebsite(safeWebsite),
      image: safeImage,
      description: safeDescription || `${safeName} işletmesi 2GO üzerinde sipariş kabul ediyor.`,
      category: safeCategory,
      city: safeCity,
      district: safeDistrict,
      address: safeAddress,
      latitude: typeof body.latitude === 'number' ? body.latitude : undefined,
      longitude: typeof body.longitude === 'number' ? body.longitude : undefined,
      phone: sanitizeInput(body.phone || ownerDriver.phone || ''),
      rating: existingBusiness?.rating ?? 4.8,
      reviewCount: existingBusiness?.reviewCount ?? 0,
      deliveryTime: sanitizeInput(body.deliveryTime || existingBusiness?.deliveryTime || '25-35 dk'),
      deliveryFee: typeof body.deliveryFee === 'number' ? body.deliveryFee : (existingBusiness?.deliveryFee ?? 25),
      minOrder: typeof body.minOrder === 'number' ? body.minOrder : (existingBusiness?.minOrder ?? 100),
      menu: existingBusiness?.menu?.length ? existingBusiness.menu : buildDefaultBusinessMenu(safeName, safeImage, safeCategory),
      isActive: true,
      createdAt: existingBusiness?.createdAt ?? now,
      updatedAt: now,
    };

    await db.businesses.setSync(businessId, business);
    console.log('[REST] Business registered:', businessId, safeName, 'owner:', session.userId, 'elapsed:', Date.now() - startTime, 'ms');
    return c.json({ success: true, error: null, business });
  } catch (err: unknown) {
    console.log('[REST] register-business error:', err instanceof Error ? err.message : err, 'elapsed:', Date.now() - startTime, 'ms');
    return c.json({ success: false, error: 'İşletme kaydı oluşturulamadı. Lütfen tekrar deneyin.', business: null }, 500);
  }
});

app.post("/auth/update-phone", async (c) => {
  const startTime = Date.now();
  try {
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await ensureDbReady(dbEp, dbNs, dbTk);

    const authHeader = c.req.header('authorization') || c.req.header('Authorization') || '';
    const sessionToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!sessionToken) {
      return c.json({ success: false, error: 'Oturum bulunamadı', user: null, driver: null }, 401);
    }

    const session = await resolveValidSession(sessionToken);
    if (!session) {
      return c.json({ success: false, error: 'Geçersiz oturum', user: null, driver: null }, 401);
    }

    const body = await c.req.json();
    const requestedUserId = typeof body.userId === 'string' ? body.userId : session.userId;
    if (requestedUserId !== session.userId) {
      return c.json({ success: false, error: 'Bu işlem için yetkiniz yok', user: null, driver: null }, 403);
    }

    const cleanPhone = normalizeTurkishPhone(sanitizeInput(typeof body.phone === 'string' ? body.phone : ''));
    const phoneValidationError = getTurkishPhoneValidationError(cleanPhone);
    if (phoneValidationError) {
      return c.json({ success: false, error: phoneValidationError, user: null, driver: null }, 400);
    }

    if (isPhoneTakenByAnotherAccount(cleanPhone, session.userId)) {
      return c.json({ success: false, error: 'Bu telefon numarası başka bir hesapta kullanılıyor', user: null, driver: null }, 400);
    }

    if (session.userType === 'customer') {
      const existingUser = db.users.get(session.userId);
      if (!existingUser) {
        return c.json({ success: false, error: 'Kullanıcı bulunamadı', user: null, driver: null }, 404);
      }

      const updatedUser: User = {
        ...existingUser,
        phone: cleanPhone,
      };
      await db.users.setSync(session.userId, updatedUser);
      console.log('[REST] Customer phone updated:', session.userId, cleanPhone, 'elapsed:', Date.now() - startTime, 'ms');
      return c.json({ success: true, error: null, user: updatedUser, driver: null });
    }

    const existingDriver = db.drivers.get(session.userId);
    if (!existingDriver) {
      return c.json({ success: false, error: 'Şoför hesabı bulunamadı', user: null, driver: null }, 404);
    }

    const updatedDriver: Driver = {
      ...existingDriver,
      phone: cleanPhone,
    };
    await db.drivers.setSync(session.userId, updatedDriver);

    const ownedBusiness = db.businesses.getByOwner(session.userId);
    if (ownedBusiness) {
      const syncedBusiness: Business = {
        ...ownedBusiness,
        phone: cleanPhone,
        updatedAt: new Date().toISOString(),
      };
      await db.businesses.setSync(ownedBusiness.id, syncedBusiness);
      console.log('[REST] Business phone synced after driver update:', ownedBusiness.id, cleanPhone);
    }

    console.log('[REST] Driver phone updated:', session.userId, cleanPhone, 'elapsed:', Date.now() - startTime, 'ms');
    return c.json({ success: true, error: null, user: null, driver: updatedDriver });
  } catch (err: unknown) {
    console.log('[REST] update-phone error:', err instanceof Error ? err.message : err, 'elapsed:', Date.now() - startTime, 'ms');
    return c.json({ success: false, error: 'Telefon numarası güncellenemedi', user: null, driver: null }, 500);
  }
});

app.post("/drivers/set-online-status", async (c) => {
  const startTime = Date.now();
  try {
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await ensureDbReady(dbEp, dbNs, dbTk);

    const authHeader = c.req.header('authorization') || c.req.header('Authorization') || '';
    const sessionToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!sessionToken) {
      return c.json({ success: false, error: 'Oturum bulunamadı' }, 401);
    }

    const session = db.sessions.get(sessionToken);
    const isExpired = session ? new Date(session.expiresAt).getTime() < Date.now() : true;
    if (!session || isExpired || session.userType !== 'driver') {
      if (session && isExpired) {
        db.sessions.delete(sessionToken);
      }
      return c.json({ success: false, error: 'Geçersiz oturum' }, 401);
    }

    const driver = db.drivers.get(session.userId);
    if (!driver) {
      return c.json({ success: false, error: 'Şoför hesabı bulunamadı' }, 404);
    }

    const body = await c.req.json();
    const requestedDriverId = typeof body.driverId === 'string' ? body.driverId : session.userId;
    if (requestedDriverId !== session.userId) {
      return c.json({ success: false, error: 'Bu işlem için yetkiniz yok' }, 403);
    }

    const isOnline = Boolean(body.isOnline);
    await db.drivers.setSync(session.userId, { ...driver, isOnline });

    if (isOnline && driver.driverCategory === 'courier') {
      try {
        const { tryDispatchWaitingBusinessOrdersForCourier } = await import('./trpc/routes/business-order-dispatch');
        const dispatchedCount = await tryDispatchWaitingBusinessOrdersForCourier(session.userId);
        console.log('[REST] set-online-status business dispatch:', session.userId, dispatchedCount);
      } catch (dispatchError) {
        console.log('[REST] set-online-status dispatch error:', dispatchError);
      }
    }

    console.log('[REST] Driver online status updated:', session.userId, isOnline, 'elapsed:', Date.now() - startTime, 'ms');
    return c.json({ success: true, error: null });
  } catch (err: unknown) {
    console.log('[REST] set-online-status error:', err instanceof Error ? err.message : err, 'elapsed:', Date.now() - startTime, 'ms');
    return c.json({ success: false, error: 'Şoför durumu güncellenemedi' }, 500);
  }
});

app.post("/drivers/update-location", async (c) => {
  const startTime = Date.now();
  try {
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await ensureDbReady(dbEp, dbNs, dbTk);

    const authHeader = c.req.header('authorization') || c.req.header('Authorization') || '';
    const sessionToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!sessionToken) {
      return c.json({ success: false, error: 'Oturum bulunamadı' }, 401);
    }

    const session = db.sessions.get(sessionToken);
    const isExpired = session ? new Date(session.expiresAt).getTime() < Date.now() : true;
    if (!session || isExpired || session.userType !== 'driver') {
      if (session && isExpired) {
        db.sessions.delete(sessionToken);
      }
      return c.json({ success: false, error: 'Geçersiz oturum' }, 401);
    }

    const driver = db.drivers.get(session.userId);
    if (!driver) {
      return c.json({ success: false, error: 'Şoför hesabı bulunamadı' }, 404);
    }

    const body = await c.req.json();
    const requestedDriverId = typeof body.driverId === 'string' ? body.driverId : session.userId;
    if (requestedDriverId !== session.userId) {
      return c.json({ success: false, error: 'Bu işlem için yetkiniz yok' }, 403);
    }

    const latitude = typeof body.latitude === 'number' ? body.latitude : Number.NaN;
    const longitude = typeof body.longitude === 'number' ? body.longitude : Number.NaN;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return c.json({ success: false, error: 'Geçersiz konum bilgisi' }, 400);
    }

    db.driverLocations.set(session.userId, { latitude, longitude });

    if (driver.isOnline && driver.driverCategory === 'courier') {
      try {
        const { tryDispatchWaitingBusinessOrdersForCourier } = await import('./trpc/routes/business-order-dispatch');
        const dispatchedCount = await tryDispatchWaitingBusinessOrdersForCourier(session.userId);
        console.log('[REST] update-location business dispatch:', session.userId, dispatchedCount);
      } catch (dispatchError) {
        console.log('[REST] update-location dispatch error:', dispatchError);
      }
    }

    console.log('[REST] Driver location updated:', session.userId, latitude, longitude, 'elapsed:', Date.now() - startTime, 'ms');
    return c.json({ success: true, error: null });
  } catch (err: unknown) {
    console.log('[REST] update-location error:', err instanceof Error ? err.message : err, 'elapsed:', Date.now() - startTime, 'ms');
    return c.json({ success: false, error: 'Şoför konumu güncellenemedi' }, 500);
  }
});

app.post("/auth/update-phone-direct", async (c) => {
  const startTime = Date.now();
  try {
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await ensureDbReady(dbEp, dbNs, dbTk);

    const body = await c.req.json();
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    const rawPhone = typeof body.phone === 'string' ? body.phone : '';

    if (!userId || !email || !rawPhone) {
      return c.json({ success: false, error: 'Eksik bilgi', user: null, driver: null }, 400);
    }

    const cleanPhone = normalizeTurkishPhone(sanitizeInput(rawPhone));
    const phoneValidationError = getTurkishPhoneValidationError(cleanPhone);
    if (phoneValidationError) {
      return c.json({ success: false, error: phoneValidationError, user: null, driver: null }, 400);
    }

    if (isPhoneTakenByAnotherAccount(cleanPhone, userId)) {
      return c.json({ success: false, error: 'Bu telefon numarası başka bir hesapta kullanılıyor', user: null, driver: null }, 400);
    }

    const existingUser = db.users.get(userId);
    if (existingUser && existingUser.email?.toLowerCase().trim() === email) {
      const updatedUser: User = { ...existingUser, phone: cleanPhone };
      await db.users.setSync(userId, updatedUser);
      console.log('[REST] Direct customer phone updated:', userId, cleanPhone, 'elapsed:', Date.now() - startTime, 'ms');
      return c.json({ success: true, error: null, user: updatedUser, driver: null });
    }

    const existingDriver = db.drivers.get(userId);
    if (existingDriver && existingDriver.email?.toLowerCase().trim() === email) {
      const updatedDriver: Driver = { ...existingDriver, phone: cleanPhone };
      await db.drivers.setSync(userId, updatedDriver);

      const ownedBusiness = db.businesses.getByOwner(userId);
      if (ownedBusiness) {
        await db.businesses.setSync(ownedBusiness.id, { ...ownedBusiness, phone: cleanPhone, updatedAt: new Date().toISOString() });
      }

      console.log('[REST] Direct driver phone updated:', userId, cleanPhone, 'elapsed:', Date.now() - startTime, 'ms');
      return c.json({ success: true, error: null, user: null, driver: updatedDriver });
    }

    console.log('[REST] update-phone-direct: userId/email mismatch:', userId, email);
    return c.json({ success: false, error: 'Hesap bilgileri eşleşmiyor', user: null, driver: null }, 403);
  } catch (err: unknown) {
    console.log('[REST] update-phone-direct error:', err instanceof Error ? err.message : err, 'elapsed:', Date.now() - startTime, 'ms');
    return c.json({ success: false, error: 'Telefon numarası güncellenemedi', user: null, driver: null }, 500);
  }
});

app.post("/auth/logout", async (c) => {
  try {
    const body = await c.req.json();
    if (body.token) {
      db.sessions.delete(body.token);
      console.log('[REST] Session invalidated');
    }
    return c.json({ success: true });
  } catch (err: any) {
    console.log('[REST] logout error:', err?.message);
    return c.json({ success: true });
  }
});

const ensureTrpcRequestReady = async (c: Context, next: Next) => {
  const dbEp = c.req.header('x-db-endpoint');
  const dbNs = c.req.header('x-db-namespace');
  const dbTk = c.req.header('x-db-token');
  await ensureDbReady(dbEp, dbNs, dbTk);
  await next();
};

app.use("/api/trpc/*", ensureTrpcRequestReady);
app.use("/api/trpc/*", trpcServer({ endpoint: "/api/trpc", router: appRouter, createContext }));
app.use("/trpc/*", ensureTrpcRequestReady);
app.use("/trpc/*", trpcServer({ endpoint: "/trpc", router: appRouter, createContext }));

app.post("/iyzico/callback", async (c) => {
  try {
    const body = await c.req.parseBody();
    const token = body.token as string;
    if (token) {
      const payment = db.payments.get(token);
      if (payment?.status === 'pending') {
        try {
          const { retrieveCheckoutFormResult } = await import('./utils/iyzico');
          const result = await retrieveCheckoutFormResult(token, payment.conversationId);
          if (result.status === 'success' && result.paymentStatus === '1') {
            db.payments.set(token, { ...payment, status: 'completed', paymentId: result.paymentId });
            const ride = db.rides.get(payment.rideId);
            if (ride) db.rides.set(payment.rideId, { ...ride, paymentMethod: 'card', paymentStatus: 'paid' });
          } else {
            db.payments.set(token, { ...payment, status: 'failed' });
          }
        } catch (e) { console.log('[IYZICO] err:', e); }
      }
    }
    return c.html(`<html><body><script>window.close();</script><p>Ödeme işleniyor...</p></body></html>`);
  } catch {
    return c.html(`<html><body><p>Ödeme işlendi.</p></body></html>`);
  }
});

app.post("/bootstrap-db", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    const { ep, ns, tk } = resolveBootstrapDbConfig(c, body);

    if (!ep || !ns || !tk) {
      console.log('[SERVER] bootstrap-db skipped - DB config unavailable from body, headers, env, or cache');
      const persistentStore = getPersistentStoreStatus();
      return c.json({
        success: false,
        configured: isDbConfigured(),
        storageMode: getCurrentStorageMode(),
        persistentStoreAvailable: persistentStore.available,
        persistentStoreLastSavedAt: persistentStore.lastSavedAt,
        error: 'Database config unavailable',
        drivers: db.drivers.getAll().length,
        users: db.users.getAll().length,
      }, 200);
    }

    setDbConfig(ep, ns, tk);
    const result = await bootstrapDbConfig(ep, ns, tk);
    if (result || isDbConfigured()) {
      _dbReady = true;
    }
    const persistentStore = getPersistentStoreStatus();
    return c.json({
      success: result || isDbConfigured(),
      configured: result || isDbConfigured(),
      storageMode: getCurrentStorageMode(),
      persistentStoreAvailable: persistentStore.available,
      persistentStoreLastSavedAt: persistentStore.lastSavedAt,
      drivers: db.drivers.getAll().length,
      users: db.users.getAll().length,
    });
  } catch (err) {
    console.log('[SERVER] bootstrap-db error:', err);
    const persistentStore = getPersistentStoreStatus();
    return c.json({
      success: false,
      configured: isDbConfigured(),
      storageMode: getCurrentStorageMode(),
      persistentStoreAvailable: persistentStore.available,
      persistentStoreLastSavedAt: persistentStore.lastSavedAt,
      error: String(err),
    }, 500);
  }
});

app.post("/admin/reset-all-data", async (c) => {
  try {
    console.log('[ADMIN] Reset all data requested');

    const countsBefore = {
      users: db.users.getAll().length,
      drivers: db.drivers.getAll().length,
      rides: db.rides.getAll().length,
      ratings: db.ratings.getAll().length,
      notifications: db.notifications.getAll().length,
      payments: db.payments.getAll().length,
      scheduledRides: db.scheduledRides.getAll().length,
      referrals: db.referrals.getAll().length,
    };

    for (const user of db.users.getAll()) db.users.delete(user.id);
    for (const driver of db.drivers.getAll()) db.drivers.delete(driver.id);
    for (const ride of db.rides.getAll()) {
      try { const { dbDelete: dd } = await import('./db/rork-db'); await dd('rides', ride.id); } catch {}
    }
    for (const rating of db.ratings.getAll()) {
      try { const { dbDelete: dd } = await import('./db/rork-db'); await dd('ratings', rating.id); } catch {}
    }
    for (const notif of db.notifications.getAll()) {
      try { const { dbDelete: dd } = await import('./db/rork-db'); await dd('notifications', notif.id); } catch {}
    }
    for (const payment of db.payments.getAll()) {
      try { const { dbDelete: dd } = await import('./db/rork-db'); await dd('payments', payment.token.replace(/[^a-zA-Z0-9]/g, '_')); } catch {}
    }
    for (const sr of db.scheduledRides.getAll()) {
      try { const { dbDelete: dd } = await import('./db/rork-db'); await dd('scheduled_rides', (sr as any).id || ''); } catch {}
    }
    for (const ref of db.referrals.getAll()) {
      try { const { dbDelete: dd } = await import('./db/rork-db'); await dd('referrals', ref.id); } catch {}
    }

    if (isDbConfigured()) {
      const tables = ['users', 'drivers', 'passwords', 'sessions', 'rides', 'ratings', 'payments', 'ride_messages', 'driver_locations', 'push_tokens', 'notifications', 'driver_documents', 'reset_codes', 'scheduled_rides', 'referrals'];
      for (const table of tables) {
        try {
          const config = (await import('./db/rork-db')).getDbRawConfig();
          const res = await fetch(`${config.endpoint}/sql`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.token}`,
              'surreal-ns': config.namespace,
              'surreal-db': 'main',
              'Accept': 'application/json',
              'Content-Type': 'text/plain',
            },
            body: `DELETE ${table};`,
          });
          console.log(`[ADMIN] DELETE ${table}: ${res.status}`);
        } catch (e) {
          console.log(`[ADMIN] DELETE ${table} error:`, e);
        }
      }
    }

    console.log('[ADMIN] All data reset complete:', JSON.stringify(countsBefore));
    return c.json({ success: true, deleted: countsBefore });
  } catch (err: any) {
    console.log('[ADMIN] Reset all data error:', err?.message);
    return c.json({ success: false, error: String(err) }, 500);
  }
});

app.all("*", (c) => {
  console.log(`[404] ${c.req.method} ${c.req.path}`);
  return c.json({ error: "Not found" }, 404);
});

export default app;
