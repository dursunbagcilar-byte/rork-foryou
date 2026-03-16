import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, CheckCircle, Star, Car, CloudRain } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/contexts/AuthContext';
import { getCityByName } from '@/constants/cities';
import { useWeather } from '@/hooks/useWeather';

export default function VehicleSelectScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const userCity = user?.city ? getCityByName(user.city) : null;
  const { isRainy, weather } = useWeather(userCity?.latitude, userCity?.longitude);
  const [selectedPackage, setSelectedPackage] = useState<string>('car');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scooterAnim = useRef(new Animated.Value(0)).current;
  const carAnim = useRef(new Animated.Value(0)).current;
  const motoAnim = useRef(new Animated.Value(0)).current;
  const btnAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(100, [
      Animated.spring(fadeAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 10 }),
      Animated.spring(scooterAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 10 }),
      Animated.spring(carAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 10 }),
      Animated.spring(motoAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 10 }),
      Animated.spring(btnAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 10 }),
    ]).start();
  }, [btnAnim, carAnim, fadeAnim, motoAnim, scooterAnim]);

  const isWeatherRestricted = useCallback((pkg: string) => {
    return isRainy && (pkg === 'scooter' || pkg === 'motorcycle');
  }, [isRainy]);

  const handleSelect = useCallback((pkg: string) => {
    if (isWeatherRestricted(pkg)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      console.log('[VehicleSelect] Blocked due to weather:', pkg);
      return;
    }
    setSelectedPackage(pkg);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    console.log('[VehicleSelect] Selected:', pkg);
  }, [isWeatherRestricted]);

  const handleConfirm = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    console.log('[VehicleSelect] Confirmed:', selectedPackage);
    router.navigate({
      pathname: '/(customer-tabs)/dashboard' as any,
      params: { vehiclePackage: selectedPackage, openSearch: '1' },
    });
  }, [selectedPackage, router]);

  const getCardAnim = (pkg: string) => {
    if (pkg === 'scooter') return scooterAnim;
    if (pkg === 'car') return carAnim;
    return motoAnim;
  };

  return (
    <View style={styles.container}>
      <View style={styles.topGradient} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <ChevronLeft size={24} color="#1A1A2E" />
          </TouchableOpacity>
          <View style={styles.headerBrand}>
            <Car size={18} color="#2ECC71" strokeWidth={2.5} />
            <Text style={styles.headerBrandText}>2GO</Text>
          </View>
          <View style={styles.backBtn} />
        </View>

        <Animated.View style={[styles.titleSection, { opacity: fadeAnim, transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>
          <Text style={styles.title}>Şoförünüz Hangi</Text>
          <Text style={styles.title}>Pakette Gelsin?</Text>
          <Text style={styles.subtitle}>Size en uygun seçeneği belirleyin</Text>
          {isRainy && weather && (
            <View style={styles.weatherBanner}>
              <CloudRain size={16} color="#E74C3C" />
              <Text style={styles.weatherBannerText}>
                {user?.city ?? 'Şehriniz'} — {weather.description} ({weather.temperature}°C). Motor ve E-Scooter hizmeti kullanılamaz.
              </Text>
            </View>
          )}
        </Animated.View>

        <View style={styles.cardsRow}>
          {(['scooter', 'car', 'motorcycle'] as const).map((pkg) => {
            const anim = getCardAnim(pkg);
            const isSelected = selectedPackage === pkg;
            const config = pkg === 'scooter'
              ? { emoji: '🛴', name: 'Ekonomik', type: 'E-Scooter', color: '#2ECC71', pill: 'Uygun fiyat', bg: 'rgba(46,204,113,0.1)', pillBg: 'rgba(46,204,113,0.12)' }
              : pkg === 'car'
              ? { emoji: '🚗', name: 'Premium', type: 'Otomobil', color: Colors.dark.primary, pill: 'Konforlu', bg: 'rgba(245,166,35,0.1)', pillBg: 'rgba(245,166,35,0.12)' }
              : { emoji: '🏍️', name: 'Gayet Uygun', type: 'Motorsiklet', color: '#3498DB', pill: 'Hızlı', bg: 'rgba(52,152,219,0.1)', pillBg: 'rgba(52,152,219,0.12)' };

            return (
              <Animated.View
                key={pkg}
                style={[
                  styles.cardWrap,
                  pkg === 'car' && styles.cardWrapMain,
                  {
                    opacity: anim,
                    transform: [{
                      translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }),
                    }],
                  },
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.card,
                    pkg === 'car' && styles.cardMain,
                    isSelected && styles.cardActive,
                    isSelected && { borderColor: config.color },
                    isWeatherRestricted(pkg) && styles.cardDisabled,
                  ]}
                  onPress={() => handleSelect(pkg)}
                  activeOpacity={isWeatherRestricted(pkg) ? 1 : 0.85}
                  testID={`vehicle-${pkg}`}
                >
                  {isWeatherRestricted(pkg) && (
                    <View style={styles.weatherOverlay}>
                      <CloudRain size={20} color="#FFF" />
                      <Text style={styles.weatherOverlayText}>Yağışlı</Text>
                    </View>
                  )}
                  {isSelected && !isWeatherRestricted(pkg) && (
                    <View style={[styles.checkMark, { backgroundColor: config.color }]}>
                      <CheckCircle size={14} color="#FFF" />
                    </View>
                  )}
                  {pkg === 'car' && (
                    <View style={styles.recommendBadge}>
                      <Star size={10} color="#F5A623" fill="#F5A623" />
                      <Text style={styles.recommendText}>Önerilen</Text>
                    </View>
                  )}
                  <View style={[
                    styles.iconCircle,
                    pkg === 'car' && styles.iconCircleLg,
                    { backgroundColor: config.bg },
                    isWeatherRestricted(pkg) && { opacity: 0.35 },
                  ]}>
                    <Text style={pkg === 'car' ? styles.emojiLg : styles.emoji}>{config.emoji}</Text>
                  </View>
                  <Text style={[styles.pkgName, pkg === 'car' && styles.pkgNameLg, isWeatherRestricted(pkg) && { opacity: 0.35 }]}>{config.name}</Text>
                  <Text style={[styles.typeLabel, isWeatherRestricted(pkg) && { opacity: 0.35 }]}>{config.type}</Text>
                  <View style={[styles.pill, { backgroundColor: isWeatherRestricted(pkg) ? 'rgba(231,76,60,0.12)' : config.pillBg }]}>
                    <Text style={[styles.pillText, { color: isWeatherRestricted(pkg) ? '#E74C3C' : config.color }]}>
                      {isWeatherRestricted(pkg) ? 'Kullanılamaz' : config.pill}
                    </Text>
                  </View>
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>

        <Animated.View style={[styles.bottomSection, { opacity: btnAnim, transform: [{ translateY: btnAnim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }] }]}>
          <TouchableOpacity
            style={styles.confirmBtn}
            onPress={handleConfirm}
            activeOpacity={0.85}
            testID="vehicle-confirm"
          >
            <Text style={styles.confirmText}>
              {selectedPackage === 'scooter' ? 'E-Scooter ile Devam Et' :
               selectedPackage === 'car' ? 'Otomobil ile Devam Et' :
               'Motorsiklet ile Devam Et'}
            </Text>
          </TouchableOpacity>
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
  topGradient: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    height: 220,
    backgroundColor: '#F8FBF9',
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#F2F2F5',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  headerBrand: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  headerBrandText: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: '#1A1A2E',
  },
  titleSection: {
    paddingHorizontal: 24,
    marginTop: 20,
    marginBottom: 36,
  },
  title: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: '#1A1A2E',
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 8,
  },
  cardsRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: 16,
    gap: 10,
    alignItems: 'flex-end' as const,
  },
  cardWrap: {
    flex: 1,
  },
  cardWrapMain: {
    flex: 1.15,
  },
  card: {
    backgroundColor: '#FAFAFA',
    borderRadius: 20,
    padding: 14,
    alignItems: 'center' as const,
    borderWidth: 2.5,
    borderColor: 'transparent',
    position: 'relative' as const,
  },
  cardMain: {
    paddingVertical: 20,
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  cardActive: {
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
  checkMark: {
    position: 'absolute' as const,
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 2,
  },
  recommendBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: '#FFF8E7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 8,
  },
  recommendText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: '#F5A623',
    letterSpacing: 0.5,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 10,
  },
  iconCircleLg: {
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  emoji: {
    fontSize: 32,
  },
  emojiLg: {
    fontSize: 40,
  },
  pkgName: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: '#1A1A2E',
    marginBottom: 2,
    textAlign: 'center' as const,
  },
  pkgNameLg: {
    fontSize: 15,
  },
  typeLabel: {
    fontSize: 11,
    color: '#999',
    marginBottom: 8,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  bottomSection: {
    flex: 1,
    justifyContent: 'flex-end' as const,
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  confirmBtn: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center' as const,
  },
  confirmText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  cardDisabled: {
    opacity: 0.6,
    borderColor: 'rgba(231,76,60,0.3)',
    backgroundColor: '#F9F0F0',
  },
  weatherOverlay: {
    position: 'absolute' as const,
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
    backgroundColor: 'rgba(231,76,60,0.85)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    zIndex: 3,
  },
  weatherOverlayText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  weatherBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: '#FFF0F0',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(231,76,60,0.15)',
  },
  weatherBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#C0392B',
    lineHeight: 17,
  },
});
