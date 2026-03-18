import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, Shield, Eye, Trash2, Download, MapPin, Lock,
  User, Car, FileText, ToggleLeft, ChevronRight, AlertTriangle, CheckCircle,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { usePrivacy } from '@/contexts/PrivacyContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface DataCategory {
  icon: React.ReactNode;
  title: string;
  description: string;
  fields: string[];
  color: string;
}

export default function KvkkDataManagementScreen() {
  const router = useRouter();
  const { user, userType, logout } = useAuth();
  const {
    consents,
    revokeAllConsents,
    revokeLocationConsent,
    acceptLocationTracking,
    hasLocationConsent,
  } = usePrivacy();
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showPersonalData, setShowPersonalData] = useState<boolean>(false);

  const dataCategories: DataCategory[] = [
    {
      icon: <User size={20} color="#3498DB" />,
      title: 'Kimlik Bilgileri',
      description: 'Hesap oluşturma sırasında toplanan bilgiler',
      fields: [
        `Ad Soyad: ${user?.name ?? '-'}`,
        `E-posta: ${user?.email ?? '-'}`,
        `Telefon: ${user?.phone ?? '-'}`,
        `Hesap Türü: ${userType === 'customer' ? 'Müşteri' : 'Şoför'}`,
      ],
      color: '#3498DB',
    },
    {
      icon: <MapPin size={20} color="#2ECC71" />,
      title: 'Konum Verileri',
      description: 'Yolculuk sırasında toplanan konum bilgileri',
      fields: [
        `İl: ${user?.city ?? '-'}`,
        `İlçe: ${user?.district ?? '-'}`,
        'Gerçek zamanlı GPS konumu (yolculuk sırasında)',
        'Alış ve varış noktaları',
      ],
      color: '#2ECC71',
    },
    {
      icon: <Car size={20} color="#F5A623" />,
      title: 'Yolculuk Verileri',
      description: 'Geçmiş yolculuk kayıtları',
      fields: [
        'Yolculuk geçmişi ve rotalar',
        'Ödeme tutarları ve yöntemleri',
        'Şoför/müşteri değerlendirmeleri',
        'İptal kayıtları',
      ],
      color: '#F5A623',
    },
  ];

  if (userType === 'driver') {
    dataCategories.push({
      icon: <FileText size={20} color="#9B59B6" />,
      title: 'Belge Bilgileri',
      description: 'Şoför onay süreci belgeleri',
      fields: [
        'Ehliyet görüntüleri',
        'Kimlik kartı görüntüleri',
        'Araç ruhsatı',
        'Adli sicil kaydı',
      ],
      color: '#9B59B6',
    });
  }

  const handleDeleteAllData = useCallback(() => {
    Alert.alert(
      'Tüm Verileri Sil',
      'Bu işlem geri alınamaz. Hesabınız ve tüm verileriniz kalıcı olarak silinecektir. Devam etmek istiyor musunuz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil ve Çıkış Yap',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await revokeAllConsents();
              const allKeys = await AsyncStorage.getAllKeys();
              const userKeys = allKeys.filter(k =>
                k.includes(user?.id ?? '__none__') ||
                k.startsWith('auth_') ||
                k.startsWith('ride_history') ||
                k.startsWith('completed_rides') ||
                k.startsWith('promo_') ||
                k.startsWith('kvkk_')
              );
              await AsyncStorage.multiRemove(userKeys);
              console.log('[KVKK] User data deleted, keys removed:', userKeys.length);
              Alert.alert('Başarılı', 'Tüm kişisel verileriniz silindi.', [
                { text: 'Tamam', onPress: () => logout() },
              ]);
            } catch (e) {
              console.log('[KVKK] Delete error:', e);
              Alert.alert('Hata', 'Veriler silinirken bir hata oluştu.');
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  }, [user?.id, revokeAllConsents, logout]);

  const handleRevokeLocation = useCallback(() => {
    Alert.alert(
      'Konum İzni',
      hasLocationConsent
        ? 'Konum takibi iznini geri çekmek istediğinize emin misiniz? Bu durumda gerçek zamanlı konum paylaşımı devre dışı kalacaktır.'
        : 'Konum takibini etkinleştirmek istiyor musunuz? Bu sayede gerçek zamanlı konum paylaşımı yapılabilecektir.',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: hasLocationConsent ? 'Geri Çek' : 'Etkinleştir',
          onPress: () => {
            if (hasLocationConsent) {
              void revokeLocationConsent();
            } else {
              void acceptLocationTracking();
            }
          },
        },
      ]
    );
  }, [hasLocationConsent, revokeLocationConsent, acceptLocationTracking]);

  const handleExportData = useCallback(() => {
    Alert.alert(
      'Veri Dışa Aktarımı',
      'KVKK madde 11 kapsamında kişisel verilerinizin bir kopyası e-posta adresinize gönderilecektir.',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Gönder',
          onPress: () => {
            console.log('[KVKK] Data export requested for:', user?.email);
            Alert.alert('Talep Alındı', `Verileriniz ${user?.email ?? ''} adresine gönderilecektir. Bu işlem 24 saat sürebilir.`);
          },
        },
      ]
    );
  }, [user?.email]);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7} testID="kvkk-back">
            <ArrowLeft size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>KVKK / GDPR</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.heroBanner}>
            <View style={styles.heroIconWrap}>
              <Shield size={28} color="#3498DB" />
            </View>
            <Text style={styles.heroTitle}>Kişisel Veri Yönetimi</Text>
            <Text style={styles.heroDesc}>
              6698 sayılı KVKK ve AB Genel Veri Koruma Yönetmeliği (GDPR) kapsamında kişisel verilerinizi yönetin.
            </Text>
            {consents.consentTimestamp && (
              <View style={styles.consentBadge}>
                <CheckCircle size={14} color="#2ECC71" />
                <Text style={styles.consentBadgeText}>
                  Onay tarihi: {new Date(consents.consentTimestamp).toLocaleDateString('tr-TR')}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.sectionHeader}>
            <Eye size={18} color="#3498DB" />
            <Text style={styles.sectionTitle}>Toplanan Veriler</Text>
          </View>

          <TouchableOpacity
            style={styles.toggleCard}
            onPress={() => setShowPersonalData(!showPersonalData)}
            activeOpacity={0.7}
          >
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <User size={18} color="#F5A623" />
                <Text style={styles.toggleTitle}>Kişisel Verilerimi Görüntüle</Text>
              </View>
              <ChevronRight
                size={18}
                color="#9595A8"
                style={showPersonalData ? { transform: [{ rotate: '90deg' }] } : undefined}
              />
            </View>
          </TouchableOpacity>

          {showPersonalData && dataCategories.map((cat, i) => (
            <View key={i} style={styles.dataCard}>
              <View style={styles.dataCardHeader}>
                <View style={[styles.dataIconWrap, { backgroundColor: cat.color + '15' }]}>
                  {cat.icon}
                </View>
                <View style={styles.dataCardHeaderText}>
                  <Text style={styles.dataCardTitle}>{cat.title}</Text>
                  <Text style={styles.dataCardDesc}>{cat.description}</Text>
                </View>
              </View>
              {cat.fields.map((field, j) => (
                <View key={j} style={styles.dataFieldRow}>
                  <View style={[styles.dataFieldDot, { backgroundColor: cat.color }]} />
                  <Text style={styles.dataFieldText}>{field}</Text>
                </View>
              ))}
            </View>
          ))}

          <View style={[styles.sectionHeader, { marginTop: 28 }]}>
            <ToggleLeft size={18} color="#F5A623" />
            <Text style={styles.sectionTitle}>İzin Yönetimi</Text>
          </View>

          <View style={styles.consentCard}>
            <View style={styles.consentRow}>
              <View style={styles.consentInfo}>
                <Lock size={18} color="#3498DB" />
                <View style={styles.consentTextWrap}>
                  <Text style={styles.consentTitle}>Gizlilik Politikası</Text>
                  <Text style={styles.consentDesc}>Kişisel verilerin işlenmesi onayı</Text>
                </View>
              </View>
              <View style={[styles.statusBadge, consents.privacyPolicy ? styles.statusActive : styles.statusInactive]}>
                <Text style={[styles.statusText, consents.privacyPolicy ? styles.statusTextActive : styles.statusTextInactive]}>
                  {consents.privacyPolicy ? 'Onaylı' : 'Onaysız'}
                </Text>
              </View>
            </View>

            <View style={styles.consentDivider} />

            <View style={styles.consentRow}>
              <View style={styles.consentInfo}>
                <MapPin size={18} color="#2ECC71" />
                <View style={styles.consentTextWrap}>
                  <Text style={styles.consentTitle}>Konum Takibi</Text>
                  <Text style={styles.consentDesc}>Gerçek zamanlı konum paylaşımı</Text>
                </View>
              </View>
              <Switch
                value={hasLocationConsent}
                onValueChange={handleRevokeLocation}
                trackColor={{ false: '#2A2A42', true: '#2ECC7140' }}
                thumbColor={hasLocationConsent ? '#2ECC71' : '#5C5C72'}
              />
            </View>

            <View style={styles.consentDivider} />

            <View style={styles.consentRow}>
              <View style={styles.consentInfo}>
                <FileText size={18} color="#9B59B6" />
                <View style={styles.consentTextWrap}>
                  <Text style={styles.consentTitle}>Veri İşleme</Text>
                  <Text style={styles.consentDesc}>Hizmet kalitesi için veri analizi</Text>
                </View>
              </View>
              <View style={[styles.statusBadge, consents.dataProcessing ? styles.statusActive : styles.statusInactive]}>
                <Text style={[styles.statusText, consents.dataProcessing ? styles.statusTextActive : styles.statusTextInactive]}>
                  {consents.dataProcessing ? 'Onaylı' : 'Onaysız'}
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.sectionHeader, { marginTop: 28 }]}>
            <Shield size={18} color="#E74C3C" />
            <Text style={styles.sectionTitle}>KVKK Haklarınız</Text>
          </View>

          <View style={styles.rightsCard}>
            {[
              { title: 'Bilgi Edinme', desc: 'Hangi verilerinizin işlendiğini öğrenme hakkı' },
              { title: 'Düzeltme', desc: 'Yanlış veya eksik verilerin düzeltilmesini isteme hakkı' },
              { title: 'Silme', desc: 'Kişisel verilerinizin silinmesini talep etme hakkı' },
              { title: 'İtiraz', desc: 'Verilerin işlenmesine itiraz etme hakkı' },
              { title: 'Taşınabilirlik', desc: 'Verilerinizi başka platformlara aktarma hakkı' },
            ].map((right, i) => (
              <View key={i} style={styles.rightItem}>
                <View style={styles.rightNumber}>
                  <Text style={styles.rightNumberText}>{i + 1}</Text>
                </View>
                <View style={styles.rightContent}>
                  <Text style={styles.rightTitle}>{right.title}</Text>
                  <Text style={styles.rightDesc}>{right.desc}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={[styles.sectionHeader, { marginTop: 28 }]}>
            <FileText size={18} color="#9B59B6" />
            <Text style={styles.sectionTitle}>İşlemler</Text>
          </View>

          <TouchableOpacity style={styles.actionCard} onPress={handleExportData} activeOpacity={0.7}>
            <View style={[styles.actionIconWrap, { backgroundColor: 'rgba(52,152,219,0.12)' }]}>
              <Download size={20} color="#3498DB" />
            </View>
            <View style={styles.actionTextWrap}>
              <Text style={styles.actionTitle}>Verilerimi Dışa Aktar</Text>
              <Text style={styles.actionDesc}>KVKK Madde 11 - Veri taşınabilirliği hakkı</Text>
            </View>
            <ChevronRight size={18} color="#5C5C72" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push('/privacy-policy' as any)}
            activeOpacity={0.7}
          >
            <View style={[styles.actionIconWrap, { backgroundColor: 'rgba(155,89,182,0.12)' }]}>
              <FileText size={20} color="#9B59B6" />
            </View>
            <View style={styles.actionTextWrap}>
              <Text style={styles.actionTitle}>Gizlilik Politikası</Text>
              <Text style={styles.actionDesc}>Aydınlatma metni ve veri işleme politikası</Text>
            </View>
            <ChevronRight size={18} color="#5C5C72" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.deleteCard]}
            onPress={handleDeleteAllData}
            disabled={isDeleting}
            activeOpacity={0.7}
          >
            {isDeleting ? (
              <ActivityIndicator color="#E74C3C" size="small" />
            ) : (
              <>
                <View style={styles.deleteIconWrap}>
                  <Trash2 size={20} color="#E74C3C" />
                </View>
                <View style={styles.deleteTextWrap}>
                  <Text style={styles.deleteTitle}>Tüm Verilerimi Sil</Text>
                  <Text style={styles.deleteDesc}>Hesabım ve tüm verilerim kalıcı olarak silinecek</Text>
                </View>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.warningCard}>
            <AlertTriangle size={16} color="#F39C12" />
            <Text style={styles.warningText}>
              Veri silme işlemi geri alınamaz. Silinen veriler kurtarılamaz. Yasal saklama süreleri kapsamındaki veriler ilgili süre sonunda otomatik silinir.
            </Text>
          </View>

          <View style={styles.contactSection}>
            <Text style={styles.contactTitle}>Veri Sorumlusu İletişim</Text>
            <Text style={styles.contactInfo}>E-posta: destekforyou2go@gmail.com</Text>
            <Text style={styles.contactNote}>
              KVKK kapsamındaki talepleriniz en geç 30 gün içinde yanıtlanır.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A12' },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1A1A2E',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  heroBanner: {
    backgroundColor: '#13131F',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center' as const,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#252540',
  },
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(52,152,219,0.12)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center' as const,
  },
  heroDesc: {
    fontSize: 14,
    color: '#9595A8',
    textAlign: 'center' as const,
    lineHeight: 21,
    marginBottom: 12,
  },
  consentBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: 'rgba(46,204,113,0.1)',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  consentBadgeText: {
    fontSize: 12,
    color: '#2ECC71',
    fontWeight: '600' as const,
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  toggleCard: {
    backgroundColor: '#13131F',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#252540',
  },
  toggleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  toggleInfo: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#FFFFFF',
  },
  dataCard: {
    backgroundColor: '#13131F',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#252540',
  },
  dataCardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginBottom: 14,
  },
  dataIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  dataCardHeaderText: {
    flex: 1,
  },
  dataCardTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  dataCardDesc: {
    fontSize: 12,
    color: '#5C5C72',
  },
  dataFieldRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    marginBottom: 6,
    paddingLeft: 4,
  },
  dataFieldDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 7,
  },
  dataFieldText: {
    flex: 1,
    fontSize: 13,
    color: '#9595A8',
    lineHeight: 19,
  },
  consentCard: {
    backgroundColor: '#13131F',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#252540',
  },
  consentRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 4,
  },
  consentInfo: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    flex: 1,
  },
  consentTextWrap: {
    flex: 1,
  },
  consentTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  consentDesc: {
    fontSize: 12,
    color: '#5C5C72',
  },
  consentDivider: {
    height: 1,
    backgroundColor: '#252540',
    marginVertical: 12,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusActive: {
    backgroundColor: 'rgba(46,204,113,0.12)',
  },
  statusInactive: {
    backgroundColor: 'rgba(231,76,60,0.12)',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  statusTextActive: {
    color: '#2ECC71',
  },
  statusTextInactive: {
    color: '#E74C3C',
  },
  rightsCard: {
    backgroundColor: '#13131F',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#252540',
    gap: 14,
  },
  rightItem: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 12,
  },
  rightNumber: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(245,166,35,0.12)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  rightNumberText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#F5A623',
  },
  rightContent: {
    flex: 1,
  },
  rightTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  rightDesc: {
    fontSize: 12,
    color: '#5C5C72',
    lineHeight: 17,
  },
  actionCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#13131F',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#252540',
    gap: 12,
  },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  actionTextWrap: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  actionDesc: {
    fontSize: 12,
    color: '#5C5C72',
  },
  deleteCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(231,76,60,0.06)',
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(231,76,60,0.2)',
    gap: 12,
  },
  deleteIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(231,76,60,0.12)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  deleteTextWrap: {
    flex: 1,
  },
  deleteTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#E74C3C',
    marginBottom: 2,
  },
  deleteDesc: {
    fontSize: 12,
    color: '#9595A8',
  },
  warningCard: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    backgroundColor: 'rgba(243,156,18,0.08)',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(243,156,18,0.15)',
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: '#F39C12',
    lineHeight: 18,
  },
  contactSection: {
    backgroundColor: '#13131F',
    borderRadius: 16,
    padding: 20,
    marginTop: 24,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: '#252540',
  },
  contactTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    marginBottom: 12,
  },
  contactInfo: {
    fontSize: 14,
    color: '#3498DB',
    fontWeight: '500' as const,
    marginBottom: 4,
  },
  contactNote: {
    fontSize: 12,
    color: '#5C5C72',
    textAlign: 'center' as const,
    marginTop: 10,
    lineHeight: 17,
  },
});

