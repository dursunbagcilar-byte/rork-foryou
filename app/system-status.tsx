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
  Smartphone,
  type LucideIcon,
} from 'lucide-react-native';
import { getBaseUrl, getSessionToken } from '@/lib/trpc';
import { useTheme } from '@/contexts/ThemeContext';
import { getDbBootstrapPayload, getDbHeaders, getOptionalDbConfig } from '@/utils/db';

interface StatusItem {
  id: string;
  title: string;
  description: string;
  status: 'live' | 'partial' | 'offline';
  icon: LucideIcon;
}

type StorageMode = 'database' | 'snapshot' | 'memory';

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

function isPersistentStorageMode(mode: StorageMode): boolean {
  return mode === 'database' || mode === 'snapshot';
}

function getDatabaseDescription(mode: StorageMode, users: number, drivers: number, clientDbEnvConfigured: boolean, explicitError?: string): string {
  if (mode === 'database') {
    return `Bulut veritabanı bağlı ve çalışıyor. ${users} müşteri, ${drivers} şoför kaydı.`;
  }

  if (mode === 'snapshot') {
    return `Kalıcı sunucu depolaması aktif. ${users} müşteri, ${drivers} şoför kaydı korunuyor.`;
  }

  if (explicitError) {
    return `Veritabanı hatası: ${explicitError}`;
  }

  if (clientDbEnvConfigured) {
    return 'Veritabanı bilgileri mevcut ancak bağlantı henüz kurulamadı. Yeniden deneniyor...';
  }

  return 'Kalıcı veritabanı bağlı değil. Backend şu anda geçici bellek modunda çalışıyor.';
}

function getSmsDescription(configured: boolean, senderName: string | null, missingKeys: string[]): string {
  if (configured) {
    const senderLabel = senderName?.trim() ? ` ${senderName.trim()}` : '';
    return `NetGSM bağlı.${senderLabel ? `${senderLabel} başlığı` : ' Tanımlı başlık'} ile doğrulama ve şifre sıfırlama SMS'leri gönderiliyor.`;
  }

  if (missingKeys.length > 0) {
    return `NetGSM eksik yapılandırma: ${missingKeys.join(', ')}.`;
  }

  return 'NetGSM durumu alınamadı.';
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

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok || attempt === maxRetries) return response;
      if (response.status >= 500) {
        console.log(`[SystemStatus] Retry ${attempt + 1}/${maxRetries} for ${url} - status ${response.status}`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt === maxRetries) throw err;
      console.log(`[SystemStatus] Retry ${attempt + 1}/${maxRetries} for ${url}:`, err instanceof Error ? err.message : err);
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error('Tüm denemeler başarısız');
}

