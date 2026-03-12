import { trpcServer } from "@hono/trpc-server";
import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";

import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";
import { db, initializeStore, bootstrapDbConfig, reinitializeStore, forceReloadStore, getPersistentStoreStatus } from "./db/store";
import { setDbConfig, isDbConfigured, getCachedDbConfig, dbGet } from "./db/rork-db";
import type { User, Driver, Business, BusinessMenuItem, Session } from "./db/types";
import {
  checkRateLimit,
  getClientIP,
  isIPBlocked,
  trackSuspiciousActivity,
  sanitizeInput,
  validateEmail,
  validatePassword,
  hashPassword,
  generateSecureToken,
  verifyPassword,
  checkLoginAttempt,
  recordLoginFailure,
  recordLoginSuccess,
} from "./utils/security";
import { getTurkishPhoneValidationError, normalizeTurkishPhone } from "../utils/phone";
import { getSmsDeliveryNote, normalizePhoneForSms } from "../constants/support";
import { AUTH_SMS_PROVIDER, generateAuthCode } from "./utils/auth-code";
import { getNetgsmConfigStatus, getNetgsmSendErrorMessage, sendPasswordResetSmsCode, sendVerificationSmsCode } from "./utils/netgsm";

const app = new Hono();

console.log("[SERVER] Hono v69 started - registration always allowed regardless of DB status");

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

function isEmailIdentifier(value: string): boolean {
  return value.includes('@');
}

