import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  useWindowDimensions, StatusBar, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ArrowRight, Sparkles } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { APP_BRAND } from '@/constants/branding';

const ONBOARDING_KEY = 'onboarding_completed';

interface OnboardingSlide {
  image: string;
  title: string;
  subtitle: string;
}

const GOLD = '#C8A14E';

const SLIDES: OnboardingSlide[] = [
  {
    image: 'https://r2-pub.rork.com/generated-images/b4ece679-ee71-4bea-9a1d-607c1b74970a.png',
    title: 'Aracın ve Sen Güvenle Evine',
    subtitle: 'Profesyonel şoförlerimiz seni ve aracını güvenle evine ulaştırır.',
  },
  {
    image: 'https://r2-pub.rork.com/generated-images/64981397-299b-4c86-a8ae-ba1136c365e7.png',
    title: 'Anlık Konum Takibi',
    subtitle: 'Aracının nerede olduğunu gerçek zamanlı haritada takip et.',
  },
  {
    image: 'https://r2-pub.rork.com/generated-images/2373bed2-6f4e-454a-a1c3-ae92f311bca3.png',
    title: 'Sevdiklerine Konum Gönder',
    subtitle: 'Yakınlarınla konumunu paylaş, içleri rahat olsun.',
  },
  {
    image: 'https://r2-pub.rork.com/generated-images/5853c818-691c-4867-aa3c-c38fe7db543d.png',
    title: '2GO Her Zaman Yanında',
    subtitle: 'Gece geç mi kaldın? Bir dokunuşla şoförün kapında.',
  },
];

export default function OnboardingScreen() {
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState<number>(0);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const imageScale = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: (currentIndex + 1) / SLIDES.length,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [currentIndex, progressAnim]);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(imageScale, { toValue: 1.03, duration: 8000, useNativeDriver: true }),
        Animated.timing(imageScale, { toValue: 1, duration: 8000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [imageScale]);

  const animateTransition = useCallback((nextIndex: number) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 30, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      setCurrentIndex(nextIndex);
      slideAnim.setValue(-30);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 50, friction: 10, useNativeDriver: true }),
      ]).start();
    });
  }, [fadeAnim, slideAnim]);

  const handleFinish = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    router.replace('/');
  }, [router]);

  const handleNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (currentIndex < SLIDES.length - 1) {
      animateTransition(currentIndex + 1);
    } else {
      void handleFinish();
    }
  }, [currentIndex, animateTransition, handleFinish]);

  const handleSkip = useCallback(() => {
    void handleFinish();
  }, [handleFinish]);

  const slide = SLIDES[currentIndex];
  const isLast = currentIndex === SLIDES.length - 1;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <Animated.View style={[StyleSheet.absoluteFillObject, { transform: [{ scale: imageScale }] }]}>
        <Image
          source={{ uri: slide.image }}
          style={[StyleSheet.absoluteFillObject, { width, height }]}
          resizeMode="cover"
          testID="onboarding-image"
        />
      </Animated.View>

      <LinearGradient
        colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.02)', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.92)']}
        locations={[0, 0.3, 0.6, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topRow}>
          <View style={styles.brandRow}>
            <Text style={styles.brandText}>{APP_BRAND}</Text>
          </View>
          <TouchableOpacity
            onPress={handleSkip}
            style={[styles.skipBtn, { display: isLast ? 'none' : 'flex' }]}
            activeOpacity={0.7}
          >
            <Text style={styles.skipText}>Atla</Text>
          </TouchableOpacity>
          <View style={{ width: 60, display: isLast ? 'flex' : 'none' }} />
        </View>

        <View style={styles.spacer} />

        <Animated.View
          style={[
            styles.bottomContent,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <Text style={styles.slideTitle}>{slide.title}</Text>
          <Text style={styles.slideSubtitle}>{slide.subtitle}</Text>
        </Animated.View>

        <View style={styles.controlsSection}>
          <View style={styles.progressRow}>
            {SLIDES.map((_, i) => (
              <View key={i} style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    i < currentIndex && styles.progressComplete,
                    i === currentIndex && styles.progressActive,
                  ]}
                />
              </View>
            ))}
          </View>

          <TouchableOpacity
            onPress={handleNext}
            activeOpacity={0.85}
            testID="onboarding-next"
            style={styles.nextBtnWrapper}
          >
            <LinearGradient
              colors={['#C8A14E', '#A8863A']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.nextBtn}
            >
              <Text style={styles.nextBtnText}>{isLast ? 'Başla' : 'Devam'}</Text>
              <View style={{ display: isLast ? 'flex' : 'none' }}>
                <Sparkles size={18} color="#FFF" strokeWidth={2} />
              </View>
              <View style={{ display: isLast ? 'none' : 'flex' }}>
                <ArrowRight size={18} color="#FFF" strokeWidth={2} />
              </View>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  safeArea: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingTop: 8,
    paddingHorizontal: 24,
  },
  brandRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  brandText: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: 3,
    includeFontPadding: false,
  },
  skipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  skipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.8)',
    letterSpacing: 0.5,
  },
  spacer: {
    flex: 1,
  },
  bottomContent: {
    paddingHorizontal: 28,
    marginBottom: 24,
  },
  slideTitle: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    marginBottom: 10,
    letterSpacing: 0.3,
    includeFontPadding: false,
  },
  slideSubtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 22,
    fontWeight: '400' as const,
    includeFontPadding: false,
  },
  controlsSection: {
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 20,
  },
  progressRow: {
    flexDirection: 'row' as const,
    gap: 6,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden' as const,
  },
  progressFill: {
    height: '100%' as unknown as number,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  progressComplete: {
    backgroundColor: GOLD,
    width: '100%' as unknown as number,
  },
  progressActive: {
    backgroundColor: GOLD,
    width: '100%' as unknown as number,
  },
  nextBtnWrapper: {
    borderRadius: 14,
    overflow: 'hidden' as const,
  },
  nextBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    paddingVertical: 18,
  },
  nextBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    letterSpacing: 0.5,
    includeFontPadding: false,
  },
});

