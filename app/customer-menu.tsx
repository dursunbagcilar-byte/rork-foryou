import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Animated,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  X,
  UserCircle,
  SlidersHorizontal,
  Clock,
  CreditCard,
  Megaphone,
  CircleHelp,
  LogOut,
  ChevronRight,
  Check,
  Shield,
  Calendar,
  FileText,
  Wand2,
  Moon,
  Sun,
  Heart,
  Award,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import type { Language, TranslationKey } from '@/contexts/LanguageContext';
import * as Haptics from 'expo-haptics';
import { SUPPORT_WHATSAPP_DISPLAY } from '@/constants/support';

function getGreetingKey(): TranslationKey {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'greeting_morning';
  if (hour >= 12 && hour < 18) return 'greeting_afternoon';
  if (hour >= 18 && hour < 22) return 'greeting_evening';
  return 'greeting_night';
}

const MENU_KEYS: { icon: any; labelKey: TranslationKey; route: string | null; accent?: boolean }[] = [
  { icon: UserCircle, labelKey: 'my_account', route: '/(customer-tabs)/profile' },
  { icon: SlidersHorizontal, labelKey: 'preferences', route: '/(customer-tabs)/profile/preferences' },
  { icon: Clock, labelKey: 'past_rides', route: '/(customer-tabs)/rides' },
  { icon: Calendar, labelKey: 'scheduled_ride', route: '/scheduled-ride' },
  { icon: CreditCard, labelKey: 'payment_methods', route: '__payment_methods__' },
  { icon: Megaphone, labelKey: 'campaigns', route: '/(customer-tabs)/profile/campaigns' },
  { icon: FileText, labelKey: 'cancel_policy', route: '/cancellation-policy' },
  { icon: CircleHelp, labelKey: 'help', route: '/(customer-tabs)/profile/help' },
  { icon: Shield, labelKey: 'privacy_policy', route: '/privacy-policy' },
  { icon: Shield, labelKey: 'kvkk_data_management', route: '/kvkk-data-management' },
  { icon: FileText, labelKey: 'terms_of_service', route: '/terms-of-service' },
  { icon: Wand2, labelKey: 'ai_photo_editor', route: '/ai-photo-editor', accent: true },
];

