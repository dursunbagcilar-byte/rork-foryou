import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  Alert,
  Image,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Car, ShieldCheck, Smartphone, User } from 'lucide-react-native';
import { useMutation } from '@tanstack/react-query';
import { APP_BRAND } from '@/constants/branding';
import { VerificationCodeModal } from '@/components/VerificationCodeModal';
import { useAuth } from '@/contexts/AuthContext';
import { getTurkishPhoneValidationError, normalizeTurkishPhone } from '@/utils/phone';
import { getClientEnv } from '@/utils/clientEnv';
import { keyboardAvoidingBehavior, keyboardVerticalOffset } from '@/utils/platform';

type LoginMode = 'customer' | 'driver';
type QuickAccessProvider = 'google' | 'apple';

interface LoginCodeResponse {
  maskedPhone?: string | null;
  deliveryNote?: string | null;
  smsProvider?: string | null;
  actualType?: LoginMode | null;
  localAuthenticatedType?: LoginMode | null;
  localFallbackUsed?: boolean;
}

interface GoogleUserProfile {
  id?: string;
  email?: string;
  name?: string;
  picture?: string;
}

interface AppleFullName {
  givenName?: string | null;
  familyName?: string | null;
}

interface AppleCredentialResult {
  user?: string | null;
  email?: string | null;
  fullName?: AppleFullName | null;
}

interface AppleAuthenticationModuleLike {
  signInAsync: (options: { requestedScopes: number[] }) => Promise<AppleCredentialResult>;
  AppleAuthenticationScope: {
    FULL_NAME: number;
    EMAIL: number;
  };
}

interface AuthSessionResultLike {
  type: string;
  authentication?: {
    accessToken?: string | null;
  } | null;
  params?: Record<string, string | undefined> | null;
}

interface AuthRequestConfigLike {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scopes: string[];
  extraParams?: Record<string, string>;
}

interface AuthRequestInstanceLike {
  promptAsync: (discovery: { authorizationEndpoint: string }) => Promise<AuthSessionResultLike>;
}

interface AuthSessionModuleLike {
  makeRedirectUri: (options?: { scheme?: string; path?: string; native?: string }) => string;
  ResponseType: {
    Token: string;
  };
  AuthRequest: new (config: AuthRequestConfigLike) => AuthRequestInstanceLike;
}

const GOOGLE_WEB_CLIENT_ID = getClientEnv('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
const GOOGLE_ANDROID_CLIENT_ID = getClientEnv('EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID');
const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

function formatPhoneInput(value: string): string {
  const digits = normalizeTurkishPhone(value);
  const parts = [
    digits.slice(0, 4),
    digits.slice(4, 7),
    digits.slice(7, 9),
    digits.slice(9, 11),
  ].filter(Boolean);

  return parts.join(' ');
}

function buildAppleDisplayName(
  fullName: AppleFullName | null | undefined,
  fallbackName?: string | null
): string {
  const nameParts = [fullName?.givenName?.trim(), fullName?.familyName?.trim()].filter(Boolean);
  if (nameParts.length > 0) {
    return nameParts.join(' ');
  }

  return fallbackName?.trim() || 'Apple Kullanıcısı';
}

async function fetchGoogleProfile(accessToken: string): Promise<GoogleUserProfile> {
  console.log('[Login] Fetching Google profile');
  const response = await fetch('https://www.googleapis.com/userinfo/v2/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Google profil bilgisi alınamadı.');
  }

  return await response.json() as GoogleUserProfile;
}

function getGoogleRedirectUri(authSession: AuthSessionModuleLike): string {
  if (Platform.OS === 'web') {
    return authSession.makeRedirectUri({ path: 'login' });
  }

  return authSession.makeRedirectUri({
    scheme: 'rork-app',
    path: 'login',
    native: 'rork-app://login',
  });
}

function getGoogleAccessToken(response: AuthSessionResultLike): string {
  return response.authentication?.accessToken ?? (typeof response.params?.access_token === 'string' ? response.params.access_token : '');
}

