import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Moon, Bell, Navigation, CreditCard, Globe } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

const PREFERENCE_ITEMS = [
  { icon: Bell, label: 'Bildirimler', description: 'Yolculuk ve kampanya bildirimleri', hasSwitch: true },
  { icon: Navigation, label: 'Konum erişimi', description: 'Uygulama kullanılırken konum paylaş', hasSwitch: true },
  { icon: Moon, label: 'Karanlık mod', description: 'Yakında', hasSwitch: false },
  { icon: CreditCard, label: 'Varsayılan ödeme', description: 'Nakit', hasSwitch: false },
  { icon: Globe, label: 'Dil', description: 'Türkçe', hasSwitch: false },
];

export default function PreferencesScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
            <ArrowLeft size={22} color={Colors.light.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Tercihlerim</Text>
          <View style={styles.backButton} />
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.section}>
            {PREFERENCE_ITEMS.map((item, index) => (
              <View key={index} style={[styles.prefItem, index < PREFERENCE_ITEMS.length - 1 && styles.prefItemBorder]}>
                <View style={[styles.iconWrap, { backgroundColor: `${Colors.light.primary}15` }]}>
                  <item.icon size={18} color={Colors.light.primary} />
                </View>
                <View style={styles.prefContent}>
                  <Text style={styles.prefLabel}>{item.label}</Text>
                  <Text style={styles.prefDesc}>{item.description}</Text>
                </View>
                {item.hasSwitch && <Switch value={true} trackColor={{ false: '#E0E0E0', true: Colors.light.primary }} thumbColor="#FFF" />}
              </View>
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
  section: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    overflow: 'hidden',
  },
  prefItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  prefItemBorder: {
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
  prefContent: { flex: 1 },
  prefLabel: { fontSize: 15, fontWeight: '600' as const, color: Colors.light.text },
  prefDesc: { fontSize: 13, color: Colors.light.textMuted, marginTop: 2 },
});

