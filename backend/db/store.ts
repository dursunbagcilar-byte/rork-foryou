import type { User, Driver, Ride, Rating, Message, Payment, Session, PushToken, Notification, DriverDocuments, Referral } from "./types";
import { dbLoadAll, dbUpsert, dbDelete, dbGet, isDbConfigured, setDbConfig, reapplyDbConfig, getCachedDbConfig, flushPendingOps, getPendingOpsCount } from "./rork-db";

const users = new Map<string, User>();
const drivers = new Map<string, Driver>();
const rides = new Map<string, Ride>();
const ratings = new Map<string, Rating>();
const driverLocations = new Map<string, { latitude: number; longitude: number; updatedAt: number }>();
const passwords = new Map<string, string>();
const messages = new Map<string, Message[]>();
const payments = new Map<string, Payment>();
const sessions = new Map<string, Session>();
const pushTokens = new Map<string, PushToken>();
const notifications = new Map<string, Notification>();
const driverDocuments = new Map<string, DriverDocuments>();
const driverEmailIndex = new Map<string, string>();
const resetCodes = new Map<string, { code: string; expiresAt: number; attempts: number }>();
const messageReadStatus = new Map<string, string>();
const scheduledRides = new Map<string, any>();
const referrals = new Map<string, Referral>();
const referralCodeIndex = new Map<string, string>();

let _initialized = false;
let _initPromise: Promise<void> | null = null;
let _dbWasConfigured = false;
let _lastDbCheckTime = 0;

function cleanSurrealId(raw: any, fallbackField?: string): string {
  if (!raw) return '';
  
  if (typeof raw === 'object' && raw !== null) {
    if (raw.tb && raw.id !== undefined) {
      const innerId = raw.id;
      if (typeof innerId === 'object' && innerId !== null) {
        if (innerId.String) return String(innerId.String);
        if (innerId.id) return cleanSurrealId(innerId);
        return JSON.stringify(innerId);
      }
      return String(innerId);
    }
    if (raw.id !== undefined) {
      if (typeof raw.id === 'object' && raw.id !== null) {
        return cleanSurrealId(raw.id);
      }
      const idStr = String(raw.id);
      if (idStr.includes(':')) {
        return stripSurrealPrefix(idStr);
      }
      return idStr;
    }
    const stringified = String(raw);
    if (stringified !== '[object Object]' && stringified.includes(':')) {
      return stripSurrealPrefix(stringified);
    }
    return fallbackField || '';
  }
  
  const str = String(raw);
  if (str.includes(':')) {
    return stripSurrealPrefix(str);
  }
  return str;
}

function recoverOriginalId(record: any, table: string): string {
  if (record.rorkId && typeof record.rorkId === 'string') {
    return record.rorkId;
  }
  if (record._originalId && typeof record._originalId === 'string') {
    return record._originalId;
  }
  
  const cleanedId = cleanSurrealId(record.id);
  if (cleanedId && cleanedId !== '[object Object]' && !cleanedId.startsWith('{')) {
    return cleanedId;
  }
  
  if (record.email) {
    const fallbackId = table.charAt(0) + '_recovered_' + record.email.replace(/[^a-zA-Z0-9]/g, '_');
    console.log(`[STORE] Using email-based fallback ID for ${table}:`, fallbackId);
    return fallbackId;
  }
  
  return '';
}

function stripSurrealPrefix(str: string): string {
  let cleaned = str.split(':').slice(1).join(':');
  cleaned = cleaned.replace(/^[`⟨\u27E8\u2329<]|[`⟩\u27E9\u232A>]$/g, '');
  return cleaned || str;
}

