import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, ScrollView, Alert, Modal, FlatList, useWindowDimensions,
  ActivityIndicator, Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, User, Phone, Mail, Lock, CheckCircle, MapPin, ChevronDown, Search, X, UserCircle, Square, CheckSquare, FileText, Hash, Gift } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { TURKISH_CITIES, getCityByName } from '@/constants/cities';
import type { City } from '@/constants/cities';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { VerificationCodeModal } from '@/components/VerificationCodeModal';
import { getTurkishPhoneValidationError, normalizeTurkishPhone } from '@/utils/phone';
import { sendRegistrationVerificationCode, type VerificationSmsProvider, verifyRegistrationVerificationCode } from '@/utils/authVerification';
import { keyboardAvoidingBehavior, keyboardVerticalOffset } from '@/utils/platform';
import { APP_BRAND } from '@/constants/branding';

interface VerifiedContactSnapshot {
  email: string;
  phone: string;
}

function extractErrorMessage(e: unknown): string {
  const errObj = e as any;
  const msg = errObj?.message || errObj?.data?.message || errObj?.shape?.message || '';
  console.log('[RegisterCustomer] Error details - message:', msg, 'name:', errObj?.name, 'code:', errObj?.data?.code, 'cause:', errObj?.cause, 'full:', JSON.stringify(errObj).substring(0, 800));

  if (errObj?.data?.code === 'TOO_MANY_REQUESTS') {
    return 'Çok fazla deneme yaptınız. Lütfen biraz bekleyin.';
  }

  if (typeof msg === 'string' && msg.length > 0) {
    const lower = msg.toLowerCase();
    if (lower.includes('unexpected') && (lower.includes('json') || lower.includes('token') || lower.includes('position'))) {
      return 'Sunucu geçici olarak yanıt veremiyor. Lütfen birkaç saniye bekleyip tekrar deneyin.';
    }
    if (lower.includes('syntaxerror') || lower.includes('not valid json')) {
      return 'Sunucu geçici olarak yanıt veremiyor. Lütfen birkaç saniye bekleyip tekrar deneyin.';
    }
    return msg;
  }
  return 'Kayıt oluşturulamadı. Lütfen tekrar deneyin.';
}

