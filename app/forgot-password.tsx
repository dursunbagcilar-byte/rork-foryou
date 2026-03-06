import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ScrollView, Animated, Alert,
  Image, StatusBar, useWindowDimensions, ActivityIndicator, Keyboard,
  TouchableWithoutFeedback, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Mail, Lock, CheckCircle, KeyRound, MessageSquare } from 'lucide-react-native';
import { getBaseUrl, normalizeApiBaseUrl, waitForBaseUrl } from '@/lib/trpc';
import { useAuth } from '@/contexts/AuthContext';

function getDbHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const dbEndpoint = process.env.EXPO_PUBLIC_RORK_DB_ENDPOINT;
  const dbNamespace = process.env.EXPO_PUBLIC_RORK_DB_NAMESPACE;
  const dbToken = process.env.EXPO_PUBLIC_RORK_DB_TOKEN;
  if (dbEndpoint) headers['x-db-endpoint'] = dbEndpoint;
  if (dbNamespace) headers['x-db-namespace'] = dbNamespace;
  if (dbToken) headers['x-db-token'] = dbToken;
  return headers;
}

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

const SUPPORT_WHATSAPP_NUMBER = '905516300624';
const SUPPORT_WHATSAPP_DISPLAY = '0551 630 06 24';

type Step = 'email' | 'code' | 'newPassword' | 'success';
type ResetCodeResponse = { success: boolean; error?: string | null; emailSent?: boolean };

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { hasLocalRecoveryAccount, recoverLocalPassword } = useAuth();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isSmall = width < 360;
  const isTablet = width >= 600;

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [emailSentInfo, setEmailSentInfo] = useState<boolean>(true);
  const [localRecoveryMode, setLocalRecoveryMode] = useState<boolean>(false);
  const [deliveryIssue, setDeliveryIssue] = useState<string | null>(null);

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
    const hasLocalAccount = await hasLocalRecoveryAccount(trimmedEmail);

    console.log('[ForgotPassword] Local recovery fallback check:', trimmedEmail, 'reason:', reason, 'hasLocalAccount:', hasLocalAccount);

    if (!hasLocalAccount) {
      return false;
    }

    setLocalRecoveryMode(true);
    setEmailSentInfo(false);
    setDeliveryIssue(reason);
    animateTransition(() => setStep('newPassword'));
    Alert.alert('Yerel Kurtarma', 'Sunucuda hesap bulunamadı ancak bu cihazda kayıtlı bilgiler bulundu. Bu cihaz için yeni bir şifre oluşturabilirsiniz.');
    return true;
  };

  const buildWhatsAppSupportUrl = useCallback((reason: string): string => {
    const contactEmail = email.trim() || 'belirtilmedi';
    const message = [
      'Merhaba 2GO destek,',
      'şifre sıfırlama kodunu alamıyorum.',
      `E-posta: ${contactEmail}`,
      `Sorun: ${reason}`,
      'Yardımcı olur musunuz?',
    ].join('\n');

    return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  }, [email]);

  const openWhatsAppSupport = useCallback(async (reason: string) => {
    const url = buildWhatsAppSupportUrl(reason);
    console.log('[ForgotPassword] Opening WhatsApp support:', url);

    try {
      await Linking.openURL(url);
    } catch (openErr) {
      console.log('[ForgotPassword] WhatsApp open error:', openErr);
      Alert.alert('Hata', 'WhatsApp açılamadı. Lütfen WhatsApp yüklü olduğundan emin olun.');
    }
  }, [buildWhatsAppSupportUrl]);

  const promptWhatsAppSupport = useCallback((reason: string) => {
    const finalReason = reason.trim() || 'Doğrulama kodu teslim edilemedi';
    setEmailSentInfo(false);
    setDeliveryIssue(finalReason);
    Alert.alert(
      'WhatsApp Destek',
      'Kod şu anda otomatik gönderilemiyor. İsterseniz WhatsApp destek hattından manuel yardım isteyebilirsiniz.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'WhatsApp Aç', onPress: () => { void openWhatsAppSupport(finalReason); } },
      ]
    );
  }, [openWhatsAppSupport]);

  const handleSendCode = async () => {
    if (!email.trim()) {
      Alert.alert('Uyarı', 'Lütfen e-posta adresinizi girin');
      return;
    }

    setLocalRecoveryMode(false);
    setDeliveryIssue(null);
    setLoading(true);
    try {
      const result = await restCall<ResetCodeResponse>(
        '/api/auth/send-reset-code',
        { email: email.trim() }
      );

      if (result.success) {
        setEmailSentInfo(true);
        setDeliveryIssue(null);
        animateTransition(() => setStep('code'));
        console.log('[ForgotPassword] Code sent, emailSent:', result.emailSent);
      } else {
        const resultError = result.error ?? 'Bir hata oluştu';
        const handledLocally = resultError.toLowerCase().includes('kayıtlı hesap bulunamadı')
          ? await tryLocalRecoveryFallback(resultError)
          : false;
        if (handledLocally) {
          return;
        }
        if (result.emailSent === false) {
          promptWhatsAppSupport(resultError);
          return;
        }
        Alert.alert('Hata', resultError);
      }
    } catch (e) {
      console.log('[ForgotPassword] Send code error:', e);
      const sendErr = (e instanceof Error && (e.message === 'Failed to fetch' || e.message === 'Network request failed'))
        ? 'Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.'
        : (e instanceof Error ? e.message : 'Bir hata oluştu. Lütfen tekrar deneyin.');
      const handledLocally = await tryLocalRecoveryFallback(sendErr);
      if (handledLocally) {
        return;
      }
      const lowerSendErr = sendErr.toLowerCase();
      if (lowerSendErr.includes('e-posta servisi') || lowerSendErr.includes('e-posta gönderilemedi')) {
        promptWhatsAppSupport(sendErr);
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

    setLoading(true);
    try {
      const result = await restCall<{ success: boolean; error?: string | null }>(
        '/api/auth/verify-reset-code',
        { email: email.trim(), code: code.trim() }
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

      const result = await restCall<{ success: boolean; error?: string | null }>(
        '/api/auth/reset-password',
        { email: email.trim(), code: code.trim(), newPassword: newPassword }
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
    setLoading(true);
    try {
      const result = await restCall<ResetCodeResponse>(
        '/api/auth/send-reset-code',
        { email: email.trim() }
      );
      if (result.success) {
        setEmailSentInfo(true);
        setDeliveryIssue(null);
        Alert.alert('Başarılı', 'Yeni doğrulama kodu gönderildi');
      } else if (result.emailSent === false) {
        promptWhatsAppSupport(result.error ?? 'Yeni kod şu anda teslim edilemiyor.');
      } else {
        Alert.alert('Hata', result.error ?? 'Kod gönderilemedi');
      }
    } catch (e) {
      console.log('[ForgotPassword] Resend code error:', e);
      const errorMsg = (e instanceof Error && (e.message === 'Failed to fetch' || e.message === 'Network request failed'))
        ? 'Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.'
        : (e instanceof Error ? e.message : 'Bir hata oluştu. Lütfen tekrar deneyin.');
      const lowerErrorMsg = errorMsg.toLowerCase();
      if (lowerErrorMsg.includes('e-posta servisi') || lowerErrorMsg.includes('e-posta gönderilemedi')) {
        promptWhatsAppSupport(errorMsg);
        return;
      }
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
          <Mail size={28} color="#F5A623" />
        </View>
        <Text style={[styles.stepTitle, { fontSize: isSmall ? 18 : 22 }]}>E-posta Doğrulama</Text>
        <Text style={[styles.stepDesc, { fontSize: isSmall ? 12 : 14 }]}>
          Hesabınıza kayıtlı e-posta adresinizi girin. Doğrulama kodu göndereceğiz.
        </Text>
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
            testID="forgot-email-input"
          />
        </View>
      </View>
      {deliveryIssue ? (
        <View style={styles.supportCard}>
          <View style={styles.supportCardHeader}>
            <View style={styles.supportIconWrap}>
              <MessageSquare size={18} color="#25D366" />
            </View>
            <Text style={styles.supportTitle}>WhatsApp ile destek al</Text>
          </View>
          <Text style={styles.supportDescription}>{deliveryIssue}</Text>
          <TouchableOpacity
            style={styles.supportButton}
            onPress={() => { void openWhatsAppSupport(deliveryIssue); }}
            activeOpacity={0.85}
            testID="forgot-open-whatsapp-support-btn"
          >
            <Text style={styles.supportButtonText}>WhatsApp Desteğini Aç</Text>
          </TouchableOpacity>
          <Text style={styles.supportMeta}>{SUPPORT_WHATSAPP_DISPLAY}</Text>
        </View>
      ) : null}
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
          <Text style={[styles.actionButtonText, { fontSize: isSmall ? 15 : 17 }]}>Doğrulama Kodu Gönder</Text>
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
          {emailSentInfo
            ? `${email} adresine gönderilen 6 haneli kodu girin`
            : `Doğrulama kodu oluşturuldu. E-posta gönderilemedi, lütfen tekrar deneyin.`
          }
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
          <Text style={styles.resendLink}>Tekrar Gönder</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={styles.inlineWhatsAppButton}
        onPress={() => { void openWhatsAppSupport(emailSentInfo ? 'Doğrulama kodu kullanıcıya ulaşmadı.' : (deliveryIssue ?? 'Doğrulama kodu teslim edilemedi.')); }}
        activeOpacity={0.85}
        testID="forgot-inline-whatsapp-support-btn"
      >
        <MessageSquare size={16} color="#25D366" />
        <Text style={styles.inlineWhatsAppText}>Kod gelmediyse WhatsApp destek</Text>
      </TouchableOpacity>
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
  supportCard: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(37,211,102,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(37,211,102,0.16)',
  },
  supportCardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    marginBottom: 10,
  },
  supportIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(37,211,102,0.14)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  supportTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  supportDescription: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  supportButton: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: '#25D366',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  supportButtonText: {
    color: '#07120B',
    fontSize: 14,
    fontWeight: '800' as const,
  },
  supportMeta: {
    marginTop: 10,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    textAlign: 'center' as const,
  },
  inlineWhatsAppButton: {
    marginTop: 14,
    alignSelf: 'center' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(37,211,102,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(37,211,102,0.16)',
  },
  inlineWhatsAppText: {
    color: '#25D366',
    fontSize: 13,
    fontWeight: '700' as const,
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
