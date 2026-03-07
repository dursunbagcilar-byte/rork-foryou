import React, { useCallback, useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  useWindowDimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  X,
  User,
  Car,
  FileText,
  Wallet,
  Users,
  Bell,
  Shield,
  CircleHelp,
  LogOut,
  ChevronRight,
  Check,
  Bot,
  Wand2,
  BarChart3,
  Star,
  Moon,
  Sun,
  Heart,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import * as Haptics from 'expo-haptics';
import { SUPPORT_WHATSAPP_DISPLAY } from '@/constants/support';

const MENU_ITEMS = [
  { icon: User, label: 'Hesabım', route: '/(driver-tabs)/profile' },
  { icon: BarChart3, label: 'Performans İstatistikleri', route: '/(driver-tabs)/profile/stats' },
  { icon: Star, label: 'Değerlendirmeler', route: '/(driver-tabs)/profile/ratings' },
  { icon: Bot, label: 'AI Asistan', route: '/ai-chat', accent: true },
  { icon: Wand2, label: 'AI Fotoğraf Editörü', route: '/ai-photo-editor', accent: true },
  { icon: Car, label: 'Araç Bilgileri', route: '/(driver-tabs)/profile/vehicle' },
  { icon: FileText, label: 'Belgelerim', route: '/(driver-tabs)/profile/documents' },
  { icon: Users, label: 'Ekip Üyelerim', route: '/(driver-tabs)/profile/team-member' },
  { icon: Bell, label: 'Bildirimler', route: '/(driver-tabs)/profile/notifications' },
  { icon: Shield, label: 'Güvenlik', route: '/(driver-tabs)/profile/security' },
  { icon: Wallet, label: 'Kazançlarım', route: '/(driver-tabs)/earnings' },
  { icon: FileText, label: 'Gizlilik Politikası', route: '/privacy-policy' },
  { icon: Shield, label: 'KVKK / Veri Yönetimi', route: '/kvkk-data-management' },
  { icon: FileText, label: 'Kullanım Şartları', route: '/terms-of-service' },
  { icon: CircleHelp, label: 'Yardım', route: '/driver-help' },
];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Günaydın,';
  if (hour >= 12 && hour < 18) return 'İyi günler,';
  if (hour >= 18 && hour < 22) return 'İyi akşamlar,';
  return 'İyi geceler,';
}

