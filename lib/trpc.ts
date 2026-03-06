import { httpLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import * as SecureStore from "expo-secure-store";

import type { AppRouter } from "@/backend/trpc/app-router";

export const trpc = createTRPCReact<AppRouter>();

const SESSION_TOKEN_KEY = "session_token";

export async function getSessionToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  } catch (e) {
    console.log("[TRPC] Error reading session token:", e);
    return null;
  }
}

export async function setSessionToken(token: string | null): Promise<void> {
  try {
    if (token) {
      await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
      console.log("[TRPC] Session token saved");
    } else {
      await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
      console.log("[TRPC] Session token cleared");
    }
  } catch (e) {
    console.log("[TRPC] Error saving session token:", e);
  }
}

let _resolvedBaseUrl: string | null = null;

let _circuitOpen = false;
let _circuitOpenUntil = 0;
let _consecutiveFailures = 0;
const CIRCUIT_THRESHOLD = 10;
const CIRCUIT_COOLDOWN_MS = 8000;

function isCircuitOpen(): boolean {
  if (!_circuitOpen) return false;
  if (Date.now() > _circuitOpenUntil) {
    _circuitOpen = false;
    _consecutiveFailures = 0;
    console.log('[TRPC] Circuit breaker reset (cooldown expired)');
    return false;
  }
  return true;
}

function recordSuccess(): void {
  _consecutiveFailures = 0;
  if (_circuitOpen) {
    _circuitOpen = false;
    console.log('[TRPC] Circuit breaker closed (success)');
  }
}

function recordFailure(): void {
  _consecutiveFailures++;
  if (_consecutiveFailures >= CIRCUIT_THRESHOLD && !_circuitOpen) {
    _circuitOpen = true;
    _circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.log('[TRPC] Circuit breaker OPEN - too many failures, cooling down for', CIRCUIT_COOLDOWN_MS / 1000, 's');
  }
}

export function resetCircuitBreaker(): void {
  _circuitOpen = false;
  _circuitOpenUntil = 0;
  _consecutiveFailures = 0;
  console.log('[TRPC] Circuit breaker manually reset');
}

let _resolvedFromEnv = false;

function resolveBaseUrl(): string {
  if (_resolvedBaseUrl && _resolvedFromEnv) return _resolvedBaseUrl;

  let result = '';
  let fromEnv = false;

  const apiBase = process.env.EXPO_PUBLIC_RORK_API_BASE_URL;
  const toolkitUrl = process.env.EXPO_PUBLIC_TOOLKIT_URL;
  const projectId = process.env.EXPO_PUBLIC_PROJECT_ID;
  const teamId = process.env.EXPO_PUBLIC_TEAM_ID;

  if (!_resolvedBaseUrl) {
    console.log('[TRPC] resolveBaseUrl - apiBase:', apiBase ? apiBase.substring(0, 50) : 'EMPTY', 'toolkit:', toolkitUrl ? toolkitUrl.substring(0, 50) : 'EMPTY', 'projId:', projectId || 'EMPTY', 'teamId:', teamId || 'EMPTY');
  }

  if (apiBase && apiBase.trim()) {
    result = apiBase.trim().replace(/\/+$/, '');
    fromEnv = true;
  } else if (toolkitUrl && toolkitUrl.trim()) {
    result = toolkitUrl.trim().replace(/\/toolkit\/?$/, '').replace(/\/+$/, '');
    fromEnv = true;
  } else if (projectId && teamId) {
    result = `https://${projectId}-${teamId}.rork.app`;
    fromEnv = true;
  }

  if (!result) {
    try {
      if (typeof window !== 'undefined' && window.location && window.location.origin) {
        const origin = window.location.origin;
        if (origin && origin !== 'null') {
          result = origin;
        }
      }
    } catch (e) {
      console.log('[TRPC] window.location fallback error:', e);
    }
  }

  if (result) {
    if (!_resolvedBaseUrl || (fromEnv && !_resolvedFromEnv)) {
      console.log('[TRPC] Base URL resolved:', result.substring(0, 80), fromEnv ? '(env)' : '(fallback)');
    }
    _resolvedBaseUrl = result;
    _resolvedFromEnv = fromEnv;
  } else {
    console.log('[TRPC] WARNING: Could not resolve base URL from any source');
  }

  return result;
}

export const getBaseUrl = (): string => {
  return resolveBaseUrl();
};

export const clearBaseUrlCache = (): void => {
  _resolvedBaseUrl = null;
  _resolvedFromEnv = false;
};

