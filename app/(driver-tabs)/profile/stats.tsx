import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, TrendingUp, Car, Clock, Star, Target,
  Percent, Calendar, Award, Zap, CheckCircle, XCircle,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { trpc } from '@/lib/trpc';
import type { Driver } from '@/constants/mockData';

type Period = 'today' | 'week' | 'month';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Bugün',
  week: 'Bu Hafta',
  month: 'Bu Ay',
};

function generateMockStats(driver: Driver | null, period: Period) {
  if (!driver) return null;

  const multiplier = period === 'today' ? 1 : period === 'week' ? 7 : 30;
  const baseRides = Math.max(1, Math.floor(driver.totalRides / 60));
  const rides = baseRides * multiplier + Math.floor(Math.random() * 3);
  const hours = period === 'today' ? 6.5 : period === 'week' ? 42 : 168;
  const km = rides * 8.5;
  const acceptRate = 92 + Math.floor(Math.random() * 7);
  const cancelRate = 100 - acceptRate - Math.floor(Math.random() * 3);
  const avgRating = driver.rating - (Math.random() * 0.2);
  const earnings = period === 'today' ? driver.dailyEarnings : period === 'week' ? driver.weeklyEarnings : driver.monthlyEarnings;

  return {
    rides,
    hours: parseFloat(hours.toFixed(1)),
    km: parseFloat(km.toFixed(1)),
    acceptRate,
    cancelRate: Math.max(0, cancelRate),
    avgRating: parseFloat(avgRating.toFixed(2)),
    earnings,
    completedRides: Math.floor(rides * 0.95),
    cancelledRides: Math.ceil(rides * 0.05),
    peakHour: '18:00 - 20:00',
    avgTripDuration: 18,
    avgTripDistance: 8.5,
  };
}

