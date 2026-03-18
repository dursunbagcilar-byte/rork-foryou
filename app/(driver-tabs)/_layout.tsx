import { useEffect, useRef, useState } from 'react';
import { Tabs } from 'expo-router';
import { Map, Wallet, User, Clock, ShieldCheck, FileText, X, PartyPopper, CheckCircle2 } from 'lucide-react-native';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useNotifications } from '@/hooks/useNotifications';
import { androidTextFix, crossPlatformShadow, isAndroid } from '@/utils/platform';
import * as Haptics from 'expo-haptics';
import { useMounted } from '@/hooks/useMounted';

function DriverApprovalWaiting({ onDismiss }: { onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[waitStyles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <TouchableOpacity style={[waitStyles.closeButton, { top: insets.top + 12 }]} onPress={onDismiss} activeOpacity={0.7}>
        <X size={22} color={Colors.dark.textSecondary} />
      </TouchableOpacity>
      <Animated.View style={[waitStyles.content, { opacity: fadeAnim }]}>
        <Animated.View style={[waitStyles.iconRing, { transform: [{ scale: pulseAnim }] }]}>
          <Animated.View style={[waitStyles.spinnerRing, { transform: [{ rotate: spin }] }]} />
          <View style={waitStyles.iconInner}>
            <Clock size={40} color={Colors.dark.primary} />
          </View>
        </Animated.View>

        <Text style={waitStyles.title}>Hesabınız İnceleniyor</Text>
        <Text style={waitStyles.subtitle}>
          Şoför hesabınız yönetici onayı bekliyor. Onaylandığında otomatik olarak aktif olacaktır.
        </Text>

        <View style={waitStyles.stepsContainer}>
          <View style={waitStyles.stepRow}>
            <View style={[waitStyles.stepIcon, waitStyles.stepDone]}>
              <ShieldCheck size={18} color={Colors.dark.background} />
            </View>
            <View style={waitStyles.stepTextWrap}>
              <Text style={waitStyles.stepTitle}>Kayıt Tamamlandı</Text>
              <Text style={waitStyles.stepDesc}>Hesabınız başarıyla oluşturuldu</Text>
            </View>
          </View>
          <View style={waitStyles.stepLine} />
          <View style={waitStyles.stepRow}>
            <View style={[waitStyles.stepIcon, waitStyles.stepDone]}>
              <FileText size={18} color={Colors.dark.background} />
            </View>
            <View style={waitStyles.stepTextWrap}>
              <Text style={waitStyles.stepTitle}>Belgeler Yüklendi</Text>
              <Text style={waitStyles.stepDesc}>Belgeleriniz incelemeye alındı</Text>
            </View>
          </View>
          <View style={waitStyles.stepLine} />
          <View style={waitStyles.stepRow}>
            <View style={[waitStyles.stepIcon, waitStyles.stepPending]}>
              <Clock size={18} color={Colors.dark.primary} />
            </View>
            <View style={waitStyles.stepTextWrap}>
              <Text style={waitStyles.stepTitle}>Yönetici Onayı</Text>
              <Text style={[waitStyles.stepDesc, { color: Colors.dark.primary }]}>Bekleniyor...</Text>
            </View>
          </View>
        </View>

        <View style={waitStyles.infoBox}>
          <Text style={waitStyles.infoText}>
            Onay işlemi genellikle kısa sürede tamamlanır. Onaylandığında bu ekran otomatik olarak kapanacaktır.
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

const waitStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.dark.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    zIndex: 100,
  },
  content: {
    alignItems: 'center',
    width: '100%',
  },
  iconRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
  },
  spinnerRing: {
    position: 'absolute' as const,
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: 'transparent',
    borderTopColor: Colors.dark.primary,
    borderRightColor: Colors.dark.primaryDark,
  },
  iconInner: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.dark.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.dark.text,
    marginBottom: 10,
    textAlign: 'center' as const,
    ...androidTextFix({ fontWeight: '700' }),
  },
  subtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: 'center' as const,
    marginBottom: 32,
    paddingHorizontal: 8,
    ...androidTextFix({ lineHeight: 20 }),
  },
  stepsContainer: {
    width: '100%',
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  stepRow: {
    flexDirection: 'row' as const,
    alignItems: 'center',
  },
  stepIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  stepDone: {
    backgroundColor: Colors.dark.success,
  },
  stepPending: {
    backgroundColor: Colors.dark.card,
    borderWidth: 2,
    borderColor: Colors.dark.primary,
  },
  stepTextWrap: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.dark.text,
    ...androidTextFix({ fontWeight: '600' }),
  },
  stepDesc: {
    fontSize: 12,
    color: Colors.dark.textMuted,
    marginTop: 2,
    ...androidTextFix({ lineHeight: 16 }),
  },
  stepLine: {
    width: 2,
    height: 20,
    backgroundColor: Colors.dark.cardBorder,
    marginLeft: 17,
    marginVertical: 4,
  },
  infoBox: {
    width: '100%',
    backgroundColor: 'rgba(245, 166, 35, 0.1)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.2)',
  },
  infoText: {
    fontSize: 13,
    color: Colors.dark.primary,
    textAlign: 'center' as const,
    ...androidTextFix({ lineHeight: 18 }),
  },
  closeButton: {
    position: 'absolute' as const,
    right: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.dark.card,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.dark.cardBorder,
  },
});

