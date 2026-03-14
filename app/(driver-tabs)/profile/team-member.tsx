import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator,
  Image, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, User, Phone, Mail, Lock, UserPlus, Camera, X, CheckCircle2, AlertCircle, AlertTriangle, ShieldCheck } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '@/constants/colors';
import { keyboardAvoidingBehavior, keyboardVerticalOffset } from '@/utils/platform';
import { useAuth } from '@/contexts/AuthContext';

interface DocField {
  key: string;
  label: string;
}

const DOC_SECTIONS: { title: string; items: DocField[] }[] = [
  {
    title: 'Kimlik Kartı',
    items: [
      { key: 'idCardFront', label: 'Ön Yüz' },
      { key: 'idCardBack', label: 'Arka Yüz' },
    ],
  },
  {
    title: 'Ehliyet (Sürücü Belgesi)',
    items: [
      { key: 'licenseFront', label: 'Ehliyet Fotoğrafı' },
    ],
  },
  {
    title: 'Adli Sicil Kaydı',
    items: [
      { key: 'criminalRecord', label: 'Adli Sicil Belgesi' },
    ],
  },
];

export default function TeamMemberScreen() {
  const router = useRouter();
  const { registerTeamMember, updateTeamMemberDocument } = useAuth();
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [licenseDay, setLicenseDay] = useState<string>('');
  const [licenseMonth, setLicenseMonth] = useState<string>('');
  const [licenseYear, setLicenseYear] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [documents, setDocuments] = useState<Record<string, string>>({});
  const [viewImage, setViewImage] = useState<string>('');

  const pickImage = useCallback(async (fieldKey: string) => {
    if (Platform.OS === 'web') {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          allowsEditing: true,
        });
        if (!result.canceled && result.assets && result.assets[0]) {
          setDocuments(prev => ({ ...prev, [fieldKey]: result.assets[0].uri }));
          console.log('Document picked (web):', fieldKey);
        }
      } catch (e) {
        console.log('Image picker error:', e);
      }
      return;
    }

    Alert.alert(
      'Belge Yükle',
      'Nasıl yüklemek istersiniz?',
      [
        {
          text: 'Kamera',
          onPress: async () => {
            try {
              const { status } = await ImagePicker.requestCameraPermissionsAsync();
              if (status !== 'granted') {
                Alert.alert('İzin Gerekli', 'Kamera izni verilmedi');
                return;
              }
              const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                quality: 0.8,
                allowsEditing: true,
              });
              if (!result.canceled && result.assets && result.assets[0]) {
                setDocuments(prev => ({ ...prev, [fieldKey]: result.assets[0].uri }));
                console.log('Document picked (camera):', fieldKey);
              }
            } catch (e) {
              console.log('Camera error:', e);
            }
          },
        },
        {
          text: 'Galeri',
          onPress: async () => {
            try {
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                quality: 0.8,
                allowsEditing: true,
              });
              if (!result.canceled && result.assets && result.assets[0]) {
                setDocuments(prev => ({ ...prev, [fieldKey]: result.assets[0].uri }));
                console.log('Document picked (gallery):', fieldKey);
              }
            } catch (e) {
              console.log('Gallery error:', e);
            }
          },
        },
        { text: 'İptal', style: 'cancel' },
      ]
    );
  }, []);

  const totalDocs = DOC_SECTIONS.reduce((acc, s) => acc + s.items.length, 0);
  const uploadedDocs = DOC_SECTIONS.reduce((acc, s) => {
    return acc + s.items.filter(i => !!documents[i.key]).length;
  }, 0);

  const getLicenseIssueDate = useCallback((): string | null => {
    const d = parseInt(licenseDay, 10);
    const m = parseInt(licenseMonth, 10);
    const y = parseInt(licenseYear, 10);
    if (!d || !m || !y || d < 1 || d > 31 || m < 1 || m > 12 || y < 1950 || y > new Date().getFullYear()) return null;
    return new Date(y, m - 1, d).toISOString();
  }, [licenseDay, licenseMonth, licenseYear]);

  const calcLicenseMonths = useCallback((): number => {
    const dateStr = getLicenseIssueDate();
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    const now = new Date();
    return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  }, [getLicenseIssueDate]);

  const licenseMonths = calcLicenseMonths();
  const isLicenseValid = licenseMonths >= 15;
  const hasLicenseInput = licenseDay.length > 0 && licenseMonth.length > 0 && licenseYear.length >= 4;

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Uyarı', 'İsim alanı zorunludur');
      return;
    }
    if (!phone.trim()) {
      Alert.alert('Uyarı', 'Telefon alanı zorunludur');
      return;
    }
    if (!email.trim()) {
      Alert.alert('Uyarı', 'E-posta alanı zorunludur');
      return;
    }
    if (!password.trim() || password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      Alert.alert('Uyarı', 'Şifre en az 8 karakter olmalı ve büyük harf, küçük harf, rakam içermelidir');
      return;
    }
    if (!getLicenseIssueDate()) {
      Alert.alert('Uyarı', 'Lütfen geçerli bir ehliyet alım tarihi girin');
      return;
    }
    if (!isLicenseValid) {
      Alert.alert('Uyarı', `Ehliyet en az 15 aydır alınmış olmalıdır. Mevcut süre: ${licenseMonths} ay`);
      return;
    }
    if (uploadedDocs < totalDocs) {
      Alert.alert('Uyarı', `Lütfen tüm belgeleri yükleyin (${uploadedDocs}/${totalDocs})`);
      return;
    }

    setLoading(true);
    try {
      const member = await registerTeamMember(name.trim(), phone.trim(), email.trim(), password.trim(), getLicenseIssueDate() ?? undefined);

      for (const section of DOC_SECTIONS) {
        for (const item of section.items) {
          const uri = documents[item.key];
          if (uri) {
            await updateTeamMemberDocument(member.id, item.key as any, uri);
          }
        }
      }

      Alert.alert(
        'Başarılı',
        'Ekip arkadaşınız ve belgeleri başarıyla kaydedildi.',
        [{ text: 'Tamam', onPress: () => router.push('/driver-menu' as any) }],
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Ekip arkadaşı oluşturulamadı';
      Alert.alert('Hata', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <KeyboardAvoidingView
          behavior={keyboardAvoidingBehavior()}
          style={styles.flex}
          keyboardVerticalOffset={keyboardVerticalOffset()}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.header}>
              <TouchableOpacity style={styles.backBtn} onPress={() => router.push('/driver-menu' as any)} testID="team-back-btn">
                <ArrowLeft size={20} color={Colors.light.text} />
              </TouchableOpacity>
              <Text style={styles.title}>Ekip Arkadaşı Ekle</Text>
            </View>

            <View style={styles.iconContainer}>
              <View style={styles.bigIcon}>
                <UserPlus size={36} color={Colors.light.primary} />
              </View>
              <Text style={styles.desc}>
                Ekip arkadaşınız için bir şoför hesabı oluşturun.{'\n'}Bilgilerini ve belgelerini eksiksiz doldurun.
              </Text>
            </View>

            <View style={styles.formSection}>
              <Text style={styles.sectionTitle}>Kişisel Bilgiler</Text>

              <Text style={styles.label}>İsim Soyisim</Text>
              <View style={styles.inputWrapper}>
                <User size={18} color={Colors.light.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Ekip arkadaşının adı"
                  placeholderTextColor={Colors.light.textMuted}
                  value={name}
                  onChangeText={setName}
                  testID="team-name-input"
                />
              </View>

              <Text style={styles.label}>Telefon</Text>
              <View style={styles.inputWrapper}>
                <Phone size={18} color={Colors.light.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="+90 5XX XXX XXXX"
                  placeholderTextColor={Colors.light.textMuted}
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={setPhone}
                  testID="team-phone-input"
                />
              </View>

              <Text style={styles.label}>E-posta</Text>
              <View style={styles.inputWrapper}>
                <Mail size={18} color={Colors.light.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="ornek@email.com"
                  placeholderTextColor={Colors.light.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                  testID="team-email-input"
                />
              </View>

              <Text style={styles.label}>Şifre</Text>
              <View style={styles.inputWrapper}>
                <Lock size={18} color={Colors.light.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="En az 6 karakter"
                  placeholderTextColor={Colors.light.textMuted}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  testID="team-password-input"
                />
              </View>
            </View>

            <View style={styles.formSection}>
              <Text style={styles.sectionTitle}>Ehliyet Bilgisi</Text>
              <Text style={styles.licenseNote}>Ehliyet en az 15 aydır alınmış olmalıdır</Text>
              <Text style={styles.label}>Ehliyet Alım Tarihi</Text>
              <View style={styles.dateRow}>
                <View style={[styles.inputWrapper, styles.dateInput]}>
                  <TextInput
                    style={styles.input}
                    placeholder="GG"
                    placeholderTextColor={Colors.light.textMuted}
                    keyboardType="number-pad"
                    maxLength={2}
                    value={licenseDay}
                    onChangeText={setLicenseDay}
                    testID="team-license-day"
                  />
                </View>
                <View style={[styles.inputWrapper, styles.dateInput]}>
                  <TextInput
                    style={styles.input}
                    placeholder="AA"
                    placeholderTextColor={Colors.light.textMuted}
                    keyboardType="number-pad"
                    maxLength={2}
                    value={licenseMonth}
                    onChangeText={setLicenseMonth}
                    testID="team-license-month"
                  />
                </View>
                <View style={[styles.inputWrapper, styles.dateInputYear]}>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY"
                    placeholderTextColor={Colors.light.textMuted}
                    keyboardType="number-pad"
                    maxLength={4}
                    value={licenseYear}
                    onChangeText={setLicenseYear}
                    testID="team-license-year"
                  />
                </View>
              </View>
              {hasLicenseInput && (
                <View style={[styles.licenseResult, { borderColor: isLicenseValid ? Colors.light.success + '40' : '#EF444440' }]}>
                  <View style={styles.licenseResultTop}>
                    {isLicenseValid ? (
                      <ShieldCheck size={18} color={Colors.light.success} />
                    ) : (
                      <AlertTriangle size={18} color="#EF4444" />
                    )}
                    <Text style={[styles.licenseResultText, { color: isLicenseValid ? Colors.light.success : '#EF4444' }]}>
                      {isLicenseValid ? 'Ehliyet süresi yeterli' : 'Ehliyet süresi yetersiz'}
                    </Text>
                  </View>
                  <Text style={styles.licenseResultSub}>
                    {licenseMonths} ay ({Math.floor(licenseMonths / 12)} yıl {licenseMonths % 12} ay) • Minimum: 15 ay
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.docDivider}>
              <View style={styles.docDividerLine} />
              <View style={styles.docDividerBadge}>
                <Camera size={14} color={Colors.light.primary} />
                <Text style={styles.docDividerText}>Belgeler</Text>
              </View>
              <View style={styles.docDividerLine} />
            </View>

            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                {uploadedDocs === totalDocs ? (
                  <CheckCircle2 size={18} color={Colors.light.success} />
                ) : (
                  <AlertCircle size={18} color={Colors.light.warning} />
                )}
                <Text style={styles.statusText}>
                  {uploadedDocs}/{totalDocs} belge yüklendi
                </Text>
              </View>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${(uploadedDocs / totalDocs) * 100}%` }]} />
              </View>
            </View>

            {DOC_SECTIONS.map((section) => {
              const sectionUploaded = section.items.filter(i => !!documents[i.key]).length;
              return (
                <View key={section.title} style={styles.docCard}>
                  <View style={styles.docCardHeader}>
                    <Text style={styles.docCardTitle}>{section.title}</Text>
                    <Text style={[
                      styles.docCardStatus,
                      sectionUploaded === section.items.length ? styles.docCardStatusComplete : styles.docCardStatusIncomplete,
                    ]}>
                      {sectionUploaded === section.items.length ? 'Tamamlandı' : `${sectionUploaded}/${section.items.length}`}
                    </Text>
                  </View>
                  <View style={styles.docCardRow}>
                    {section.items.map((item) => {
                      const uri = documents[item.key];
                      return (
                        <View key={item.key} style={styles.docCardItem}>
                          {uri ? (
                            <TouchableOpacity
                              style={styles.docImageWrap}
                              onPress={() => setViewImage(uri)}
                              activeOpacity={0.8}
                            >
                              <Image source={{ uri }} style={styles.docImg} resizeMode="cover" />
                              <View style={styles.docImgOverlay}>
                                <Text style={styles.docImgLabel}>{item.label}</Text>
                              </View>
                            </TouchableOpacity>
                          ) : (
                            <View style={styles.docEmptyWrap}>
                              <Camera size={22} color={Colors.light.textMuted} />
                              <Text style={styles.docEmptyText}>{item.label}</Text>
                              <Text style={styles.docEmptySubtext}>Yüklenmedi</Text>
                            </View>
                          )}
                          <TouchableOpacity
                            style={styles.docUpdateBtn}
                            onPress={() => pickImage(item.key)}
                            activeOpacity={0.7}
                          >
                            <Camera size={14} color={Colors.light.primary} />
                            <Text style={styles.docUpdateText}>{uri ? 'Değiştir' : 'Yükle'}</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                </View>
              );
            })}

            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              activeOpacity={0.85}
              testID="team-submit-btn"
            >
              {loading ? (
                <ActivityIndicator color={Colors.light.background} />
              ) : (
                <Text style={styles.submitText}>Hesap Oluştur</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal visible={!!viewImage} animationType="fade" transparent>
        <Pressable style={styles.viewOverlay} onPress={() => setViewImage('')}>
          <SafeAreaView style={styles.viewSafe}>
            <TouchableOpacity style={styles.viewCloseBtn} onPress={() => setViewImage('')}>
              <X size={24} color="#FFF" />
            </TouchableOpacity>
            {!!viewImage && (
              <Image source={{ uri: viewImage }} style={styles.viewImage} resizeMode="contain" />
            )}
          </SafeAreaView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 8,
    marginBottom: 28,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.light.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
  },
  title: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.light.text,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 28,
  },
  bigIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: 'rgba(245,166,35,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  desc: {
    fontSize: 14,
    color: Colors.light.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    paddingHorizontal: 20,
  },
  formSection: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    padding: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.light.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.textSecondary,
    marginBottom: 8,
    marginTop: 4,
  },
  licenseNote: {
    fontSize: 12,
    color: Colors.light.warning,
    marginBottom: 12,
    fontWeight: '500' as const,
  },
  dateRow: {
    flexDirection: 'row' as const,
    gap: 10,
    marginBottom: 12,
  },
  dateInput: {
    flex: 1,
    marginBottom: 0,
  },
  dateInputYear: {
    flex: 1.5,
    marginBottom: 0,
  },
  licenseResult: {
    backgroundColor: Colors.light.card,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  licenseResultTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  licenseResultText: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  licenseResultSub: {
    fontSize: 12,
    color: Colors.light.textMuted,
    marginLeft: 26,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.inputBorder,
    paddingHorizontal: 14,
    gap: 10,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    color: Colors.light.text,
  },
  docDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10,
  },
  docDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.light.divider,
  },
  docDividerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(245,166,35,0.10)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  docDividerText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.light.primary,
  },
  statusCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    padding: 16,
    marginBottom: 20,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  statusText: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text },
  progressBar: {
    height: 6,
    backgroundColor: Colors.light.divider,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.light.success,
    borderRadius: 3,
  },
  docCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    padding: 16,
    marginBottom: 16,
  },
  docCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  docCardTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.light.text },
  docCardStatus: {
    fontSize: 12,
    fontWeight: '600' as const,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
  docCardStatusComplete: {
    color: Colors.light.success,
    backgroundColor: 'rgba(46,204,113,0.12)',
  },
  docCardStatusIncomplete: {
    color: Colors.light.warning,
    backgroundColor: 'rgba(243,156,18,0.12)',
  },
  docCardRow: { flexDirection: 'row', gap: 12 },
  docCardItem: { flex: 1, gap: 8 },
  docImageWrap: {
    height: 110,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative' as const,
  },
  docImg: { width: '100%', height: '100%' },
  docImgOverlay: {
    position: 'absolute' as const,
    bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingVertical: 4,
    alignItems: 'center',
  },
  docImgLabel: { fontSize: 11, fontWeight: '600' as const, color: '#FFF' },
  docEmptyWrap: {
    height: 110,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.light.inputBorder,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.light.surface,
    gap: 4,
  },
  docEmptyText: { fontSize: 12, fontWeight: '500' as const, color: Colors.light.textMuted },
  docEmptySubtext: { fontSize: 10, color: Colors.light.textMuted },
  docUpdateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(245,166,35,0.1)',
  },
  docUpdateText: { fontSize: 12, fontWeight: '600' as const, color: Colors.light.primary },
  submitBtn: {
    backgroundColor: Colors.light.primary,
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: Colors.light.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    marginTop: 8,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.light.background,
  },
  viewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewSafe: { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center' },
  viewCloseBtn: {
    position: 'absolute' as const,
    top: 16, right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 10,
  },
  viewImage: { width: '90%', height: '70%' },
});