async function fetchSystemStatus(): Promise<SystemStatusResult> {
  const baseUrl = getBaseUrl();
  const sessionToken = await getSessionToken().catch((error: unknown) => {
    console.log('[SystemStatus] Session token read error:', error);
    return null;
  });

  const clientDbConfig = getOptionalDbConfig();
  const dbBootstrapPayload = getDbBootstrapPayload();
  const dbHeaders = getDbHeaders();
  const mapsConfigured = Boolean(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim());
  const clientDbEnvConfigured = Boolean(clientDbConfig);

  console.log('[SystemStatus] Client DB env configured:', clientDbEnvConfigured);

  let backendLive = false;
  let databaseLive = false;
  let backendDbConfigured = false;
  let backendPersistenceReady = false;
  let backendStorageMode: StorageMode = 'memory';
  let users = 0;
  let drivers = 0;
  let smsConfigured = false;
  let smsProvider = 'netgsm';
  let smsSenderName: string | null = null;
  let smsMissing: string[] = [];
  let backendMessage = baseUrl ? 'API adresi çözüldü, canlı kontrol yapılıyor...' : 'API adresi çözülemedi.';
  let dbMessage = 'Veritabanı durumu kontrol ediliyor...';
  let smsMessage = 'NetGSM durumu kontrol ediliyor...';

  if (baseUrl) {
    console.log('[SystemStatus] Checking health at:', baseUrl, 'dbHeaders present:', clientDbEnvConfigured);

    try {
      const healthResponse = await fetchWithRetry(`${baseUrl}/api/health`, {
        method: 'GET',
        headers: dbHeaders,
      });

      const healthPayload = await healthResponse.json().catch(() => null) as {
        status?: string;
        dbConfigured?: boolean;
        dbReady?: boolean;
        storageMode?: StorageMode;
        persistentStoreAvailable?: boolean;
        persistentStoreLastSavedAt?: string | null;
        dbMissing?: {
          endpoint?: boolean;
          namespace?: boolean;
          token?: boolean;
        };
        smsProvider?: string;
        smsConfigured?: boolean;
        smsSenderName?: string | null;
        smsMissing?: string[];
        drivers?: number;
        users?: number;
      } | null;

      backendLive = healthResponse.ok && healthPayload?.status === 'ok';
      backendMessage = backendLive
        ? 'Backend aktif ve yanıt veriyor.'
        : `Backend yanıtı: ${healthPayload?.status ?? `HTTP ${healthResponse.status}`}`;

      if (backendLive && healthPayload) {
        backendDbConfigured = Boolean(healthPayload.dbConfigured);
        backendPersistenceReady = Boolean(healthPayload.dbReady || healthPayload.persistentStoreAvailable);
        backendStorageMode = healthPayload.storageMode === 'database' || healthPayload.storageMode === 'snapshot'
          ? healthPayload.storageMode
          : 'memory';
        databaseLive = backendPersistenceReady || isPersistentStorageMode(backendStorageMode);
        users = typeof healthPayload.users === 'number' ? healthPayload.users : 0;
        drivers = typeof healthPayload.drivers === 'number' ? healthPayload.drivers : 0;
        smsProvider = typeof healthPayload.smsProvider === 'string' && healthPayload.smsProvider.trim()
          ? healthPayload.smsProvider.trim()
          : 'netgsm';
        smsConfigured = Boolean(healthPayload.smsConfigured);
        smsSenderName = typeof healthPayload.smsSenderName === 'string' ? healthPayload.smsSenderName : null;
        smsMissing = Array.isArray(healthPayload.smsMissing)
          ? healthPayload.smsMissing.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : [];
        dbMessage = getDatabaseDescription(backendStorageMode, users, drivers, clientDbEnvConfigured);
        smsMessage = getSmsDescription(smsConfigured, smsSenderName, smsMissing);
      }

      console.log('[SystemStatus] Health check:', { backendLive, databaseLive, users, drivers });
    } catch (healthErr) {
      console.log('[SystemStatus] Health check error:', healthErr instanceof Error ? healthErr.message : healthErr);
      backendMessage = 'Backend bağlantısı kurulamadı. Sunucu uyanıyor olabilir.';
    }

    if (backendLive && !databaseLive) {
      try {
        const bootstrapResponse = await fetchWithRetry(`${baseUrl}/api/bootstrap-db`, {
          method: 'POST',
          headers: dbHeaders,
          body: JSON.stringify(dbBootstrapPayload),
        }, 1);

        const bootstrapPayload = await bootstrapResponse.json().catch(() => null) as {
          success?: boolean;
          configured?: boolean;
          storageMode?: StorageMode;
          persistentStoreAvailable?: boolean;
          error?: string;
          users?: number;
          drivers?: number;
        } | null;

        backendStorageMode = bootstrapPayload?.storageMode === 'database' || bootstrapPayload?.storageMode === 'snapshot'
          ? bootstrapPayload.storageMode
          : backendStorageMode;
        backendPersistenceReady = Boolean(bootstrapPayload?.success || bootstrapPayload?.configured || bootstrapPayload?.persistentStoreAvailable || isPersistentStorageMode(backendStorageMode));

        if (bootstrapResponse.ok) {
          databaseLive = backendPersistenceReady;
          users = typeof bootstrapPayload?.users === 'number' ? bootstrapPayload.users : users;
          drivers = typeof bootstrapPayload?.drivers === 'number' ? bootstrapPayload.drivers : drivers;
          dbMessage = getDatabaseDescription(backendStorageMode, users, drivers, clientDbEnvConfigured, bootstrapPayload?.error);
        }
        console.log('[SystemStatus] Bootstrap check:', { databaseLive, users, drivers, backendStorageMode });
      } catch (bootstrapErr) {
        console.log('[SystemStatus] Bootstrap check error:', bootstrapErr instanceof Error ? bootstrapErr.message : bootstrapErr);
        dbMessage = clientDbEnvConfigured
          ? 'Veritabanı bağlantısı zaman aşımına uğradı. Tekrar deneyin.'
          : getDatabaseDescription(backendStorageMode, users, drivers, clientDbEnvConfigured);
      }
    }

    if (!backendLive && clientDbEnvConfigured) {
      try {
        const bootstrapResponse = await fetchWithRetry(`${baseUrl}/api/bootstrap-db`, {
          method: 'POST',
          headers: dbHeaders,
          body: JSON.stringify(dbBootstrapPayload),
        }, 1);

        const bootstrapPayload = await bootstrapResponse.json().catch(() => null) as {
          success?: boolean;
          configured?: boolean;
          storageMode?: StorageMode;
          persistentStoreAvailable?: boolean;
          error?: string;
          users?: number;
          drivers?: number;
        } | null;

        if (bootstrapResponse.ok) {
          backendLive = true;
          backendMessage = 'Backend aktif ve yanıt veriyor.';
          backendStorageMode = bootstrapPayload?.storageMode === 'database' || bootstrapPayload?.storageMode === 'snapshot'
            ? bootstrapPayload.storageMode
            : 'memory';
          backendPersistenceReady = Boolean(bootstrapPayload?.success || bootstrapPayload?.configured || bootstrapPayload?.persistentStoreAvailable || isPersistentStorageMode(backendStorageMode));
          databaseLive = backendPersistenceReady;
          users = typeof bootstrapPayload?.users === 'number' ? bootstrapPayload.users : 0;
          drivers = typeof bootstrapPayload?.drivers === 'number' ? bootstrapPayload.drivers : 0;
          dbMessage = getDatabaseDescription(backendStorageMode, users, drivers, clientDbEnvConfigured, bootstrapPayload?.error);
        }
      } catch (fallbackErr) {
        console.log('[SystemStatus] Fallback bootstrap error:', fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
      }
    }
  }

  const sessionDescription = sessionToken
    ? 'Aktif oturum bulundu. Giriş sistemi gerçek çalışıyor.'
    : backendLive
      ? 'Oturum altyapısı hazır. Giriş yapıldığında oturum oluşturulacak.'
      : 'Oturum altyapısı backend ile birlikte çalışır.';

  const sessionStatus: StatusItem['status'] = sessionToken
    ? 'live'
    : backendLive
      ? 'live'
      : 'offline';

  const smsStatus: StatusItem['status'] = smsConfigured
    ? 'live'
    : backendLive || baseUrl
      ? 'partial'
      : 'offline';

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
      status: databaseLive ? 'live' : (backendLive || clientDbEnvConfigured || backendDbConfigured || backendPersistenceReady) ? 'partial' : 'offline',
      icon: Database,
    },
    {
      id: 'session',
      title: 'Oturum sistemi',
      description: sessionDescription,
      status: sessionStatus,
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
      description: backendLive
        ? 'tRPC ve auth rotaları aktif. Kayıt, giriş ve profil güncelleme gerçek backend kullanıyor.'
        : baseUrl
          ? 'API adresi mevcut, backend henüz yanıt vermiyor.'
          : 'API adresi çözülemedi.',
      status: backendLive ? 'live' : baseUrl ? 'partial' : 'offline',
      icon: KeyRound,
    },
    {
      id: 'sms',
      title: `SMS altyapısı (${smsProvider.toUpperCase()})`,
      description: smsMessage,
      status: smsStatus,
      icon: Smartphone,
    },
  ];

  const liveCount = items.filter((i) => i.status === 'live').length;
  const overallStatus: SystemStatusResult['overallStatus'] = liveCount === items.length
    ? 'live'
    : liveCount > 0
      ? 'partial'
      : 'offline';

  const summary = overallStatus === 'live'
    ? 'Tüm servisler aktif ve çalışıyor.'
    : overallStatus === 'partial'
      ? `${liveCount}/${items.length} servis aktif.`
      : 'Hiçbir servise şu an ulaşılamıyor.';

  return {
    checkedAt: new Date().toISOString(),
    baseUrl,
    overallStatus,
    summary,
    stats: { users, drivers },
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