async function loadFromDb(): Promise<void> {
  if (!isDbConfigured()) {
    console.log('[STORE] Rork DB not configured, using in-memory only');
    return;
  }

  console.log('[STORE] Loading data from Rork DB...');

  try {
    const [dbUsers, dbDrivers, dbRides, dbRatings, dbPasswords, dbPayments, dbMessages, dbLocations, dbSessions, dbPushTokens, dbNotifications, dbDriverDocs] = await Promise.all([
      dbLoadAll<User>('users'),
      dbLoadAll<Driver>('drivers'),
      dbLoadAll<Ride>('rides'),
      dbLoadAll<Rating>('ratings'),
      dbLoadAll<{ email: string; hash: string }>('passwords'),
      dbLoadAll<Payment>('payments'),
      dbLoadAll<{ rideId: string; messages: Message[] }>('ride_messages'),
      dbLoadAll<{ driverId: string; latitude: number; longitude: number; updatedAt: number }>('driver_locations'),
      dbLoadAll<Session>('sessions'),
      dbLoadAll<PushToken>('push_tokens'),
      dbLoadAll<Notification>('notifications'),
      dbLoadAll<DriverDocuments>('driver_documents'),
    ]);

    console.log('[STORE] Raw DB counts - users:', dbUsers.length, 'drivers:', dbDrivers.length, 'passwords:', dbPasswords.length, 'sessions:', dbSessions.length);

    for (const u of dbUsers) {
      const id = recoverOriginalId(u, 'users');
      if (id) {
        u.id = id;
        delete (u as any)._originalId;
        users.set(id, u);
        if (u.referralCode) {
          referralCodeIndex.set(u.referralCode.toUpperCase(), id);
        }
        console.log('[STORE] Loaded user:', id, u.name, u.email);
      }
    }
    for (const d of dbDrivers) {
      let id = recoverOriginalId(d, 'drivers');
      if (!id && d.email) {
        id = 'd_recovered_' + d.email.replace(/[^a-zA-Z0-9]/g, '_');
        console.log('[STORE] Using email-based fallback ID for driver:', id, d.email);
      }
      if (id) {
        d.id = id;
        delete (d as any)._originalId;
        drivers.set(id, d);
        if (d.email) driverEmailIndex.set(d.email.toLowerCase(), id);
        console.log('[STORE] Loaded driver:', id, d.name, d.email, 'approved:', d.isApproved);
      } else {
        console.log('[STORE] WARN: Could not recover driver ID, raw:', JSON.stringify(d.id), 'name:', d.name);
      }
    }
    for (const r of dbRides) {
      const id = cleanSurrealId(r.id);
      if (id) {
        r.id = id;
        rides.set(id, r);
      }
    }
    for (const rt of dbRatings) {
      const id = cleanSurrealId(rt.id);
      if (id) {
        rt.id = id;
        ratings.set(id, rt);
      }
    }
    for (const p of dbPasswords) {
      const email = (p as any)._originalEmail || p.email;
      if (email) passwords.set(email, p.hash);
    }
    for (const pay of dbPayments) {
      const token = cleanSurrealId(pay.token) || pay.token;
      if (token) {
        pay.token = token;
        payments.set(token, pay);
      }
    }
    for (const m of dbMessages) {
      if (m.rideId) messages.set(m.rideId, m.messages || []);
    }
    for (const loc of dbLocations) {
      if (loc.driverId) driverLocations.set(loc.driverId, {
        latitude: loc.latitude,
        longitude: loc.longitude,
        updatedAt: loc.updatedAt,
      });
    }
    for (const s of dbSessions) {
      const token = (s as any)._originalToken || s.token;
      if (token) {
        s.token = token;
        delete (s as any)._originalToken;
        sessions.set(token, s);
      }
    }
    for (const pt of dbPushTokens) {
      if (pt.userId) pushTokens.set(pt.userId, pt);
    }
    for (const n of dbNotifications) {
      const id = cleanSurrealId(n.id);
      if (id) {
        n.id = id;
        notifications.set(id, n);
      }
    }
    for (const doc of dbDriverDocs) {
      const driverId = (doc as any).rorkDriverId || (doc as any)._originalDriverId || doc.driverId;
      if (driverId) {
        doc.driverId = driverId;
        delete (doc as any)._originalDriverId;
        driverDocuments.set(driverId, doc);
      }
    }

    console.log(`[STORE] Loaded from DB: ${users.size} users, ${drivers.size} drivers, ${rides.size} rides, ${ratings.size} ratings, ${passwords.size} passwords, ${payments.size} payments, ${sessions.size} sessions`);
  } catch (err) {
    console.log('[STORE] Error loading from DB, continuing with in-memory:', err);
  }
}

async function secureHash(password: string): Promise<string> {
  const saltArray = new Uint8Array(16);
  crypto.getRandomValues(saltArray);
  const salt = Array.from(saltArray).map(b => b.toString(16).padStart(2, '0')).join('');
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'sha256_' + salt + '_' + hashHex;
}

async function seedAdminAccount(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@2go.app';
  const adminPassword = process.env.ADMIN_PASSWORD || '';

  if (!adminPassword) {
    console.log('[STORE] ADMIN_PASSWORD env not set, skipping admin seed');
    return;
  }

  const existingDriver = db.drivers.getByEmail(adminEmail);
  if (!existingDriver) {
    const adminId = 'd_admin_1';
    const adminDriver = {
      id: adminId,
      name: 'Admin',
      phone: '05551234567',
      email: adminEmail,
      type: 'driver' as const,
      vehiclePlate: '34 ADM 001',
      vehicleModel: 'Admin Araç',
      vehicleColor: 'Siyah',
      rating: 5.0,
      totalRides: 0,
      isOnline: false,
      isApproved: true,
      approvedAt: new Date().toISOString(),
      partnerDriverName: '',
      dailyEarnings: 0,
      weeklyEarnings: 0,
      monthlyEarnings: 0,
      city: 'İstanbul',
      district: 'Bağcılar',
      createdAt: new Date().toISOString(),
    };
    db.drivers.set(adminId, adminDriver);
    const hashedPwd = await secureHash(adminPassword);
    db.passwords.set(adminEmail, hashedPwd);
    console.log('[STORE] Admin account seeded:', adminEmail);
  } else {
    const storedHash = passwords.get(adminEmail);
    if (!storedHash) {
      const hashedPwd = await secureHash(adminPassword);
      db.passwords.set(adminEmail, hashedPwd);
      console.log('[STORE] Admin password re-seeded');
    }
    console.log('[STORE] Admin account already exists:', existingDriver.id);
  }
}

function tryRecoverDbConfig(): boolean {
  if (isDbConfigured()) return true;
  
  const reapplied = reapplyDbConfig();
  if (reapplied && isDbConfigured()) {
    console.log('[STORE] DB config recovered from rork-db cache');
    return true;
  }
  
  const cached = getCachedDbConfig();
  if (cached) {
    setDbConfig(cached.endpoint, cached.namespace, cached.token);
    if (isDbConfigured()) {
      console.log('[STORE] DB config recovered from getCachedDbConfig');
      return true;
    }
  }
  
  try {
    const d = (globalThis as any).Deno;
    if (d?.env?.get) {
      const ep = d.env.get('EXPO_PUBLIC_RORK_DB_ENDPOINT') || d.env.get('RORK_DB_ENDPOINT') || '';
      const ns = d.env.get('EXPO_PUBLIC_RORK_DB_NAMESPACE') || d.env.get('RORK_DB_NAMESPACE') || '';
      const tk = d.env.get('EXPO_PUBLIC_RORK_DB_TOKEN') || d.env.get('RORK_DB_TOKEN') || '';
      if (ep && ns && tk) {
        setDbConfig(ep, ns, tk);
        console.log('[STORE] DB config recovered from Deno.env');
        return true;
      }
    }
  } catch {}
  try {
    if (typeof process !== 'undefined' && process.env) {
      const ep = process.env.EXPO_PUBLIC_RORK_DB_ENDPOINT || '';
      const ns = process.env.EXPO_PUBLIC_RORK_DB_NAMESPACE || '';
      const tk = process.env.EXPO_PUBLIC_RORK_DB_TOKEN || '';
      if (ep && ns && tk) {
        setDbConfig(ep, ns, tk);
        console.log('[STORE] DB config recovered from process.env');
        return true;
      }
    }
  } catch {}
  return isDbConfigured();
}

