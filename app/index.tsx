import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, StatusBar, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Car, Wine, ArrowRight, ShieldCheck } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/colors';
import { APP_BRAND } from '@/constants/branding';
import { ScalePressable } from '@/components/ScalePressable';
import { useAuth } from '@/contexts/AuthContext';
import { androidTextFix, crossPlatformShadow } from '@/utils/platform';

const ONBOARDING_KEY = 'onboarding_completed';

export default function WelcomeScreen() {
  const router = useRouter();
  const { user, userType, isLoading } = useAuth();
  const { width, height } = useWindowDimensions();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const buttonFade = useRef(new Animated.Value(0)).current;


  const isSmall = width < 360;
  const isTablet = width >= 600;
  const scale = Math.min(width / 375, height / 812, 1.3);

  const [onboardingChecked, setOnboardingChecked] = useState<boolean>(false);

  useEffect(() => {
    if (isLoading) return;

    if (user) {
      if (userType === 'customer') {
        router.replace('/(customer-tabs)/dashboard');
      } else if (userType === 'driver') {
        router.replace('/(driver-tabs)/map');
      }
      return;
    }

    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((val) => {
        if (val !== 'true') {
          console.log('[Onboarding] Not completed, redirecting...');
          router.replace('/onboarding');
        } else {
          setOnboardingChecked(true);
        }
      })
      .catch(() => setOnboardingChecked(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user, userType]);

  useEffect(() => {
    if (onboardingChecked) {
      Animated.sequence([
        Animated.parallel([
          Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(slideAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
        ]),
        Animated.timing(buttonFade, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingChecked]);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      </View>
    );
  }

  if (user) return null;

  const iconSize = Math.round(isSmall ? 22 : isTablet ? 34 : 28 * scale);
  const bubbleSize = Math.round(isSmall ? 48 : isTablet ? 72 : 60 * scale);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <View style={styles.bgPattern}>
        {Array.from({ length: 6 }).map((_, i) => {
          const circleSize = (120 + i * 30) * scale;
          const topPos = ((15 + i * 15) / 100) * height;
          const leftPos = (((i % 2 === 0 ? 10 : 60) + i * 5) / 100) * width;
          return (
            <View key={i} style={[styles.bgCircle, {
              top: topPos,
              left: leftPos,
              opacity: 0.03 + i * 0.01,
              width: circleSize,
              height: circleSize,
            }]} />
          );
        })}
      </View>
      <SafeAreaView style={[styles.safeArea, { paddingHorizontal: isSmall ? 20 : isTablet ? 48 : 28 }]}>
        <Animated.View style={[styles.heroSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={[styles.iconRow, { marginBottom: Math.round(24 * scale) }]}>
            <View style={[styles.iconBubble, { width: bubbleSize, height: bubbleSize, borderRadius: Math.round(bubbleSize / 3) }]}>
              <Wine size={iconSize} color={Colors.dark.primary} />
            </View>
            <View style={[styles.iconConnector, { width: Math.round(24 * scale) }]} />
            <View style={[styles.iconBubble, styles.iconBubbleAccent, { width: bubbleSize, height: bubbleSize, borderRadius: Math.round(bubbleSize / 3) }]}>
              <Car size={iconSize} color="#FFF" />
            </View>
          </View>
          <Text style={[styles.brand, { fontSize: Math.round(isSmall ? 34 : isTablet ? 56 : 42) }]}>{APP_BRAND}</Text>
          <Text style={[styles.tagline, { fontSize: Math.round(isSmall ? 15 : isTablet ? 22 : 18) }]}>Güvenli ve hızlı ulaşım</Text>
          <Text style={[styles.description, { fontSize: Math.round(isSmall ? 13 : isTablet ? 17 : 15), maxWidth: isTablet ? 420 : width * 0.8 }]}>
            Alkol aldığınızda dahi nereye gitmek isterseniz, 2GO ile güvenle gidin. Profesyonel şoförlerimiz sizi kendi aracınız ile istediğiniz yere sürpriz ücret olmadan ulaştırsın.
          </Text>
        </Animated.View>
        <Animated.View style={[styles.bottomSection, { opacity: buttonFade, maxWidth: isTablet ? 420 : undefined, alignSelf: isTablet ? 'center' as const : undefined, width: isTablet ? '100%' as unknown as number : undefined }]}>
          <ScalePressable
            style={[styles.primaryButton, { paddingVertical: isSmall ? 14 : 18, borderRadius: isSmall ? 12 : 16 }]}
            onPress={() => router.push('/login')}
            pressedScale={0.985}
            pressedOpacity={0.96}
            testID="login-button"
          >
            <Text style={[styles.primaryButtonText, { fontSize: isSmall ? 15 : 17 }]}>Giriş Yap</Text>
            <ArrowRight size={isSmall ? 18 : 20} color={Colors.dark.background} />
          </ScalePressable>
          <View style={styles.registerRow}>
            <ScalePressable
              style={[styles.registerButton, { paddingVertical: isSmall ? 10 : 14, paddingHorizontal: isSmall ? 16 : 24 }]}
              onPress={() => router.push('/register-customer')}
              pressedScale={0.98}
              pressedOpacity={0.78}
              testID="register-customer-button"
            >
              <Text style={[styles.registerButtonText, { fontSize: isSmall ? 13 : 15 }]}>Müşteri Kaydı</Text>
            </ScalePressable>
            <View style={styles.registerDivider} />
            <ScalePressable
              style={[styles.registerButton, { paddingVertical: isSmall ? 10 : 14, paddingHorizontal: isSmall ? 16 : 24 }]}
              onPress={() => router.push('/register-driver')}
              pressedScale={0.98}
              pressedOpacity={0.78}
              testID="register-driver-button"
            >
              <Text style={[styles.registerButtonText, { fontSize: isSmall ? 13 : 15 }]}>Şoför Kaydı</Text>
            </ScalePressable>
          </View>
          <ScalePressable
            style={styles.statusButton}
            onPress={() => router.push('/system-status')}
            pressedScale={0.98}
            pressedOpacity={0.84}
            testID="system-status-button"
          >
            <ShieldCheck size={16} color={Colors.dark.primary} />
            <Text style={styles.statusButtonText}>Canlı Durumu Gör</Text>
          </ScalePressable>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  bgPattern: {
    ...StyleSheet.absoluteFillObject,
  },
  bgCircle: {
    position: 'absolute' as const,
    borderRadius: 999,
    backgroundColor: Colors.dark.primary,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  heroSection: {
    flex: 1,
    justifyContent: 'center',
  },
  iconRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  iconBubble: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    ...crossPlatformShadow({
      color: Colors.dark.primary,
      offsetY: 6,
      opacity: 0.14,
      radius: 12,
      elevation: 4,
    }),
  },
  iconBubbleAccent: {
    backgroundColor: Colors.dark.primary,
    ...crossPlatformShadow({
      color: Colors.dark.primary,
      offsetY: 10,
      opacity: 0.28,
      radius: 16,
      elevation: 8,
    }),
  },
  iconConnector: {
    height: 2,
    backgroundColor: Colors.dark.cardBorder,
    marginHorizontal: 8,
  },
  brand: {
    fontWeight: '800' as const,
    color: Colors.dark.text,
    letterSpacing: -1,
    ...androidTextFix({ fontWeight: '800' }),
  },
  tagline: {
    color: Colors.dark.primary,
    fontWeight: '600' as const,
    marginTop: 4,
    ...androidTextFix({ fontWeight: '600' }),
  },
  description: {
    color: Colors.dark.textSecondary,
    lineHeight: 22,
    marginTop: 16,
    ...androidTextFix({ lineHeight: 22 }),
  },
  bottomSection: {
    paddingBottom: 16,
    gap: 16,
  },
  primaryButton: {
    backgroundColor: Colors.dark.primary,
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 8,
    ...crossPlatformShadow({
      color: Colors.dark.primary,
      offsetY: 10,
      opacity: 0.26,
      radius: 16,
      elevation: 8,
    }),
  },
  primaryButtonText: {
    fontWeight: '700' as const,
    color: Colors.dark.background,
    ...androidTextFix({ fontWeight: '700' }),
  },
  registerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  registerButton: {},
  registerButtonText: {
    color: Colors.dark.textSecondary,
    fontWeight: '600' as const,
    ...androidTextFix({ fontWeight: '600' }),
  },
  registerDivider: {
    width: 1,
    height: 20,
    backgroundColor: Colors.dark.cardBorder,
  },
  statusButton: {
    alignSelf: 'center' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.dark.cardBorder,
    backgroundColor: 'rgba(255,255,255,0.03)',
    ...crossPlatformShadow({
      color: '#000',
      offsetY: 6,
      opacity: 0.12,
      radius: 10,
      elevation: 4,
    }),
  },
  statusButtonText: {
    color: Colors.dark.primary,
    fontSize: 13,
    fontWeight: '700' as const,
    ...androidTextFix({ fontWeight: '700' }),
  },

});
