import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MapPin, Clock, Star, Banknote, CarFront, ArrowLeft, RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { trpc } from '@/lib/trpc';

interface RideItem {
  id: string;
  pickupAddress: string;
  dropoffAddress: string;
  status: string;
  price: number;
  distance: string;
  duration: string;
  createdAt: string;
  driverName: string;
  driverRating: number;
  paymentMethod: string;
  isFreeRide: boolean;
}

export default function RidesScreen() {
  const { user, rideHistory } = useAuth();
  const router = useRouter();

  const customerRidesQuery = trpc.rides.getCustomerRides.useQuery(
    { customerId: user?.id ?? '', limit: 50 },
    { enabled: !!user?.id, refetchInterval: 60000, staleTime: 50000 }
  );

  const backendRides = customerRidesQuery.data?.rides ?? [];
  const rides = backendRides.length > 0 ? backendRides : rideHistory;
  const isLoading = customerRidesQuery.isLoading;

  const renderRide = ({ item }: { item: RideItem }) => {
    const date = new Date(item.createdAt);
    const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
    const dateStr = `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;

    return (
      <View style={styles.rideCard}>
        <View style={styles.rideHeader}>
          <View style={styles.rideDate}>
            <Clock size={14} color={Colors.light.textMuted} />
            <Text style={styles.rideDateText}>{dateStr} • {timeStr}</Text>
          </View>
          <Text style={styles.ridePrice}>{item.isFreeRide ? 'ÜCRETSİZ' : `₺${item.price}`}</Text>
        </View>
        <View style={styles.rideRoute}>
          <View style={styles.routeDots}>
            <View style={styles.dotGreen} />
            <View style={styles.routeLine} />
            <View style={styles.dotRed} />
          </View>
          <View style={styles.routeAddresses}>
            <Text style={styles.routeAddress}>{item.pickupAddress}</Text>
            <Text style={styles.routeAddress}>{item.dropoffAddress}</Text>
          </View>
        </View>
        <View style={styles.rideFooter}>
          <View style={styles.driverTag}>
            <Text style={styles.driverTagText}>{item.driverName}</Text>
            <Star size={12} color={Colors.light.primary} fill={Colors.light.primary} />
            <Text style={styles.driverRating}>{item.driverRating}</Text>
          </View>
          <View style={styles.rideStats}>
            <Banknote size={12} color={Colors.light.success} />
            <Text style={styles.rideStatCash}>{item.isFreeRide ? 'Ücretsiz' : 'Nakit'}</Text>
            <Text style={styles.rideStatDot}>•</Text>
            <Text style={styles.rideStatText}>{item.distance}</Text>
            <Text style={styles.rideStatDot}>•</Text>
            <Text style={styles.rideStatText}>{item.duration}</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconWrapper}>
        <CarFront size={48} color={Colors.light.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>Henüz yolculuk yok</Text>
      <Text style={styles.emptySubtitle}>İlk yolculuğunuzu yapın, burada görünsün!</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
              <ArrowLeft size={22} color={Colors.light.text} />
            </TouchableOpacity>
            <Text style={styles.title}>Yolculuklarım</Text>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => customerRidesQuery.refetch()}
              activeOpacity={0.7}
            >
              <RefreshCw size={18} color={Colors.light.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>
            {customerRidesQuery.data?.total ?? rides.length} yolculuk
          </Text>
        </View>
        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>Yolculuklar yükleniyor...</Text>
          </View>
        ) : (
          <FlatList
            data={rides as RideItem[]}
            keyExtractor={(item) => item.id}
            renderItem={renderRide}
            contentContainerStyle={[
              styles.listContent,
              rides.length === 0 && styles.listContentEmpty,
            ]}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={renderEmpty}
            refreshing={customerRidesQuery.isFetching}
            onRefresh={() => customerRidesQuery.refetch()}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  backButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.light.card, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 28, fontWeight: '800', color: Colors.light.text },
  subtitle: { fontSize: 14, color: Colors.light.textMuted, marginTop: 4 },
  listContent: { paddingHorizontal: 20, paddingBottom: 20 },
  listContentEmpty: { flex: 1, justifyContent: 'center' },
  separator: { height: 12 },
  rideCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
  },
  rideHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  rideDate: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rideDateText: { fontSize: 13, color: Colors.light.textMuted },
  ridePrice: { fontSize: 18, fontWeight: '700', color: Colors.light.primary },
  rideRoute: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  routeDots: { alignItems: 'center', paddingTop: 4, gap: 4 },
  dotGreen: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.light.success },
  routeLine: { width: 2, height: 20, backgroundColor: Colors.light.cardBorder },
  dotRed: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.light.accent },
  routeAddresses: { flex: 1, justifyContent: 'space-between' },
  routeAddress: { fontSize: 14, color: Colors.light.text },
  rideFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.light.divider,
    paddingTop: 12,
  },
  driverTag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  driverTagText: { fontSize: 13, color: Colors.light.textSecondary, fontWeight: '600' },
  driverRating: { fontSize: 13, color: Colors.light.primary, fontWeight: '600' },
  rideStats: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rideStatText: { fontSize: 13, color: Colors.light.textMuted },
  rideStatDot: { fontSize: 6, color: Colors.light.textMuted },
  rideStatCash: { fontSize: 13, color: Colors.light.success, fontWeight: '600' as const },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyIconWrapper: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.light.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: Colors.light.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.light.textMuted,
  },
});
