import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ChevronLeft,
  Users,
  MapPin,
  Navigation,
  MessageCircle,
  Shield,
  Banknote,
  Phone,
  CheckCircle,
  Plus,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import {
  useRideForOtherRecipients,
  useRideForOthers,
  type RideForOtherPaymentMode,
  type RideRecipient,
} from '@/contexts/RideForOthersContext';
import { getTurkishPhoneValidationError, normalizeTurkishPhone } from '@/utils/phone';

const ACCENT = '#23008B';
const ACCENT_SOFT = '#F1EEFF';
const TEXT_PRIMARY = '#112244';
const TEXT_MUTED = '#6E7692';
const CARD_BG = '#FFFFFF';
const SCREEN_BG = '#F4F5F9';

export default function RideForSomeoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const recipients = useRideForOtherRecipients();
  const {
    draft,
    saveRecipient,
    selectRecipient,
    removeRecipient,
    setRideForOtherDraft,
  } = useRideForOthers();

  const [passengerName, setPassengerName] = useState<string>(draft.recipient?.name ?? '');
  const [passengerPhone, setPassengerPhone] = useState<string>(draft.recipient?.phone ?? '');
  const [passengerRelation, setPassengerRelation] = useState<string>(draft.recipient?.relation ?? '');
  const [paymentMode, setPaymentMode] = useState<RideForOtherPaymentMode>(draft.paymentMode);
  const [shareBySms, setShareBySms] = useState<boolean>(draft.shareBySms);
  const [shareByWhatsApp, setShareByWhatsApp] = useState<boolean>(draft.shareByWhatsApp);
  const [liveTrackingEnabled, setLiveTrackingEnabled] = useState<boolean>(draft.liveTrackingEnabled);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const pickupAddress = useMemo(() => {
    if (user?.city && user?.district) {
      return `${user.city}, ${user.district}`;
    }

    if (user?.city) {
      return user.city;
    }

    return 'Mevcut konumunuz';
  }, [user?.city, user?.district]);

  const normalizedPhone = useMemo(() => normalizeTurkishPhone(passengerPhone), [passengerPhone]);
  const phoneError = useMemo(() => {
    if (!normalizedPhone && !passengerName.trim()) {
      return null;
    }

    return getTurkishPhoneValidationError(normalizedPhone);
  }, [normalizedPhone, passengerName]);

  const activeRecipientId = draft.recipient?.id ?? null;
  const hasManualInput = passengerName.trim().length > 0 || normalizedPhone.length > 0 || passengerRelation.trim().length > 0;

  useEffect(() => {
    if (!draft.recipient) {
      return;
    }

    setPassengerName(draft.recipient.name);
    setPassengerPhone(draft.recipient.phone);
    setPassengerRelation(draft.recipient.relation ?? '');
  }, [draft.recipient, draft.recipient?.id, draft.recipient?.name, draft.recipient?.phone, draft.recipient?.relation]);

  const applyDraftOptions = useCallback((recipient: RideRecipient | null) => {
    setRideForOtherDraft({
      enabled: !!recipient,
      recipient,
      paymentMode,
      shareBySms,
      shareByWhatsApp,
      liveTrackingEnabled,
    });
  }, [liveTrackingEnabled, paymentMode, setRideForOtherDraft, shareBySms, shareByWhatsApp]);

  const handleSaveManualRecipient = useCallback(async (): Promise<RideRecipient | null> => {
    if (!passengerName.trim()) {
      Alert.alert('Eksik bilgi', 'Lütfen yolcunun adını girin.');
      return null;
    }

    if (phoneError) {
      Alert.alert('Telefon numarası hatalı', phoneError);
      return null;
    }

    setIsSaving(true);

    try {
      const recipient = await saveRecipient({
        name: passengerName,
        phone: normalizedPhone,
        relation: passengerRelation,
      });
      applyDraftOptions(recipient);
      Alert.alert('Kişi kaydedildi', 'Yolcu bilgileri hazır. Şimdi adres seçebilirsiniz.');
      return recipient;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kişi kaydedilemedi.';
      Alert.alert('Hata', message);
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [applyDraftOptions, normalizedPhone, passengerName, passengerRelation, phoneError, saveRecipient]);

  const handleContinue = useCallback(async () => {
    let recipient = draft.recipient;

    if (hasManualInput) {
      recipient = await handleSaveManualRecipient();
    }

    if (!recipient) {
      Alert.alert('Yolcu seçilmedi', 'Devam etmek için bir kişi ekleyin veya kayıtlı bir kişiyi seçin.');
      return;
    }

    applyDraftOptions(recipient);

    router.navigate({
      pathname: '/(customer-tabs)/dashboard' as any,
      params: { openSearch: '1' },
    });
  }, [applyDraftOptions, draft.recipient, handleSaveManualRecipient, hasManualInput, router]);

  const handleUseSavedRecipient = useCallback((recipientId: string) => {
    selectRecipient(recipientId);
  }, [selectRecipient]);

  const handleRemoveRecipient = useCallback((recipientId: string) => {
    Alert.alert('Kişiyi sil', 'Bu kayıtlı kişiyi kaldırmak istiyor musunuz?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => removeRecipient(recipientId),
      },
    ]);
  }, [removeRecipient]);

  const infoRows = useMemo(() => ([
    {
      key: 'sms',
      icon: <MessageCircle size={20} color={ACCENT} />,
      text: 'Yolculuk detaylarını yolcuya SMS veya WhatsApp üzerinden paylaşabilirsin.',
    },
    {
      key: 'tracking',
      icon: <Navigation size={20} color={ACCENT} />,
      text: 'Misafir, gönderilen bilgilendirme ile sürücünün gelişini takip edebilir.',
    },
    {
      key: 'payment',
      icon: <Banknote size={20} color={ACCENT} />,
      text: 'İstersen ödemeyi uygulamadan sen yap, istersen misafir araçta ödesin.',
    },
    {
      key: 'safety',
      icon: <Shield size={20} color={ACCENT} />,
      text: 'Canlı takip açık olduğunda yolculuğu uygulama içinden sen de izleyebilirsin.',
    },
  ]), []);

  return (
    <View style={styles.container}>
      <View style={styles.heroBg} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <KeyboardAvoidingView
          style={styles.keyboardWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.headerBack}
              onPress={() => router.back()}
              activeOpacity={0.8}
              testID="ride-for-someone-back"
            >
              <ChevronLeft size={24} color={TEXT_PRIMARY} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Adres ara</Text>
            <View style={styles.headerBack} />
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 132, 184) }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <TouchableOpacity style={styles.activePill} activeOpacity={0.9} testID="ride-for-someone-pill">
              <Users size={18} color="#FFFFFF" />
              <Text style={styles.activePillText}>Başkasına çağır</Text>
            </TouchableOpacity>

            <View style={styles.routeCard}>
              <View style={styles.routeIconColumn}>
                <View style={styles.routeCircle} />
                <View style={styles.routeConnector} />
                <View style={[styles.routeCircle, styles.routeCircleOutline]}>
                  <MapPin size={14} color={ACCENT} />
                </View>
              </View>
              <View style={styles.routeInputsColumn}>
                <View style={styles.routeInputCard}>
                  <Text style={styles.routeValue} numberOfLines={1}>{pickupAddress}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.routeInputCard, styles.routeInputAction]}
                  activeOpacity={0.8}
                  onPress={handleContinue}
                  testID="ride-for-someone-open-destination"
                >
                  <Text style={styles.routePlaceholder}>Nereye?</Text>
                  <Text style={styles.routeHint}>Adres seçimine geç</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.shortcutRow}>
              <View style={styles.shortcutChip}>
                <Plus size={20} color={ACCENT} />
                <Text style={styles.shortcutChipText}>Yolcu ekle</Text>
              </View>
              <View style={styles.shortcutChip}>
                <Phone size={20} color={ACCENT} />
                <Text style={styles.shortcutChipText}>Telefon doğrula</Text>
              </View>
            </View>

            <View style={styles.infoSheet}>
              <View style={styles.infoHandle} />
              <Text style={styles.infoTitle}>Sevdiklerine sürücü çağır</Text>
              {infoRows.map((item) => (
                <View key={item.key} style={styles.infoRow}>
                  <View style={styles.infoIconWrap}>{item.icon}</View>
                  <Text style={styles.infoText}>{item.text}</Text>
                </View>
              ))}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Yolcu bilgileri</Text>
              <Text style={styles.sectionSubtitle}>Yolculuk kimin için oluşturulacak?</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Ad Soyad</Text>
                <TextInput
                  style={styles.input}
                  value={passengerName}
                  onChangeText={setPassengerName}
                  placeholder="Örn. Ayşe Yılmaz"
                  placeholderTextColor="#A2A6B5"
                  testID="ride-for-someone-name"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Telefon numarası</Text>
                <TextInput
                  style={[styles.input, phoneError ? styles.inputError : null]}
                  value={passengerPhone}
                  onChangeText={setPassengerPhone}
                  placeholder="05XX XXX XX XX"
                  placeholderTextColor="#A2A6B5"
                  keyboardType="phone-pad"
                  maxLength={11}
                  testID="ride-for-someone-phone"
                />
                <Text style={[styles.inputHint, phoneError ? styles.inputHintError : null]}>
                  {phoneError ?? 'Telefon numarası 0 ile başlamalı ve 11 haneli olmalı.'}
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Yakınlık bilgisi</Text>
                <TextInput
                  style={styles.input}
                  value={passengerRelation}
                  onChangeText={setPassengerRelation}
                  placeholder="Örn. Annem, arkadaşım, misafirim"
                  placeholderTextColor="#A2A6B5"
                  testID="ride-for-someone-relation"
                />
              </View>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Bilgilendirme ve ödeme</Text>
              <Text style={styles.sectionSubtitle}>Yolculuk detayları nasıl yönetilsin?</Text>

              <Text style={styles.preferenceLabel}>Ödeme</Text>
              <View style={styles.optionRow}>
                <TouchableOpacity
                  style={[styles.optionChip, paymentMode === 'customer_app' && styles.optionChipActive]}
                  onPress={() => setPaymentMode('customer_app')}
                  activeOpacity={0.85}
                  testID="ride-for-someone-payment-self"
                >
                  <Text style={[styles.optionChipText, paymentMode === 'customer_app' && styles.optionChipTextActive]}>Ücreti ben öderim</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.optionChip, paymentMode === 'guest_in_car' && styles.optionChipActive]}
                  onPress={() => setPaymentMode('guest_in_car')}
                  activeOpacity={0.85}
                  testID="ride-for-someone-payment-guest"
                >
                  <Text style={[styles.optionChipText, paymentMode === 'guest_in_car' && styles.optionChipTextActive]}>Misafir araçta ödesin</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.preferenceLabel}>Bildirimler</Text>
              <View style={styles.optionRow}>
                <TouchableOpacity
                  style={[styles.optionChip, shareBySms && styles.optionChipActive]}
                  onPress={() => setShareBySms((currentValue) => !currentValue)}
                  activeOpacity={0.85}
                  testID="ride-for-someone-sms"
                >
                  <Text style={[styles.optionChipText, shareBySms && styles.optionChipTextActive]}>SMS</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.optionChip, shareByWhatsApp && styles.optionChipActive]}
                  onPress={() => setShareByWhatsApp((currentValue) => !currentValue)}
                  activeOpacity={0.85}
                  testID="ride-for-someone-whatsapp"
                >
                  <Text style={[styles.optionChipText, shareByWhatsApp && styles.optionChipTextActive]}>WhatsApp</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.optionChip, liveTrackingEnabled && styles.optionChipActive]}
                  onPress={() => setLiveTrackingEnabled((currentValue) => !currentValue)}
                  activeOpacity={0.85}
                  testID="ride-for-someone-live-tracking"
                >
                  <Text style={[styles.optionChipText, liveTrackingEnabled && styles.optionChipTextActive]}>Canlı takip</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.savedHeader}>
                <View>
                  <Text style={styles.sectionTitle}>Kayıtlı kişiler</Text>
                  <Text style={styles.sectionSubtitle}>Tek dokunuşla tekrar yolculuk oluştur.</Text>
                </View>
                <View style={styles.savedCountBadge}>
                  <Text style={styles.savedCountText}>{recipients.length}</Text>
                </View>
              </View>

              {recipients.length === 0 ? (
                <View style={styles.emptySavedState}>
                  <Users size={22} color={TEXT_MUTED} />
                  <Text style={styles.emptySavedText}>Henüz kayıtlı kişi yok. İlk yolcunu eklediğinde burada görünecek.</Text>
                </View>
              ) : (
                recipients.map((recipient) => {
                  const isActive = activeRecipientId === recipient.id;
                  return (
                    <TouchableOpacity
                      key={recipient.id}
                      style={[styles.savedCard, isActive && styles.savedCardActive]}
                      activeOpacity={0.85}
                      onPress={() => handleUseSavedRecipient(recipient.id)}
                      testID={`ride-for-someone-saved-${recipient.id}`}
                    >
                      <View style={styles.savedAvatar}>
                        <Text style={styles.savedAvatarText}>{recipient.name.slice(0, 1).toUpperCase()}</Text>
                      </View>
                      <View style={styles.savedInfo}>
                        <Text style={styles.savedName}>{recipient.name}</Text>
                        <Text style={styles.savedPhone}>{recipient.phone}</Text>
                        {!!recipient.relation && <Text style={styles.savedRelation}>{recipient.relation}</Text>}
                      </View>
                      <View style={styles.savedActions}>
                        {isActive ? <CheckCircle size={20} color={ACCENT} /> : null}
                        <TouchableOpacity
                          style={styles.savedDeleteBtn}
                          onPress={() => handleRemoveRecipient(recipient.id)}
                          activeOpacity={0.7}
                          testID={`ride-for-someone-remove-${recipient.id}`}
                        >
                          <Text style={styles.savedDeleteText}>Sil</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </ScrollView>

          <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}> 
            <TouchableOpacity
              style={[styles.secondaryButton, isSaving && styles.buttonDisabled]}
              onPress={() => {
                void handleSaveManualRecipient();
              }}
              activeOpacity={0.85}
              disabled={isSaving}
              testID="ride-for-someone-save"
            >
              <Text style={styles.secondaryButtonText}>{isSaving ? 'Kaydediliyor...' : 'Telefon numarası ile kişi ekle'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => {
                void handleContinue();
              }}
              activeOpacity={0.88}
              testID="ride-for-someone-continue"
            >
              <Text style={styles.primaryButtonText}>Adres seçimine geç</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  heroBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 280,
    backgroundColor: '#ECEAF6',
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  safeArea: {
    flex: 1,
  },
  keyboardWrap: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  headerBack: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.76)',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: TEXT_PRIMARY,
  },
  scrollView: {
    flex: 1,
  },
  activePill: {
    marginTop: 8,
    marginHorizontal: 20,
    alignSelf: 'flex-start',
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  activePillText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  routeCard: {
    marginTop: 22,
    marginHorizontal: 20,
    flexDirection: 'row',
    gap: 14,
  },
  routeIconColumn: {
    width: 24,
    alignItems: 'center',
    paddingTop: 20,
  },
  routeCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: ACCENT,
  },
  routeCircleOutline: {
    backgroundColor: '#FFFFFF',
    borderWidth: 6,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeConnector: {
    width: 4,
    flex: 1,
    maxHeight: 74,
    borderRadius: 999,
    backgroundColor: '#C7C9DB',
    marginVertical: 8,
  },
  routeInputsColumn: {
    flex: 1,
    gap: 12,
  },
  routeInputCard: {
    minHeight: 76,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderBottomWidth: 4,
    borderBottomColor: '#C8C4DF',
  },
  routeInputAction: {
    borderBottomColor: ACCENT,
  },
  routeValue: {
    fontSize: 18,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  routePlaceholder: {
    fontSize: 18,
    color: TEXT_MUTED,
  },
  routeHint: {
    marginTop: 6,
    fontSize: 13,
    color: ACCENT,
    fontWeight: '700',
  },
  shortcutRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    marginHorizontal: 20,
  },
  shortcutChip: {
    flex: 1,
    minHeight: 68,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: ACCENT,
    backgroundColor: 'rgba(255,255,255,0.92)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  shortcutChipText: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  infoSheet: {
    marginTop: 24,
    backgroundColor: CARD_BG,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  infoHandle: {
    alignSelf: 'center',
    width: 96,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#D0D2E5',
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    color: TEXT_PRIMARY,
    marginBottom: 18,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 18,
  },
  infoIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    color: TEXT_PRIMARY,
    paddingTop: 4,
  },
  sectionCard: {
    marginTop: 16,
    marginHorizontal: 16,
    backgroundColor: CARD_BG,
    borderRadius: 28,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EAECF4',
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: TEXT_PRIMARY,
  },
  sectionSubtitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    color: TEXT_MUTED,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: TEXT_MUTED,
    marginBottom: 8,
  },
  input: {
    height: 56,
    borderRadius: 18,
    backgroundColor: '#F6F7FB',
    borderWidth: 1,
    borderColor: '#E5E7F0',
    paddingHorizontal: 16,
    fontSize: 16,
    color: TEXT_PRIMARY,
  },
  inputError: {
    borderColor: '#D93C62',
    backgroundColor: '#FFF5F7',
  },
  inputHint: {
    marginTop: 8,
    fontSize: 12,
    color: TEXT_MUTED,
  },
  inputHintError: {
    color: '#D93C62',
  },
  preferenceLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: TEXT_MUTED,
    marginBottom: 10,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  optionChip: {
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#F3F4F9',
    borderWidth: 1,
    borderColor: '#E4E6EF',
  },
  optionChipActive: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  optionChipText: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_MUTED,
  },
  optionChipTextActive: {
    color: '#FFFFFF',
  },
  savedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  savedCountBadge: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  savedCountText: {
    fontSize: 14,
    fontWeight: '800',
    color: ACCENT,
  },
  emptySavedState: {
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: '#F7F8FB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emptySavedText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: TEXT_MUTED,
  },
  savedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 22,
    backgroundColor: '#F8F9FC',
    borderWidth: 1,
    borderColor: '#E6E8F2',
    marginTop: 12,
  },
  savedCardActive: {
    backgroundColor: '#F3F0FF',
    borderColor: '#D6D0FF',
  },
  savedAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedAvatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  savedInfo: {
    flex: 1,
  },
  savedName: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  savedPhone: {
    fontSize: 14,
    color: TEXT_MUTED,
    marginTop: 2,
  },
  savedRelation: {
    fontSize: 13,
    color: ACCENT,
    fontWeight: '600',
    marginTop: 4,
  },
  savedActions: {
    alignItems: 'flex-end',
    gap: 10,
  },
  savedDeleteBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#FFF1F3',
  },
  savedDeleteText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D93C62',
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: CARD_BG,
    paddingTop: 14,
    paddingHorizontal: 16,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderTopColor: '#ECEEF6',
    gap: 12,
  },
  secondaryButton: {
    height: 58,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: ACCENT,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: ACCENT,
  },
  primaryButton: {
    height: 62,
    borderRadius: 20,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 10,
  },
  primaryButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
