import React, { useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Star, TrendingUp, MessageSquare, User, ThumbsUp } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import type { Driver } from '@/constants/mockData';

interface RatingEntry {
  id: string;
  customerName: string;
  rating: number;
  comment: string;
  date: string;
  tripRoute: string;
}

function generateMockRatings(): RatingEntry[] {
  const names = ['Ahmet Y.', 'Elif K.', 'Mehmet D.', 'Zeynep A.', 'Can B.', 'Selin T.', 'Burak O.', 'Ayşe M.', 'Emre S.', 'Deniz Ç.'];
  const comments = [
    'Çok kibar ve nazik bir sürücü, teşekkürler!',
    'Araç çok temizdi, güvenli sürüş.',
    'Hızlı ve güvenli ulaştırdı, tavsiye ederim.',
    'Çok profesyonel, rotayı çok iyi biliyordu.',
    'Araç konforlu, klima ayarı mükemmeldi.',
    'Zamanında geldi, çok memnun kaldım.',
    'Nazik ve saygılı bir şoför.',
    'Güvenli sürüş, teşekkürler.',
    '',
    'Harika deneyim, kesinlikle tekrar tercih ederim.',
  ];
  const routes = [
    'Kadıköy → Beşiktaş',
    'Taksim → Ataşehir',
    'Bakırköy → Şişli',
    'Üsküdar → Levent',
    'Maltepe → Beyoğlu',
    'Sarıyer → Fatih',
    'Bostancı → Mecidiyeköy',
    'Kartal → Etiler',
  ];

  return Array.from({ length: 10 }, (_, i) => ({
    id: `r_${i}`,
    customerName: names[i],
    rating: i < 7 ? 5 : i < 9 ? 4 : 3,
    comment: comments[i],
    date: new Date(Date.now() - i * 86400000 * (1 + Math.random())).toISOString(),
    tripRoute: routes[i % routes.length],
  }));
}

function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={size}
          color="#F5A623"
          fill={s <= rating ? '#F5A623' : 'transparent'}
          strokeWidth={s <= rating ? 0 : 1.5}
        />
      ))}
    </View>
  );
}

