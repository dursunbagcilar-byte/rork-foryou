import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TrendingUp, TrendingDown, Car, Clock, MapPin, CheckCircle, XCircle, Navigation } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAppActive } from '@/hooks/useAppActive';
import { trpc } from '@/lib/trpc';
import { useFocusEffect } from 'expo-router';
import type { Driver } from '@/constants/mockData';

type Period = 'daily' | 'weekly' | 'monthly';

export default function EarningsScreen() {
  const { user } = useAuth();
  const driver = user as Driver | null;
  const [period, setPeriod] = useState<Period>('daily');
  const [isScreenFocused, setIsScreenFocused] = useState<boolean>(true);
  const { isAppActive } = useAppActive();
  const isRealtimeScreenActive = isScreenFocused && isAppActive;

  useFocusEffect(
    useCallback(() => {
      console.log('[DriverEarnings] Screen focused - polling resumed');
      setIsScreenFocused(true);
      return () => {
        console.log('[DriverEarnings] Screen blurred - polling paused');
        setIsScreenFocused(false);
      };
    }, [])
  );

  const earningsQuery = trpc.drivers.getEarningsHistory.useQuery(
    { driverId: driver?.id ?? '', days: 7 },
    { enabled: !!driver?.id && isRealtimeScreenActive, refetchInterval: isRealtimeScreenActive ? 120000 : false, staleTime: 110000 }
  );

  const earningsData = earningsQuery.data;
  const earningsHistory = earningsData?.history ?? [];

  const barAnims = useRef<Animated.Value[]>([]);
  if (barAnims.current.length !== earningsHistory.length) {
    barAnims.current = earningsHistory.map(() => new Animated.Value(0));
  }

  const driverRidesQuery = trpc.rides.getDriverRides.useQuery(
    { driverId: driver?.id ?? '' },
    { enabled: !!driver?.id && isRealtimeScreenActive, refetchInterval: isRealtimeScreenActive ? 120000 : false, staleTime: 110000 }
  );

  const ridesData = driverRidesQuery.data;
  const allRides = ridesData?.rides ?? [];
  const totalRidesCount = ridesData?.total ?? 0;
  const completedRides = allRides.filter((r: typeof allRides[number]) => r.status === 'completed');
  const cancelledRides = allRides.filter((r: typeof allRides[number]) => r.status === 'cancelled');

  useEffect(() => {
    barAnims.current.forEach(a => a.setValue(0));
    Animated.stagger(
      80,
      barAnims.current.map(anim =>
        Animated.spring(anim, { toValue: 1, useNativeDriver: true })
      )
    ).start();
  }, [period, earningsHistory.length]);

  const getEarning = (): number => {
    if (period === 'daily') return earningsData?.dailyEarnings ?? driver?.dailyEarnings ?? 0;
    if (period === 'weekly') return earningsData?.weeklyEarnings ?? driver?.weeklyEarnings ?? 0;
    return earningsData?.monthlyEarnings ?? driver?.monthlyEarnings ?? 0;
  };

  const weeklyGrowth = earningsData?.weeklyGrowth ?? 0;
  const avgHours = earningsData?.avgHoursPerDay ?? 0;
  const maxEarning = Math.max(...earningsHistory.map(e => e.amount), 1);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>Kazançlarım</Text>
          <View style={styles.periodTabs}>
            {([
              { key: 'daily' as Period, label: 'Günlük' },
              { key: 'weekly' as Period, label: 'Haftalık' },
              { key: 'monthly' as Period, label: 'Aylık' },
            ]).map(tab => (
              <TouchableOpacity
                key={tab.key}
                style={[styles.periodTab, period === tab.key && styles.periodTabActive]}
                onPress={() => setPeriod(tab.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.periodTabText, period === tab.key && styles.periodTabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.earningCard}>
            <Text style={styles.earningLabel}>
              {period === 'daily' ? 'Bugünkü' : period === 'weekly' ? 'Bu Haftaki' : 'Bu Ayki'} Kazanç
            </Text>
            <Text style={styles.earningAmount}>₺{getEarning().toLocaleString('tr-TR')}</Text>
            {weeklyGrowth !== 0 ? (
              <View style={[styles.earningTrend, weeklyGrowth < 0 && { backgroundColor: 'rgba(231,76,60,0.1)' }]}>
                {weeklyGrowth >= 0 ? (
                  <TrendingUp size={14} color={Colors.light.success} />
                ) : (
                  <TrendingDown size={14} color="#e74c3c" />
                )}
                <Text style={[styles.earningTrendText, weeklyGrowth < 0 && { color: '#e74c3c' }]}>
                  {weeklyGrowth > 0 ? '+' : ''}{weeklyGrowth}% geçen haftaya göre
                </Text>
              </View>
            ) : (
              <View style={styles.earningTrend}>
                <TrendingUp size={14} color={Colors.light.textMuted} />
                <Text style={[styles.earningTrendText, { color: Colors.light.textMuted }]}>Henüz karşılaştırma verisi yok</Text>
              </View>
            )}
          </View>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(245,166,35,0.1)' }]}>
                <Car size={18} color={Colors.light.primary} />
              </View>
              <Text style={styles.statValue}>{earningsData?.totalRides ?? driver?.totalRides ?? 0}</Text>
              <Text style={styles.statLabel}>Toplam Yolculuk</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: 'rgba(46,204,113,0.1)' }]}>
                <Clock size={18} color={Colors.light.success} />
              </View>
              <Text style={styles.statValue}>{avgHours}</Text>
              <Text style={styles.statLabel}>Ort. Saat/Gün</Text>
            </View>
          </View>
          <Text style={styles.chartTitle}>Son 7 Gün</Text>
          {earningsQuery.isLoading ? (
            <View style={[styles.chart, { justifyContent: 'center', alignItems: 'center' }]}>
              <ActivityIndicator size="small" color={Colors.light.primary} />
            </View>
          ) : earningsHistory.length === 0 ? (
            <View style={[styles.chart, { justifyContent: 'center', alignItems: 'center' }]}>
              <Text style={styles.emptyText}>Henüz kazanç verisi yok</Text>
            </View>
          ) : (
            <View style={styles.chart}>
              {earningsHistory.map((item, i) => {
                const barHeight = maxEarning > 0 ? (item.amount / maxEarning) * 120 : 0;
                return (
                  <View key={item.date} style={styles.chartBar}>
                    <Animated.View
                      style={[
                        styles.chartBarFill,
                        {
                          height: Math.max(barHeight, 4),
                          backgroundColor: item.amount === maxEarning && item.amount > 0
                            ? Colors.light.primary
                            : item.amount > 0 ? 'rgba(245,166,35,0.3)' : 'rgba(200,200,200,0.3)',
                          transform: [{ scaleY: barAnims.current[i] ?? new Animated.Value(1) }],
                        },
                      ]}
                    />
                    <Text style={styles.chartBarLabel}>{item.label}</Text>
                    <Text style={styles.chartBarValue}>₺{item.amount}</Text>
                  </View>
                );
              })}
            </View>
          )}

          <Text style={styles.sectionTitle}>Yolculuk Geçmişi ({totalRidesCount})</Text>
          <View style={styles.ridesSummaryRow}>
            <View style={[styles.rideSummaryChip, { backgroundColor: 'rgba(46,204,113,0.1)' }]}>
              <CheckCircle size={14} color={Colors.light.success} />
              <Text style={[styles.rideSummaryText, { color: Colors.light.success }]}>
                {completedRides.length} Tamamlanan
              </Text>
            </View>
            <View style={[styles.rideSummaryChip, { backgroundColor: 'rgba(231,76,60,0.1)' }]}>
              <XCircle size={14} color="#e74c3c" />
              <Text style={[styles.rideSummaryText, { color: '#e74c3c' }]}>
                {cancelledRides.length} İptal
              </Text>
            </View>
          </View>

          {driverRidesQuery.isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={Colors.light.primary} />
              <Text style={styles.loadingText}>Yolculuklar yükleniyor...</Text>
            </View>
          ) : allRides.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Navigation size={40} color={Colors.light.textMuted} />
              <Text style={styles.emptyText}>Henüz yolculuk yok</Text>
              <Text style={styles.emptySubtext}>Tamamladığınız yolculuklar burada görünecek</Text>
            </View>
          ) : (
            <View style={styles.ridesListContainer}>
              {allRides.map((ride, index) => {
                const isCompleted = ride.status === 'completed';
                const isCancelled = ride.status === 'cancelled';
                const isInProgress = ride.status === 'in_progress' || ride.status === 'accepted';
                const rideDate = new Date(ride.createdAt);
                const dateStr = rideDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
                const timeStr = rideDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

                return (
                  <View
                    key={ride.id}
                    style={[
                      styles.rideCard,
                      index === allRides.length - 1 && { marginBottom: 0 },
                    ]}
                  >
                    <View style={styles.rideCardHeader}>
                      <View style={styles.rideDateRow}>
                        <Text style={styles.rideDateText}>{dateStr}</Text>
                        <Text style={styles.rideTimeText}>{timeStr}</Text>
                      </View>
                      <View style={[
                        styles.rideStatusBadge,
                        isCompleted && styles.rideStatusCompleted,
                        isCancelled && styles.rideStatusCancelled,
                        isInProgress && styles.rideStatusInProgress,
                      ]}>
                        <Text style={[
                          styles.rideStatusText,
                          isCompleted && { color: Colors.light.success },
                          isCancelled && { color: '#e74c3c' },
                          isInProgress && { color: Colors.light.primary },
                        ]}>
                          {isCompleted ? 'Tamamlandı' : isCancelled ? 'İptal' : isInProgress ? 'Devam Ediyor' : 'Bekliyor'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.rideAddresses}>
                      <View style={styles.rideAddressRow}>
                        <View style={[styles.addressDot, { backgroundColor: Colors.light.success }]} />
                        <Text style={styles.rideAddressText} numberOfLines={1}>{ride.pickupAddress}</Text>
                      </View>
                      <View style={styles.addressLine} />
                      <View style={styles.rideAddressRow}>
                        <View style={[styles.addressDot, { backgroundColor: '#e74c3c' }]} />
                        <Text style={styles.rideAddressText} numberOfLines={1}>{ride.dropoffAddress}</Text>
                      </View>
                    </View>
                    <View style={styles.rideCardFooter}>
                      <View style={styles.rideDetailChip}>
                        <MapPin size={12} color={Colors.light.textMuted} />
                        <Text style={styles.rideDetailText}>{ride.distance}</Text>
                      </View>
                      <View style={styles.rideDetailChip}>
                        <Clock size={12} color={Colors.light.textMuted} />
                        <Text style={styles.rideDetailText}>{ride.duration}</Text>
                      </View>
                      <Text style={[
                        styles.ridePriceText,
                        ride.isFreeRide && styles.ridePriceFree,
                      ]}>
                        {ride.isFreeRide ? 'Ücretsiz' : `₺${ride.price.toLocaleString('tr-TR')}`}
                      </Text>
                    </View>
                    {ride.customerName ? (
                      <View style={styles.rideCustomerRow}>
                        <Text style={styles.rideCustomerLabel}>Müşteri:</Text>
                        <Text style={styles.rideCustomerName}>{ride.customerName}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          <View style={[styles.vehicleSection, { marginTop: 28 }]}>
            <Text style={styles.sectionTitle}>Araç Bilgileri</Text>
            <View style={styles.vehicleCard}>
              <View style={styles.vehicleRow}>
                <Text style={styles.vehicleLabel}>Model</Text>
                <Text style={styles.vehicleValue}>{driver?.vehicleModel ?? '-'}</Text>
              </View>
              <View style={styles.vehicleDivider} />
              <View style={styles.vehicleRow}>
                <Text style={styles.vehicleLabel}>Plaka</Text>
                <Text style={styles.vehicleValue}>{driver?.vehiclePlate ?? '-'}</Text>
              </View>
              <View style={styles.vehicleDivider} />
              <View style={styles.vehicleRow}>
                <Text style={styles.vehicleLabel}>Renk</Text>
                <Text style={styles.vehicleValue}>{driver?.vehicleColor ?? '-'}</Text>
              </View>
              <View style={styles.vehicleDivider} />
              <View style={styles.vehicleRow}>
                <Text style={styles.vehicleLabel}>Partner Şoför</Text>
                <Text style={[styles.vehicleValue, { color: Colors.light.primary }]}>
                  {driver?.partnerDriverName ?? 'Atanmadı'}
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  safeArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 30 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.light.text, marginTop: 8, marginBottom: 20 },
  periodTabs: {
    flexDirection: 'row',
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  periodTab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  periodTabActive: {
    backgroundColor: Colors.light.primary,
  },
  periodTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.textMuted,
  },
  periodTabTextActive: {
    color: Colors.light.background,
  },
  earningCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    marginBottom: 16,
    alignItems: 'center',
  },
  earningLabel: { fontSize: 14, color: Colors.light.textSecondary },
  earningAmount: {
    fontSize: 42,
    fontWeight: '800',
    color: Colors.light.primary,
    marginTop: 8,
    letterSpacing: -1,
  },
  earningTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: 'rgba(46,204,113,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  earningTrendText: { fontSize: 13, color: Colors.light.success, fontWeight: '600' },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    alignItems: 'center',
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  statValue: { fontSize: 22, fontWeight: '700', color: Colors.light.text },
  statLabel: { fontSize: 12, color: Colors.light.textMuted, marginTop: 4 },
  chartTitle: { fontSize: 16, fontWeight: '700', color: Colors.light.text, marginBottom: 16 },
  chart: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 16,
    paddingTop: 24,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    marginBottom: 28,
    height: 200,
  },
  chartBar: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  chartBarFill: {
    width: 24,
    borderRadius: 6,
    marginBottom: 8,
  },
  chartBarLabel: { fontSize: 10, color: Colors.light.textMuted },
  chartBarValue: { fontSize: 9, color: Colors.light.textSecondary, marginTop: 2 },
  ridesSummaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  rideSummaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  rideSummaryText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: Colors.light.textMuted,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    marginBottom: 28,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginTop: 4,
  },
  emptySubtext: {
    fontSize: 13,
    color: Colors.light.textMuted,
  },
  ridesListContainer: {
    marginBottom: 8,
  },
  rideCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    padding: 16,
    marginBottom: 12,
  },
  rideCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  rideDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rideDateText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  rideTimeText: {
    fontSize: 12,
    color: Colors.light.textMuted,
  },
  rideStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(150,150,150,0.1)',
  },
  rideStatusCompleted: {
    backgroundColor: 'rgba(46,204,113,0.1)',
  },
  rideStatusCancelled: {
    backgroundColor: 'rgba(231,76,60,0.1)',
  },
  rideStatusInProgress: {
    backgroundColor: 'rgba(245,166,35,0.1)',
  },
  rideStatusText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.light.textMuted,
  },
  rideAddresses: {
    marginBottom: 14,
    paddingLeft: 4,
  },
  rideAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  addressLine: {
    width: 1,
    height: 16,
    backgroundColor: Colors.light.divider,
    marginLeft: 3.5,
    marginVertical: 2,
  },
  rideAddressText: {
    fontSize: 13,
    color: Colors.light.textSecondary,
    flex: 1,
  },
  rideCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rideDetailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rideDetailText: {
    fontSize: 12,
    color: Colors.light.textMuted,
  },
  ridePriceText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.light.primary,
    marginLeft: 'auto',
  },
  ridePriceFree: {
    color: Colors.light.success,
  },
  rideCustomerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.light.divider,
  },
  rideCustomerLabel: {
    fontSize: 12,
    color: Colors.light.textMuted,
  },
  rideCustomerName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.text,
  },
  vehicleSection: { marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.light.text, marginBottom: 12 },
  vehicleCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    overflow: 'hidden',
  },
  vehicleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  vehicleLabel: { fontSize: 14, color: Colors.light.textMuted },
  vehicleValue: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  vehicleDivider: { height: 1, backgroundColor: Colors.light.divider, marginLeft: 16 },
});