function ApprovalSuccessOverlay({ onFinish }: { onFinish: () => void }) {
  const insets = useSafeAreaInsets();
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const confettiAnim = useRef(new Animated.Value(0)).current;
  const checkAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    Animated.sequence([
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 4,
          tension: 60,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(checkAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.back(1.5)),
        useNativeDriver: true,
      }),
      Animated.timing(confettiAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(onFinish, 3500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[successStyles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Animated.View style={[successStyles.content, { opacity: opacityAnim, transform: [{ scale: scaleAnim }] }]}>
        <View style={successStyles.iconWrap}>
          <Animated.View style={[successStyles.checkCircle, { transform: [{ scale: checkAnim }] }]}>
            <CheckCircle2 size={56} color="#fff" />
          </Animated.View>
        </View>

        <Animated.View style={{ opacity: confettiAnim }}>
          <Text style={successStyles.title}>Hesabınız Açıldı! 🎉</Text>
          <Text style={successStyles.subtitle}>Tebrikler! Artık yolculuk alabilirsiniz.{"\n"}Bol kazançlar dileriz!</Text>
        </Animated.View>

        <Animated.View style={[successStyles.badge, { opacity: confettiAnim, transform: [{ scale: confettiAnim }] }]}>
          <PartyPopper size={20} color={Colors.dark.primary} />
          <Text style={successStyles.badgeText}>Aktif Şoför</Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const successStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.dark.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    zIndex: 200,
  },
  content: {
    alignItems: 'center',
    width: '100%',
  },
  iconWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.dark.success,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
    shadowColor: Colors.dark.success,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  checkCircle: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: Colors.dark.text,
    textAlign: 'center' as const,
    marginBottom: 12,
    ...androidTextFix({ fontWeight: '800' }),
  },
  subtitle: {
    fontSize: 15,
    color: Colors.dark.textSecondary,
    textAlign: 'center' as const,
    marginBottom: 28,
    paddingHorizontal: 12,
    ...androidTextFix({ lineHeight: 22 }),
  },
  badge: {
    flexDirection: 'row' as const,
    alignItems: 'center',
    backgroundColor: 'rgba(245, 166, 35, 0.15)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.3)',
    gap: 8,
  },
  badgeText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.dark.primary,
    ...androidTextFix({ fontWeight: '700' }),
  },
});

const styles = StyleSheet.create({
  overlayHost: {
    ...StyleSheet.absoluteFillObject,
  },
});

export default function DriverTabsLayout() {
  const { user, driverApproved } = useAuth();
  const { colors } = useTheme();
  const mounted = useMounted();
  const { scheduleEveningNotifications } = useNotifications(user?.id ?? null);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState<boolean>(false);
  const prevApprovedRef = useRef<boolean>(false);
  const [dismissedApproval, setDismissedApproval] = useState<boolean>(false);

  useEffect(() => {
    if (user?.id) {
      void scheduleEveningNotifications();
      console.log('[DriverTabs] Push notifications initialized for driver:', user.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (driverApproved && !prevApprovedRef.current) {
      console.log('[DriverTabs] Driver just got approved, showing success overlay');
      setShowSuccessOverlay(true);
      setDismissedApproval(true);
    }
    prevApprovedRef.current = driverApproved;
  }, [driverApproved]);

  const driver = user?.type === 'driver' ? user as any : null;
  const localApproved = driver?.isApproved === true;
  const showWaiting = user?.type === 'driver' && !driverApproved && !localApproved && !dismissedApproval;
  const overlaysReady = Platform.OS !== 'web' || mounted;
  const showSuccessOverlayHost = overlaysReady && showSuccessOverlay;
  const showWaitingOverlayHost = overlaysReady && showWaiting && !showSuccessOverlay;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarHideOnKeyboard: true,
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopColor: colors.cardBorder,
            borderTopWidth: isAndroid ? 0 : 1,
            ...crossPlatformShadow({
              color: '#000',
              offsetY: -2,
              opacity: isAndroid ? 0.18 : 0.08,
              radius: 10,
              elevation: 12,
            }),
          },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarItemStyle: {
            paddingTop: isAndroid ? 4 : 0,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600' as const,
            ...androidTextFix({ lineHeight: 13, fontWeight: '600' }),
          },
        }}
      >
        <Tabs.Screen
          name="map"
          options={{
            title: 'Harita',
            tabBarIcon: ({ color, size }) => <Map size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="earnings"
          options={{
            title: 'Kazanç',
            tabBarIcon: ({ color, size }) => <Wallet size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profil',
            tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
          }}
        />
      </Tabs>

      <View style={[styles.overlayHost, { display: showSuccessOverlayHost ? 'flex' : 'none' }]} pointerEvents={showSuccessOverlayHost ? 'auto' : 'none'}>
        {showSuccessOverlayHost ? (
          <ApprovalSuccessOverlay
            key="driver-approval-success-overlay"
            onFinish={() => setShowSuccessOverlay(false)}
          />
        ) : null}
      </View>

      <View style={[styles.overlayHost, { display: showWaitingOverlayHost ? 'flex' : 'none' }]} pointerEvents={showWaitingOverlayHost ? 'auto' : 'none'}>
        {showWaitingOverlayHost ? (
          <DriverApprovalWaiting
            key="driver-approval-waiting-overlay"
            onDismiss={() => setDismissedApproval(true)}
          />
        ) : null}
      </View>
    </View>
  );
}

