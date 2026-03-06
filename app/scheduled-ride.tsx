import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Animated, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, Calendar, Clock, MapPin, Car, CheckCircle, ChevronRight, Bell, X,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/contexts/AuthContext';
import { trpc } from '@/lib/trpc';

interface ScheduledRide {
  id: string;
  date: string;
  time: string;
  pickup: string;
  dropoff: string;
  vehicleType: string;
  status: 'scheduled' | 'cancelled';
}

const TIME_SLOTS = [
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30',
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30',
  '21:00', '21:30', '22:00', '22:30', '23:00', '23:30',
];

function getNextDays(count: number): { label: string; date: string; dayName: string }[] {
  const days: { label: string; date: string; dayName: string }[] = [];
  const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    days.push({
      label: i === 0 ? 'Bugün' : i === 1 ? 'Yarın' : `${d.getDate()} ${months[d.getMonth()]}`,
      date: d.toISOString().split('T')[0],
      dayName: dayNames[d.getDay()],
    });
  }
  return days;
}

export default function ScheduledRideScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const days = getNextDays(7);
  const [selectedDay, setSelectedDay] = useState<string>(days[1]?.date ?? '');
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [scheduledRides, setScheduledRides] = useState<ScheduledRide[]>([]);
  const [step, setStep] = useState<'select' | 'confirm' | 'list'>('select');

  const createMutation = trpc.scheduledRides.create.useMutation();
  const cancelMutation = trpc.scheduledRides.cancel.useMutation();
  const scheduledRidesQuery = trpc.scheduledRides.getByUser.useQuery(
    { userId: user?.id ?? '' },
    { enabled: !!user?.id }
  );

  useEffect(() => {
    if (scheduledRidesQuery.data && Array.isArray(scheduledRidesQuery.data)) {
      const mapped: ScheduledRide[] = scheduledRidesQuery.data.map((r: any) => ({
        id: r.id,
        date: r.date,
        time: r.time,
        pickup: r.pickup,
        dropoff: r.dropoff,
        vehicleType: r.vehicleType,
        status: r.status as 'scheduled' | 'cancelled',
      }));
      setScheduledRides(mapped);
      console.log('[ScheduledRide] Loaded from backend:', mapped.length);
    }
  }, [scheduledRidesQuery.data]);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, []);

  const pickup = user?.city
    ? `${user.city}${user.district ? ' / ' + user.district : ''}`
    : 'Mevcut Konum';

  const handleSchedule = useCallback(async () => {
    if (!selectedDay || !selectedTime) {
      Alert.alert('Eksik Bilgi', 'Lütfen tarih ve saat seçin.');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    try {
      const result = await createMutation.mutateAsync({
        userId: user?.id ?? '',
        date: selectedDay,
        time: selectedTime,
        pickup,
        dropoff: 'Hedef belirlenecek',
        vehicleType: 'Otomobil',
      });

      if (result.success && result.ride) {
        const newRide: ScheduledRide = {
          id: result.ride.id,
          date: result.ride.date,
          time: result.ride.time,
          pickup: result.ride.pickup,
          dropoff: result.ride.dropoff,
          vehicleType: result.ride.vehicleType,
          status: 'scheduled',
        };
        setScheduledRides((prev) => [newRide, ...prev]);
        setStep('list');
        Alert.alert(
          'Yolculuk Planlandı',
          `${days.find((d) => d.date === selectedDay)?.label ?? selectedDay} saat ${selectedTime} için yolculuğunuz planlandı. Zamanı geldiğinde bildirim alacaksınız.`,
        );
      } else {
        Alert.alert('Hata', 'Yolculuk planlanamadı. Lütfen tekrar deneyin.');
      }
    } catch (e) {
      console.log('[ScheduledRide] Create error:', e);
      Alert.alert('Hata', 'Yolculuk planlanamadı. Lütfen tekrar deneyin.');
    }
  }, [selectedDay, selectedTime, pickup, days, createMutation, user?.id]);

  const handleCancel = useCallback((id: string) => {
    Alert.alert('İptal Et', 'Bu zamanlanmış yolculuğu iptal etmek istiyor musunuz?', [
      { text: 'Hayır', style: 'cancel' },
      {
        text: 'İptal Et',
        style: 'destructive',
        onPress: async () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          try {
            await cancelMutation.mutateAsync({ id, userId: user?.id ?? '' });
            setScheduledRides((prev) =>
              prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' as const } : r))
            );
          } catch (e) {
            console.log('[ScheduledRide] Cancel error:', e);
            setScheduledRides((prev) =>
              prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' as const } : r))
            );
          }
        },
      },
    ]);
  }, [cancelMutation, user?.id]);

  const currentHour = new Date().getHours();
  const isToday = selectedDay === days[0]?.date;
  const filteredTimes = isToday
    ? TIME_SLOTS.filter((t) => parseInt(t.split(':')[0], 10) > currentHour)
    : TIME_SLOTS;

  const activeRides = scheduledRides.filter((r) => r.status === 'scheduled');

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Zamanlanmış Yolculuk</Text>
          {activeRides.length > 0 ? (
            <TouchableOpacity
              style={styles.listToggle}
              onPress={() => setStep(step === 'list' ? 'select' : 'list')}
              activeOpacity={0.7}
            >
              <Text style={styles.listToggleText}>{step === 'list' ? 'Yeni' : `${activeRides.length}`}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.backBtn} />
          )}
        </View>

        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          {step === 'list' && scheduledRides.length > 0 ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              <Text style={styles.sectionTitle}>Planlanan Yolculuklar</Text>
              {scheduledRides.map((ride) => {
                const dayInfo = days.find((d) => d.date === ride.date);
                return (
                  <View
                    key={ride.id}
                    style={[styles.rideCard, ride.status === 'cancelled' && styles.rideCardCancelled]}
                  >
                    <View style={styles.rideCardTop}>
                      <View style={styles.rideCardDate}>
                        <Calendar size={16} color={ride.status === 'cancelled' ? '#AAA' : '#F5A623'} />
                        <Text style={[styles.rideCardDateText, ride.status === 'cancelled' && { color: '#AAA' }]}>
                          {dayInfo?.label ?? ride.date}
                        </Text>
                        <Clock size={14} color={ride.status === 'cancelled' ? '#AAA' : '#3498DB'} />
                        <Text style={[styles.rideCardTimeText, ride.status === 'cancelled' && { color: '#AAA' }]}>
                          {ride.time}
                        </Text>
                      </View>
                      {ride.status === 'scheduled' && (
                        <TouchableOpacity onPress={() => handleCancel(ride.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                          <X size={18} color="#E74C3C" />
                        </TouchableOpacity>
                      )}
                      {ride.status === 'cancelled' && (
                        <View style={styles.cancelledBadge}>
                          <Text style={styles.cancelledBadgeText}>İptal</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.rideCardRoute}>
                      <View style={styles.routeDots}>
                        <View style={[styles.dot, { backgroundColor: '#2ECC71' }]} />
                        <View style={styles.routeLine} />
                        <View style={[styles.dot, { backgroundColor: '#E74C3C' }]} />
                      </View>
                      <View style={styles.routeTexts}>
                        <Text style={styles.routeText}>{ride.pickup}</Text>
                        <Text style={styles.routeText}>{ride.dropoff}</Text>
                      </View>
                    </View>
                    <View style={styles.rideCardBottom}>
                      <Car size={14} color="#888" />
                      <Text style={styles.rideCardVehicle}>{ride.vehicleType}</Text>
                      <Bell size={14} color="#F5A623" />
                      <Text style={styles.rideCardNotify}>Bildirim aktif</Text>
                    </View>
                  </View>
                );
              })}
              <TouchableOpacity
                style={styles.newRideBtn}
                onPress={() => setStep('select')}
                activeOpacity={0.85}
              >
                <Text style={styles.newRideBtnText}>+ Yeni Yolculuk Planla</Text>
              </TouchableOpacity>
            </ScrollView>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              <View style={styles.heroCard}>
                <Calendar size={32} color="#F5A623" />
                <Text style={styles.heroTitle}>Yolculuğunuzu Planlayın</Text>
                <Text style={styles.heroDesc}>
                  İleri bir tarih ve saat seçerek yolculuğunuzu önceden planlayın. Zamanı geldiğinde sizi bilgilendireceğiz.
                </Text>
              </View>

              <Text style={styles.sectionTitle}>Tarih Seçin</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.daysScroll}>
                {days.map((day) => (
                  <TouchableOpacity
                    key={day.date}
                    style={[styles.dayChip, selectedDay === day.date && styles.dayChipActive]}
                    onPress={() => {
                      setSelectedDay(day.date);
                      setSelectedTime('');
                      Haptics.selectionAsync().catch(() => {});
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dayChipLabel, selectedDay === day.date && styles.dayChipLabelActive]}>
                      {day.label}
                    </Text>
                    <Text style={[styles.dayChipDay, selectedDay === day.date && styles.dayChipDayActive]}>
                      {day.dayName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.sectionTitle}>Saat Seçin</Text>
              <View style={styles.timeGrid}>
                {filteredTimes.map((time) => (
                  <TouchableOpacity
                    key={time}
                    style={[styles.timeChip, selectedTime === time && styles.timeChipActive]}
                    onPress={() => {
                      setSelectedTime(time);
                      Haptics.selectionAsync().catch(() => {});
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.timeChipText, selectedTime === time && styles.timeChipTextActive]}>
                      {time}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {selectedDay && selectedTime ? (
                <View style={styles.summaryCard}>
                  <View style={styles.summaryRow}>
                    <MapPin size={16} color="#2ECC71" />
                    <Text style={styles.summaryText}>{pickup}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Calendar size={16} color="#F5A623" />
                    <Text style={styles.summaryText}>
                      {days.find((d) => d.date === selectedDay)?.label} - {selectedTime}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.scheduleBtn} onPress={handleSchedule} activeOpacity={0.85}>
                    <CheckCircle size={20} color="#FFF" />
                    <Text style={styles.scheduleBtnText}>Yolculuğu Planla</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </ScrollView>
          )}
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'space-between' as const, paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#F2F2F4',
    justifyContent: 'center' as const, alignItems: 'center' as const,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: '#1A1A1A' },
  listToggle: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#F5A62315',
    justifyContent: 'center' as const, alignItems: 'center' as const,
  },
  listToggleText: { fontSize: 14, fontWeight: '700' as const, color: '#F5A623' },
  content: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  heroCard: {
    backgroundColor: '#FFF8E6', borderRadius: 20, padding: 24, alignItems: 'center' as const,
    marginBottom: 24, borderWidth: 1, borderColor: '#F5A62320',
  },
  heroTitle: { fontSize: 20, fontWeight: '800' as const, color: '#1A1A1A', marginTop: 12, marginBottom: 8 },
  heroDesc: { fontSize: 14, color: '#666', textAlign: 'center' as const, lineHeight: 21 },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: '#1A1A1A', marginBottom: 12, marginTop: 8 },
  daysScroll: { marginBottom: 20 },
  dayChip: {
    paddingVertical: 14, paddingHorizontal: 20, borderRadius: 14,
    backgroundColor: '#F2F2F4', marginRight: 10, alignItems: 'center' as const, minWidth: 85,
  },
  dayChipActive: { backgroundColor: '#1A1A2E' },
  dayChipLabel: { fontSize: 14, fontWeight: '700' as const, color: '#1A1A1A', marginBottom: 4 },
  dayChipLabelActive: { color: '#FFFFFF' },
  dayChipDay: { fontSize: 11, color: '#888' },
  dayChipDayActive: { color: 'rgba(255,255,255,0.6)' },
  timeGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 24 },
  timeChip: {
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10,
    backgroundColor: '#F2F2F4', minWidth: 70, alignItems: 'center' as const,
  },
  timeChipActive: { backgroundColor: '#F5A623' },
  timeChipText: { fontSize: 14, fontWeight: '600' as const, color: '#444' },
  timeChipTextActive: { color: '#FFFFFF' },
  summaryCard: {
    backgroundColor: '#FAFAFA', borderRadius: 16, padding: 20, gap: 12,
    borderWidth: 1, borderColor: '#F0F0F0',
  },
  summaryRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  summaryText: { fontSize: 14, color: '#444', fontWeight: '500' as const },
  scheduleBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 10, backgroundColor: '#2ECC71', paddingVertical: 16, borderRadius: 14, marginTop: 8,
  },
  scheduleBtnText: { fontSize: 16, fontWeight: '700' as const, color: '#FFFFFF' },
  rideCard: {
    backgroundColor: '#FAFAFA', borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#F0F0F0',
  },
  rideCardCancelled: { opacity: 0.5 },
  rideCardTop: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 14 },
  rideCardDate: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  rideCardDateText: { fontSize: 14, fontWeight: '700' as const, color: '#1A1A1A' },
  rideCardTimeText: { fontSize: 14, fontWeight: '600' as const, color: '#3498DB' },
  cancelledBadge: { backgroundColor: '#E74C3C20', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  cancelledBadgeText: { fontSize: 11, fontWeight: '700' as const, color: '#E74C3C' },
  rideCardRoute: { flexDirection: 'row' as const, gap: 10, marginBottom: 12 },
  routeDots: { alignItems: 'center' as const, paddingTop: 4, gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  routeLine: { width: 2, height: 16, backgroundColor: '#E0E0E0' },
  routeTexts: { flex: 1, justifyContent: 'space-between' as const },
  routeText: { fontSize: 13, color: '#444' },
  rideCardBottom: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, borderTopWidth: 1, borderTopColor: '#F0F0F0', paddingTop: 12 },
  rideCardVehicle: { fontSize: 13, color: '#888', marginRight: 12 },
  rideCardNotify: { fontSize: 12, color: '#F5A623', fontWeight: '600' as const },
  newRideBtn: {
    backgroundColor: '#1A1A2E', borderRadius: 14, paddingVertical: 16, alignItems: 'center' as const, marginTop: 8,
  },
  newRideBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#FFFFFF' },
});
