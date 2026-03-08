import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ScrollView, Animated, Alert,
  Image, StatusBar, useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Mail, Lock, Car, User } from 'lucide-react-native';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginScreen() {
  const router = useRouter();
  const { loginAsCustomer, loginAsDriver, getRememberedLogin } = useAuth();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'customer' | 'driver'>('customer');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const slideAnim = useRef(new Animated.Value(0)).current;

  const isSmall = width < 360;
  const isTablet = width >= 600;

  const switchMode = (newMode: 'customer' | 'driver') => {
    Animated.spring(slideAnim, {
      toValue: newMode === 'customer' ? 0 : 1,
      useNativeDriver: true,
    }).start();
    setMode(newMode);
  };

  useEffect(() => {
    let isMounted = true;

    const restoreLastUsedMode = async () => {
      try {
        const customerRemembered = await getRememberedLogin('customer');
        const driverRemembered = await getRememberedLogin('driver');
        if (!isMounted) {
          return;
        }

        const customerUpdatedAt = customerRemembered ? new Date(customerRemembered.updatedAt).getTime() : 0;
        const driverUpdatedAt = driverRemembered ? new Date(driverRemembered.updatedAt).getTime() : 0;

        if (!customerUpdatedAt && !driverUpdatedAt) {
          return;
        }

        const nextMode: 'customer' | 'driver' = driverUpdatedAt > customerUpdatedAt ? 'driver' : 'customer';
        setMode(nextMode);
        slideAnim.setValue(nextMode === 'customer' ? 0 : 1);
        console.log('[Login] Last used mode restored:', nextMode);
      } catch (error) {
        console.log('[Login] restoreLastUsedMode error:', error);
      }
    };

    void restoreLastUsedMode();

    return () => {
      isMounted = false;
    };
  }, [getRememberedLogin, slideAnim]);

  useEffect(() => {
    let isMounted = true;

    const loadRememberedLogin = async () => {
      try {
        const remembered = await getRememberedLogin(mode);
        if (!isMounted) {
          return;
        }

        if (remembered) {
          setEmail(remembered.email);
          setPassword(remembered.password);
          console.log('[Login] Remembered login restored for type:', remembered.type);
          return;
        }

        setEmail('');
        setPassword('');
        console.log('[Login] No remembered login found for type:', mode);
      } catch (error) {
        console.log('[Login] loadRememberedLogin error:', error);
      }
    };

    void loadRememberedLogin();

    return () => {
      isMounted = false;
    };
  }, [getRememberedLogin, mode]);

  const loginMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      const trimmedEmail = email.trim();
      let actualType: string | null | undefined;
      if (mode === 'customer') {
        actualType = await loginAsCustomer(trimmedEmail, password.trim());
      } else {
        actualType = await loginAsDriver(trimmedEmail, password.trim());
      }
      return actualType || mode;
    },
    onSuccess: (actualType) => {
      console.log('[Login] Login success, actual type:', actualType);
      if (actualType === 'driver') {
        router.replace('/(driver-tabs)/map');
      } else {
        router.replace('/(customer-tabs)/dashboard');
      }
    },
    onError: (e: unknown) => {
      let errorMsg = 'Mail adresiniz veya şifreniz hatalı.';
      if (e instanceof Error) {
        const msg = e.message;
        if (msg.includes('JSON') || msg.includes('parse') || msg.includes('unexpected')) {
          errorMsg = 'Sunucu geçici olarak meşgul. Lütfen birkaç saniye bekleyip tekrar deneyin.';
        } else {
          errorMsg = msg;
        }
      }
      console.log('[Login] Login error:', e);
      Alert.alert('Giriş Başarısız', errorMsg);
    },
  });

  const { mutate: doLogin } = loginMutation;

  const handleLogin = useCallback(() => {
    if (!email.trim()) {
      Alert.alert('Uyarı', 'Lütfen e-posta adresinizi girin');
      return;
    }
    if (!password.trim()) {
      Alert.alert('Uyarı', 'Lütfen şifrenizi girin');
      return;
    }
    doLogin();
  }, [email, password, doLogin]);

  const loading = loginMutation.isPending;

  const [tabWidth, setTabWidth] = useState<number>(160);
  const indicatorTranslate = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, tabWidth],
  });

  const topBarTop = insets.top + 10;
  const heroHeight = height * (isSmall ? 0.12 : 0.15);
  const imgHeight = height * (isSmall ? 0.45 : 0.55);

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
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
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
            <Text style={[styles.brand, { fontSize: isSmall ? 38 : isTablet ? 56 : 48 }]}>2GO</Text>
            <Text style={[styles.tagline, { fontSize: isSmall ? 13 : isTablet ? 18 : 16 }]}>Güvenli Yolculuk</Text>
          </View>
          <View style={[styles.formCard, {
            paddingHorizontal: isSmall ? 18 : isTablet ? 40 : 24,
            paddingTop: isSmall ? 24 : 32,
            paddingBottom: Platform.OS === 'ios' ? Math.max(insets.bottom, 30) + 16 : 36,
            maxWidth: isTablet ? 500 : undefined,
            alignSelf: isTablet ? 'center' as const : undefined,
            width: isTablet ? '90%' as unknown as number : undefined,
          }]}>
            <Text style={[styles.title, { fontSize: isSmall ? 24 : isTablet ? 32 : 28 }]}>Giriş Yap</Text>
            <Text style={[styles.subtitle, { fontSize: isSmall ? 12 : 14 }]}>Hesabınıza giriş yaparak devam edin</Text>
            <View
              style={styles.tabContainer}
              onLayout={(e) => {
                const containerWidth = e.nativeEvent.layout.width;
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
                <Mail size={isSmall ? 16 : 18} color="rgba(255,255,255,0.35)" />
                <TextInput
                  style={[styles.input, { paddingVertical: isSmall ? 13 : 16, fontSize: isSmall ? 14 : 16 }]}
                  placeholder="ornek@email.com"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                  testID="email-input"
                />
              </View>
            </View>
            <View style={styles.inputGroup}>
              <View style={[styles.inputWrapper, { paddingHorizontal: isSmall ? 12 : 16, borderRadius: isSmall ? 12 : 14 }]}>
                <Lock size={isSmall ? 16 : 18} color="rgba(255,255,255,0.35)" />
                <TextInput
                  style={[styles.input, { paddingVertical: isSmall ? 13 : 16, fontSize: isSmall ? 14 : 16 }]}
                  placeholder="Şifrenizi girin"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  testID="password-input"
                />
              </View>
            </View>
            <TouchableOpacity style={styles.forgotButton} onPress={() => router.push('/forgot-password')}>
              <Text style={[styles.forgotText, { fontSize: isSmall ? 12 : 13 }]}>Şifremi Unuttum</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.loginButton, loading && styles.loginButtonDisabled, { paddingVertical: isSmall ? 15 : 18, borderRadius: isSmall ? 12 : 16 }]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
              testID="submit-login"
            >
              <Text style={[styles.loginButtonText, { fontSize: isSmall ? 15 : 17 }]}>
                {loading ? 'Giriş Yapılıyor...' : 'Giriş Yap'}
              </Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A12',
  },
  bgImage: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
  },
  bgOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    backgroundColor: 'rgba(10,10,18,0.55)',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end' as const,
  },
  topBar: {
    position: 'absolute' as const,
    zIndex: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  heroSection: {
    marginBottom: 30,
  },
  brand: {
    fontWeight: '900' as const,
    color: '#FFFFFF',
    letterSpacing: -1,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 12,
  },
  tagline: {
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500' as const,
    marginTop: 4,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
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
  },
  subtitle: {
    color: 'rgba(255,255,255,0.45)',
    marginTop: 6,
    marginBottom: 24,
  },
  tabContainer: {
    flexDirection: 'row' as const,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 4,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  tabIndicator: {
    position: 'absolute' as const,
    height: '100%' as unknown as number,
    backgroundColor: '#F5A623',
    borderRadius: 12,
    top: 4,
    left: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingVertical: 13,
    gap: 6,
    zIndex: 1,
  },
  tabText: {
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.5)',
  },
  tabTextActive: {
    color: '#0A0A12',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputWrapper: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 12,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
  },
  forgotButton: {
    alignSelf: 'flex-end' as const,
    marginBottom: 24,
    marginTop: 4,
  },
  forgotText: {
    color: '#F5A623',
    fontWeight: '600' as const,
  },
  loginButton: {
    backgroundColor: '#F5A623',
    alignItems: 'center' as const,
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
  },
  registerRow: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginTop: 20,
    gap: 6,
  },
  registerLabel: {
    color: 'rgba(255,255,255,0.4)',
  },
  registerLink: {
    fontWeight: '700' as const,
    color: '#F5A623',
  },
});
