import { trpcServer } from "@hono/trpc-server";
import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";

import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";
import { db, initializeStore, bootstrapDbConfig, reinitializeStore } from "./db/store";
import { setDbConfig, isDbConfigured } from "./db/rork-db";
import { checkRateLimit, getClientIP, isIPBlocked, trackSuspiciousActivity } from "./utils/security";
import { SUPPORT_WHATSAPP_DISPLAY, SUPPORT_WHATSAPP_NUMBER, buildSupportWhatsAppUrl } from "../constants/support";

const app = new Hono();

console.log("[SERVER] Hono v62 started - ensureDbReady with URL validation");

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

function buildPasswordResetWhatsAppUrl(email: string, maskedPhone: string | null, reason?: string): string {
  const lines: (string | null)[] = [
    'Merhaba 2GO destek,',
    'şifre sıfırlama kodu talep ediyorum.',
    `E-posta: ${email}`,
    `Kayıtlı telefon: ${maskedPhone ?? 'sistemde kontrol ediniz'}`,
    reason ? `Not: ${reason}` : null,
  ];
  const message = lines.filter((line): line is string => Boolean(line)).join('\n');
  return buildSupportWhatsAppUrl(message);
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
          await reinitializeStore();
          _dbReady = true;
          console.log('[SERVER] DB ready from headers in', Date.now() - initStart, 'ms, users:', db.users.getAll().length, 'drivers:', db.drivers.getAll().length);
        } catch (e) {
          console.log('[SERVER] DB init error:', e, 'elapsed:', Date.now() - initStart, 'ms');
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

app.use("*", async (c, next) => {
  const dbEp = c.req.header('x-db-endpoint');
  const dbNs = c.req.header('x-db-namespace');
  const dbTk = c.req.header('x-db-token');
  await ensureDbReady(dbEp, dbNs, dbTk);
  await next();
});

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  console.log(`[API] ${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`);
});

