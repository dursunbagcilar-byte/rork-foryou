import React, { memo, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Database,
  KeyRound,
  MapPinned,
  Server,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react-native';
import { getBaseUrl, getSessionToken } from '@/lib/trpc';
import { useTheme } from '@/contexts/ThemeContext';

interface StatusItem {
  id: string;
  title: string;
  description: string;
  status: 'live' | 'partial' | 'offline';
  icon: LucideIcon;
}

interface SystemStatusResult {
  checkedAt: string;
  baseUrl: string;
  overallStatus: 'live' | 'partial' | 'offline';
  summary: string;
  stats: {
    users: number;
    drivers: number;
  };
  items: StatusItem[];
}

function getStatusColors(status: StatusItem['status'], isDark: boolean) {
  if (status === 'live') {
    return {
      bg: isDark ? 'rgba(46, 204, 113, 0.12)' : '#EAF9F0',
      border: isDark ? 'rgba(46, 204, 113, 0.28)' : '#BFE8CD',
      icon: '#2ECC71',
      chipBg: isDark ? 'rgba(46, 204, 113, 0.18)' : '#DDF5E6',
      chipText: '#2ECC71',
      label: 'Canlı',
    };
  }

  if (status === 'partial') {
    return {
      bg: isDark ? 'rgba(245, 166, 35, 0.12)' : '#FFF4E6',
      border: isDark ? 'rgba(245, 166, 35, 0.28)' : '#FFD6A3',
      icon: '#F5A623',
      chipBg: isDark ? 'rgba(245, 166, 35, 0.18)' : '#FFE8C7',
      chipText: '#F5A623',
      label: 'Kısmi',
    };
  }

  return {
    bg: isDark ? 'rgba(231, 76, 60, 0.12)' : '#FDEDEC',
    border: isDark ? 'rgba(231, 76, 60, 0.28)' : '#F2C3BC',
    icon: '#E74C3C',
    chipBg: isDark ? 'rgba(231, 76, 60, 0.18)' : '#FADBD6',
    chipText: '#E74C3C',
    label: 'Kapalı',
  };
}

const StatusRow = memo(function StatusRow({
  item,
  isDark,
  textColor,
  textSecondary,
}: {
  item: StatusItem;
  isDark: boolean;
  textColor: string;
  textSecondary: string;
}) {
  const palette = getStatusColors(item.status, isDark);

  return (
    <View style={[styles.statusCard, { backgroundColor: palette.bg, borderColor: palette.border }]}> 
      <View style={[styles.statusIconWrap, { backgroundColor: palette.chipBg }]}> 
        <item.icon size={18} color={palette.icon} strokeWidth={2.2} />
      </View>
      <View style={styles.statusContent}>
        <View style={styles.statusHeaderRow}>
          <Text style={[styles.statusTitle, { color: textColor }]}>{item.title}</Text>
          <View style={[styles.statusChip, { backgroundColor: palette.chipBg }]}> 
            <Text style={[styles.statusChipText, { color: palette.chipText }]}>{palette.label}</Text>
          </View>
        </View>
        <Text style={[styles.statusDescription, { color: textSecondary }]}>{item.description}</Text>
      </View>
    </View>
  );
});

async function fetchSystemStatus(): Promise<SystemStatusResult> {
  const baseUrl = getBaseUrl();
  const sessionToken = await getSessionToken().catch((error: unknown) => {
    console.log('[SystemStatus] Session token read error:', error);
    return null;
  });

  const dbEndpoint = process.env.EXPO_PUBLIC_RORK_DB_ENDPOINT;
  const dbNamespace = process.env.EXPO_PUBLIC_RORK_DB_NAMESPACE;
  const dbToken = process.env.EXPO_PUBLIC_RORK_DB_TOKEN;
  const mapsConfigured = Boolean(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim());

  let backendLive = false;
  let databaseLive = false;
  let users = 0;
  let drivers = 0;
  let backendMessage = baseUrl ? 'API adresi çözüldü, canlı kontrol yapılıyor.' : 'API adresi çözülemedi.';
  let dbMessage = 'Veritabanı kontrolü yapılamadı.';

  if (baseUrl && dbEndpoint && dbNamespace && dbToken) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${baseUrl}/api/bootstrap-db`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-db-endpoint': dbEndpoint,
          'x-db-namespace': dbNamespace,
          'x-db-token': dbToken,
        },
        body: JSON.stringify({
          endpoint: dbEndpoint,
          namespace: dbNamespace,
          token: dbToken,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const payload = await response.json().catch(() => null) as {
        success?: boolean;
        error?: string;
        users?: number;
        drivers?: number;
      } | null;

      backendLive = response.ok;
      databaseLive = Boolean(payload?.success);
      users = typeof payload?.users === 'number' ? payload.users : 0;
      drivers = typeof payload?.drivers === 'number' ? payload.drivers : 0;
      backendMessage = response.ok
        ? 'Backend yanıt veriyor ve istek kabul ediyor.'
        : `Backend hatası: ${payload?.error ?? `HTTP ${response.status}`}`;
      dbMessage = payload?.success
        ? `Veritabanı bağlı. ${users} müşteri, ${drivers} şoför kaydı bulundu.`
        : payload?.error ?? 'Veritabanı yanıt vermedi.';
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
      backendMessage = `Canlı bağlantı kurulamadı: ${message}`;
      dbMessage = `Veritabanı kontrolü başarısız: ${message}`;
      console.log('[SystemStatus] Live check error:', error);
    }
  }

  const items: StatusItem[] = [
    {
      id: 'backend',
      title: 'Backend / API',
      description: backendMessage,
      status: backendLive ? 'live' : baseUrl ? 'partial' : 'offline',
      icon: Server,
    },
    {
      id: 'database',
      title: 'Veritabanı',
      description: dbMessage,
      status: databaseLive ? 'live' : baseUrl ? 'partial' : 'offline',
      icon: Database,
    },
    {
      id: 'session',
      title: 'Oturum sistemi',
      description: sessionToken
        ? 'Cihazda aktif bir oturum tokenı bulundu. Giriş sistemi gerçek çalışıyor.'
        : 'Oturum altyapısı mevcut. Şu an cihazda aktif token yok.',
      status: sessionToken ? 'live' : 'partial',
      icon: ShieldCheck,
    },
    {
      id: 'maps',
      title: 'Harita altyapısı',
      description: mapsConfigured
        ? 'Google Maps anahtarı tanımlı. Harita ve konum akışı gerçek servis kullanabiliyor.'
        : 'Google Maps anahtarı görünmüyor.',
      status: mapsConfigured ? 'live' : 'offline',
      icon: MapPinned,
    },
    {
      id: 'routing',
      title: 'Kayıt / giriş uçları',
      description: baseUrl
        ? 'tRPC ve auth rotaları projede bağlı. Kayıt, giriş ve profil güncelleme akışı gerçek backend kullanıyor.'
        : 'Auth uçlarına gidilecek API adresi şu an çözülemiyor.',
      status: baseUrl ? 'live' : 'offline',
      icon: KeyRound,
    },
  ];

  const overallStatus = databaseLive
    ? 'live'
    : items.some((item) => item.status === 'live')
      ? 'partial'
      : 'offline';

  const summary = overallStatus === 'live'
    ? 'Uygulamada gerçek çalışan servisler var.'
    : overallStatus === 'partial'
      ? 'Bazı gerçek servisler hazır, bazıları eksik veya anlık erişilemiyor.'
      : 'Canlı servis doğrulanamadı.';

  return {
    checkedAt: new Date().toISOString(),
    baseUrl,
    overallStatus,
    summary,
    stats: {
      users,
      drivers,
    },
    items,
  };
}

export default function SystemStatusScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const statusQuery = useQuery({
    queryKey: ['system-status'],
    queryFn: fetchSystemStatus,
    staleTime: 30000,
    retry: 0,
  });

  const textColor = colors.text;
  const textSecondary = colors.textSecondary;
  const cardColor = isDark ? 'rgba(255,255,255,0.04)' : '#FFFFFF';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : '#E7E7EE';
  const accentGlow = isDark ? 'rgba(245,166,35,0.16)' : '#FFF2DD';

  const overallPalette = useMemo(() => {
    const status = statusQuery.data?.overallStatus ?? 'partial';
    return getStatusColors(status, isDark);
  }, [isDark, statusQuery.data?.overallStatus]);

  const checkedAtLabel = useMemo(() => {
    if (!statusQuery.data?.checkedAt) {
      return 'Kontrol bekleniyor';
    }

    return new Date(statusQuery.data.checkedAt).toLocaleString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: '2-digit',
    });
  }, [statusQuery.data?.checkedAt]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={[styles.backgroundOrbTop, { backgroundColor: accentGlow }]} />
      <View style={[styles.backgroundOrbBottom, { backgroundColor: isDark ? 'rgba(46, 204, 113, 0.1)' : '#E8FFF2' }]} />

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backButton, { backgroundColor: cardColor, borderColor }]}
            activeOpacity={0.75}
            testID="system-status-back"
          >
            <ArrowLeft size={18} color={textColor} strokeWidth={2.4} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void statusQuery.refetch()}
            style={[styles.refreshButton, { backgroundColor: cardColor, borderColor }]}
            activeOpacity={0.75}
            testID="system-status-refresh"
          >
            <Text style={[styles.refreshText, { color: textColor }]}>
              {statusQuery.isRefetching ? 'Yenileniyor' : 'Yenile'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={statusQuery.isRefetching}
              onRefresh={() => void statusQuery.refetch()}
              tintColor={overallPalette.icon}
            />
          }
          contentContainerStyle={styles.scrollContent}
        >
          <View style={[styles.heroCard, { backgroundColor: cardColor, borderColor }]}> 
            <View style={[styles.heroStatusBadge, { backgroundColor: overallPalette.chipBg }]}> 
              {statusQuery.data?.overallStatus === 'live' ? (
                <CheckCircle2 size={16} color={overallPalette.icon} strokeWidth={2.4} />
              ) : (
                <CircleAlert size={16} color={overallPalette.icon} strokeWidth={2.4} />
              )}
              <Text style={[styles.heroStatusText, { color: overallPalette.icon }]}>
                {statusQuery.data?.summary ?? 'Canlı durum kontrol ediliyor'}
              </Text>
            </View>

            <Text style={[styles.heroTitle, { color: textColor }]}>Canlı Sistem Durumu</Text>
            <Text style={[styles.heroSubtitle, { color: textSecondary }]}>Bu ekran uygulamada gerçekten ayağa kalkmış servisleri gösterir.</Text>

            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F7F7FA' }]}>
                <Text style={[styles.statValue, { color: textColor }]}>{statusQuery.data?.stats.users ?? 0}</Text>
                <Text style={[styles.statLabel, { color: textSecondary }]}>Müşteri</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#F7F7FA' }]}>
                <Text style={[styles.statValue, { color: textColor }]}>{statusQuery.data?.stats.drivers ?? 0}</Text>
                <Text style={[styles.statLabel, { color: textSecondary }]}>Şoför</Text>
              </View>
            </View>

            <View style={styles.metaRow}>
              <Text style={[styles.metaLabel, { color: textSecondary }]}>Son kontrol</Text>
              <Text style={[styles.metaValue, { color: textColor }]}>{checkedAtLabel}</Text>
            </View>

            <View style={styles.metaRow}>
              <Text style={[styles.metaLabel, { color: textSecondary }]}>API</Text>
              <Text style={[styles.metaValue, { color: textColor }]} numberOfLines={1}>
                {statusQuery.data?.baseUrl || 'Bulunamadı'}
              </Text>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>Kontrol edilen servisler</Text>
            <Text style={[styles.sectionSubtitle, { color: textSecondary }]}>Gerçek çalışan parçalar burada net görünür.</Text>
          </View>

          {(statusQuery.data?.items ?? []).map((item) => (
            <StatusRow
              key={item.id}
              item={item}
              isDark={isDark}
              textColor={textColor}
              textSecondary={textSecondary}
            />
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  backgroundOrbTop: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 260,
    top: -80,
    right: -60,
  },
  backgroundOrbBottom: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 240,
    bottom: -100,
    left: -40,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButton: {
    minWidth: 94,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  refreshText: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  heroCard: {
    borderRadius: 26,
    borderWidth: 1,
    padding: 20,
    marginBottom: 22,
  },
  heroStatusBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    marginBottom: 16,
  },
  heroStatusText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800' as const,
    letterSpacing: -0.6,
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    marginBottom: 18,
  },
  statCard: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    marginTop: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 10,
  },
  metaLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  metaValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '700' as const,
  },
  sectionHeader: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
  sectionSubtitle: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  statusIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusContent: {
    flex: 1,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  statusTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800' as const,
  },
  statusChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  statusDescription: {
    fontSize: 13,
    lineHeight: 19,
  },
});