export default function DriverRatingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const driver = user as Driver | null;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const ratings = useMemo(() => generateMockRatings(), []);

  const avgRating = useMemo(() => {
    if (ratings.length === 0) return 0;
    return ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
  }, [ratings]);

  const distribution = useMemo(() => {
    const dist = [0, 0, 0, 0, 0];
    ratings.forEach((r) => { dist[r.rating - 1]++; });
    return dist;
  }, [ratings]);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <ArrowLeft size={22} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Değerlendirmeler</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <Animated.View style={{ opacity: fadeAnim }}>
            <View style={styles.summaryCard}>
              <View style={styles.summaryLeft}>
                <Text style={styles.avgRating}>{avgRating.toFixed(1)}</Text>
                <StarRow rating={Math.round(avgRating)} size={18} />
                <Text style={styles.totalReviews}>{ratings.length} değerlendirme</Text>
              </View>
              <View style={styles.summaryRight}>
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = distribution[star - 1];
                  const pct = ratings.length > 0 ? (count / ratings.length) * 100 : 0;
                  return (
                    <View key={star} style={styles.distRow}>
                      <Text style={styles.distStar}>{star}</Text>
                      <Star size={10} color="#F5A623" fill="#F5A623" />
                      <View style={styles.distBarBg}>
                        <View style={[styles.distBarFill, { width: `${pct}%` as unknown as number }]} />
                      </View>
                      <Text style={styles.distCount}>{count}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={styles.insightRow}>
              <View style={styles.insightCard}>
                <ThumbsUp size={18} color="#2ECC71" />
                <Text style={styles.insightValue}>%{Math.round((distribution[4] / ratings.length) * 100)}</Text>
                <Text style={styles.insightLabel}>5 Yıldız</Text>
              </View>
              <View style={styles.insightCard}>
                <TrendingUp size={18} color="#F5A623" />
                <Text style={styles.insightValue}>{driver?.rating ?? avgRating.toFixed(1)}</Text>
                <Text style={styles.insightLabel}>Genel Puan</Text>
              </View>
              <View style={styles.insightCard}>
                <MessageSquare size={18} color="#3498DB" />
                <Text style={styles.insightValue}>{ratings.filter(r => r.comment).length}</Text>
                <Text style={styles.insightLabel}>Yorum</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Son Değerlendirmeler</Text>

            {ratings.map((entry) => (
              <View key={entry.id} style={styles.reviewCard}>
                <View style={styles.reviewHeader}>
                  <View style={styles.reviewUser}>
                    <View style={styles.reviewAvatar}>
                      <User size={16} color="#888" />
                    </View>
                    <View>
                      <Text style={styles.reviewName}>{entry.customerName}</Text>
                      <Text style={styles.reviewRoute}>{entry.tripRoute}</Text>
                    </View>
                  </View>
                  <View style={styles.reviewRight}>
                    <StarRow rating={entry.rating} size={12} />
                    <Text style={styles.reviewDate}>{formatDate(entry.date)}</Text>
                  </View>
                </View>
                {entry.comment ? (
                  <Text style={styles.reviewComment}>{entry.comment}</Text>
                ) : null}
              </View>
            ))}
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
    flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'space-between' as const, paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#F2F2F4',
    justifyContent: 'center' as const, alignItems: 'center' as const,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: '#1A1A1A' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  summaryCard: {
    flexDirection: 'row' as const, backgroundColor: '#FAFAFA', borderRadius: 20,
    padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#F0F0F0', gap: 20,
  },
  summaryLeft: { alignItems: 'center' as const, justifyContent: 'center' as const, minWidth: 90 },
  avgRating: { fontSize: 40, fontWeight: '800' as const, color: '#1A1A1A', letterSpacing: -1 },
  totalReviews: { fontSize: 12, color: '#888', marginTop: 6 },
  summaryRight: { flex: 1, gap: 6 },
  distRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  distStar: { fontSize: 12, fontWeight: '600' as const, color: '#888', width: 12, textAlign: 'center' as const },
  distBarBg: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#EBEBEB' },
  distBarFill: { height: 6, borderRadius: 3, backgroundColor: '#F5A623' },
  distCount: { fontSize: 11, fontWeight: '600' as const, color: '#888', width: 20, textAlign: 'right' as const },
  insightRow: { flexDirection: 'row' as const, gap: 10, marginBottom: 24 },
  insightCard: {
    flex: 1, backgroundColor: '#FAFAFA', borderRadius: 14, padding: 14,
    alignItems: 'center' as const, gap: 6, borderWidth: 1, borderColor: '#F0F0F0',
  },
  insightValue: { fontSize: 18, fontWeight: '800' as const, color: '#1A1A1A' },
  insightLabel: { fontSize: 11, color: '#888' },
  sectionTitle: { fontSize: 18, fontWeight: '700' as const, color: '#1A1A1A', marginBottom: 14 },
  reviewCard: {
    backgroundColor: '#FAFAFA', borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#F0F0F0',
  },
  reviewHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'flex-start' as const },
  reviewUser: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  reviewAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#EBEBEB',
    justifyContent: 'center' as const, alignItems: 'center' as const,
  },
  reviewName: { fontSize: 14, fontWeight: '600' as const, color: '#1A1A1A' },
  reviewRoute: { fontSize: 12, color: '#888', marginTop: 2 },
  reviewRight: { alignItems: 'flex-end' as const, gap: 4 },
  reviewDate: { fontSize: 11, color: '#AAA' },
  reviewComment: { fontSize: 13, color: '#555', lineHeight: 20, marginTop: 10, paddingLeft: 46 },
});
