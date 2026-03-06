import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, Shield, Eye, Database, Lock, UserCheck, Globe, Mail, Trash2, Bell,
} from 'lucide-react-native';

const SECTIONS = [
  {
    icon: Eye,
    iconColor: '#3498DB',
    iconBg: 'rgba(52,152,219,0.1)',
    title: 'Toplanan Veriler',
    items: [
      'Ad, soyad, e-posta adresi ve telefon numarası',
      'Konum bilgileri (yolculuk sırasında)',
      'Araç bilgileri (şoförler için)',
      'Ödeme bilgileri (güvenli şekilde işlenir)',
      'Uygulama kullanım verileri ve cihaz bilgileri',
    ],
  },
  {
    icon: Database,
    iconColor: '#9B59B6',
    iconBg: 'rgba(155,89,182,0.1)',
    title: 'Verilerin Kullanım Amacı',
    items: [
      'Yolculuk hizmetinin sağlanması ve iyileştirilmesi',
      'Güvenlik ve doğrulama işlemleri',
      'Müşteri desteği ve iletişim',
      'Yasal yükümlülüklerin yerine getirilmesi',
      'Kişiselleştirilmiş deneyim sunulması',
    ],
  },
  {
    icon: Lock,
    iconColor: '#2ECC71',
    iconBg: 'rgba(46,204,113,0.1)',
    title: 'Veri Güvenliği',
    items: [
      'SSL/TLS şifreleme ile veri iletimi',
      'Şifreler bcrypt ile hash\'lenerek saklanır',
      'Ödeme bilgileri PCI DSS standartlarında işlenir',
      'Düzenli güvenlik denetimleri yapılır',
      'Erişim yetkilendirme ve loglama sistemi',
    ],
  },
  {
    icon: UserCheck,
    iconColor: '#F5A623',
    iconBg: 'rgba(245,166,35,0.1)',
    title: 'Üçüncü Taraf Paylaşımı',
    items: [
      'Ödeme işlemleri için iyzico ile paylaşım',
      'Harita hizmetleri için Google Maps ile paylaşım',
      'Yasal zorunluluk halinde yetkili makamlarla paylaşım',
      'Verileriniz pazarlama amacıyla üçüncü taraflara satılmaz',
    ],
  },
  {
    icon: Bell,
    iconColor: '#E74C3C',
    iconBg: 'rgba(231,76,60,0.1)',
    title: 'Bildirimler ve İletişim',
    items: [
      'Yolculuk durum bildirimleri (push notification)',
      'Kampanya ve promosyon bildirimleri',
      'Güvenlik uyarıları ve hesap bildirimleri',
      'Bildirim tercihlerinizi istediğiniz zaman değiştirebilirsiniz',
    ],
  },
];

const RIGHTS = [
  { icon: Eye, text: 'Kişisel verilerinize erişim talep etme hakkı' },
  { icon: Trash2, text: 'Kişisel verilerinizin silinmesini talep etme hakkı' },
  { icon: Lock, text: 'Veri işlenmesine itiraz etme hakkı' },
  { icon: Globe, text: 'Veri taşınabilirliği talep etme hakkı' },
  { icon: Mail, text: 'Şikayet ve başvuru hakkı' },
];

export default function PrivacyPolicyScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7} testID="privacy-back">
            <ArrowLeft size={22} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Gizlilik Politikası</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.heroBanner}>
            <View style={styles.heroIconWrap}>
              <Shield size={28} color="#3498DB" />
            </View>
            <Text style={styles.heroTitle}>Gizliliğiniz Bizim İçin Önemli</Text>
            <Text style={styles.heroDesc}>
              2GO olarak kişisel verilerinizin korunmasına büyük önem veriyoruz. Bu politika, verilerinizin nasıl toplandığını, kullanıldığını ve korunduğunu açıklar.
            </Text>
            <View style={styles.dateBadge}>
              <Text style={styles.dateText}>Son güncelleme: 20 Şubat 2026</Text>
            </View>
          </View>

          {SECTIONS.map((section, i) => (
            <View key={i} style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: section.iconBg }]}>
                  <section.icon size={20} color={section.iconColor} />
                </View>
                <Text style={styles.sectionTitle}>{section.title}</Text>
              </View>
              {section.items.map((item, j) => (
                <View key={j} style={styles.bulletRow}>
                  <View style={[styles.bullet, { backgroundColor: section.iconColor }]} />
                  <Text style={styles.bulletText}>{item}</Text>
                </View>
              ))}
            </View>
          ))}

          <View style={styles.rightsSection}>
            <Text style={styles.rightsSectionTitle}>KVKK Kapsamındaki Haklarınız</Text>
            <Text style={styles.rightsDesc}>
              6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında aşağıdaki haklara sahipsiniz:
            </Text>
            {RIGHTS.map((right, i) => (
              <View key={i} style={styles.rightRow}>
                <View style={styles.rightIconWrap}>
                  <right.icon size={16} color="#3498DB" />
                </View>
                <Text style={styles.rightText}>{right.text}</Text>
              </View>
            ))}
          </View>

          <View style={styles.contactCard}>
            <Text style={styles.contactTitle}>Sorularınız İçin</Text>
            <Text style={styles.contactDesc}>
              Gizlilik politikamız veya kişisel verileriniz hakkında sorularınız için bizimle iletişime geçebilirsiniz.
            </Text>
            <View style={styles.contactInfo}>
              <Mail size={16} color="#F5A623" />
              <Text style={styles.contactEmail}>destek@2go.com.tr</Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
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
    backgroundColor: '#F2F2F4',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#1A1A1A',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  heroBanner: {
    backgroundColor: '#EBF5FB',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center' as const,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#3498DB20',
  },
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 16,
    shadowColor: '#3498DB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: '#1A1A1A',
    marginBottom: 8,
    textAlign: 'center' as const,
  },
  heroDesc: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center' as const,
    lineHeight: 21,
    marginBottom: 16,
  },
  dateBadge: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  dateText: {
    fontSize: 12,
    color: '#3498DB',
    fontWeight: '600' as const,
  },
  sectionCard: {
    backgroundColor: '#FAFAFA',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginBottom: 14,
  },
  sectionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#1A1A1A',
  },
  bulletRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    marginBottom: 8,
    paddingLeft: 4,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    color: '#555',
    lineHeight: 20,
  },
  rightsSection: {
    marginTop: 12,
    marginBottom: 24,
    backgroundColor: '#F8F4FF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#9B59B620',
  },
  rightsSectionTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#1A1A1A',
    marginBottom: 8,
  },
  rightsDesc: {
    fontSize: 13,
    color: '#666',
    lineHeight: 20,
    marginBottom: 16,
  },
  rightRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginBottom: 12,
  },
  rightIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  rightText: {
    flex: 1,
    fontSize: 14,
    color: '#444',
    lineHeight: 21,
  },
  contactCard: {
    backgroundColor: '#0A0A12',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center' as const,
  },
  contactTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  contactDesc: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: 16,
  },
  contactInfo: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: 'rgba(245,166,35,0.1)',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  contactEmail: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#F5A623',
  },
});