export async function initializeStore(): Promise<void> {
  if (_initialized) {
    if (!_dbWasConfigured && isDbConfigured()) {
      console.log('[STORE] DB config now available after init, loading from DB...');
      _dbWasConfigured = true;
      try {
        await loadFromDb();
        await seedAdminAccount();
        const pendingCount = getPendingOpsCount();
        if (pendingCount > 0) {
          console.log(`[STORE] Flushing ${pendingCount} pending ops after late DB config...`);
          await flushPendingOps();
        }
        console.log('[STORE] Late DB load complete - drivers:', drivers.size, 'users:', users.size);
      } catch (err) {
        console.log('[STORE] Late DB load error:', err);
        _dbWasConfigured = false;
      }
      return;
    }
    const now = Date.now();
    if (!_dbWasConfigured && (now - _lastDbCheckTime > 2000)) {
      _lastDbCheckTime = now;
      const configured = tryRecoverDbConfig();
      if (configured && !_dbWasConfigured) {
        console.log('[STORE] DB became available via env retry, reloading...');
        _dbWasConfigured = true;
        try {
          await loadFromDb();
          await seedAdminAccount();
          const pendingCount = getPendingOpsCount();
          if (pendingCount > 0) {
            console.log(`[STORE] Flushing ${pendingCount} pending ops after env retry...`);
            await flushPendingOps();
          }
          console.log('[STORE] Late DB load complete - drivers:', drivers.size, 'users:', users.size);
        } catch (err) {
          console.log('[STORE] Late env retry load error:', err);
          _dbWasConfigured = false;
        }
      }
    }
    return;
  }
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      tryRecoverDbConfig();
      await loadFromDb();
      _dbWasConfigured = isDbConfigured();
      await seedAdminAccount();
      _initialized = true;
      _lastDbCheckTime = Date.now();
      if (_dbWasConfigured) {
        const pendingCount = getPendingOpsCount();
        if (pendingCount > 0) {
          console.log(`[STORE] Flushing ${pendingCount} pending ops during init...`);
          await flushPendingOps();
        }
      }
      console.log('[STORE] Initialization complete, dbConfigured:', _dbWasConfigured, 'drivers:', drivers.size, 'users:', users.size);
    } catch (err) {
      await seedAdminAccount();
      _initialized = true;
      _lastDbCheckTime = Date.now();
      console.log('[STORE] Initialization failed, using in-memory:', err);
    }
  })();

  return _initPromise;
}

export async function bootstrapDbConfig(endpoint: string, namespace: string, token: string): Promise<boolean> {
  const wasConfigured = isDbConfigured();
  const result = setDbConfig(endpoint, namespace, token);
  if (!result) return false;
  
  if (!wasConfigured && isDbConfigured()) {
    console.log('[STORE] DB config bootstrapped from frontend, loading data...');
    _dbWasConfigured = true;
    await loadFromDb();
    await seedAdminAccount();
    console.log('[STORE] Bootstrap load complete - users:', users.size, 'drivers:', drivers.size);
    return true;
  }
  return result;
}

export async function reinitializeStore(): Promise<void> {
  console.log('[STORE] Full reinitialize requested... dbConfigured:', isDbConfigured());
  _initialized = false;
  _initPromise = null;
  _dbWasConfigured = false;
  _lastDbCheckTime = 0;
  tryRecoverDbConfig();
  return initializeStore();
}

