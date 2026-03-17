import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import createContextHook from '@nkzw/create-context-hook';
import type { User, Driver, Ride, DriverDocuments } from '@/constants/mockData';
import { PRICING } from '@/constants/pricing';
import { setSessionToken, getSessionToken, getBaseUrl, normalizeApiBaseUrl, waitForBaseUrl, trpcClient } from '@/lib/trpc';
import { getDbHeaders as buildDbHeaders, getDbBootstrapPayload, getDbRequestConfigPayload } from '@/utils/db';
import { getTurkishPhoneValidationError, normalizeTurkishPhone } from '@/utils/phone';

type UserType = 'customer' | 'driver' | null;

export interface TeamMemberInfo {
  id: string;
  name: string;
  email: string;
  phone: string;
}

interface LocalAuthBackup {
  email: string;
  type: Exclude<UserType, null>;
  passwordHash: string;
  user: User | Driver;
  updatedAt: string;
}

interface LocalAuthLegacyCredentials {
  type?: Exclude<UserType, null>;
  name?: string;
  phone?: string;
  email?: string;
  gender?: 'male' | 'female';
  city?: string;
  district?: string;
  vehiclePlate?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  partnerDriverName?: string;
  licenseIssueDate?: string;
  driverCategory?: 'driver' | 'scooter' | 'courier';
}

interface RememberedLoginCredentials {
  email: string;
  password: string;
  type: Exclude<UserType, null>;
  updatedAt: string;
}

interface RememberedPhoneLogin {
  phone: string;
  type: Exclude<UserType, null>;
  updatedAt: string;
}

interface RememberedPhoneAccount {
  phone: string;
  email: string;
  type: Exclude<UserType, null>;
  updatedAt: string;
}

interface PhoneLoginResponse {
  success: boolean;
  error?: string | null;
  maskedPhone?: string | null;
  deliveryNote?: string | null;
  smsProvider?: string | null;
  actualType?: Exclude<UserType, null>;
  localAuthenticatedType?: Exclude<UserType, null>;
  localFallbackUsed?: boolean;
}

export type SocialAuthProvider = 'google' | 'apple';

interface SocialLoginPayload {
  provider: SocialAuthProvider;
  providerUserId: string;
  email?: string | null;
  name?: string | null;
  avatar?: string | null;
}

const LOCAL_AUTH_PREFIX = 'localauthbackup';
const REMEMBERED_LOGIN_PREFIX = 'remembered_login_credentials';
const REMEMBERED_PHONE_LOGIN_PREFIX = 'remembered_phone_login';
const REMEMBERED_PHONE_ACCOUNT_PREFIX = 'remembered_phone_account';

function normalizeAuthEmail(email: string): string {
  return email.toLowerCase().trim();
}

