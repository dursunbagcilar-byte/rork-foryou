import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, MessageCircle, Phone, Mail, FileText, ChevronRight, HelpCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';


const HELP_ITEMS = [
  { icon: MessageCircle, label: 'Sık Sorulan Sorular', description: 'En çok sorulan sorular ve cevapları' },
  { icon: Phone, label: 'Bizi Arayın', description: '0551 630 06 24' },
  { icon: Mail, label: 'E-posta Gönder', description: 'destekforyou2go@gmail.com' },
  { icon: FileText, label: 'Kullanım Koşulları', description: 'Hizmet şartları ve gizlilik politikası' },
  { icon: HelpCircle, label: 'Sorun Bildir', description: 'Yaşadığınız sorunu bize iletin' },
];

export default function HelpScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
            <ArrowLeft size={22} color={Colors.light.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Yardım</Text>
          <View style={styles.backButton} />
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>Size nasıl yardımcı olabiliriz?</Text>
            <Text style={styles.bannerDesc}>Aşağıdaki seçeneklerden birini kullanarak bize ulaşabilirsiniz.</Text>
          </View>
          <View style={styles.section}>
            {HELP_ITEMS.map((item, index) => (
              <TouchableOpacity
                key={index}
                style={[styles.helpItem, index < HELP_ITEMS.length - 1 && styles.helpItemBorder]}
                activeOpacity={0.6}
              >
                <View style={[styles.iconWrap, { backgroundColor: `${Colors.light.primary}15` }]}>
                  <item.icon size={18} color={Colors.light.primary} />
                </View>
                <View style={styles.helpContent}>
                  <Text style={styles.helpLabel}>{item.label}</Text>
                  <Text style={styles.helpDesc}>{item.description}</Text>
                </View>
                <ChevronRight size={18} color={Colors.light.textMuted} />
              </TouchableOpacity>
            ))}
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  safeArea: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.light.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 28, fontWeight: '800' as const, color: Colors.light.text },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 30 },
  banner: {
    backgroundColor: '#1A1A3E',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  bannerTitle: { fontSize: 18, fontWeight: '700' as const, color: '#FFF', marginBottom: 6 },
  bannerDesc: { fontSize: 14, color: '#9999BB', lineHeight: 20 },
  section: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    overflow: 'hidden',
  },
  helpItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  helpItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.divider,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  helpContent: { flex: 1 },
  helpLabel: { fontSize: 15, fontWeight: '600' as const, color: Colors.light.text },
  helpDesc: { fontSize: 13, color: Colors.light.textMuted, marginTop: 2 },

});
