import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ScrollView, Animated, Alert,
  Image, StatusBar, useWindowDimensions, ActivityIndicator, Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Mail, Lock, CheckCircle, KeyRound, Phone } from 'lucide-react-native';
import { getBaseUrl, normalizeApiBaseUrl, waitForBaseUrl } from '@/lib/trpc';
import { useAuth } from '@/contexts/AuthContext';
import { getDbHeaders } from '@/utils/db';
import { getTurkishPhoneValidationError, normalizeTurkishPhone } from '@/utils/phone';

async function resolveApiBase(): Promise<string> {
  let base = getBaseUrl();
  if (!base) base = await waitForBaseUrl(8000);
  if (!base) {
    const projId = process.env.EXPO_PUBLIC_PROJECT_ID;
    const teamId = process.env.EXPO_PUBLIC_TEAM_ID;
    if (projId && teamId) base = normalizeApiBaseUrl(`https://${projId}-${teamId}.rork.app`);
  }
  if (!base) throw new Error('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.');
  return normalizeApiBaseUrl(base);
}

async function restCall<T>(path: string, input: Record<string, unknown>): Promise<T> {
  const apiBase = await resolveApiBase();
  const url = `${apiBase}${path}`;
  console.log('[ForgotPwd] POST', url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getDbHeaders(),
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await response.text();
    console.log('[ForgotPwd] Response status:', response.status, 'len:', text.length);
    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errData = JSON.parse(text);
        if (errData?.error) errorMsg = typeof errData.error === 'string' ? errData.error : errData.error.message || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }
    return JSON.parse(text) as T;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') throw new Error('Sunucu yanıt vermedi. Lütfen tekrar deneyin.');
    throw err;
  }
}

type Step = 'email' | 'code' | 'newPassword' | 'success';
type DeliveryChannel = 'sms';
type RecoveryMethod = 'email' | 'phone';
type ResetCodeResponse = {
  success: boolean;
  error?: string | null;
  emailSent?: boolean;
  deliveryChannel?: DeliveryChannel;
  maskedPhone?: string | null;
  smsTargetPhone?: string | null;
  deliveryNote?: string | null;
};

function isEmailLike(value: string): boolean {
  return value.includes('@');
}

