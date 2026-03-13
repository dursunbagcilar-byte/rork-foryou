import type { Session } from "../db/types";

const SIGNED_SESSION_PREFIX = "rss_";
const DEFAULT_SESSION_SECRET = "qqd36vuy6c1tv9jy9gc6g:rork-session:v1";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function readRuntimeValue(key: string): string {
  try {
    const bunEnv = (globalThis as any).Bun?.env as Record<string, string | undefined> | undefined;
    const bunValue = typeof bunEnv?.[key] === "string" ? bunEnv[key]?.trim() ?? "" : "";
    if (bunValue) {
      return bunValue;
    }
  } catch {}

  try {
    const denoRuntime = (globalThis as any).Deno;
    if (denoRuntime?.env?.get) {
      const value = denoRuntime.env.get(key);
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  } catch {}

  try {
    if (typeof process !== "undefined" && process.env) {
      const value = (process.env as Record<string, string | undefined>)[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  } catch {}

  return "";
}

function getSessionSecret(): string {
  return readRuntimeValue("RORK_SESSION_SECRET")
    || readRuntimeValue("EXPO_PUBLIC_RORK_APP_KEY")
    || readRuntimeValue("EXPO_PUBLIC_PROJECT_ID")
    || DEFAULT_SESSION_SECRET;
}

function toBase64UrlFromBytes(bytes: Uint8Array): string {
  try {
    const bufferCtor = (globalThis as any).Buffer;
    if (bufferCtor) {
      return bufferCtor.from(bytes).toString("base64url");
    }
  } catch {}

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const encoded = btoa(binary);
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toBase64UrlFromString(value: string): string {
  try {
    const bufferCtor = (globalThis as any).Buffer;
    if (bufferCtor) {
      return bufferCtor.from(value, "utf8").toString("base64url");
    }
  } catch {}

  const encoded = new TextEncoder().encode(value);
  return toBase64UrlFromBytes(encoded);
}

function fromBase64UrlToString(value: string): string {
  try {
    const bufferCtor = (globalThis as any).Buffer;
    if (bufferCtor) {
      return bufferCtor.from(value, "base64url").toString("utf8");
    }
  } catch {}

  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function signPayload(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${getSessionSecret()}.${payload}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toBase64UrlFromBytes(new Uint8Array(digest));
}

interface SignedSessionPayload {
  userId: string;
  userType: "customer" | "driver";
  createdAt: string;
  expiresAt: string;
}

export async function createSignedSessionRecord(userId: string, userType: "customer" | "driver"): Promise<Session> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const payload: SignedSessionPayload = {
    userId,
    userType,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const encodedPayload = toBase64UrlFromString(JSON.stringify(payload));
  const signature = await signPayload(encodedPayload);
  const token = `${SIGNED_SESSION_PREFIX}${encodedPayload}.${signature}`;

  return {
    token,
    userId,
    userType,
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
  };
}

export async function parseSignedSessionToken(token: string): Promise<Session | null> {
  if (!token.startsWith(SIGNED_SESSION_PREFIX)) {
    return null;
  }

  const rawValue = token.slice(SIGNED_SESSION_PREFIX.length);
  const separatorIndex = rawValue.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return null;
  }

  const encodedPayload = rawValue.slice(0, separatorIndex);
  const providedSignature = rawValue.slice(separatorIndex + 1);
  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = await signPayload(encodedPayload);
  if (expectedSignature !== providedSignature) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64UrlToString(encodedPayload)) as Partial<SignedSessionPayload>;
    const userId = typeof parsed.userId === "string" ? parsed.userId : "";
    const userType = parsed.userType === "driver" ? "driver" : parsed.userType === "customer" ? "customer" : null;
    const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : "";
    const expiresAt = typeof parsed.expiresAt === "string" ? parsed.expiresAt : "";

    if (!userId || !userType || !createdAt || !expiresAt) {
      return null;
    }

    const expiresAtMs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
      return null;
    }

    return {
      token,
      userId,
      userType,
      createdAt,
      expiresAt,
    };
  } catch (error) {
    console.log("[SESSION] parseSignedSessionToken error:", error);
    return null;
  }
}