async function startGoogleOAuthAsync(clientId: string): Promise<GoogleUserProfile> {
  const authSessionModule = await import('expo-auth-session');
  const authSession = authSessionModule as unknown as AuthSessionModuleLike;
  const redirectUri = getGoogleRedirectUri(authSession);

  console.log('[Login] Starting Google OAuth', {
    platform: Platform.OS,
    redirectUri,
    hasClientId: Boolean(clientId),
  });

  const request = new authSession.AuthRequest({
    clientId,
    redirectUri,
    responseType: authSession.ResponseType.Token,
    scopes: ['openid', 'profile', 'email'],
    extraParams: {
      prompt: 'select_account',
    },
  });

  const response = await request.promptAsync({
    authorizationEndpoint: GOOGLE_AUTHORIZATION_ENDPOINT,
  });

  console.log('[Login] Google OAuth response type:', response.type);

  if (response.type === 'cancel' || response.type === 'dismiss') {
    throw new Error('__oauth_cancelled__');
  }

  if (response.type !== 'success') {
    throw new Error('Google hesabı doğrulanamadı.');
  }

  const accessToken = getGoogleAccessToken(response);
  if (!accessToken) {
    throw new Error('Google erişim anahtarı alınamadı.');
  }

  return await fetchGoogleProfile(accessToken);
}

async function startAppleSignInAsync(): Promise<AppleCredentialResult> {
  const appleAuthModule = await import('expo-apple-authentication');
  const appleAuth = appleAuthModule as unknown as AppleAuthenticationModuleLike;

  return await appleAuth.signInAsync({
    requestedScopes: [
      appleAuth.AppleAuthenticationScope.FULL_NAME,
      appleAuth.AppleAuthenticationScope.EMAIL,
    ],
  });
}