export default function CustomerMenuScreen() {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme, colors } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const menuItemAnims = useRef(MENU_KEYS.map(() => new Animated.Value(0))).current;
  const menuItemSlides = useRef(MENU_KEYS.map(() => new Animated.Value(20))).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();

    const animations = MENU_KEYS.map((_, i) =>
      Animated.parallel([
        Animated.timing(menuItemAnims[i], {
          toValue: 1,
          duration: 220,
          delay: 80 + i * 40,
          useNativeDriver: true,
        }),
        Animated.timing(menuItemSlides[i], {
          toValue: 0,
          duration: 220,
          delay: 80 + i * 40,
          useNativeDriver: true,
        }),
      ])
    );
    Animated.stagger(0, animations).start();
  }, [fadeAnim, menuItemAnims, menuItemSlides, slideAnim]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  const handleMenuPress = useCallback((route: string | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!route) return;
    if (route === '__payment_methods__') {
      Alert.alert(
        t('payment_methods'),
        'Şu anda nakit ödeme kabul edilmektedir. Kredi kartı ile ödeme özelliği yakında hizmetinize sunulacaktır.',
        [{ text: 'Tamam' }]
      );
      return;
    }
    console.log('[CustomerMenu] Navigating to route:', route);
    router.back();
    setTimeout(() => {
      router.push(route as any);
    }, 100);
  }, [router, t]);

  const handleLogout = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await logout();
    router.replace('/');
  }, [logout, router]);

  const handleLangChange = useCallback((lang: Language) => {
    void setLanguage(lang);
    Haptics.selectionAsync().catch(() => {});
  }, [setLanguage]);

  const bgColor = isDark ? colors.background : '#FFFFFF';
  const shellBgColor = width > 430 ? (isDark ? '#0B1020' : '#EEF2F7') : bgColor;
  const textColor = isDark ? colors.text : '#1A1A1A';
  const textSecondary = isDark ? colors.textSecondary : '#666';
  const iconColor = isDark ? '#C9B8FF' : '#3D2C8D';
  const dividerColor = isDark ? colors.divider : '#F0F0F0';
  const footerBg = isDark ? colors.background : '#FFFFFF';
  const langBtnBg = isDark ? colors.card : '#F0F0F0';
  const langBtnActiveBg = isDark ? '#F5A623' : '#1A1A1A';
  const themeBtnBg = isDark ? colors.card : '#F0F0F0';
  const inviteBannerAccent = '#17C653';
  const supportCardBg = isDark ? 'rgba(23,198,83,0.16)' : '#EAF8EE';
  const supportCardIconColor = isDark ? '#8FE7B3' : '#17C653';
  const supportCardTitleColor = isDark ? '#F4FFF7' : '#14532D';
  const usePhoneFrame = width > 430;

  return (
    <View style={[styles.container, { backgroundColor: shellBgColor }]}>
      <View
        style={[
          styles.phoneFrame,
          { backgroundColor: bgColor },
          usePhoneFrame && styles.phoneFrameFloating,
        ]}
        testID="customer-menu-frame"
      >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={[styles.inner, { paddingTop: Math.max(insets.top, 20) }]}>
        <Animated.View style={[styles.headerSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeBtn}
            activeOpacity={0.6}
            testID="menu-close"
          >
            <X size={24} color={textColor} strokeWidth={2} />
          </TouchableOpacity>

          <Text style={[styles.greeting, { color: textSecondary }]}>{t(getGreetingKey())}</Text>
          <Text style={[styles.userName, { color: textColor }]}>{user?.name ?? t('user_fallback')}</Text>
        </Animated.View>

        <ScrollView
          style={styles.menuScroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.menuScrollContent, { paddingBottom: Math.max(insets.bottom, 16) + 80 }]}
          bounces={true}
        >
          <View style={styles.menuList}>
            {MENU_KEYS.map((item, index) => (
              <Animated.View
                key={index}
                style={{ opacity: menuItemAnims[index], transform: [{ translateX: menuItemSlides[index] }] }}
              >
                <TouchableOpacity
                  style={[
                    styles.menuItem,
                    item.accent && styles.menuItemAccent,
                    item.accent && isDark && { backgroundColor: 'rgba(245,166,35,0.12)' },
                  ]}
                  activeOpacity={0.55}
                  onPress={() => handleMenuPress(item.route)}
                  testID={`menu-item-${index}`}
                >
                  <item.icon size={22} color={item.accent ? '#F5A623' : iconColor} strokeWidth={1.8} />
                  <Text style={[
                    styles.menuLabel,
                    { color: textColor },
                    item.accent && styles.menuLabelAccent,
                  ]}>{t(item.labelKey)}</Text>
                  <ChevronRight size={18} color={item.accent ? '#F5A623' : iconColor} strokeWidth={2} />
                </TouchableOpacity>
              </Animated.View>
            ))}
          </View>

          <View style={styles.cardsRow}>
            <View style={[styles.miniCard, { backgroundColor: supportCardBg }]}>
              <Heart size={20} color={supportCardIconColor} strokeWidth={2} />
              <Text style={[styles.miniCardSubtitle, { color: inviteBannerAccent }]}>{t('support_subtitle')}</Text>
              <Text style={[styles.miniCardTitle, { color: supportCardTitleColor }]}>{t('support_title')}</Text>
              <TouchableOpacity activeOpacity={0.7} onPress={() => {
                Alert.alert(
                  t('support_title'),
                  `Bağış ve destekleriniz için ${SUPPORT_WHATSAPP_DISPLAY} numarası ile iletişime geçin.`,
                  [{ text: 'Tamam' }]
                );
              }}>
                <Text style={[styles.miniCardLink, { color: inviteBannerAccent }]}>{t('support_link')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.miniCard, { backgroundColor: isDark ? '#1E1A2E' : '#F3EEFF' }]}
              activeOpacity={0.82}
              onPress={() => handleMenuPress('/(customer-tabs)/dashboard/invite')}
              testID="customer-menu-invite-card"
            >
              <Award size={20} color={isDark ? '#C9B8FF' : '#6B4EAE'} strokeWidth={2} />
              <Text style={[styles.miniCardSubtitle, { color: isDark ? '#C9B8FF' : '#6B4EAE' }]}>{t('invite_friends_subtitle' as TranslationKey)}</Text>
              <Text style={[styles.miniCardTitle, { color: isDark ? '#FFFFFF' : '#3D2C8D' }]}>{t('invite_friends_title' as TranslationKey)}</Text>
              <Text style={[styles.miniCardDesc, { color: isDark ? '#9595A8' : '#6B4EAE' }]}>{t('invite_friends_desc' as TranslationKey)}</Text>
              <Text style={[styles.miniCardLink, { color: isDark ? '#F5A623' : '#3D2C8D' }]}>{t('invite_friends_link' as TranslationKey)}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.themeSection}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>{t('theme')}</Text>
            <TouchableOpacity
              style={[styles.themeToggleBtn, { backgroundColor: themeBtnBg }]}
              onPress={() => {
                void toggleTheme();
                Haptics.selectionAsync().catch(() => {});
              }}
              activeOpacity={0.7}
            >
              {isDark ? <Moon size={16} color="#F5A623" /> : <Sun size={16} color="#F5A623" />}
              <Text style={[styles.themeToggleText, { color: textColor }]}>
                {isDark ? t('dark_mode') : t('light_mode')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.langSection}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>{t('language_select')}</Text>
            <View style={styles.langRow}>
              <TouchableOpacity
                style={[styles.langBtn, { backgroundColor: langBtnBg }, language === 'TR' && { backgroundColor: langBtnActiveBg }]}
                activeOpacity={0.7}
                onPress={() => handleLangChange('TR')}
              >
                {language === 'TR' && <Check size={14} color="#FFF" strokeWidth={3} />}
                <Text style={styles.langFlag}>🇹🇷</Text>
                <Text style={[styles.langBtnText, { color: textSecondary }, language === 'TR' && styles.langBtnTextActive]}>TR</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.langBtn, { backgroundColor: langBtnBg }, language === 'EN' && { backgroundColor: langBtnActiveBg }]}
                activeOpacity={0.7}
                onPress={() => handleLangChange('EN')}
              >
                {language === 'EN' && <Check size={14} color="#FFF" strokeWidth={3} />}
                <Text style={styles.langFlag}>🇬🇧</Text>
                <Text style={[styles.langBtnText, { color: textSecondary }, language === 'EN' && styles.langBtnTextActive]}>EN</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8, backgroundColor: footerBg, borderTopColor: dividerColor }]}>
          <TouchableOpacity
            style={styles.logoutRow}
            onPress={handleLogout}
            activeOpacity={0.6}
            testID="menu-logout"
          >
            <LogOut size={18} color="#FF3B30" strokeWidth={2} />
            <Text style={styles.logoutText}>{t('logout')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  phoneFrame: {
    flex: 1,
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center' as const,
    overflow: 'hidden' as const,
  },
  phoneFrameFloating: {
    borderRadius: 30,
    marginVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17, 24, 39, 0.08)',
    shadowColor: '#0F172A',
    shadowOffset: {
      width: 0,
      height: 12,
    },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 14,
  },
  inner: {
    flex: 1,
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 20,
    marginLeft: -6,
  },
  greeting: {
    fontSize: 15,
    fontWeight: '400' as const,
    marginBottom: 4,
  },
  userName: {
    fontSize: 26,
    fontWeight: '800' as const,
    letterSpacing: -0.4,
  },
  menuScroll: {
    flex: 1,
  },
  menuScrollContent: {
    paddingTop: 16,
  },
  menuList: {
    paddingHorizontal: 8,
  },
  menuItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 16,
  },
  menuLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500' as const,
  },
  menuItemAccent: {
    backgroundColor: '#FFF8ED',
    borderRadius: 12,
    marginHorizontal: -4,
    paddingHorizontal: 18,
  },
  menuLabelAccent: {
    color: '#F5A623',
    fontWeight: '600' as const,
  },
  cardsRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: 16,
    marginTop: 16,
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
    color: '#C9B8FF',
    marginTop: 8,
  },
  miniCardTitle: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    lineHeight: 20,
    marginTop: 4,
  },
  miniCardDesc: {
    fontSize: 11,
    fontWeight: '400' as const,
    color: '#D4C4FF',
    lineHeight: 15,
    marginTop: 2,
  },
  miniCardLink: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#F5A623',
    textDecorationLine: 'underline' as const,
    marginTop: 6,
  },
  themeSection: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '500' as const,
    marginBottom: 12,
  },
  themeToggleBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
  },
  themeToggleText: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
  langSection: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  langRow: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  langBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
  langBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  langBtnTextActive: {
    color: '#FFFFFF',
  },
  langFlag: {
    fontSize: 16,
  },
  footer: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  logoutRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 4,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#FF3B30',
  },
});

