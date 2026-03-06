import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import createContextHook from '@nkzw/create-context-hook';
import type { User, Driver, Ride, DriverDocuments } from '@/constants/mockData';
import { PRICING } from '@/constants/pricing';
import { setSessionToken, getSessionToken, getBaseUrl, normalizeApiBaseUrl, waitForBaseUrl } from '@/lib/trpc';

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

const LOCAL_AUTH_PREFIX = 'local_auth_backup_';

function normalizeAuthEmail(email: string): string {
  return email.toLowerCase().trim();
}

function buildLocalAuthKey(email: string): string {
  return `${LOCAL_AUTH_PREFIX}${normalizeAuthEmail(email)}`;
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

  const getApiBase = useCallback((): string => {
    return getBaseUrl();
  }, []);

  const getDbHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const dbEndpoint = process.env.EXPO_PUBLIC_RORK_DB_ENDPOINT;
    const dbNamespace = process.env.EXPO_PUBLIC_RORK_DB_NAMESPACE;
    const dbToken = process.env.EXPO_PUBLIC_RORK_DB_TOKEN;
    if (dbEndpoint) headers['x-db-endpoint'] = dbEndpoint;
    if (dbNamespace) headers['x-db-namespace'] = dbNamespace;
    if (dbToken) headers['x-db-token'] = dbToken;
    return headers;
  }, []);

  const directFetch = useCallback(async (path: string, body: Record<string, any>, retryCount = 0): Promise<any> => {
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
        return directFetch(path, body, retryCount + 1);
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
      const res = await fetch(url, {
        method: 'POST',
        headers: getDbHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      console.log('[Auth] directFetch status:', res.status);

      if (res.status === 404) {
        if (retryCount < MAX_RETRIES) {
          const delay = 1500;
          console.log(`[Auth] 404 - retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          return directFetch(path, body, retryCount + 1);
        }
        throw new Error('Sunucu şu an erişilemiyor. Lütfen uygulamayı kapatıp tekrar açın.');
      }

      if (res.status === 429) {
        throw new Error('Sunucu meşgul. Lütfen 30 saniye bekleyip tekrar deneyin.');
      }

      if (res.status === 503 || res.status === 502) {
        if (retryCount < MAX_RETRIES) {
          const delay = 1500;
          await new Promise(r => setTimeout(r, delay));
          return directFetch(path, body, retryCount + 1);
        }
        throw new Error('Sunucu geçici olarak kullanılamıyor. Lütfen tekrar deneyin.');
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
          return directFetch(path, body, retryCount + 1);
        }
        throw new Error(serverMsg || 'Sunucu geçici bir hata yaşıyor. Lütfen tekrar deneyin.');
      }

      const contentType = res.headers.get('content-type') || '';
      const responseText = await res.text();

      if (!contentType.includes('application/json') && responseText.includes('<!DOCTYPE html>')) {
        if (retryCount < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1500));
          return directFetch(path, body, retryCount + 1);
        }
        throw new Error('Sunucu geçici olarak kullanılamıyor. Lütfen tekrar deneyin.');
      }

      console.log('[Auth] directFetch response:', responseText.substring(0, 300));

      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error('Sunucu geçersiz yanıt döndü. Lütfen tekrar deneyin.');
      }

      return data;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === 'AbortError') {
        if (retryCount < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000));
          return directFetch(path, body, retryCount + 1);
        }
        throw new Error('Sunucu yanıt vermedi (zaman aşımı). Lütfen tekrar deneyin.');
      }
      if (isNetworkError(err?.message || '')) {
        if (retryCount < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000));
          return directFetch(path, body, retryCount + 1);
        }
      }
      if (err instanceof Error) throw err;
      throw new Error('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
    }
  }, [getApiBase, getDbHeaders]);

  const setAuthenticatedLocalUser = useCallback(async (localUser: User | Driver, source: string): Promise<UserType> => {
    await setSessionToken(null);
    setUser(localUser);
    setUserType(localUser.type);
    setIsAuthenticated(true);
    await AsyncStorage.setItem('auth_user', JSON.stringify(localUser));
    console.log('[Auth] Local auth session restored from', source, 'for:', localUser.email, 'type:', localUser.type);
    return localUser.type;
  }, []);

  const getLocalAuthBackup = useCallback(async (email: string): Promise<LocalAuthBackup | null> => {
    const normalizedEmail = normalizeAuthEmail(email);
    if (!normalizedEmail) {
      return null;
    }

    try {
      const raw = await SecureStore.getItemAsync(buildLocalAuthKey(normalizedEmail));
      if (!raw) {
        return null;
      }

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
      console.log('[Auth] getLocalAuthBackup error:', error);
      return null;
    }
  }, []);

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

    await SecureStore.setItemAsync(buildLocalAuthKey(normalizedEmail), JSON.stringify(backup));
    console.log('[Auth] Local auth backup saved for:', normalizedEmail, 'type:', account.type);
  }, []);

  const hasLocalRecoveryAccount = useCallback(async (email: string): Promise<boolean> => {
    const backup = await getLocalAuthBackup(email);
    if (backup) {
      return true;
    }

    const legacyUser = await buildLegacyLocalUser(email);
    return !!legacyUser;
  }, [buildLegacyLocalUser, getLocalAuthBackup]);

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
    return lowerMessage.includes('kullanıcı bulunamadı') ||
      lowerMessage.includes('şifremi unuttum') ||
      lowerMessage.includes('kayıtlı hesap bulunamadı') ||
      lowerMessage.includes('sunucuya bağlanılamadı') ||
      isNetworkError(lowerMessage);
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
      throw new Error('Bu cihazda kayıtlı bir hesap yedeği bulunamadı. Lütfen şifrenizi yeniden oluşturun.');
    }

    const passwordHash = await hashLocalPassword(password);
    if (backup.passwordHash !== passwordHash) {
      console.log('[Auth] tryLocalLogin - password mismatch for:', normalizedEmail);
      throw new Error('Şifre hatalı');
    }

    if (requestedType === 'driver' && backup.type !== 'driver') {
      throw new Error('Bu e-posta ile kayıtlı şoför hesabı bulunamadı');
    }

    return setAuthenticatedLocalUser({
      ...backup.user,
      email: normalizedEmail,
    } as User | Driver, 'secure-backup');
  }, [getLocalAuthBackup, setAuthenticatedLocalUser]);

  const handleSessionInvalid = useCallback(async () => {
    console.log('[Auth] Session invalid, logging out...');
    await setSessionToken(null);
    setUser(null);
    setUserType(null);
    setIsAuthenticated(false);
    await AsyncStorage.removeItem('auth_user');
  }, []);

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const token = await getSessionToken();
        const stored = await AsyncStorage.getItem('auth_user');

        if (token && stored) {
          const parsed = JSON.parse(stored);
          setUser(parsed);
          setUserType(parsed.type);
          setIsAuthenticated(true);
          console.log('[Auth] Session restored for:', parsed.id, parsed.name);

          console.log('[Auth] Using cached session, skipping immediate validation to reduce server load');
        } else if (token && !stored) {
          console.log('[Auth] Token exists but no stored user, clearing stale token');
          await setSessionToken(null);
        } else if (stored && !token) {
          console.log('[Auth] No session token found, clearing stale local data');
          await AsyncStorage.removeItem('auth_user');
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
      } finally {
        setIsLoading(false);
      }
    };
    void loadAuth();
  }, [handleSessionInvalid]);

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

  const handleLoginSuccess = useCallback(async (result: any, email: string, source: string): Promise<UserType> => {
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

      if (result.token) {
        await setSessionToken(result.token);
      }
      returnedUser.type = actualType;
      setUser(returnedUser);
      setUserType(actualType);
      setIsAuthenticated(true);
      await AsyncStorage.setItem('auth_user', JSON.stringify(returnedUser));
      console.log('[Auth] Logged in as', actualType, ':', returnedUser.id, returnedUser.name);
      return actualType;
    }
    throw new Error(result.error ?? 'Mail adresiniz veya şifreniz hatalı');
  }, []);

  const loginAsCustomer = useCallback(async (email?: string, password?: string) => {
    if (!email || !password) {
      throw new Error('E-posta ve şifre gerekli');
    }

    try {
      console.log('[Auth] loginAsCustomer called for:', email, '(REST)');
      const result = await directFetch('/auth/login', { email, password, type: 'customer' });
      if (result && result.success === false && result.error) {
        throw new Error(result.error);
      }
      return await handleLoginSuccess(result, email, 'REST');
    } catch (err: any) {
      console.log('[Auth] loginAsCustomer error:', err?.message);
      const errorMessage = err instanceof Error ? err.message : '';
      if (shouldTryLocalAuthFallback(errorMessage)) {
        return tryLocalLogin(email, password, 'customer');
      }
      if (err instanceof Error) throw err;
      throw new Error('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
    }
  }, [directFetch, handleLoginSuccess, shouldTryLocalAuthFallback, tryLocalLogin]);

  const loginAsDriver = useCallback(async (email?: string, password?: string) => {
    if (!email || !password) {
      throw new Error('E-posta ve şifre gerekli');
    }

    try {
      console.log('[Auth] loginAsDriver called for:', email, '(REST)');
      const result = await directFetch('/auth/login', { email, password, type: 'driver' });
      if (result && result.success === false && result.error) {
        throw new Error(result.error);
      }
      return await handleLoginSuccess(result, email, 'REST');
    } catch (err: any) {
      console.log('[Auth] loginAsDriver error:', err?.message);
      const errorMessage = err instanceof Error ? err.message : '';
      if (shouldTryLocalAuthFallback(errorMessage)) {
        return tryLocalLogin(email, password, 'driver');
      }
      if (err instanceof Error) throw err;
      throw new Error('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.');
    }
  }, [directFetch, handleLoginSuccess, shouldTryLocalAuthFallback, tryLocalLogin]);

  const registerCustomer = useCallback(async (name: string, phone: string, email: string, password: string, gender: 'male' | 'female', city: string, district: string, vehiclePlate?: string, referralCode?: string) => {
    const payload = { name, phone, email, password, gender, city, district, referralCode: referralCode || undefined };

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
        if (result.token) {
          await setSessionToken(result.token);
        }
        setUser(customer);
        setUserType('customer');
        setIsAuthenticated(true);
        await AsyncStorage.setItem('auth_user', JSON.stringify(customer));
        await AsyncStorage.setItem('auth_credentials', JSON.stringify({
          type: 'customer', name, phone, email, gender, city, district, vehiclePlate,
        }));
        await persistLocalAuthBackup(customer, password);
        console.log('[Auth] Registered customer:', customer.id);
        return;
      }
      throw new Error(result.error ?? 'Kayıt oluşturulamadı. Lütfen tekrar deneyin.');
    };

    try {
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
  }, [directFetch, persistLocalAuthBackup]);

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
    const payload = {
      name,
      phone,
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
        if (result.token) {
          await setSessionToken(result.token);
        }
        setUser(driver);
        setUserType('driver');
        setIsAuthenticated(true);
        await AsyncStorage.setItem('auth_user', JSON.stringify(driver));
        await AsyncStorage.setItem('auth_credentials', JSON.stringify({
          type: 'driver', name, phone, email,
          vehiclePlate, vehicleModel, vehicleColor,
          partnerDriverName: partnerName, licenseIssueDate, driverCategory, city, district,
        }));
        await persistLocalAuthBackup(driver, password);
        console.log('[Auth] Registered driver:', driver.id);
        return;
      }
      throw new Error(result.error ?? 'Şoför kaydı oluşturulamadı');
    };

    try {
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
  }, [directFetch, persistLocalAuthBackup]);

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

  const isFreeRide = useCallback((): boolean => {
    return promoApplied && completedRides < PRICING.freeRidesWithPromo;
  }, [promoApplied, completedRides]);

  const remainingFreeRides = useCallback((): number => {
    if (!promoApplied) return 0;
    return Math.max(0, PRICING.freeRidesWithPromo - completedRides);
  }, [promoApplied, completedRides]);

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
    registerCustomer,
    registerDriver,
    applyPromoCode,
    incrementCompletedRides,
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
    registerCustomer,
    registerDriver,
    applyPromoCode,
    incrementCompletedRides,
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
    logout,
  ]);

  return value;
});