function normalizePhoneForLookup(phone: string | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return normalizePhoneForSms(phone) ?? digits;
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

interface ResolvedResetAccount {
  account: User | Driver | null;
  emailKey: string | null;
  identifierType: 'email' | 'phone';
  normalizedIdentifier: string;
}

function resolveResetAccount(identifier: string): ResolvedResetAccount {
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

async function resolveResetAccountWithDirectLookup(identifier: string): Promise<ResolvedResetAccount> {
  let resolved = resolveResetAccount(identifier);
  if (resolved.account && resolved.emailKey) {
    return resolved;
  }

  try {
    await initializeStore();
    await forceReloadStore();
    resolved = resolveResetAccount(identifier);
  } catch (error) {
    console.log('[SERVER] resolveResetAccountWithDirectLookup reload error:', error);
  }

  if (resolved.account && resolved.emailKey) {
    return resolved;
  }

  try {
    const { dbFindByEmail, dbFindByPhone } = await import('./db/rork-db');

    if (resolved.identifierType === 'email' && resolved.emailKey) {
      const dbUser = await dbFindByEmail<Record<string, unknown>>('users', resolved.emailKey);
      if (dbUser) {
        const userId = dbUser.rorkId || dbUser._originalId || dbUser.id;
        if (typeof userId === 'string') {
          const hydratedUser = { ...dbUser, id: userId } as User;
          db.users.set(userId, hydratedUser);
          return {
            ...resolved,
            account: hydratedUser,
            emailKey: hydratedUser.email?.toLowerCase().trim() ?? resolved.emailKey,
          };
        }
      }

      const dbDriver = await dbFindByEmail<Record<string, unknown>>('drivers', resolved.emailKey);
      if (dbDriver) {
        const driverId = dbDriver.rorkId || dbDriver._originalId || dbDriver.id;
        if (typeof driverId === 'string') {
          const hydratedDriver = { ...dbDriver, id: driverId } as Driver;
          db.drivers.set(driverId, hydratedDriver);
          return {
            ...resolved,
            account: hydratedDriver,
            emailKey: hydratedDriver.email?.toLowerCase().trim() ?? resolved.emailKey,
          };
        }
      }
    }

    if (resolved.identifierType === 'phone') {
      const normalizedPhone = normalizeTurkishPhone(identifier);
      if (normalizedPhone) {
        const dbUser = await dbFindByPhone<Record<string, unknown>>('users', normalizedPhone);
        if (dbUser) {
          const userId = dbUser.rorkId || dbUser._originalId || dbUser.id;
          if (typeof userId === 'string') {
            const hydratedUser = { ...dbUser, id: userId } as User;
            db.users.set(userId, hydratedUser);
            return {
              ...resolved,
              account: hydratedUser,
              emailKey: hydratedUser.email?.toLowerCase().trim() ?? null,
            };
          }
        }

        const dbDriver = await dbFindByPhone<Record<string, unknown>>('drivers', normalizedPhone);
        if (dbDriver) {
          const driverId = dbDriver.rorkId || dbDriver._originalId || dbDriver.id;
          if (typeof driverId === 'string') {
            const hydratedDriver = { ...dbDriver, id: driverId } as Driver;
            db.drivers.set(driverId, hydratedDriver);
            return {
              ...resolved,
              account: hydratedDriver,
              emailKey: hydratedDriver.email?.toLowerCase().trim() ?? null,
            };
          }
        }
      }
    }
  } catch (error) {
    console.log('[SERVER] resolveResetAccountWithDirectLookup direct-db error:', error);
  }

  return resolved;
}

interface LoadedAuthAccount {
  emailKey: string;
  user: User | null;
  driver: Driver | null;
  passwordHash: string | null;
  source: 'memory' | 'reload' | 'direct-db';
}

function buildPasswordRecordId(email: string): string {
  return email.replace(/[^a-zA-Z0-9]/g, '_');
}

function buildSessionRecordId(token: string): string {
  return token.replace(/[^a-zA-Z0-9]/g, '_');
}

async function loadAuthAccountByEmail(email: string): Promise<LoadedAuthAccount> {
  const cleanEmail = email.toLowerCase().trim();
  let user = db.users.getByEmail(cleanEmail) ?? null;
  let driver = db.drivers.getByEmail(cleanEmail) ?? null;
  let passwordHash = db.passwords.get(cleanEmail) ?? null;
  let source: LoadedAuthAccount['source'] = 'memory';

  console.log('[SERVER] loadAuthAccountByEmail initial:', cleanEmail, 'hasPassword:', !!passwordHash, 'user:', !!user, 'driver:', !!driver);

  if (passwordHash && (user || driver)) {
    return { emailKey: cleanEmail, user, driver, passwordHash, source };
  }

  try {
    await initializeStore();
    await forceReloadStore();
    user = db.users.getByEmail(cleanEmail) ?? user;
    driver = db.drivers.getByEmail(cleanEmail) ?? driver;
    passwordHash = db.passwords.get(cleanEmail) ?? passwordHash;
    source = 'reload';
    console.log('[SERVER] loadAuthAccountByEmail after reload:', cleanEmail, 'hasPassword:', !!passwordHash, 'user:', !!user, 'driver:', !!driver);
  } catch (error) {
    console.log('[SERVER] loadAuthAccountByEmail reload error:', error);
  }

  if (passwordHash && (user || driver)) {
    return { emailKey: cleanEmail, user, driver, passwordHash, source };
  }

  try {
    const { dbFindByEmail, dbSearchPasswordByEmail } = await import('./db/rork-db');

    if (!user && !driver) {
      const dbUser = await dbFindByEmail<Record<string, unknown>>('users', cleanEmail);
      if (dbUser) {
        const userId = dbUser.rorkId || dbUser._originalId || dbUser.id;
        if (typeof userId === 'string') {
          const hydratedUser = { ...dbUser, id: userId } as User;
          user = hydratedUser;
          db.users.set(userId, hydratedUser);
        }
      }
    }

    if (!user && !driver) {
      const dbDriver = await dbFindByEmail<Record<string, unknown>>('drivers', cleanEmail);
      if (dbDriver) {
        const driverId = dbDriver.rorkId || dbDriver._originalId || dbDriver.id;
        if (typeof driverId === 'string') {
          const hydratedDriver = { ...dbDriver, id: driverId } as Driver;
          driver = hydratedDriver;
          db.drivers.set(driverId, hydratedDriver);
        }
      }
    }

    if (!passwordHash) {
      const passwordResult = await dbSearchPasswordByEmail(cleanEmail);
      if (passwordResult?.hash) {
        passwordHash = passwordResult.hash;
        db.passwords.set(cleanEmail, passwordResult.hash);
      }
    }

    source = 'direct-db';
    console.log('[SERVER] loadAuthAccountByEmail direct-db:', cleanEmail, 'hasPassword:', !!passwordHash, 'user:', !!user, 'driver:', !!driver);
  } catch (error) {
    console.log('[SERVER] loadAuthAccountByEmail direct-db error:', error);
  }

  return { emailKey: cleanEmail, user, driver, passwordHash, source };
}

interface LoadedPhoneAuthAccount {
  normalizedPhone: string;
  user: User | null;
  driver: Driver | null;
  source: 'memory' | 'reload' | 'direct-db';
}

async function loadAuthAccountByPhone(phone: string): Promise<LoadedPhoneAuthAccount> {
  const normalizedPhone = normalizeTurkishPhone(phone);
  let user = normalizedPhone ? db.users.getByPhone(normalizedPhone) ?? null : null;
  let driver = normalizedPhone ? db.drivers.getByPhone(normalizedPhone) ?? null : null;
  let source: LoadedPhoneAuthAccount['source'] = 'memory';

  console.log('[SERVER] loadAuthAccountByPhone initial:', normalizedPhone, 'user:', !!user, 'driver:', !!driver, 'totalUsers:', db.users.getAll().length, 'totalDrivers:', db.drivers.getAll().length);

  if (!normalizedPhone) {
    return { normalizedPhone, user, driver, source };
  }

  if (user || driver) {
    return { normalizedPhone, user, driver, source };
  }

  if (!user && !driver) {
    const allUsers = db.users.getAll();
    const allDrivers = db.drivers.getAll();
    console.log('[SERVER] loadAuthAccountByPhone brute-force scan, users:', allUsers.length, 'drivers:', allDrivers.length);
    for (const u of allUsers) {
      const uPhone = normalizeTurkishPhone(u.phone);
      if (uPhone === normalizedPhone) {
        user = u;
        console.log('[SERVER] loadAuthAccountByPhone found user via brute-force:', u.id, u.phone);
        break;
      }
    }
    for (const d of allDrivers) {
      const dPhone = normalizeTurkishPhone(d.phone);
      if (dPhone === normalizedPhone) {
        driver = d;
        console.log('[SERVER] loadAuthAccountByPhone found driver via brute-force:', d.id, d.phone);
        break;
      }
    }
  }

  if (user || driver) {
    return { normalizedPhone, user, driver, source };
  }

  try {
    await initializeStore();
    await forceReloadStore();
    user = db.users.getByPhone(normalizedPhone) ?? null;
    driver = db.drivers.getByPhone(normalizedPhone) ?? null;
    source = 'reload';
    console.log('[SERVER] loadAuthAccountByPhone after reload:', normalizedPhone, 'user:', !!user, 'driver:', !!driver, 'totalUsers:', db.users.getAll().length, 'totalDrivers:', db.drivers.getAll().length);

    if (!user && !driver) {
      const allUsers = db.users.getAll();
      const allDrivers = db.drivers.getAll();
      for (const u of allUsers) {
        if (normalizeTurkishPhone(u.phone) === normalizedPhone) {
          user = u;
          console.log('[SERVER] loadAuthAccountByPhone found user after reload brute-force:', u.id);
          break;
        }
      }
      for (const d of allDrivers) {
        if (normalizeTurkishPhone(d.phone) === normalizedPhone) {
          driver = d;
          console.log('[SERVER] loadAuthAccountByPhone found driver after reload brute-force:', d.id);
          break;
        }
      }
    }
  } catch (error) {
    console.log('[SERVER] loadAuthAccountByPhone reload error:', error);
  }

  if (user || driver) {
    return { normalizedPhone, user, driver, source };
  }

  try {
    const { dbFindByPhone, dbLoadAll } = await import('./db/rork-db');

    const dbUser = await dbFindByPhone<Record<string, unknown>>('users', normalizedPhone);
    if (dbUser) {
      const userId = dbUser.rorkId || dbUser._originalId || dbUser.id;
      if (typeof userId === 'string') {
        const hydratedUser = { ...dbUser, id: userId } as User;
        user = hydratedUser;
        db.users.set(userId, hydratedUser);
      }
    }

    const dbDriver = await dbFindByPhone<Record<string, unknown>>('drivers', normalizedPhone);
    if (dbDriver) {
      const driverId = dbDriver.rorkId || dbDriver._originalId || dbDriver.id;
      if (typeof driverId === 'string') {
        const hydratedDriver = { ...dbDriver, id: driverId } as Driver;
        driver = hydratedDriver;
        db.drivers.set(driverId, hydratedDriver);
      }
    }

    if (!user && !driver) {
      console.log('[SERVER] loadAuthAccountByPhone: direct query failed, trying full table scan from DB...');
      const [allDbUsers, allDbDrivers] = await Promise.all([
        dbLoadAll<Record<string, unknown>>('users'),
        dbLoadAll<Record<string, unknown>>('drivers'),
      ]);

      for (const u of allDbUsers) {
        const uPhone = normalizeTurkishPhone(typeof u.phone === 'string' ? u.phone : '');
        if (uPhone === normalizedPhone) {
          const userId = (u.rorkId || u._originalId || u.id) as string;
          if (userId) {
            const hydratedUser = { ...u, id: userId } as User;
            user = hydratedUser;
            db.users.set(userId, hydratedUser);
            console.log('[SERVER] loadAuthAccountByPhone found user via DB full scan:', userId);
          }
          break;
        }
      }

      for (const d of allDbDrivers) {
        const dPhone = normalizeTurkishPhone(typeof d.phone === 'string' ? d.phone : '');
        if (dPhone === normalizedPhone) {
          const driverId = (d.rorkId || d._originalId || d.id) as string;
          if (driverId) {
            const hydratedDriver = { ...d, id: driverId } as Driver;
            driver = hydratedDriver;
            db.drivers.set(driverId, hydratedDriver);
            console.log('[SERVER] loadAuthAccountByPhone found driver via DB full scan:', driverId);
          }
          break;
        }
      }
    }

    source = 'direct-db';
    console.log('[SERVER] loadAuthAccountByPhone direct-db:', normalizedPhone, 'user:', !!user, 'driver:', !!driver);
  } catch (error) {
    console.log('[SERVER] loadAuthAccountByPhone direct-db error:', error);
  }

  return { normalizedPhone, user, driver, source };
}

function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let nextCode = 'FY';

  for (let index = 0; index < 5; index += 1) {
    nextCode += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nextCode;
}

function sanitizeRepairAccountInput(
  accountInput: Record<string, unknown>,
  email: string,
  fallbackType: 'customer' | 'driver',
): User | Driver {
  const now = new Date().toISOString();
  const cleanId = sanitizeInput(typeof accountInput.id === 'string' ? accountInput.id : '').trim();
  const accountId = cleanId || `${fallbackType === 'driver' ? 'd' : 'c'}_repair_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cleanName = sanitizeInput(typeof accountInput.name === 'string' ? accountInput.name : '').trim() || (fallbackType === 'driver' ? 'Şoför' : 'Müşteri');
  const cleanPhone = normalizeTurkishPhone(typeof accountInput.phone === 'string' ? accountInput.phone : '');
  const cleanCity = sanitizeInput(typeof accountInput.city === 'string' ? accountInput.city : '').trim();
  const cleanDistrict = sanitizeInput(typeof accountInput.district === 'string' ? accountInput.district : '').trim();
  const cleanAvatar = sanitizeInput(typeof accountInput.avatar === 'string' ? accountInput.avatar : '').trim() || undefined;
  const cleanCreatedAt = typeof accountInput.createdAt === 'string' && accountInput.createdAt.trim()
    ? accountInput.createdAt
    : now;

  if (fallbackType === 'driver') {
    const requestedDriverCategory = typeof accountInput.driverCategory === 'string' ? accountInput.driverCategory : '';
    const driverCategory = requestedDriverCategory === 'courier' || requestedDriverCategory === 'scooter' || requestedDriverCategory === 'driver'
      ? requestedDriverCategory
      : 'driver';
    const rating = typeof accountInput.rating === 'number' ? accountInput.rating : 5;
    const totalRides = typeof accountInput.totalRides === 'number' ? accountInput.totalRides : 0;
    const dailyEarnings = typeof accountInput.dailyEarnings === 'number' ? accountInput.dailyEarnings : 0;
    const weeklyEarnings = typeof accountInput.weeklyEarnings === 'number' ? accountInput.weeklyEarnings : 0;
    const monthlyEarnings = typeof accountInput.monthlyEarnings === 'number' ? accountInput.monthlyEarnings : 0;
    const vehiclePlate = sanitizeInput(typeof accountInput.vehiclePlate === 'string' ? accountInput.vehiclePlate : '').trim().toUpperCase();
    const vehicleModel = sanitizeInput(typeof accountInput.vehicleModel === 'string' ? accountInput.vehicleModel : '').trim() || 'Araç';
    const vehicleColor = sanitizeInput(typeof accountInput.vehicleColor === 'string' ? accountInput.vehicleColor : '').trim() || 'Belirtilmedi';
    const approvedAt = typeof accountInput.approvedAt === 'string' && accountInput.approvedAt.trim()
      ? accountInput.approvedAt
      : now;

    return {
      id: accountId,
      name: cleanName,
      phone: cleanPhone,
      email,
      type: 'driver',
      driverCategory,
      vehiclePlate,
      vehicleModel,
      vehicleColor,
      rating,
      totalRides,
      isOnline: Boolean(accountInput.isOnline),
      isSuspended: Boolean(accountInput.isSuspended),
      isApproved: typeof accountInput.isApproved === 'boolean' ? accountInput.isApproved : true,
      approvedAt,
      licenseIssueDate: typeof accountInput.licenseIssueDate === 'string' ? accountInput.licenseIssueDate : undefined,
      partnerDriverName: typeof accountInput.partnerDriverName === 'string' ? sanitizeInput(accountInput.partnerDriverName) : undefined,
      dailyEarnings,
      weeklyEarnings,
      monthlyEarnings,
      city: cleanCity,
      district: cleanDistrict,
      avatar: cleanAvatar,
      createdAt: cleanCreatedAt,
    };
  }

  const gender = accountInput.gender === 'female' ? 'female' : 'male';
  const freeRidesRemaining = typeof accountInput.freeRidesRemaining === 'number' ? accountInput.freeRidesRemaining : 0;
  const referralCode = typeof accountInput.referralCode === 'string' && accountInput.referralCode.trim()
    ? sanitizeInput(accountInput.referralCode).trim().toUpperCase()
    : generateReferralCode();

  return {
    id: accountId,
    name: cleanName,
    phone: cleanPhone,
    email,
    type: 'customer',
    gender,
    city: cleanCity,
    district: cleanDistrict,
    avatar: cleanAvatar,
    referralCode,
    referredBy: typeof accountInput.referredBy === 'string' ? sanitizeInput(accountInput.referredBy) : undefined,
    freeRidesRemaining,
    createdAt: cleanCreatedAt,
  };
}

async function repairAuthAccountFromBackup(input: {
  email: string;
  password: string;
  type: 'customer' | 'driver';
  account: Record<string, unknown>;
}): Promise<{ account: User | Driver; accountType: 'customer' | 'driver'; token: string; repaired: boolean }> {
  const cleanEmail = input.email.toLowerCase().trim();
  const resolvedType: 'customer' | 'driver' = input.type === 'driver' ? 'driver' : 'customer';
  const loadedAccount = await loadAuthAccountByEmail(cleanEmail);
  const matchingExistingAccount = resolvedType === 'driver' ? loadedAccount.driver : loadedAccount.user;
  const conflictingAccount = resolvedType === 'driver' ? loadedAccount.user : loadedAccount.driver;

  if (conflictingAccount && !matchingExistingAccount) {
    throw new Error('Bu e-posta farklı bir hesap türünde kayıtlı');
  }

  let accountToPersist = matchingExistingAccount;
  let repaired = false;

  if (!accountToPersist) {
    accountToPersist = sanitizeRepairAccountInput(input.account, cleanEmail, resolvedType);
    repaired = true;
  }

  if (accountToPersist.phone) {
    const phoneValidationError = getTurkishPhoneValidationError(accountToPersist.phone);
    if (phoneValidationError) {
      throw new Error(phoneValidationError);
    }

    if (isPhoneTakenByAnotherAccount(accountToPersist.phone, accountToPersist.id)) {
      throw new Error('Bu telefon numarası başka bir hesapta kullanılıyor');
    }
  }

  if (resolvedType === 'driver') {
    await db.drivers.setSync(accountToPersist.id, accountToPersist as Driver);
    await persistAccountDirect(accountToPersist as Driver, 'driver');
  } else {
    await db.users.setSync(accountToPersist.id, accountToPersist as User);
    await persistAccountDirect(accountToPersist as User, 'customer');
  }

  let passwordHash = loadedAccount.passwordHash;
  if (passwordHash) {
    const passwordMatches = await verifyPassword(input.password, passwordHash);
    if (!passwordMatches) {
      throw new Error('Şifre hatalı');
    }
  } else {
    passwordHash = await hashPassword(input.password);
    await db.passwords.setSync(cleanEmail, passwordHash);
    await persistPasswordHashDirect(cleanEmail, passwordHash);
    repaired = true;
  }

  const sessionToken = generateSecureToken(64);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sessionRecord: Session = {
    token: sessionToken,
    userId: accountToPersist.id,
    userType: resolvedType,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await db.sessions.setSync(sessionToken, sessionRecord);
  await persistSessionDirect(sessionRecord);

  return {
    account: accountToPersist,
    accountType: resolvedType,
    token: sessionToken,
    repaired,
  };
}

async function persistPasswordHashDirect(email: string, passwordHash: string): Promise<void> {
  if (!isDbConfigured()) {
    console.log('[SERVER] persistPasswordHashDirect skipped - db not configured for:', email);
    return;
  }

  try {
    const { dbDirectUpsert } = await import('./db/rork-db');
    const ok = await dbDirectUpsert('passwords', buildPasswordRecordId(email), {
      email,
      hash: passwordHash,
      _originalEmail: email,
    });
    console.log('[SERVER] persistPasswordHashDirect result:', email, ok);
  } catch (error) {
    console.log('[SERVER] persistPasswordHashDirect error:', error);
  }
}

async function persistSessionDirect(session: Session): Promise<void> {
  if (!isDbConfigured()) {
    console.log('[SERVER] persistSessionDirect skipped - db not configured for:', session.userId);
    return;
  }

  try {
    const { dbDirectUpsert } = await import('./db/rork-db');
    const ok = await dbDirectUpsert('sessions', buildSessionRecordId(session.token), {
      ...session,
      _originalToken: session.token,
    });
    console.log('[SERVER] persistSessionDirect result:', session.userId, ok);
  } catch (error) {
    console.log('[SERVER] persistSessionDirect error:', error);
  }
}

async function persistAccountDirect(account: User | Driver, accountType: 'customer' | 'driver'): Promise<void> {
  if (!isDbConfigured()) {
    console.log('[SERVER] persistAccountDirect skipped - db not configured for:', account.id);
    return;
  }

  try {
    const { dbDirectUpsert } = await import('./db/rork-db');
    const table = accountType === 'driver' ? 'drivers' : 'users';
    const ok = await dbDirectUpsert(table, account.id, {
      ...account,
      _originalId: account.id,
      rorkId: account.id,
    });
    console.log('[SERVER] persistAccountDirect result:', account.id, accountType, ok);
  } catch (error) {
    console.log('[SERVER] persistAccountDirect error:', error);
  }
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

function resolveRequestDbConfig(c: Context, body?: Record<string, unknown> | null): {
  endpoint?: string;
  namespace?: string;
  token?: string;
} {
  const headerEndpoint = c.req.header('x-db-endpoint')?.trim() ?? '';
  const headerNamespace = c.req.header('x-db-namespace')?.trim() ?? '';
  const headerToken = c.req.header('x-db-token')?.trim() ?? '';

  const bodyEndpoint = typeof body?.dbEndpoint === 'string' ? body.dbEndpoint.trim() : '';
  const bodyNamespace = typeof body?.dbNamespace === 'string' ? body.dbNamespace.trim() : '';
  const bodyToken = typeof body?.dbToken === 'string' ? body.dbToken.trim() : '';

  const resolvedConfig = {
    endpoint: headerEndpoint || bodyEndpoint || undefined,
    namespace: headerNamespace || bodyNamespace || undefined,
    token: headerToken || bodyToken || undefined,
  };

  if ((!headerEndpoint || !headerNamespace || !headerToken) && (bodyEndpoint || bodyNamespace || bodyToken)) {
    console.log('[SERVER] resolveRequestDbConfig using body fallback:', {
      hasEndpoint: !!resolvedConfig.endpoint,
      hasNamespace: !!resolvedConfig.namespace,
      hasToken: !!resolvedConfig.token,
      missingHeaderEndpoint: !headerEndpoint,
      missingHeaderNamespace: !headerNamespace,
      missingHeaderToken: !headerToken,
    });
  }

  return resolvedConfig;
}

async function ensureDbReady(dbEp?: string, dbNs?: string, dbTk?: string): Promise<boolean> {
  const cached = getCachedDbConfig();
  const resolvedEndpoint = (dbEp || '').trim()
    || readServerEnv('EXPO_PUBLIC_RORK_DB_ENDPOINT')
    || readServerEnv('RORK_DB_ENDPOINT')
    || cached?.endpoint
    || '';
  const resolvedNamespace = (dbNs || '').trim()
    || readServerEnv('EXPO_PUBLIC_RORK_DB_NAMESPACE')
    || readServerEnv('RORK_DB_NAMESPACE')
    || cached?.namespace
    || '';
  const resolvedToken = (dbTk || '').trim()
    || readServerEnv('EXPO_PUBLIC_RORK_DB_TOKEN')
    || readServerEnv('RORK_DB_TOKEN')
    || cached?.token
    || '';

  if (!resolvedEndpoint || !resolvedNamespace || !resolvedToken) {
    if (_dbReady || !isDbConfigured()) {
      return _dbReady;
    }

    if (_dbInitPromise) {
      await _dbInitPromise;
      return _dbReady;
    }

    const initStart = Date.now();
    _dbInitPromise = (async () => {
      try {
        await reinitializeStore();
        _dbReady = isDbConfigured();
        console.log('[SERVER] DB reloaded from cached config in', Date.now() - initStart, 'ms, users:', db.users.getAll().length, 'drivers:', db.drivers.getAll().length);
      } catch (error) {
        console.log('[SERVER] Cached DB reload error:', error, 'elapsed:', Date.now() - initStart, 'ms');
      }
    })();
    await _dbInitPromise;
    _dbInitPromise = null;
    return _dbReady;
  }

  if (!isValidDbUrl(resolvedEndpoint)) {
    console.log('[SERVER] Invalid DB endpoint URL, skipping DB init:', resolvedEndpoint);
    return _dbReady;
  }

  const wasConfigured = isDbConfigured();
  setDbConfig(resolvedEndpoint, resolvedNamespace, resolvedToken);

  if (!_dbReady) {
    if (_dbInitPromise) {
      await _dbInitPromise;
      if (_dbReady) return true;
    }

    const initStart = Date.now();
    _dbInitPromise = (async () => {
      try {
        setDbConfig(resolvedEndpoint, resolvedNamespace, resolvedToken);
        await reinitializeStore();
        _dbReady = true;
        console.log('[SERVER] DB ready in', Date.now() - initStart, 'ms, users:', db.users.getAll().length, 'drivers:', db.drivers.getAll().length);
      } catch (e) {
        console.log('[SERVER] DB init error:', e, 'elapsed:', Date.now() - initStart, 'ms');
        setDbConfig(resolvedEndpoint, resolvedNamespace, resolvedToken);
        try {
          await bootstrapDbConfig(resolvedEndpoint, resolvedNamespace, resolvedToken);
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
    setDbConfig(resolvedEndpoint, resolvedNamespace, resolvedToken);
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

async function recoverAuthStoreForRequest(
  reason: string,
  dbEp?: string,
  dbNs?: string,
  dbTk?: string,
): Promise<void> {
  const dbReady = await ensureDbReady(dbEp, dbNs, dbTk);
  const initialPersistentStore = getPersistentStoreStatus();
  const initialUsers = db.users.getAll().length;
  const initialDrivers = db.drivers.getAll().length;

  console.log('[SERVER] recoverAuthStoreForRequest start:', reason, 'dbReady:', dbReady, 'storageMode:', getCurrentStorageMode(), 'snapshotAvailable:', initialPersistentStore.available, 'users:', initialUsers, 'drivers:', initialDrivers);

  if (initialUsers > 0 || initialDrivers > 0) {
    console.log('[SERVER] recoverAuthStoreForRequest: data already loaded, skipping recovery for:', reason);
    return;
  }

  try {
    await initializeStore();
  } catch (error) {
    console.log('[SERVER] recoverAuthStoreForRequest initializeStore error:', reason, error);
  }

  const afterInitUsers = db.users.getAll().length;
  const afterInitDrivers = db.drivers.getAll().length;
  const afterInitPersistentStore = getPersistentStoreStatus();

  if (afterInitUsers > 0 || afterInitDrivers > 0) {
    console.log('[SERVER] recoverAuthStoreForRequest: data loaded after init, users:', afterInitUsers, 'drivers:', afterInitDrivers);
    return;
  }

  if (afterInitPersistentStore.available) {
    try {
      console.log('[SERVER] recoverAuthStoreForRequest reinitialize from snapshot:', reason);
      await reinitializeStore();
    } catch (error) {
      console.log('[SERVER] recoverAuthStoreForRequest reinitialize error:', reason, error);
    }
  }

  if (dbReady && db.users.getAll().length === 0 && db.drivers.getAll().length === 0) {
    try {
      console.log('[SERVER] recoverAuthStoreForRequest force reload from DB:', reason);
      await forceReloadStore();
    } catch (error) {
      console.log('[SERVER] recoverAuthStoreForRequest force reload error:', reason, error);
    }
  }

  const finalPersistentStore = getPersistentStoreStatus();
  console.log('[SERVER] recoverAuthStoreForRequest done:', reason, 'storageMode:', getCurrentStorageMode(), 'snapshotAvailable:', finalPersistentStore.available, 'users:', db.users.getAll().length, 'drivers:', db.drivers.getAll().length);
}

async function loadSessionFromDb(sessionToken: string): Promise<Session | null> {
  try {
    const directSession = await dbGet<Record<string, unknown>>('sessions', buildSessionRecordId(sessionToken));
    if (!directSession) {
      return null;
    }

    const hydratedSession: Session = {
      token: sessionToken,
      userId: typeof directSession.userId === 'string' ? directSession.userId : '',
      userType: directSession.userType === 'driver' ? 'driver' : 'customer',
      createdAt: typeof directSession.createdAt === 'string' ? directSession.createdAt : new Date().toISOString(),
      expiresAt: typeof directSession.expiresAt === 'string' ? directSession.expiresAt : new Date().toISOString(),
    };

    if (!hydratedSession.userId) {
      return null;
    }

    db.sessions.set(sessionToken, hydratedSession);
    console.log('[SERVER] Session recovered from direct DB for:', hydratedSession.userId);
    return hydratedSession;
  } catch (error) {
    console.log('[SERVER] Direct session lookup error:', error);
    return null;
  }
}

async function hydrateSessionAccount(session: Session): Promise<User | Driver | null> {
  if (session.userType === 'customer') {
    const memoryUser = db.users.get(session.userId);
    if (memoryUser) {
      return memoryUser;
    }

    try {
      const dbUser = await dbGet<Record<string, unknown>>('users', session.userId);
      if (!dbUser) {
        return null;
      }

      const hydratedUser: User = {
        ...(dbUser as unknown as User),
        id: session.userId,
        type: 'customer',
      };
      db.users.set(session.userId, hydratedUser);
      console.log('[SERVER] Customer hydrated from direct DB for session:', session.userId);
      return hydratedUser;
    } catch (error) {
      console.log('[SERVER] Customer hydrate error:', error);
      return null;
    }
  }

  const memoryDriver = db.drivers.get(session.userId);
  if (memoryDriver) {
    return memoryDriver;
  }

  try {
    const dbDriver = await dbGet<Record<string, unknown>>('drivers', session.userId);
    if (!dbDriver) {
      return null;
    }

    const hydratedDriver: Driver = {
      ...(dbDriver as unknown as Driver),
      id: session.userId,
      type: 'driver',
    };
    db.drivers.set(session.userId, hydratedDriver);
    console.log('[SERVER] Driver hydrated from direct DB for session:', session.userId);
    return hydratedDriver;
  } catch (error) {
    console.log('[SERVER] Driver hydrate error:', error);
    return null;
  }
}

async function resolveValidSession(sessionToken: string): Promise<Session | null> {
  let session: Session | null | undefined = db.sessions.get(sessionToken);

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
    session = await loadSessionFromDb(sessionToken);
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

  const account = await hydrateSessionAccount(session);
  if (!account) {
    db.sessions.delete(sessionToken);
    console.log('[SERVER] Session account missing, invalidated token for:', session.userId);
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
    const bunEnv = (globalThis as any).Bun?.env as Record<string, string | undefined> | undefined;
    const bunValue = typeof bunEnv?.[key] === 'string' ? bunEnv[key]?.trim() ?? '' : '';
    if (bunValue) return bunValue;
  } catch {}
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
  const nestedDbConfig = typeof bodyRecord?.dbConfig === 'object' && bodyRecord.dbConfig !== null
    ? bodyRecord.dbConfig as Record<string, unknown>
    : null;

  const ep = normalizeOptionalString(bodyRecord?.endpoint)
    || normalizeOptionalString(bodyRecord?.dbEndpoint)
    || normalizeOptionalString(nestedDbConfig?.endpoint)
    || headerConfig.ep;
  const ns = normalizeOptionalString(bodyRecord?.namespace)
    || normalizeOptionalString(bodyRecord?.dbNamespace)
    || normalizeOptionalString(nestedDbConfig?.namespace)
    || headerConfig.ns;
  const tk = normalizeOptionalString(bodyRecord?.token)
    || normalizeOptionalString(bodyRecord?.dbToken)
    || normalizeOptionalString(nestedDbConfig?.token)
    || headerConfig.tk;

  return { ep, ns, tk };
}

async function readBootstrapBodyFromClone(c: Context): Promise<unknown> {
  const method = c.req.method.toUpperCase();
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') {
    return null;
  }

  const contentType = c.req.header('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return null;
  }

  try {
    return await c.req.raw.clone().json();
  } catch (error) {
    console.log('[SERVER] readBootstrapBodyFromClone parse error:', error);
    return null;
  }
}

app.use("*", async (c, next) => {
  const bootstrapBody = await readBootstrapBodyFromClone(c);
  const { ep, ns, tk } = resolveBootstrapDbConfig(c, bootstrapBody);
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
  const netgsmStatus = getNetgsmConfigStatus();
  console.log('[SERVER] Health response: configured:', configured, 'ready:', ready, 'storageMode:', storageMode, 'snapshotAvailable:', persistentStore.available, 'users:', db.users.getAll().length, 'drivers:', db.drivers.getAll().length, 'smsConfigured:', netgsmStatus.configured, 'smsSenderName:', netgsmStatus.senderName ?? 'none', 'smsConfiguredHeader:', netgsmStatus.configuredSenderName ?? 'none', 'smsHeaderMismatch:', netgsmStatus.senderHeaderMismatch, 'smsSenderLocked:', netgsmStatus.senderLocked);
  return c.json({
    status: "ok",
    version: "67",
    dbConfigured: configured,
    dbReady: ready,
    storageMode,
    persistentStoreAvailable: persistentStore.available,
    persistentStoreLastSavedAt: persistentStore.lastSavedAt,
    dbMissing: (!ep || !ns || !tk) ? { endpoint: !ep, namespace: !ns, token: !tk } : undefined,
    smsProvider: AUTH_SMS_PROVIDER,
    smsConfigured: netgsmStatus.configured,
    smsSenderName: netgsmStatus.senderName,
    smsConfiguredHeader: netgsmStatus.configuredSenderName,
    smsHeaderMismatch: netgsmStatus.senderHeaderMismatch,
    smsSenderLocked: netgsmStatus.senderLocked,
    smsMissing: netgsmStatus.missingKeys,
    drivers: db.drivers.getAll().length,
    users: db.users.getAll().length,
  });
});

app.post("/auth/send-verification-code", async (c) => {
  try {
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await ensureDbReady(dbEp, dbNs, dbTk);

    const body = await c.req.json();
    const cleanEmail = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    const cleanName = sanitizeInput(typeof body.name === 'string' ? body.name : '');
    const cleanPhone = normalizeTurkishPhone(typeof body.phone === 'string' ? body.phone : '');
    const deliveryMethod = 'sms';
    const phoneValidationError = typeof body.phone === 'string' && body.phone.trim()
      ? getTurkishPhoneValidationError(cleanPhone)
      : null;

    if (!cleanEmail || !cleanName) {
      return c.json({ success: false, error: 'Ad ve e-posta alanları zorunludur.' });
    }

    if (!validateEmail(cleanEmail)) {
      return c.json({ success: false, error: 'Geçersiz e-posta adresi' });
    }

    if (phoneValidationError) {
      return c.json({
        success: false,
        error: phoneValidationError,
        emailSent: false,
        deliveryChannel: 'sms',
        maskedPhone: null,
        deliveryNote: getSmsDeliveryNote(null),
        smsProvider: AUTH_SMS_PROVIDER,
      });
    }

    const loginCheck = checkLoginAttempt(`verify_${cleanEmail}`);
    if (!loginCheck.allowed) {
      return c.json({ success: false, error: 'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.' });
    }

    const existingUser = db.users.getByEmail(cleanEmail);
    const existingDriver = db.drivers.getByEmail(cleanEmail);
    if (existingUser || existingDriver) {
      return c.json({ success: false, error: 'Bu e-posta adresi zaten kayıtlı' });
    }

    const maskedPhone = maskPhoneNumber(cleanPhone || undefined);
    if (cleanPhone && isPhoneTakenByAnotherAccount(cleanPhone)) {
      return c.json({
        success: false,
        error: 'Bu telefon numarası zaten kayıtlı',
        emailSent: false,
        deliveryChannel: 'sms',
        maskedPhone,
        deliveryNote: getSmsDeliveryNote(maskedPhone),
        smsProvider: AUTH_SMS_PROVIDER,
      });
    }

    const code = generateAuthCode();
    const codeKey = `verify_${cleanEmail}`;
    db.resetCodes.set(codeKey, code);
    console.log('[REST] send-verification-code stored code for:', codeKey, 'deliveryMethod:', deliveryMethod);

    const smsTargetPhone = normalizePhoneForSms(cleanPhone || undefined);
    const directDeliveryNote = getSmsDeliveryNote(maskedPhone);

    if (!smsTargetPhone) {
      return c.json({
        success: false,
        error: 'Geçerli bir telefon numarası gerekli.',
        emailSent: false,
        deliveryChannel: 'sms',
        maskedPhone,
        deliveryNote: directDeliveryNote,
        smsProvider: AUTH_SMS_PROVIDER,
      });
    }

    const smsResult = await sendVerificationSmsCode({
      toPhone: smsTargetPhone,
      code,
    });

    if (!smsResult.success) {
      console.log('[REST] Verification SMS send failed:', cleanEmail, smsResult.errorCode, smsResult.providerMessage);
      return c.json({
        success: false,
        error: getNetgsmSendErrorMessage(smsResult),
        emailSent: false,
        deliveryChannel: 'sms',
        maskedPhone,
        deliveryNote: directDeliveryNote,
        smsProvider: AUTH_SMS_PROVIDER,
      });
    }

    recordLoginSuccess(`verify_${cleanEmail}`);
    console.log('[REST] Verification code sent via SMS:', cleanEmail, 'maskedPhone:', maskedPhone, 'messageId:', smsResult.messageId);
    return c.json({
      success: true,
      error: null,
      emailSent: false,
      deliveryChannel: 'sms',
      maskedPhone,
      deliveryNote: directDeliveryNote,
      smsProvider: AUTH_SMS_PROVIDER,
    });
  } catch (err: unknown) {
    console.log('[REST] send-verification-code error:', err instanceof Error ? err.message : err);
    return c.json({ success: false, error: 'Bir hata oluştu. Lütfen tekrar deneyin.' }, 500);
  }
});

app.post("/auth/verify-verification-code", async (c) => {
  try {
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await ensureDbReady(dbEp, dbNs, dbTk);

    const body = await c.req.json();
    const cleanEmail = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    const inputCode = typeof body.code === 'string' ? body.code.trim() : '';
    if (!cleanEmail || !inputCode) {
      return c.json({ success: false, error: 'E-posta ve kod gerekli' });
    }

    const codeKey = `verify_${cleanEmail}`;
    const stored = await db.resetCodes.getAsync(codeKey);
    console.log('[REST] verify-verification-code lookup:', codeKey, 'input:', inputCode, 'found:', !!stored);

    if (!stored) {
      return c.json({ success: false, error: 'Doğrulama kodu bulunamadı veya süresi dolmuş' });
    }

    if (stored.attempts >= 5) {
      db.resetCodes.delete(codeKey);
      return c.json({ success: false, error: 'Çok fazla hatalı deneme. Yeni kod talep edin.' });
    }

    if (stored.code !== inputCode) {
      await db.resetCodes.incrementAttemptsAsync(codeKey);
      return c.json({ success: false, error: 'Doğrulama kodu hatalı' });
    }

    db.resetCodes.delete(codeKey);
    console.log('[REST] verify-verification-code success for:', cleanEmail);
    return c.json({ success: true, error: null });
  } catch (err: unknown) {
    console.log('[REST] verify-verification-code error:', err instanceof Error ? err.message : err);
    return c.json({ success: false, error: 'Bir hata oluştu. Lütfen tekrar deneyin.' }, 500);
  }
});

app.post("/auth/register-customer", async (c) => {
  const startTime = Date.now();
  try {
    const body = await c.req.json().catch((): Record<string, unknown> => ({})) as Record<string, any>;
    const requestDbConfig = resolveRequestDbConfig(c, body);
    const dbReady = await ensureDbReady(requestDbConfig.endpoint, requestDbConfig.namespace, requestDbConfig.token);
    const storageMode = getCurrentStorageMode();
    if (!dbReady) {
      console.log('[REST] register-customer continuing without confirmed DB readiness, storageMode:', storageMode, 'dbConfigured:', isDbConfigured());
    }

    console.log('[REST] register-customer start:', body.email, 'dbReady:', _dbReady, 'dbConfigured:', isDbConfigured());

    const cleanName = sanitizeInput(body.name || '');
    const cleanPhone = normalizeTurkishPhone(body.phone || '');
    const cleanEmail = (body.email || '').toLowerCase().trim();

    if (!cleanName || !cleanPhone || !cleanEmail || !body.password || !body.gender || !body.city || !body.district) {
      return c.json({ success: false, error: 'Tüm alanlar zorunludur', user: null, token: null });
    }
    if (!validateEmail(cleanEmail)) return c.json({ success: false, error: 'Geçersiz e-posta adresi', user: null, token: null });
    const pwdCheck = validatePassword(body.password);
    if (!pwdCheck.valid) return c.json({ success: false, error: pwdCheck.reason, user: null, token: null });

    const phoneValidationError = getTurkishPhoneValidationError(cleanPhone);
    if (phoneValidationError) {
      return c.json({ success: false, error: phoneValidationError, user: null, token: null });
    }

    const existingUser = db.users.getByEmail(cleanEmail);
    const existingDriver = db.drivers.getByEmail(cleanEmail);
    if (existingUser || existingDriver) return c.json({ success: false, error: 'Bu e-posta zaten kayıtlı', user: null, token: null });
    if (isPhoneTakenByAnotherAccount(cleanPhone)) {
      return c.json({ success: false, error: 'Bu telefon numarası başka bir hesapta kullanılıyor', user: null, token: null });
    }

    const id = 'c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let myCode = 'FY';
    for (let i = 0; i < 5; i++) myCode += chars.charAt(Math.floor(Math.random() * chars.length));

    let referrerUserId: string | undefined;
    if (body.referralCode) {
      referrerUserId = db.referralCodeIndex.get(body.referralCode.toUpperCase().trim());
    }
    const signupBonusFreeRides = 1;
    const referralBonusFreeRides = referrerUserId ? 2 : 0;
    const freeRides = signupBonusFreeRides + referralBonusFreeRides;

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
    const sessionRecord: Session = {
      token: sessionToken,
      userId: id,
      userType: 'customer',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await db.sessions.setSync(sessionToken, sessionRecord);
    await persistAccountDirect(user, 'customer');
    await persistPasswordHashDirect(cleanEmail, hashedPwd);
    await persistSessionDirect(sessionRecord);

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
    const body = await c.req.json().catch((): Record<string, unknown> => ({})) as Record<string, any>;
    const requestDbConfig = resolveRequestDbConfig(c, body);
    const dbReady = await ensureDbReady(requestDbConfig.endpoint, requestDbConfig.namespace, requestDbConfig.token);
    const storageMode = getCurrentStorageMode();
    if (!dbReady) {
      console.log('[REST] register-driver continuing without confirmed DB readiness, storageMode:', storageMode, 'dbConfigured:', isDbConfigured());
    }

    console.log('[REST] register-driver start:', body.email, 'dbReady:', _dbReady, 'dbConfigured:', isDbConfigured());

    const cleanName = sanitizeInput(body.name || '');
    const cleanEmail = (body.email || '').toLowerCase().trim();
    const cleanPhone = normalizeTurkishPhone(body.phone || '');

    if (!cleanName || !cleanEmail || !cleanPhone || !body.password || !body.vehicleModel || !body.vehicleColor || !body.city || !body.district) {
      return c.json({ success: false, error: 'Tüm alanlar zorunludur', driver: null, token: null });
    }
    if (!validateEmail(cleanEmail)) return c.json({ success: false, error: 'Geçersiz e-posta adresi', driver: null, token: null });
    const pwdCheck = validatePassword(body.password);
    if (!pwdCheck.valid) return c.json({ success: false, error: pwdCheck.reason, driver: null, token: null });

    const phoneValidationError = getTurkishPhoneValidationError(cleanPhone);
    if (phoneValidationError) {
      return c.json({ success: false, error: phoneValidationError, driver: null, token: null });
    }

    const existingDriver = db.drivers.getByEmail(cleanEmail);
    const existingUser = db.users.getByEmail(cleanEmail);
    if (existingDriver || existingUser) return c.json({ success: false, error: 'Bu e-posta zaten kayıtlı', driver: null, token: null });
    if (isPhoneTakenByAnotherAccount(cleanPhone)) {
      return c.json({ success: false, error: 'Bu telefon numarası başka bir hesapta kullanılıyor', driver: null, token: null });
    }

    const id = 'd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const driver = {
      id, name: cleanName, phone: cleanPhone, email: cleanEmail,
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
    const sessionRecord: Session = {
      token: sessionToken,
      userId: id,
      userType: 'driver',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await db.sessions.setSync(sessionToken, sessionRecord);
    await persistAccountDirect(driver, 'driver');
    await persistPasswordHashDirect(cleanEmail, hashedPwd);
    await persistSessionDirect(sessionRecord);

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

app.post("/auth/send-login-code", async (c) => {
  try {
    const body = await c.req.json().catch((): Record<string, unknown> => ({})) as Record<string, any>;
    const requestDbConfig = resolveRequestDbConfig(c, body);
    await recoverAuthStoreForRequest('send-login-code', requestDbConfig.endpoint, requestDbConfig.namespace, requestDbConfig.token);

    const requestedType: 'customer' | 'driver' = body.type === 'driver' ? 'driver' : 'customer';
    const cleanPhone = normalizeTurkishPhone(typeof body.phone === 'string' ? body.phone : '');
    const phoneValidationError = getTurkishPhoneValidationError(cleanPhone);
    if (phoneValidationError) {
      return c.json({ success: false, error: phoneValidationError, maskedPhone: null, deliveryNote: getSmsDeliveryNote(null), smsProvider: AUTH_SMS_PROVIDER }, 400);
    }

    const lookupKey = `logincode_${requestedType}_${cleanPhone}`;
    const loginCheck = checkLoginAttempt(lookupKey);
    if (!loginCheck.allowed) {
      return c.json({ success: false, error: 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.', maskedPhone: maskPhoneNumber(cleanPhone), deliveryNote: getSmsDeliveryNote(maskPhoneNumber(cleanPhone)), smsProvider: AUTH_SMS_PROVIDER }, 429);
    }

    const { user, driver, source } = await loadAuthAccountByPhone(cleanPhone);
    console.log('[REST] send-login-code account resolution:', cleanPhone, 'type:', requestedType, 'source:', source, 'user:', !!user, 'driver:', !!driver);

    let account = requestedType === 'driver' ? driver : user;
    let actualType = requestedType;
    if (!account) {
      const crossTypeAccount = requestedType === 'driver' ? user : driver;
      if (crossTypeAccount) {
        account = crossTypeAccount;
        actualType = requestedType === 'driver' ? 'customer' : 'driver';
        console.log('[REST] send-login-code cross-type fallback:', cleanPhone, 'requested:', requestedType, 'found:', actualType);
      }
    }
    if (!account) {
      recordLoginFailure(lookupKey);
      return c.json({
        success: false,
        error: 'Bu telefon numarasıyla kayıtlı hesap bulunamadı. Lütfen kayıt olduğunuz telefon numarasını kontrol edin.',
        maskedPhone: maskPhoneNumber(cleanPhone),
        deliveryNote: getSmsDeliveryNote(maskPhoneNumber(cleanPhone)),
        smsProvider: AUTH_SMS_PROVIDER,
      });
    }

    if (actualType === 'driver' && driver?.isSuspended) {
      return c.json({ success: false, error: 'Hesabınız askıya alınmıştır. Yönetici ile iletişime geçin.', maskedPhone: maskPhoneNumber(cleanPhone), deliveryNote: getSmsDeliveryNote(maskPhoneNumber(cleanPhone)), smsProvider: AUTH_SMS_PROVIDER }, 403);
    }

    const code = generateAuthCode();
    const codeKey = `login_${actualType}_${cleanPhone}`;
    db.resetCodes.set(codeKey, code);

    const maskedPhone = maskPhoneNumber(cleanPhone);
    const deliveryNote = getSmsDeliveryNote(maskedPhone);
    const smsTargetPhone = normalizePhoneForSms(cleanPhone);
    if (!smsTargetPhone) {
      return c.json({ success: false, error: 'Geçerli bir telefon numarası gerekli.', maskedPhone, deliveryNote, smsProvider: AUTH_SMS_PROVIDER }, 400);
    }

    const smsResult = await sendVerificationSmsCode({
      toPhone: smsTargetPhone,
      code,
    });

    if (!smsResult.success) {
      console.log('[REST] send-login-code SMS send failed:', cleanPhone, smsResult.errorCode, smsResult.providerMessage);
      return c.json({ success: false, error: getNetgsmSendErrorMessage(smsResult), maskedPhone, deliveryNote, smsProvider: AUTH_SMS_PROVIDER }, 502);
    }

    recordLoginSuccess(lookupKey);
    console.log('[REST] send-login-code success:', cleanPhone, 'type:', actualType, 'requestedType:', requestedType, 'maskedPhone:', maskedPhone, 'messageId:', smsResult.messageId);
    return c.json({ success: true, error: null, maskedPhone, deliveryNote, smsProvider: AUTH_SMS_PROVIDER, actualType });
  } catch (err: any) {
    console.log('[REST] send-login-code error:', err?.message ?? err);
    return c.json({ success: false, error: 'SMS kodu gönderilemedi. Lütfen tekrar deneyin.', maskedPhone: null, deliveryNote: getSmsDeliveryNote(null), smsProvider: AUTH_SMS_PROVIDER }, 500);
  }
});

app.post("/auth/verify-login-code", async (c) => {
  try {
    const body = await c.req.json().catch((): Record<string, unknown> => ({})) as Record<string, any>;
    const requestDbConfig = resolveRequestDbConfig(c, body);
    await recoverAuthStoreForRequest('verify-login-code', requestDbConfig.endpoint, requestDbConfig.namespace, requestDbConfig.token);

    const requestedType: 'customer' | 'driver' = body.type === 'driver' ? 'driver' : 'customer';
    const cleanPhone = normalizeTurkishPhone(typeof body.phone === 'string' ? body.phone : '');
    const inputCode = typeof body.code === 'string' ? body.code.trim() : '';

    const phoneValidationError = getTurkishPhoneValidationError(cleanPhone);
    if (phoneValidationError) {
      return c.json({ success: false, error: phoneValidationError, user: null, token: null }, 400);
    }

    if (!inputCode) {
      return c.json({ success: false, error: 'Doğrulama kodu gerekli', user: null, token: null }, 400);
    }

    const { user, driver, source } = await loadAuthAccountByPhone(cleanPhone);
    console.log('[REST] verify-login-code account resolution:', cleanPhone, 'type:', requestedType, 'source:', source, 'user:', !!user, 'driver:', !!driver);

    let account = requestedType === 'driver' ? driver : user;
    let actualType = requestedType;
    if (!account) {
      const crossTypeAccount = requestedType === 'driver' ? user : driver;
      if (crossTypeAccount) {
        account = crossTypeAccount;
        actualType = requestedType === 'driver' ? 'customer' : 'driver';
        console.log('[REST] verify-login-code cross-type fallback:', cleanPhone, 'requested:', requestedType, 'found:', actualType);
      }
    }
    if (!account) {
      return c.json({
        success: false,
        error: 'Bu telefon numarasıyla kayıtlı hesap bulunamadı. Lütfen kayıt olduğunuz telefon numarasını kontrol edin.',
        user: null,
        token: null,
      });
    }

    if (actualType === 'driver' && driver?.isSuspended) {
      return c.json({ success: false, error: 'Hesabınız askıya alınmıştır. Yönetici ile iletişime geçin.', user: null, token: null }, 403);
    }

    const codeKey = `login_${actualType}_${cleanPhone}`;
    let stored = await db.resetCodes.getAsync(codeKey);
    console.log('[REST] verify-login-code lookup:', codeKey, 'found:', !!stored);

    if (!stored && actualType !== requestedType) {
      const altCodeKey = `login_${requestedType}_${cleanPhone}`;
      stored = await db.resetCodes.getAsync(altCodeKey);
      console.log('[REST] verify-login-code alt lookup:', altCodeKey, 'found:', !!stored);
      if (stored) {
        db.resetCodes.delete(altCodeKey);
        db.resetCodes.set(codeKey, stored.code);
        stored = await db.resetCodes.getAsync(codeKey);
      }
    }

    if (!stored) {
      return c.json({ success: false, error: 'Doğrulama kodu bulunamadı veya süresi dolmuş.', user: null, token: null });
    }

    if (stored.attempts >= 5) {
      db.resetCodes.delete(codeKey);
      return c.json({ success: false, error: 'Çok fazla hatalı deneme. Yeni kod talep edin.', user: null, token: null }, 429);
    }

    if (stored.code !== inputCode) {
      await db.resetCodes.incrementAttemptsAsync(codeKey);
      return c.json({ success: false, error: 'Doğrulama kodu hatalı.', user: null, token: null }, 400);
    }

    db.resetCodes.delete(codeKey);

    const sessionToken = generateSecureToken(64);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const sessionRecord: Session = {
      token: sessionToken,
      userId: account.id,
      userType: actualType,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await db.sessions.setSync(sessionToken, sessionRecord);
    await persistSessionDirect(sessionRecord);

    console.log('[REST] verify-login-code success:', account.id, actualType, 'phone:', cleanPhone);
    return c.json({ success: true, error: null, user: { ...account, type: actualType }, token: sessionToken });
  } catch (err: any) {
    console.log('[REST] verify-login-code error:', err?.message ?? err);
    return c.json({ success: false, error: 'Giriş doğrulanamadı. Lütfen tekrar deneyin.', user: null, token: null }, 500);
  }
});

app.post("/auth/login", async (c) => {
  try {
    const body = await c.req.json().catch((): Record<string, unknown> => ({})) as Record<string, any>;
    const requestDbConfig = resolveRequestDbConfig(c, body);
    await recoverAuthStoreForRequest('login', requestDbConfig.endpoint, requestDbConfig.namespace, requestDbConfig.token);
    const storageMode = getCurrentStorageMode();
    const persistentStore = getPersistentStoreStatus();
    const loadedUsers = db.users.getAll().length;
    const loadedDrivers = db.drivers.getAll().length;

    console.log('[REST] login:', body.email, 'type:', body.type, 'dbReady:', _dbReady, 'storageMode:', storageMode, 'users:', loadedUsers, 'drivers:', loadedDrivers, 'snapshotAvailable:', persistentStore.available);

    const cleanEmail = (body.email || '').toLowerCase().trim();
    if (!cleanEmail || !body.password) return c.json({ success: false, error: 'E-posta ve şifre gerekli', user: null, token: null });

    const loginCheck = checkLoginAttempt(cleanEmail);
    if (!loginCheck.allowed) {
      const mins = Math.ceil((loginCheck.lockedUntil - Date.now()) / 60000);
      return c.json({ success: false, error: `Çok fazla başarısız giriş. ${mins} dk sonra deneyin.`, user: null, token: null });
    }

    const { passwordHash: storedHash, user, driver, source } = await loadAuthAccountByEmail(cleanEmail);
    console.log('[REST] login account resolution:', cleanEmail, 'source:', source, 'hasHash:', !!storedHash, 'user:', !!user, 'driver:', !!driver);

    if (!user && !driver) {
      const authStoreUnavailable = storageMode === 'memory' && !isDbConfigured() && !persistentStore.available && loadedUsers === 0 && loadedDrivers === 0;
      recordLoginFailure(cleanEmail);
      if (authStoreUnavailable) {
        console.log('[REST] login blocked - auth store unavailable for cross-device login:', cleanEmail);
        return c.json({ success: false, error: 'Giriş sistemi şu anda hazırlanıyor. Lütfen biraz sonra tekrar deneyin.', user: null, token: null });
      }
      return c.json({ success: false, error: 'Kullanıcı bulunamadı. Lütfen kayıt olduğunuz e-posta adresini kontrol edin.', user: null, token: null });
    }

    if (!storedHash) {
      recordLoginFailure(cleanEmail);
      console.log('[REST] login missing password hash for existing account:', cleanEmail, 'user:', !!user, 'driver:', !!driver, 'source:', source, 'dbReady:', _dbReady);
      return c.json({ success: false, error: 'Hesap bulundu ancak şifre kaydı eksik. Lütfen Şifremi Unuttum ile yeni şifre oluşturun.', user: null, token: null });
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
    const sessionRecord: Session = {
      token: sessionToken,
      userId: account.id,
      userType: accountType,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await db.sessions.setSync(sessionToken, sessionRecord);
    await persistSessionDirect(sessionRecord);

    console.log('[REST] Login OK:', account.id, accountType, 'dbConfigured:', isDbConfigured(), 'dbReady:', _dbReady);
    return c.json({ success: true, error: null, user: { ...account, type: accountType }, token: sessionToken });
  } catch (err: any) {
    console.log('[REST] login error:', err?.message);
    return c.json({ success: false, error: 'Giriş hatası. Tekrar deneyin.', user: null, token: null }, 500);
  }
});

app.post("/auth/repair-account", async (c) => {
  try {
    const body = await c.req.json().catch((): Record<string, unknown> => ({}));
    const requestDbConfig = resolveRequestDbConfig(c, body);
    await recoverAuthStoreForRequest('repair-account', requestDbConfig.endpoint, requestDbConfig.namespace, requestDbConfig.token);

    const cleanEmail = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const accountType: 'customer' | 'driver' = body.type === 'driver' ? 'driver' : 'customer';
    const accountPayload = typeof body.account === 'object' && body.account !== null
      ? body.account as Record<string, unknown>
      : null;

    if (!cleanEmail || !password || !accountPayload) {
      return c.json({ success: false, error: 'Hesap onarımı için kayıtlı bilgiler eksik', user: null, token: null }, 400);
    }

    const repairedAccount = await repairAuthAccountFromBackup({
      email: cleanEmail,
      password,
      type: accountType,
      account: accountPayload,
    });

    console.log('[REST] repair-account OK:', cleanEmail, 'type:', repairedAccount.accountType, 'repaired:', repairedAccount.repaired);
    return c.json({
      success: true,
      error: null,
      user: { ...repairedAccount.account, type: repairedAccount.accountType },
      token: repairedAccount.token,
      repaired: repairedAccount.repaired,
    });
  } catch (err: any) {
    console.log('[REST] repair-account error:', err?.message ?? err);
    return c.json({ success: false, error: err?.message || 'Hesap onarılamadı', user: null, token: null }, 400);
  }
});

app.post("/auth/session", async (c) => {
  try {
    const authHeader = c.req.header('authorization');
    const body = await c.req.json().catch((): Record<string, unknown> => ({}));
    const requestDbConfig = resolveRequestDbConfig(c, body);
    await recoverAuthStoreForRequest('session', requestDbConfig.endpoint, requestDbConfig.namespace, requestDbConfig.token);

    const tokenFromBody = typeof body.token === 'string' ? body.token.trim() : '';
    const tokenFromHeader = authHeader?.replace('Bearer ', '').trim() ?? '';
    const sessionToken = tokenFromBody || tokenFromHeader;

    if (!sessionToken) {
      return c.json({ valid: false, error: 'Oturum bulunamadı', user: null, userType: null }, 401);
    }

    const session = await resolveValidSession(sessionToken);
    if (!session) {
      return c.json({ valid: false, error: 'Oturum geçersiz veya süresi dolmuş', user: null, userType: null }, 401);
    }

    const account = await hydrateSessionAccount(session);
    if (!account) {
      db.sessions.delete(sessionToken);
      return c.json({ valid: false, error: 'Hesap bulunamadı', user: null, userType: null }, 401);
    }

    return c.json({
      valid: true,
      error: null,
      user: { ...account, type: session.userType },
      userType: session.userType,
      session: {
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      },
    });
  } catch (err: any) {
    console.log('[REST] session error:', err?.message ?? err);
    return c.json({ valid: false, error: 'Oturum doğrulanamadı', user: null, userType: null }, 500);
  }
});

app.post("/auth/send-reset-code", async (c) => {
  try {
    const body = await c.req.json().catch((): Record<string, unknown> => ({})) as Record<string, any>;
    const requestDbConfig = resolveRequestDbConfig(c, body);
    await recoverAuthStoreForRequest('send-reset-code', requestDbConfig.endpoint, requestDbConfig.namespace, requestDbConfig.token);

    const rawIdentifier = typeof body.contact === 'string' && body.contact.trim()
      ? body.contact
      : typeof body.phone === 'string' && body.phone.trim()
        ? body.phone
        : body.email;
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
    const deliveryMethod = 'sms';
    if (!identifier) return c.json({ success: false, error: 'E-posta veya telefon numarası gerekli' });

    console.log('[REST] send-reset-code:', identifier, 'deliveryMethod:', deliveryMethod);
    const { checkLoginAttempt, recordLoginFailure, recordLoginSuccess } = await import('./utils/security');

    const resetLookupKey = buildResetLookupKey(identifier);
    const loginCheck = checkLoginAttempt(resetLookupKey);
    if (!loginCheck.allowed) {
      return c.json({ success: false, error: 'Çok fazla deneme. Lütfen daha sonra tekrar deneyin.' });
    }

    const resolvedAccount = await resolveResetAccountWithDirectLookup(identifier);
    const account = resolvedAccount.account;
    const accountEmail = resolvedAccount.emailKey;
    let hasPassword = accountEmail ? db.passwords.get(accountEmail) : null;

    if (!hasPassword && accountEmail) {
      try {
        const { dbSearchPasswordByEmail } = await import('./db/rork-db');
        const passwordResult = await dbSearchPasswordByEmail(accountEmail);
        if (passwordResult?.hash) {
          hasPassword = passwordResult.hash;
          db.passwords.set(accountEmail, passwordResult.hash);
        }
      } catch (e) {
        console.log('[REST] send-reset-code password lookup err:', e);
      }
    }

    if (!account || !accountEmail) {
      recordLoginFailure(resetLookupKey);
      return c.json({
        success: false,
        error: resolvedAccount.identifierType === 'phone'
          ? 'Bu telefon numarasıyla kayıtlı hesap bulunamadı'
          : 'Bu e-posta adresiyle kayıtlı hesap bulunamadı',
      });
    }

    console.log('[REST] send-reset-code final account state:', accountEmail, 'hasPassword:', !!hasPassword, 'accountType:', account.type);

    const code = generateAuthCode();
    db.resetCodes.set(accountEmail, code);
    console.log('[REST] send-reset-code stored code for:', accountEmail, 'identifier:', identifier);

    const maskedPhone = maskPhoneNumber(typeof account.phone === 'string' ? account.phone : undefined);
    const smsTargetPhone = normalizePhoneForSms(typeof account.phone === 'string' ? account.phone : undefined);
    const directDeliveryNote = getSmsDeliveryNote(maskedPhone);

    if (!smsTargetPhone) {
      console.log('[REST] Reset code missing SMS target phone:', accountEmail);
      return c.json({
        success: false,
        error: 'Kayıtlı telefon numarası bulunamadı. Lütfen destek ile iletişime geçin.',
        emailSent: false,
        deliveryChannel: 'sms',
        maskedPhone,
        smsTargetPhone: null,
        deliveryNote: directDeliveryNote,
      });
    }

    const smsResult = await sendPasswordResetSmsCode({
      toPhone: smsTargetPhone,
      code,
    });

    if (!smsResult.success) {
      console.log('[REST] SMS reset delivery failed:', accountEmail, smsResult.errorCode, smsResult.providerMessage);
      return c.json({
        success: false,
        error: getNetgsmSendErrorMessage(smsResult),
        emailSent: false,
        deliveryChannel: 'sms',
        maskedPhone,
        smsTargetPhone,
        deliveryNote: directDeliveryNote,
      });
    }

    recordLoginSuccess(resetLookupKey);
    console.log('[REST] Reset code sent via SMS:', accountEmail, 'maskedPhone:', maskedPhone, 'messageId:', smsResult.messageId);
    return c.json({
      success: true,
      error: null,
      emailSent: false,
      deliveryChannel: 'sms',
      maskedPhone,
      smsTargetPhone,
      deliveryNote: directDeliveryNote,
    });
  } catch (err: unknown) {
    console.log('[REST] send-reset-code error:', err instanceof Error ? err.message : err);
    return c.json({ success: false, error: 'Bir hata oluştu. Lütfen tekrar deneyin.' }, 500);
  }
});

app.post("/auth/verify-reset-code", async (c) => {
  try {
    const body = await c.req.json().catch((): Record<string, unknown> => ({})) as Record<string, any>;
    const requestDbConfig = resolveRequestDbConfig(c, body);
    await recoverAuthStoreForRequest('verify-reset-code', requestDbConfig.endpoint, requestDbConfig.namespace, requestDbConfig.token);

    const rawIdentifier = typeof body.contact === 'string' && body.contact.trim()
      ? body.contact
      : typeof body.phone === 'string' && body.phone.trim()
        ? body.phone
        : body.email;
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
    const inputCode = typeof body.code === 'string' ? body.code.trim() : '';
    if (!identifier || !inputCode) return c.json({ success: false, error: 'E-posta veya telefon numarası ile kod gerekli' });

    const resolvedAccount = await resolveResetAccountWithDirectLookup(identifier);
    let accountEmail = resolvedAccount.emailKey;

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
    const body = await c.req.json().catch((): Record<string, unknown> => ({})) as Record<string, any>;
    const requestDbConfig = resolveRequestDbConfig(c, body);
    await recoverAuthStoreForRequest('reset-password', requestDbConfig.endpoint, requestDbConfig.namespace, requestDbConfig.token);

    const rawIdentifier = typeof body.contact === 'string' && body.contact.trim()
      ? body.contact
      : typeof body.phone === 'string' && body.phone.trim()
        ? body.phone
        : body.email;
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : '';
    const inputCode = typeof body.code === 'string' ? body.code.trim() : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!identifier || !inputCode || !newPassword) return c.json({ success: false, error: 'Tüm alanlar gerekli' });

    const resolvedAccount = await resolveResetAccountWithDirectLookup(identifier);
    let accountEmail = resolvedAccount.emailKey;

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
    await persistPasswordHashDirect(accountEmail, hashedPwd);
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
    const authHeader = c.req.header('authorization') || c.req.header('Authorization') || '';
    const body = await c.req.json().catch((): Record<string, unknown> => ({})) as Record<string, any>;
    const requestDbConfig = resolveRequestDbConfig(c, body);
    await ensureDbReady(requestDbConfig.endpoint, requestDbConfig.namespace, requestDbConfig.token);

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
    const dbEp = c.req.header('x-db-endpoint');
    const dbNs = c.req.header('x-db-namespace');
    const dbTk = c.req.header('x-db-token');
    await recoverAuthStoreForRequest('logout', dbEp, dbNs, dbTk);

    const authHeader = c.req.header('authorization');
    const body = await c.req.json().catch((): Record<string, unknown> => ({}));
    const tokenFromBody = typeof body.token === 'string' ? body.token.trim() : '';
    const tokenFromHeader = authHeader?.replace('Bearer ', '').trim() ?? '';
    const sessionToken = tokenFromBody || tokenFromHeader;

    if (sessionToken) {
      db.sessions.delete(sessionToken);
      console.log('[REST] Session invalidated for current token only');
    } else {
      console.log('[REST] Logout called without a session token');
    }

    return c.json({ success: true });
  } catch (err: any) {
    console.log('[REST] logout error:', err?.message ?? err);
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
      console.log('[SERVER] bootstrap-db: no config from body/headers/env, trying snapshot recovery...');
      const persistentStore = getPersistentStoreStatus();
      if (persistentStore.available && db.users.getAll().length === 0 && db.drivers.getAll().length === 0) {
        try {
          await reinitializeStore();
          console.log('[SERVER] bootstrap-db: snapshot recovery attempted, users:', db.users.getAll().length, 'drivers:', db.drivers.getAll().length);
        } catch (e) {
          console.log('[SERVER] bootstrap-db: snapshot recovery error:', e);
        }
      }
      return c.json({
        success: isDbConfigured() || db.users.getAll().length > 0 || db.drivers.getAll().length > 0,
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
