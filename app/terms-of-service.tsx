import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, FileText, Users, Car, CreditCard, AlertTriangle, Scale, Ban, RefreshCw, Mail,
} from 'lucide-react-native';

const SECTIONS = [
  {
    icon: Users,
    iconColor: '#3498DB',
    iconBg: 'rgba(52,152,219,0.1)',
    title: '1. Genel Koşullar',
    content: [
      '2GO uygulamasını kullanarak bu kullanım şartlarını kabul etmiş sayılırsınız.',
      'Hizmetlerimizi kullanmak için 18 yaşını doldurmuş olmanız gerekmektedir.',
      'Kayıt sırasında verdiğiniz bilgilerin doğru ve güncel olması zorunludur.',
      'Hesabınızın güvenliğinden siz sorumlusunuz. Şifrenizi kimseyle paylaşmayın.',
    ],
  },
  {
    icon: Car,
    iconColor: '#2ECC71',
    iconBg: 'rgba(46,204,113,0.1)',
    title: '2. Yolculuk Hizmetleri',
    content: [
      '2GO, yolcu ve şoför arasında aracılık hizmeti sunar.',
      'Yolculuk ücretleri mesafe, süre ve talep yoğunluğuna göre hesaplanır.',
      'Şoförler bağımsız hizmet sağlayıcılarıdır, 2GO çalışanı değildir.',
      'Yolculuk sırasında trafik kurallarına ve güvenlik politikalarına uyulması zorunludur.',
      'Yolculuk rotası ve tahmini süre bilgilendirme amaçlıdır, garanti edilmez.',
    ],
  },
  {
    icon: CreditCard,
    iconColor: '#9B59B6',
    iconBg: 'rgba(155,89,182,0.1)',
    title: '3. Ödeme Koşulları',
    content: [
      'Ödemeler iyzico altyapısı üzerinden güvenli şekilde işlenir.',
      'Yolculuk ücreti, yolculuk tamamlandığında otomatik olarak tahsil edilir.',
      'İptal ücretleri iptal politikamıza göre uygulanır.',
      'Promosyon kodları belirtilen koşullar dahilinde geçerlidir.',
      'Fatura ve ödeme geçmişinize uygulama üzerinden erişebilirsiniz.',
    ],
  },
  {
    icon: AlertTriangle,
    iconColor: '#F5A623',
    iconBg: 'rgba(245,166,35,0.1)',
    title: '4. Şoför Sorumlulukları',
    content: [
      'Geçerli ehliyet ve araç ruhsatına sahip olmak zorunludur.',
      'Araç sigortası ve muayene belgesi güncel olmalıdır.',
      'Yolculuk sırasında alkol veya uyuşturucu madde etkisinde olmak yasaktır.',
      'Yolcuların güvenliğini sağlamak şoförün sorumluluğundadır.',
      'Trafik kurallarına tam uyum zorunludur.',
    ],
  },
  {
    icon: Ban,
    iconColor: '#E74C3C',
    iconBg: 'rgba(231,76,60,0.1)',
    title: '5. Yasaklanan Davranışlar',
    content: [
      'Sahte veya yanıltıcı bilgi vermek',
      'Başka kullanıcıları taciz etmek veya tehdit etmek',
      'Uygulamayı kötüye kullanmak veya manipüle etmek',
      'Yasadışı faaliyetler için uygulamayı kullanmak',
      'Başka kullanıcıların kişisel bilgilerini izinsiz paylaşmak',
    ],
  },
  {
    icon: Scale,
    iconColor: '#1ABC9C',
    iconBg: 'rgba(26,188,156,0.1)',
    title: '6. Sorumluluk Sınırları',
    content: [
      '2GO, yolculuk sırasında oluşabilecek kaza veya hasarlardan doğrudan sorumlu değildir.',
      'Uygulama kesintileri veya teknik aksaklıklar için azami özen gösterilir.',
      'Üçüncü taraf hizmetlerindeki aksaklıklardan 2GO sorumlu tutulamaz.',
      'Mücbir sebepler nedeniyle hizmet kesintileri yaşanabilir.',
    ],
  },
  {
    icon: RefreshCw,
    iconColor: '#F39C12',
    iconBg: 'rgba(243,156,18,0.1)',
    title: '7. Hesap Askıya Alma ve Fesih',
    content: [
      'Kullanım şartlarını ihlal eden hesaplar askıya alınabilir veya kapatılabilir.',
      'Hesabınızı istediğiniz zaman kapatma hakkına sahipsiniz.',
      'Hesap kapatma sonrası verileriniz gizlilik politikamıza göre işlenir.',
      '2GO, hizmet şartlarını önceden bildirerek değiştirme hakkını saklı tutar.',
    ],
  },
];

export default function TermsOfServiceScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7} testID="terms-back">
            <ArrowLeft size={22} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Kullanım Şartları</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.heroBanner}>
            <View style={styles.heroIconWrap}>
              <FileText size={28} color="#F5A623" />
            </View>
            <Text style={styles.heroTitle}>Kullanım Şartları</Text>
            <Text style={styles.heroDesc}>
              2GO uygulamasını kullanmadan önce lütfen aşağıdaki kullanım şartlarını dikkatlice okuyunuz.
            </Text>
            <View style={styles.dateBadge}>
              <Text style={styles.dateText}>Yürürlük tarihi: 20 Şubat 2026</Text>
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
              {section.content.map((item, j) => (
                <View key={j} style={styles.bulletRow}>
                  <View style={[styles.bullet, { backgroundColor: section.iconColor }]} />
                  <Text style={styles.bulletText}>{item}</Text>
                </View>
              ))}
            </View>
          ))}

          <View style={styles.acceptanceCard}>
            <Text style={styles.acceptanceTitle}>Kabul ve Onay</Text>
            <Text style={styles.acceptanceText}>
              2GO uygulamasını indirip kullanarak yukarıdaki tüm şartları okuduğunuzu, anladığınızı ve kabul ettiğinizi beyan etmiş olursunuz. Bu şartlar Türkiye Cumhuriyeti kanunlarına tabidir.
            </Text>
          </View>

          <View style={styles.contactCard}>
            <Text style={styles.contactTitle}>İletişim</Text>
            <Text style={styles.contactDesc}>
              Kullanım şartları hakkında sorularınız için bizimle iletişime geçebilirsiniz.
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
    backgroundColor: '#FFF8E6',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center' as const,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#F5A62320',
  },
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 16,
    shadowColor: '#F5A623',
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
    color: '#F5A623',
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
    flex: 1,
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
  acceptanceCard: {
    backgroundColor: '#E8F8F5',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1ABC9C20',
  },
  acceptanceTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#1A1A1A',
    marginBottom: 8,
  },
  acceptanceText: {
    fontSize: 13,
    color: '#555',
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