app.get("/", (c) => c.json({ status: "ok", version: "62", dbConfigured: isDbConfigured(), dbReady: _dbReady }));
app.get("/health", (c) => c.json({ status: "ok", version: "62", dbConfigured: isDbConfigured(), dbReady: _dbReady, drivers: db.drivers.getAll().length, users: db.users.getAll().length }));

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
    const cleanEmail = (body.email || '').toLowerCase().trim();
    const deliveryMethod = body.deliveryMethod === 'email' ? 'email' : 'whatsapp';
    if (!cleanEmail) return c.json({ success: false, error: 'E-posta adresi gerekli' });

    console.log('[REST] send-reset-code:', cleanEmail, 'deliveryMethod:', deliveryMethod);
    const { checkLoginAttempt, recordLoginFailure, recordLoginSuccess } = await import('./utils/security');
    const { sendEmail, generateResetCode, buildResetCodeEmail } = await import('./utils/email');

    const loginCheck = checkLoginAttempt(`resetcode_${cleanEmail}`);
    if (!loginCheck.allowed) {
      return c.json({ success: false, error: 'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.' });
    }

    let user = db.users.getByEmail(cleanEmail);
    let driver = db.drivers.getByEmail(cleanEmail);
    let account: any = user || driver;
    let hasPassword = db.passwords.get(cleanEmail);

    if (!account || !hasPassword) {
      try {
        const { initializeStore } = await import('./db/store');
        await initializeStore();
        if (!account) { user = db.users.getByEmail(cleanEmail); driver = db.drivers.getByEmail(cleanEmail); account = user || driver; }
        if (!hasPassword) hasPassword = db.passwords.get(cleanEmail);
      } catch (e) { console.log('[REST] send-reset-code init err:', e); }
    }

    if (!account || !hasPassword) {
      try {
        const { dbFindByEmail, dbSearchPasswordByEmail } = await import('./db/rork-db');
        if (!account) {
          const dbU = await dbFindByEmail<any>('users', cleanEmail);
          if (dbU) { const uid = dbU.rorkId || dbU._originalId || dbU.id; if (uid) { dbU.id = uid; account = dbU; db.users.set(uid, dbU); } }
        }
        if (!account) {
          const dbD = await dbFindByEmail<any>('drivers', cleanEmail);
          if (dbD) { const did = dbD.rorkId || dbD._originalId || dbD.id; if (did) { dbD.id = did; account = dbD; db.drivers.set(did, dbD); } }
        }
        if (!hasPassword) {
          const r = await dbSearchPasswordByEmail(cleanEmail);
          if (r?.hash) { hasPassword = r.hash; db.passwords.set(cleanEmail, r.hash); }
        }
      } catch (e) { console.log('[REST] send-reset-code db lookup err:', e); }
    }

    if (!account && !hasPassword) {
      recordLoginFailure(`resetcode_${cleanEmail}`);
      return c.json({ success: false, error: 'Bu e-posta adresiyle kayıtlı hesap bulunamadı' });
    }

    const accountName = account?.name || cleanEmail.split('@')[0];
    const code = generateResetCode();
    db.resetCodes.set(cleanEmail, code);
    console.log('[REST] send-reset-code stored code for:', cleanEmail);

    const maskedPhone = maskPhoneNumber(typeof account?.phone === 'string' ? account.phone : undefined);
    const whatsappUrl = buildPasswordResetWhatsAppUrl(cleanEmail, maskedPhone, 'Şifre sıfırlama doğrulama kodu talebi');

    if (deliveryMethod === 'whatsapp') {
      recordLoginSuccess(`resetcode_${cleanEmail}`);
      console.log('[REST] Reset code prepared for WhatsApp support:', cleanEmail, 'maskedPhone:', maskedPhone);
      return c.json({
        success: true,
        error: null,
        emailSent: false,
        deliveryChannel: 'whatsapp',
        supportPhone: SUPPORT_WHATSAPP_NUMBER,
        supportPhoneDisplay: SUPPORT_WHATSAPP_DISPLAY,
        whatsappUrl,
        maskedPhone,
      });
    }

    const emailResult = await sendEmail({
      to: cleanEmail,
      subject: '2GO - Şifre Sıfırlama Kodu',
      html: buildResetCodeEmail(code, accountName),
    });

    if (!emailResult.success) {
      console.log('[REST] Reset email failed:', emailResult.errorCode, emailResult.providerMessage);
      return c.json({
        success: true,
        error: null,
        emailSent: false,
        deliveryChannel: 'whatsapp',
        supportPhone: SUPPORT_WHATSAPP_NUMBER,
        supportPhoneDisplay: SUPPORT_WHATSAPP_DISPLAY,
        whatsappUrl,
        maskedPhone,
      });
    }

    recordLoginSuccess(`resetcode_${cleanEmail}`);
    console.log('[REST] Reset code sent to:', cleanEmail, 'channel: email');
    return c.json({
      success: true,
      error: null,
      emailSent: true,
      deliveryChannel: 'email',
      supportPhone: SUPPORT_WHATSAPP_NUMBER,
      supportPhoneDisplay: SUPPORT_WHATSAPP_DISPLAY,
      maskedPhone,
    });
  } catch (err: any) {
    console.log('[REST] send-reset-code error:', err?.message);
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
    const cleanEmail = (body.email || '').toLowerCase().trim();
    const inputCode = (body.code || '').trim();
    if (!cleanEmail || !inputCode) return c.json({ success: false, error: 'E-posta ve kod gerekli' });

    console.log('[REST] verify-reset-code:', cleanEmail);

    const stored = await db.resetCodes.getAsync(cleanEmail);
    if (!stored) {
      return c.json({ success: false, error: 'Doğrulama kodu bulunamadı veya süresi dolmuş. Lütfen yeni kod talep edin.' });
    }

    if (stored.attempts >= 5) {
      db.resetCodes.delete(cleanEmail);
      return c.json({ success: false, error: 'Çok fazla hatalı deneme. Yeni kod talep edin.' });
    }

    if (stored.code !== inputCode) {
      await db.resetCodes.incrementAttemptsAsync(cleanEmail);
      const remaining = 4 - stored.attempts;
      return c.json({ success: false, error: remaining > 0 ? `Doğrulama kodu hatalı. ${remaining} deneme hakkınız kaldı.` : 'Doğrulama kodu hatalı. Yeni kod talep edin.' });
    }

    console.log('[REST] Reset code verified for:', cleanEmail);
    return c.json({ success: true, error: null });
  } catch (err: any) {
    console.log('[REST] verify-reset-code error:', err?.message);
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
    const cleanEmail = (body.email || '').toLowerCase().trim();
    const inputCode = (body.code || '').trim();
    const newPassword = body.newPassword || '';
    if (!cleanEmail || !inputCode || !newPassword) return c.json({ success: false, error: 'Tüm alanlar gerekli' });

    console.log('[REST] reset-password:', cleanEmail);
    const { validatePassword, hashPassword } = await import('./utils/security');

    const stored = await db.resetCodes.getAsync(cleanEmail);
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
    await db.passwords.setSync(cleanEmail, hashedPwd);
    db.resetCodes.delete(cleanEmail);

    console.log('[REST] Password reset OK for:', cleanEmail);
    return c.json({ success: true, error: null });
  } catch (err: any) {
    console.log('[REST] reset-password error:', err?.message);
    return c.json({ success: false, error: 'Bir hata oluştu. Lütfen tekrar deneyin.' }, 500);
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
    const body = await c.req.json();
    if (!body.endpoint || !body.namespace || !body.token) return c.json({ success: false, error: "Missing config" }, 400);
    const result = await bootstrapDbConfig(body.endpoint, body.namespace, body.token);
    return c.json({ success: true, configured: result, drivers: db.drivers.getAll().length, users: db.users.getAll().length });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
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