function buildLocalAuthStorageId(email: string): string {
  const normalizedEmail = normalizeAuthEmail(email);
  let hash = 2166136261;

  for (let index = 0; index < normalizedEmail.length; index += 1) {
    hash ^= normalizedEmail.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${normalizedEmail.length.toString(16)}${(hash >>> 0).toString(16)}`;
}

function buildLocalAuthKey(email: string): string {
  return `${LOCAL_AUTH_PREFIX}${buildLocalAuthStorageId(email)}`;
}

function buildRememberedLoginKey(type: Exclude<UserType, null>): string {
  return `${REMEMBERED_LOGIN_PREFIX}_${type}`;
}

function buildRememberedPhoneLoginKey(type: Exclude<UserType, null>): string {
  return `${REMEMBERED_PHONE_LOGIN_PREFIX}_${type}`;
}

function buildRememberedPhoneAccountKey(type: Exclude<UserType, null>, phone: string): string {
  return `${REMEMBERED_PHONE_ACCOUNT_PREFIX}_${type}_${normalizeTurkishPhone(phone)}`;
}

function parseRememberedLogin(raw: string): RememberedLoginCredentials | null {
  try {
    const parsed = JSON.parse(raw) as RememberedLoginCredentials;
    if (!parsed?.email || !parsed?.password || !parsed?.type) {
      return null;
    }

    return {
      ...parsed,
      email: normalizeAuthEmail(parsed.email),
    };
  } catch (error) {
    console.log('[Auth] parseRememberedLogin error:', error);
    return null;
  }
}

function parseRememberedPhoneLogin(raw: string): RememberedPhoneLogin | null {
  try {
    const parsed = JSON.parse(raw) as RememberedPhoneLogin;
    const normalizedPhone = normalizeTurkishPhone(parsed?.phone);
    if (!normalizedPhone || !parsed?.type) {
      return null;
    }

    return {
      ...parsed,
      phone: normalizedPhone,
    };
  } catch (error) {
    console.log('[Auth] parseRememberedPhoneLogin error:', error);
    return null;
  }
}

function parseRememberedPhoneAccount(raw: string): RememberedPhoneAccount | null {
  try {
    const parsed = JSON.parse(raw) as RememberedPhoneAccount;
    const normalizedPhone = normalizeTurkishPhone(parsed?.phone);
    const normalizedEmail = normalizeAuthEmail(parsed?.email ?? '');
    if (!normalizedPhone || !normalizedEmail || !parsed?.type) {
      return null;
    }

    return {
      ...parsed,
      phone: normalizedPhone,
      email: normalizedEmail,
    };
  } catch (error) {
    console.log('[Auth] parseRememberedPhoneAccount error:', error);
    return null;
  }
}

function normalizeStoredAuthUser(user: User | Driver | null | undefined): User | Driver | null {
  if (!user?.email) {
    return null;
  }

  if (user.type !== 'customer' && user.type !== 'driver') {
    return null;
  }

  return {
    ...user,
    email: normalizeAuthEmail(user.email),
    type: user.type,
  } as User | Driver;
}

function parseStoredAuthUser(raw: string): User | Driver | null {
  try {
    const parsed = JSON.parse(raw) as User | Driver;
    return normalizeStoredAuthUser(parsed);
  } catch (error) {
    console.log('[Auth] parseStoredAuthUser error:', error);
    return null;
  }
}

function parseLocalAuthBackup(raw: string): LocalAuthBackup | null {
  try {
    const parsed = JSON.parse(raw) as LocalAuthBackup;
    if (!parsed?.email || !parsed?.type || !parsed?.passwordHash || !parsed?.user) {
      return null;
    }

    return {
      ...parsed,
      email: normalizeAuthEmail(parsed.email),
      user: {
        ...parsed.user,
        email: normalizeAuthEmail(parsed.user.email),
      } as User | Driver,
    };
  } catch (error) {
    console.log('[Auth] parseLocalAuthBackup error:', error);
    return null;
  }
}

async function hashLocalPassword(password: string): Promise<string> {
  const normalizedPassword = `2go_local_auth_v1:${password}`;

  try {
    const subtleCrypto = globalThis.crypto?.subtle;
    if (subtleCrypto) {
      const encoded = new TextEncoder().encode(normalizedPassword);
      const buffer = await subtleCrypto.digest('SHA-256', encoded);
      const bytes = Array.from(new Uint8Array(buffer));
      const digest = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return `sha256:${digest}`;
    }
  } catch (error) {
    console.log('[Auth] hashLocalPassword subtle error:', error);
  }

  let hash = 2166136261;
  for (let index = 0; index < normalizedPassword.length; index += 1) {
    hash ^= normalizedPassword.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv:${(hash >>> 0).toString(16)}`;
}

function isNetworkError(msg: string): boolean {
  const lower = (msg || '').toLowerCase();
  return lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('abort') ||
    lower.includes('timeout') ||
    lower.includes('net::err') ||
    lower.includes('load failed');
}

function isSessionAuthError(msg: string): boolean {
  const lower = (msg || '').toLowerCase();
  return lower.includes('unauthorized') ||
    lower.includes('geçersiz oturum') ||
    lower.includes('oturum bulunamadı') ||
    lower.includes('oturum süresi') ||
    lower.includes('trpc auth');
}

interface BackendBootstrapStatus {
  success?: boolean;
  configured?: boolean;
  storageMode?: string;
  persistentStoreAvailable?: boolean;
  users?: number;
  drivers?: number;
  error?: string;
}

function isBackendBootstrapReady(payload: BackendBootstrapStatus | null | undefined): boolean {
  if (!payload) {
    return false;
  }

  const users = typeof payload.users === 'number' ? payload.users : 0;
  const drivers = typeof payload.drivers === 'number' ? payload.drivers : 0;
  const storageMode = payload.storageMode ?? '';
  return payload.success === true ||
    payload.configured === true ||
    storageMode === 'database' ||
    storageMode === 'snapshot' ||
    users > 0 ||
    drivers > 0;
}

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [user, setUser] = useState<User | Driver | null>(null);
  const [userType, setUserType] = useState<UserType>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [promoApplied, setPromoApplied] = useState<boolean>(false);
  const [completedRides, setCompletedRides] = useState<number>(0);
  const [rideHistory, setRideHistory] = useState<Ride[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberInfo[]>([]);
  const [driverDocuments, setDriverDocuments] = useState<DriverDocuments>({});
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [teamMemberPhotos, setTeamMemberPhotos] = useState<Record<string, string>>({});
  const [teamMemberDocuments, setTeamMemberDocuments] = useState<Record<string, DriverDocuments>>({});
  const [customVehicleImage, setCustomVehicleImage] = useState<string | null>(null);

  const [driverApproved, setDriverApproved] = useState<boolean>(false);
  const authBootstrapPromiseRef = useRef<Promise<boolean> | null>(null);
  const lastAuthBootstrapAtRef = useRef<number>(0);
  const authRepairSyncRef = useRef<Record<string, number>>({});

  const getApiBase = useCallback((): string => {
    return getBaseUrl();
  }, []);

  const getDbHeaders = useCallback((): Record<string, string> => {
    return buildDbHeaders();
  }, []);

  const ensureBackendAuthReady = useCallback(async (reason: string, force = false): Promise<boolean> => {
    const now = Date.now();
    if (!force && now - lastAuthBootstrapAtRef.current < 30000) {
      return true;
    }

    if (force && now - lastAuthBootstrapAtRef.current < 5000) {
      return true;
    }

    if (authBootstrapPromiseRef.current) {
      return authBootstrapPromiseRef.current;
    }

    authBootstrapPromiseRef.current = (async () => {
      let apiBase = getApiBase();
      if (!apiBase) {
        apiBase = await waitForBaseUrl(3000);
      }

      if (!apiBase) {
        console.log('[Auth] ensureBackendAuthReady: base URL missing for', reason);
        return false;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      try {
        const bootstrapBody = getDbBootstrapPayload();
        const response = await fetch(`${normalizeApiBaseUrl(apiBase)}/api/bootstrap-db`, {
          method: 'POST',
          headers: getDbHeaders(),
          body: JSON.stringify(bootstrapBody),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const payload = await response.json().catch(() => null) as BackendBootstrapStatus | null;

        const ready = response.ok && isBackendBootstrapReady(payload);
        const users = typeof payload?.users === 'number' ? payload.users : 0;
        const drivers = typeof payload?.drivers === 'number' ? payload.drivers : 0;

        console.log('[Auth] ensureBackendAuthReady result:', reason, 'status:', response.status, 'ready:', ready, 'storageMode:', payload?.storageMode ?? 'unknown', 'users:', users, 'drivers:', drivers, 'error:', payload?.error ?? 'none');

        if (ready) {
          lastAuthBootstrapAtRef.current = Date.now();
        }

        return ready;
      } catch (error) {
        clearTimeout(timeoutId);
        console.log('[Auth] ensureBackendAuthReady error:', reason, error);
        return false;
      } finally {
        authBootstrapPromiseRef.current = null;
      }
    })();

    return authBootstrapPromiseRef.current;
  }, [getApiBase, getDbHeaders]);

  const queueAuthPersistence = useCallback(async (label: string, tasks: Promise<unknown>[]): Promise<void> => {
    const results = await Promise.allSettled(tasks);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    if (rejected.length > 0) {
      console.log('[Auth] Critical persistence partial failure for:', label, 'failed:', rejected.length);
      rejected.forEach((result, index) => {
        console.log('[Auth] Critical persistence error detail:', label, index + 1, result.reason);
      });
      return;
    }

    console.log('[Auth] Critical persistence completed for:', label);
  }, []);

  const directFetch = useCallback(async (
    path: string,
    body: Record<string, any>,
    retryCount = 0,
    extraHeaders?: Record<string, string>
  ): Promise<any> => {
    const MAX_RETRIES = 2;
    let apiBase = getApiBase();
    if (!apiBase) {
      console.log('[Auth] directFetch: No API base, waiting...');
      apiBase = await waitForBaseUrl(5000);
    }
    if (!apiBase) {
      try {
        const projId = process.env.EXPO_PUBLIC_PROJECT_ID;
        const teamId = process.env.EXPO_PUBLIC_TEAM_ID;
        if (projId && teamId) {
          apiBase = normalizeApiBaseUrl(`https://${projId}-${teamId}.rork.app`);
        }
      } catch {}
    }
    if (!apiBase) {
      try {
        if (typeof window !== 'undefined' && window.location && window.location.origin) {
          const origin = window.location.origin;
          if (origin && origin !== 'null') {
            apiBase = normalizeApiBaseUrl(origin);
          }
        }
      } catch {}
    }
    if (!apiBase) {
      if (retryCount < MAX_RETRIES) {
        const delay = 1000;
        console.log(`[Auth] directFetch: No URL, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return directFetch(path, body, retryCount + 1, extraHeaders);
      }
      throw new Error('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
    }
    apiBase = normalizeApiBaseUrl(apiBase);
    const normalizedPath = path.startsWith('/api/')
      ? path
      : `/api${path.startsWith('/') ? path : `/${path}`}`;
    const url = `${apiBase}${normalizedPath}`;
    console.log('[Auth] directFetch POST:', url);

    const controller = new AbortController();
    const timeoutMs = 20000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const requestBody = {
        ...body,
        ...getDbRequestConfigPayload(),
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...getDbHeaders(),
          ...(extraHeaders ?? {}),
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      console.log('[Auth] directFetch status:', res.status);

      if (res.status === 404) {
        let notFoundError = '';
        let isApiResponse = false;
        try {
          const errText = await res.text();
          console.log('[Auth] directFetch 404 body:', errText.substring(0, 300));
          if (errText.trim().startsWith('{')) {
            const errData = JSON.parse(errText);
            isApiResponse = true;
            if (typeof errData?.error === 'string' && errData.error.trim()) {
              notFoundError = errData.error;
            } else if (errData?.success === false) {
              notFoundError = 'İşlem başarısız oldu.';
            }
          }
        } catch (parseError) {
          console.log('[Auth] directFetch 404 parse error:', parseError);
        }

        if (notFoundError) {
          console.log('[Auth] directFetch 404 with API error:', notFoundError);
          throw new Error(notFoundError);
        }

        if (isApiResponse) {
          throw new Error('Sunucudan beklenmeyen yanıt alındı. Lütfen tekrar deneyin.');
        }

        if (retryCount < MAX_RETRIES) {
          const delay = 1500;
          console.log(`[Auth] 404 - retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          return directFetch(path, body, retryCount + 1, extraHeaders);
        }
        throw new Error('Sunucu şu an erişilemiyor. Lütfen uygulamayı kapatıp tekrar açın.');
      }

      if (res.status === 401) {
        let authError = 'Oturumunuzun süresi dolmuş. Lütfen tekrar giriş yapın.';
        try {
          const errData = await res.json();
          if (typeof errData?.error === 'string' && errData.error.trim()) {
            authError = errData.error;
          }
        } catch (parseError) {
          console.log('[Auth] directFetch 401 parse error:', parseError);
        }
        throw new Error(authError);
      }

      if (res.status === 403) {
        let forbiddenError = 'Bu işlem için yetkiniz yok';
        try {
          const errData = await res.json();
          if (typeof errData?.error === 'string' && errData.error.trim()) {
            forbiddenError = errData.error;
          }
        } catch (parseError) {
          console.log('[Auth] directFetch 403 parse error:', parseError);
        }
        throw new Error(forbiddenError);
      }

      if (res.status === 400) {
        let badRequestError = 'İstek işlenemedi';
        try {
          const errData = await res.json();
          if (typeof errData?.error === 'string' && errData.error.trim()) {
            badRequestError = errData.error;
          }
        } catch (parseError) {
          console.log('[Auth] directFetch 400 parse error:', parseError);
        }
        throw new Error(badRequestError);
      }

      if (res.status === 429) {
        throw new Error('Sunucu meşgul. Lütfen 30 saniye bekleyip tekrar deneyin.');
      }

      if (res.status === 503 || res.status === 502) {
        let serverError = '';
        try {
          const errBody = await res.json();
          if (errBody?.error) serverError = errBody.error;
        } catch {}
        console.log('[Auth] directFetch 503/502 error:', res.status, serverError, 'retry:', retryCount);
        if (retryCount < MAX_RETRIES) {
          const delay = 2000 + (retryCount * 1000);
          await new Promise(r => setTimeout(r, delay));
          return directFetch(path, body, retryCount + 1, extraHeaders);
        }
        throw new Error(serverError || 'Sunucu geçici olarak kullanılamıyor. Lütfen tekrar deneyin.');
      }

      if (res.status >= 500) {
        let serverMsg = '';
        try {
          const errData = await res.json();
          if (errData?.error) serverMsg = errData.error;
          if (errData?.success === false && errData?.error) {
            throw new Error(errData.error);
          }
        } catch (parseErr: any) {
          if (parseErr?.message && !parseErr.message.includes('JSON')) throw parseErr;
        }
        if (retryCount < MAX_RETRIES) {
          const delay = 1500;
          await new Promise(r => setTimeout(r, delay));
          return directFetch(path, body, retryCount + 1, extraHeaders);
        }
        throw new Error(serverMsg || 'Sunucu geçici bir hata yaşıyor. Lütfen tekrar deneyin.');
      }

      const contentType = res.headers.get('content-type') || '';
      const responseText = await res.text();

      if (!contentType.includes('application/json') && responseText.includes('<!DOCTYPE html>')) {
        if (retryCount < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1500));
          return directFetch(path, body, retryCount + 1, extraHeaders);
        }
        throw new Error('Sunucu geçici olarak kullanılamıyor. Lütfen tekrar deneyin.');
      }

      console.log('[Auth] directFetch response:', responseText.substring(0, 300));

      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch {
        console.log('[Auth] directFetch JSON parse error, raw:', responseText.substring(0, 200), 'status:', res.status, 'retry:', retryCount);
        if (retryCount < MAX_RETRIES) {
          const delay = 2000 + (retryCount * 1000);
          await new Promise(r => setTimeout(r, delay));
          return directFetch(path, body, retryCount + 1, extraHeaders);
        }
        throw new Error('Sunucu geçersiz bir yanıt döndürdü. Lütfen birkaç saniye bekleyip tekrar deneyin.');
      }

      return data;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === 'AbortError') {
        if (retryCount < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000));
          return directFetch(path, body, retryCount + 1, extraHeaders);
        }
        throw new Error('Sunucu yanıt vermedi (zaman aşımı). Lütfen tekrar deneyin.');
      }

      const errorMessage = err?.message || '';
      if (isNetworkError(errorMessage)) {
        if (retryCount < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000));
          return directFetch(path, body, retryCount + 1, extraHeaders);
        }
        throw new Error('Sunucuya şu an ulaşılamıyor. İnternet bağlantınızı kontrol edip tekrar deneyin.');
      }

      if (err instanceof Error) throw err;
      throw new Error('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
    }
  }, [getApiBase, getDbHeaders]);

  const directAuthorizedFetch = useCallback(async (path: string, body: Record<string, any>): Promise<any> => {
    const token = await getSessionToken();
    if (!token) {
      throw new Error('Oturumunuzun süresi dolmuş. Lütfen tekrar giriş yapın.');
    }

    return directFetch(path, body, 0, {
      authorization: `Bearer ${token}`,
    });
  }, [directFetch]);

  const setAuthenticatedLocalUser = useCallback(async (localUser: User | Driver, source: string): Promise<UserType> => {
    const normalizedLocalUser = normalizeStoredAuthUser(localUser);
    if (!normalizedLocalUser) {
      throw new Error('Yerel oturum verisi okunamadı');
    }

    await setSessionToken(null);
    setUser(normalizedLocalUser);
    setUserType(normalizedLocalUser.type);
    setIsAuthenticated(true);
    await AsyncStorage.setItem('auth_user', JSON.stringify(normalizedLocalUser));
    console.log('[Auth] Local auth session restored from', source, 'for:', normalizedLocalUser.email, 'type:', normalizedLocalUser.type);
    return normalizedLocalUser.type;
  }, []);

  const restoreCachedAuthUser = useCallback(async (fallbackStoredUser: string | null, source: string): Promise<boolean> => {
    try {
      const rawStoredUser = fallbackStoredUser ?? await AsyncStorage.getItem('auth_user');
      if (!rawStoredUser) {
        console.log('[Auth] No cached auth_user found for:', source);
        return false;
      }

      const parsedStoredUser = parseStoredAuthUser(rawStoredUser);
      if (!parsedStoredUser) {
        console.log('[Auth] Cached auth_user payload invalid for:', source);
        await AsyncStorage.removeItem('auth_user');
        return false;
      }

      await setSessionToken(null);
      setUser(parsedStoredUser);
      setUserType(parsedStoredUser.type);
      setIsAuthenticated(true);
      await AsyncStorage.setItem('auth_user', JSON.stringify(parsedStoredUser));
      console.log('[Auth] Cached session restored for:', parsedStoredUser.id, parsedStoredUser.type, 'source:', source);
      return true;
    } catch (error) {
      console.log('[Auth] restoreCachedAuthUser error:', error, 'source:', source);
      return false;
    }
  }, []);

  const getLocalAuthBackup = useCallback(async (email: string): Promise<LocalAuthBackup | null> => {
    const normalizedEmail = normalizeAuthEmail(email);
    if (!normalizedEmail) {
      return null;
    }

    try {
      const secureStoreKey = buildLocalAuthKey(normalizedEmail);
      const raw = await SecureStore.getItemAsync(secureStoreKey);
      if (!raw) {
        return null;
      }

      const parsed = parseLocalAuthBackup(raw);
      if (!parsed) {
        console.log('[Auth] getLocalAuthBackup invalid backup payload for:', normalizedEmail);
        return null;
      }

      return parsed;
    } catch (error) {
      console.log('[Auth] getLocalAuthBackup error:', error, 'email:', normalizedEmail);
      return null;
    }
  }, []);

  const saveRememberedLogin = useCallback(async (
    email: string,
    password: string,
    type: Exclude<UserType, null>
  ): Promise<void> => {
    const normalizedEmail = normalizeAuthEmail(email);
    const trimmedPassword = password.trim();

    if (!normalizedEmail || !trimmedPassword) {
      return;
    }

    try {
      const payload: RememberedLoginCredentials = {
        email: normalizedEmail,
        password: trimmedPassword,
        type,
        updatedAt: new Date().toISOString(),
      };
      await SecureStore.setItemAsync(buildRememberedLoginKey(type), JSON.stringify(payload));
      console.log('[Auth] Remembered login saved for:', normalizedEmail, 'type:', type);
    } catch (error) {
      console.log('[Auth] saveRememberedLogin error:', error, 'email:', normalizedEmail);
    }
  }, []);

  const getRememberedLogin = useCallback(async (
    type: Exclude<UserType, null>
  ): Promise<RememberedLoginCredentials | null> => {
    try {
      const raw = await SecureStore.getItemAsync(buildRememberedLoginKey(type));
      if (!raw) {
        return null;
      }

      const parsed = parseRememberedLogin(raw);
      if (!parsed) {
        console.log('[Auth] getRememberedLogin invalid payload for:', type);
        return null;
      }

      return parsed;
    } catch (error) {
      console.log('[Auth] getRememberedLogin error:', error, 'type:', type);
      return null;
    }
  }, []);

  const saveRememberedPhone = useCallback(async (
    phone: string,
    type: Exclude<UserType, null>
  ): Promise<void> => {
    const normalizedPhone = normalizeTurkishPhone(phone);
    if (!normalizedPhone) {
      return;
    }

    try {
      const payload: RememberedPhoneLogin = {
        phone: normalizedPhone,
        type,
        updatedAt: new Date().toISOString(),
      };
      await SecureStore.setItemAsync(buildRememberedPhoneLoginKey(type), JSON.stringify(payload));
      console.log('[Auth] Remembered phone saved for:', normalizedPhone, 'type:', type);
    } catch (error) {
      console.log('[Auth] saveRememberedPhone error:', error, 'phone:', normalizedPhone);
    }
  }, []);

  const getRememberedPhone = useCallback(async (
    type: Exclude<UserType, null>
  ): Promise<RememberedPhoneLogin | null> => {
    try {
      const raw = await SecureStore.getItemAsync(buildRememberedPhoneLoginKey(type));
      if (!raw) {
        return null;
      }

      const parsed = parseRememberedPhoneLogin(raw);
      if (!parsed) {
        console.log('[Auth] getRememberedPhone invalid payload for:', type);
        return null;
      }

      return parsed;
    } catch (error) {
      console.log('[Auth] getRememberedPhone error:', error, 'type:', type);
      return null;
    }
  }, []);

  const saveRememberedPhoneAccount = useCallback(async (
    phone: string,
    email: string,
    type: Exclude<UserType, null>
  ): Promise<void> => {
    const normalizedPhone = normalizeTurkishPhone(phone);
    const normalizedEmail = normalizeAuthEmail(email);
    if (!normalizedPhone || !normalizedEmail) {
      return;
    }

    try {
      const payload: RememberedPhoneAccount = {
        phone: normalizedPhone,
        email: normalizedEmail,
        type,
        updatedAt: new Date().toISOString(),
      };
      await SecureStore.setItemAsync(buildRememberedPhoneAccountKey(type, normalizedPhone), JSON.stringify(payload));
      console.log('[Auth] Remembered phone account saved for:', normalizedPhone, 'email:', normalizedEmail, 'type:', type);
    } catch (error) {
      console.log('[Auth] saveRememberedPhoneAccount error:', error, 'phone:', normalizedPhone, 'email:', normalizedEmail, 'type:', type);
    }
  }, []);

  const getRememberedPhoneAccount = useCallback(async (
    phone: string,
    type: Exclude<UserType, null>
  ): Promise<RememberedPhoneAccount | null> => {
    const normalizedPhone = normalizeTurkishPhone(phone);
    if (!normalizedPhone) {
      return null;
    }

    try {
      const raw = await SecureStore.getItemAsync(buildRememberedPhoneAccountKey(type, normalizedPhone));
      if (!raw) {
        return null;
      }

      const parsed = parseRememberedPhoneAccount(raw);
      if (!parsed) {
        console.log('[Auth] getRememberedPhoneAccount invalid payload for:', normalizedPhone, 'type:', type);
        return null;
      }

      return parsed;
    } catch (error) {
      console.log('[Auth] getRememberedPhoneAccount error:', error, 'phone:', normalizedPhone, 'type:', type);
      return null;
    }
  }, []);

  const backgroundRepairRemoteAccount = useCallback(async (
    account: User | Driver,
    reason: string,
  ): Promise<void> => {
    if (!account?.email || (account.type !== 'customer' && account.type !== 'driver')) {
      return;
    }

    const normalizedEmail = normalizeAuthEmail(account.email);
    const syncKey = `${account.type}:${normalizedEmail}`;
    const lastSyncedAt = authRepairSyncRef.current[syncKey] ?? 0;
    if (Date.now() - lastSyncedAt < 60000) {
      console.log('[Auth] Background remote repair skipped due to cooldown for:', syncKey, 'reason:', reason);
      return;
    }

    authRepairSyncRef.current[syncKey] = Date.now();

    try {
      const [rememberedLogin, backup] = await Promise.all([
        getRememberedLogin(account.type),
        getLocalAuthBackup(normalizedEmail),
      ]);

      if (!rememberedLogin || rememberedLogin.email !== normalizedEmail) {
        console.log('[Auth] Background remote repair skipped - remembered login missing for:', normalizedEmail, 'reason:', reason);
        return;
      }

      if (!backup) {
        console.log('[Auth] Background remote repair skipped - local backup missing for:', normalizedEmail, 'reason:', reason);
        return;
      }

      const backendReady = await ensureBackendAuthReady(`background-repair:${reason}`, true);
      if (!backendReady) {
        console.log('[Auth] Background remote repair bootstrap not confirmed for:', normalizedEmail, 'reason:', reason);
      }

      const result = await directFetch('/auth/repair-account', {
        email: normalizedEmail,
        password: rememberedLogin.password,
        type: backup.type,
        account: backup.user,
      });

      if (result?.success === false) {
        console.log('[Auth] Background remote repair rejected for:', normalizedEmail, 'reason:', reason, 'error:', result.error ?? 'unknown');
        return;
      }

      const repairedUser = normalizeStoredAuthUser(result?.user
        ? {
            ...result.user,
            type: backup.type,
          } as User | Driver
        : null);
      const persistenceTasks: Promise<unknown>[] = [];

      if (result?.token) {
        persistenceTasks.push(setSessionToken(result.token));
      }

      if (repairedUser) {
        persistenceTasks.push(AsyncStorage.setItem('auth_user', JSON.stringify(repairedUser)));
        setUser((currentUser) => currentUser?.id === repairedUser.id ? repairedUser : currentUser);
        setUserType((currentType) => currentType === repairedUser.type ? repairedUser.type : currentType);
      }

      if (persistenceTasks.length > 0) {
        await queueAuthPersistence(`background-repair:${reason}:${normalizedEmail}`, persistenceTasks);
      }

      console.log('[Auth] Background remote repair completed for:', normalizedEmail, 'reason:', reason, 'hasToken:', !!result?.token);
    } catch (error) {
      console.log('[Auth] Background remote repair error:', normalizedEmail, 'reason:', reason, error);
    }
  }, [directFetch, ensureBackendAuthReady, getLocalAuthBackup, getRememberedLogin, queueAuthPersistence]);

  const buildLegacyLocalUser = useCallback(async (email: string): Promise<User | Driver | null> => {
    const normalizedEmail = normalizeAuthEmail(email);
    const fallbackId = normalizedEmail.replace(/[^a-zA-Z0-9]/g, '_');

    try {
      const storedUser = await AsyncStorage.getItem('auth_user');
      if (storedUser) {
        const parsed = JSON.parse(storedUser) as User | Driver;
        if (normalizeAuthEmail(parsed.email) === normalizedEmail && (parsed.type === 'customer' || parsed.type === 'driver')) {
          return {
            ...parsed,
            email: normalizedEmail,
          } as User | Driver;
        }
      }
    } catch (error) {
      console.log('[Auth] buildLegacyLocalUser auth_user error:', error);
    }

    try {
      const rawCredentials = await AsyncStorage.getItem('auth_credentials');
      if (!rawCredentials) {
        return null;
      }

      const credentials = JSON.parse(rawCredentials) as LocalAuthLegacyCredentials;
      if (normalizeAuthEmail(credentials.email ?? '') !== normalizedEmail) {
        return null;
      }

      if (credentials.type === 'driver') {
        const driver: Driver = {
          id: `d_local_${fallbackId}`,
          name: credentials.name ?? 'Şoför',
          phone: credentials.phone ?? '',
          email: normalizedEmail,
          type: 'driver',
          driverCategory: credentials.driverCategory ?? 'driver',
          vehiclePlate: credentials.vehiclePlate ?? '',
          vehicleModel: credentials.vehicleModel ?? 'Araç',
          vehicleColor: credentials.vehicleColor ?? 'Belirtilmedi',
          rating: 5,
          totalRides: 0,
          isOnline: false,
          isApproved: true,
          approvedAt: new Date().toISOString(),
          licenseIssueDate: credentials.licenseIssueDate,
          partnerDriverName: credentials.partnerDriverName,
          dailyEarnings: 0,
          weeklyEarnings: 0,
          monthlyEarnings: 0,
          city: credentials.city,
          district: credentials.district,
        };
        return driver;
      }

      const customer: User = {
        id: `c_local_${fallbackId}`,
        name: credentials.name ?? 'Müşteri',
        phone: credentials.phone ?? '',
        email: normalizedEmail,
        type: 'customer',
        gender: credentials.gender,
        city: credentials.city,
        district: credentials.district,
        vehiclePlate: credentials.vehiclePlate,
      };
      return customer;
    } catch (error) {
      console.log('[Auth] buildLegacyLocalUser auth_credentials error:', error);
      return null;
    }
  }, []);

  const persistLocalAuthBackup = useCallback(async (account: User | Driver, password: string): Promise<void> => {
    const normalizedEmail = normalizeAuthEmail(account.email);
    if (!normalizedEmail || !password) {
      return;
    }

    try {
      const passwordHash = await hashLocalPassword(password);
      const backup: LocalAuthBackup = {
        email: normalizedEmail,
        type: account.type,
        passwordHash,
        user: {
          ...account,
          email: normalizedEmail,
        },
        updatedAt: new Date().toISOString(),
      };

      const secureStoreKey = buildLocalAuthKey(normalizedEmail);
      await SecureStore.setItemAsync(secureStoreKey, JSON.stringify(backup));
      console.log('[Auth] Local auth backup saved for:', normalizedEmail, 'type:', account.type, 'key:', secureStoreKey);
    } catch (error) {
      console.log('[Auth] persistLocalAuthBackup error:', error, 'email:', normalizedEmail);
    }
  }, []);

  const hasLocalRecoveryAccount = useCallback(async (email: string): Promise<boolean> => {
    const backup = await getLocalAuthBackup(email);
    if (backup) {
      return true;
    }

    const legacyUser = await buildLegacyLocalUser(email);
    return !!legacyUser;
  }, [buildLegacyLocalUser, getLocalAuthBackup]);

  const hasLocalLoginBackup = useCallback(async (email: string): Promise<boolean> => {
    const backup = await getLocalAuthBackup(email);
    const hasBackup = !!backup?.passwordHash;
    console.log('[Auth] hasLocalLoginBackup:', email, hasBackup);
    return hasBackup;
  }, [getLocalAuthBackup]);

  const syncStoredAccount = useCallback(async (account: User | Driver): Promise<void> => {
    const normalizedEmail = normalizeAuthEmail(account.email);
    const normalizedAccount = {
      ...account,
      email: normalizedEmail,
    } as User | Driver;

    setUser(normalizedAccount);
    setUserType(normalizedAccount.type);
    setIsAuthenticated(true);
    await AsyncStorage.setItem('auth_user', JSON.stringify(normalizedAccount));

    try {
      const rawCredentials = await AsyncStorage.getItem('auth_credentials');
      if (rawCredentials) {
        const credentials = JSON.parse(rawCredentials) as LocalAuthLegacyCredentials;
        if (normalizeAuthEmail(credentials.email ?? '') === normalizedEmail) {
          const updatedCredentials: LocalAuthLegacyCredentials = {
            ...credentials,
            type: normalizedAccount.type,
            name: normalizedAccount.name,
            phone: normalizedAccount.phone,
            email: normalizedEmail,
            city: normalizedAccount.city,
            district: normalizedAccount.district,
            vehiclePlate: normalizedAccount.vehiclePlate,
          };

          if (normalizedAccount.type === 'customer') {
            updatedCredentials.gender = normalizedAccount.gender;
          }

          if (normalizedAccount.type === 'driver') {
            const driverAccount = normalizedAccount as Driver;
            updatedCredentials.vehicleModel = driverAccount.vehicleModel;
            updatedCredentials.vehicleColor = driverAccount.vehicleColor;
            updatedCredentials.partnerDriverName = driverAccount.partnerDriverName;
            updatedCredentials.licenseIssueDate = driverAccount.licenseIssueDate;
            updatedCredentials.driverCategory = driverAccount.driverCategory;
          }

          await AsyncStorage.setItem('auth_credentials', JSON.stringify(updatedCredentials));
        }
      }
    } catch (error) {
      console.log('[Auth] syncStoredAccount auth_credentials error:', error);
    }

    try {
      const backup = await getLocalAuthBackup(normalizedEmail);
      if (backup) {
        const updatedBackup: LocalAuthBackup = {
          ...backup,
          type: normalizedAccount.type,
          user: normalizedAccount,
          updatedAt: new Date().toISOString(),
        };
        await SecureStore.setItemAsync(buildLocalAuthKey(normalizedEmail), JSON.stringify(updatedBackup));
        console.log('[Auth] Local auth backup refreshed for:', normalizedEmail);
      }
    } catch (error) {
      console.log('[Auth] syncStoredAccount local backup error:', error);
    }

    console.log('[Auth] Stored account synced:', normalizedAccount.id, normalizedAccount.type, normalizedAccount.phone);
  }, [getLocalAuthBackup]);

  const updateAccountPhone = useCallback(async (phone: string): Promise<User | Driver> => {
    if (!user) {
      throw new Error('Aktif oturum bulunamadı');
    }

    const cleanPhone = normalizeTurkishPhone(phone);
    const phoneValidationError = getTurkishPhoneValidationError(cleanPhone);
    if (phoneValidationError) {
      throw new Error(phoneValidationError);
    }

    console.log('[Auth] updateAccountPhone start:', user.id, user.type, cleanPhone);

    const applyLocalUpdate = async (): Promise<User | Driver> => {
      const updatedAccount = {
        ...user,
        phone: cleanPhone,
      } as User | Driver;
      await syncStoredAccount(updatedAccount);
      console.log('[Auth] updateAccountPhone local fallback applied:', user.id, cleanPhone);
      return updatedAccount;
    };

    try {
      const restResult = await directAuthorizedFetch('/auth/update-phone', {
        userId: user.id,
        phone: cleanPhone,
      });

      if (user.type === 'customer') {
        if (!restResult?.success || !restResult.user) {
          throw new Error(restResult?.error ?? 'Telefon numarası güncellenemedi');
        }
        const updatedUser: User = { ...restResult.user, type: 'customer' };
        await syncStoredAccount(updatedUser);
        return updatedUser;
      }

      if (!restResult?.success || !restResult.driver) {
        throw new Error(restResult?.error ?? 'Telefon numarası güncellenemedi');
      }
      const updatedDriver: Driver = { ...restResult.driver, type: 'driver' };
      await syncStoredAccount(updatedDriver);
      return updatedDriver;
    } catch (restError) {
      console.log('[Auth] updateAccountPhone REST (session) error:', restError);
      const restMessage = restError instanceof Error ? restError.message : '';

      if (isSessionAuthError(restMessage) || isNetworkError(restMessage)) {
        console.log('[Auth] updateAccountPhone trying direct (session-free) endpoint...');
        try {
          const directResult = await directFetch('/auth/update-phone-direct', {
            userId: user.id,
            email: user.email,
            phone: cleanPhone,
          });

          if (user.type === 'customer') {
            if (directResult?.success && directResult.user) {
              const updatedUser: User = { ...directResult.user, type: 'customer' };
              await syncStoredAccount(updatedUser);
              return updatedUser;
            }
          } else {
            if (directResult?.success && directResult.driver) {
              const updatedDriver: Driver = { ...directResult.driver, type: 'driver' };
              await syncStoredAccount(updatedDriver);
              return updatedDriver;
            }
          }

          if (directResult?.success) {
            return applyLocalUpdate();
          }

          throw new Error(directResult?.error ?? 'Telefon numarası güncellenemedi');
        } catch (directError) {
          console.log('[Auth] updateAccountPhone direct endpoint error:', directError);
          const directMessage = directError instanceof Error ? directError.message : '';

          if (isNetworkError(directMessage)) {
            return applyLocalUpdate();
          }

          if (directError instanceof Error) throw directError;
        }
      }

      try {
        if (user.type === 'customer') {
          let trpcResult: { success: boolean; error: string | null; user: User | null } | null = null;
          try {
            trpcResult = await trpcClient.auth.updateProfile.mutate({ userId: user.id, phone: cleanPhone });
          } catch (error) {
            const message = error instanceof Error ? error.message : '';
            console.log('[Auth] updateAccountPhone customer updateProfile error:', error);
            if (!message.includes('No procedure found on path')) throw error;
            trpcResult = await trpcClient.auth.updateCustomerProfile.mutate({ userId: user.id, phone: cleanPhone });
          }
          if (!trpcResult?.success || !trpcResult.user) {
            throw new Error(trpcResult?.error ?? 'Telefon numarası güncellenemedi');
          }
          const updatedUser: User = { ...trpcResult.user, type: 'customer' };
          await syncStoredAccount(updatedUser);
          return updatedUser;
        }

        const trpcResult = await trpcClient.drivers.updateProfile.mutate({ driverId: user.id, phone: cleanPhone });
        if (!trpcResult?.success || !trpcResult.driver) {
          throw new Error(trpcResult?.error ?? 'Telefon numarası güncellenemedi');
        }
        const updatedDriver: Driver = { ...trpcResult.driver, type: 'driver' };
        await syncStoredAccount(updatedDriver);
        return updatedDriver;
      } catch (trpcError) {
        console.log('[Auth] updateAccountPhone tRPC error:', trpcError);
        const trpcMessage = trpcError instanceof Error ? trpcError.message : '';

        if (isSessionAuthError(trpcMessage) || isNetworkError(trpcMessage)) {
          return applyLocalUpdate();
        }

        if (trpcError instanceof Error) throw trpcError;
        throw new Error('Telefon numarası güncellenemedi. Lütfen tekrar deneyin.');
      }
    }
  }, [directAuthorizedFetch, directFetch, syncStoredAccount, user]);

  const recoverLocalPassword = useCallback(async (email: string, newPassword: string): Promise<boolean> => {
    const normalizedEmail = normalizeAuthEmail(email);
    const backup = await getLocalAuthBackup(normalizedEmail);
    const localUser = backup?.user ?? await buildLegacyLocalUser(normalizedEmail);

    if (!localUser) {
      console.log('[Auth] recoverLocalPassword failed - no local user for:', normalizedEmail);
      return false;
    }

    await persistLocalAuthBackup({
      ...localUser,
      email: normalizedEmail,
    } as User | Driver, newPassword);
    console.log('[Auth] Local password recovery completed for:', normalizedEmail);
    return true;
  }, [buildLegacyLocalUser, getLocalAuthBackup, persistLocalAuthBackup]);

  const shouldTryLocalAuthFallback = useCallback((message: string): boolean => {
    const lowerMessage = (message || '').toLowerCase();
    return isNetworkError(lowerMessage) ||
      lowerMessage.includes('sunucuya bağlanılamadı') ||
      lowerMessage.includes('sunucu şu an erişilemiyor') ||
      lowerMessage.includes('sunucu geçici olarak kullanılamıyor') ||
      lowerMessage.includes('sunucu geçici bir hata yaşıyor') ||
      lowerMessage.includes('sunucu yanıt vermedi') ||
      lowerMessage.includes('zaman aşımı') ||
      lowerMessage.includes('service unavailable') ||
      lowerMessage.includes('giriş sistemi şu anda hazırlanıyor') ||
      lowerMessage.includes('kayıt sistemi şu anda hazırlanıyor') ||
      lowerMessage.includes('kalıcı veritabanı hazır değil') ||
      lowerMessage.includes('hesabınız kalıcı olarak kaydedilemedi') ||
      lowerMessage.includes('oturum kalıcı olarak oluşturulamadı');
  }, []);

  const shouldTryLocalPhoneAuthFallback = useCallback((message: string): boolean => {
    const lowerMessage = (message || '').toLowerCase();
    return shouldTryLocalAuthFallback(message) ||
      lowerMessage.includes('bu telefon numarasıyla kayıtlı hesap bulunamadı') ||
      lowerMessage.includes('telefon numarasıyla kayıtlı hesap bulunamadı') ||
      lowerMessage.includes('doğrulama kodu bulunamadı') ||
      lowerMessage.includes('süresi dolmuş');
  }, [shouldTryLocalAuthFallback]);

  const tryLocalPhoneLogin = useCallback(async (
    phone: string,
    requestedType: Exclude<UserType, null>,
    reason: string,
  ): Promise<Exclude<UserType, null> | null> => {
    const normalizedPhone = normalizeTurkishPhone(phone);
    if (!normalizedPhone) {
      return null;
    }

    const candidateTypes = requestedType === 'driver'
      ? ['driver', 'customer'] as const
      : ['customer', 'driver'] as const;

    for (const candidateType of candidateTypes) {
      try {
        const [rememberedPhone, rememberedPhoneAccount, rememberedLogin] = await Promise.all([
          getRememberedPhone(candidateType),
          getRememberedPhoneAccount(normalizedPhone, candidateType),
          getRememberedLogin(candidateType),
        ]);

        const linkedEmail = rememberedPhoneAccount?.email ?? rememberedLogin?.email;
        if (!linkedEmail) {
          continue;
        }

        if (rememberedPhone && rememberedPhone.phone !== normalizedPhone && !rememberedPhoneAccount) {
          continue;
        }

        const backup = await getLocalAuthBackup(linkedEmail);
        const backupPhone = normalizeTurkishPhone(backup?.user?.phone);
        if (!backup || backup.type !== candidateType || backupPhone !== normalizedPhone) {
          continue;
        }

        console.log('[Auth] tryLocalPhoneLogin matched backup:', normalizedPhone, 'requested:', requestedType, 'candidate:', candidateType, 'reason:', reason, 'email:', linkedEmail);
        await Promise.all([
          saveRememberedPhone(normalizedPhone, backup.type),
          saveRememberedPhoneAccount(normalizedPhone, backup.user.email, backup.type),
        ]);
        return setAuthenticatedLocalUser({
          ...backup.user,
          phone: normalizedPhone,
          email: normalizeAuthEmail(backup.user.email),
          type: backup.type,
        } as User | Driver, `phone-local-fallback:${reason}:${candidateType}`);
      } catch (error) {
        console.log('[Auth] tryLocalPhoneLogin candidate error:', error, 'phone:', normalizedPhone, 'candidate:', candidateType, 'reason:', reason);
      }
    }

    console.log('[Auth] tryLocalPhoneLogin no local match for:', normalizedPhone, 'requested:', requestedType, 'reason:', reason);
    return null;
  }, [getLocalAuthBackup, getRememberedLogin, getRememberedPhone, getRememberedPhoneAccount, saveRememberedPhone, saveRememberedPhoneAccount, setAuthenticatedLocalUser]);

  const shouldTryRemoteAccountRepair = useCallback((message: string): boolean => {
    const lowerMessage = (message || '').toLowerCase();
    return lowerMessage.includes('kullanıcı bulunamadı') ||
      lowerMessage.includes('hesap bulundu ancak şifre kaydı eksik') ||
      lowerMessage.includes('kayıt olduğunuz e-posta adresini kontrol edin') ||
      lowerMessage.includes('bu e-posta adresiyle kayıtlı hesap bulunamadı') ||
      lowerMessage.includes('noprocedurefound') ||
      lowerMessage.includes('no procedure found on path') ||
      (lowerMessage.includes('trpc') && lowerMessage.includes('loginbyemail'));
  }, []);

  const resolveRemoteRepairErrorMessage = useCallback((primaryMessage: string, fallbackMessage: string): string => {
    const normalizedPrimary = (primaryMessage || '').trim();
    const normalizedFallback = (fallbackMessage || '').trim();
    const lowerPrimary = normalizedPrimary.toLowerCase();

    if (
      lowerPrimary.includes('noprocedurefound') ||
      lowerPrimary.includes('no procedure found on path') ||
      (lowerPrimary.includes('trpc') && lowerPrimary.includes('loginbyemail'))
    ) {
      const safeFallback = normalizedFallback || 'Kullanıcı bulunamadı. Lütfen kayıt olduğunuz e-posta adresini kontrol edin.';
      console.log('[Auth] Replacing raw tRPC login route error with fallback message:', safeFallback);
      return safeFallback;
    }

    return normalizedPrimary || normalizedFallback;
  }, []);

  const tryLocalLogin = useCallback(async (
    email: string,
    password: string,
    requestedType: Exclude<UserType, null>
  ): Promise<UserType> => {
    const normalizedEmail = normalizeAuthEmail(email);
    const backup = await getLocalAuthBackup(normalizedEmail);

    if (!backup) {
      console.log('[Auth] tryLocalLogin - no backup for:', normalizedEmail);
      throw new Error('Sunucuya şu an ulaşılamıyor ve bu cihazda çevrimdışı giriş yedeği bulunamadı. Lütfen tekrar deneyin.');
    }

    const passwordHash = await hashLocalPassword(password);
    if (backup.passwordHash !== passwordHash) {
      console.log('[Auth] tryLocalLogin - password mismatch for:', normalizedEmail);
      throw new Error('Şifre hatalı');
    }

    if (requestedType === 'driver' && backup.type !== 'driver') {
      throw new Error('Bu e-posta ile kayıtlı şoför hesabı bulunamadı');
    }

    await Promise.all([
      saveRememberedLogin(normalizedEmail, password, backup.type),
      saveRememberedPhone(backup.user.phone, backup.type),
      saveRememberedPhoneAccount(backup.user.phone, normalizedEmail, backup.type),
    ]);

    return setAuthenticatedLocalUser({
      ...backup.user,
      email: normalizedEmail,
    } as User | Driver, 'secure-backup');
  }, [getLocalAuthBackup, saveRememberedLogin, saveRememberedPhone, saveRememberedPhoneAccount, setAuthenticatedLocalUser]);

  const handlePhoneLoginSuccess = useCallback(async (
    result: any,
    phone: string,
    source: string,
  ): Promise<Exclude<UserType, null>> => {
    console.log(`[Auth] handlePhoneLoginSuccess (${source}) result:`, JSON.stringify({ success: result?.success, error: result?.error, hasUser: !!result?.user, hasToken: !!result?.token }));
    if (result?.success && result?.user) {
      const returnedUser = { ...result.user } as User | Driver;
      const actualType: Exclude<UserType, null> = returnedUser.type === 'driver' ? 'driver' : 'customer';
      returnedUser.type = actualType;
      setUser(returnedUser);
      setUserType(actualType);
      setIsAuthenticated(true);

      const normalizedPhone = normalizeTurkishPhone(phone || returnedUser.phone);
      const persistenceTasks: Promise<unknown>[] = [
        AsyncStorage.setItem('auth_user', JSON.stringify(returnedUser)),
        saveRememberedPhone(normalizedPhone, actualType),
        saveRememberedPhoneAccount(normalizedPhone, returnedUser.email, actualType),
      ];

      if (result?.token) {
        persistenceTasks.unshift(setSessionToken(result.token));
      }

      await queueAuthPersistence(`phone-login:${actualType}:${normalizedPhone}`, persistenceTasks);
      console.log('[Auth] Phone login success for:', normalizedPhone, 'type:', actualType);
      return actualType;
    }

    throw new Error(result?.error ?? 'Giriş doğrulanamadı');
  }, [queueAuthPersistence, saveRememberedPhone, saveRememberedPhoneAccount]);

  const sendCustomerLoginCode = useCallback(async (phone: string): Promise<PhoneLoginResponse> => {
    const normalizedPhone = normalizeTurkishPhone(phone);
    const phoneValidationError = getTurkishPhoneValidationError(normalizedPhone);
    if (phoneValidationError) {
      throw new Error(phoneValidationError);
    }

    try {
      const backendReady = await ensureBackendAuthReady('customer-send-login-code');
      if (!backendReady) {
        console.log('[Auth] customer-send-login-code bootstrap not confirmed, trying direct request anyway');
      }

      const result = await directFetch('/auth/send-login-code', {
        phone: normalizedPhone,
        type: 'customer',
      });

      if (result?.success === false) {
        throw new Error(result.error ?? 'SMS kodu gönderilemedi');
      }

      console.log('[Auth] Customer login code sent for:', normalizedPhone);
      return result as PhoneLoginResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      console.log('[Auth] sendCustomerLoginCode error:', message || error);

      if (shouldTryLocalPhoneAuthFallback(message)) {
        const localAuthenticatedType = await tryLocalPhoneLogin(normalizedPhone, 'customer', 'customer-send-login-code');
        if (localAuthenticatedType) {
          return {
            success: true,
            error: null,
            maskedPhone: normalizedPhone,
            deliveryNote: 'Sunucuya ulaşılamadığı için bu cihazdaki kayıtlı hesap yedeğiyle giriş yapıldı.',
            smsProvider: 'device',
            localAuthenticatedType,
            localFallbackUsed: true,
          };
        }
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error('SMS kodu gönderilemedi');
    }
  }, [directFetch, ensureBackendAuthReady, shouldTryLocalPhoneAuthFallback, tryLocalPhoneLogin]);

  const sendDriverLoginCode = useCallback(async (phone: string): Promise<PhoneLoginResponse> => {
    const normalizedPhone = normalizeTurkishPhone(phone);
    const phoneValidationError = getTurkishPhoneValidationError(normalizedPhone);
    if (phoneValidationError) {
      throw new Error(phoneValidationError);
    }

    try {
      const backendReady = await ensureBackendAuthReady('driver-send-login-code');
      if (!backendReady) {
        console.log('[Auth] driver-send-login-code bootstrap not confirmed, trying direct request anyway');
      }

      const result = await directFetch('/auth/send-login-code', {
        phone: normalizedPhone,
        type: 'driver',
      });

      if (result?.success === false) {
        throw new Error(result.error ?? 'SMS kodu gönderilemedi');
      }

      console.log('[Auth] Driver login code sent for:', normalizedPhone);
      return result as PhoneLoginResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      console.log('[Auth] sendDriverLoginCode error:', message || error);

      if (shouldTryLocalPhoneAuthFallback(message)) {
        const localAuthenticatedType = await tryLocalPhoneLogin(normalizedPhone, 'driver', 'driver-send-login-code');
        if (localAuthenticatedType) {
          return {
            success: true,
            error: null,
            maskedPhone: normalizedPhone,
            deliveryNote: 'Sunucuya ulaşılamadığı için bu cihazdaki kayıtlı hesap yedeğiyle giriş yapıldı.',
            smsProvider: 'device',
            localAuthenticatedType,
            localFallbackUsed: true,
          };
        }
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error('SMS kodu gönderilemedi');
    }
  }, [directFetch, ensureBackendAuthReady, shouldTryLocalPhoneAuthFallback, tryLocalPhoneLogin]);

  const verifyCustomerLoginCode = useCallback(async (phone: string, code: string) => {
    const normalizedPhone = normalizeTurkishPhone(phone);
    const phoneValidationError = getTurkishPhoneValidationError(normalizedPhone);
    if (phoneValidationError) {
      throw new Error(phoneValidationError);
    }

    const trimmedCode = code.trim();
    if (trimmedCode.length !== 6) {
      throw new Error('Lütfen 6 haneli SMS kodunu girin');
    }

    try {
      const result = await directFetch('/auth/verify-login-code', {
        phone: normalizedPhone,
        code: trimmedCode,
        type: 'customer',
      });

      return handlePhoneLoginSuccess(result, normalizedPhone, 'PHONE_LOGIN_CUSTOMER');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      console.log('[Auth] verifyCustomerLoginCode error:', message || error);

      if (shouldTryLocalPhoneAuthFallback(message)) {
        const localAuthenticatedType = await tryLocalPhoneLogin(normalizedPhone, 'customer', 'customer-verify-login-code');
        if (localAuthenticatedType) {
          return localAuthenticatedType;
        }
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error('Giriş doğrulanamadı');
    }
  }, [directFetch, handlePhoneLoginSuccess, shouldTryLocalPhoneAuthFallback, tryLocalPhoneLogin]);

  const verifyDriverLoginCode = useCallback(async (phone: string, code: string) => {
    const normalizedPhone = normalizeTurkishPhone(phone);
    const phoneValidationError = getTurkishPhoneValidationError(normalizedPhone);
    if (phoneValidationError) {
      throw new Error(phoneValidationError);
    }

    const trimmedCode = code.trim();
    if (trimmedCode.length !== 6) {
      throw new Error('Lütfen 6 haneli SMS kodunu girin');
    }

    try {
      const result = await directFetch('/auth/verify-login-code', {
        phone: normalizedPhone,
        code: trimmedCode,
        type: 'driver',
      });

      return handlePhoneLoginSuccess(result, normalizedPhone, 'PHONE_LOGIN_DRIVER');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      console.log('[Auth] verifyDriverLoginCode error:', message || error);

      if (shouldTryLocalPhoneAuthFallback(message)) {
        const localAuthenticatedType = await tryLocalPhoneLogin(normalizedPhone, 'driver', 'driver-verify-login-code');
        if (localAuthenticatedType) {
          return localAuthenticatedType;
        }
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error('Giriş doğrulanamadı');
    }
  }, [directFetch, handlePhoneLoginSuccess, shouldTryLocalPhoneAuthFallback, tryLocalPhoneLogin]);

  const tryRecoverServerSessionFromStoredUser = useCallback(async (
    fallbackStoredUser: string | null,
    reason: string,
  ): Promise<boolean> => {
    const parsedStoredUser = fallbackStoredUser ? parseStoredAuthUser(fallbackStoredUser) : null;
    if (!parsedStoredUser || (parsedStoredUser.type !== 'customer' && parsedStoredUser.type !== 'driver')) {
      console.log('[Auth] Session recovery skipped - cached user missing for:', reason);
      return false;
    }

    const normalizedEmail = normalizeAuthEmail(parsedStoredUser.email);
    if (!normalizedEmail) {
      console.log('[Auth] Session recovery skipped - cached email missing for:', reason);
      return false;
    }

    const [rememberedLogin, backup] = await Promise.all([
      getRememberedLogin(parsedStoredUser.type),
      getLocalAuthBackup(normalizedEmail),
    ]);

    if (!rememberedLogin || rememberedLogin.email !== normalizedEmail) {
      console.log('[Auth] Session recovery skipped - remembered login missing for:', normalizedEmail, 'reason:', reason);
      return false;
    }

    if (!backup) {
      console.log('[Auth] Session recovery skipped - local backup missing for:', normalizedEmail, 'reason:', reason);
      return false;
    }

    try {
      const backendReady = await ensureBackendAuthReady(`session-recovery:${reason}`, true);
      if (!backendReady) {
        console.log('[Auth] Session recovery bootstrap not confirmed for:', normalizedEmail, 'reason:', reason);
      }

      const result = await directFetch('/auth/repair-account', {
        email: normalizedEmail,
        password: rememberedLogin.password,
        type: backup.type,
        account: backup.user,
      });

      if (result?.success === false || !result?.user) {
        console.log('[Auth] Session recovery rejected for:', normalizedEmail, 'reason:', reason, 'error:', result?.error ?? 'unknown');
        return false;
      }

      const repairedUser = normalizeStoredAuthUser({
        ...result.user,
        type: backup.type,
      } as User | Driver);

      if (!repairedUser) {
        console.log('[Auth] Session recovery returned unreadable user for:', normalizedEmail, 'reason:', reason);
        return false;
      }

      setUser(repairedUser);
      setUserType(repairedUser.type);
      setIsAuthenticated(true);

      const persistenceTasks: Promise<unknown>[] = [
        AsyncStorage.setItem('auth_user', JSON.stringify(repairedUser)),
        saveRememberedLogin(rememberedLogin.email, rememberedLogin.password, repairedUser.type),
        saveRememberedPhone(repairedUser.phone, repairedUser.type),
        saveRememberedPhoneAccount(repairedUser.phone, repairedUser.email, repairedUser.type),
      ];

      if (result?.token) {
        persistenceTasks.unshift(setSessionToken(result.token));
      }

      await queueAuthPersistence(`session-recovery:${reason}:${normalizedEmail}`, persistenceTasks);
      console.log('[Auth] Session recovered from cached credentials for:', normalizedEmail, 'reason:', reason, 'hasToken:', !!result?.token);
      return true;
    } catch (error) {
      console.log('[Auth] Session recovery from cached credentials failed for:', normalizedEmail, 'reason:', reason, error);
      return false;
    }
  }, [directFetch, ensureBackendAuthReady, getLocalAuthBackup, getRememberedLogin, queueAuthPersistence, saveRememberedLogin, saveRememberedPhone, saveRememberedPhoneAccount]);

  const handleSessionInvalid = useCallback(async () => {
    console.log('[Auth] Session invalid, logging out...');
    await setSessionToken(null);
    setUser(null);
    setUserType(null);
    setIsAuthenticated(false);
    await AsyncStorage.removeItem('auth_user');
  }, []);

  const restoreServerSession = useCallback(async (fallbackStoredUser: string | null): Promise<boolean> => {
    const token = await getSessionToken();
    if (!token) {
      const recoveredSession = await tryRecoverServerSessionFromStoredUser(fallbackStoredUser, 'missing-token');
      if (recoveredSession) {
        return true;
      }
      return restoreCachedAuthUser(fallbackStoredUser, 'missing-token');
    }

    try {
      const result = await directFetch('/auth/session', { token });
      if (result?.valid && result.user) {
        const restoredType: UserType = result.userType === 'driver' ? 'driver' : 'customer';
        const restoredUser = {
          ...result.user,
          type: restoredType,
        } as User | Driver;
        const normalizedRestoredUser = normalizeStoredAuthUser(restoredUser);

        if (!normalizedRestoredUser) {
          throw new Error('Sunucudan dönen oturum verisi okunamadı');
        }

        setUser(normalizedRestoredUser);
        setUserType(restoredType);
        setIsAuthenticated(true);
        await AsyncStorage.setItem('auth_user', JSON.stringify(normalizedRestoredUser));
        console.log('[Auth] Session validated on server:', normalizedRestoredUser.id, restoredType);
        return true;
      }

      await setSessionToken(null);
      const recoveredSession = await tryRecoverServerSessionFromStoredUser(fallbackStoredUser, 'invalid-server-session');
      if (recoveredSession) {
        return true;
      }

      const restoredFromCache = await restoreCachedAuthUser(fallbackStoredUser, 'invalid-server-session');
      if (restoredFromCache) {
        return true;
      }

      await handleSessionInvalid();
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      console.log('[Auth] restoreServerSession error:', message || error);

      if (isNetworkError(message) || shouldTryLocalAuthFallback(message)) {
        const restoredFromCache = await restoreCachedAuthUser(fallbackStoredUser, 'network-fallback');
        if (restoredFromCache) {
          console.log('[Auth] Falling back to cached session after network/backend readiness error');
          return true;
        }
      }

      if (isSessionAuthError(message) || message.toLowerCase().includes('oturum')) {
        await setSessionToken(null);
        const recoveredSession = await tryRecoverServerSessionFromStoredUser(fallbackStoredUser, 'session-auth-error');
        if (recoveredSession) {
          return true;
        }

        const restoredFromCache = await restoreCachedAuthUser(fallbackStoredUser, 'session-auth-error');
        if (restoredFromCache) {
          return true;
        }

        await handleSessionInvalid();
        return false;
      }

      throw error instanceof Error ? error : new Error('Oturum doğrulanamadı');
    }
  }, [directFetch, handleSessionInvalid, restoreCachedAuthUser, shouldTryLocalAuthFallback, tryRecoverServerSessionFromStoredUser]);

  const ensureServerSession = useCallback(async (reason: string): Promise<boolean> => {
    const token = await getSessionToken();

    if (token) {
      try {
        const result = await directFetch('/auth/session', { token });
        if (result?.valid === true && result.user) {
          console.log('[Auth] ensureServerSession confirmed active token for:', reason);
          return true;
        }
        console.log('[Auth] ensureServerSession token rejected by server for:', reason);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        console.log('[Auth] ensureServerSession validation error:', reason, message || error);

        if (isNetworkError(message) || shouldTryLocalAuthFallback(message)) {
          console.log('[Auth] ensureServerSession keeping current token after network/bootstrap error for:', reason);
          return true;
        }

        if (!isSessionAuthError(message) && !message.toLowerCase().includes('oturum')) {
          if (error instanceof Error) {
            throw error;
          }
          throw new Error('Oturum doğrulanamadı');
        }
      }

      await setSessionToken(null);
    }

    const storedUser = await AsyncStorage.getItem('auth_user');
    const recoveredSession = await tryRecoverServerSessionFromStoredUser(storedUser, `ensure-server-session:${reason}`);
    if (recoveredSession) {
      console.log('[Auth] ensureServerSession recovered session for:', reason);
      return true;
    }

    console.log('[Auth] ensureServerSession failed to recover session for:', reason);
    throw new Error('Oturumunuzun süresi dolmuş. Lütfen tekrar giriş yapın.');
  }, [directFetch, shouldTryLocalAuthFallback, tryRecoverServerSessionFromStoredUser]);

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const token = await getSessionToken();
        const stored = await AsyncStorage.getItem('auth_user');

        if (token || stored) {
          const restoredSession = await restoreServerSession(stored);
          if (!restoredSession && stored) {
            console.log('[Auth] No session token found and cached auth_user is not restorable, clearing stale local data');
            await AsyncStorage.removeItem('auth_user');
          }
        }

        const promo = await AsyncStorage.getItem('promo_applied');
        if (promo === 'true') {
          setPromoApplied(true);
        }
        const rides = await AsyncStorage.getItem('completed_rides');
        if (rides) {
          setCompletedRides(parseInt(rides, 10));
        }
        const history = await AsyncStorage.getItem('ride_history');
        if (history) {
          setRideHistory(JSON.parse(history));
          console.log('[Auth] Loaded ride history:', JSON.parse(history).length, 'rides');
        }
      } catch (e) {
        console.log('[Auth] Load error:', e);
        await handleSessionInvalid();
      } finally {
        setIsLoading(false);
      }
    };
    void loadAuth();
  }, [handleSessionInvalid, restoreServerSession]);

  useEffect(() => {
    if (isLoading || !user || (user.type !== 'customer' && user.type !== 'driver')) {
      return;
    }

    void backgroundRepairRemoteAccount(user, 'authenticated-session');
  }, [backgroundRepairRemoteAccount, isLoading, user]);

  useEffect(() => {
    if (user && user.type === 'driver') {
      const driver = user as Driver;
      setDriverApproved(driver.isApproved ?? false);
      console.log('[Auth] Driver approval from local state:', driver.id, 'approved:', driver.isApproved);
    } else {
      setDriverApproved(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.type]);

  useEffect(() => {
    if (user && user.type === 'driver') {
      AsyncStorage.getItem(`team_members_${user.id}`)
        .then(data => {
          if (data) {
            setTeamMembers(JSON.parse(data));
            console.log('[Auth] Loaded team members for driver:', user.id);
          } else {
            setTeamMembers([]);
          }
        })
        .catch(e => {
          console.log('[Auth] Team members load error:', e);
          setTeamMembers([]);
        });
      AsyncStorage.getItem(`profile_photo_${user.id}`)
        .then(data => {
          if (data) {
            setProfilePhoto(data);
          } else {
            setProfilePhoto(null);
          }
        })
        .catch(() => setProfilePhoto(null));
      AsyncStorage.getItem(`team_member_photos_${user.id}`)
        .then(data => {
          if (data) {
            setTeamMemberPhotos(JSON.parse(data));
          } else {
            setTeamMemberPhotos({});
          }
        })
        .catch(() => setTeamMemberPhotos({}));
      AsyncStorage.getItem(`team_member_documents_${user.id}`)
        .then(data => {
          if (data) {
            setTeamMemberDocuments(JSON.parse(data));
          } else {
            setTeamMemberDocuments({});
          }
        })
        .catch(() => setTeamMemberDocuments({}));
      AsyncStorage.getItem(`custom_vehicle_image_${user.id}`)
        .then(data => {
          if (data) {
            setCustomVehicleImage(data);
          } else {
            setCustomVehicleImage(null);
          }
        })
        .catch(() => setCustomVehicleImage(null));
      AsyncStorage.getItem(`driver_documents_${user.id}`)
        .then(data => {
          if (data) {
            setDriverDocuments(JSON.parse(data));
          } else {
            setDriverDocuments({});
          }
        })
        .catch(() => setDriverDocuments({}));
    } else {
      setTeamMembers([]);
      setDriverDocuments({});
      setProfilePhoto(null);
      setTeamMemberPhotos({});
      setCustomVehicleImage(null);
      setTeamMemberDocuments({});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.type]);

  const handleLoginSuccess = useCallback(async (result: any, email: string, password: string, source: string): Promise<UserType> => {
    console.log(`[Auth] handleLoginSuccess (${source}) result:`, JSON.stringify({ success: result.success, error: result.error, hasUser: !!result.user, hasToken: !!result.token }));
    if (result.success && result.user) {
      const returnedUser = { ...result.user } as any;
      const actualType: UserType = returnedUser.type === 'driver' ? 'driver' : 'customer';

      if (actualType === 'customer') {
        try {
          const localCreds = await AsyncStorage.getItem('auth_credentials');
          if (localCreds) {
            const creds = JSON.parse(localCreds);
            if (creds.vehiclePlate && creds.email === email) {
              returnedUser.vehiclePlate = creds.vehiclePlate;
            }
          }
        } catch {}
      }

      returnedUser.type = actualType;
      setUser(returnedUser);
      setUserType(actualType);
      setIsAuthenticated(true);

      const persistenceTasks: Promise<unknown>[] = [
        AsyncStorage.setItem('auth_user', JSON.stringify(returnedUser)),
        persistLocalAuthBackup(returnedUser as User | Driver, password),
        saveRememberedLogin(email, password, actualType),
        saveRememberedPhone(returnedUser.phone, actualType),
        saveRememberedPhoneAccount(returnedUser.phone, returnedUser.email, actualType),
      ];

      if (result.token) {
        persistenceTasks.unshift(setSessionToken(result.token));
      }

      await queueAuthPersistence(`login:${actualType}:${email}`, persistenceTasks);
      console.log('[Auth] Logged in as', actualType, ':', returnedUser.id, returnedUser.name);
      return actualType;
    }
    throw new Error(result.error ?? 'Mail adresiniz veya şifreniz hatalı');
  }, [persistLocalAuthBackup, queueAuthPersistence, saveRememberedLogin, saveRememberedPhone, saveRememberedPhoneAccount]);

  const loginCustomerWithSocialAuth = useCallback(async (payload: SocialLoginPayload): Promise<UserType> => {
    const providerUserId = payload.providerUserId.trim();
    if (!providerUserId) {
      throw new Error('Sosyal giriş kimliği okunamadı. Lütfen tekrar deneyin.');
    }

    const normalizedEmail = payload.email ? normalizeAuthEmail(payload.email) : '';
    const normalizedName = payload.name?.trim() ?? '';
    const normalizedAvatar = payload.avatar?.trim() ?? '';

    const backendReady = await ensureBackendAuthReady(`customer-social-${payload.provider}`, true);
    if (!backendReady) {
      console.log('[Auth] customer-social bootstrap not confirmed, trying direct social login anyway');
    }

    console.log('[Auth] loginCustomerWithSocialAuth start:', payload.provider, normalizedEmail || 'no-email', providerUserId);
    const result = await directFetch('/auth/social-login', {
      provider: payload.provider,
      providerUserId,
      email: normalizedEmail || undefined,
      name: normalizedName || undefined,
      avatar: normalizedAvatar || undefined,
      type: 'customer',
    });

    if (!result?.success || !result.user) {
      throw new Error(result?.error ?? 'Sosyal giriş tamamlanamadı.');
    }

    const returnedUser = normalizeStoredAuthUser({
      ...result.user,
      type: 'customer',
    } as User) ?? null;

    if (!returnedUser || returnedUser.type !== 'customer') {
      throw new Error('Sosyal giriş sonrası kullanıcı bilgisi okunamadı.');
    }

    setUser(returnedUser);
    setUserType('customer');
    setIsAuthenticated(true);

    const persistenceTasks: Promise<unknown>[] = [
      AsyncStorage.setItem('auth_user', JSON.stringify(returnedUser)),
    ];

    if (result.token) {
      persistenceTasks.unshift(setSessionToken(result.token));
    }

    if (normalizedEmail) {
      persistenceTasks.push(AsyncStorage.setItem('auth_credentials', JSON.stringify({
        type: 'customer',
        email: normalizedEmail,
        name: returnedUser.name,
        phone: returnedUser.phone ?? '',
      })));
    }

    if (returnedUser.phone) {
      persistenceTasks.push(saveRememberedPhone(returnedUser.phone, 'customer'));
      if (returnedUser.email) {
        persistenceTasks.push(saveRememberedPhoneAccount(returnedUser.phone, returnedUser.email, 'customer'));
      }
    }

    await queueAuthPersistence(`social-login:customer:${payload.provider}:${returnedUser.id}`, persistenceTasks);
    console.log('[Auth] Social login completed for customer:', returnedUser.id, payload.provider);
    return 'customer';
  }, [directFetch, ensureBackendAuthReady, queueAuthPersistence, saveRememberedPhone, saveRememberedPhoneAccount]);

  const repairRemoteAccountFromBackup = useCallback(async (
    email: string,
    password: string,
    requestedType: Exclude<UserType, null>
  ): Promise<UserType> => {
    const normalizedEmail = normalizeAuthEmail(email);
    const backup = await getLocalAuthBackup(normalizedEmail);

    if (!backup) {
      console.log('[Auth] repairRemoteAccountFromBackup - no backup for:', normalizedEmail);
      throw new Error('Bu cihazda hesap yedeği bulunamadı');
    }

    const passwordHash = await hashLocalPassword(password);
    if (backup.passwordHash !== passwordHash) {
      console.log('[Auth] repairRemoteAccountFromBackup - password mismatch for:', normalizedEmail);
      throw new Error('Şifre hatalı');
    }

    if (requestedType === 'driver' && backup.type !== 'driver') {
      throw new Error('Bu e-posta ile kayıtlı şoför hesabı bulunamadı');
    }

    console.log('[Auth] repairRemoteAccountFromBackup start:', normalizedEmail, 'requestedType:', requestedType, 'backupType:', backup.type);
    const result = await directFetch('/auth/repair-account', {
      email: normalizedEmail,
      password,
      type: backup.type,
      account: backup.user,
    });

    if (result && result.success === false && result.error) {
      throw new Error(result.error);
    }

    return handleLoginSuccess(result, normalizedEmail, password, 'REMOTE_REPAIR');
  }, [directFetch, getLocalAuthBackup, handleLoginSuccess]);

  const tryTrpcLogin = useCallback(async (
    email: string,
    password: string,
    requestedType: Exclude<UserType, null>
  ): Promise<UserType> => {
    const normalizedEmail = normalizeAuthEmail(email);
    console.log('[Auth] tryTrpcLogin start:', normalizedEmail, 'type:', requestedType);

    const result = await trpcClient.auth.loginByEmail.mutate({
      email: normalizedEmail,
      password,
      type: requestedType,
    });

    if (result && result.success === false && result.error) {
      throw new Error(result.error);
    }

    return handleLoginSuccess(result, normalizedEmail, password, 'TRPC');
  }, [handleLoginSuccess]);

  const loginAsCustomer = useCallback(async (email?: string, password?: string) => {
    if (!email || !password) {
      throw new Error('E-posta ve şifre gerekli');
    }

    try {
      const backendReady = await ensureBackendAuthReady('customer-login', true);
      if (!backendReady) {
        console.log('[Auth] customer-login bootstrap not confirmed, trying direct login anyway');
      }
      console.log('[Auth] loginAsCustomer called for:', email, '(REST)');
      const result = await directFetch('/auth/login', { email, password, type: 'customer' });
      if (result && result.success === false && result.error) {
        throw new Error(result.error);
      }
      return await handleLoginSuccess(result, email, password, 'REST');
    } catch (err: any) {
      console.log('[Auth] loginAsCustomer error:', err?.message);
      const errorMessage = err instanceof Error ? err.message : '';
      let resolvedErrorMessage = errorMessage;

      if (shouldTryRemoteAccountRepair(errorMessage)) {
        try {
          return await tryTrpcLogin(email, password, 'customer');
        } catch (trpcError) {
          console.log('[Auth] loginAsCustomer TRPC fallback error:', trpcError);
          const trpcErrorMessage = trpcError instanceof Error ? trpcError.message : errorMessage;
          resolvedErrorMessage = resolveRemoteRepairErrorMessage(trpcErrorMessage, errorMessage);
        }

        if (shouldTryRemoteAccountRepair(resolvedErrorMessage)) {
          const hasLocalBackup = await hasLocalLoginBackup(email);
          console.log('[Auth] loginAsCustomer remote repair availability:', hasLocalBackup, 'email:', email);
          if (hasLocalBackup) {
            try {
              return await repairRemoteAccountFromBackup(email, password, 'customer');
            } catch (repairError) {
              console.log('[Auth] loginAsCustomer remote repair error:', repairError);
              const repairMessage = repairError instanceof Error ? repairError.message : '';
              if (shouldTryLocalAuthFallback(repairMessage)) {
                return tryLocalLogin(email, password, 'customer');
              }
              if (repairError instanceof Error) throw repairError;
            }
          }
        }
      }

      if (shouldTryLocalAuthFallback(resolvedErrorMessage)) {
        const hasLocalBackup = await hasLocalLoginBackup(email);
        console.log('[Auth] loginAsCustomer local fallback availability:', hasLocalBackup, 'email:', email);
        if (hasLocalBackup) {
          return tryLocalLogin(email, password, 'customer');
        }
      }
      if (resolvedErrorMessage && resolvedErrorMessage !== errorMessage) {
        throw new Error(resolvedErrorMessage);
      }
      if (err instanceof Error) throw err;
      throw new Error('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
    }
  }, [directFetch, ensureBackendAuthReady, handleLoginSuccess, hasLocalLoginBackup, repairRemoteAccountFromBackup, resolveRemoteRepairErrorMessage, shouldTryLocalAuthFallback, shouldTryRemoteAccountRepair, tryLocalLogin, tryTrpcLogin]);

  const loginAsDriver = useCallback(async (email?: string, password?: string) => {
    if (!email || !password) {
      throw new Error('E-posta ve şifre gerekli');
    }

    try {
      const backendReady = await ensureBackendAuthReady('driver-login', true);
      if (!backendReady) {
        console.log('[Auth] driver-login bootstrap not confirmed, trying direct login anyway');
      }
      console.log('[Auth] loginAsDriver called for:', email, '(REST)');
      const result = await directFetch('/auth/login', { email, password, type: 'driver' });
      if (result && result.success === false && result.error) {
        throw new Error(result.error);
      }
      return await handleLoginSuccess(result, email, password, 'REST');
    } catch (err: any) {
      console.log('[Auth] loginAsDriver error:', err?.message);
      const errorMessage = err instanceof Error ? err.message : '';
      let resolvedErrorMessage = errorMessage;

      if (shouldTryRemoteAccountRepair(errorMessage)) {
        try {
          return await tryTrpcLogin(email, password, 'driver');
        } catch (trpcError) {
          console.log('[Auth] loginAsDriver TRPC fallback error:', trpcError);
          const trpcErrorMessage = trpcError instanceof Error ? trpcError.message : errorMessage;
          resolvedErrorMessage = resolveRemoteRepairErrorMessage(trpcErrorMessage, errorMessage);
        }

        if (shouldTryRemoteAccountRepair(resolvedErrorMessage)) {
          const hasLocalBackup = await hasLocalLoginBackup(email);
          console.log('[Auth] loginAsDriver remote repair availability:', hasLocalBackup, 'email:', email);
          if (hasLocalBackup) {
            try {
              return await repairRemoteAccountFromBackup(email, password, 'driver');
            } catch (repairError) {
              console.log('[Auth] loginAsDriver remote repair error:', repairError);
              const repairMessage = repairError instanceof Error ? repairError.message : '';
              if (shouldTryLocalAuthFallback(repairMessage)) {
                return tryLocalLogin(email, password, 'driver');
              }
              if (repairError instanceof Error) throw repairError;
            }
          }
        }
      }

      if (shouldTryLocalAuthFallback(resolvedErrorMessage)) {
        const hasLocalBackup = await hasLocalLoginBackup(email);
        console.log('[Auth] loginAsDriver local fallback availability:', hasLocalBackup, 'email:', email);
        if (hasLocalBackup) {
          return tryLocalLogin(email, password, 'driver');
        }
      }
      if (resolvedErrorMessage && resolvedErrorMessage !== errorMessage) {
        throw new Error(resolvedErrorMessage);
      }
      if (err instanceof Error) throw err;
      throw new Error('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
    }
  }, [directFetch, ensureBackendAuthReady, handleLoginSuccess, hasLocalLoginBackup, repairRemoteAccountFromBackup, resolveRemoteRepairErrorMessage, shouldTryLocalAuthFallback, shouldTryRemoteAccountRepair, tryLocalLogin, tryTrpcLogin]);

  const registerCustomer = useCallback(async (name: string, phone: string, email: string, password: string, gender: 'male' | 'female', city: string, district: string, vehiclePlate?: string, referralCode?: string) => {
    const normalizedPhone = normalizeTurkishPhone(phone);
    const phoneValidationError = getTurkishPhoneValidationError(normalizedPhone);
    if (phoneValidationError) {
      throw new Error(phoneValidationError);
    }

    const payload = { name, phone: normalizedPhone, email, password, gender, city, district, referralCode: referralCode || undefined };

    const handleSuccess = async (result: any, source: string) => {
      console.log(`[Auth] registerCustomer (${source}) result:`, JSON.stringify({ success: result.success, error: result.error, hasUser: !!result.user, hasToken: !!result.token }));
      if (result.success && result.user) {
        const customer: User = {
          id: result.user.id,
          name: result.user.name,
          phone: result.user.phone,
          email: result.user.email,
          type: 'customer',
          gender: result.user.gender as 'male' | 'female' | undefined,
          city: result.user.city,
          district: result.user.district,
          vehiclePlate: vehiclePlate || undefined,
          referralCode: result.user.referralCode,
          freeRidesRemaining: result.user.freeRidesRemaining || 0,
        };
        setUser(customer);
        setUserType('customer');
        setIsAuthenticated(true);

        const persistenceTasks: Promise<unknown>[] = [
          AsyncStorage.setItem('auth_user', JSON.stringify(customer)),
          AsyncStorage.setItem('auth_credentials', JSON.stringify({
            type: 'customer', name, phone: normalizedPhone, email, gender, city, district, vehiclePlate,
          })),
          persistLocalAuthBackup(customer, password),
          saveRememberedLogin(email, password, 'customer'),
          saveRememberedPhone(normalizedPhone, 'customer'),
          saveRememberedPhoneAccount(normalizedPhone, customer.email, 'customer'),
        ];

        if (result.token) {
          persistenceTasks.unshift(setSessionToken(result.token));
        }

        await queueAuthPersistence(`register-customer:${email}`, persistenceTasks);
        console.log('[Auth] Registered customer:', customer.id);
        return;
      }
      throw new Error(result.error ?? 'Kayıt oluşturulamadı. Lütfen tekrar deneyin.');
    };

    try {
      const backendReady = await ensureBackendAuthReady('customer-register', true);
      if (!backendReady) {
        console.log('[Auth] customer-register bootstrap not confirmed, trying direct register anyway');
      }
      console.log('[Auth] registerCustomer called for:', email, '(REST)');
      const result = await directFetch('/auth/register-customer', payload);
      console.log('[Auth] REST register result:', JSON.stringify(result).substring(0, 500));
      if (result && result.success === false && result.error) {
        throw new Error(result.error);
      }
      await handleSuccess(result, 'REST');
      return;
    } catch (err: any) {
      console.log('[Auth] registerCustomer error:', err?.message);
      if (err instanceof Error) throw err;
      throw new Error('Sunucuya bağlanılamadı. Lütfen tekrar deneyin.');
    }
  }, [directFetch, ensureBackendAuthReady, persistLocalAuthBackup, queueAuthPersistence, saveRememberedLogin, saveRememberedPhone, saveRememberedPhoneAccount]);

  const registerDriver = useCallback(async (
    name: string,
    phone: string,
    email: string,
    password: string,
    vehiclePlate: string,
    vehicleModel: string,
    vehicleColor: string,
    partnerName: string,
    city: string,
    district: string,
    licenseIssueDate?: string,
    driverCategory?: 'driver' | 'scooter' | 'courier',
  ) => {
    const normalizedPhone = normalizeTurkishPhone(phone);
    const phoneValidationError = getTurkishPhoneValidationError(normalizedPhone);
    if (phoneValidationError) {
      throw new Error(phoneValidationError);
    }

    const payload = {
      name,
      phone: normalizedPhone,
      email,
      password,
      vehiclePlate: vehiclePlate || undefined,
      vehicleModel,
      vehicleColor,
      partnerDriverName: partnerName,
      licenseIssueDate,
      driverCategory: driverCategory ?? 'driver',
      city,
      district,
    };

    const handleDriverSuccess = async (result: any, source: string) => {
      console.log(`[Auth] registerDriver (${source}) result:`, JSON.stringify({ success: result.success, error: result.error, hasDriver: !!result.driver, hasToken: !!result.token }));
      if (result.success && result.driver) {
        const driver: Driver = {
          id: result.driver.id,
          name: result.driver.name,
          phone: result.driver.phone,
          email: result.driver.email,
          type: 'driver',
          driverCategory: result.driver.driverCategory as 'driver' | 'scooter' | 'courier' | undefined,
          vehiclePlate: result.driver.vehiclePlate,
          vehicleModel: result.driver.vehicleModel,
          vehicleColor: result.driver.vehicleColor,
          rating: result.driver.rating,
          totalRides: result.driver.totalRides,
          isOnline: result.driver.isOnline,
          isApproved: result.driver.isApproved ?? false,
          approvedAt: result.driver.approvedAt,
          licenseIssueDate: result.driver.licenseIssueDate,
          partnerDriverName: result.driver.partnerDriverName,
          dailyEarnings: result.driver.dailyEarnings,
          weeklyEarnings: result.driver.weeklyEarnings,
          monthlyEarnings: result.driver.monthlyEarnings,
          city: result.driver.city,
          district: result.driver.district,
        };
        setUser(driver);
        setUserType('driver');
        setIsAuthenticated(true);

        const persistenceTasks: Promise<unknown>[] = [
          AsyncStorage.setItem('auth_user', JSON.stringify(driver)),
          AsyncStorage.setItem('auth_credentials', JSON.stringify({
            type: 'driver', name, phone: normalizedPhone, email,
            vehiclePlate, vehicleModel, vehicleColor,
            partnerDriverName: partnerName, licenseIssueDate, driverCategory, city, district,
          })),
          persistLocalAuthBackup(driver, password),
          saveRememberedLogin(email, password, 'driver'),
          saveRememberedPhone(normalizedPhone, 'driver'),
          saveRememberedPhoneAccount(normalizedPhone, driver.email, 'driver'),
        ];

        if (result.token) {
          persistenceTasks.unshift(setSessionToken(result.token));
        }

        await queueAuthPersistence(`register-driver:${email}`, persistenceTasks);
        console.log('[Auth] Registered driver:', driver.id);
        return;
      }
      throw new Error(result.error ?? 'Şoför kaydı oluşturulamadı');
    };

    try {
      const backendReady = await ensureBackendAuthReady('driver-register', true);
      if (!backendReady) {
        console.log('[Auth] driver-register bootstrap not confirmed, trying direct register anyway');
      }
      console.log('[Auth] registerDriver called for:', email, '(REST)');
      const result = await directFetch('/auth/register-driver', payload);
      if (result && result.success === false && result.error) {
        throw new Error(result.error);
      }
      await handleDriverSuccess(result, 'REST');
      return;
    } catch (err: any) {
      console.log('[Auth] registerDriver error:', err?.message);
      if (err instanceof Error) throw err;
      throw new Error('Sunucuya bağlanılamadı. Lütfen tekrar deneyin.');
    }
  }, [directFetch, ensureBackendAuthReady, persistLocalAuthBackup, queueAuthPersistence, saveRememberedLogin, saveRememberedPhone, saveRememberedPhoneAccount]);

  const applyPromoCode = useCallback(async (code: string): Promise<boolean> => {
    if (code.toUpperCase() === PRICING.promoCode && !promoApplied) {
      setPromoApplied(true);
      setCompletedRides(0);
      await AsyncStorage.setItem('promo_applied', 'true');
      await AsyncStorage.setItem('completed_rides', '0');
      console.log('[Auth] Promo code applied:', code);
      return true;
    }
    return false;
  }, [promoApplied]);

  const incrementCompletedRides = useCallback(async () => {
    const newCount = completedRides + 1;
    setCompletedRides(newCount);
    await AsyncStorage.setItem('completed_rides', newCount.toString());
    console.log('[Auth] Completed rides:', newCount);
  }, [completedRides]);

  const getAccountFreeRides = useCallback((): number => {
    if (!user || user.type !== 'customer') {
      return 0;
    }
    return Math.max(0, user.freeRidesRemaining ?? 0);
  }, [user]);

  const consumeFreeRide = useCallback(async (preferredSource?: 'account' | 'promo'): Promise<boolean> => {
    const accountFreeRides = getAccountFreeRides();
    const promoFreeRides = promoApplied ? Math.max(0, PRICING.freeRidesWithPromo - completedRides) : 0;
    const shouldUsePromo = preferredSource === 'promo' && promoFreeRides > 0;
    const shouldUseAccount = preferredSource === 'account'
      ? accountFreeRides > 0
      : !shouldUsePromo && accountFreeRides > 0;

    if (shouldUseAccount && user?.type === 'customer') {
      const fallbackRemaining = Math.max(0, accountFreeRides - 1);

      try {
        const result = await trpcClient.auth.useFreeRide.mutate({ userId: user.id });
        if (!result.success) {
          throw new Error(result.error ?? 'Ücretsiz sürüş hakkı kullanılamadı');
        }

        const updatedUser: User = {
          ...user,
          freeRidesRemaining: Math.max(0, result.freeRidesRemaining ?? fallbackRemaining),
        };
        setUser(updatedUser);
        await AsyncStorage.setItem('auth_user', JSON.stringify(updatedUser));
        console.log('[Auth] Account free ride consumed for:', user.id, 'remaining:', updatedUser.freeRidesRemaining);
        return true;
      } catch (error) {
        console.log('[Auth] Account free ride consume error, applying local fallback:', error);
        const updatedUser: User = {
          ...user,
          freeRidesRemaining: fallbackRemaining,
        };
        setUser(updatedUser);
        await AsyncStorage.setItem('auth_user', JSON.stringify(updatedUser));
        return true;
      }
    }

    if (promoFreeRides > 0) {
      const newCount = completedRides + 1;
      setCompletedRides(newCount);
      await AsyncStorage.setItem('completed_rides', newCount.toString());
      console.log('[Auth] Promo free ride consumed. Completed rides:', newCount, 'remaining promo free rides:', Math.max(0, PRICING.freeRidesWithPromo - newCount));
      return true;
    }

    console.log('[Auth] consumeFreeRide called without available credits. Preferred source:', preferredSource ?? 'auto');
    return false;
  }, [completedRides, getAccountFreeRides, promoApplied, user]);

  const isFreeRide = useCallback((): boolean => {
    const accountFreeRides = getAccountFreeRides();
    if (accountFreeRides > 0) {
      return true;
    }
    return promoApplied && completedRides < PRICING.freeRidesWithPromo;
  }, [completedRides, getAccountFreeRides, promoApplied]);

  const remainingFreeRides = useCallback((): number => {
    const accountFreeRides = getAccountFreeRides();
    const promoFreeRides = promoApplied ? Math.max(0, PRICING.freeRidesWithPromo - completedRides) : 0;
    return accountFreeRides + promoFreeRides;
  }, [completedRides, getAccountFreeRides, promoApplied]);

  const addRideToHistory = useCallback(async (ride: Ride) => {
    const updated = [ride, ...rideHistory];
    setRideHistory(updated);
    await AsyncStorage.setItem('ride_history', JSON.stringify(updated));
    console.log('[Auth] Ride added to history:', ride.id, '| Total:', updated.length);
  }, [rideHistory]);

  const registerTeamMember = useCallback(async (
    name: string,
    phone: string,
    email: string,
    password: string,
    licenseIssueDate?: string,
  ): Promise<TeamMemberInfo> => {
    const driver = user as Driver;
    if (!driver || driver.type !== 'driver') {
      throw new Error('Şoför hesabı gerekli');
    }
    try {
      const result = await directFetch('/auth/register-driver', {
        name,
        phone,
        email,
        password,
        vehiclePlate: driver.vehiclePlate,
        vehicleModel: driver.vehicleModel,
        vehicleColor: driver.vehicleColor,
        partnerDriverName: driver.name,
        licenseIssueDate,
        city: driver.city ?? '',
        district: driver.district ?? '',
      });
      const memberId = (result.success && result.driver) ? result.driver.id : 'd_team_' + Date.now();
      const member: TeamMemberInfo = { id: memberId, name, email, phone };
      const updated = [...teamMembers, member];
      setTeamMembers(updated);
      await AsyncStorage.setItem(`team_members_${driver.id}`, JSON.stringify(updated));
      console.log('[Auth] Team member registered:', member.id, name);
      return member;
    } catch (e) {
      console.log('[Auth] Team member error, fallback:', e);
      const member: TeamMemberInfo = { id: 'd_team_' + Date.now(), name, email, phone };
      const updated = [...teamMembers, member];
      setTeamMembers(updated);
      await AsyncStorage.setItem(`team_members_${driver.id}`, JSON.stringify(updated));
      return member;
    }
  }, [user, teamMembers, directFetch]);

  const saveDriverDocuments = useCallback(async (documents: DriverDocuments, driverIdOverride?: string) => {
    try {
      const driverId = driverIdOverride || user?.id;
      if (!driverId) {
        const storedUser = await AsyncStorage.getItem('auth_user');
        if (storedUser) {
          const parsed = JSON.parse(storedUser);
          await AsyncStorage.setItem(`driver_documents_${parsed.id}`, JSON.stringify(documents));
          setDriverDocuments(documents);
          console.log('[Auth] Saved driver documents locally for:', parsed.id);
          try {
            await directFetch('/drivers/save-documents', {
              driverId: parsed.id,
              ...documents,
            });
            console.log('[Auth] Documents synced to backend for:', parsed.id);
          } catch (syncErr) {
            console.log('[Auth] Documents backend sync error (non-critical):', syncErr);
          }
        }
        return;
      }
      await AsyncStorage.setItem(`driver_documents_${driverId}`, JSON.stringify(documents));
      setDriverDocuments(documents);
      console.log('[Auth] Saved driver documents locally for:', driverId);
      try {
        await directFetch('/drivers/save-documents', {
          driverId,
          ...documents,
        });
        console.log('[Auth] Documents synced to backend for:', driverId);
      } catch (syncErr) {
        console.log('[Auth] Documents backend sync error (non-critical):', syncErr);
      }
    } catch (e) {
      console.log('[Auth] Save driver documents error:', e);
    }
  }, [directFetch, user]);

  const updateProfilePhoto = useCallback(async (uri: string) => {
    try {
      if (user) {
        await AsyncStorage.setItem(`profile_photo_${user.id}`, uri);
        setProfilePhoto(uri);
        console.log('[Auth] Updated profile photo for:', user.id);
      }
    } catch (e) {
      console.log('[Auth] Update profile photo error:', e);
    }
  }, [user]);

  const updateCustomVehicleImage = useCallback(async (uri: string | null) => {
    try {
      if (user) {
        setCustomVehicleImage(uri);
        console.log('[Auth] Updated custom vehicle image state for:', user.id);
        if (uri) {
          if (uri.length > 2 * 1024 * 1024) {
            console.log('[Auth] Vehicle image too large for AsyncStorage, compressing or skipping persist. Size:', uri.length);
            try {
              await AsyncStorage.setItem(`custom_vehicle_image_${user.id}`, uri);
              console.log('[Auth] Large vehicle image persisted successfully');
            } catch (storageErr) {
              console.log('[Auth] AsyncStorage write failed for large image, state is updated but not persisted:', storageErr);
            }
          } else {
            await AsyncStorage.setItem(`custom_vehicle_image_${user.id}`, uri);
          }
        } else {
          await AsyncStorage.removeItem(`custom_vehicle_image_${user.id}`);
        }
        console.log('[Auth] Updated custom vehicle image for:', user.id);
      }
    } catch (e) {
      console.log('[Auth] Update custom vehicle image error:', e);
    }
  }, [user]);

  const updateTeamMemberDocument = useCallback(async (memberId: string, field: keyof DriverDocuments, uri: string) => {
    try {
      if (user) {
        const memberDocs = teamMemberDocuments[memberId] ?? {};
        const updatedMemberDocs = { ...memberDocs, [field]: uri };
        const updated = { ...teamMemberDocuments, [memberId]: updatedMemberDocs };
        await AsyncStorage.setItem(`team_member_documents_${user.id}`, JSON.stringify(updated));
        setTeamMemberDocuments(updated);
        console.log('[Auth] Updated team member document:', memberId, field);

        try {
          await directFetch('/drivers/save-documents', {
            driverId: memberId,
            ...updatedMemberDocs,
          });
          console.log('[Auth] Team member documents synced to backend:', memberId);
        } catch (syncErr) {
          console.log('[Auth] Team member doc backend sync error (non-critical):', syncErr);
        }
      }
    } catch (e) {
      console.log('[Auth] Update team member document error:', e);
    }
  }, [user, teamMemberDocuments, directFetch]);

  const updateTeamMemberPhoto = useCallback(async (memberId: string, uri: string) => {
    try {
      if (user) {
        const updated = { ...teamMemberPhotos, [memberId]: uri };
        await AsyncStorage.setItem(`team_member_photos_${user.id}`, JSON.stringify(updated));
        setTeamMemberPhotos(updated);
        console.log('[Auth] Updated team member photo for:', memberId);
      }
    } catch (e) {
      console.log('[Auth] Update team member photo error:', e);
    }
  }, [user, teamMemberPhotos]);

  const updateDriverDocument = useCallback(async (field: keyof DriverDocuments, uri: string) => {
    try {
      const storedUser = await AsyncStorage.getItem('auth_user');
      if (storedUser) {
        const parsed = JSON.parse(storedUser);
        const updated = { ...driverDocuments, [field]: uri };
        await AsyncStorage.setItem(`driver_documents_${parsed.id}`, JSON.stringify(updated));
        setDriverDocuments(updated);
        console.log('[Auth] Updated driver document:', field);
      }
    } catch (e) {
      console.log('[Auth] Update driver document error:', e);
    }
  }, [driverDocuments]);

  const logout = useCallback(async () => {
    console.log('[Auth] Logout starting...');
    setUser(null);
    setUserType(null);
    setIsAuthenticated(false);
    setPromoApplied(false);
    setCompletedRides(0);
    setRideHistory([]);
    setTeamMembers([]);
    setDriverDocuments({});
    setProfilePhoto(null);
    setTeamMemberPhotos({});
    setTeamMemberDocuments({});
    setCustomVehicleImage(null);
    setDriverApproved(false);
    try {
      const token = await getSessionToken();
      await setSessionToken(null);
      await AsyncStorage.removeItem('auth_user');
      if (token) {
        directFetch('/auth/logout', { token }).catch(e =>
          console.log('[Auth] Logout request error (non-critical):', e)
        );
      }
    } catch (e) {
      console.log('[Auth] Logout cleanup error:', e);
    }
    console.log('[Auth] Logged out');
  }, [directFetch]);

  const value = useMemo(() => ({
    user,
    userType,
    isLoading,
    isAuthenticated,
    promoApplied,
    completedRides,
    rideHistory,
    loginAsCustomer,
    loginAsDriver,
    loginCustomerWithSocialAuth,
    sendCustomerLoginCode,
    sendDriverLoginCode,
    verifyCustomerLoginCode,
    verifyDriverLoginCode,
    registerCustomer,
    registerDriver,
    applyPromoCode,
    incrementCompletedRides,
    consumeFreeRide,
    isFreeRide,
    remainingFreeRides,
    addRideToHistory,
    teamMembers,
    registerTeamMember,
    driverDocuments,
    saveDriverDocuments,
    updateDriverDocument,
    profilePhoto,
    updateProfilePhoto,
    teamMemberPhotos,
    updateTeamMemberPhoto,
    teamMemberDocuments,
    updateTeamMemberDocument,
    customVehicleImage,
    updateCustomVehicleImage,
    driverApproved,
    hasLocalRecoveryAccount,
    recoverLocalPassword,
    getRememberedLogin,
    getRememberedPhone,
    ensureServerSession,
    updateAccountPhone,
    logout,
  }), [
    user,
    userType,
    isLoading,
    isAuthenticated,
    promoApplied,
    completedRides,
    rideHistory,
    loginAsCustomer,
    loginAsDriver,
    loginCustomerWithSocialAuth,
    sendCustomerLoginCode,
    sendDriverLoginCode,
    verifyCustomerLoginCode,
    verifyDriverLoginCode,
    registerCustomer,
    registerDriver,
    applyPromoCode,
    incrementCompletedRides,
    consumeFreeRide,
    isFreeRide,
    remainingFreeRides,
    addRideToHistory,
    teamMembers,
    registerTeamMember,
    driverDocuments,
    saveDriverDocuments,
    updateDriverDocument,
    profilePhoto,
    updateProfilePhoto,
    teamMemberPhotos,
    updateTeamMemberPhoto,
    teamMemberDocuments,
    updateTeamMemberDocument,
    customVehicleImage,
    updateCustomVehicleImage,
    driverApproved,
    hasLocalRecoveryAccount,
    recoverLocalPassword,
    getRememberedLogin,
    getRememberedPhone,
    ensureServerSession,
    updateAccountPhone,
    logout,
  ]);

  return value;
});