export default function LoginScreen() {
  const router = useRouter();
  const {
    sendCustomerLoginCode,
    sendDriverLoginCode,
    verifyCustomerLoginCode,
    verifyDriverLoginCode,
    getRememberedPhone,
    loginCustomerWithSocialAuth,
  } = useAuth();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<LoginMode>('customer');
  const [phone, setPhone] = useState<string>('');
  const [pendingPhone, setPendingPhone] = useState<string>('');
  const [verificationCode, setVerificationCode] = useState<string>('');
  const [showVerificationModal, setShowVerificationModal] = useState<boolean>(false);
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null);
  const [providerName, setProviderName] = useState<string | null>(null);
  const [tabWidth, setTabWidth] = useState<number>(160);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const isSmall = width < 360;
  const isTablet = width >= 600;
  const normalizedPhone = useMemo(() => normalizeTurkishPhone(phone), [phone]);
  const googleClientId = Platform.OS === 'web' ? GOOGLE_WEB_CLIENT_ID : GOOGLE_ANDROID_CLIENT_ID;
  const isGoogleConfigured = Boolean(googleClientId);

  const switchMode = useCallback((newMode: LoginMode) => {
    Animated.spring(slideAnim, {
      toValue: newMode === 'customer' ? 0 : 1,
      useNativeDriver: true,
    }).start();
    setMode(newMode);
    setVerificationCode('');
    setPendingPhone('');
    setShowVerificationModal(false);
  }, [slideAnim]);

  useEffect(() => {
    let isMounted = true;

    const restoreLastUsedMode = async () => {
      try {
        const [customerRemembered, driverRemembered] = await Promise.all([
          getRememberedPhone('customer'),
          getRememberedPhone('driver'),
        ]);

        if (!isMounted) {
          return;
        }

        const customerUpdatedAt = customerRemembered ? new Date(customerRemembered.updatedAt).getTime() : 0;
        const driverUpdatedAt = driverRemembered ? new Date(driverRemembered.updatedAt).getTime() : 0;

        if (!customerUpdatedAt && !driverUpdatedAt) {
          return;
        }

        const nextMode: LoginMode = driverUpdatedAt > customerUpdatedAt ? 'driver' : 'customer';
        setMode(nextMode);
        slideAnim.setValue(nextMode === 'customer' ? 0 : 1);
        console.log('[Login] Restored mode from remembered phone:', nextMode);
      } catch (error) {
        console.log('[Login] restoreLastUsedMode error:', error);
      }
    };

    void restoreLastUsedMode();

    return () => {
      isMounted = false;
    };
  }, [getRememberedPhone, slideAnim]);

  useEffect(() => {
    let isMounted = true;

    const loadRememberedPhone = async () => {
      try {
        const remembered = await getRememberedPhone(mode);
        if (!isMounted) {
          return;
        }

        if (remembered?.phone) {
          setPhone(formatPhoneInput(remembered.phone));
          console.log('[Login] Remembered phone restored for type:', remembered.type);
          return;
        }

        setPhone('');
      } catch (error) {
        console.log('[Login] loadRememberedPhone error:', error);
      }
    };

    void loadRememberedPhone();

    return () => {
      isMounted = false;
    };
  }, [getRememberedPhone, mode]);

  const sendCodeMutation = useMutation<LoginCodeResponse, unknown, string>({
    mutationFn: async (targetPhone: string): Promise<LoginCodeResponse> => {
      if (mode === 'customer') {
        return await sendCustomerLoginCode(targetPhone) as LoginCodeResponse;
      }

      return await sendDriverLoginCode(targetPhone) as LoginCodeResponse;
    },
    onSuccess: (result, targetPhone) => {
      if (result.localAuthenticatedType) {
        setPendingPhone('');
        setVerificationCode('');
        setMaskedPhone(null);
        setDeliveryNote(null);
        setProviderName(null);
        setShowVerificationModal(false);
        console.log('[Login] Local phone fallback success for:', targetPhone, 'type:', result.localAuthenticatedType);
        if (result.localAuthenticatedType === 'driver') {
          router.replace('/(driver-tabs)/map');
        } else {
          router.replace('/(customer-tabs)/dashboard');
        }
        return;
      }

      setPendingPhone(targetPhone);
      setVerificationCode('');
      setMaskedPhone(result.maskedPhone ?? targetPhone);
      setDeliveryNote(result.deliveryNote ?? null);
      setProviderName(result.smsProvider === 'netgsm' ? 'NetGSM' : null);
      setShowVerificationModal(true);
      console.log('[Login] SMS login code sent for:', targetPhone, 'type:', mode);
    },
    onError: (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : 'SMS kodu gönderilemedi. Lütfen tekrar deneyin.';
      console.log('[Login] sendCode error:', error);
      Alert.alert('Kod Gönderilemedi', errorMessage);
    },
  });

  const verifyCodeMutation = useMutation<string, unknown, { targetPhone: string; code: string }>({
    mutationFn: async ({ targetPhone, code }): Promise<string> => {
      if (mode === 'customer') {
        return await verifyCustomerLoginCode(targetPhone, code);
      }

      return await verifyDriverLoginCode(targetPhone, code);
    },
    onSuccess: (actualType) => {
      setShowVerificationModal(false);
      setVerificationCode('');
      console.log('[Login] Phone login success, actual type:', actualType);
      if (actualType === 'driver') {
        router.replace('/(driver-tabs)/map');
      } else {
        router.replace('/(customer-tabs)/dashboard');
      }
    },
    onError: (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : 'SMS doğrulaması başarısız oldu.';
      console.log('[Login] verifyCode error:', error);
      Alert.alert('Giriş Başarısız', errorMessage);
    },
  });

  const _quickAccessMutation = useMutation<void, unknown, QuickAccessProvider>({
    mutationFn: async (provider): Promise<void> => {
      console.log('[Login] Quick access requested with provider:', provider);

      if (provider === 'apple') {
        if (Platform.OS !== 'ios') {
          throw new Error('Apple ile devam et yalnızca iPhone üzerinde kullanılabilir.');
        }

        const credential = await startAppleSignInAsync();

        if (!credential.user) {
          throw new Error('Apple hesabı doğrulanamadı.');
        }

        const displayName = buildAppleDisplayName(credential.fullName, null);
        await loginCustomerWithSocialAuth({
          provider: 'apple',
          providerUserId: credential.user,
          email: credential.email ?? undefined,
          name: displayName,
          avatar: null,
        });
        return;
      }

      if (!isGoogleConfigured) {
        throw new Error('Google OAuth yapılandırması eksik.');
      }

      const profile = await startGoogleOAuthAsync(googleClientId);
      const providerUserId = profile.id?.trim() || profile.email?.trim() || '';
      if (!providerUserId) {
        throw new Error('Google kullanıcı bilgisi eksik.');
      }

      await loginCustomerWithSocialAuth({
        provider: 'google',
        providerUserId,
        email: profile.email ?? undefined,
        name: profile.name ?? undefined,
        avatar: profile.picture ?? undefined,
      });
    },
    onSuccess: () => {
      console.log('[Login] Customer quick access success');
      router.replace('/(customer-tabs)/dashboard');
    },
    onError: (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : 'Hızlı giriş başlatılamadı.';
      console.log('[Login] quickAccess error:', error);
      if (errorMessage === '__oauth_cancelled__') {
        return;
      }
      Alert.alert('Hızlı Giriş Kullanılamadı', errorMessage);
    },
  });

  void _quickAccessMutation;

  const handleSendCode = useCallback(() => {
    const phoneValidationError = getTurkishPhoneValidationError(normalizedPhone);
    if (phoneValidationError) {
      Alert.alert('Uyarı', phoneValidationError);
      return;
    }

    sendCodeMutation.mutate(normalizedPhone);
  }, [normalizedPhone, sendCodeMutation]);

  const handleVerifyCode = useCallback(() => {
    const targetPhone = pendingPhone || normalizedPhone;
    if (!targetPhone) {
      Alert.alert('Uyarı', 'Önce telefon numaranıza kod gönderin');
      return;
    }

    if (verificationCode.trim().length !== 6) {
      Alert.alert('Uyarı', 'Lütfen 6 haneli SMS kodunu girin');
      return;
    }

    verifyCodeMutation.mutate({
      targetPhone,
      code: verificationCode.trim(),
    });
  }, [normalizedPhone, pendingPhone, verificationCode, verifyCodeMutation]);

  const handleResendCode = useCallback(() => {
    const targetPhone = pendingPhone || normalizedPhone;
    const phoneValidationError = getTurkishPhoneValidationError(targetPhone);
    if (phoneValidationError) {
      Alert.alert('Uyarı', phoneValidationError);
      return;
    }

    sendCodeMutation.mutate(targetPhone);
  }, [normalizedPhone, pendingPhone, sendCodeMutation]);

  const indicatorTranslate = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, tabWidth],
  });

  const topBarTop = insets.top + 10;
  const heroHeight = height * (isSmall ? 0.12 : 0.15);
  const imgHeight = height * (isSmall ? 0.45 : 0.55);
  const loading = sendCodeMutation.isPending || verifyCodeMutation.isPending;
  const actionLabel = sendCodeMutation.isPending ? 'SMS Kodu Gönderiliyor...' : 'SMS ile Giriş Yap';
  const subtitle = 'Kayıtlı telefon numaranıza gelen SMS kodu ile devam edin';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <Image
        source={{ uri: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1200&q=80' }}
        style={[styles.bgImage, { width, height: imgHeight }]}
        resizeMode="cover"
      />
      <View style={[styles.bgOverlay, { width, height: imgHeight }]} />
      <KeyboardAvoidingView
        behavior={keyboardAvoidingBehavior()}
        style={styles.flex}
        keyboardVerticalOffset={keyboardVerticalOffset()}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.topBar, { top: topBarTop, left: isSmall ? 16 : 20 }]}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()} testID="back-button">
              <ArrowLeft size={isSmall ? 20 : 22} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={[styles.heroSection, { paddingHorizontal: isSmall ? 20 : isTablet ? 48 : 28, paddingTop: heroHeight }]}>
            <Text style={[styles.brand, { fontSize: isSmall ? 38 : isTablet ? 56 : 48 }]}>{APP_BRAND}</Text>
            <Text style={[styles.tagline, { fontSize: isSmall ? 13 : isTablet ? 18 : 16 }]}>Telefonla Güvenli Giriş</Text>
          </View>

          <View style={[styles.formCard, {
            paddingHorizontal: isSmall ? 18 : isTablet ? 40 : 24,
            paddingTop: isSmall ? 24 : 32,
            paddingBottom: Platform.OS === 'ios' ? Math.max(insets.bottom, 30) + 16 : 36,
            maxWidth: isTablet ? 500 : undefined,
            alignSelf: isTablet ? 'center' : undefined,
            width: isTablet ? '90%' : undefined,
          }]}>
            <Text style={[styles.title, { fontSize: isSmall ? 24 : isTablet ? 32 : 28 }]}>Giriş Yap</Text>
            <Text style={[styles.subtitle, { fontSize: isSmall ? 12 : 14 }]}>{subtitle}</Text>

            <View
              style={styles.tabContainer}
              onLayout={(event) => {
                const containerWidth = event.nativeEvent.layout.width;
                const padding = 8;
                setTabWidth((containerWidth - padding) / 2);
              }}
            >
              <Animated.View style={[styles.tabIndicator, { width: tabWidth, transform: [{ translateX: indicatorTranslate }] }]} />
              <TouchableOpacity
                style={styles.tab}
                onPress={() => switchMode('customer')}
                testID="customer-tab"
              >
                <User size={isSmall ? 13 : 15} color={mode === 'customer' ? '#0A0A12' : 'rgba(255,255,255,0.5)'} />
                <Text style={[styles.tabText, mode === 'customer' && styles.tabTextActive, { fontSize: isSmall ? 12 : 14 }]}>Müşteri</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.tab}
                onPress={() => switchMode('driver')}
                testID="driver-tab"
              >
                <Car size={isSmall ? 13 : 15} color={mode === 'driver' ? '#0A0A12' : 'rgba(255,255,255,0.5)'} />
                <Text style={[styles.tabText, mode === 'driver' && styles.tabTextActive, { fontSize: isSmall ? 12 : 14 }]}>Şoför</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <View style={[styles.inputWrapper, { paddingHorizontal: isSmall ? 12 : 16, borderRadius: isSmall ? 12 : 14 }]}>
                <Smartphone size={isSmall ? 16 : 18} color="rgba(255,255,255,0.35)" />
                <TextInput
                  style={[styles.input, { paddingVertical: isSmall ? 13 : 16, fontSize: isSmall ? 14 : 16 }]}
                  placeholder="0555 123 45 67"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  value={phone}
                  onChangeText={(value) => setPhone(formatPhoneInput(value))}
                  testID="phone-input"
                />
              </View>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoIconWrap}>
                <ShieldCheck size={18} color="#F5A623" />
              </View>
              <View style={styles.infoCopy}>
                <Text style={styles.infoTitle}>Şifresiz giriş açık</Text>
                <Text style={styles.infoText}>Kod sadece kayıtlı numaranıza gider. Başka cihazda da aynı telefon numarasıyla giriş yapabilirsiniz.</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.loginButton, loading && styles.loginButtonDisabled, { paddingVertical: isSmall ? 15 : 18, borderRadius: isSmall ? 12 : 16 }]}
              onPress={handleSendCode}
              disabled={loading}
              activeOpacity={0.85}
              testID="submit-login"
            >
              <Text style={[styles.loginButtonText, { fontSize: isSmall ? 15 : 17 }]}>{actionLabel}</Text>
            </TouchableOpacity>

            <View style={styles.registerRow}>
              <Text style={[styles.registerLabel, { fontSize: isSmall ? 12 : 14 }]}>Hesabınız yok mu?</Text>
              <TouchableOpacity onPress={() => router.push(mode === 'customer' ? '/register-customer' : '/register-driver')}>
                <Text style={[styles.registerLink, { fontSize: isSmall ? 12 : 14 }]}>Kayıt Ol</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <VerificationCodeModal
        visible={showVerificationModal}
        title="SMS ile giriş"
        subtitle="Telefonunuza gelen 6 haneli kodu girerek hesabınıza güvenli şekilde giriş yapın."
        code={verificationCode}
        onCodeChange={setVerificationCode}
        onClose={() => setShowVerificationModal(false)}
        onConfirm={handleVerifyCode}
        onResend={handleResendCode}
        isConfirming={verifyCodeMutation.isPending}
        isResending={sendCodeMutation.isPending}
        maskedPhone={maskedPhone}
        deliveryNote={deliveryNote}
        providerName={providerName}
        confirmLabel="Girişi Tamamla"
        resendLabel="Kodu Tekrar Gönder"
        testIDPrefix="login-verification"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A12',
  },
  bgImage: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  bgOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'rgba(10,10,18,0.55)',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  topBar: {
    position: 'absolute',
    zIndex: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  heroSection: {
    marginBottom: 30,
  },
  brand: {
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -1,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 12,
  },
  tagline: {
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500',
    marginTop: 4,
    letterSpacing: 2,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  formCard: {
    backgroundColor: 'rgba(18,18,30,0.92)',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderTopWidth: 1,
    borderColor: 'rgba(245,166,35,0.15)',
  },
  title: {
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.45)',
    marginTop: 6,
    marginBottom: 24,
    includeFontPadding: false,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 4,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  tabIndicator: {
    position: 'absolute',
    height: '100%',
    backgroundColor: '#F5A623',
    borderRadius: 12,
    top: 4,
    left: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 13,
    gap: 6,
    zIndex: 1,
  },
  tabText: {
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.5)',
    includeFontPadding: false,
  },
  tabTextActive: {
    color: '#0A0A12',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 12,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  infoCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderRadius: 18,
    marginBottom: 24,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.12)',
  },
  infoIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245,166,35,0.14)',
  },
  infoCopy: {
    flex: 1,
    gap: 4,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  infoText: {
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.58)',
  },
  loginButton: {
    backgroundColor: '#F5A623',
    alignItems: 'center',
    shadowColor: '#F5A623',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    fontWeight: '700' as const,
    color: '#0A0A12',
    includeFontPadding: false,
  },
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    gap: 6,
  },
  registerLabel: {
    color: 'rgba(255,255,255,0.4)',
  },
  registerLink: {
    fontWeight: '700',
    color: '#F5A623',
  },
});
