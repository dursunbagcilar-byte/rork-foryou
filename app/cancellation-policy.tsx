import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, Clock, AlertTriangle, Banknote, Shield, Info, CheckCircle,
} from 'lucide-react-native';

const POLICY_SECTIONS = [
  {
    icon: Clock,
    iconColor: '#F5A623',
    iconBg: 'rgba(245,166,35,0.1)',
    title: 'Ücretsiz İptal Süresi',
    desc: 'Sürücü atamasından sonra ilk 2 dakika içinde iptal etmeniz halinde herhangi bir ücret alınmaz.',
  },
  {
    icon: Banknote,
    iconColor: '#E74C3C',
    iconBg: 'rgba(231,76,60,0.1)',
    title: 'İptal Ücreti',
    desc: '2 dakikadan sonra yapılan iptallerde minimum ₺15 iptal ücreti uygulanır. Sürücü konumunuza yakınsa bu ücret artabilir.',
  },
  {
    icon: AlertTriangle,
    iconColor: '#F39C12',
    iconBg: 'rgba(243,156,18,0.1)',
    title: 'Sık İptal Uyarısı',
    desc: 'Son 7 gün içinde 3\'ten fazla iptal yapmanız durumunda geçici olarak yüksek iptal ücreti uygulanabilir.',
  },
  {
    icon: Shield,
    iconColor: '#2ECC71',
    iconBg: 'rgba(46,204,113,0.1)',
    title: 'Sürücü İptali',
    desc: 'Sürücü tarafından iptal edilen yolculuklarda size herhangi bir ücret yansıtılmaz. Otomatik olarak yeni sürücü aranır.',
  },
  {
    icon: Info,
    iconColor: '#3498DB',
    iconBg: 'rgba(52,152,219,0.1)',
    title: 'Zamanlanmış Yolculuk İptali',
    desc: 'Zamanlanmış yolculukları, planlanan saatten en az 30 dakika önce ücretsiz iptal edebilirsiniz.',
  },
];

const RIGHTS = [
  'Yolculuk sırasında güvensiz hissederseniz ücretsiz iptal hakkınız vardır.',
  'Sürücü 10 dakikadan fazla gecikirse ücretsiz iptal yapabilirsiniz.',
  'İptal ücretine itiraz etmek için destek ekibimize başvurabilirsiniz.',
  'Promosyonlu yolculuklarda iptal ücreti promosyon tutarından düşülmez.',
];

export default function CancellationPolicyScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>İptal Politikası</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.heroBanner}>
            <View style={styles.heroIconWrap}>
              <AlertTriangle size={28} color="#F5A623" />
            </View>
            <Text style={styles.heroTitle}>İptal Koşulları</Text>
            <Text style={styles.heroDesc}>
              Yolculuk iptallerine ilişkin kurallar ve ücretlendirme politikamız hakkında bilgi edinin.
            </Text>
          </View>

          {POLICY_SECTIONS.map((section, i) => (
            <View key={i} style={styles.policyCard}>
              <View style={[styles.policyIcon, { backgroundColor: section.iconBg }]}>
                <section.icon size={20} color={section.iconColor} />
              </View>
              <View style={styles.policyContent}>
                <Text style={styles.policyTitle}>{section.title}</Text>
                <Text style={styles.policyDesc}>{section.desc}</Text>
              </View>
            </View>
          ))}

          <View style={styles.rightsSection}>
            <Text style={styles.rightsSectionTitle}>Haklarınız</Text>
            {RIGHTS.map((right, i) => (
              <View key={i} style={styles.rightRow}>
                <CheckCircle size={16} color="#2ECC71" />
                <Text style={styles.rightText}>{right}</Text>
              </View>
            ))}
          </View>

          <View style={styles.contactCard}>
            <Text style={styles.contactTitle}>Sorunuz mu var?</Text>
            <Text style={styles.contactDesc}>
              İptal ücreti veya politikamız hakkında sorularınız için destek ekibimize ulaşabilirsiniz.
            </Text>
            <TouchableOpacity style={styles.contactBtn} activeOpacity={0.8}>
              <Text style={styles.contactBtnText}>Destek Ekibine Ulaş</Text>
            </TouchableOpacity>
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
  },
  policyCard: {
    flexDirection: 'row' as const,
    backgroundColor: '#FAFAFA',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    gap: 14,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  policyIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  policyContent: {
    flex: 1,
  },
  policyTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#1A1A1A',
    marginBottom: 4,
  },
  policyDesc: {
    fontSize: 13,
    color: '#666',
    lineHeight: 20,
  },
  rightsSection: {
    marginTop: 12,
    marginBottom: 24,
  },
  rightsSectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#1A1A1A',
    marginBottom: 16,
  },
  rightRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    marginBottom: 12,
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
    marginBottom: 20,
  },
  contactBtn: {
    backgroundColor: '#F5A623',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
  },
  contactBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#0A0A12',
  },
});