export default function DriverMenuScreen() {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isSmall = width < 360;
  const isTablet = width >= 600;
  const hPad = isSmall ? 18 : isTablet ? 40 : 24;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const [selectedLang, setSelectedLang] = useState<'TR' | 'EN'>('TR');

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 80,
        friction: 12,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.back();
  }, [router]);

  const handleMenuPress = useCallback((route: string | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (route) {
      router.back();
      setTimeout(() => {
        router.push(route as any);
      }, 100);
    }
  }, [router]);

  const handleLogout = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await logout();
    router.replace('/');
  }, [logout, router]);

  const initials = user?.name
    ? user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'S';

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn} activeOpacity={0.6} testID="driver-menu-close">
            <X size={24} color="#1A1A1A" strokeWidth={2.5} />
          </TouchableOpacity>

          <View style={[styles.header, { paddingHorizontal: hPad }]}>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <View style={styles.headerRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <View style={styles.headerInfo}>
                <Text style={[styles.userName, { fontSize: isSmall ? 22 : isTablet ? 30 : 26 }]}>{user?.name ?? 'Şoför'}</Text>
                <Text style={styles.userSub}>2GO Şoför</Text>
              </View>
            </View>
          </View>

          <ScrollView
            style={styles.menuScroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.menuScrollContent}
          >
            <View style={[styles.menuList, { paddingHorizontal: hPad }]}>
              {MENU_ITEMS.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.menuItem}
                  activeOpacity={0.5}
                  onPress={() => handleMenuPress(item.route)}
                  testID={`driver-menu-item-${index}`}
                >
                  <View style={styles.menuIconWrap}>
                    <item.icon size={22} color="#1A5C2E" strokeWidth={1.8} />
                  </View>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <ChevronRight size={20} color="#1A5C2E" strokeWidth={2} />
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.cardsRow}>
              <View style={[styles.miniCard, styles.miniCardFull, { backgroundColor: '#1A1A2E' }]}>
                <Heart size={20} color="#2ECC71" strokeWidth={2} />
                <Text style={styles.miniCardSubtitle}>2GO Destek</Text>
                <Text style={styles.miniCardTitle}>Uygulamamıza destek ol</Text>
                <Text style={styles.miniCardPhone} selectable>{SUPPORT_WHATSAPP_DISPLAY}</Text>
                <TouchableOpacity activeOpacity={0.7} onPress={() => {
                  Alert.alert(
                    '2GO Destek',
                    `Bağış ve destekleriniz için ${SUPPORT_WHATSAPP_DISPLAY} numarası ile iletişime geçin.`,
                    [{ text: 'Tamam' }]
                  );
                }}>
                  <Text style={styles.miniCardLink}>Detaya Git</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.themeSection}>
              <Text style={styles.langTitle}>Tema</Text>
              <TouchableOpacity
                style={[styles.themeToggleBtn, isDark && styles.themeToggleBtnDark]}
                onPress={() => {
                  void toggleTheme();
                  Haptics.selectionAsync().catch(() => {});
                }}
                activeOpacity={0.7}
              >
                {isDark ? <Moon size={16} color="#2ECC71" /> : <Sun size={16} color="#F5A623" />}
                <Text style={[styles.themeToggleText, isDark && styles.themeToggleTextDark]}>
                  {isDark ? 'Karanlık Mod' : 'Aydınlık Mod'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.langSection}>
              <Text style={styles.langTitle}>Dil seçimi</Text>
              <View style={styles.langRow}>
                <TouchableOpacity
                  style={[styles.langBtn, selectedLang === 'TR' && styles.langBtnActive]}
                  activeOpacity={0.7}
                  onPress={() => setSelectedLang('TR')}
                >
                  {selectedLang === 'TR' && <Check size={16} color="#FFF" strokeWidth={2.5} />}
                  <Text style={[styles.langBtnText, selectedLang === 'TR' && styles.langBtnTextActive]}>TR</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.langBtn, selectedLang === 'EN' && styles.langBtnActive]}
                  activeOpacity={0.7}
                  onPress={() => setSelectedLang('EN')}
                >
                  {selectedLang === 'EN' && <Check size={16} color="#FFF" strokeWidth={2.5} />}
                  <Text style={[styles.langBtnText, selectedLang === 'EN' && styles.langBtnTextActive]}>EN</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={styles.logoutRow} onPress={handleLogout} activeOpacity={0.6} testID="driver-menu-logout">
              <LogOut size={18} color="#E74C3C" strokeWidth={2} />
              <Text style={styles.logoutText}>Çıkış Yap</Text>
            </TouchableOpacity>
          </ScrollView>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  closeBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginLeft: 16,
    marginTop: 4,
  },
  header: {
    paddingHorizontal: 24,
    marginTop: 16,
    marginBottom: 28,
  },
  greeting: {
    fontSize: 15,
    color: '#888',
    fontWeight: '400' as const,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#2ECC71',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  headerInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: '#1A1A1A',
    letterSpacing: -0.3,
  },
  userSub: {
    fontSize: 13,
    color: '#2ECC71',
    fontWeight: '600' as const,
    marginTop: 2,
  },
  menuScroll: {
    flex: 1,
  },
  menuScrollContent: {
    paddingBottom: 30,
  },
  menuList: {
    paddingHorizontal: 24,
  },
  menuItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 18,
  },
  menuIconWrap: {
    width: 36,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginRight: 16,
  },
  menuLabel: {
    flex: 1,
    fontSize: 17,
    fontWeight: '500' as const,
    color: '#1A1A1A',
    letterSpacing: -0.1,
  },
  themeSection: {
    paddingHorizontal: 24,
    marginTop: 20,
  },
  themeToggleBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    backgroundColor: '#F0F0F0',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  themeToggleBtnDark: {
    backgroundColor: '#1A1A2E',
  },
  themeToggleText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#1A1A1A',
  },
  themeToggleTextDark: {
    color: '#FFFFFF',
  },
  langSection: {
    paddingHorizontal: 24,
    marginTop: 20,
  },
  langTitle: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: '#888',
    marginBottom: 10,
  },
  langRow: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  langBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: '#F0F0F0',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  langBtnActive: {
    backgroundColor: '#1A1A1A',
  },
  langBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#666',
  },
  langBtnTextActive: {
    color: '#FFFFFF',
  },
  logoutRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 16,
    marginTop: 20,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#E74C3C',
  },
  cardsRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: 24,
    marginTop: 20,
    gap: 10,
  },
  miniCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    minHeight: 160,
    justifyContent: 'space-between' as const,
  },
  miniCardSubtitle: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: '#2ECC71',
    marginTop: 8,
  },
  miniCardTitle: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    lineHeight: 20,
    marginTop: 4,
  },
  miniCardFull: {
    flex: undefined,
    width: '100%' as any,
  },
  miniCardPhone: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    letterSpacing: 1,
    marginTop: 6,
  },
  miniCardLink: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#2ECC71',
    textDecorationLine: 'underline' as const,
    marginTop: 6,
  },
  miniCardIban: {
    fontSize: 10,
    fontWeight: '500' as const,
    color: '#AAA',
    letterSpacing: 0.3,
    marginTop: 4,
  },
  miniCardCopyBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    alignSelf: 'flex-start' as const,
    gap: 4,
    backgroundColor: '#2ECC71',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginTop: 6,
  },
  miniCardCopyText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
});