export const waitForBaseUrl = async (maxWaitMs = 10000): Promise<string> => {
  const existing = resolveBaseUrl();
  if (existing) return existing;

  _resolvedBaseUrl = null;
  _resolvedFromEnv = false;
  const start = Date.now();
  let interval = 300;
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, interval));
    _resolvedBaseUrl = null;
    _resolvedFromEnv = false;
    const url = resolveBaseUrl();
    if (url) {
      console.log('[TRPC] Base URL available after', Date.now() - start, 'ms:', url.substring(0, 60));
      return url;
    }
    interval = Math.min(interval + 200, 800);
  }

  console.log('[TRPC] Base URL not available after', maxWaitMs, 'ms - trying window.location final fallback');
  _resolvedBaseUrl = null;
  _resolvedFromEnv = false;
  try {
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      const origin = window.location.origin;
      if (origin && origin !== 'null') {
        _resolvedBaseUrl = origin;
        console.log('[TRPC] Final fallback to window.location.origin:', origin.substring(0, 60));
        return origin;
      }
    }
  } catch (e) {
    console.log('[TRPC] Final fallback error:', e);
  }
  return resolveBaseUrl();
};

function requestInfoToUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.url;
  }
  return '';
}

async function fetchWithTimeout(url: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  if (isCircuitOpen()) {
    console.log('[TRPC] Circuit open, but allowing auth requests through');
  }

  const urlStr = requestInfoToUrlString(url);
  const isAuthRequest = urlStr.includes('register') || urlStr.includes('login') || urlStr.includes('auth');
  const isBootstrap = urlStr.includes('bootstrap');
  const TIMEOUT_MS = isAuthRequest ? 30000 : isBootstrap ? 15000 : 15000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const { signal: _ignoredSignal, ...restOptions } = options || {};
    const response = await fetch(url, {
      ...restOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.status === 429 || response.status === 503 || response.status === 502) {
      console.log('[TRPC] Server overloaded, status:', response.status);
      recordFailure();
      throw new Error('Sunucu meşgul. Lütfen 30 saniye bekleyip tekrar deneyin.');
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json') && response.status !== 204) {
      const peek = await response.clone().text();
      if (peek.includes('<!DOCTYPE html>') || peek.includes('Service Temporarily Unavailable')) {
        console.log('[TRPC] Got HTML instead of JSON (server overloaded)');
        recordFailure();
        throw new Error('Sunucu geçici olarak kullanılamıyor. Lütfen 30 saniye bekleyip tekrar deneyin.');
      }
    }

    recordSuccess();
    return response;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.message?.includes('Sunucu')) {
      throw err;
    }
    recordFailure();
    throw err;
  }
}

function buildFullUrl(inputUrl: RequestInfo | URL): string {
  const base = resolveBaseUrl();
  const resolvedInput = requestInfoToUrlString(inputUrl);

  if (!resolvedInput) {
    return base ? `${base}/api/trpc` : '/api/trpc';
  }

  if (resolvedInput.startsWith('http://') || resolvedInput.startsWith('https://')) {
    if (!base) {
      return resolvedInput;
    }
    try {
      const urlObj = new URL(resolvedInput);
      const pathname = urlObj.pathname + urlObj.search;
      if (pathname.startsWith('/api/')) {
        return `${base}${pathname}`;
      }
    } catch (e) {
      console.log('[TRPC] buildFullUrl parse error:', e);
    }
    return resolvedInput;
  }

  if (base) {
    const path = resolvedInput.startsWith('/') ? resolvedInput : `/${resolvedInput}`;
    return `${base}${path}`;
  }

  return resolvedInput;
}

export function getTrpcUrl(): string {
  const base = resolveBaseUrl();
  if (base) return `${base}/api/trpc`;
  return '/api/trpc';
}

export const trpcClient = trpc.createClient({
  links: [
    httpLink({
      url: '/api/trpc',
      transformer: superjson,
      async headers() {
        const headers: Record<string, string> = {};
        const token = await getSessionToken();
        if (token) {
          headers['authorization'] = `Bearer ${token}`;
        }
        const dbEndpoint = process.env.EXPO_PUBLIC_RORK_DB_ENDPOINT;
        const dbNamespace = process.env.EXPO_PUBLIC_RORK_DB_NAMESPACE;
        const dbToken = process.env.EXPO_PUBLIC_RORK_DB_TOKEN;
        if (dbEndpoint && dbNamespace && dbToken) {
          headers['x-db-endpoint'] = dbEndpoint;
          headers['x-db-namespace'] = dbNamespace;
          headers['x-db-token'] = dbToken;
        }
        return headers;
      },
      fetch: async (url: RequestInfo | URL, options?: RequestInit) => {
        const resolved = buildFullUrl(url);
        console.log('[TRPC] fetch ->', resolved.substring(0, 120));
        return fetchWithTimeout(resolved, options);
      },
    }),
  ],
});