export async function forceReloadStore(): Promise<void> {
  console.log('[STORE] Force reloading from DB...');

  if (!isDbConfigured()) {
    console.log('[STORE] DB not configured during force reload, trying reapply...');
    const reapplied = reapplyDbConfig();
    if (reapplied) {
      console.log('[STORE] DB config reapplied from cache');
    } else {
      const cached = getCachedDbConfig();
      if (cached) {
        setDbConfig(cached.endpoint, cached.namespace, cached.token);
        console.log('[STORE] DB config set from getCachedDbConfig');
      } else {
        try {
          const d = (globalThis as any).Deno;
          if (d?.env?.get) {
            const dEndpoint = d.env.get('EXPO_PUBLIC_RORK_DB_ENDPOINT') || d.env.get('RORK_DB_ENDPOINT') || '';
            const dNamespace = d.env.get('EXPO_PUBLIC_RORK_DB_NAMESPACE') || d.env.get('RORK_DB_NAMESPACE') || '';
            const dToken = d.env.get('EXPO_PUBLIC_RORK_DB_TOKEN') || d.env.get('RORK_DB_TOKEN') || '';
            if (dEndpoint && dNamespace && dToken) {
              setDbConfig(dEndpoint, dNamespace, dToken);
              console.log('[STORE] DB config recovered from Deno.env');
            }
          }
        } catch (e) {
          console.log('[STORE] Deno env read failed:', e);
        }
        try {
          const endpoint = process.env.EXPO_PUBLIC_RORK_DB_ENDPOINT || '';
          const namespace = process.env.EXPO_PUBLIC_RORK_DB_NAMESPACE || '';
          const token = process.env.EXPO_PUBLIC_RORK_DB_TOKEN || '';
          if (endpoint && namespace && token) {
            setDbConfig(endpoint, namespace, token);
            console.log('[STORE] DB config recovered from process.env');
          }
        } catch (e) {
          console.log('[STORE] process.env read failed:', e);
        }
      }
    }
    if (!isDbConfigured()) {
      console.log('[STORE] DB still not configured after all retries, skipping force reload');
      return;
    }
  }
  
  const memDrivers = new Map(drivers);
  const memUsers = new Map(users);
  const memPasswords = new Map(passwords);
  const memSessions = new Map(sessions);
  const memDriverDocs = new Map(driverDocuments);

  const memDriversByEmail = new Map<string, string>();
  for (const [id, d] of memDrivers) {
    if (d.email) memDriversByEmail.set(d.email.toLowerCase(), id);
  }
  const memUsersByEmail = new Map<string, string>();
  for (const [id, u] of memUsers) {
    if (u.email) memUsersByEmail.set(u.email.toLowerCase(), id);
  }

  console.log('[STORE] Memory counts before reload - drivers:', memDrivers.size, 'users:', memUsers.size, 'passwords:', memPasswords.size);
  
  try {
    const [dbUsers, dbDrivers, dbPasswords, dbSessions, dbDriverDocs] = await Promise.all([
      dbLoadAll<User>('users'),
      dbLoadAll<Driver>('drivers'),
      dbLoadAll<{ email: string; hash: string }>('passwords'),
      dbLoadAll<Session>('sessions'),
      dbLoadAll<DriverDocuments>('driver_documents'),
    ]);

    console.log('[STORE] DB loaded - users:', dbUsers.length, 'drivers:', dbDrivers.length, 'passwords:', dbPasswords.length);

    const processedEmails = new Set<string>();

    for (const d of dbDrivers) {
      let id = (d as any).rorkId || (d as any)._originalId;
      if (!id || typeof id !== 'string') {
        id = recoverOriginalId(d, 'drivers');
      }
      if (!id && d.email) {
        id = memDriversByEmail.get(d.email.toLowerCase());
        if (id) console.log('[STORE] Recovered driver ID from memory by email:', id, d.email);
      }
      if (!id && d.email) {
        id = 'd_recovered_' + d.email.replace(/[^a-zA-Z0-9]/g, '_');
        console.log('[STORE] Generated fallback ID for driver:', id, d.email);
      }
      if (!id) {
        console.log('[STORE] WARN: Could not recover driver ID, raw:', JSON.stringify(d.id), 'name:', d.name);
        continue;
      }

      d.id = id;
      delete (d as any)._originalId;
      delete (d as any).rorkId;

      if (d.email) processedEmails.add(d.email.toLowerCase());

      const memDriver = memDrivers.get(id);
      const memDriverByEmail = d.email ? memDrivers.get(memDriversByEmail.get(d.email.toLowerCase()) || '') : undefined;
      const bestMemDriver = memDriver || memDriverByEmail;
      const bestMemId = memDriver ? id : (memDriverByEmail ? memDriversByEmail.get(d.email.toLowerCase())! : null);

      if (bestMemDriver) {
        const useId = memDriver ? id : bestMemId!;
        const merged = { ...d, id: useId };
        if (bestMemDriver.isApproved === true) {
          merged.isApproved = true;
          merged.approvedAt = bestMemDriver.approvedAt || merged.approvedAt;
        }
        if (bestMemDriver.isSuspended !== undefined) {
          merged.isSuspended = bestMemDriver.isSuspended;
        }
        if (bestMemDriver.isOnline !== undefined && d.isOnline === undefined) {
          merged.isOnline = bestMemDriver.isOnline;
        }
        drivers.set(useId, merged);
        memDrivers.delete(useId);
        if (bestMemId && bestMemId !== useId) memDrivers.delete(bestMemId);
        if (d.email) {
          memDriversByEmail.delete(d.email.toLowerCase());
          driverEmailIndex.set(d.email.toLowerCase(), useId);
        }
        console.log('[STORE] Merged driver from DB:', useId, d.name, d.email, 'approved:', merged.isApproved);
      } else {
        drivers.set(id, d);
        if (d.email) driverEmailIndex.set(d.email.toLowerCase(), id);
        console.log('[STORE] Loaded new driver from DB:', id, d.name, d.email, 'approved:', d.isApproved);
      }
    }

    for (const [id, driver] of memDrivers) {
      if (drivers.has(id)) continue;

      if (driver.email && processedEmails.has(driver.email.toLowerCase())) {
        const existingId = driverEmailIndex.get(driver.email.toLowerCase());
        if (existingId && drivers.has(existingId)) {
          const existing = drivers.get(existingId)!;
          if (driver.isApproved && !existing.isApproved) {
            drivers.set(existingId, { ...existing, isApproved: true, approvedAt: driver.approvedAt });
            await dbUpsert('drivers', existingId, { ...drivers.get(existingId)!, _originalId: existingId, rorkId: existingId }).catch(() => {});
            console.log('[STORE] Merged approval from memory to existing DB driver:', existingId);
          }
          continue;
        }
      }

      console.log('[STORE] Restoring in-memory driver not in DB:', id, driver.name, driver.email);
      drivers.set(id, driver);
      if (driver.email) driverEmailIndex.set(driver.email.toLowerCase(), id);
      await dbUpsert('drivers', id, { ...driver, _originalId: id, rorkId: id }).catch(() => {});
    }

    for (const u of dbUsers) {
      let id = (u as any).rorkId || (u as any)._originalId;
      if (!id || typeof id !== 'string') id = recoverOriginalId(u, 'users');
      if (!id && u.email) id = memUsersByEmail.get(u.email.toLowerCase());
      if (id) {
        u.id = id;
        delete (u as any)._originalId;
        const memUser = memUsers.get(id);
        if (memUser) {
          users.set(id, { ...u, ...memUser, id });
        } else {
          users.set(id, u);
        }
        memUsers.delete(id);
        if (u.email) {
          const emailKey = u.email.toLowerCase();
          const memIdByEmail = memUsersByEmail.get(emailKey);
          if (memIdByEmail && memIdByEmail !== id) {
            memUsers.delete(memIdByEmail);
          }
          memUsersByEmail.delete(emailKey);
        }
      }
    }
    for (const [id, user] of memUsers) {
      if (!users.has(id)) {
        let alreadyExists = false;
        if (user.email) {
          for (const [, u] of users) {
            if (u.email && u.email.toLowerCase() === user.email.toLowerCase()) {
              alreadyExists = true;
              break;
            }
          }
        }
        if (!alreadyExists) {
          users.set(id, user);
          await dbUpsert('users', id, { ...user, _originalId: id, rorkId: id }).catch(() => {});
        }
      }
    }

    for (const p of dbPasswords) {
      const email = (p as any)._originalEmail || p.email;
      if (email) passwords.set(email, p.hash);
    }
    for (const [email, hash] of memPasswords) {
      if (!passwords.has(email)) passwords.set(email, hash);
    }

    for (const s of dbSessions) {
      const token = (s as any)._originalToken || s.token;
      if (token) { s.token = token; delete (s as any)._originalToken; sessions.set(token, s); }
    }
    for (const [token, session] of memSessions) {
      if (!sessions.has(token)) sessions.set(token, session);
    }

    for (const doc of dbDriverDocs) {
      const driverId = (doc as any).rorkDriverId || (doc as any)._originalDriverId || doc.driverId;
      if (driverId) { doc.driverId = driverId; delete (doc as any)._originalDriverId; driverDocuments.set(driverId, doc); }
    }
    for (const [id, docs] of memDriverDocs) {
      if (!driverDocuments.has(id)) driverDocuments.set(id, docs);
    }
    
    await seedAdminAccount();
    console.log('[STORE] Force reload complete - users:', users.size, 'drivers:', drivers.size, 'sessions:', sessions.size, 'passwords:', passwords.size);
  } catch (err) {
    console.log('[STORE] Force reload error, restoring ALL memory data:', err);
    for (const [id, d] of memDrivers) if (!drivers.has(id)) drivers.set(id, d);
    for (const [id, u] of memUsers) if (!users.has(id)) users.set(id, u);
    for (const [e, h] of memPasswords) if (!passwords.has(e)) passwords.set(e, h);
    for (const [t, s] of memSessions) if (!sessions.has(t)) sessions.set(t, s);
    for (const [id, docs] of memDriverDocs) if (!driverDocuments.has(id)) driverDocuments.set(id, docs);
    await seedAdminAccount();
  }
}