export default function DriverStatsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const driver = user as Driver | null;
  const [period, setPeriod] = useState<Period>('today');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const driverRidesQuery = trpc.rides.getDriverRides.useQuery(
    { driverId: driver?.id ?? '', limit: 50 },
    { enabled: !!driver?.id }
  );

  const stats = useMemo(() => generateMockStats(driver, period), [driver, period]);

  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [period]);

  if (!stats) return null;

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Performans</Text>
          <View style={styles.backBtn} />
        </View>

        <View style={styles.periodTabs}>
          {(['today', 'week', 'month'] as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.periodTab, period === p && styles.periodTabActive]}
              onPress={() => setPeriod(p)}
              activeOpacity={0.7}
            >
              <Text style={[styles.periodTabText, period === p && styles.periodTabTextActive]}>
                {PERIOD_LABELS[p]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <Animated.View style={{ opacity: fadeAnim }}>
            <View style={styles.earningsHero}>
              <Text style={styles.earningsLabel}>{PERIOD_LABELS[period]} Kazanç</Text>
              <Text style={styles.earningsAmount}>₺{stats.earnings.toLocaleString('tr-TR')}</Text>
              <View style={styles.earningsTrend}>
                <TrendingUp size={14} color="#2ECC71" />
                <Text style={styles.earningsTrendText}>+12% önceki döneme göre</Text>
              </View>
            </View>

            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: 'rgba(245,166,35,0.1)' }]}>
                  <Car size={18} color="#F5A623" />
                </View>
                <Text style={styles.statValue}>{stats.rides}</Text>
                <Text style={styles.statLabel}>Yolculuk</Text>
              </View>
              <View style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: 'rgba(46,204,113,0.1)' }]}>
                  <Clock size={18} color="#2ECC71" />
                </View>
                <Text style={styles.statValue}>{stats.hours}</Text>
                <Text style={styles.statLabel}>Saat</Text>
              </View>
              <View style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: 'rgba(52,152,219,0.1)' }]}>
                  <Target size={18} color="#3498DB" />
                </View>
                <Text style={styles.statValue}>{stats.km}</Text>
                <Text style={styles.statLabel}>Km</Text>
              </View>
              <View style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: 'rgba(155,89,182,0.1)' }]}>
                  <Star size={18} color="#9B59B6" />
                </View>
                <Text style={styles.statValue}>{stats.avgRating}</Text>
                <Text style={styles.statLabel}>Puan</Text>
              </View>
            </View>

            <View style={styles.ratesSection}>
              <Text style={styles.sectionTitle}>Kabul / İptal Oranı</Text>
              <View style={styles.rateBarContainer}>
                <View style={styles.rateBarBg}>
                  <View style={[styles.rateBarFill, { width: `${stats.acceptRate}%` as unknown as number, backgroundColor: '#2ECC71' }]} />
                </View>
                <View style={styles.rateLabels}>
                  <View style={styles.rateLabelRow}>
                    <CheckCircle size={14} color="#2ECC71" />
                    <Text style={styles.rateLabelText}>Kabul: %{stats.acceptRate}</Text>
                  </View>
                  <View style={styles.rateLabelRow}>
                    <XCircle size={14} color="#E74C3C" />
                    <Text style={styles.rateLabelText}>İptal: %{stats.cancelRate}</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.detailsSection}>
              <Text style={styles.sectionTitle}>Detaylar</Text>
              <View style={styles.detailCard}>
                <View style={styles.detailRow}>
                  <View style={styles.detailLeft}>
                    <Calendar size={16} color="#F5A623" />
                    <Text style={styles.detailLabel}>Yoğun Saat</Text>
                  </View>
                  <Text style={styles.detailValue}>{stats.peakHour}</Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <View style={styles.detailLeft}>
                    <Clock size={16} color="#3498DB" />
                    <Text style={styles.detailLabel}>Ort. Yolculuk Süresi</Text>
                  </View>
                  <Text style={styles.detailValue}>{stats.avgTripDuration} dk</Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <View style={styles.detailLeft}>
                    <Zap size={16} color="#9B59B6" />
                    <Text style={styles.detailLabel}>Ort. Mesafe</Text>
                  </View>
                  <Text style={styles.detailValue}>{stats.avgTripDistance} km</Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <View style={styles.detailLeft}>
                    <CheckCircle size={16} color="#2ECC71" />
                    <Text style={styles.detailLabel}>Tamamlanan</Text>
                  </View>
                  <Text style={[styles.detailValue, { color: '#2ECC71' }]}>{stats.completedRides}</Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <View style={styles.detailLeft}>
                    <XCircle size={16} color="#E74C3C" />
                    <Text style={styles.detailLabel}>İptal Edilen</Text>
                  </View>
                  <Text style={[styles.detailValue, { color: '#E74C3C' }]}>{stats.cancelledRides}</Text>
                </View>
              </View>
            </View>

            <View style={styles.tipCard}>
              <Award size={22} color="#F5A623" />
              <View style={styles.tipContent}>
                <Text style={styles.tipTitle}>Performans İpucu</Text>
                <Text style={styles.tipDesc}>
                  Kabul oranınızı %95 üzerinde tutarak daha fazla yolculuk talebi alabilirsiniz.
                </Text>
              </View>
            </View>
          </Animated.View>
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
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#F2F2F4',
    justifyContent: 'center' as const, alignItems: 'center' as const,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: '#1A1A1A' },
  periodTabs: {
    flexDirection: 'row' as const, paddingHorizontal: 20, gap: 8, marginBottom: 8,
  },
  periodTab: {
    flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: '#F2F2F4',
    alignItems: 'center' as const,
  },
  periodTabActive: { backgroundColor: '#1A1A2E' },
  periodTabText: { fontSize: 14, fontWeight: '600' as const, color: '#666' },
  periodTabTextActive: { color: '#FFFFFF' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  earningsHero: {
    backgroundColor: '#0A0A12', borderRadius: 20, padding: 24,
    alignItems: 'center' as const, marginBottom: 20, marginTop: 12,
  },
  earningsLabel: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 6 },
  earningsAmount: { fontSize: 36, fontWeight: '800' as const, color: '#F5A623', letterSpacing: -1 },
  earningsTrend: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginTop: 10 },
  earningsTrendText: { fontSize: 13, color: '#2ECC71', fontWeight: '600' as const },
  statsGrid: {
    flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10, marginBottom: 20,
  },
  statCard: {
    flex: 1, minWidth: '45%' as unknown as number, backgroundColor: '#FAFAFA', borderRadius: 16,
    padding: 16, alignItems: 'center' as const, borderWidth: 1, borderColor: '#F0F0F0',
  },
  statIconWrap: {
    width: 40, height: 40, borderRadius: 12, justifyContent: 'center' as const,
    alignItems: 'center' as const, marginBottom: 10,
  },
  statValue: { fontSize: 22, fontWeight: '800' as const, color: '#1A1A1A', marginBottom: 2 },
  statLabel: { fontSize: 12, color: '#888' },
  ratesSection: { marginBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '700' as const, color: '#1A1A1A', marginBottom: 14 },
  rateBarContainer: { backgroundColor: '#FAFAFA', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#F0F0F0' },
  rateBarBg: { height: 10, borderRadius: 5, backgroundColor: '#F0F0F0', marginBottom: 14, overflow: 'hidden' as const },
  rateBarFill: { height: 10, borderRadius: 5 },
  rateLabels: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
  rateLabelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  rateLabelText: { fontSize: 13, fontWeight: '600' as const, color: '#444' },
  detailsSection: { marginBottom: 20 },
  detailCard: { backgroundColor: '#FAFAFA', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#F0F0F0' },
  detailRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingVertical: 10 },
  detailLeft: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  detailLabel: { fontSize: 14, color: '#444' },
  detailValue: { fontSize: 15, fontWeight: '700' as const, color: '#1A1A1A' },
  detailDivider: { height: 1, backgroundColor: '#F0F0F0' },
  tipCard: {
    flexDirection: 'row' as const, backgroundColor: '#FFF8E6', borderRadius: 16,
    padding: 16, gap: 14, alignItems: 'center' as const, borderWidth: 1, borderColor: '#F5A62320',
    marginBottom: 20,
  },
  tipContent: { flex: 1 },
  tipTitle: { fontSize: 14, fontWeight: '700' as const, color: '#1A1A1A', marginBottom: 4 },
  tipDesc: { fontSize: 13, color: '#666', lineHeight: 19 },
});