function getRecoveryContact(method: RecoveryMethod, email: string, phone: string): string {
  if (method === 'phone') {
    return normalizeTurkishPhone(phone);
  }

  return email.trim().toLowerCase();
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { hasLocalRecoveryAccount, recoverLocalPassword } = useAuth();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isSmall = width < 360;
  const isTablet = width >= 600;

  const [step, setStep] = useState<Step>('email');
  const [recoveryMethod, setRecoveryMethod] = useState<RecoveryMethod>('email');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [localRecoveryMode, setLocalRecoveryMode] = useState<boolean>(false);
  const [_deliveryIssue, setDeliveryIssue] = useState<string | null>(null);
  const [registeredPhoneMask, setRegisteredPhoneMask] = useState<string | null>(null);
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null);

  const isEmailRecovery = recoveryMethod === 'email';
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedPhone = normalizeTurkishPhone(phone);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const animateTransition = (callback: () => void) => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      callback();
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    });
  };

  const tryLocalRecoveryFallback = async (reason: string): Promise<boolean> => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !isEmailLike(trimmedEmail)) {
      return false;
    }

    const hasLocalAccount = await hasLocalRecoveryAccount(trimmedEmail);

    console.log('[ForgotPassword] Local recovery fallback check:', trimmedEmail, 'reason:', reason, 'hasLocalAccount:', hasLocalAccount);

    if (!hasLocalAccount) {
      return false;
    }

    setLocalRecoveryMode(true);
    setDeliveryIssue(reason);
    animateTransition(() => setStep('newPassword'));
    Alert.alert('Yerel Kurtarma', 'Sunucuda hesap bulunamadı ancak bu cihazda kayıtlı bilgiler bulundu. Bu cihaz için yeni bir şifre oluşturabilirsiniz.');
    return true;
  };

  const handleSendCode = async () => {
    const recoveryContact = getRecoveryContact(recoveryMethod, email, phone);

    if (isEmailRecovery) {
      if (!isEmailLike(trimmedEmail)) {
        Alert.alert('Uyarı', 'SMS kodu gönderebilmemiz için kayıtlı e-posta adresinizi girin');
        return;
      }
    } else {
      const phoneValidationError = getTurkishPhoneValidationError(trimmedPhone);
      if (phoneValidationError) {
        Alert.alert('Uyarı', phoneValidationError);
        return;
      }
    }

    if (!recoveryContact) {
      Alert.alert('Uyarı', isEmailRecovery ? 'Lütfen kayıtlı e-posta adresinizi girin' : 'Lütfen kayıtlı telefon numaranızı girin');
      return;
    }

    setLocalRecoveryMode(false);
    setDeliveryIssue(null);
    setLoading(true);
    try {
      const result = await restCall<ResetCodeResponse>(
        '/api/auth/send-reset-code',
        {
          contact: recoveryContact,
          email: trimmedEmail,
          phone: trimmedPhone,
          deliveryMethod: 'sms',
        }
      );

      if (result.success) {
        setRegisteredPhoneMask(result.maskedPhone ?? null);
        setDeliveryNote(result.deliveryNote ?? null);
        animateTransition(() => setStep('code'));
        console.log('[ForgotPassword] Code sent via SMS for:', recoveryContact, 'maskedPhone:', result.maskedPhone ?? 'none', 'method:', recoveryMethod);
        setDeliveryIssue(null);
        Alert.alert('Başarılı', 'Doğrulama kodu kayıtlı telefon numaranıza SMS olarak gönderildi.');
      } else {
        const resultError = result.error ?? 'Bir hata oluştu';
        const handledLocally = isEmailRecovery ? await tryLocalRecoveryFallback(resultError) : false;
        if (handledLocally) {
          return;
        }
        Alert.alert('Hata', resultError);
      }
    } catch (e) {
      console.log('[ForgotPassword] Send code error:', e);
      const sendErr = (e instanceof Error && (e.message === 'Failed to fetch' || e.message === 'Network request failed'))
        ? 'Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.'
        : (e instanceof Error ? e.message : 'Bir hata oluştu. Lütfen tekrar deneyin.');
      const handledLocally = isEmailRecovery ? await tryLocalRecoveryFallback(sendErr) : false;
      if (handledLocally) {
        return;
      }
      Alert.alert('Hata', sendErr);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code.trim() || code.trim().length !== 6) {
      Alert.alert('Uyarı', 'Lütfen 6 haneli doğrulama kodunu girin');
      return;
    }

    if (!isEmailRecovery) {
      const phoneValidationError = getTurkishPhoneValidationError(trimmedPhone);
      if (phoneValidationError) {
        Alert.alert('Uyarı', phoneValidationError);
        return;
      }
    }

    const recoveryContact = getRecoveryContact(recoveryMethod, email, phone);
    if (!recoveryContact) {
      Alert.alert('Uyarı', isEmailRecovery ? 'Lütfen kayıtlı e-posta adresinizi girin' : 'Lütfen kayıtlı telefon numaranızı girin');
      return;
    }

    setLoading(true);
    try {
      const result = await restCall<{ success: boolean; error?: string | null }>(
        '/api/auth/verify-reset-code',
        {
          contact: recoveryContact,
          email: trimmedEmail,
          phone: trimmedPhone,
          code: code.trim(),
        }
      );

      if (result.success) {
        animateTransition(() => setStep('newPassword'));
      } else {
        Alert.alert('Hata', result.error ?? 'Doğrulama kodu hatalı');
      }
    } catch (e) {
      console.log('[ForgotPassword] Verify code error:', e);
      const verifyErr = (e instanceof Error && (e.message === 'Failed to fetch' || e.message === 'Network request failed'))
        ? 'Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.'
        : (e instanceof Error ? e.message : 'Bir hata oluştu. Lütfen tekrar deneyin.');
      Alert.alert('Hata', verifyErr);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword) {
      Alert.alert('Uyarı', 'Lütfen yeni şifrenizi girin');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Uyarı', 'Şifre en az 8 karakter olmalıdır');
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      Alert.alert('Uyarı', 'Şifre en az bir büyük harf içermelidir');
      return;
    }
    if (!/[a-z]/.test(newPassword)) {
      Alert.alert('Uyarı', 'Şifre en az bir küçük harf içermelidir');
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      Alert.alert('Uyarı', 'Şifre en az bir rakam içermelidir');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Uyarı', 'Şifreler eşleşmiyor');
      return;
    }

    setLoading(true);
    try {
      if (localRecoveryMode) {
        const recovered = await recoverLocalPassword(email.trim(), newPassword);
        if (recovered) {
          animateTransition(() => setStep('success'));
        } else {
          Alert.alert('Hata', 'Bu cihazda bu e-posta ile eşleşen kayıt bulunamadı.');
        }
        return;
      }

      if (!isEmailRecovery) {
        const phoneValidationError = getTurkishPhoneValidationError(trimmedPhone);
        if (phoneValidationError) {
          Alert.alert('Uyarı', phoneValidationError);
          return;
        }
      }

      const recoveryContact = getRecoveryContact(recoveryMethod, email, phone);
      if (!recoveryContact) {
        Alert.alert('Uyarı', isEmailRecovery ? 'Lütfen kayıtlı e-posta adresinizi girin' : 'Lütfen kayıtlı telefon numaranızı girin');
        return;
      }

      const result = await restCall<{ success: boolean; error?: string | null }>(
        '/api/auth/reset-password',
        {
          contact: recoveryContact,
          email: trimmedEmail,
          phone: trimmedPhone,
          code: code.trim(),
          newPassword,
        }
      );

      if (result.success) {
        animateTransition(() => setStep('success'));
      } else {
        Alert.alert('Hata', result.error ?? 'Şifre sıfırlanamadı');
      }
    } catch (e) {
      console.log('[ForgotPassword] Reset error:', e);
      const resetErr = (e instanceof Error && (e.message === 'Failed to fetch' || e.message === 'Network request failed'))
        ? 'Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.'
        : (e instanceof Error ? e.message : 'Bir hata oluştu. Lütfen tekrar deneyin.');
      Alert.alert('Hata', resetErr);
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    const recoveryContact = getRecoveryContact(recoveryMethod, email, phone);

    if (isEmailRecovery) {
      if (!isEmailLike(trimmedEmail)) {
        Alert.alert('Uyarı', 'SMS kodu gönderebilmemiz için kayıtlı e-posta adresinizi girin');
        return;
      }
    } else {
      const phoneValidationError = getTurkishPhoneValidationError(trimmedPhone);
      if (phoneValidationError) {
        Alert.alert('Uyarı', phoneValidationError);
        return;
      }
    }

    if (!recoveryContact) {
      Alert.alert('Uyarı', isEmailRecovery ? 'Lütfen kayıtlı e-posta adresinizi girin' : 'Lütfen kayıtlı telefon numaranızı girin');
      return;
    }

    setLoading(true);
    try {
      const result = await restCall<ResetCodeResponse>(
        '/api/auth/send-reset-code',
        {
          contact: recoveryContact,
          email: trimmedEmail,
          phone: trimmedPhone,
          deliveryMethod: 'sms',
        }
      );
      if (result.success) {
        setRegisteredPhoneMask(result.maskedPhone ?? null);
        setDeliveryNote(result.deliveryNote ?? null);
        setDeliveryIssue(null);
        Alert.alert('Başarılı', 'Doğrulama kodu SMS olarak tekrar gönderildi.');
      } else {
        Alert.alert('Hata', result.error ?? 'Kod gönderilemedi');
      }
    } catch (e) {
      console.log('[ForgotPassword] Resend code error:', e);
      const errorMsg = (e instanceof Error && (e.message === 'Failed to fetch' || e.message === 'Network request failed'))
        ? 'Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.'
        : (e instanceof Error ? e.message : 'Bir hata oluştu. Lütfen tekrar deneyin.');
      Alert.alert('Hata', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const topBarTop = insets.top + 10;
  const heroHeight = height * (isSmall ? 0.10 : 0.13);
  const imgHeight = height * (isSmall ? 0.40 : 0.45);

  const steps: Step[] = ['email', 'code', 'newPassword', 'success'];
  const currentStepIdx = steps.indexOf(step);

  const renderEmailStep = () => (
    <>
      <View style={styles.stepHeader}>
        <View style={styles.stepIconWrap}>
          {isEmailRecovery ? <Mail size={28} color="#F5A623" /> : <Phone size={28} color="#F5A623" />}
        </View>
        <Text style={[styles.stepTitle, { fontSize: isSmall ? 18 : 22 }]}>SMS ile Kurtarma</Text>
        <Text style={[styles.stepDesc, { fontSize: isSmall ? 12 : 14 }]}> 
          {isEmailRecovery
            ? 'Kayıtlı e-posta adresinizi yazın. 6 haneli şifre sıfırlama kodunu kayıtlı telefon numaranıza SMS olarak gönderelim.'
            : 'Kayıtlı telefon numaranızı yazın. Şifre sıfırlama kodunu bu hatta SMS olarak gönderelim.'}
        </Text>
      </View>
      <View style={styles.methodSwitchRow}>
        <TouchableOpacity
          style={[styles.methodSwitchButton, isEmailRecovery && styles.methodSwitchButtonActive]}
          onPress={() => {
            setRecoveryMethod('email');
            setDeliveryIssue(null);
            setRegisteredPhoneMask(null);
            setDeliveryNote(null);
            setLocalRecoveryMode(false);
          }}
          activeOpacity={0.9}
          testID="forgot-method-email-btn"
        >
          <Mail size={16} color={isEmailRecovery ? '#0A0A12' : 'rgba(255,255,255,0.7)'} />
          <Text style={[styles.methodSwitchText, isEmailRecovery && styles.methodSwitchTextActive]}>E-posta</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.methodSwitchButton, !isEmailRecovery && styles.methodSwitchButtonActive]}
          onPress={() => {
            setRecoveryMethod('phone');
            setDeliveryIssue(null);
            setRegisteredPhoneMask(null);
            setDeliveryNote(null);
            setLocalRecoveryMode(false);
          }}
          activeOpacity={0.9}
          testID="forgot-method-phone-btn"
        >
          <Phone size={16} color={!isEmailRecovery ? '#0A0A12' : 'rgba(255,255,255,0.7)'} />
          <Text style={[styles.methodSwitchText, !isEmailRecovery && styles.methodSwitchTextActive]}>Telefon</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.inputGroup}>
        <View style={[styles.inputWrapper, { paddingHorizontal: isSmall ? 12 : 16, borderRadius: isSmall ? 12 : 14 }]}>
          {isEmailRecovery ? <Mail size={isSmall ? 16 : 18} color="rgba(255,255,255,0.35)" /> : <Phone size={isSmall ? 16 : 18} color="rgba(255,255,255,0.35)" />}
          {isEmailRecovery ? (
            <TextInput
              style={[styles.input, { paddingVertical: isSmall ? 13 : 16, fontSize: isSmall ? 14 : 16 }]}
              placeholder="ornek@email.com"
              placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              testID="forgot-email-input"
            />
          ) : (
            <TextInput
              style={[styles.input, { paddingVertical: isSmall ? 13 : 16, fontSize: isSmall ? 14 : 16 }]}
              placeholder="05XXXXXXXXX"
              placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={(value) => setPhone(normalizeTurkishPhone(value))}
              maxLength={11}
              testID="forgot-phone-input"
            />
          )}
        </View>
      </View>
      <Text style={styles.supportMeta}>
        {isEmailRecovery
          ? 'Kod, hesabınızdaki kayıtlı telefona SMS olarak gider.'
          : 'Telefon numarası 0 ile başlamalı ve 11 haneli olmalıdır.'}
      </Text>
      {deliveryNote ? <Text style={styles.supportMeta}>{deliveryNote}</Text> : null}
      <TouchableOpacity
        style={[styles.actionButton, loading && styles.actionButtonDisabled, { paddingVertical: isSmall ? 15 : 18, borderRadius: isSmall ? 12 : 16 }]}
        onPress={handleSendCode}
        disabled={loading}
        activeOpacity={0.85}
        testID="forgot-send-code-btn"
      >
        {loading ? (
          <ActivityIndicator color="#0A0A12" size="small" />
        ) : (
          <Text style={[styles.actionButtonText, { fontSize: isSmall ? 15 : 17 }]}>SMS ile Kod Gönder</Text>
        )}
      </TouchableOpacity>
    </>
  );

  const renderCodeStep = () => (
    <>
      <View style={styles.stepHeader}>
        <View style={styles.stepIconWrap}>
          <KeyRound size={28} color="#F5A623" />
        </View>
        <Text style={[styles.stepTitle, { fontSize: isSmall ? 18 : 22 }]}>Kodu Girin</Text>
        <Text style={[styles.stepDesc, { fontSize: isSmall ? 12 : 14 }]}>
          {`Kayıtlı telefon numaranıza SMS ile gönderilen 6 haneli kodu girin${registeredPhoneMask ? ` • kayıtlı hat: ${registeredPhoneMask}` : ''}`}
        </Text>
      </View>
      <View style={styles.inputGroup}>
        <View style={[styles.inputWrapper, { paddingHorizontal: isSmall ? 12 : 16, borderRadius: isSmall ? 12 : 14 }]}>
          <KeyRound size={isSmall ? 16 : 18} color="rgba(255,255,255,0.35)" />
          <TextInput
            style={[styles.input, { paddingVertical: isSmall ? 13 : 16, fontSize: isSmall ? 20 : 24, letterSpacing: 8, textAlign: 'center' as const, fontWeight: '700' as const }]}
            placeholder="000000"
            placeholderTextColor="rgba(255,255,255,0.2)"
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={setCode}
            testID="forgot-code-input"
          />
        </View>
      </View>
      {deliveryNote ? <Text style={styles.supportMeta}>{deliveryNote}</Text> : null}
      <TouchableOpacity
        style={[styles.actionButton, loading && styles.actionButtonDisabled, { paddingVertical: isSmall ? 15 : 18, borderRadius: isSmall ? 12 : 16 }]}
        onPress={handleVerifyCode}
        disabled={loading}
        activeOpacity={0.85}
        testID="forgot-verify-code-btn"
      >
        {loading ? (
          <ActivityIndicator color="#0A0A12" size="small" />
        ) : (
          <Text style={[styles.actionButtonText, { fontSize: isSmall ? 15 : 17 }]}>Doğrula</Text>
        )}
      </TouchableOpacity>
      <View style={styles.resendRow}>
        <Text style={styles.resendLabel}>Kod gelmedi mi? </Text>
        <TouchableOpacity onPress={handleResendCode} disabled={loading}>
          <Text style={styles.resendLink}>SMS'i Tekrar Gönder</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.backStepButton} onPress={() => animateTransition(() => setStep('email'))}>
        <Text style={styles.backStepText}>Geri Dön</Text>
      </TouchableOpacity>
    </>
  );

  const renderNewPasswordStep = () => (
    <>
      <View style={styles.stepHeader}>
        <View style={styles.stepIconWrap}>
          <Lock size={28} color="#F5A623" />
        </View>
        <Text style={[styles.stepTitle, { fontSize: isSmall ? 18 : 22 }]}>Yeni Şifre Belirle</Text>
        <Text style={[styles.stepDesc, { fontSize: isSmall ? 12 : 14 }]}>
          Hesabınız için yeni bir şifre oluşturun
        </Text>
      </View>
      <View style={styles.inputGroup}>
        <View style={[styles.inputWrapper, { paddingHorizontal: isSmall ? 12 : 16, borderRadius: isSmall ? 12 : 14 }]}>
          <Lock size={isSmall ? 16 : 18} color="rgba(255,255,255,0.35)" />
          <TextInput
            style={[styles.input, { paddingVertical: isSmall ? 13 : 16, fontSize: isSmall ? 14 : 16 }]}
            placeholder="En az 8 karakter, büyük/küçük harf, rakam"
            placeholderTextColor="rgba(255,255,255,0.3)"
            secureTextEntry
            value={newPassword}
            onChangeText={setNewPassword}
            testID="forgot-new-password-input"
          />
        </View>
      </View>
      <View style={styles.inputGroup}>
        <View style={[styles.inputWrapper, { paddingHorizontal: isSmall ? 12 : 16, borderRadius: isSmall ? 12 : 14 }]}>
          <Lock size={isSmall ? 16 : 18} color="rgba(255,255,255,0.35)" />
          <TextInput
            style={[styles.input, { paddingVertical: isSmall ? 13 : 16, fontSize: isSmall ? 14 : 16 }]}
            placeholder="Şifreyi tekrar girin"
            placeholderTextColor="rgba(255,255,255,0.3)"
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            testID="forgot-confirm-password-input"
          />
        </View>
      </View>
      <TouchableOpacity
        style={[styles.actionButton, loading && styles.actionButtonDisabled, { paddingVertical: isSmall ? 15 : 18, borderRadius: isSmall ? 12 : 16 }]}
        onPress={handleResetPassword}
        disabled={loading}
        activeOpacity={0.85}
        testID="forgot-reset-btn"
      >
        {loading ? (
          <ActivityIndicator color="#0A0A12" size="small" />
        ) : (
          <Text style={[styles.actionButtonText, { fontSize: isSmall ? 15 : 17 }]}>Şifreyi Sıfırla</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity style={styles.backStepButton} onPress={() => animateTransition(() => setStep('code'))}>
        <Text style={styles.backStepText}>Geri Dön</Text>
      </TouchableOpacity>
    </>
  );

  const renderSuccessStep = () => (
    <View style={styles.successContainer}>
      <View style={styles.successIconWrap}>
        <CheckCircle size={56} color="#34C759" />
      </View>
      <Text style={[styles.successTitle, { fontSize: isSmall ? 20 : 24 }]}>Şifre Sıfırlandı!</Text>
      <Text style={[styles.successDesc, { fontSize: isSmall ? 13 : 15 }]}>
        Şifreniz başarıyla değiştirildi. Yeni şifrenizle giriş yapabilirsiniz.
      </Text>
      <TouchableOpacity
        style={[styles.actionButton, { paddingVertical: isSmall ? 15 : 18, borderRadius: isSmall ? 12 : 16, marginTop: 28 }]}
        onPress={() => router.replace('/login' as any)}
        activeOpacity={0.85}
        testID="forgot-go-login-btn"
      >
        <Text style={[styles.actionButtonText, { fontSize: isSmall ? 15 : 17 }]}>Giriş Yap</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <Image
        source={{ uri: 'https://images.unsplash.com/photo-1590674899484-d5640e854abe?w=800&q=80' }}
        style={[styles.bgImage, { width, height: imgHeight }]}
        resizeMode="cover"
      />
      <View style={[styles.bgOverlay, { width, height: imgHeight }]} />
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={[styles.topBar, { top: topBarTop, left: isSmall ? 16 : 20 }]}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()} testID="forgot-back-button">
              <ArrowLeft size={isSmall ? 20 : 22} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={[styles.heroSection, { paddingHorizontal: isSmall ? 20 : isTablet ? 48 : 28, paddingTop: heroHeight }]}>
            <Text style={[styles.brand, { fontSize: isSmall ? 38 : isTablet ? 56 : 48 }]}>2GO</Text>
            <Text style={[styles.tagline, { fontSize: isSmall ? 13 : isTablet ? 18 : 16 }]}>Şifre Sıfırlama</Text>
          </View>
          <View style={[styles.formCard, {
            paddingHorizontal: isSmall ? 18 : isTablet ? 40 : 24,
            paddingTop: isSmall ? 24 : 32,
            paddingBottom: Platform.OS === 'ios' ? Math.max(insets.bottom, 30) + 16 : 36,
            maxWidth: isTablet ? 500 : undefined,
            alignSelf: isTablet ? 'center' as const : undefined,
            width: isTablet ? '90%' as unknown as number : undefined,
          }]}>
            <View style={styles.progressRow}>
              {steps.map((s, i) => (
                <View key={s} style={styles.progressItem}>
                  <View style={[
                    styles.progressDot,
                    currentStepIdx >= i && styles.progressDotActive,
                  ]} />
                  {i < steps.length - 1 && (
                    <View style={[
                      styles.progressLine,
                      currentStepIdx > i && styles.progressLineActive,
                    ]} />
                  )}
                </View>
              ))}
            </View>
            <Animated.View style={{ opacity: fadeAnim }}>
              {step === 'email' && renderEmailStep()}
              {step === 'code' && renderCodeStep()}
              {step === 'newPassword' && renderNewPasswordStep()}
              {step === 'success' && renderSuccessStep()}
            </Animated.View>
          </View>
        </ScrollView>
        </TouchableWithoutFeedback>
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
    backgroundColor: 'rgba(10,10,18,0.45)',
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
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  tagline: {
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '500' as const,
    marginTop: 4,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  formCard: {
    backgroundColor: 'rgba(18,18,30,0.92)',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderTopWidth: 1,
    borderColor: 'rgba(245,166,35,0.15)',
  },
  progressRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 28,
  },
  progressItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  progressDotActive: {
    backgroundColor: '#F5A623',
  },
  progressLine: {
    width: 40,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 4,
  },
  progressLineActive: {
    backgroundColor: '#F5A623',
  },
  stepHeader: {
    alignItems: 'center' as const,
    marginBottom: 24,
  },
  stepIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(245,166,35,0.12)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 14,
  },
  stepTitle: {
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  stepDesc: {
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center' as const,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  methodSwitchRow: {
    flexDirection: 'row' as const,
    gap: 10,
    marginBottom: 16,
  },
  methodSwitchButton: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  methodSwitchButtonActive: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },
  methodSwitchText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 14,
    fontWeight: '700' as const,
  },
  methodSwitchTextActive: {
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
  actionButton: {
    backgroundColor: '#F5A623',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 10,
    shadowColor: '#F5A623',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    fontWeight: '700' as const,
    color: '#0A0A12',
  },
  backStepButton: {
    alignSelf: 'center' as const,
    marginTop: 16,
    paddingVertical: 8,
  },
  backStepText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontWeight: '600' as const,
  },
  resendRow: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginTop: 16,
  },
  resendLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
  },
  resendLink: {
    color: '#F5A623',
    fontSize: 13,
    fontWeight: '700' as const,
  },
  supportMeta: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    textAlign: 'center' as const,
  },
  successContainer: {
    alignItems: 'center' as const,
    paddingVertical: 16,
  },
  successIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(52,199,89,0.12)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 20,
  },
  successTitle: {
    fontWeight: '800' as const,
    color: '#FFFFFF',
    marginBottom: 10,
  },
  successDesc: {
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center' as const,
    lineHeight: 22,
    paddingHorizontal: 16,
  },
});