function persistInBackground(fn: () => Promise<void>): void {
  fn().catch(err => {
    console.log('[STORE] Background persist error:', err);
  });
}

async function persistSync(fn: () => Promise<void>): Promise<void> {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (!isDbConfigured()) {
        tryRecoverDbConfig();
        if (!isDbConfigured()) {
          if (attempt < maxRetries) {
            console.log(`[STORE] persistSync: DB not configured, waiting before retry ${attempt}/${maxRetries}...`);
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
            continue;
          }
          console.log(`[STORE] persistSync: DB not configured after ${maxRetries} attempts, data is in memory only`);
          return;
        }
      }
      await fn();
      if (attempt > 1) console.log(`[STORE] Sync persist succeeded on attempt ${attempt}`);
      return;
    } catch (err) {
      console.log(`[STORE] Sync persist error attempt ${attempt}/${maxRetries}:`, err);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
      } else {
        console.log('[STORE] Sync persist failed, data is in memory only');
      }
    }
  }
}

export const db = {
  users: {
    get: (id: string) => users.get(id),
    set: (id: string, user: User) => {
      users.set(id, user);
      persistInBackground(() => dbUpsert('users', id, { ...user, _originalId: id, rorkId: id }));
    },
    setSync: async (id: string, user: User) => {
      users.set(id, user);
      await persistSync(() => dbUpsert('users', id, { ...user, _originalId: id, rorkId: id }));
    },
    getByPhone: (phone: string) => Array.from(users.values()).find(u => u.phone === phone),
    getByEmail: (email: string) => {
      const lower = email.toLowerCase().trim();
      const found = Array.from(users.values()).find(u => u.email?.toLowerCase().trim() === lower);
      console.log('[STORE] users.getByEmail lookup:', lower, 'found:', found ? found.id : 'NOT FOUND', 'total users:', users.size);
      return found;
    },
    getAll: () => Array.from(users.values()),
    delete: (id: string) => {
      const user = users.get(id);
      if (user) {
        users.delete(id);
        persistInBackground(() => dbDelete('users', id));
        if (user.email) {
          passwords.delete(user.email);
          persistInBackground(() => dbDelete('passwords', user.email.replace(/[^a-zA-Z0-9]/g, '_')));
        }
      }
    },
  },
  drivers: {
    get: (id: string) => drivers.get(id),
    set: (id: string, driver: Driver) => {
      drivers.set(id, driver);
      if (driver.email) driverEmailIndex.set(driver.email.toLowerCase(), id);
      persistInBackground(() => dbUpsert('drivers', id, { ...driver, _originalId: id, rorkId: id }));
    },
    setSync: async (id: string, driver: Driver) => {
      drivers.set(id, driver);
      if (driver.email) driverEmailIndex.set(driver.email.toLowerCase(), id);
      await persistSync(() => dbUpsert('drivers', id, { ...driver, _originalId: id, rorkId: id }));
    },
    getByPhone: (phone: string) => Array.from(drivers.values()).find(d => d.phone === phone),
    getByEmail: (email: string) => {
      const indexed = driverEmailIndex.get(email.toLowerCase());
      if (indexed) {
        const d = drivers.get(indexed);
        if (d) return d;
      }
      return Array.from(drivers.values()).find(d => d.email?.toLowerCase() === email.toLowerCase());
    },
    getOnlineByCity: (city: string) =>
      Array.from(drivers.values()).filter(d => d.isOnline && d.city === city),
    getCouriersByCity: (city: string) =>
      Array.from(drivers.values()).filter(d => d.city === city && d.driverCategory === 'courier'),
    getCouriersByCityAndDistrict: (city: string, district: string) =>
      Array.from(drivers.values()).filter(d => d.city === city && d.district === district && d.driverCategory === 'courier'),
    getOnlineCouriersByCity: (city: string) =>
      Array.from(drivers.values()).filter(d => d.isOnline && d.city === city && d.driverCategory === 'courier'),
    getOnlineCouriersByCityAndDistrict: (city: string, district: string) =>
      Array.from(drivers.values()).filter(d => d.isOnline && d.city === city && d.district === district && d.driverCategory === 'courier'),
    getAll: () => Array.from(drivers.values()),
    delete: (id: string) => {
      const driver = drivers.get(id);
      if (driver) {
        drivers.delete(id);
        if (driver.email) driverEmailIndex.delete(driver.email.toLowerCase());
        persistInBackground(() => dbDelete('drivers', id));
        driverDocuments.delete(id);
        persistInBackground(() => dbDelete('driver_documents', id));
        driverLocations.delete(id);
        persistInBackground(() => dbDelete('driver_locations', id));
        if (driver.email) {
          passwords.delete(driver.email);
          persistInBackground(() => dbDelete('passwords', driver.email.replace(/[^a-zA-Z0-9]/g, '_')));
        }
      }
    },
  },
  rides: {
    get: (id: string) => rides.get(id),
    set: (id: string, ride: Ride) => {
      rides.set(id, ride);
      persistInBackground(() => dbUpsert('rides', id, ride));
    },
    setSync: async (id: string, ride: Ride) => {
      rides.set(id, ride);
      await persistSync(() => dbUpsert('rides', id, ride));
    },
    getByCustomer: (customerId: string) =>
      Array.from(rides.values())
        .filter(r => r.customerId === customerId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    getByDriver: (driverId: string) =>
      Array.from(rides.values())
        .filter(r => r.driverId === driverId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    getPendingByCity: (city: string) =>
      Array.from(rides.values()).filter(r => r.status === "pending" && r.city === city),
    getActiveByDriver: (driverId: string) =>
      Array.from(rides.values()).find(
        r => r.driverId === driverId && ["accepted", "in_progress"].includes(r.status)
      ),
    getActiveByCustomer: (customerId: string) =>
      Array.from(rides.values()).find(
        r => r.customerId === customerId && ["pending", "accepted", "in_progress"].includes(r.status)
      ),
    getAll: () => Array.from(rides.values()),
  },
  ratings: {
    set: (id: string, rating: Rating) => {
      ratings.set(id, rating);
      persistInBackground(() => dbUpsert('ratings', id, rating));
    },
    setSync: async (id: string, rating: Rating) => {
      ratings.set(id, rating);
      await persistSync(() => dbUpsert('ratings', id, rating));
    },
    getByRide: (rideId: string) => Array.from(ratings.values()).find(r => r.rideId === rideId),
    getByDriver: (driverId: string) =>
      Array.from(ratings.values()).filter(r => r.driverId === driverId),
    getAll: () => Array.from(ratings.values()),
  },
  driverLocations: {
    get: (driverId: string) => driverLocations.get(driverId),
    set: (driverId: string, loc: { latitude: number; longitude: number }) => {
      const data = { ...loc, updatedAt: Date.now() };
      driverLocations.set(driverId, data);
      persistInBackground(() => dbUpsert('driver_locations', driverId, { driverId, ...data }));
    },
    getAll: () => driverLocations,
  },
  passwords: {
    get: (email: string) => passwords.get(email),
    set: (email: string, hash: string) => {
      passwords.set(email, hash);
      persistInBackground(() => dbUpsert('passwords', email.replace(/[^a-zA-Z0-9]/g, '_'), { email, hash, _originalEmail: email }));
    },
    setSync: async (email: string, hash: string) => {
      passwords.set(email, hash);
      await persistSync(() => dbUpsert('passwords', email.replace(/[^a-zA-Z0-9]/g, '_'), { email, hash, _originalEmail: email }));
    },
  },
  messages: {
    getByRide: (rideId: string) => messages.get(rideId) ?? [],
    addToRide: (rideId: string, msg: Message) => {
      const existing = messages.get(rideId) ?? [];
      existing.push(msg);
      messages.set(rideId, existing);
      persistInBackground(() => dbUpsert('ride_messages', rideId, { rideId, messages: existing }));
    },
  },
  payments: {
    get: (token: string) => payments.get(token),
    set: (token: string, payment: Payment) => {
      payments.set(token, payment);
      persistInBackground(() => dbUpsert('payments', token.replace(/[^a-zA-Z0-9]/g, '_'), payment));
    },
    setSync: async (token: string, payment: Payment) => {
      payments.set(token, payment);
      await persistSync(() => dbUpsert('payments', token.replace(/[^a-zA-Z0-9]/g, '_'), payment));
    },
    getByRide: (rideId: string) =>
      Array.from(payments.values()).find(p => p.rideId === rideId) ?? null,
    getAll: () => Array.from(payments.values()),
  },
  sessions: {
    get: (token: string) => sessions.get(token),
    set: (token: string, session: Session) => {
      sessions.set(token, session);
      persistInBackground(() => dbUpsert('sessions', token.replace(/[^a-zA-Z0-9]/g, '_'), { ...session, _originalToken: token }));
    },
    setSync: async (token: string, session: Session) => {
      sessions.set(token, session);
      await persistSync(() => dbUpsert('sessions', token.replace(/[^a-zA-Z0-9]/g, '_'), { ...session, _originalToken: token }));
    },
    getByUserId: (userId: string) => Array.from(sessions.values()).find(s => s.userId === userId),
    delete: (token: string) => {
      sessions.delete(token);
      persistInBackground(() => dbDelete('sessions', token.replace(/[^a-zA-Z0-9]/g, '_')));
    },
    isValid: (token: string): boolean => {
      const session = sessions.get(token);
      if (!session) return false;
      if (new Date(session.expiresAt).getTime() < Date.now()) {
        sessions.delete(token);
        console.log('[STORE] Session expired and cleaned:', session.userId);
        return false;
      }
      return true;
    },
  },
  pushTokens: {
    get: (userId: string) => pushTokens.get(userId),
    set: (userId: string, pushToken: PushToken) => {
      pushTokens.set(userId, pushToken);
      persistInBackground(() => dbUpsert('push_tokens', userId.replace(/[^a-zA-Z0-9]/g, '_'), pushToken));
    },
    delete: (userId: string) => {
      pushTokens.delete(userId);
      persistInBackground(() => dbDelete('push_tokens', userId.replace(/[^a-zA-Z0-9]/g, '_')));
    },
    getAll: () => Array.from(pushTokens.values()),
  },
  notifications: {
    get: (id: string) => notifications.get(id),
    set: (id: string, notification: Notification) => {
      notifications.set(id, notification);
      persistInBackground(() => dbUpsert('notifications', id, notification));
    },
    getByUser: (userId: string) =>
      Array.from(notifications.values())
        .filter(n => n.userId === userId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    markRead: (id: string) => {
      const n = notifications.get(id);
      if (n) {
        const updated = { ...n, read: true };
        notifications.set(id, updated);
        persistInBackground(() => dbUpsert('notifications', id, updated));
      }
    },
    getAll: () => Array.from(notifications.values()),
  },
  driverDocuments: {
    get: (driverId: string) => driverDocuments.get(driverId),
    set: (driverId: string, docs: DriverDocuments) => {
      driverDocuments.set(driverId, docs);
      persistInBackground(() => dbUpsert('driver_documents', driverId, { ...docs, _originalDriverId: driverId, rorkDriverId: driverId }));
    },
    setSync: async (driverId: string, docs: DriverDocuments) => {
      driverDocuments.set(driverId, docs);
      await persistSync(() => dbUpsert('driver_documents', driverId, { ...docs, _originalDriverId: driverId, rorkDriverId: driverId }));
    },
    getAll: () => Array.from(driverDocuments.values()),
  },
  resetCodes: {
    get: (email: string) => {
      const entry = resetCodes.get(email);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        resetCodes.delete(email);
        persistInBackground(() => dbDelete('reset_codes', email.replace(/[^a-zA-Z0-9_]/g, '_')));
        return null;
      }
      return entry;
    },
    getAsync: async (email: string) => {
      const entry = resetCodes.get(email);
      if (entry) {
        if (Date.now() > entry.expiresAt) {
          resetCodes.delete(email);
          persistInBackground(() => dbDelete('reset_codes', email.replace(/[^a-zA-Z0-9_]/g, '_')));
          return null;
        }
        console.log('[STORE] resetCodes.getAsync found in memory for:', email, 'code:', entry.code);
        return entry;
      }
      try {
        const dbKey = email.replace(/[^a-zA-Z0-9_]/g, '_');
        const dbEntry = await dbGet<{ email: string; code: string; expiresAt: number; attempts: number }>('reset_codes', dbKey);
        if (dbEntry && dbEntry.code) {
          if (Date.now() > dbEntry.expiresAt) {
            persistInBackground(() => dbDelete('reset_codes', dbKey));
            console.log('[STORE] resetCodes.getAsync DB entry expired for:', email);
            return null;
          }
          const recovered = { code: dbEntry.code, expiresAt: dbEntry.expiresAt, attempts: dbEntry.attempts || 0 };
          resetCodes.set(email, recovered);
          console.log('[STORE] resetCodes.getAsync recovered from DB for:', email, 'code:', recovered.code);
          return recovered;
        }
      } catch (err) {
        console.log('[STORE] resetCodes.getAsync DB lookup error:', err);
      }
      console.log('[STORE] resetCodes.getAsync NOT FOUND for:', email);
      return null;
    },
    set: (email: string, code: string) => {
      const entry = {
        code,
        expiresAt: Date.now() + 10 * 60 * 1000,
        attempts: 0,
      };
      resetCodes.set(email, entry);
      const dbKey = email.replace(/[^a-zA-Z0-9_]/g, '_');
      persistInBackground(() => dbUpsert('reset_codes', dbKey, { email, ...entry }));
      console.log('[STORE] resetCodes.set stored for:', email, 'code:', code, 'dbKey:', dbKey);
    },
    incrementAttempts: (email: string) => {
      const entry = resetCodes.get(email);
      if (entry) {
        entry.attempts += 1;
        const dbKey = email.replace(/[^a-zA-Z0-9_]/g, '_');
        persistInBackground(() => dbUpsert('reset_codes', dbKey, { email, ...entry }));
      }
    },
    incrementAttemptsAsync: async (email: string) => {
      let entry = resetCodes.get(email);
      if (!entry) {
        try {
          const dbKey = email.replace(/[^a-zA-Z0-9_]/g, '_');
          const dbEntry = await dbGet<{ email: string; code: string; expiresAt: number; attempts: number }>('reset_codes', dbKey);
          if (dbEntry && dbEntry.code) {
            entry = { code: dbEntry.code, expiresAt: dbEntry.expiresAt, attempts: dbEntry.attempts || 0 };
            resetCodes.set(email, entry);
          }
        } catch {}
      }
      if (entry) {
        entry.attempts += 1;
        const dbKey = email.replace(/[^a-zA-Z0-9_]/g, '_');
        persistInBackground(() => dbUpsert('reset_codes', dbKey, { email, ...entry! }));
      }
    },
    delete: (email: string) => {
      resetCodes.delete(email);
      const dbKey = email.replace(/[^a-zA-Z0-9_]/g, '_');
      persistInBackground(() => dbDelete('reset_codes', dbKey));
    },
  },
  messageReadStatus: {
    get: (key: string) => messageReadStatus.get(key) ?? null,
    set: (key: string, timestamp: string) => {
      messageReadStatus.set(key, timestamp);
    },
  },
  scheduledRides: {
    get: (id: string) => scheduledRides.get(id),
    set: (id: string, ride: any) => {
      scheduledRides.set(id, ride);
      persistInBackground(() => dbUpsert('scheduled_rides', id, ride));
    },
    getByUser: (userId: string) =>
      Array.from(scheduledRides.values())
        .filter((r: any) => r.userId === userId)
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    cancel: (id: string) => {
      const ride = scheduledRides.get(id);
      if (ride) {
        const updated = { ...ride, status: 'cancelled' };
        scheduledRides.set(id, updated);
        persistInBackground(() => dbUpsert('scheduled_rides', id, updated));
      }
    },
    getAll: () => Array.from(scheduledRides.values()),
  },
  referrals: {
    get: (id: string) => referrals.get(id),
    set: (id: string, referral: Referral) => {
      referrals.set(id, referral);
      persistInBackground(() => dbUpsert('referrals', id, referral));
    },
    getByReferrer: (userId: string) =>
      Array.from(referrals.values()).filter(r => r.referrerUserId === userId),
    getByReferred: (userId: string) =>
      Array.from(referrals.values()).find(r => r.referredUserId === userId),
    getAll: () => Array.from(referrals.values()),
  },
  referralCodeIndex: {
    get: (code: string) => referralCodeIndex.get(code.toUpperCase()),
    set: (code: string, userId: string) => {
      referralCodeIndex.set(code.toUpperCase(), userId);
    },
  },
};

const _initDate = new Date();
let _lastEarningsResetDay = _initDate.toISOString().split('T')[0];
let _lastEarningsResetWeek = (() => {
  const d = new Date(Date.UTC(_initDate.getFullYear(), _initDate.getMonth(), _initDate.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
})();
let _lastEarningsResetMonth = `${_initDate.getFullYear()}-${String(_initDate.getMonth() + 1).padStart(2, '0')}`;

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export function resetDriverEarningsIfNeeded(): void {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const currentWeek = getWeekNumber(now);
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const needsDailyReset = _lastEarningsResetDay !== todayStr;
  const needsWeeklyReset = _lastEarningsResetWeek !== currentWeek;
  const needsMonthlyReset = _lastEarningsResetMonth !== currentMonth;

  if (!needsDailyReset && !needsWeeklyReset && !needsMonthlyReset) return;

  const allDrivers = db.drivers.getAll();
  for (const driver of allDrivers) {
    let updated = false;
    const changes = { ...driver };

    if (needsDailyReset && driver.dailyEarnings > 0) {
      changes.dailyEarnings = 0;
      updated = true;
    }
    if (needsWeeklyReset && driver.weeklyEarnings > 0) {
      changes.weeklyEarnings = 0;
      updated = true;
    }
    if (needsMonthlyReset && driver.monthlyEarnings > 0) {
      changes.monthlyEarnings = 0;
      updated = true;
    }

    if (updated) {
      db.drivers.set(driver.id, changes);
    }
  }

  if (needsDailyReset) {
    _lastEarningsResetDay = todayStr;
    console.log('[STORE] Daily earnings reset for all drivers');
  }
  if (needsWeeklyReset) {
    _lastEarningsResetWeek = currentWeek;
    console.log('[STORE] Weekly earnings reset for all drivers');
  }
  if (needsMonthlyReset) {
    _lastEarningsResetMonth = currentMonth;
    console.log('[STORE] Monthly earnings reset for all drivers');
  }
}

setInterval(() => {
  try {
    resetDriverEarningsIfNeeded();
  } catch (err) {
    console.log('[STORE] Earnings reset error:', err);
  }
}, 60 * 1000);
