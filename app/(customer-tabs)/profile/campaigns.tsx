import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Clock, Megaphone } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

export default function CampaignsScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
            <ArrowLeft size={22} color={Colors.light.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Kampanyalar</Text>
          <View style={styles.backButton} />
        </View>
        <View style={styles.comingSoonContainer}>
          <View style={styles.iconCircle}>
            <Megaphone size={40} color="#F5A623" />
          </View>
          <Text style={styles.comingSoonTitle}>Yakında!</Text>
          <Text style={styles.comingSoonDesc}>
            Kampanyalar ve indirim fırsatları çok yakında burada olacak. Takipte kalın!
          </Text>
          <View style={styles.badge}>
            <Clock size={14} color="#F5A623" />
            <Text style={styles.badgeText}>Hazırlanıyor...</Text>
          </View>
        </View>
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
  comingSoonContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    marginTop: -40,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#FFF8EC',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  comingSoonTitle: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: Colors.light.text,
    marginBottom: 12,
  },
  comingSoonDesc: {
    fontSize: 15,
    color: Colors.light.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8EC',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#F5A623',
  },
});