export default function RegisterCustomerScreen() {
  const router = useRouter();
  const { registerCustomer } = useAuth();
  const { width } = useWindowDimensions();
  const isSmall = width < 360;
  const isTablet = width >= 600;
  const hPad = isSmall ? 18 : isTablet ? 40 : 24;
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedDistrict, setSelectedDistrict] = useState<string>('');
  const [showCityPicker, setShowCityPicker] = useState<boolean>(false);
  const [showDistrictPicker, setShowDistrictPicker] = useState<boolean>(false);
  const [citySearch, setCitySearch] = useState<string>('');
  const [districtSearch, setDistrictSearch] = useState<string>('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [vehiclePlate, setVehiclePlate] = useState<string>('');
  const [agreementAccepted, setAgreementAccepted] = useState<boolean>(false);
  const [showAgreementModal, setShowAgreementModal] = useState<boolean>(false);
  const [kvkkAccepted, setKvkkAccepted] = useState<boolean>(false);
  const [referralCode, setReferralCode] = useState<string>('');
  const [verificationCode, setVerificationCode] = useState<string>('');
  const [showVerificationModal, setShowVerificationModal] = useState<boolean>(false);
  const [verificationBusy, setVerificationBusy] = useState<boolean>(false);
  const [verificationConfirming, setVerificationConfirming] = useState<boolean>(false);
  const [verificationMaskedPhone, setVerificationMaskedPhone] = useState<string | null>(null);
  const [verificationDeliveryNote, setVerificationDeliveryNote] = useState<string | null>(null);
  const [verificationProvider, setVerificationProvider] = useState<VerificationSmsProvider | null>(null);
  const [verifiedContactSnapshot, setVerifiedContactSnapshot] = useState<VerifiedContactSnapshot | null>(null);
  const { acceptAllConsents } = usePrivacy();

  const filteredCities = useMemo(() => {
    if (!citySearch.trim()) return TURKISH_CITIES;
    const q = citySearch.toLowerCase();
    return TURKISH_CITIES.filter(c => c.name.toLowerCase().includes(q));
  }, [citySearch]);

  const cityObj = useMemo(() => getCityByName(selectedCity), [selectedCity]);

  const filteredDistricts = useMemo(() => {
    if (!cityObj) return [];
    if (!districtSearch.trim()) return cityObj.districts;
    const q = districtSearch.toLowerCase();
    return cityObj.districts.filter(d => d.toLowerCase().includes(q));
  }, [cityObj, districtSearch]);

  const handleSelectCity = (city: City) => {
    setSelectedCity(city.name);
    setSelectedDistrict('');
    setShowCityPicker(false);
    setCitySearch('');
    console.log('Selected city:', city.name);
  };

  const handleSelectDistrict = (district: string) => {
    setSelectedDistrict(district);
    setShowDistrictPicker(false);
    setDistrictSearch('');
    console.log('Selected district:', district);
  };

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = normalizeTurkishPhone(phone);
  const isRegistrationVerified = !!verifiedContactSnapshot && verifiedContactSnapshot.email === normalizedEmail && verifiedContactSnapshot.phone === normalizedPhone;
  const isActionBusy = loading || verificationBusy || verificationConfirming;
  const registerButtonLabel = isRegistrationVerified ? 'Kaydı Tamamla' : 'SMS Kodu Gönder ve Devam Et';

  const clearVerificationState = () => {
    setVerificationCode('');
    setShowVerificationModal(false);
    setVerificationMaskedPhone(null);
    setVerificationDeliveryNote(null);
    setVerificationProvider(null);
    setVerifiedContactSnapshot(null);
  };

  const maybeResetVerificationState = (nextEmail: string, nextPhone: string) => {
    const nextNormalizedEmail = nextEmail.trim().toLowerCase();
    const nextNormalizedPhone = normalizeTurkishPhone(nextPhone);
    if (verifiedContactSnapshot && (verifiedContactSnapshot.email !== nextNormalizedEmail || verifiedContactSnapshot.phone !== nextNormalizedPhone)) {
      console.log('[RegisterCustomer] Verification invalidated for changed contact fields');
      clearVerificationState();
    }
  };

  const handlePhoneChange = (value: string) => {
    const nextPhone = normalizeTurkishPhone(value);
    maybeResetVerificationState(email, nextPhone);
    setPhone(nextPhone);
  };

  const handleEmailChange = (value: string) => {
    maybeResetVerificationState(value, phone);
    setEmail(value);
  };

  const submitRegistration = async (sanitizedPhone: string) => {
    setLoading(true);
    try {
      console.log('[RegisterCustomer] Starting registration for:', normalizedEmail, 'verified:', isRegistrationVerified);
      await registerCustomer(name, sanitizedPhone, normalizedEmail, password, gender as 'male' | 'female', selectedCity, selectedDistrict, vehiclePlate || undefined, referralCode || undefined);
      try {
        await acceptAllConsents();
      } catch (consentError) {
        console.log('[RegisterCustomer] Consent persistence warning (non-critical):', consentError);
      }
      console.log('[RegisterCustomer] Registration successful');
      router.replace('/(customer-tabs)/dashboard');
    } catch (e: unknown) {
      console.log('[RegisterCustomer] Register error:', e);
      const errorMsg = extractErrorMessage(e);
      Alert.alert('Hata', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const startPhoneVerification = async (sanitizedPhone: string) => {
    setVerificationBusy(true);
    try {
      const result = await sendRegistrationVerificationCode({
        name: name.trim(),
        email: normalizedEmail,
        phone: sanitizedPhone,
        deliveryMethod: 'sms',
      });

      if (!result.success) {
        throw new Error(result.error ?? 'Doğrulama kodu gönderilemedi.');
      }

      setVerificationCode('');
      setVerificationMaskedPhone(result.maskedPhone ?? sanitizedPhone);
      setVerificationDeliveryNote(result.deliveryNote ?? null);
      setVerificationProvider(result.smsProvider ?? null);
      setShowVerificationModal(true);
      console.log('[RegisterCustomer] Verification code sent for:', normalizedEmail, 'maskedPhone:', result.maskedPhone ?? 'none', 'provider:', result.smsProvider ?? 'unknown');
    } catch (error: unknown) {
      console.log('[RegisterCustomer] Verification send error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Doğrulama kodu gönderilemedi. Lütfen tekrar deneyin.';
      Alert.alert('Hata', errorMessage);
    } finally {
      setVerificationBusy(false);
    }
  };

  const handleVerifyPhoneCode = async () => {
    if (verificationCode.trim().length !== 6) {
      Alert.alert('Uyarı', 'Lütfen 6 haneli SMS kodunu girin');
      return;
    }

    setVerificationConfirming(true);
    try {
      const result = await verifyRegistrationVerificationCode({
        email: normalizedEmail,
        code: verificationCode.trim(),
      });

      if (!result.success) {
        throw new Error(result.error ?? 'Doğrulama kodu hatalı.');
      }

      setVerifiedContactSnapshot({
        email: normalizedEmail,
        phone: normalizedPhone,
      });
      setShowVerificationModal(false);
      setVerificationCode('');
      console.log('[RegisterCustomer] Phone verification completed for:', normalizedEmail);
      await submitRegistration(normalizedPhone);
    } catch (error: unknown) {
      console.log('[RegisterCustomer] Verification confirm error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Doğrulama kodu onaylanamadı. Lütfen tekrar deneyin.';
      Alert.alert('Hata', errorMessage);
    } finally {
      setVerificationConfirming(false);
    }
  };

  const handleRegister = async () => {
    if (!name || !phone || !email || !password) {
      Alert.alert('Uyarı', 'Lütfen tüm alanları doldurun');
      return;
    }
    const phoneValidationError = getTurkishPhoneValidationError(normalizedPhone);
    if (phoneValidationError) {
      Alert.alert('Uyarı', phoneValidationError);
      return;
    }
    if (!isValidEmail(email)) {
      Alert.alert('Uyarı', 'Lütfen geçerli bir e-posta adresi girin (örn: ornek@email.com)');
      return;
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      Alert.alert('Uyarı', 'Şifre en az 8 karakter olmalı ve büyük harf, küçük harf, rakam içermelidir');
      return;
    }
    if (!gender) {
      Alert.alert('Uyarı', 'Lütfen cinsiyet seçin');
      return;
    }
    if (!selectedCity || !selectedDistrict) {
      Alert.alert('Uyarı', 'Lütfen il ve ilçe seçin');
      return;
    }
    if (!agreementAccepted) {
      Alert.alert('Uyarı', 'Devam etmek için sorumluluk reddi sözleşmesini kabul etmelisiniz');
      return;
    }
    if (!kvkkAccepted) {
      Alert.alert('Uyarı', 'Devam etmek için KVKK aydınlatma metnini kabul etmelisiniz');
      return;
    }
    if (!isRegistrationVerified) {
      await startPhoneVerification(normalizedPhone);
      return;
    }

    await submitRegistration(normalizedPhone);
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView behavior={keyboardAvoidingBehavior()} style={styles.flex} keyboardVerticalOffset={keyboardVerticalOffset()}>
          <ScrollView contentContainerStyle={[styles.scrollContent, { paddingHorizontal: hPad, maxWidth: isTablet ? 520 : undefined, alignSelf: isTablet ? 'center' as const : undefined, width: isTablet ? '100%' as unknown as number : undefined }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.headerRow}>
              <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                <ArrowLeft size={22} color={Colors.dark.text} />
              </TouchableOpacity>

            </View>
            <View style={styles.badge}>
              <User size={16} color={Colors.dark.primary} />
              <Text style={styles.badgeText}>Müşteri Kaydı</Text>
            </View>
            <Text style={styles.brandText}>{APP_BRAND}</Text>
            <Text style={[styles.title, { fontSize: isSmall ? 26 : isTablet ? 34 : 30 }]}>Hesap Oluştur</Text>
            <Text style={[styles.subtitle, { fontSize: isSmall ? 13 : 15 }]}>Güvenli yolculuk için kayıt olun</Text>
            <View style={styles.formSection}>
              <InputField renderIcon={() => <User size={18} color={Colors.dark.textMuted} />} label="Ad Soyad" placeholder="Adınızı girin" value={name} onChangeText={setName} />
              <InputField renderIcon={() => <Phone size={18} color={Colors.dark.textMuted} />} label="Telefon" placeholder="05XXXXXXXXX" value={phone} onChangeText={handlePhoneChange} keyboardType="phone-pad" helpText="Telefon numarası 11 haneli olmalı ve 0 ile başlamalı. Kayıt tamamlanmadan önce bu numaraya SMS doğrulama kodu gönderilir." />
              <InputField renderIcon={() => <Mail size={18} color={Colors.dark.textMuted} />} label="E-posta" placeholder="ornek@email.com" value={email} onChangeText={handleEmailChange} keyboardType="email-address" />
              <InputField renderIcon={() => <Lock size={18} color={Colors.dark.textMuted} />} label="Şifre" placeholder="En az 8 karakter, büyük/küçük harf, rakam" value={password} onChangeText={setPassword} secure />
              <InputField renderIcon={() => <Hash size={18} color={Colors.dark.textMuted} />} label="Araç Plakası" placeholder="34 ABC 123" value={vehiclePlate} onChangeText={(t) => setVehiclePlate(t.toUpperCase())} autoCapitalize="characters" />
              <InputField renderIcon={() => <Gift size={18} color={Colors.dark.textMuted} />} label="Davet Kodu (Opsiyonel)" placeholder="Arkadaşınızın davet kodu" value={referralCode} onChangeText={(t) => setReferralCode(t.toUpperCase())} autoCapitalize="characters" />
            </View>
            <Text style={styles.sectionTitle}>Cinsiyet</Text>
            <View style={styles.genderRow}>
              <TouchableOpacity
                style={[styles.genderOption, gender === 'male' && styles.genderOptionSelected]}
                onPress={() => setGender('male')}
                activeOpacity={0.7}
              >
                <UserCircle size={22} color={gender === 'male' ? Colors.dark.primary : Colors.dark.textMuted} />
                <Text style={[styles.genderText, gender === 'male' && styles.genderTextSelected]}>Erkek</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.genderOption, gender === 'female' && styles.genderOptionSelected]}
                onPress={() => setGender('female')}
                activeOpacity={0.7}
              >
                <UserCircle size={22} color={gender === 'female' ? Colors.dark.primary : Colors.dark.textMuted} />
                <Text style={[styles.genderText, gender === 'female' && styles.genderTextSelected]}>Kadın</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.sectionTitle}>Hizmet Bölgesi</Text>
            <Text style={styles.sectionNote}>Sadece seçtiğiniz ildeki şoförlerle eşleştirilirsiniz</Text>
            <View style={styles.formSection}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>İL</Text>
                <TouchableOpacity
                  style={styles.pickerButton}
                  onPress={() => { Keyboard.dismiss(); setTimeout(() => setShowCityPicker(true), 100); }}
                  activeOpacity={0.7}
                >
                  <MapPin size={18} color={selectedCity ? Colors.dark.primary : Colors.dark.textMuted} />
                  <Text style={[styles.pickerText, !selectedCity && styles.pickerPlaceholder]}>
                    {selectedCity || 'İl seçin'}
                  </Text>
                  <ChevronDown size={18} color={Colors.dark.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>İLÇE</Text>
                <TouchableOpacity
                  style={[styles.pickerButton, !selectedCity && styles.pickerDisabled]}
                  onPress={() => {
                    Keyboard.dismiss();
                    if (selectedCity) setTimeout(() => setShowDistrictPicker(true), 100);
                    else Alert.alert('Uyarı', 'Önce il seçin');
                  }}
                  activeOpacity={0.7}
                >
                  <MapPin size={18} color={selectedDistrict ? Colors.dark.secondary : Colors.dark.textMuted} />
                  <Text style={[styles.pickerText, !selectedDistrict && styles.pickerPlaceholder]}>
                    {selectedDistrict || 'İlçe seçin'}
                  </Text>
                  <ChevronDown size={18} color={Colors.dark.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.featureList}>
              {['Sadece bulunduğunuz ilde hizmet', 'Profesyonel şoförler', 'Güvenli ödeme sistemi'].map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <CheckCircle size={16} color={Colors.dark.success} />
                  <Text style={styles.featureText}>{f}</Text>
                </View>
              ))}
            </View>
            <View style={styles.agreementSection}>
              <View style={styles.agreementRow}>
                <TouchableOpacity
                  onPress={() => setAgreementAccepted(!agreementAccepted)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  {agreementAccepted ? (
                    <CheckSquare size={22} color={Colors.dark.primary} />
                  ) : (
                    <Square size={22} color={Colors.dark.textMuted} />
                  )}
                </TouchableOpacity>
                <Text style={styles.agreementText}>
                  Koşulları okudum ve kabul ediyorum.{' '}
                  <Text style={styles.agreementLink} onPress={() => setShowAgreementModal(true)}>Tıklayınız</Text>
                </Text>
              </View>
              <View style={styles.agreementRow}>
                <TouchableOpacity
                  onPress={() => setKvkkAccepted(!kvkkAccepted)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  {kvkkAccepted ? (
                    <CheckSquare size={22} color={Colors.dark.primary} />
                  ) : (
                    <Square size={22} color={Colors.dark.textMuted} />
                  )}
                </TouchableOpacity>
                <Text style={styles.agreementText}>
                  KVKK aydınlatma metnini okudum, kişisel verilerimin işlenmesini kabul ediyorum.{' '}
                  <Text style={styles.agreementLink} onPress={() => router.push('/privacy-policy' as any)}>Aydınlatma Metni</Text>
                </Text>
              </View>
            </View>

            {isRegistrationVerified ? (
              <View style={styles.verificationBanner}>
                <View style={styles.verificationBannerIcon}>
                  <CheckCircle size={16} color={Colors.dark.success} />
                </View>
                <View style={styles.verificationBannerContent}>
                  <Text style={styles.verificationBannerTitle}>Telefon doğrulandı</Text>
                  <Text style={styles.verificationBannerText}>Bu numara için SMS onayı tamamlandı. Şimdi hesabınızı oluşturabilirsiniz.</Text>
                </View>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.registerButton, (!agreementAccepted || !kvkkAccepted || isActionBusy) && styles.registerButtonDisabled, { paddingVertical: isSmall ? 15 : 18, borderRadius: isSmall ? 12 : 16 }]}
              onPress={handleRegister}
              disabled={isActionBusy || !agreementAccepted || !kvkkAccepted}
              activeOpacity={0.85}
              testID="register-customer-submit-button"
            >
              {isActionBusy ? (
                <ActivityIndicator color={Colors.dark.background} size="small" />
              ) : (
                <Text style={styles.registerButtonText}>{registerButtonLabel}</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <VerificationCodeModal
        visible={showVerificationModal}
        title="Telefonunu doğrula"
        subtitle="Hesabını açmadan önce telefonuna gelen SMS kodunu doğrulaman gerekiyor."
        code={verificationCode}
        onCodeChange={setVerificationCode}
        onClose={() => setShowVerificationModal(false)}
        onConfirm={handleVerifyPhoneCode}
        onResend={() => startPhoneVerification(normalizedPhone)}
        isConfirming={verificationConfirming}
        isResending={verificationBusy}
        maskedPhone={verificationMaskedPhone}
        deliveryNote={verificationDeliveryNote}
        providerName={verificationProvider === 'netgsm' ? 'NetGSM' : null}
        confirmLabel="Telefonu Onayla"
        resendLabel="Kodu Yeniden Gönder"
        testIDPrefix="register-customer-verification"
      />

      <Modal visible={showCityPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={keyboardAvoidingBehavior()} style={styles.modalContent} keyboardVerticalOffset={keyboardVerticalOffset()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>İl Seçin</Text>
              <TouchableOpacity onPress={() => { setShowCityPicker(false); setCitySearch(''); }}>
                <X size={22} color={Colors.dark.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalSearchRow}>
              <Search size={18} color={Colors.dark.textMuted} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="İl ara..."
                placeholderTextColor={Colors.dark.textMuted}
                value={citySearch}
                onChangeText={setCitySearch}
                autoFocus
              />
            </View>
            <FlatList
              data={filteredCities}
              keyExtractor={(item) => item.name}
              style={styles.modalList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, item.name === selectedCity && styles.modalItemSelected]}
                  onPress={() => handleSelectCity(item)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modalItemText, item.name === selectedCity && styles.modalItemTextSelected]}>
                    {item.plateCode} - {item.name}
                  </Text>
                  {item.name === selectedCity && <CheckCircle size={18} color={Colors.dark.primary} />}
                </TouchableOpacity>
              )}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          </KeyboardAvoidingView>
        </View>
      </Modal>
      <Modal visible={showDistrictPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={keyboardAvoidingBehavior()} style={styles.modalContent} keyboardVerticalOffset={keyboardVerticalOffset()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedCity} - İlçe Seçin</Text>
              <TouchableOpacity onPress={() => { setShowDistrictPicker(false); setDistrictSearch(''); }}>
                <X size={22} color={Colors.dark.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalSearchRow}>
              <Search size={18} color={Colors.dark.textMuted} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="İlçe ara..."
                placeholderTextColor={Colors.dark.textMuted}
                value={districtSearch}
                onChangeText={setDistrictSearch}
                autoFocus
              />
            </View>
            <FlatList
              data={filteredDistricts}
              keyExtractor={(item) => item}
              style={styles.modalList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, item === selectedDistrict && styles.modalItemSelected]}
                  onPress={() => handleSelectDistrict(item)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modalItemText, item === selectedDistrict && styles.modalItemTextSelected]}>
                    {item}
                  </Text>
                  {item === selectedDistrict && <CheckCircle size={18} color={Colors.dark.primary} />}
                </TouchableOpacity>
              )}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          </KeyboardAvoidingView>
        </View>
      </Modal>
      <Modal visible={showAgreementModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.agreementModalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.agreementModalHeaderRow}>
                <FileText size={18} color={Colors.dark.primary} />
                <Text style={styles.modalTitle}>Sorumluluk Reddi Sözleşmesi</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAgreementModal(false)}>
                <X size={22} color={Colors.dark.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.agreementModalScroll} showsVerticalScrollIndicator={true}>
              <Text style={styles.agreementModalText}>
                ForYou uygulaması yalnızca müşteri ile şoför arasında aracılık hizmeti sunar.{"\n\n"}
                • Yolculuk sırasında meydana gelebilecek her türlü kaza, hasar, yaralanma veya maddi/manevi zarardan ForYou şirketi sorumlu tutulamaz.{"\n\n"}
                • Araçta oluşabilecek çizik, ezik, kırık veya herhangi bir hasar durumunda sorumluluk tamamen yolculuğun taraflarına (müşteri ve/veya şoför) aittir.{"\n\n"}
                • Müşteri, yolculuk süresince aracın içinde veya dışında vereceği her türlü zarardan şahsen sorumludur.{"\n\n"}
                • Şoförün müşterinin aracına verdiği her türlü zarar (çizik, ezik, kırık, mekanik hasar vb.) tamamen şoförün kendi sorumluluğundadır. ForYou bu zararlardan hiçbir şekilde sorumlu tutulamaz.{"\n\n"}
                • Şoförün kusurlu davranışından kaynaklanan diğer tüm zararlar da şoförün kendi sorumluluğundadır.{"\n\n"}
                • ForYou, taraflar arasındaki anlaşmazlıklarda arabuluculuk yapabilir ancak hukuki sorumluluk kabul etmez.{"\n\n"}
                • İşbu sözleşmeden doğan her türlü uyuşmazlıkta Denizli Mahkemeleri ve İcra Daireleri yetkilidir.{"\n\n"}
                • Bu sözleşmeyi kabul ederek, yukarıdaki koşulları okuduğunuzu ve anladığınızı beyan etmiş olursunuz.
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={styles.agreementModalButton}
              onPress={() => {
                setAgreementAccepted(true);
                setShowAgreementModal(false);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.agreementModalButtonText}>Okudum ve Kabul Ediyorum</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </View>
  );
}

function InputField({ renderIcon, label, placeholder, value, onChangeText, keyboardType, secure, autoCapitalize, helpText }: {
  renderIcon: () => React.ReactElement; label: string; placeholder: string; value: string;
  onChangeText: (t: string) => void; keyboardType?: 'default' | 'phone-pad' | 'email-address'; secure?: boolean; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'; helpText?: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.inputWrapper}>
        {renderIcon()}
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={Colors.dark.textMuted}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          secureTextEntry={secure}
          autoCapitalize={autoCapitalize}
        />
      </View>
      {helpText ? <Text style={styles.inputHelpText}>{helpText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { paddingTop: 12, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  backButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.dark.card, justifyContent: 'center', alignItems: 'center' },

  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(245,166,35,0.1)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, alignSelf: 'flex-start', marginBottom: 16 },
  badgeText: { fontSize: 13, fontWeight: '600', color: Colors.dark.primary },
  brandText: { fontSize: 12, fontWeight: '800' as const, color: Colors.dark.primary, letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' },
  title: { fontSize: 30, fontWeight: '800', color: Colors.dark.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: Colors.dark.textSecondary, marginTop: 6, marginBottom: 28 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.dark.text, marginBottom: 6 },
  sectionNote: { fontSize: 13, color: Colors.dark.textMuted, marginBottom: 16 },
  formSection: { gap: 18, marginBottom: 28 },
  inputGroup: { gap: 8 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: Colors.dark.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.dark.inputBg, borderRadius: 14, borderWidth: 1, borderColor: Colors.dark.inputBorder, paddingHorizontal: 16, gap: 12 },
  input: { flex: 1, paddingVertical: 16, fontSize: 16, color: Colors.dark.text },
  inputHelpText: { fontSize: 12, lineHeight: 18, color: Colors.dark.textMuted },
  pickerButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.dark.inputBg,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.dark.inputBorder,
    paddingHorizontal: 16, paddingVertical: 16, gap: 12,
  },
  pickerDisabled: { opacity: 0.5 },
  pickerText: { flex: 1, fontSize: 16, color: Colors.dark.text },
  pickerPlaceholder: { color: Colors.dark.textMuted },
  genderRow: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  genderOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.dark.inputBg, borderRadius: 14, borderWidth: 1,
    borderColor: Colors.dark.inputBorder, paddingVertical: 16,
  },
  genderOptionSelected: {
    borderColor: Colors.dark.primary, backgroundColor: 'rgba(245,166,35,0.08)',
  },
  genderText: { fontSize: 16, fontWeight: '600' as const, color: Colors.dark.textMuted },
  genderTextSelected: { color: Colors.dark.primary },
  featureList: { gap: 12, marginBottom: 32 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { fontSize: 14, color: Colors.dark.textSecondary },
  agreementSection: { marginBottom: 24 },
  agreementRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  agreementText: { flex: 1, fontSize: 14, color: Colors.dark.text, lineHeight: 20, marginTop: 1 },
  agreementLink: { color: Colors.dark.primary, fontWeight: '700' as const, textDecorationLine: 'underline' as const },
  agreementModalContent: { backgroundColor: Colors.dark.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%', overflow: 'hidden' as const },
  agreementModalHeaderRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  agreementModalScroll: { paddingHorizontal: 20, paddingBottom: 16, maxHeight: 400 },
  agreementModalText: { fontSize: 14, color: Colors.dark.textSecondary, lineHeight: 22 },
  agreementModalButton: { backgroundColor: Colors.dark.primary, marginHorizontal: 20, marginVertical: 16, paddingVertical: 16, borderRadius: 14, alignItems: 'center' as const },
  agreementModalButtonText: { fontSize: 16, fontWeight: '700' as const, color: Colors.dark.background },
  verificationBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 18,
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(46,204,113,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.16)',
  },
  verificationBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(46,204,113,0.16)',
  },
  verificationBannerContent: {
    flex: 1,
    gap: 4,
  },
  verificationBannerTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.dark.text,
  },
  verificationBannerText: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.dark.textSecondary,
  },
  registerButton: { backgroundColor: Colors.dark.primary, paddingVertical: 18, borderRadius: 16, alignItems: 'center' },
  registerButtonDisabled: { opacity: 0.6 },
  registerButtonText: { fontSize: 17, fontWeight: '700', color: Colors.dark.background },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.dark.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%', overflow: 'hidden' as const },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: Colors.dark.text },
  modalSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.dark.card, borderRadius: 12,
    marginHorizontal: 20, marginBottom: 12, paddingHorizontal: 14,
  },
  modalSearchInput: { flex: 1, paddingVertical: 14, fontSize: 15, color: Colors.dark.text },
  modalList: { flexGrow: 0 },
  modalItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.dark.divider,
  },
  modalItemSelected: { backgroundColor: 'rgba(245,166,35,0.08)' },
  modalItemText: { fontSize: 16, color: Colors.dark.text },
  modalItemTextSelected: { color: Colors.dark.primary, fontWeight: '600' },

});
