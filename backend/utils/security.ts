const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const loginAttemptMap = new Map<string, { count: number; lockedUntil: number }>();
const suspiciousIPs = new Map<string, number>();

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 200;
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_LOCK_DURATION = 5 * 60 * 1000;
const SUSPICIOUS_THRESHOLD = 500;
const SUSPICIOUS_BLOCK_DURATION = 10 * 60 * 1000;

export function getClientIP(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIP = req.headers.get("x-real-ip");
  if (realIP) return realIP;
  return "unknown";
}

export function checkRateLimit(identifier: string, maxRequests: number = RATE_LIMIT_MAX): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(identifier, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, retryAfter: 0 };
  }

  if (entry.count >= maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    console.log(`[SECURITY] Rate limit exceeded for: ${identifier}, retry after: ${retryAfter}s`);
    return { allowed: false, retryAfter };
  }

  entry.count++;
  return { allowed: true, retryAfter: 0 };
}

export function checkLoginAttempt(email: string): { allowed: boolean; remainingAttempts: number; lockedUntil: number } {
  const now = Date.now();
  const entry = loginAttemptMap.get(email);

  if (!entry) {
    return { allowed: true, remainingAttempts: LOGIN_MAX_ATTEMPTS, lockedUntil: 0 };
  }

  if (entry.lockedUntil > now) {
    const remainingLock = Math.ceil((entry.lockedUntil - now) / 1000);
    console.log(`[SECURITY] Login locked for: ${email}, remaining: ${remainingLock}s`);
    return { allowed: false, remainingAttempts: 0, lockedUntil: entry.lockedUntil };
  }

  if (now > entry.lockedUntil && entry.lockedUntil > 0) {
    loginAttemptMap.delete(email);
    return { allowed: true, remainingAttempts: LOGIN_MAX_ATTEMPTS, lockedUntil: 0 };
  }

  return { allowed: true, remainingAttempts: LOGIN_MAX_ATTEMPTS - entry.count, lockedUntil: 0 };
}

export function recordLoginFailure(email: string): void {
  const now = Date.now();
  const entry = loginAttemptMap.get(email);

  if (!entry) {
    loginAttemptMap.set(email, { count: 1, lockedUntil: 0 });
    console.log(`[SECURITY] Login failure recorded for: ${email} (1/${LOGIN_MAX_ATTEMPTS})`);
    return;
  }

  entry.count++;
  console.log(`[SECURITY] Login failure recorded for: ${email} (${entry.count}/${LOGIN_MAX_ATTEMPTS})`);

  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOGIN_LOCK_DURATION;
    console.log(`[SECURITY] Account locked for: ${email}, duration: ${LOGIN_LOCK_DURATION / 1000}s`);
  }
}

export function recordLoginSuccess(email: string): void {
  loginAttemptMap.delete(email);
}

export function trackSuspiciousActivity(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(`suspicious_${ip}`);

  if (!entry) {
    rateLimitMap.set(`suspicious_${ip}`, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return false;
  }

  if (now > entry.resetAt) {
    rateLimitMap.set(`suspicious_${ip}`, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return false;
  }

  entry.count++;
  if (entry.count >= SUSPICIOUS_THRESHOLD) {
    suspiciousIPs.set(ip, now + SUSPICIOUS_BLOCK_DURATION);
    console.log(`[SECURITY] IP temporarily flagged as suspicious: ${ip}`);
    return true;
  }

  return false;
}

export function isIPBlocked(ip: string): boolean {
  const blockedUntil = suspiciousIPs.get(ip);
  if (!blockedUntil) return false;
  if (Date.now() > blockedUntil) {
    suspiciousIPs.delete(ip);
    console.log(`[SECURITY] IP block expired for: ${ip}`);
    return false;
  }
  return true;
}

export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .replace(/data:text\/html/gi, '')
    .replace(/vbscript:/gi, '')
    .trim();
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) return false;
  if (email.length > 254) return false;
  if (email.includes('..')) return false;
  return true;
}

export function validatePassword(password: string): { valid: boolean; reason: string } {
  if (password.length < 8) {
    return { valid: false, reason: "Şifre en az 8 karakter olmalıdır" };
  }
  if (password.length > 128) {
    return { valid: false, reason: "Şifre çok uzun" };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, reason: "Şifre en az bir büyük harf içermelidir" };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, reason: "Şifre en az bir küçük harf içermelidir" };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, reason: "Şifre en az bir rakam içermelidir" };
  }
  return { valid: true, reason: "" };
}

export function generateSecureToken(length: number = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let token = 'stk_';
  for (let i = 0; i < length; i++) {
    token += chars[array[i] % chars.length];
  }
  return token;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + password + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'sha256_' + salt + '_' + hashHex;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith('sha256_')) {
    const parts = storedHash.split('_');
    if (parts.length < 3) return false;
    const salt = parts[1];
    const encoder = new TextEncoder();
    const data = encoder.encode(salt + password + salt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
    return storedHash === 'sha256_' + salt + '_' + hashHex;
  }
  if (storedHash.startsWith('h_')) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return storedHash === 'h_' + Math.abs(hash).toString(36);
  }
  return false;
}

export function generateSalt(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

setInterval(() => {
  const now = Date.now();
  let rateLimitCleaned = 0;
  let loginCleaned = 0;
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt + 60000) {
      rateLimitMap.delete(key);
      rateLimitCleaned++;
    }
  }
  for (const [key, entry] of loginAttemptMap.entries()) {
    if (entry.lockedUntil > 0 && now > entry.lockedUntil + 60000) {
      loginAttemptMap.delete(key);
      loginCleaned++;
    } else if (entry.lockedUntil === 0 && entry.count > 0) {
      loginAttemptMap.delete(key);
      loginCleaned++;
    }
  }
  for (const [ip, blockedUntil] of suspiciousIPs.entries()) {
    if (now > blockedUntil) {
      suspiciousIPs.delete(ip);
      console.log(`[SECURITY] Cleaned up expired IP block: ${ip}`);
    }
  }
  if (rateLimitCleaned > 0 || loginCleaned > 0) {
    console.log(`[SECURITY] Cleanup: rateLimitMap=${rateLimitMap.size} loginAttemptMap=${loginAttemptMap.size} suspiciousIPs=${suspiciousIPs.size}`);
  }
}, 5 * 60 * 1000);
