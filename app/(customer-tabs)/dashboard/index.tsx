import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Image,
  Animated, Platform, ActivityIndicator, Alert, Linking,
  KeyboardAvoidingView, ScrollView, Keyboard, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import WebMapFallback from '@/components/WebMapFallback';
import type { WebMapMarker, WebMapPolyline } from '@/components/WebMapFallback';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MapPin, Navigation, Search, X, Clock, Banknote, Gift, ChevronRight, ChevronLeft, Car, Phone, MessageCircle, Star, Send, AlertTriangle, Share2, FileText, Shield, Bike, Package, Plus, Minus, CheckCircle, Store, Camera, ImagePlus, Edit3, MapPinned, CreditCard, Menu, CloudRain, Bird, ArrowUpDown } from 'lucide-react-native';

import * as WebBrowser from 'expo-web-browser';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '@/constants/colors';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/contexts/AuthContext';
import { useRideForOthers, type RideForOtherPaymentMode, type RideRecipient } from '@/contexts/RideForOthersContext';
import { useLocation } from '@/hooks/useLocation';
import { buildApiUrl, trpc, trpcClient } from '@/lib/trpc';
import { ISTANBUL_REGION, findBestAlternativeVehicle, getVehicleTypeLabel } from '@/constants/mockData';
import type { Driver, MockDriverInfo } from '@/constants/mockData';
import { getCityByName, getCityRegion } from '@/constants/cities';
import {
  calculatePrice,
  calculateDistance,
  estimateDuration,
  POPULAR_DESTINATIONS,
  PRICING,
} from '@/constants/pricing';
import type { DestinationOption, VehicleType } from '@/constants/pricing';
import { usePlacesAutocomplete } from '@/hooks/usePlacesAutocomplete';
import { getNightlifeVenuesByCity } from '@/constants/nightlifeVenues';
import { useVenuePhotos } from '@/hooks/useVenuePhotos';
import { getCourierBusinessesByCity } from '@/constants/courierBusinesses';
import type { CourierBusiness, CourierMenuItem } from '@/constants/courierBusinesses';
import { useWeather } from '@/hooks/useWeather';
import { getGoogleMapsApiKey, getDirectionsApiUrl, logMapsKeyStatus } from '@/utils/maps';
import TrendingMusicPlayer from '@/components/TrendingMusicPlayer';

const GOOGLE_API_KEY = getGoogleMapsApiKey();
const DIRECTIONS_API_URL = getDirectionsApiUrl();

if (Platform.OS === 'web') {
  logMapsKeyStatus();
}

interface CartItem {
  menuItem: CourierMenuItem;
  quantity: number;
}

interface RoutePickerRecentItem {
  id: string;
  title: string;
  subtitle: string;
  latitude?: number;
  longitude?: number;
  source: 'history' | 'city' | 'popular';
}

function buildDriverPreview(
  driverId: string,
  driverName: string,
  driverRating: number,
  profile?: Driver | null,
): MockDriverInfo {
  const resolvedName = profile?.name?.trim() || driverName.trim() || 'Şoför';
  const nameParts = resolvedName.split(' ').filter(Boolean);
  const shortName = nameParts.length > 1
    ? `${nameParts[0]} ${nameParts[nameParts.length - 1].charAt(0)}.`
    : resolvedName;
  const initials = nameParts.length > 0
    ? nameParts.map((part) => part.charAt(0)).join('').substring(0, 2).toUpperCase()
    : 'SF';

  return {
    id: driverId,
    name: resolvedName,
    shortName,
    initials,
    phone: profile?.phone ?? '',
    vehicleModel: profile?.vehicleModel ?? 'Araç',
    vehiclePlate: profile?.vehiclePlate ?? '',
    vehicleColor: profile?.vehicleColor ?? '',
    vehicleType: profile?.driverCategory === 'scooter'
      ? 'scooter'
      : profile?.driverCategory === 'courier'
        ? 'motorcycle'
        : 'car',
    rating: profile?.rating ?? driverRating,
    totalRides: profile?.totalRides ?? 0,
  };
}

function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

export default function CustomerHomeScreen() {
  const { height: SCREEN_HEIGHT } = useWindowDimensions();
  const MAP_BOTTOM_PADDING = Math.round(SCREEN_HEIGHT * 0.37);
  const { user, promoApplied, isFreeRide, remainingFreeRides, applyPromoCode, incrementCompletedRides, consumeFreeRide, addRideToHistory, customVehicleImage, rideHistory, ensureServerSession } = useAuth();
  const { draft: rideForOtherDraft, resetRideForOtherDraft } = useRideForOthers();

  const { location: gpsLocation } = useLocation(true, 8000);

  const userCity = user?.city ? getCityByName(user.city) : null;
  const fallbackRegion = userCity ? getCityRegion(userCity) : ISTANBUL_REGION;
  const { isRainy } = useWeather(userCity?.latitude, userCity?.longitude);

  const mapRegion = gpsLocation
    ? { latitude: gpsLocation.latitude, longitude: gpsLocation.longitude, latitudeDelta: 0.003, longitudeDelta: 0.003 }
    : fallbackRegion;
  const [destination, setDestination] = useState<string>('');
  const [selectedDest, setSelectedDest] = useState<DestinationOption | null>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [rideRequested, setRideRequested] = useState<boolean>(false);
  const [findingDriver, setFindingDriver] = useState<boolean>(false);
  const [driverFound, setDriverFound] = useState<boolean>(false);
  const [driverSearchStatus, setDriverSearchStatus] = useState<string>('Yakınlarınızdaki şoförler kontrol ediliyor');
  const [promoInput, setPromoInput] = useState<string>('');
  const [showPromo, setShowPromo] = useState<boolean>(false);
  const [ridePrice, setRidePrice] = useState<number>(0);
  const [rideDistance, setRideDistance] = useState<number>(0);
  const [rideDuration, setRideDuration] = useState<number>(0);
  const [currentRideFree, setCurrentRideFree] = useState<boolean>(false);
  const [currentRideRewardSource, setCurrentRideRewardSource] = useState<'account' | 'promo' | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [paymentLoading, setPaymentLoading] = useState<boolean>(false);
  const [placesLoading, setPlacesLoading] = useState<boolean>(false);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [driverRoutePath, setDriverRoutePath] = useState<{ latitude: number; longitude: number }[]>([]);
  const [driverEta, setDriverEta] = useState<number>(0);
  const [showRatingModal, setShowRatingModal] = useState<boolean>(false);
  const [ratingStars, setRatingStars] = useState<number>(0);
  const [ratingComment, setRatingComment] = useState<string>('');
  const [driverArrived, setDriverArrived] = useState<boolean>(false);
  const [driverApproaching, setDriverApproaching] = useState<boolean>(false);
  const [customerConfirmedArrival, setCustomerConfirmedArrival] = useState<boolean>(false);
  const [tripStarted, setTripStarted] = useState<boolean>(false);
  const [tripRoutePath, setTripRoutePath] = useState<{ latitude: number; longitude: number }[]>([]);
  const [tripDriverLocation, setTripDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [ridePickupOverride, setRidePickupOverride] = useState<{ latitude: number; longitude: number } | null>(null);
  const [tripEta, setTripEta] = useState<number>(0);
  const [tripCompleted, setTripCompleted] = useState<boolean>(false);
  const tripPathRef = useRef<{ latitude: number; longitude: number }[]>([]);
  const tripPathIndexRef = useRef<number>(0);
  const tripIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTripRef = useRef<(() => Promise<void>) | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState<boolean>(false);
  const [showChatModal, setShowChatModal] = useState<boolean>(false);
  const [showSOSModal, setShowSOSModal] = useState<boolean>(false);
  const [activeVenueIndex, setActiveVenueIndex] = useState<number>(0);
  const [showCourierPanel, setShowCourierPanel] = useState<boolean>(false);
  const [selectedCourierBiz, setSelectedCourierBiz] = useState<CourierBusiness | null>(null);
  const [courierCart, setCourierCart] = useState<CartItem[]>([]);
  const [showOrderSuccess, setShowOrderSuccess] = useState<boolean>(false);
  const [selectedVehiclePackage, setSelectedVehiclePackage] = useState<string>('car');
  const [showAlternativeSuggestion, setShowAlternativeSuggestion] = useState<boolean>(false);
  const [alternativeVehicle, setAlternativeVehicle] = useState<{ driver: MockDriverInfo; vehicleType: string } | null>(null);
  const [showCustomOrder, setShowCustomOrder] = useState<boolean>(false);
  const [currentBackendRideId, setCurrentBackendRideId] = useState<string | null>(null);
  const lastBackendRideStatusRef = useRef<string | null>(null);
  const completionHandledRideIdRef = useRef<string | null>(null);
  const cancellationHandledRideIdRef = useRef<string | null>(null);
  const handleCompleteRideRef = useRef<(() => Promise<void>) | null>(null);
  const resetRideStatesRef = useRef<(() => void) | null>(null);
  const [customOrderText, setCustomOrderText] = useState<string>('');
  const [customOrderImages, setCustomOrderImages] = useState<string[]>([]);
  const [customOrderAddress, setCustomOrderAddress] = useState<string>('');
  const [customOrderAddressDetail, setCustomOrderAddressDetail] = useState<string>('');
  const [customOrderLocation, setCustomOrderLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [customOrderLocationConfirmed, setCustomOrderLocationConfirmed] = useState<boolean>(false);
  
  const [showCustomOrderSuccess, setShowCustomOrderSuccess] = useState<boolean>(false);
  const [currentDriver, setCurrentDriver] = useState<MockDriverInfo | null>(null);
  const [previousDriverIds, setPreviousDriverIds] = useState<string[]>([]);
  const [reassigning, setReassigning] = useState<boolean>(false);
  const [showCancelReasonModal, setShowCancelReasonModal] = useState<boolean>(false);
  const [selectedCancelReason, setSelectedCancelReason] = useState<string>('');
  const driverCancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customOrderMapRef = useRef<MapView>(null);
  const venueOpacity = useRef(new Animated.Value(1)).current;
  const venueProgress = useRef(new Animated.Value(0)).current;
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; text: string; fromMe: boolean; time: string }>>([
    { id: '1', text: 'Merhaba, yoldayım!', fromMe: false, time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) },
  ]);
  const [chatInput, setChatInput] = useState<string>('');
  const approachingPlayedRef = useRef<boolean>(false);
  const userInteractingRef = useRef<boolean>(false);
  const [mapCentered, setMapCentered] = useState<boolean>(true);
  const ratingScaleAnim = useRef(new Animated.Value(0)).current;
  const safetyShieldAnim = useRef(new Animated.Value(0.85)).current;
  const driverPathRef = useRef<{ latitude: number; longitude: number }[]>([]);
  const driverPathIndexRef = useRef<number>(0);
  const trackingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const panelAnim = useRef(new Animated.Value(0)).current;
  const _sheetTranslateY = useRef(new Animated.Value(0)).current;
  const _sheetDragOffset = useRef(0);
  const sheetScrollOffsetRef = useRef(0);
  const _sheetMaxExpandRef = useRef(Math.round(SCREEN_HEIGHT * 0.35));

  const onPanelLayout = useCallback((_e: { nativeEvent: { layout: { height: number } } }) => {
  }, []);

  const onSheetLayout = useCallback((_e: { nativeEvent: { layout: { y: number; height: number } } }) => {
  }, []);

  const onPromoSectionLayout = useCallback((_e: { nativeEvent: { layout: { y: number } } }) => {
  }, []);

  const vehicleEmoji = useMemo(() => {
    switch (selectedVehiclePackage) {
      case 'scooter': return '🛴';
      case 'motorcycle': return '🏍️';
      default: return '🚗';
    }
  }, [selectedVehiclePackage]);

  const vehicleMarkerColor = useMemo(() => {
    switch (selectedVehiclePackage) {
      case 'scooter': return '#2ECC71';
      case 'motorcycle': return '#3498DB';
      default: return Colors.dark.primary;
    }
  }, [selectedVehiclePackage]);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const promoAnim = useRef(new Animated.Value(0)).current;
  const mapRef = useRef<MapView>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const locationBias = userCity ? { latitude: userCity.latitude, longitude: userCity.longitude, radius: 50000, strict: true } : undefined;
  const { predictions, isLoading: autoCompleteLoading, fetchPredictions, getPlaceDetails, clearPredictions } = usePlacesAutocomplete(locationBias, user?.city);

  const userCityName = user?.city ?? '';
  const isUserInIstanbul = userCityName === 'İstanbul';

  const cityVenues = useMemo(() => {
    return getNightlifeVenuesByCity(user?.city ?? '', user?.district ?? '');
  }, [user?.city, user?.district]);
  const venuePhotos = useVenuePhotos(cityVenues);
  const filteredDestinations = useMemo(() => {
    if (!isUserInIstanbul) {
      return [] as DestinationOption[];
    }

    return POPULAR_DESTINATIONS.filter((d) => (
      destination ? d.name.toLowerCase().includes(destination.toLowerCase()) : true
    ));
  }, [destination, isUserInIstanbul]);

  const currentLocationLabel = useMemo(() => {
    if (user?.district && user?.city) {
      return `${user.district}, ${user.city}`;
    }

    if (user?.city) {
      return user.city;
    }

    return 'Mevcut konumunuz';
  }, [user?.city, user?.district]);

  const routePickerRecentItems = useMemo<RoutePickerRecentItem[]>(() => {
    const items: RoutePickerRecentItem[] = [];
    const seenKeys = new Set<string>();

    const pushItem = (item: RoutePickerRecentItem) => {
      const dedupeKey = `${item.title}|${item.subtitle}`.toLocaleLowerCase('tr-TR');
      if (seenKeys.has(dedupeKey)) {
        return;
      }
      seenKeys.add(dedupeKey);
      items.push(item);
    };

    rideHistory.slice(0, 6).forEach((ride, index) => {
      if (!ride.dropoffAddress) {
        return;
      }

      pushItem({
        id: `recent-ride-${ride.id}-${index}`,
        title: ride.dropoffAddress,
        subtitle: ride.pickupAddress || currentLocationLabel,
        latitude: ride.dropoffLat,
        longitude: ride.dropoffLng,
        source: 'history',
      });
    });

    if (userCity) {
      const citySubtitleParts: string[] = [];
      if (user?.city) {
        citySubtitleParts.push(user.city);
      }
      if (user?.district) {
        citySubtitleParts.push(user.district);
      }

      pushItem({
        id: 'quick-city-center',
        title: user?.district ? `${user.district} Merkez` : `${user?.city ?? 'Şehir'} Merkez`,
        subtitle: citySubtitleParts.join(' / ') || 'Hızlı seçim',
        latitude: userCity.latitude,
        longitude: userCity.longitude,
        source: 'city',
      });
    }

    filteredDestinations.slice(0, 3).forEach((item, index) => {
      pushItem({
        id: `popular-destination-${index}`,
        title: item.name,
        subtitle: user?.city ? `${user.city} için popüler nokta` : 'Popüler rota',
        latitude: item.latitude,
        longitude: item.longitude,
        source: 'popular',
      });
    });

    return items.slice(0, 5);
  }, [rideHistory, currentLocationLabel, user?.city, user?.district, userCity, filteredDestinations]);

  const onlineDriversQuery = trpc.drivers.getOnlineByCity.useQuery(
    { city: user?.city ?? '' },
    {
      enabled: !!user?.city && !rideRequested,
      refetchInterval: 30000,
      staleTime: 25000,
    }
  );
  const onlineDrivers = onlineDriversQuery.data ?? [];

  const couriersByCityQuery = trpc.drivers.getCouriersByCity.useQuery(
    { city: user?.city ?? '', district: user?.district ?? '' },
    {
      enabled: !!user?.city && !!user?.district,
      refetchInterval: 45000,
      staleTime: 40000,
    }
  );
  const businessesByCityQuery = trpc.businesses.listByCity.useQuery(
    { city: user?.city ?? '' },
    {
      enabled: !!user?.city,
      refetchInterval: 30000,
      staleTime: 25000,
    }
  );
  const cityCouriers = couriersByCityQuery.data ?? [];
  const hasCouriersInCity = cityCouriers.length > 0;
  const onlineCouriersCount = cityCouriers.filter(c => c.isOnline).length;
  const hasAnimatedToGps = useRef(false);
  const lastCenteredLocation = useRef<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    if (!gpsLocation || !mapRef.current || rideRequested) return;

    const isFirstFocus = !hasAnimatedToGps.current;
    const movedEnough = lastCenteredLocation.current &&
      (Math.abs(gpsLocation.latitude - lastCenteredLocation.current.latitude) > 0.0003 ||
       Math.abs(gpsLocation.longitude - lastCenteredLocation.current.longitude) > 0.0003);

    if (isFirstFocus) {
      userInteractingRef.current = false;
      setMapCentered(true);
      hasAnimatedToGps.current = true;
      lastCenteredLocation.current = { latitude: gpsLocation.latitude, longitude: gpsLocation.longitude };
      mapRef.current.animateToRegion({
        latitude: gpsLocation.latitude,
        longitude: gpsLocation.longitude,
        latitudeDelta: 0.003,
        longitudeDelta: 0.003,
      }, 800);
      console.log('[Map] First focus to GPS:', gpsLocation.latitude.toFixed(6), gpsLocation.longitude.toFixed(6));
    } else if (movedEnough && !userInteractingRef.current) {
      lastCenteredLocation.current = { latitude: gpsLocation.latitude, longitude: gpsLocation.longitude };
      mapRef.current.animateToRegion({
        latitude: gpsLocation.latitude,
        longitude: gpsLocation.longitude,
        latitudeDelta: 0.003,
        longitudeDelta: 0.003,
      }, 600);
      console.log('[Map] Updated GPS focus:', gpsLocation.latitude.toFixed(6), gpsLocation.longitude.toFixed(6));
    }
  }, [gpsLocation, rideRequested]);

  useEffect(() => {
    const venueCount = cityVenues.length;
    if (venueCount === 0) return;

    const cycleVenue = () => {
      venueProgress.setValue(0);
      Animated.timing(venueProgress, {
        toValue: 1,
        duration: 10000,
        useNativeDriver: false,
      }).start();

      Animated.sequence([
        Animated.timing(venueOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(venueOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start();
    };

    cycleVenue();

    const interval = setInterval(() => {
      setActiveVenueIndex((prev) => (prev + 1) % venueCount);
      cycleVenue();
    }, 10000);

    return () => clearInterval(interval);
  }, [venueOpacity, venueProgress, cityVenues.length]);

  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    }).catch((e) => console.log('Audio mode error:', e));

    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    const safetyPulse = Animated.loop(
      Animated.sequence([
        Animated.timing(safetyShieldAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(safetyShieldAnim, { toValue: 0.85, duration: 1800, useNativeDriver: true }),
      ])
    );
    safetyPulse.start();
    return () => safetyPulse.stop();
  }, [safetyShieldAnim]);

  const playArrivalMelody = useCallback(async () => {
    console.log('Playing arrival melody');
    const melodyUrls = [
      'https://cdn.pixabay.com/audio/2024/02/19/audio_e4043ea50a.mp3',
      'https://cdn.pixabay.com/audio/2022/12/12/audio_e8c330a42c.mp3',
      'https://cdn.pixabay.com/audio/2024/01/18/audio_e63b28b26d.mp3',
      'https://cdn.pixabay.com/audio/2022/10/30/audio_578b1fb424.mp3',
    ];

    let loadedSound: Audio.Sound | null = null;
    for (const uri of melodyUrls) {
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: false, volume: 1.0 }
        );
        loadedSound = sound;
        console.log('Loaded melody from:', uri);
        break;
      } catch (err) {
        console.log('Failed to load melody:', uri, err);
      }
    }

    if (!loadedSound) {
      console.log('All melody URLs failed');
      return;
    }

    soundRef.current = loadedSound;

    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await loadedSound.playAsync();
      console.log('Melody playing (will stop after 4s)');

      setTimeout(async () => {
        try {
          console.log('Stopping melody after 4 seconds');
          await loadedSound.stopAsync();
          await loadedSound.unloadAsync();
          if (soundRef.current === loadedSound) {
            soundRef.current = null;
          }
        } catch (stopErr) {
          console.log('Error stopping melody:', stopErr);
        }
      }, 4000);

      loadedSound.setOnPlaybackStatusUpdate((status) => {
        if ('didJustFinish' in status && status.didJustFinish) {
          console.log('Melody finished naturally');
          loadedSound?.unloadAsync().catch(() => {});
          if (soundRef.current === loadedSound) {
            soundRef.current = null;
          }
        }
      });

      setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }, 500);
      setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }, 1000);
      setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }, 1500);
    } catch (e) {
      console.log('Melody play error:', e);
      loadedSound.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (driverApproaching) {
      console.log('Driver approaching within 2km! Playing melody');

      const runApproaching = async () => {
        try {
          if (soundRef.current) {
            await soundRef.current.unloadAsync().catch(() => {});
            soundRef.current = null;
          }
          await playArrivalMelody();
        } catch (e) {
          console.log('Approaching melody error:', e);
        }
      };

      void runApproaching();

      Alert.alert(`Şoför Yaklaşıyor! ${vehicleEmoji}`, 'Şoförünüz 2 km yakınınızda, hazır olun!', [{ text: 'Tamam' }]);
      setDriverApproaching(false);
    }
  }, [driverApproaching, playArrivalMelody, vehicleEmoji]);

  useEffect(() => {
    if (driverArrived && !tripStarted) {
      console.log('Driver arrived at pickup! Playing arrival melody');

      const runArrival = async () => {
        try {
          if (soundRef.current) {
            await soundRef.current.unloadAsync().catch(() => {});
            soundRef.current = null;
          }
          await playArrivalMelody();
        } catch (e) {
          console.log('Arrival melody error:', e);
        }
      };

      void runArrival();

      Alert.alert(
        `Şoför Geldi! ${vehicleEmoji}`,
        'Şoförünüz konumunuza ulaştı.\n\n⚠️ Onayladıktan sonra yolculuğu iptal edemezsiniz ve yolculuk bedelini ödemekle yükümlüsünüz.',
        [
          {
            text: 'Onaylıyorum ve Yolculuğu Başlat',
            onPress: () => {
              console.log('[Trip] Customer confirmed arrival - cancellation blocked, starting trip');
              setCustomerConfirmedArrival(true);
              setDriverArrived(false);
              void startTripRef.current?.();
            },
          },
        ],
        { cancelable: false }
      );
    }
  }, [driverArrived, tripStarted, playArrivalMelody, vehicleEmoji]);

  const showGoogleResults = destination.length >= 2;
  const _showPopularFallback = !showGoogleResults;

  const fetchDrivingDistance = useCallback(async (
    originLat: number, originLng: number,
    destLat: number, destLng: number
  ): Promise<{ distanceKm: number; durationMin: number } | null> => {
    try {
      if (!GOOGLE_API_KEY) {
        console.log('[Distance] No API key, falling back to Haversine');
        return null;
      }
      const url = `${DIRECTIONS_API_URL}?origin=${originLat},${originLng}&destination=${destLat},${destLng}&mode=driving&language=tr&key=${GOOGLE_API_KEY}`;
      console.log('[Distance] Fetching real driving distance...');
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === 'OK' && data.routes?.length > 0) {
        const leg = data.routes[0].legs?.[0];
        if (leg) {
          const distanceKm = Math.round((leg.distance.value / 1000) * 10) / 10;
          const durationMin = Math.max(1, Math.round(leg.duration.value / 60));
          console.log(`[Distance] Real driving: ${distanceKm} km, ${durationMin} min`);
          return { distanceKm, durationMin };
        }
      }
      console.log('[Distance] Directions API returned no valid route, status:', data.status);
      return null;
    } catch (error) {
      console.log('[Distance] Directions API error:', error);
      return null;
    }
  }, []);

  const generateFallbackPath = useCallback((origin: { latitude: number; longitude: number }, dest: { latitude: number; longitude: number }) => {
    const steps = 40;
    const path: { latitude: number; longitude: number }[] = [];
    const midLat = (origin.latitude + dest.latitude) / 2;
    const midLng = (origin.longitude + dest.longitude) / 2;
    const perpX = -(dest.longitude - origin.longitude);
    const perpY = dest.latitude - origin.latitude;
    const offsetMag = 0.003 + Math.random() * 0.004;
    const sign = Math.random() > 0.5 ? 1 : -1;
    const wp1Lat = origin.latitude + (dest.latitude - origin.latitude) * 0.3 + sign * perpY * offsetMag * 0.5;
    const wp1Lng = origin.longitude + (dest.longitude - origin.longitude) * 0.3 + sign * perpX * offsetMag * 0.5;
    const wp2Lat = midLat + sign * perpY * offsetMag;
    const wp2Lng = midLng + sign * perpX * offsetMag;
    const wp3Lat = origin.latitude + (dest.latitude - origin.latitude) * 0.7 - sign * perpY * offsetMag * 0.3;
    const wp3Lng = origin.longitude + (dest.longitude - origin.longitude) * 0.7 - sign * perpX * offsetMag * 0.3;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const lat = u*u*u*u * origin.latitude + 4*u*u*u*t * wp1Lat + 6*u*u*t*t * wp2Lat + 4*u*t*t*t * wp3Lat + t*t*t*t * dest.latitude;
      const lng = u*u*u*u * origin.longitude + 4*u*u*u*t * wp1Lng + 6*u*u*t*t * wp2Lng + 4*u*t*t*t * wp3Lng + t*t*t*t * dest.longitude;
      path.push({ latitude: lat, longitude: lng });
    }
    return path;
  }, []);

  const densifyPath = useCallback((path: { latitude: number; longitude: number }[], minPoints: number) => {
    if (path.length >= minPoints || path.length < 2) return path;
    const result: { latitude: number; longitude: number }[] = [];
    const totalDist = path.reduce((sum, p, i) => {
      if (i === 0) return 0;
      const prev = path[i - 1];
      return sum + Math.sqrt(Math.pow(p.latitude - prev.latitude, 2) + Math.pow(p.longitude - prev.longitude, 2));
    }, 0);
    const segmentLength = totalDist / minPoints;
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const dist = Math.sqrt(Math.pow(to.latitude - from.latitude, 2) + Math.pow(to.longitude - from.longitude, 2));
      const segments = Math.max(1, Math.round(dist / segmentLength));
      for (let j = 0; j < segments; j++) {
        const t = j / segments;
        result.push({
          latitude: from.latitude + (to.latitude - from.latitude) * t,
          longitude: from.longitude + (to.longitude - from.longitude) * t,
        });
      }
    }
    result.push(path[path.length - 1]);
    return result;
  }, []);

  const fetchDriverRoute = useCallback(async (
    driverOrigin: { latitude: number; longitude: number },
    customerDest: { latitude: number; longitude: number }
  ): Promise<{ latitude: number; longitude: number }[]> => {
    try {
      console.log('[Customer] Fetching driver route via Directions API...');
      const originStr = `${driverOrigin.latitude},${driverOrigin.longitude}`;
      const destStr = `${customerDest.latitude},${customerDest.longitude}`;
      const url = `${DIRECTIONS_API_URL}?origin=${originStr}&destination=${destStr}&mode=driving&language=tr&key=${GOOGLE_API_KEY}`;

      const response = await fetch(url);
      const data = await response.json();
      console.log('[Customer] Directions API status:', data.status);

      if (data.status === 'OK' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const overviewPolyline = route.overview_polyline?.points;
        if (overviewPolyline) {
          const points = decodePolyline(overviewPolyline);
          console.log('[Customer] Real route loaded:', points.length, 'points');
          if (points.length >= 2) {
            return points;
          }
        }

        const allPoints: { latitude: number; longitude: number }[] = [];
        for (const leg of route.legs ?? []) {
          for (const step of leg.steps ?? []) {
            if (step.polyline?.points) {
              const stepPoints = decodePolyline(step.polyline.points);
              allPoints.push(...stepPoints);
            }
          }
        }
        if (allPoints.length >= 2) {
          console.log('[Customer] Route from steps:', allPoints.length, 'points');
          return allPoints;
        }
      }

      console.log('[Customer] Directions API failed, using curved fallback');
      return generateFallbackPath(driverOrigin, customerDest);
    } catch (error) {
      console.log('[Customer] Route fetch error:', error);
      return generateFallbackPath(driverOrigin, customerDest);
    }
  }, [generateFallbackPath]);

  const startTrip = useCallback(async () => {
    if (!selectedDest) return;
    setTripStarted(true);
    setDriverArrived(false);

    const pickup = ridePickupOverride ?? {
      latitude: mapRegion.latitude,
      longitude: mapRegion.longitude,
    };
    const dropoff = { latitude: selectedDest.latitude, longitude: selectedDest.longitude };

    console.log('[Trip] Fetching route from pickup to destination...');
    const rawPath = await fetchDriverRoute(pickup, dropoff);
    const path = densifyPath(rawPath, 100);
    setTripDriverLocation(path[0]);
    setTripRoutePath(path);
    const distKm = calculateDistance(pickup.latitude, pickup.longitude, dropoff.latitude, dropoff.longitude);
    const etaMinutes = Math.max(2, Math.ceil((distKm / 30) * 60));
    setTripEta(etaMinutes);
    console.log('[Trip] Trip route ready:', path.length, 'points, dist:', distKm.toFixed(2), 'km, ETA:', etaMinutes, 'min');

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [selectedDest, ridePickupOverride, mapRegion.latitude, mapRegion.longitude, fetchDriverRoute, densifyPath]);

  useEffect(() => {
    startTripRef.current = startTrip;
  }, [startTrip]);

  const customerActiveRideQuery = trpc.rides.getActiveRide.useQuery(
    { userId: user?.id ?? '', type: 'customer' as const },
    {
      enabled: !!user?.id,
      refetchInterval: (rideRequested || !!currentBackendRideId || tripStarted) ? 5000 : 20000,
      staleTime: 4000,
    }
  );
  const backendActiveRide = customerActiveRideQuery.data;
  const backendDriverId = backendActiveRide?.driverId ? backendActiveRide.driverId : currentDriver?.id ?? '';

  const _driverProfileQuery = trpc.drivers.getProfile.useQuery(
    { driverId: backendDriverId },
    {
      enabled: backendDriverId.length > 0,
      refetchInterval: tripStarted ? 15000 : 30000,
      staleTime: 10000,
    }
  );
  const backendDriverProfile = _driverProfileQuery.data;

  const _rideDetailsQuery = trpc.rides.getById.useQuery(
    { rideId: currentBackendRideId ?? '' },
    {
      enabled: !!currentBackendRideId,
      refetchInterval: currentBackendRideId ? 5000 : false,
      staleTime: 3000,
    }
  );
  const backendRideDetails = _rideDetailsQuery.data;
  const backendObservedRide = backendActiveRide ?? backendRideDetails ?? null;

  const driverLocationPollQuery = trpc.drivers.getLocation.useQuery(
    { driverId: backendDriverId },
    {
      enabled: backendDriverId.length > 0 && (
        (driverFound && !driverArrived && !tripStarted) ||
        (tripStarted && !tripCompleted)
      ),
      refetchInterval: 8000,
      staleTime: 7000,
    }
  );

  useEffect(() => {
    const ride = backendObservedRide;
    if (!ride) {
      return;
    }

    if (currentBackendRideId !== ride.id) {
      console.log('[Customer] Syncing ride id from backend:', ride.id, 'status:', ride.status);
      setCurrentBackendRideId(ride.id);
    }

    if (typeof ride.pickupLat === 'number' && typeof ride.pickupLng === 'number') {
      const pickupLatitude = ride.pickupLat;
      const pickupLongitude = ride.pickupLng;

      setRidePickupOverride((previous) => {
        if (previous?.latitude === pickupLatitude && previous?.longitude === pickupLongitude) {
          return previous;
        }

        return {
          latitude: pickupLatitude,
          longitude: pickupLongitude,
        };
      });
    }

    if (!selectedDest && typeof ride.dropoffLat === 'number' && typeof ride.dropoffLng === 'number' && ride.dropoffAddress) {
      setSelectedDest({
        name: ride.dropoffAddress,
        latitude: ride.dropoffLat,
        longitude: ride.dropoffLng,
      });
      setDestination(ride.dropoffAddress);
      console.log('[Customer] Hydrated destination from backend ride:', ride.dropoffAddress);
    }

    if (paymentMethod !== ride.paymentMethod) {
      setPaymentMethod(ride.paymentMethod);
    }
    if (ridePrice !== ride.price) {
      setRidePrice(ride.price);
    }
    if (currentRideFree !== ride.isFreeRide) {
      setCurrentRideFree(ride.isFreeRide);
    }

    const parsedDistance = Number.parseFloat(ride.distance.replace(',', '.'));
    if (!Number.isNaN(parsedDistance) && parsedDistance > 0 && rideDistance !== parsedDistance) {
      setRideDistance(parsedDistance);
    }

    const parsedDuration = Number.parseInt(ride.duration.replace(/\D+/g, ''), 10);
    if (!Number.isNaN(parsedDuration) && parsedDuration > 0 && rideDuration !== parsedDuration) {
      setRideDuration(parsedDuration);
    }
  }, [backendObservedRide, currentBackendRideId, selectedDest, paymentMethod, ridePrice, currentRideFree, rideDistance, rideDuration]);

  useEffect(() => {
    const ride = backendObservedRide;
    if (!ride?.driverId) {
      return;
    }

    const nextDriver = buildDriverPreview(
      ride.driverId,
      ride.driverName,
      ride.driverRating,
      backendDriverProfile ?? null,
    );

    setCurrentDriver((previous) => {
      if (
        previous?.id === nextDriver.id &&
        previous.shortName === nextDriver.shortName &&
        previous.vehicleModel === nextDriver.vehicleModel &&
        previous.vehiclePlate === nextDriver.vehiclePlate &&
        previous.rating === nextDriver.rating &&
        previous.totalRides === nextDriver.totalRides &&
        previous.phone === nextDriver.phone
      ) {
        return previous;
      }

      console.log('[Customer] Synced driver preview from backend:', nextDriver.shortName, nextDriver.vehiclePlate);
      return nextDriver;
    });
  }, [backendObservedRide, backendDriverProfile]);

  useEffect(() => {
    const ride = backendObservedRide;
    if (!ride) {
      return;
    }

    const previousStatus = lastBackendRideStatusRef.current;
    if (previousStatus !== ride.status) {
      console.log('[Customer] Backend ride status changed:', previousStatus ?? 'none', '->', ride.status, 'ride:', ride.id);
    }

    if (ride.status === 'pending') {
      setRideRequested(true);
      setFindingDriver(true);
      setDriverFound(false);
      setTripStarted(false);
      setTripCompleted(false);
      setDriverArrived(false);
      setCustomerConfirmedArrival(false);
      lastBackendRideStatusRef.current = ride.status;
      return;
    }

    if (ride.status === 'accepted') {
      setRideRequested(true);
      setFindingDriver(false);
      setDriverFound(true);
      setTripStarted(false);
      setTripCompleted(false);
      setDriverArrived(false);
      setCustomerConfirmedArrival(false);
      lastBackendRideStatusRef.current = ride.status;
      return;
    }

    if (ride.status === 'in_progress') {
      setRideRequested(true);
      setFindingDriver(false);
      setDriverFound(true);
      setDriverArrived(false);
      setCustomerConfirmedArrival(true);
      lastBackendRideStatusRef.current = ride.status;
      return;
    }

    if (ride.status === 'completed') {
      setRideRequested(true);
      setFindingDriver(false);
      setDriverFound(true);
      setCustomerConfirmedArrival(true);
      setTripStarted(true);
      if (!tripCompleted) {
        setTripCompleted(true);
      }
      if (completionHandledRideIdRef.current !== ride.id && !showReceiptModal && !showRatingModal) {
        console.log('[Customer] Backend completed ride detected, opening receipt flow:', ride.id);
        completionHandledRideIdRef.current = ride.id;
        void handleCompleteRideRef.current?.();
      }
      lastBackendRideStatusRef.current = ride.status;
      return;
    }

    if (ride.status === 'cancelled') {
      if (cancellationHandledRideIdRef.current !== ride.id) {
        cancellationHandledRideIdRef.current = ride.id;
        console.log('[Customer] Backend cancelled ride detected:', ride.id, ride.cancelReason ?? 'no_reason');
        Alert.alert(
          'Yolculuk İptal Edildi',
          ride.cancelReason ? `Sebep: ${ride.cancelReason}` : 'Yolculuğunuz iptal edildi.'
        );
        resetRideStatesRef.current?.();
      }
      lastBackendRideStatusRef.current = ride.status;
    }
  }, [backendObservedRide, tripCompleted, showReceiptModal, showRatingModal]);

  useEffect(() => {
    if (backendObservedRide?.status !== 'in_progress') {
      return;
    }
    if (tripStarted || !selectedDest) {
      return;
    }

    console.log('[Customer] Backend ride is in progress, starting trip UI:', backendObservedRide.id);
    void startTripRef.current?.();
  }, [backendObservedRide?.id, backendObservedRide?.status, tripStarted, selectedDest]);

  useEffect(() => {
    if (!driverFound || tripStarted || !driverLocation || driverRoutePath.length > 1) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const path = await fetchDriverRoute(driverLocation, {
        latitude: mapRegion.latitude,
        longitude: mapRegion.longitude,
      });
      if (cancelled) {
        return;
      }
      const densePath = densifyPath(path, 80);
      setDriverRoutePath(densePath);
      console.log('[Customer] Built pickup route from real driver location:', densePath.length);
    })();

    return () => {
      cancelled = true;
    };
  }, [driverFound, tripStarted, driverLocation, driverRoutePath.length, fetchDriverRoute, densifyPath, mapRegion.latitude, mapRegion.longitude]);

  useEffect(() => {
    if (!tripStarted || tripCompleted || !currentDriver?.id) return;
    const loc = driverLocationPollQuery.data;
    if (!loc) return;

    const newLoc = { latitude: loc.latitude, longitude: loc.longitude };
    setTripDriverLocation(newLoc);

    if (selectedDest) {
      const distToDest = calculateDistance(
        newLoc.latitude, newLoc.longitude,
        selectedDest.latitude, selectedDest.longitude
      );
      const etaMin = Math.max(1, Math.ceil((distToDest / 30) * 60));
      setTripEta(etaMin);

      console.log(`[Trip] Real driver location: dist to dest: ${distToDest.toFixed(2)} km, ETA: ${etaMin} min`);

      if (distToDest <= 0.05) {
        setTripEta(0);
        setTripCompleted(true);
        console.log('[Trip] Arrived at destination!');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }

      if (mapRef.current && !userInteractingRef.current) {
        const midLat = (newLoc.latitude + selectedDest.latitude) / 2;
        const midLng = (newLoc.longitude + selectedDest.longitude) / 2;
        const latDelta = Math.abs(newLoc.latitude - selectedDest.latitude) * 1.8 + 0.01;
        const lngDelta = Math.abs(newLoc.longitude - selectedDest.longitude) * 1.8 + 0.01;
        mapRef.current.animateToRegion({
          latitude: midLat,
          longitude: midLng,
          latitudeDelta: Math.max(latDelta, 0.015),
          longitudeDelta: Math.max(lngDelta, 0.015),
        }, 400);
      }
    }
  }, [tripStarted, tripCompleted, driverLocationPollQuery.data, selectedDest, currentDriver?.id]);

  const assignNewDriver = useCallback(async (excludeIds: string[], vehicleType?: string) => {
    const customerLat = mapRegion.latitude;
    const customerLng = mapRegion.longitude;
    const categoryMap: Record<string, string> = { car: 'driver', scooter: 'scooter', motorcycle: 'courier' };
    const requestedCategory = vehicleType ? (categoryMap[vehicleType] ?? 'driver') : 'driver';

    let assignedDriver: MockDriverInfo | null = null;
    let driverStartLocation: { latitude: number; longitude: number } | null = null;

    try {
      console.log('[Customer] Trying smart backend assignment, city:', user?.city, 'category:', requestedCategory, 'exclude:', excludeIds);
      const data = await trpcClient.rides.findBestDriver.query({
        city: user?.city ?? '',
        pickupLat: customerLat,
        pickupLng: customerLng,
        vehicleCategory: requestedCategory,
        excludeDriverIds: excludeIds,
      });

      if (data?.found && data.driver) {
        const bd = data.driver;
        assignedDriver = {
          id: bd.id,
          name: bd.name,
          shortName: bd.shortName,
          initials: bd.initials,
          phone: bd.phone,
          vehicleModel: bd.vehicleModel,
          vehiclePlate: bd.vehiclePlate,
          vehicleColor: bd.vehicleColor,
          vehicleType: bd.vehicleType,
          rating: bd.rating,
          totalRides: bd.totalRides,
        };
        if (bd.location) {
          driverStartLocation = { latitude: bd.location.latitude, longitude: bd.location.longitude };
        }
        console.log('[Customer] Smart assignment: best driver=', bd.shortName, 'score=', bd.score?.toFixed(1), 'dist=', bd.distance?.toFixed(2), 'km');
      } else {
        console.log('[Customer] No real drivers found via backend, reason:', data?.reason, 'totalOnline:', data?.totalOnline);
      }
    } catch (err) {
      console.log('[Customer] Backend findBestDriver error, falling back to mock:', err);
    }

    if (!assignedDriver) {
      console.log('[Customer] No real drivers available in city:', user?.city);
      return null;
    }

    setCurrentDriver(assignedDriver);
    setPreviousDriverIds(prev => [...prev, assignedDriver!.id]);
    console.log('[Customer] Assigned driver:', assignedDriver.shortName, assignedDriver.vehicleModel, assignedDriver.vehiclePlate);

    if (selectedDest) {
      let driverStart = driverStartLocation;
      if (!driverStart) {
        const angle = Math.random() * 2 * Math.PI;
        const offsetDist = 0.025 + Math.random() * 0.02;
        driverStart = {
          latitude: customerLat + Math.cos(angle) * offsetDist,
          longitude: customerLng + Math.sin(angle) * offsetDist,
        };
      }
      const rawPath = await fetchDriverRoute(driverStart, { latitude: customerLat, longitude: customerLng });
      const path = densifyPath(rawPath, 80);
      setDriverLocation(driverStartLocation ?? path[0]);
      setDriverRoutePath(path);
      const distKm = calculateDistance(driverStart.latitude, driverStart.longitude, customerLat, customerLng);
      const etaMinutes = Math.max(2, Math.ceil((distKm / 30) * 60));
      setDriverEta(etaMinutes);
      console.log('[Customer] Driver route loaded:', path.length, 'points, dist:', distKm.toFixed(2), 'km');
    }
    return assignedDriver;
  }, [selectedDest, mapRegion.latitude, mapRegion.longitude, fetchDriverRoute, densifyPath, user?.city]);

  const handleDriverCancelled = useCallback(async () => {
    console.log('[Customer] Driver cancelled! Reassigning...');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});

    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }
    driverPathRef.current = [];
    driverPathIndexRef.current = 0;
    setDriverLocation(null);
    setDriverRoutePath([]);
    setDriverEta(0);
    approachingPlayedRef.current = false;

    const cancelledDriverName = currentDriver?.shortName ?? 'Şoför';
    setReassigning(true);
    setDriverFound(false);

    Alert.alert(
      '⚠️ Yolculuk İptal Edildi',
      `${cancelledDriverName} yolculuğunuzu iptal etti. Hemen yeni bir şoför atanıyor...`,
      [{ text: 'Tamam' }]
    );

    setTimeout(async () => {
      const newDriver = await assignNewDriver(previousDriverIds, selectedVehiclePackage);
      if (newDriver) {
        setDriverFound(true);
        setReassigning(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert(
          '✅ Yeni Şoför Atandı!',
          `${newDriver.shortName} size doğru yola çıktı!\n${newDriver.vehicleModel} • ${newDriver.vehiclePlate}\n⭐ ${newDriver.rating}`,
          [{ text: 'Tamam' }]
        );
        console.log('[Customer] New driver assigned:', newDriver.shortName);
      } else {
        const alt = findBestAlternativeVehicle(selectedVehiclePackage, previousDriverIds);
        setReassigning(false);
        if (alt) {
          setAlternativeVehicle(alt);
          setShowAlternativeSuggestion(true);
        } else {
          Alert.alert('Şoför Bulunamadı', 'Müsait şoför bulunamadı.', [{ text: 'Tamam', onPress: () => {
            setRideRequested(false);
            setFindingDriver(false);
            setDriverFound(false);
            setDestination('');
            setSelectedDest(null);
            setCurrentRideFree(false);
            setDriverLocation(null);
            setDriverEta(0);
            setDriverRoutePath([]);
            setCurrentDriver(null);
            setPreviousDriverIds([]);
          } }]);
        }
      }
    }, 2500);
  }, [currentDriver, previousDriverIds, assignNewDriver, selectedVehiclePackage]);

  useEffect(() => {
    return () => {
      if (driverCancelTimerRef.current) {
        clearTimeout(driverCancelTimerRef.current);
        driverCancelTimerRef.current = null;
      }
    };
  }, [driverFound, currentDriver?.id, tripStarted, reassigning, driverArrived, handleDriverCancelled, pulseAnim]);

  useEffect(() => {
    if (!findingDriver) {
      pulseAnim.setValue(1);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );

    pulse.start();
    console.log('[Customer] Waiting for a real driver acceptance from backend');

    return () => {
      pulse.stop();
      pulseAnim.setValue(1);
    };
  }, [findingDriver, pulseAnim]);

  useEffect(() => {
    if (!driverFound || driverArrived || tripStarted || !currentDriver?.id) return;
    const loc = driverLocationPollQuery.data;
    if (!loc) return;

    const newLoc = { latitude: loc.latitude, longitude: loc.longitude };
    setDriverLocation(newLoc);

    const distToCustomer = calculateDistance(
      newLoc.latitude, newLoc.longitude,
      mapRegion.latitude, mapRegion.longitude
    );
    const etaMin = Math.max(1, Math.ceil((distToCustomer / 30) * 60));
    setDriverEta(etaMin);

    console.log(`[Tracking] Real driver: ${newLoc.latitude.toFixed(5)}, ${newLoc.longitude.toFixed(5)}, dist: ${distToCustomer.toFixed(2)} km, ETA: ${etaMin} min`);

    if (distToCustomer <= 2 && !approachingPlayedRef.current) {
      approachingPlayedRef.current = true;
      setDriverApproaching(true);
      console.log('[Tracking] Driver is within 2km!');
    }

    if (distToCustomer <= 0.05) {
      setDriverEta(0);
      setDriverArrived(true);
      console.log('[Tracking] Driver arrived (< 50m)');
    }

    if (mapRef.current && !userInteractingRef.current) {
      mapRef.current.animateToRegion({
        latitude: (newLoc.latitude + mapRegion.latitude) / 2,
        longitude: (newLoc.longitude + mapRegion.longitude) / 2,
        latitudeDelta: 0.025,
        longitudeDelta: 0.025,
      }, 400);
    }
  }, [driverFound, driverArrived, tripStarted, driverLocationPollQuery.data, mapRegion.latitude, mapRegion.longitude, currentDriver?.id]);

  const toggleSearch = useCallback((open: boolean) => {
    if (open) {
      panelAnim.setValue(1);
      setIsSearching(true);
    } else {
      panelAnim.setValue(0);
      setIsSearching(false);
    }
  }, [panelAnim]);

  const selectDestination = useCallback(async (dest: DestinationOption) => {
    setDestination(dest.name);
    setSelectedDest(dest);

    const haversineDist = calculateDistance(
      mapRegion.latitude,
      mapRegion.longitude,
      dest.latitude,
      dest.longitude
    );
    setRideDistance(haversineDist);
    setRidePrice(calculatePrice(haversineDist, selectedVehiclePackage as VehicleType));
    setRideDuration(estimateDuration(haversineDist));

    const realResult = await fetchDrivingDistance(
      mapRegion.latitude, mapRegion.longitude,
      dest.latitude, dest.longitude
    );
    if (realResult) {
      const price = calculatePrice(realResult.distanceKm, selectedVehiclePackage as VehicleType);
      setRideDistance(realResult.distanceKm);
      setRidePrice(price);
      setRideDuration(realResult.durationMin);
      console.log(`Selected: ${dest.name}, Real Distance: ${realResult.distanceKm}km, Price: ₺${price}, Vehicle: ${selectedVehiclePackage}, Duration: ${realResult.durationMin}dk`);
    } else {
      console.log(`Selected: ${dest.name}, Haversine Distance: ${haversineDist}km, Price: ₺${calculatePrice(haversineDist, selectedVehiclePackage as VehicleType)}, Vehicle: ${selectedVehiclePackage}`);
    }
  }, [mapRegion.latitude, mapRegion.longitude, selectedVehiclePackage, fetchDrivingDistance]);

  const handleSelectRoutePickerItem = useCallback((item: RoutePickerRecentItem) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    if (typeof item.latitude === 'number' && typeof item.longitude === 'number') {
      clearPredictions();
      Keyboard.dismiss();
      void selectDestination({
        name: item.title,
        latitude: item.latitude,
        longitude: item.longitude,
      });
      console.log('[RoutePicker] Quick destination selected:', item.title);
      return;
    }

    setDestination(item.title);
    setSelectedDest(null);
    void fetchPredictions(item.title);
    console.log('[RoutePicker] Searching quick destination:', item.title);
  }, [clearPredictions, fetchPredictions, selectDestination]);

  const handleRoutePickerMapSelection = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Alert.alert('Yakında', 'Harita üzerinden konum seçme özelliği çok yakında eklenecek.');
    console.log('[RoutePicker] Map selection placeholder pressed');
  }, []);

  const initializePaymentMutation = trpc.payments.initializePayment.useMutation();
  const createRideMutation = trpc.rides.create.useMutation();
  const createBusinessOrderMutation = trpc.rides.createBusinessOrder.useMutation();
  const cancelRideMutation = trpc.rides.cancel.useMutation();
  const createRatingMutation = trpc.ratings.create.useMutation();
  const sendMessageMutation = trpc.messages.send.useMutation();
  const [activeRideRecipient, setActiveRideRecipient] = useState<RideRecipient | null>(null);
  const [activeRideForOther, setActiveRideForOther] = useState<boolean>(false);
  const [activeRidePaymentMode, setActiveRidePaymentMode] = useState<RideForOtherPaymentMode>('customer_app');
  const [activeRideShareBySms, setActiveRideShareBySms] = useState<boolean>(true);
  const [activeRideShareByWhatsApp, setActiveRideShareByWhatsApp] = useState<boolean>(true);
  const [activeRideLiveTracking, setActiveRideLiveTracking] = useState<boolean>(true);
  const rideMessagesQuery = trpc.messages.getByRide.useQuery(
    { rideId: currentBackendRideId ?? '' },
    { enabled: !!currentBackendRideId && showChatModal, refetchInterval: 8000, staleTime: 6000 }
  );

  const isVehicleWeatherRestricted = useMemo(() => {
    return isRainy && (selectedVehiclePackage === 'scooter' || selectedVehiclePackage === 'motorcycle');
  }, [isRainy, selectedVehiclePackage]);

  const handleRequestRide = useCallback(async () => {
    if (!destination || !selectedDest) return;
    if (isVehicleWeatherRestricted) {
      Alert.alert(
        'Hava Durumu Uyarısı',
        'Yağışlı hava nedeniyle bu araç türü ile yolculuk başlatılamaz. Lütfen Otomobil seçin.',
      );
      return;
    }

    try {
      await ensureServerSession('customer-dashboard-create-ride');
    } catch (sessionError) {
      const sessionMessage = sessionError instanceof Error ? sessionError.message : 'Oturum doğrulanamadı. Lütfen tekrar giriş yapın.';
      console.log('[Customer] Ride request blocked by session validation:', sessionMessage);
      Alert.alert('Yolculuk Başlatılamadı', sessionMessage);
      return;
    }

    const accountFreeRides = user?.type === 'customer' ? Math.max(0, user.freeRidesRemaining ?? 0) : 0;
    const free = isFreeRide();
    const freeRideSource: 'account' | 'promo' | null = free
      ? (accountFreeRides > 0 ? 'account' : 'promo')
      : null;
    setCurrentRideFree(free);
    setCurrentRideRewardSource(freeRideSource);

    const rideForOtherEnabled = Boolean(rideForOtherDraft.enabled && rideForOtherDraft.recipient);
    const selectedRideRecipient = rideForOtherEnabled ? rideForOtherDraft.recipient : null;
    setActiveRideForOther(rideForOtherEnabled);
    setActiveRideRecipient(selectedRideRecipient);
    setActiveRidePaymentMode(rideForOtherDraft.paymentMode);
    setActiveRideShareBySms(rideForOtherDraft.shareBySms);
    setActiveRideShareByWhatsApp(rideForOtherDraft.shareByWhatsApp);
    setActiveRideLiveTracking(rideForOtherDraft.liveTrackingEnabled);

    if (paymentMethod === 'card' && !free && ridePrice > 0) {
      setPaymentLoading(true);
      console.log('[PAYMENT] Starting card payment flow, price:', ridePrice);
      try {
        const callbackUrl = buildApiUrl('/api/iyzico/callback');
        console.log('[PAYMENT] Using callback URL:', callbackUrl);
        const result = await initializePaymentMutation.mutateAsync({
          rideId: 'r_' + Date.now(),
          customerId: user?.id ?? '',
          customerName: user?.name ?? 'Müşteri',
          customerEmail: user?.email ?? '',
          customerPhone: user?.phone ?? '',
          customerCity: user?.city ?? '',
          price: ridePrice,
          callbackUrl,
        });

        if (result.success && result.paymentPageUrl) {
          console.log('[PAYMENT] Opening iyzico payment page');
          await WebBrowser.openBrowserAsync(result.paymentPageUrl);
          console.log('[PAYMENT] Browser closed, proceeding with ride');
        } else if (result.success && result.checkoutFormContent) {
          console.log('[PAYMENT] Got checkout form content, proceeding');
        } else {
          Alert.alert('Ödeme Hatası', result.error || 'Kart ödeme başlatılamadı. Nakit ile devam edebilirsiniz.');
          setPaymentLoading(false);
          return;
        }
      } catch (err) {
        console.log('[PAYMENT] Error:', err);
        Alert.alert('Ödeme Hatası', 'Kart ödeme sistemi şu an kullanılamıyor. Nakit ile devam edebilirsiniz.');
        setPaymentLoading(false);
        return;
      }
      setPaymentLoading(false);
    }

    try {
      const requestedDriverCategory = selectedVehiclePackage === 'scooter'
        ? 'scooter'
        : selectedVehiclePackage === 'motorcycle'
          ? 'courier'
          : 'driver';
      const result = await createRideMutation.mutateAsync({
        customerId: user?.id ?? '',
        customerName: user?.name ?? 'Müşteri',
        pickupAddress: user?.city ? `${user.city}${user.district ? ' / ' + user.district : ''}` : 'Mevcut Konum',
        dropoffAddress: selectedDest.name,
        pickupLat: mapRegion.latitude,
        pickupLng: mapRegion.longitude,
        dropoffLat: selectedDest.latitude,
        dropoffLng: selectedDest.longitude,
        price: free ? 0 : ridePrice,
        distance: `${rideDistance} km`,
        duration: `${rideDuration} dk`,
        isFreeRide: free,
        city: user?.city ?? '',
        requestedDriverCategory,
        paymentMethod: paymentMethod,
        rideForOther: rideForOtherEnabled,
        recipientName: selectedRideRecipient?.name,
        recipientPhone: selectedRideRecipient?.phone,
        recipientRelation: selectedRideRecipient?.relation,
        guestPaymentMode: rideForOtherDraft.paymentMode,
        guestTrackingEnabled: rideForOtherDraft.liveTrackingEnabled,
      });

      if (!result?.success || !result.ride) {
        const backendError = 'error' in result && typeof result.error === 'string'
          ? result.error
          : 'Yolculuk talebi şu an oluşturulamadı. Lütfen tekrar deneyin.';
        setCurrentBackendRideId(null);
        setRideRequested(false);
        setFindingDriver(false);
        setDriverSearchStatus('Yakınlarınızdaki şoförler kontrol ediliyor');
        Alert.alert('Yolculuk Başlatılamadı', backendError);
        return;
      }

      const availableDriversCount = typeof result.availableDriversCount === 'number' ? result.availableDriversCount : 0;
      const notifiedDriversCount = typeof result.notifiedDriversCount === 'number' ? result.notifiedDriversCount : availableDriversCount;
      const nextDriverSearchStatus = notifiedDriversCount > 1
        ? `${notifiedDriversCount} müsait şoföre talebiniz gönderildi`
        : availableDriversCount > 0
          ? 'En yakın müsait şoföre talebiniz gönderildi'
          : 'Yakınlarınızdaki şoförler kontrol ediliyor';

      lastBackendRideStatusRef.current = result.ride.status;
      completionHandledRideIdRef.current = null;
      cancellationHandledRideIdRef.current = null;
      setCurrentBackendRideId(result.ride.id);
      setRideRequested(true);
      setFindingDriver(true);
      setDriverFound(false);
      setDriverSearchStatus(nextDriverSearchStatus);
      setTripStarted(false);
      toggleSearch(false);
      console.log('[Customer] Ride created on backend, waiting for driver acceptance:', result.ride.id, 'availableDrivers:', availableDriversCount, 'notifiedDrivers:', notifiedDriversCount);
    } catch (err) {
      console.log('[Customer] Backend ride creation error:', err);
      setCurrentBackendRideId(null);
      setRideRequested(false);
      setFindingDriver(false);
      setDriverSearchStatus('Yakınlarınızdaki şoförler kontrol ediliyor');
      const errorMessage = err instanceof Error ? err.message : 'Yolculuk talebi şu an oluşturulamadı. Lütfen tekrar deneyin.';
      Alert.alert('Yolculuk Başlatılamadı', errorMessage);
      return;
    }

    console.log(`Ride requested: ${destination}, Free: ${free}, Payment: ${paymentMethod}, Price: ₺${free ? 0 : ridePrice}, ForOther: ${rideForOtherEnabled}`);
  }, [destination, selectedDest, toggleSearch, isFreeRide, ridePrice, rideDistance, rideDuration, paymentMethod, user, initializePaymentMutation, isVehicleWeatherRestricted, createRideMutation, mapRegion.latitude, mapRegion.longitude, rideForOtherDraft, selectedVehiclePackage, ensureServerSession]);

  const handleCompleteRide = useCallback(async () => {
    if (currentBackendRideId) {
      completionHandledRideIdRef.current = currentBackendRideId;
    }

    if (currentRideFree) {
      await consumeFreeRide(currentRideRewardSource ?? undefined);
    } else {
      await incrementCompletedRides();
    }
    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }
    if (tripIntervalRef.current) {
      clearInterval(tripIntervalRef.current);
      tripIntervalRef.current = null;
    }

    if (selectedDest) {
      const now = new Date();
      const ride = {
        id: currentBackendRideId ?? ('r_' + Date.now()),
        customerId: user?.id ?? '',
        driverId: currentDriver?.id ?? '',
        pickupAddress: user?.city ? `${user.city}${user.district ? ' / ' + user.district : ''}` : 'Mevcut Konum',
        dropoffAddress: selectedDest.name,
        status: 'completed' as const,
        price: currentRideFree ? 0 : ridePrice,
        distance: `${rideDistance} km`,
        duration: `${rideDuration} dk`,
        createdAt: now.toISOString(),
        driverName: currentDriver?.shortName ?? 'Şoför',
        driverRating: currentDriver?.rating ?? 4.5,
        paymentMethod: paymentMethod as 'cash' | 'card',
        isFreeRide: currentRideFree,
        rideForOther: activeRideForOther,
        recipientName: activeRideRecipient?.name,
        recipientPhone: activeRideRecipient?.phone,
        recipientRelation: activeRideRecipient?.relation,
        guestPaymentMode: activeRidePaymentMode,
        guestTrackingEnabled: activeRideLiveTracking,
      };
      await addRideToHistory(ride);
      console.log('Ride saved to history:', ride.id);
    }

    setShowReceiptModal(true);
    console.log('Showing receipt modal');
  }, [incrementCompletedRides, consumeFreeRide, selectedDest, user, currentRideFree, currentRideRewardSource, ridePrice, rideDistance, rideDuration, addRideToHistory, currentBackendRideId, currentDriver, paymentMethod, activeRideForOther, activeRideRecipient, activeRidePaymentMode, activeRideLiveTracking]);

  handleCompleteRideRef.current = handleCompleteRide;

  const handleCloseReceipt = useCallback(() => {
    setShowReceiptModal(false);
    setShowRatingModal(true);
    setRatingStars(0);
    setRatingComment('');
    Animated.spring(ratingScaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 65,
      friction: 8,
    }).start();
    console.log('Receipt closed, showing rating modal');
  }, [ratingScaleAnim]);

  const handleSubmitRating = useCallback(() => {
    console.log(`Rating submitted: ${ratingStars} stars, comment: "${ratingComment}"`);

    if (ratingStars > 0 && currentBackendRideId && currentDriver) {
      createRatingMutation.mutate(
        {
          rideId: currentBackendRideId,
          customerId: user?.id ?? '',
          driverId: currentDriver.id,
          stars: ratingStars,
          comment: ratingComment,
        },
        {
          onSuccess: (data) => {
            console.log('[Rating] Saved to backend:', data.success);
          },
          onError: (err) => {
            console.log('[Rating] Backend save error:', err);
          },
        }
      );
    }

    Animated.timing(ratingScaleAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowRatingModal(false);
      setRideRequested(false);
      setFindingDriver(false);
      setDriverFound(false);
      setDestination('');
      setSelectedDest(null);
      setCurrentRideFree(false);
      setDriverLocation(null);
      setDriverEta(0);
      driverPathRef.current = [];
      driverPathIndexRef.current = 0;
      approachingPlayedRef.current = false;
      setDriverRoutePath([]);
      setTripStarted(false);
      setTripRoutePath([]);
      setTripDriverLocation(null);
      setTripEta(0);
      setTripCompleted(false);
      tripPathRef.current = [];
      tripPathIndexRef.current = 0;
      setCurrentBackendRideId(null);
      setCurrentDriver(null);
      setPreviousDriverIds([]);
      if (driverCancelTimerRef.current) { clearTimeout(driverCancelTimerRef.current); driverCancelTimerRef.current = null; }
      Alert.alert(
        'Teşekkürler!',
        ratingStars > 0
          ? `Şoföre ${ratingStars} yıldız verdiniz. İyi yolculuklar!`
          : 'Yolculuk tamamlandı. İyi yolculuklar!'
      );
    });
  }, [ratingStars, ratingComment, ratingScaleAnim, currentBackendRideId, currentDriver, user?.id, createRatingMutation]);

  const handleSkipRating = useCallback(() => {
    Animated.timing(ratingScaleAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowRatingModal(false);
      setRideRequested(false);
      setFindingDriver(false);
      setDriverFound(false);
      setDestination('');
      setSelectedDest(null);
      setCurrentRideFree(false);
      setDriverLocation(null);
      setDriverEta(0);
      driverPathRef.current = [];
      driverPathIndexRef.current = 0;
      approachingPlayedRef.current = false;
      setDriverRoutePath([]);
      setTripStarted(false);
      setTripRoutePath([]);
      setTripDriverLocation(null);
      setTripEta(0);
      setTripCompleted(false);
      tripPathRef.current = [];
      tripPathIndexRef.current = 0;
      setCurrentDriver(null);
      setPreviousDriverIds([]);
      setCurrentBackendRideId(null);
      setActiveRideRecipient(null);
      setActiveRideForOther(false);
      setActiveRidePaymentMode('customer_app');
      setActiveRideShareBySms(true);
      setActiveRideShareByWhatsApp(true);
      setActiveRideLiveTracking(true);
      resetRideForOtherDraft();
      if (driverCancelTimerRef.current) { clearTimeout(driverCancelTimerRef.current); driverCancelTimerRef.current = null; }
      Alert.alert('Yolculuk Tamamlandı', 'İyi yolculuklar! 2GO ile güvenle ulaştınız.');
    });
  }, [ratingScaleAnim, resetRideForOtherDraft]);

  const CUSTOMER_CANCEL_REASONS = [
    { key: 'driver_not_coming', label: 'Şoför gelmiyor' },
    { key: 'long_wait', label: 'Çok uzun bekleme süresi' },
    { key: 'wrong_destination', label: 'Yanlış adres girdim' },
    { key: 'found_alternative', label: 'Başka ulaşım buldum' },
    { key: 'changed_mind', label: 'Vazgeçtim' },
    { key: 'other', label: 'Diğer' },
  ];

  const resetRideStates = useCallback(() => {
    lastBackendRideStatusRef.current = null;
    completionHandledRideIdRef.current = null;
    cancellationHandledRideIdRef.current = null;
    setRideRequested(false);
    setFindingDriver(false);
    setDriverFound(false);
    setDestination('');
    setSelectedDest(null);
    setCurrentRideFree(false);
    setDriverLocation(null);
    setDriverEta(0);
    driverPathRef.current = [];
    driverPathIndexRef.current = 0;
    approachingPlayedRef.current = false;
    setDriverRoutePath([]);
    setTripStarted(false);
    setTripRoutePath([]);
    setTripDriverLocation(null);
    setRidePickupOverride(null);
    setTripEta(0);
    setTripCompleted(false);
    setCustomerConfirmedArrival(false);
    tripPathRef.current = [];
    tripPathIndexRef.current = 0;
    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }
    if (tripIntervalRef.current) {
      clearInterval(tripIntervalRef.current);
      tripIntervalRef.current = null;
    }
    setCurrentDriver(null);
    setPreviousDriverIds([]);
    setDriverSearchStatus('Yakınlarınızdaki şoförler kontrol ediliyor');
    setCurrentBackendRideId(null);
    setActiveRideRecipient(null);
    setActiveRideForOther(false);
    setActiveRidePaymentMode('customer_app');
    setActiveRideShareBySms(true);
    setActiveRideShareByWhatsApp(true);
    setActiveRideLiveTracking(true);
    resetRideForOtherDraft();
    if (driverCancelTimerRef.current) { clearTimeout(driverCancelTimerRef.current); driverCancelTimerRef.current = null; }
  }, [resetRideForOtherDraft]);

  resetRideStatesRef.current = resetRideStates;

  const handleCancelRide = useCallback(() => {
    if (customerConfirmedArrival) {
      Alert.alert(
        'İptal Edilemez',
        'Şoförün gelişini onayladınız. Artık yolculuğu iptal edemezsiniz ve yolculuk bedelini ödemekle yükümlüsünüz.',
        [{ text: 'Tamam' }]
      );
      return;
    }
    if (driverFound) {
      setShowCancelReasonModal(true);
      setSelectedCancelReason('');
    } else {
      Alert.alert(
        'Yolculuğu İptal Et',
        'Yolculuğu iptal etmek istediğinize emin misiniz?',
        [
          { text: 'Vazgeç', style: 'cancel' },
          {
            text: 'İptal Et',
            style: 'destructive',
            onPress: () => {
              resetRideStates();
              console.log('[Customer] Ride cancelled (no driver assigned)');
            },
          },
        ]
      );
    }
  }, [driverFound, resetRideStates, customerConfirmedArrival]);

  const handleAcceptAlternative = useCallback(async () => {
    if (!alternativeVehicle) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const newType = alternativeVehicle.vehicleType;
    const newDriver = alternativeVehicle.driver;
    console.log('[Customer] Accepted alternative:', newType, newDriver.shortName);
    setSelectedVehiclePackage(newType);
    setShowAlternativeSuggestion(false);
    setAlternativeVehicle(null);

    if (selectedDest) {
      const dist = rideDistance > 0 ? rideDistance : calculateDistance(mapRegion.latitude, mapRegion.longitude, selectedDest.latitude, selectedDest.longitude);
      const price = calculatePrice(dist, newType as VehicleType);
      setRidePrice(price);
      console.log('[Customer] Updated price for', newType, ':', price);
    }

    setCurrentDriver(newDriver);
    setPreviousDriverIds(prev => [...prev, newDriver.id]);

    if (selectedDest) {
      const customerLat = mapRegion.latitude;
      const customerLng = mapRegion.longitude;
      const angle = Math.random() * 2 * Math.PI;
      const offsetDist = 0.025 + Math.random() * 0.02;
      const driverStart = {
        latitude: customerLat + Math.cos(angle) * offsetDist,
        longitude: customerLng + Math.sin(angle) * offsetDist,
      };
      const rawPath = await fetchDriverRoute(driverStart, { latitude: customerLat, longitude: customerLng });
      const path = densifyPath(rawPath, 80);
      driverPathRef.current = path;
      driverPathIndexRef.current = 0;
      setDriverLocation(path[0]);
      setDriverRoutePath(path);
      const etaMinutes = Math.max(2, Math.ceil(path.length * 0.6 / 10));
      setDriverEta(etaMinutes);
    }

    setDriverFound(true);
  }, [alternativeVehicle, selectedDest, rideDistance, mapRegion.latitude, mapRegion.longitude, fetchDriverRoute, densifyPath]);

  const handleRejectAlternative = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setShowAlternativeSuggestion(false);
    setAlternativeVehicle(null);
    resetRideStates();
    console.log('[Customer] Rejected alternative, ride cancelled');
  }, [resetRideStates]);

  const handleConfirmCancelWithReason = useCallback(async (reason: string) => {
    setShowCancelReasonModal(false);
    setSelectedCancelReason('');
    if (currentBackendRideId) {
      try {
        await ensureServerSession('customer-dashboard-cancel-ride');
        await cancelRideMutation.mutateAsync({ rideId: currentBackendRideId, cancelledBy: 'customer', cancelReason: reason });
        console.log('[Customer] Ride cancelled on backend:', currentBackendRideId);
      } catch (err) {
        console.log('[Customer] Cancel ride backend error:', err);
      }
    }
    setCurrentBackendRideId(null);
    resetRideStates();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    console.log('[Customer] Ride cancelled with reason:', reason);
    Alert.alert(
      'Yolculuk İptal Edildi',
      'Yolculuğunuz iptal edildi. Geri bildiriminiz için teşekkürler.',
      [{ text: 'Tamam' }]
    );
  }, [resetRideStates, currentBackendRideId, cancelRideMutation, ensureServerSession]);

  const handleShareWhatsAppLocation = useCallback(() => {
    const lat = mapRegion.latitude;
    const lng = mapRegion.longitude;
    const message = `2go şöförleri ile eve dönüyorum 📍 Canlı konumum: https://maps.google.com/maps?q=${lat},${lng}`;
    const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
    void Linking.openURL(whatsappUrl).catch(() => {
      Alert.alert('Hata', 'WhatsApp açılamadı. Lütfen WhatsApp yüklü olduğundan emin olun.');
    });
    console.log('[SOS] Sharing location via WhatsApp');
  }, [mapRegion.latitude, mapRegion.longitude]);

  const handleSendSMS = useCallback(() => {
    const lat = mapRegion.latitude;
    const lng = mapRegion.longitude;
    const message = `2go şöförleri ile eve dönüyorum 📍 Konumum: https://maps.google.com/maps?q=${lat},${lng}`;
    const smsUrl = Platform.OS === 'ios'
      ? `sms:&body=${encodeURIComponent(message)}`
      : `sms:?body=${encodeURIComponent(message)}`;
    void Linking.openURL(smsUrl).catch(() => {
      Alert.alert('Hata', 'SMS uygulaması açılamadı');
    });
    console.log('[SOS] Opening SMS with location');
  }, [mapRegion.latitude, mapRegion.longitude]);

  const handleSOS = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setShowSOSModal(true);
    console.log('[SOS] Opening SOS modal');
  }, []);

  const handleSOSCall112 = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    Linking.openURL('tel:112').catch(() => {
      Alert.alert('Hata', 'Arama uygulaması açılamadı');
    });
    console.log('[SOS] Calling 112');
  }, []);

  const handleSOSCall155 = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    Linking.openURL('tel:155').catch(() => {
      Alert.alert('Hata', 'Arama uygulaması açılamadı');
    });
    console.log('[SOS] Calling 155 Police');
  }, []);

  const _openInNativeMaps = useCallback((destLat: number, destLng: number, destName: string) => {
    const encodedName = encodeURIComponent(destName);
    const originLat = mapRegion.latitude;
    const originLng = mapRegion.longitude;

    if (Platform.OS === 'ios') {
      const appleUrl = `maps:0,0?q=${encodedName}&saddr=${originLat},${originLng}&daddr=${destLat},${destLng}`;
      void Linking.openURL(appleUrl).catch(() => {
        void Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}&travelmode=driving`);
      });
    } else if (Platform.OS === 'android') {
      const googleUrl = `google.navigation:q=${destLat},${destLng}`;
      void Linking.openURL(googleUrl).catch(() => {
        void Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}&travelmode=driving`);
      });
    } else {
      void Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}&travelmode=driving`);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    console.log('[Maps] Opening native maps for:', destName, 'Platform:', Platform.OS);
  }, [mapRegion.latitude, mapRegion.longitude]);

  useEffect(() => {
    if (rideMessagesQuery.data && rideMessagesQuery.data.length > 0) {
      const mapped = rideMessagesQuery.data.map((m: { id: string; text: string; senderId: string; createdAt: string }) => ({
        id: m.id,
        text: m.text,
        fromMe: m.senderId === user?.id,
        time: new Date(m.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      }));
      setChatMessages(mapped);
    }
  }, [rideMessagesQuery.data, user?.id]);

  const handleSendChat = useCallback(() => {
    if (!chatInput.trim()) return;
    const msgText = chatInput.trim();
    const newMsg = {
      id: 'msg_' + Date.now(),
      text: msgText,
      fromMe: true,
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages(prev => [...prev, newMsg]);
    setChatInput('');

    if (currentBackendRideId && user) {
      sendMessageMutation.mutate(
        {
          rideId: currentBackendRideId,
          senderId: user.id,
          senderName: user.name,
          senderType: 'customer',
          text: msgText,
        },
        {
          onSuccess: () => console.log('[Chat] Message sent to backend'),
          onError: (err) => console.log('[Chat] Backend send error:', err),
        }
      );
    }
    console.log('[Chat] Sent:', msgText);
  }, [chatInput, currentBackendRideId, user, sendMessageMutation]);

  const handleApplyPromo = useCallback(async () => {
    if (!promoInput.trim()) return;
    const success = await applyPromoCode(promoInput.trim());
    if (success) {
      Alert.alert('Tebrikler! 🎉', 'Promosyon kodu başarıyla uygulandı! İlk 2 sürüşünüz ücretsiz.');
      setPromoInput('');
      setShowPromo(false);
      Animated.timing(promoAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start();
    } else {
      Alert.alert('Hata', 'Geçersiz promosyon kodu veya daha önce kullanılmış.');
    }
  }, [promoInput, applyPromoCode, promoAnim]);

  const togglePromo = useCallback(() => {
    const newVal = !showPromo;
    setShowPromo(newVal);
    Animated.spring(promoAnim, {
      toValue: newVal ? 1 : 0,
      useNativeDriver: false,
    }).start();
  }, [showPromo, promoAnim]);


  const freeRidesLeft = remainingFreeRides();

  const cityBusinesses = useMemo<CourierBusiness[]>(() => {
    const backendBusinesses = businessesByCityQuery.data as CourierBusiness[] | undefined;
    const sourceBusinesses = backendBusinesses && backendBusinesses.length > 0
      ? backendBusinesses
      : getCourierBusinessesByCity(user?.city ?? '');
    const normalizedDistrict = user?.district?.trim().toLocaleLowerCase('tr-TR') ?? '';

    if (!normalizedDistrict) {
      return sourceBusinesses;
    }

    return [...sourceBusinesses].sort((firstBusiness, secondBusiness) => {
      const firstMatchesDistrict = firstBusiness.district?.trim().toLocaleLowerCase('tr-TR') === normalizedDistrict ? 1 : 0;
      const secondMatchesDistrict = secondBusiness.district?.trim().toLocaleLowerCase('tr-TR') === normalizedDistrict ? 1 : 0;
      return secondMatchesDistrict - firstMatchesDistrict;
    });
  }, [businessesByCityQuery.data, user?.city, user?.district]);

  const sponsorVenueName = useMemo(() => {
    const safeVenues = cityVenues.filter(v => v.safetyLevel && v.safetyLevel >= 2);
    if (safeVenues.length === 0) return null;
    return '2GO';
  }, [cityVenues]);

  const handleOpenCourier = useCallback(() => {
    if (cityBusinesses.length === 0 && !hasCouriersInCity) {
      Alert.alert(
        'İşletme Bulunamadı',
        `${user?.district ?? ''}, ${user?.city ?? 'Bu bölge'} için henüz kayıtlı işletme veya kurye bulunmamaktadır.`,
        [{ text: 'Tamam' }]
      );
      console.log('[Courier] No businesses or couriers in city/district:', user?.city, user?.district);
      return;
    }
    setShowCourierPanel(true);
    setSelectedCourierBiz(null);
    setCourierCart([]);
    console.log('[Courier] Opening courier panel for city:', user?.city, 'district:', user?.district, 'couriers:', cityCouriers.length, 'businesses:', cityBusinesses.length);
  }, [user?.city, user?.district, hasCouriersInCity, cityCouriers.length, cityBusinesses.length]);

  const handleSelectBusiness = useCallback((biz: CourierBusiness) => {
    setSelectedCourierBiz(biz);
    setCourierCart([]);
    console.log('[Courier] Selected business:', biz.name);
  }, []);

  const handleAddToCart = useCallback((menuItem: CourierMenuItem) => {
    setCourierCart(prev => {
      const existing = prev.find(c => c.menuItem.id === menuItem.id);
      if (existing) {
        return prev.map(c => c.menuItem.id === menuItem.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { menuItem, quantity: 1 }];
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    console.log('[Courier] Added to cart:', menuItem.name);
  }, []);

  const handleRemoveFromCart = useCallback((itemId: string) => {
    setCourierCart(prev => {
      const existing = prev.find(c => c.menuItem.id === itemId);
      if (existing && existing.quantity > 1) {
        return prev.map(c => c.menuItem.id === itemId ? { ...c, quantity: c.quantity - 1 } : c);
      }
      return prev.filter(c => c.menuItem.id !== itemId);
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  const courierCartTotal = useMemo(() => {
    return courierCart.reduce((sum, c) => sum + c.menuItem.price * c.quantity, 0);
  }, [courierCart]);

  const courierCartCount = useMemo(() => {
    return courierCart.reduce((sum, c) => sum + c.quantity, 0);
  }, [courierCart]);

  const handlePlaceCourierOrder = useCallback(async () => {
    if (!selectedCourierBiz || courierCart.length === 0) return;
    if (courierCartTotal < selectedCourierBiz.minOrder) {
      Alert.alert('Minimum Sipariş', `Minimum sipariş tutarı ₺${selectedCourierBiz.minOrder}`);
      return;
    }
    if (onlineCouriersCount === 0) {
      Alert.alert(
        'Çevrimiçi Kurye Yok',
        `Şu anda ${user?.district ?? ''}, ${user?.city ?? 'bu bölgede'} bölgesinde çevrimiçi kurye bulunmamaktadır. Lütfen daha sonra tekrar deneyin.`,
        [{ text: 'Tamam' }]
      );
      console.log('[Courier] No online couriers, order blocked');
      return;
    }

    try {
      await ensureServerSession('customer-dashboard-create-business-order');
      const result = await createBusinessOrderMutation.mutateAsync({
        customerId: user?.id ?? '',
        customerName: user?.name ?? 'Müşteri',
        city: user?.city ?? '',
        district: user?.district ?? '',
        businessId: selectedCourierBiz.id,
        businessName: selectedCourierBiz.name,
        businessImage: selectedCourierBiz.image,
        businessWebsite: selectedCourierBiz.website,
        pickupAddress: selectedCourierBiz.address,
        dropoffAddress: user?.city ? `${user.city}${user.district ? ` / ${user.district}` : ''}` : 'Teslimat Adresi',
        pickupLat: selectedCourierBiz.latitude,
        pickupLng: selectedCourierBiz.longitude,
        dropoffLat: mapRegion.latitude,
        dropoffLng: mapRegion.longitude,
        orderItems: courierCart.map((item) => ({
          id: item.menuItem.id,
          name: item.menuItem.name,
          quantity: item.quantity,
          unitPrice: item.menuItem.price,
        })),
        orderNote: courierCart.map((item) => `${item.quantity}x ${item.menuItem.name}`).join(', '),
        subtotal: courierCartTotal,
        deliveryFee: selectedCourierBiz.deliveryFee,
        duration: selectedCourierBiz.deliveryTime,
      });

      if (result.success && result.ride) {
        setCurrentBackendRideId(result.ride.id);
        setShowOrderSuccess(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        console.log('[Courier] Order created on backend:', result.ride.id, 'notified couriers:', result.notifiedCouriers ?? 0);
        return;
      }

      Alert.alert('Hata', 'Sipariş oluşturulamadı. Lütfen tekrar deneyin.');
    } catch (error) {
      console.log('[Courier] createBusinessOrder error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Sipariş oluşturulamadı. Lütfen tekrar deneyin.';
      Alert.alert('Hata', errorMessage);
    }
  }, [selectedCourierBiz, courierCart, courierCartTotal, onlineCouriersCount, user?.id, user?.name, user?.city, user?.district, mapRegion.latitude, mapRegion.longitude, createBusinessOrderMutation, ensureServerSession]);

  const handleCloseOrderSuccess = useCallback(() => {
    setShowOrderSuccess(false);
    setShowCourierPanel(false);
    setSelectedCourierBiz(null);
    setCourierCart([]);
  }, []);

  const handleCloseCourier = useCallback(() => {
    setShowCourierPanel(false);
    setSelectedCourierBiz(null);
    setCourierCart([]);
    setShowCustomOrder(false);
    setShowCustomOrderSuccess(false);
  }, []);

  const handleBackToBizList = useCallback(() => {
    setSelectedCourierBiz(null);
    setCourierCart([]);
    setShowCustomOrder(false);
  }, []);

  const handleOpenCustomOrder = useCallback(() => {
    setShowCustomOrder(true);
    setCustomOrderText('');
    setCustomOrderImages([]);
    setCustomOrderAddress('');
    setCustomOrderAddressDetail('');
    setCustomOrderLocationConfirmed(false);
    if (gpsLocation) {
      setCustomOrderLocation({ latitude: gpsLocation.latitude, longitude: gpsLocation.longitude });
    } else {
      setCustomOrderLocation(null);
    }
    console.log('[CustomOrder] Opened custom order form');
  }, [gpsLocation]);

  const handleCustomOrderPickImages = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('İzin Gerekli', 'Görsel eklemek için galeri erişim izni gerekiyor.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
        selectionLimit: 10,
      });
      if (!result.canceled && result.assets.length > 0) {
        setCustomOrderImages(prev => [...prev, ...result.assets.map(a => a.uri)]);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        console.log('[CustomOrder] Added images:', result.assets.length);
      }
    } catch (err) {
      console.log('[CustomOrder] Image pick error:', err);
      Alert.alert('Hata', 'Görsel seçilirken bir hata oluştu.');
    }
  }, []);

  const handleCustomOrderTakePhoto = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('İzin Gerekli', 'Fotoğraf çekmek için kamera erişim izni gerekiyor.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.8,
      });
      if (!result.canceled && result.assets.length > 0) {
        setCustomOrderImages(prev => [...prev, result.assets[0].uri]);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        console.log('[CustomOrder] Took photo');
      }
    } catch (err) {
      console.log('[CustomOrder] Camera error:', err);
      Alert.alert('Hata', 'Fotoğraf çekilirken bir hata oluştu.');
    }
  }, []);

  const handleRemoveCustomImage = useCallback((index: number) => {
    setCustomOrderImages(prev => prev.filter((_, i) => i !== index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  const handleConfirmCustomLocation = useCallback(() => {
    setCustomOrderLocationConfirmed(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    console.log('[CustomOrder] Location confirmed:', customOrderLocation);
  }, [customOrderLocation]);

  const handleSubmitCustomOrder = useCallback(() => {
    if (!customOrderText.trim()) {
      Alert.alert('Eksik Bilgi', 'Lütfen siparişinizle ilgili isteklerinizi yazın.');
      return;
    }
    if (!customOrderAddress.trim()) {
      Alert.alert('Eksik Bilgi', 'Lütfen adres bilgilerinizi girin.');
      return;
    }
    Keyboard.dismiss();
    setShowCustomOrderSuccess(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    console.log('[CustomOrder] Submitted:', {
      text: customOrderText,
      images: customOrderImages.length,
      address: customOrderAddress,
      location: customOrderLocation,
    });
  }, [customOrderText, customOrderImages, customOrderAddress, customOrderLocation]);

  const handleCloseCustomOrderSuccess = useCallback(() => {
    setShowCustomOrderSuccess(false);
    setShowCustomOrder(false);
    setShowCourierPanel(false);
    setCustomOrderText('');
    setCustomOrderImages([]);
    setCustomOrderAddress('');
    setCustomOrderAddressDetail('');
    setCustomOrderLocation(null);
    setCustomOrderLocationConfirmed(false);
  }, []);

  const router = useRouter();
  const searchParams = useLocalSearchParams<{ vehiclePackage?: string; openSearch?: string }>();

  useEffect(() => {
    if (searchParams.openSearch !== '1') {
      return;
    }

    const pkg = searchParams.vehiclePackage;
    if (pkg) {
      if (isRainy && (pkg === 'scooter' || pkg === 'motorcycle')) {
        console.log('[Vehicle] Weather restricted, forcing car:', pkg);
        setSelectedVehiclePackage('car');
        Alert.alert(
          'Hava Durumu Uyarısı',
          `Şu an yağışlı hava nedeniyle ${pkg === 'scooter' ? 'E-Scooter' : 'Motorsiklet'} hizmeti kullanılamaz. Otomobil seçildi.`,
        );
      } else {
        setSelectedVehiclePackage(pkg);
      }
      console.log('[Vehicle] Returned with package:', pkg);
    }

    setTimeout(() => {
      toggleSearch(true);
    }, 300);
  }, [searchParams.openSearch, searchParams.vehiclePackage, isRainy, toggleSearch]);

  const handleInlineVehicleChange = useCallback((pkg: string) => {
    if (isRainy && (pkg === 'scooter' || pkg === 'motorcycle')) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      Alert.alert('Hava Durumu Uyarısı', `Yağışlı hava nedeniyle ${pkg === 'scooter' ? 'E-Scooter' : 'Motorsiklet'} hizmeti şu an kullanılamaz.`);
      return;
    }
    setSelectedVehiclePackage(pkg);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (selectedDest) {
      const dist = rideDistance > 0 ? rideDistance : calculateDistance(mapRegion.latitude, mapRegion.longitude, selectedDest.latitude, selectedDest.longitude);
      const price = calculatePrice(dist, pkg as VehicleType);
      const duration = rideDuration > 0 ? rideDuration : estimateDuration(dist);
      setRidePrice(price);
      setRideDuration(duration);
      console.log(`[Vehicle] Changed to ${pkg}, new price: ₺${price}`);
    }
  }, [isRainy, selectedDest, rideDistance, rideDuration, mapRegion.latitude, mapRegion.longitude]);

  const handleOpenVehicleSelect = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    console.log('[RoutePicker] Opening destination composer from 2GO card');
    toggleSearch(true);
  }, [toggleSearch]);

  const handleOpenRideForOther = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    console.log('[RideForOther] Coming soon alert shown');
    Alert.alert('Yakında!', 'Başkasına çağır özelliği çok yakında aktif olacak.');
  }, []);

  return (
    <View style={styles.container}>

      {Platform.OS === 'web' ? (
        <WebMapFallback
          style={StyleSheet.absoluteFillObject}
          latitude={gpsLocation?.latitude ?? mapRegion.latitude}
          longitude={gpsLocation?.longitude ?? mapRegion.longitude}
          showUserLocation={true}
          zoom={16}
          markers={[
            ...(!rideRequested ? onlineDrivers.filter(d => d.location).map(d => ({
              id: d.id,
              latitude: d.location!.latitude,
              longitude: d.location!.longitude,
              title: d.name,
              emoji: '🚗',
            })) : []),
            ...(selectedDest ? [{
              id: 'destination',
              latitude: selectedDest.latitude,
              longitude: selectedDest.longitude,
              title: selectedDest.name,
              color: Colors.dark.accent,
            }] : []),
            ...(driverFound && !tripStarted && driverLocation ? [{
              id: 'driver',
              latitude: driverLocation.latitude,
              longitude: driverLocation.longitude,
              title: 'Şoförünüz',
              emoji: vehicleEmoji,
            }] : []),
            ...(tripStarted && tripDriverLocation ? [{
              id: 'trip-driver',
              latitude: tripDriverLocation.latitude,
              longitude: tripDriverLocation.longitude,
              title: 'Yolculuk',
              emoji: vehicleEmoji,
            }] : []),
          ] as WebMapMarker[]}
          polylines={[
            ...(driverFound && !tripStarted && driverRoutePath.length > 1 ? [{
              id: 'driver-route',
              coordinates: driverRoutePath,
              color: '#4A90E2',
              width: 5,
            }] : []),
            ...(tripStarted && tripRoutePath.length > 1 ? [{
              id: 'trip-route',
              coordinates: tripRoutePath,
              color: '#2ECC71',
              width: 5,
            }] : []),
          ] as WebMapPolyline[]}
        />
      ) : (
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        region={!hasAnimatedToGps.current && gpsLocation ? {
          latitude: gpsLocation.latitude,
          longitude: gpsLocation.longitude,
          latitudeDelta: 0.003,
          longitudeDelta: 0.003,
        } : undefined}
        initialRegion={mapRegion}

        showsUserLocation
        showsMyLocationButton={false}
        mapPadding={{ top: 0, right: 0, bottom: MAP_BOTTOM_PADDING, left: 0 }}
        onPanDrag={() => {
          userInteractingRef.current = true;
          setMapCentered(false);
        }}
      >
        <Marker
          coordinate={{ latitude: mapRegion.latitude, longitude: mapRegion.longitude }}
          title="Konumunuz"
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={Platform.OS === 'android'}
        >
          <View style={styles.userLocationMarker}>
            <View style={styles.userLocationOuter}>
              <View style={styles.userLocationInner} />
            </View>
          </View>
        </Marker>
        {!rideRequested && onlineDrivers.map((d) => (
          d.location ? (
            <Marker
              key={d.id}
              coordinate={{ latitude: d.location.latitude, longitude: d.location.longitude }}
              title={d.name}
              description={`${d.vehicleModel} • ${d.vehiclePlate}`}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={Platform.OS === 'android'}
            >
              <View style={styles.nearbyDriverMarker}>
                <Car size={14} color="#FFF" />
              </View>
            </Marker>
          ) : null
        ))}
        {selectedDest && (
          <Marker
            coordinate={{ latitude: selectedDest.latitude, longitude: selectedDest.longitude }}
            title={selectedDest.name}
            pinColor={Colors.dark.accent}
          />
        )}
        {driverFound && !tripStarted && driverLocation && (
          <Marker
            coordinate={driverLocation}
            title="Şoförünüz"
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={Platform.OS === 'android'}
          >
            <View style={styles.driverMarkerWithPrice}>
              <View style={styles.driverPriceBubble}>
                <Text style={styles.driverPriceText}>
                  {currentRideFree ? 'ÜCRETSİZ' : `₺${ridePrice}`}
                </Text>
              </View>
              <View style={styles.driverPriceArrow} />
              <View style={[styles.driverCarMarker, Platform.OS === 'android' ? styles.driverCarMarkerAndroid : {}, { backgroundColor: vehicleMarkerColor, shadowColor: vehicleMarkerColor }]}>
                <Text style={styles.vehicleMarkerEmoji}>{vehicleEmoji}</Text>
              </View>
              <View style={[styles.driverMarkerPulse, { borderColor: vehicleMarkerColor }]} />
            </View>
          </Marker>
        )}
        {driverFound && !tripStarted && driverLocation && driverRoutePath.length > 1 && (
          <Polyline
            coordinates={driverRoutePath}
            strokeColor="#4A90E2"
            strokeWidth={5}
          />
        )}
        {tripStarted && tripDriverLocation && (
          <Marker
            coordinate={tripDriverLocation}
            title="Yolculuk"
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={Platform.OS === 'android'}
          >
            <View style={styles.driverMarkerWithPrice}>
              <View style={[styles.driverPriceBubble, styles.tripPriceBubble]}>
                <Text style={styles.driverPriceText}>
                  {tripCompleted ? 'VARILDI' : `~${tripEta} dk`}
                </Text>
              </View>
              <View style={[styles.driverPriceArrow, styles.tripPriceArrow]} />
              <View style={[styles.driverCarMarker, styles.tripCarMarker, Platform.OS === 'android' ? styles.driverCarMarkerAndroid : {}, { shadowColor: vehicleMarkerColor }]}>
                <Text style={styles.vehicleMarkerEmoji}>{vehicleEmoji}</Text>
              </View>
            </View>
          </Marker>
        )}
        {tripStarted && tripRoutePath.length > 1 && (
          <Polyline
            coordinates={tripRoutePath}
            strokeColor="#2ECC71"
            strokeWidth={5}
          />
        )}
      </MapView>
      )}
      {!mapCentered && (
        <TouchableOpacity
          style={styles.recenterButton}
          onPress={() => {
            userInteractingRef.current = false;
            setMapCentered(true);
            if (mapRef.current) {
              if (tripStarted && tripDriverLocation && selectedDest) {
                const midLat = (tripDriverLocation.latitude + selectedDest.latitude) / 2;
                const midLng = (tripDriverLocation.longitude + selectedDest.longitude) / 2;
                mapRef.current.animateToRegion({
                  latitude: midLat,
                  longitude: midLng,
                  latitudeDelta: 0.04,
                  longitudeDelta: 0.04,
                }, 500);
              } else if (driverFound && driverLocation) {
                mapRef.current.animateToRegion({
                  latitude: (driverLocation.latitude + mapRegion.latitude) / 2,
                  longitude: (driverLocation.longitude + mapRegion.longitude) / 2,
                  latitudeDelta: 0.04,
                  longitudeDelta: 0.04,
                }, 500);
              } else if (gpsLocation) {
                mapRef.current.animateToRegion({
                  latitude: gpsLocation.latitude,
                  longitude: gpsLocation.longitude,
                  latitudeDelta: 0.008,
                  longitudeDelta: 0.008,
                }, 500);
                lastCenteredLocation.current = { latitude: gpsLocation.latitude, longitude: gpsLocation.longitude };
              }
            }
          }}
          activeOpacity={0.8}
        >
          <Navigation size={18} color={Colors.dark.primary} />
        </TouchableOpacity>
      )}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar} pointerEvents="box-none">
          <View style={styles.greeting}>
            <View style={styles.greetingRow}>
              <TouchableOpacity
                style={styles.hamburgerBtn}
                activeOpacity={0.7}
                onPress={() => router.push('/customer-menu' as any)}
                testID="hamburger-menu"
              >
                <Menu size={26} color="#000" strokeWidth={2.5} />
              </TouchableOpacity>

              {freeRidesLeft > 0 && (
                <View style={styles.freeRideBadge}>
                  <Gift size={14} color="#FFF" />
                  <Text style={styles.freeRideBadgeText}>{freeRidesLeft} ücretsiz</Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.rideForOtherEntry,
                styles.rideForOtherEntryTop,
                rideForOtherDraft.enabled && rideForOtherDraft.recipient && styles.rideForOtherEntryActive,
              ]}
              onPress={handleOpenRideForOther}
              activeOpacity={0.85}
              testID="ride-for-other-entry"
            >
              <View style={styles.rideForOtherEntryIcon}>
                <Share2 size={14} color="#16A34A" />
              </View>
              <View style={styles.rideForOtherEntryContent}>
                <Text style={[styles.rideForOtherEntryTitle, rideForOtherDraft.enabled && rideForOtherDraft.recipient && styles.rideForOtherEntryTitleActive]}>Başkasına çağır</Text>
                <Text style={[styles.rideForOtherEntrySubtitle, rideForOtherDraft.enabled && rideForOtherDraft.recipient && styles.rideForOtherEntrySubtitleActive]} numberOfLines={1}>
                  {rideForOtherDraft.enabled && rideForOtherDraft.recipient
                    ? `${rideForOtherDraft.recipient.name} • ${rideForOtherDraft.recipient.phone}`
                    : 'Bir yakınınız için yolculuk oluşturun'}
                </Text>
              </View>
              <ChevronRight size={16} color={rideForOtherDraft.enabled && rideForOtherDraft.recipient ? '#FFF' : '#7A7A93'} />
            </TouchableOpacity>
          </View>
        </View>
        {!rideRequested && !isSearching && (
          <View style={styles.homeBottomArea} onLayout={onPanelLayout}>
            <TouchableOpacity
              style={styles.referralBanner}
              activeOpacity={0.9}
              onPress={() => {
                if (!promoApplied) {
                  togglePromo();
                } else {
                  router.push('/dashboard/invite' as any);
                }
              }}
            >
              <Text style={styles.referralText}>Arkadaşını davet et, kazan!</Text>
              <View style={styles.referralBtn}>
                <Text style={styles.referralBtnText}>Davet et</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.homeBottomSheet} onLayout={onSheetLayout}>
              <View style={styles.sheetHandleWrap}>
                <View style={styles.sheetHandleBar} />
              </View>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.sheetContent}
                bounces={false}
                nestedScrollEnabled
                onScroll={(e) => { sheetScrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
                scrollEventThrottle={16}
                style={{ maxHeight: SCREEN_HEIGHT * 0.52 }}
              >
                {!promoApplied && showPromo && (
                  <View style={styles.promoInputAreaNew}>
                    <TextInput
                      style={styles.promoInputNew}
                      placeholder="Kodu girin (örn: 2GO2)"
                      placeholderTextColor="#999"
                      value={promoInput}
                      onChangeText={setPromoInput}
                      autoCapitalize="characters"
                      testID="promo-input"
                    />
                    <TouchableOpacity style={styles.promoApplyBtnNew} onPress={handleApplyPromo}>
                      <Text style={styles.promoApplyTextNew}>Uygula</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.searchBarNew}
                  onPress={() => toggleSearch(true)}
                  activeOpacity={0.7}
                  testID="search-destination"
                >
                  <Search size={22} color="#888" />
                  <Text style={styles.searchPlaceholderNew}>Nereye?</Text>
                </TouchableOpacity>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.recentScroll}
                  contentContainerStyle={styles.recentScrollContent}
                  nestedScrollEnabled
                >
                  <TouchableOpacity style={styles.recentChip} onPress={() => toggleSearch(true)}>
                    <Clock size={16} color="#666" />
                    <Text style={styles.recentChipText} numberOfLines={1}>
                      {user?.city ? `${user.city} Merkez` : 'Son Konum'}
                    </Text>
                  </TouchableOpacity>
                  {user?.district && (
                    <TouchableOpacity style={styles.recentChip} onPress={() => toggleSearch(true)}>
                      <Clock size={16} color="#666" />
                      <Text style={styles.recentChipText} numberOfLines={1}>{user.district}</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
                <View style={styles.serviceGrid}>
                  <TouchableOpacity
                    style={styles.mainServiceCard}
                    onPress={handleOpenVehicleSelect}
                    activeOpacity={0.85}
                  >
                    <View style={styles.mainServiceIconArea}>
                      <View style={styles.mainCarImageWrap}>
                        <Image
                          source={{ uri: customVehicleImage || 'https://r2-pub.rork.com/generated-images/2d3d4aed-cb54-47cd-b5a2-87fd37524e38.png' }}
                          style={styles.mainServiceCarImage}
                          resizeMode="contain"
                        />
                        <View style={styles.mainCarPlate}>
                          <View style={styles.mainCarPlateInner}>
                            <View style={styles.mainCarPlateBlueBand}>
                              <Text style={styles.mainCarPlateBlueBandText}>TR</Text>
                            </View>
                            <Text style={styles.mainCarPlateText}>{user?.vehiclePlate || '00 XX 000'}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                    <View style={styles.mainServiceLabel}>
                      <Car size={16} color="#2ECC71" strokeWidth={2.5} />
                      <Text style={styles.mainServiceName}>2GO</Text>
                    </View>
                    <Text style={styles.mainServiceDesc}>Alkol aldıysan, aracınla seni evine götürelim</Text>
                  </TouchableOpacity>
                  <View style={styles.sideServicesCol}>
                    <TouchableOpacity
                      style={[styles.sideServiceCard, { borderTopLeftRadius: 16, borderTopRightRadius: 16 }, isRainy && styles.sideServiceCardDisabled]}
                      onPress={() => {
                        if (isRainy) {
                          Alert.alert('Hava Durumu Uyarısı', 'Yağışlı hava nedeniyle E-Scooter hizmeti şu an kullanılamaz.');
                        } else {
                          Alert.alert('Yakında!', '2GO Scooter hizmeti çok yakında aktif olacak!');
                        }
                      }}
                      activeOpacity={isRainy ? 1 : 0.85}
                    >
                      {isRainy && (
                        <View style={styles.sideServiceWeatherBadge}>
                          <CloudRain size={10} color="#FFF" />
                        </View>
                      )}
                      <View style={styles.sideServiceRow}>
                        <Bird size={30} color={isRainy ? '#CCC' : '#2ECC71'} />
                        <View style={styles.sideServiceInfo}>
                          <View style={styles.sideServiceLabel}>
                            <Bird size={12} color={isRainy ? '#CCC' : '#2ECC71'} />
                            <Text style={[styles.sideServiceName, isRainy && { color: '#BBB' }]}>scooter</Text>
                          </View>
                          <Text style={styles.scooterTagText}>T*G DESTEK ÇOK YAKINDA</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.sideServiceCard, { borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }]}
                      onPress={handleOpenCourier}
                      activeOpacity={0.85}
                    >
                      <View style={styles.sideServiceRow}>
                        <Package size={30} color="#F5A623" />
                        <View style={styles.sideServiceInfo}>
                          <View style={styles.sideServiceLabel}>
                            <Package size={12} color="#F5A623" />
                            <Text style={styles.sideServiceName}>kurye</Text>
                          </View>
                          <Text style={styles.sideServiceDescText}>Sipariş oluştur</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
                {cityVenues.length > 0 && (
                  <View style={styles.venueSection}>
                    <View style={styles.venueSectionHeader}>
                      <Text style={styles.venueSectionTitle}>{user?.district ? `${user.district}, ${user.city}` : (user?.city ?? '')} Gözde Mekanlar</Text>
                      <View style={styles.venueSectionBadge}>
                        <Star size={10} color="#F5A623" fill="#F5A623" />
                        <Text style={styles.venueSectionBadgeText}>TOP 10</Text>
                      </View>
                    </View>
                    <Animated.View style={[styles.venueCard, { opacity: venueOpacity }]}>
                      <Image
                        source={{ uri: venuePhotos[cityVenues[activeVenueIndex]?.id] || cityVenues[activeVenueIndex]?.image }}
                        style={styles.venueImage}
                        resizeMode="cover"
                      />
                      <View style={styles.venueOverlay}>
                        <View style={styles.venueTopRow}>
                          <View style={styles.venueTopLeft}>
                            <View style={styles.venueCategoryBadge}>
                              <Text style={styles.venueCategoryText}>
                                {cityVenues[activeVenueIndex].category}
                              </Text>
                            </View>
  
                          </View>
                          <View style={styles.venueRatingBadge}>
                            <Star size={12} color="#F5A623" fill="#F5A623" />
                            <Text style={styles.venueRatingText}>
                              {cityVenues[activeVenueIndex].rating}
                            </Text>
                            <Text style={styles.venueReviewCount}>
                              ({cityVenues[activeVenueIndex].reviewCount})
                            </Text>
                          </View>
                        </View>
                        <View style={styles.venueBottom}>
                          <Text style={styles.venueName}>
                            {cityVenues[activeVenueIndex].name}
                          </Text>

                          <Text style={styles.venueAddress}>
                            {cityVenues[activeVenueIndex].address}
                          </Text>
                        </View>
                      </View>
                    </Animated.View>
                    <View style={styles.venueReviewCard}>
                      <View style={styles.venueReviewHeader}>
                        <View style={styles.venueReviewerAvatar}>
                          <Text style={styles.venueReviewerInitial}>
                            {cityVenues[activeVenueIndex].reviewer.charAt(0)}
                          </Text>
                        </View>
                        <View style={styles.venueReviewerInfo}>
                          <Text style={styles.venueReviewerName}>
                            {cityVenues[activeVenueIndex].reviewer}
                          </Text>
                          <View style={styles.venueReviewStars}>
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star
                                key={i}
                                size={10}
                                color={i < Math.floor(cityVenues[activeVenueIndex].rating) ? '#F5A623' : '#DDD'}
                                fill={i < Math.floor(cityVenues[activeVenueIndex].rating) ? '#F5A623' : 'transparent'}
                              />
                            ))}
                          </View>
                        </View>
                      </View>
                      <Text style={styles.venueReviewText} numberOfLines={2}>
                        {`“${cityVenues[activeVenueIndex].review}”`}
                      </Text>
                    </View>
                    <View style={styles.venueDotsRow}>
                      {cityVenues.map((_, i) => (
                        <TouchableOpacity
                          key={i}
                          onPress={() => {
                            setActiveVenueIndex(i);
                            venueProgress.setValue(0);
                            Animated.timing(venueProgress, {
                              toValue: 1,
                              duration: 10000,
                              useNativeDriver: false,
                            }).start();
                            Animated.sequence([
                              Animated.timing(venueOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
                              Animated.timing(venueOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
                            ]).start();
                          }}
                          activeOpacity={0.7}
                        >
                          <View style={[
                            styles.venueDot,
                            i === activeVenueIndex && styles.venueDotActive,
                          ]} />
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={styles.venueProgressBarBg}>
                      <Animated.View
                        style={[
                          styles.venueProgressBarFill,
                          {
                            width: venueProgress.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['0%', '100%'],
                            }),
                          },
                        ]}
                      />
                    </View>
                  </View>
                )}
                <TrendingMusicPlayer />

                <View style={styles.promoSectionNew} onLayout={onPromoSectionLayout}>
                  <View style={styles.promoBannerBadgeOnly}>
                    <Shield size={16} color="#FFD700" />
                    <Text style={styles.promoBannerBadgeOnlyText}>2GO GÜVENCESİ</Text>
                  </View>
                </View>

                <View style={styles.partnerVenueSection}>
                  <Image
                    source={{ uri: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=800&q=80' }}
                    style={styles.partnerVenueImage}
                    resizeMode="cover"
                  />
                  <View style={styles.partnerVenueOverlay}>
                    <View style={styles.partnerVenueBadge}>
                      <Shield size={14} color="#FFD700" />
                      <Text style={styles.partnerVenueBadgeText}>2GO İŞ BİRLİĞİ</Text>
                    </View>
                    <Text style={styles.partnerVenueText}>
                      Siz değerli müşterilerimizi ağırlayan, keyifli vakit ve yüksek memnuniyet yaşatan işletmeler, sizleri uğurlarken güvenliğinizi 2GO’ya emanet eder.
                    </Text>
                  </View>
                </View>

                <View style={styles.michelinStarSection}>
                  <View style={styles.michelinStarRow}>
                    <Star size={18} color="#FFD700" fill="#FFD700" />
                    <Star size={18} color="#FFD700" fill="#FFD700" />
                    <Star size={18} color="#FFD700" fill="#FFD700" />
                  </View>
                  <Text style={styles.michelinTitle}>2GO Kalite Yıldızı</Text>
                  <Text style={styles.michelinDesc}>
                    İş birliği yaptığımız işletmeler, hizmet kalitesi ve müşteri memnuniyetine göre yıldız ile derecelendirilecektir.
                  </Text>
                  <View style={styles.michelinDivider} />
                  <View style={styles.michelinInfoRow}>
                    <View style={styles.michelinInfoItem}>
                      <Star size={12} color="#FFD700" fill="#FFD700" />
                      <Text style={styles.michelinInfoText}>Onaylı İşletme</Text>
                    </View>
                    <View style={styles.michelinInfoItem}>
                      <Star size={12} color="#FFD700" fill="#FFD700" />
                      <Star size={12} color="#FFD700" fill="#FFD700" />
                      <Text style={styles.michelinInfoText}>Seçkin İşletme</Text>
                    </View>
                    <View style={styles.michelinInfoItem}>
                      <Star size={12} color="#FFD700" fill="#FFD700" />
                      <Star size={12} color="#FFD700" fill="#FFD700" />
                      <Star size={12} color="#FFD700" fill="#FFD700" />
                      <Text style={styles.michelinInfoText}>Premium</Text>
                    </View>
                  </View>
                </View>

                {onlineDrivers.length > 0 && (
                  <View style={styles.nearbyDriversBannerNew}>
                    <Car size={14} color="#2ECC71" />
                    <Text style={styles.nearbyDriversTextNew}>
                      {onlineDrivers.length} şoför yakınlarda aktif
                    </Text>
                    <View style={styles.nearbyLiveDot} />
                  </View>
                )}
                <View style={styles.pricingInfoNew}>
                  <View style={styles.pricingRowNew}>
                    <Text style={styles.pricingLabelNew}>0 – 10 km</Text>
                  </View>
                  <View style={styles.pricingDividerNew} />
                  <View style={styles.pricingRowNew}>
                    <Text style={styles.pricingLabelNew}>10 km sonrası her km</Text>
                    <Text style={styles.pricingValueNew}>+₺{PRICING.extraPerKm}</Text>
                  </View>
                </View>
                <View style={styles.paymentInfoNew}>
                  <Banknote size={16} color="#2ECC71" />
                  <Text style={styles.paymentTextNew}>Nakit veya Kart ile Ödeme</Text>
                </View>

              </ScrollView>
            </View>
          </View>
        )}
        {isSearching && (
          <KeyboardAvoidingView
            style={styles.routePickerKeyboard}
            behavior="padding"
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
          >
            <SafeAreaView style={styles.routePickerSafeArea} edges={['top']}>
              <View style={styles.routePickerSurface}>
                <View style={styles.routePickerHeader}>
                  <TouchableOpacity
                    style={styles.routePickerHeaderButton}
                    onPress={() => { Keyboard.dismiss(); toggleSearch(false); }}
                    activeOpacity={0.7}
                    testID="route-picker-close"
                  >
                    <X size={22} color="#1A1A2E" />
                  </TouchableOpacity>
                  <View style={styles.routePickerHeaderContent}>
                    <Text style={styles.routePickerHeaderTitle}>Güzergahın</Text>
                    <Text style={styles.routePickerHeaderSubtitle}>Alış ve varış noktanı hızlıca düzenle</Text>
                  </View>
                  <View style={styles.routePickerHeaderSpacer} />
                </View>

                {rideForOtherDraft.enabled && rideForOtherDraft.recipient && (
                  <TouchableOpacity style={styles.rideForOtherSummaryCard} onPress={handleOpenRideForOther} activeOpacity={0.85}>
                    <View style={styles.rideForOtherSummaryHeader}>
                      <Text style={styles.rideForOtherSummaryTitle}>Misafir yolculuğu aktif</Text>
                      <Text style={styles.rideForOtherSummaryAction}>Düzenle</Text>
                    </View>
                    <Text style={styles.rideForOtherSummaryName}>{rideForOtherDraft.recipient.name}</Text>
                    <Text style={styles.rideForOtherSummaryPhone}>{rideForOtherDraft.recipient.phone}</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.routeComposerRow}>
                  <View style={styles.routeComposerInputs}>
                    <View style={styles.routeComposerOriginField}>
                      <View style={styles.routeComposerOriginDot} />
                      <View style={styles.routeComposerOriginTextWrap}>
                        <Text style={styles.routeComposerFieldLabel}>Alış noktası</Text>
                        <Text style={styles.routeComposerOriginText} numberOfLines={1}>{currentLocationLabel}</Text>
                      </View>
                    </View>
                    <View style={styles.routeComposerDestinationField}>
                      <View style={styles.routeComposerSearchIconWrap}>
                        <Search size={20} color="#111111" />
                      </View>
                      <View style={styles.routeComposerDestinationTextWrap}>
                        <Text style={styles.routeComposerFieldLabel}>Varış noktası</Text>
                        <TextInput
                          style={styles.routeComposerDestinationInput}
                          placeholder="Adres veya mekan ara"
                          placeholderTextColor="#A6AAB6"
                          value={destination}
                          onChangeText={(text) => {
                            setDestination(text);
                            setSelectedDest(null);
                            void fetchPredictions(text);
                          }}
                          autoFocus
                          testID="destination-input"
                        />
                      </View>
                      <TouchableOpacity
                        style={styles.routeComposerMapButton}
                        onPress={handleRoutePickerMapSelection}
                        activeOpacity={0.7}
                        testID="route-picker-map-button"
                      >
                        <MapPinned size={17} color="#5E6475" />
                      </TouchableOpacity>
                      {(autoCompleteLoading || placesLoading) && (
                        <ActivityIndicator size="small" color={Colors.dark.primary} style={styles.routeComposerSpinner} />
                      )}
                    </View>
                  </View>
                  <View style={styles.routeComposerActions}>
                    <TouchableOpacity
                      style={styles.routeComposerActionButton}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                        Alert.alert('Yakında', 'Çok duraklı rota özelliği çok yakında aktif olacak.');
                      }}
                      activeOpacity={0.7}
                      testID="route-picker-add-stop"
                    >
                      <Plus size={20} color="#6E7385" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.routeComposerActionButton}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                        setDestination('');
                        setSelectedDest(null);
                        clearPredictions();
                        console.log('[RoutePicker] Destination input reset');
                      }}
                      activeOpacity={0.7}
                      testID="route-picker-reset"
                    >
                      <ArrowUpDown size={18} color="#6E7385" />
                    </TouchableOpacity>
                  </View>
                </View>

                <ScrollView
                  style={styles.routePickerList}
                  contentContainerStyle={styles.routePickerListContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={styles.routePickerSectionLabel}>
                    {showGoogleResults ? 'Adres önerileri' : 'Son aramalar ve hızlı seçimler'}
                  </Text>

                  <View style={styles.routePickerRecentList}>
                    {showGoogleResults && predictions.length > 0 && predictions.map((prediction) => (
                      <TouchableOpacity
                        key={prediction.place_id}
                        style={styles.routePickerRecentRow}
                        onPress={async () => {
                          console.log('[Selection] Tapped prediction:', prediction.place_id, prediction.description);
                          setPlacesLoading(true);
                          try {
                            const details = await getPlaceDetails(prediction.place_id);
                            setPlacesLoading(false);
                            if (details) {
                              console.log('[Selection] Got details:', details.name, details.latitude, details.longitude);
                              const dest: DestinationOption = {
                                name: prediction.structured_formatting?.main_text ?? details.name,
                                latitude: details.latitude,
                                longitude: details.longitude,
                              };
                              setDestination(dest.name);
                              clearPredictions();
                              void selectDestination(dest);
                              Keyboard.dismiss();
                            } else {
                              console.warn('[Selection] Details returned null for:', prediction.place_id);
                              Alert.alert('Hata', 'Adres detayları alınamadı. Lütfen tekrar deneyin.');
                            }
                          } catch (err) {
                            setPlacesLoading(false);
                            console.error('[Selection] Error getting details:', err);
                            Alert.alert('Hata', 'Adres seçilirken bir sorun oluştu.');
                          }
                        }}
                      >
                        <View style={styles.routePickerRecentIcon}>
                          <MapPin size={17} color={Colors.dark.primary} />
                        </View>
                        <View style={styles.routePickerRecentContent}>
                          <Text style={styles.routePickerRecentTitle} numberOfLines={1}>
                            {prediction.structured_formatting?.main_text ?? prediction.description}
                          </Text>
                          <Text style={styles.routePickerRecentSubtitle} numberOfLines={1}>
                            {prediction.structured_formatting?.secondary_text ?? ''}
                          </Text>
                        </View>
                        <View style={styles.routePickerRecentTrailing}>
                          <ChevronRight size={18} color="#C5C9D5" />
                        </View>
                      </TouchableOpacity>
                    ))}

                    {!showGoogleResults && routePickerRecentItems.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.routePickerRecentRow}
                        onPress={() => handleSelectRoutePickerItem(item)}
                        activeOpacity={0.8}
                        testID={`route-picker-quick-${item.id}`}
                      >
                        <View style={styles.routePickerRecentIcon}>
                          <Clock size={17} color="#8C90A1" />
                        </View>
                        <View style={styles.routePickerRecentContent}>
                          <Text style={styles.routePickerRecentTitle} numberOfLines={1}>{item.title}</Text>
                          <Text style={styles.routePickerRecentSubtitle} numberOfLines={1}>{item.subtitle}</Text>
                        </View>
                        <View style={styles.routePickerRecentTrailing}>
                          <ChevronRight size={18} color="#C5C9D5" />
                        </View>
                      </TouchableOpacity>
                    ))}

                    {showGoogleResults && predictions.length === 0 && !autoCompleteLoading && destination.length >= 2 && !selectedDest && (
                      <View style={styles.noResultRow}>
                        <Text style={styles.noResultText}>Sonuç bulunamadı, aramaya devam edin...</Text>
                      </View>
                    )}

                    {!showGoogleResults && routePickerRecentItems.length === 0 && (
                      <View style={styles.noResultRow}>
                        <Text style={styles.noResultText}>Henüz hızlı seçim bulunmuyor. Adres aramaya başlayın.</Text>
                      </View>
                    )}
                  </View>

                  <TouchableOpacity
                    style={styles.routePickerMapRow}
                    onPress={handleRoutePickerMapSelection}
                    activeOpacity={0.8}
                    testID="route-picker-map-selection"
                  >
                    <View style={styles.routePickerMapRowIcon}>
                      <MapPin size={18} color="#6E7385" />
                    </View>
                    <View style={styles.routePickerMapRowTextWrap}>
                      <Text style={styles.routePickerMapRowText}>Haritadan konum seç</Text>
                      <Text style={styles.routePickerMapRowSubtext}>Pini taşıyarak tam adres belirle</Text>
                    </View>
                    <ChevronRight size={18} color="#C5C9D5" />
                  </TouchableOpacity>

                  {selectedDest && (
                    <View style={styles.routePickerSelectedCard}>
                      <View style={styles.routePickerSelectedCardTopRow}>
                        <View style={styles.routePickerSelectedBadge}>
                          <Text style={styles.routePickerSelectedBadgeText}>Seçilen rota</Text>
                        </View>
                        <Text style={styles.routePickerSelectedPriceLabel}>Tahmini ücret</Text>
                      </View>
                      <View style={styles.routePickerSelectedCardBottomRow}>
                        <View style={styles.routePickerSelectedInfo}>
                          <Text style={styles.routePickerSelectedTitle} numberOfLines={1}>{selectedDest.name}</Text>
                          <View style={styles.routePickerSelectedMeta}>
                            <Text style={styles.routePickerSelectedMetaText}>{rideDistance} km</Text>
                            <Text style={styles.routePickerSelectedMetaDot}>•</Text>
                            <Text style={styles.routePickerSelectedMetaText}>~{rideDuration} dk</Text>
                          </View>
                        </View>
                        <View style={styles.routePickerSelectedPriceWrap}>
                          <Text style={styles.routePickerSelectedPrice}>{isFreeRide() ? 'Ücretsiz' : `₺${ridePrice}`}</Text>
                        </View>
                      </View>
                    </View>
                  )}

                  {selectedDest && (
                    <View style={styles.rideSummary}>
                      <Text style={styles.vehicleSelectInlineTitle}>Araç paketini seç</Text>
                      <View style={styles.vehicleSelectInlineRow}>
                        {(['scooter', 'car', 'motorcycle'] as const).map((pkg) => {
                          const isSelected = selectedVehiclePackage === pkg;
                          const isRestricted = isRainy && (pkg === 'scooter' || pkg === 'motorcycle');
                          const config = pkg === 'scooter'
                            ? { emoji: '🛴', label: 'E-Scooter', price: calculatePrice(rideDistance, 'scooter'), color: '#2ECC71' }
                            : pkg === 'car'
                            ? { emoji: '🚗', label: 'Otomobil', price: calculatePrice(rideDistance, 'car'), color: Colors.dark.primary }
                            : { emoji: '🏍️', label: 'Motorsiklet', price: calculatePrice(rideDistance, 'motorcycle'), color: '#3498DB' };
                          return (
                            <TouchableOpacity
                              key={pkg}
                              style={[
                                styles.vehicleSelectInlineCard,
                                isSelected && styles.vehicleSelectInlineCardActive,
                                isSelected && { borderColor: config.color },
                                isRestricted && styles.vehicleSelectInlineCardDisabled,
                              ]}
                              onPress={() => handleInlineVehicleChange(pkg)}
                              activeOpacity={isRestricted ? 1 : 0.7}
                              testID={`inline-vehicle-${pkg}`}
                            >
                              {isRestricted && (
                                <View style={styles.vehicleSelectInlineWeather}>
                                  <CloudRain size={10} color="#FFF" />
                                </View>
                              )}
                              <Text style={styles.vehicleSelectInlineEmoji}>{config.emoji}</Text>
                              <Text style={[
                                styles.vehicleSelectInlineLabel,
                                isSelected && { color: config.color, fontWeight: '700' as const },
                                isRestricted && { color: '#BBB' },
                              ]}>{config.label}</Text>
                              <Text style={[
                                styles.vehicleSelectInlinePrice,
                                isSelected && { color: config.color },
                                isRestricted && { color: '#CCC' },
                              ]}>
                                {isFreeRide() ? 'Ücretsiz' : `₺${config.price}`}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      {isRainy && (
                        <View style={styles.vehicleSelectInlineWeatherBanner}>
                          <CloudRain size={12} color="#E74C3C" />
                          <Text style={styles.vehicleSelectInlineWeatherText}>Yağışlı hava — Motor ve E-Scooter kullanılamaz</Text>
                        </View>
                      )}
                      <View style={styles.rideSummaryRow}>
                        <View style={styles.rideSummaryItem}>
                          <Text style={styles.rideSummaryLabel}>Mesafe</Text>
                          <Text style={styles.rideSummaryValue}>{rideDistance} km</Text>
                        </View>
                        <View style={styles.rideSummaryDivider} />
                        <View style={styles.rideSummaryItem}>
                          <Text style={styles.rideSummaryLabel}>Süre</Text>
                          <Text style={styles.rideSummaryValue}>~{rideDuration} dk</Text>
                        </View>
                        <View style={styles.rideSummaryDivider} />
                        <View style={styles.rideSummaryItem}>
                          <Text style={styles.rideSummaryLabel}>Ücret</Text>
                          {isFreeRide() ? (
                            <View style={styles.freePriceRow}>
                              <Text style={styles.rideSummaryValueStrike}>₺{ridePrice}</Text>
                              <Text style={styles.rideSummaryValueFree}>ÜCRETSİZ</Text>
                            </View>
                          ) : (
                            <Text style={[styles.rideSummaryValue, { color: Colors.dark.primary }]}>₺{ridePrice}</Text>
                          )}
                        </View>
                      </View>
                      <View style={styles.paymentMethodSelector}>
                        <TouchableOpacity
                          style={[styles.paymentMethodOption, paymentMethod === 'cash' && styles.paymentMethodOptionActive]}
                          onPress={() => { setPaymentMethod('cash'); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                          activeOpacity={0.7}
                        >
                          <Banknote size={18} color={paymentMethod === 'cash' ? '#FFF' : '#666'} />
                          <Text style={[styles.paymentMethodText, paymentMethod === 'cash' && styles.paymentMethodTextActive]}>Nakit</Text>
                        </TouchableOpacity>
                        <View style={{ flex: 1, alignItems: 'center' }}>
                          <TouchableOpacity
                            style={[styles.paymentMethodOption, { opacity: 0.45, flex: undefined, width: '100%' }]}
                            disabled={true}
                            activeOpacity={1}
                          >
                            <CreditCard size={18} color="#666" />
                            <Text style={styles.paymentMethodText}>Kart ile Öde</Text>
                          </TouchableOpacity>
                          <Text style={{ fontSize: 10, color: '#F59E0B', marginTop: 4, fontWeight: '600', letterSpacing: 0.3 }}>Yakında Gelecek</Text>
                        </View>
                      </View>
                    </View>
                  )}
                </ScrollView>

                <TouchableOpacity
                  style={[styles.confirmButton, styles.routePickerConfirmButton, !selectedDest && styles.confirmButtonDisabled]}
                  onPress={handleRequestRide}
                  disabled={!selectedDest || paymentLoading}
                  activeOpacity={0.85}
                  testID="route-picker-confirm"
                >
                  {paymentLoading ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <Text style={styles.confirmButtonText}>
                      {isFreeRide() && selectedDest ? 'Ücretsiz Sürüş Başlat' : paymentMethod === 'card' ? 'Kart ile Öde & Çağır' : 'Şoför Çağır'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </KeyboardAvoidingView>
        )}
        {rideRequested && findingDriver && !reassigning && (
          <View style={styles.statusPanel}>
            <ActivityIndicator size="large" color={Colors.dark.primary} />
            <Text style={styles.statusTitle}>Şoför Aranıyor...</Text>
            <Text style={styles.statusSub}>{driverSearchStatus}</Text>
            <TouchableOpacity style={styles.cancelButton} onPress={handleCancelRide}>
              <Text style={styles.cancelButtonText}>İptal Et</Text>
            </TouchableOpacity>
          </View>
        )}
        {showAlternativeSuggestion && alternativeVehicle && (
          <View style={styles.statusPanel}>
            <View style={styles.altSuggestionIcon}>
              <Text style={{ fontSize: 36 }}>
                {alternativeVehicle.vehicleType === 'car' ? '🚗' : alternativeVehicle.vehicleType === 'motorcycle' ? '🏍️' : '🛴'}
              </Text>
            </View>
            <Text style={styles.statusTitle}>
              {getVehicleTypeLabel(selectedVehiclePackage)} İçin Şoför Yok
            </Text>
            <Text style={styles.statusSub}>
              Şu an {getVehicleTypeLabel(selectedVehiclePackage)} paketinde müsait şoför bulunmuyor.{' '}
              {getVehicleTypeLabel(alternativeVehicle.vehicleType)} paketinde {alternativeVehicle.driver.shortName} müsait!
            </Text>
            <View style={styles.altDriverPreview}>
              <View style={styles.altDriverAvatar}>
                <Text style={styles.altDriverAvatarText}>{alternativeVehicle.driver.initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.altDriverName}>{alternativeVehicle.driver.shortName}</Text>
                <Text style={styles.altDriverVehicle}>{alternativeVehicle.driver.vehicleModel} • {alternativeVehicle.driver.vehiclePlate}</Text>
                <Text style={styles.altDriverRating}>⭐ {alternativeVehicle.driver.rating} • {alternativeVehicle.driver.totalRides} yolculuk</Text>
              </View>
            </View>
            {selectedDest && (
              <View style={styles.altPriceRow}>
                <Text style={styles.altPriceLabel}>Yeni fiyat:</Text>
                <Text style={styles.altPriceValue}>
                  ₺{calculatePrice(
                    rideDistance > 0 ? rideDistance : calculateDistance(mapRegion.latitude, mapRegion.longitude, selectedDest.latitude, selectedDest.longitude),
                    alternativeVehicle.vehicleType as VehicleType
                  )}
                </Text>
              </View>
            )}
            <TouchableOpacity style={styles.altAcceptBtn} onPress={handleAcceptAlternative} activeOpacity={0.85}>
              <Text style={styles.altAcceptText}>{getVehicleTypeLabel(alternativeVehicle.vehicleType)} ile Devam Et</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.altRejectBtn} onPress={handleRejectAlternative} activeOpacity={0.85}>
              <Text style={styles.altRejectText}>Vazgeç</Text>
            </TouchableOpacity>
          </View>
        )}
        {reassigning && (
          <View style={styles.statusPanel}>
            <View style={styles.reassignBanner}>
              <AlertTriangle size={24} color="#F5A623" />
            </View>
            <ActivityIndicator size="large" color={Colors.dark.primary} style={{ marginTop: 12 }} />
            <Text style={styles.statusTitle}>Yeni Şoför Atanıyor...</Text>
            <Text style={styles.statusSub}>Şoförünüz yolculuğu iptal etti. Hemen yeni bir şoför bulunuyor.</Text>
          </View>
        )}
        {rideRequested && driverFound && !tripStarted && (
          <View style={styles.driverPanel}>
            <View style={styles.driverPanelHandle} />
            {driverEta > 0 ? (
              <View style={styles.etaBanner}>
                <View style={styles.etaPulse}>
                  <Car size={16} color={Colors.dark.primary} />
                </View>
                <View style={styles.etaContent}>
                  <Text style={styles.etaLabel}>Şoför yolda</Text>
                  <Text style={styles.etaValue}>~{driverEta} dk içinde varış</Text>
                </View>
                <View style={styles.etaLive}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>CANLI</Text>
                </View>
              </View>
            ) : (
              <View style={styles.arrivedBanner}>
                <Text style={styles.arrivedEmoji}>{vehicleEmoji}</Text>
                <Text style={styles.arrivedText}>Şoförünüz geldi!</Text>
              </View>
            )}
            <View style={styles.driverCard}>
              <View style={styles.driverAvatarNew}>
                <Text style={styles.driverAvatarText}>{currentDriver?.initials ?? 'XX'}</Text>
                <View style={styles.driverAvatarBadge}>
                  <Star size={8} color="#FFF" />
                </View>
              </View>
              <View style={styles.driverDetails}>
                <Text style={styles.driverName}>{currentDriver?.shortName ?? 'Şoför'}</Text>
                <Text style={styles.driverVehicle}>{currentDriver?.vehicleModel ?? 'Araç'} • {currentDriver?.vehiclePlate ?? ''}</Text>
                <View style={styles.ratingRow}>
                  <Text style={styles.ratingText}>⭐ {currentDriver?.rating ?? 4.5}</Text>
                  <Text style={styles.ratingCount}>• {currentDriver?.totalRides ?? 0} yolculuk</Text>
                </View>
              </View>
              <View style={styles.contactButtons}>
                <TouchableOpacity style={styles.contactBtnNew} onPress={() => {
                  Linking.openURL(`tel:${currentDriver?.phone ?? '+905001234567'}`).catch(() => {});
                }}>
                  <Phone size={18} color="#FFF" />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.contactBtnNew, styles.contactBtnChat]} onPress={() => setShowChatModal(true)}>
                  <MessageCircle size={18} color={Colors.dark.primary} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.tripStatsRow}>
              <View style={styles.tripStatItem}>
                <Text style={styles.tripStatValue}>{rideDistance} km</Text>
                <Text style={styles.tripStatLabel}>Mesafe</Text>
              </View>
              <View style={styles.tripStatDivider} />
              <View style={styles.tripStatItem}>
                <Text style={styles.tripStatValue}>~{rideDuration} dk</Text>
                <Text style={styles.tripStatLabel}>Süre</Text>
              </View>
              <View style={styles.tripStatDivider} />
              <View style={styles.tripStatItem}>
                {currentRideFree ? (
                  <Text style={[styles.tripStatValue, { color: Colors.dark.success }]}>ÜCRETSİZ</Text>
                ) : (
                  <Text style={[styles.tripStatValue, { color: Colors.dark.primary }]}>₺{ridePrice}</Text>
                )}
                <Text style={styles.tripStatLabel}>Ücret</Text>
              </View>
            </View>
            <View style={[styles.paymentPill, paymentMethod === 'card' && styles.paymentPillCard]}>
              <View style={styles.paymentPillIcon}>
                {paymentMethod === 'card' ? <CreditCard size={14} color="#1A73E8" /> : <Banknote size={14} color={Colors.dark.success} />}
              </View>
              <Text style={[styles.paymentPillText, paymentMethod === 'card' && { color: '#1A73E8' }]}>
                {currentRideFree ? 'Ücretsiz sürüş uygulandı' : paymentMethod === 'card' ? 'Kart ile ödeme' : 'Nakit / IBAN ile ödeme'}
              </Text>
            </View>
            {activeRideForOther && activeRideRecipient && (
              <View style={styles.activeRideGuestCard}>
                <Text style={styles.activeRideGuestTitle}>Bu yolculuk {activeRideRecipient.name} için oluşturuldu</Text>
                <Text style={styles.activeRideGuestSubtitle}>{activeRideRecipient.phone} • {activeRidePaymentMode === 'customer_app' ? 'Ücreti sen ödersin' : 'Misafir araçta öder'}</Text>
                <View style={styles.activeRideGuestTags}>
                  {activeRideShareBySms && <Text style={styles.activeRideGuestTag}>SMS</Text>}
                  {activeRideShareByWhatsApp && <Text style={styles.activeRideGuestTag}>WhatsApp</Text>}
                  {activeRideLiveTracking && <Text style={styles.activeRideGuestTag}>Canlı takip</Text>}
                </View>
              </View>
            )}
            <View style={styles.driverActionRow}>
              {!customerConfirmedArrival && (
                <TouchableOpacity style={styles.cancelBtnNew} onPress={handleCancelRide} activeOpacity={0.8}>
                  <Text style={styles.cancelBtnNewText}>İptal Et</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.sosBtnNew} onPress={handleSOS} activeOpacity={0.8}>
                <Shield size={15} color="#FFF" />
                <Text style={styles.sosBtnNewText}>SOS</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {rideRequested && tripStarted && (
          <View style={styles.driverPanel}>
            <View style={styles.driverPanelHandle} />
            {customerConfirmedArrival && !tripCompleted && (
              <View style={styles.paymentObligationBanner}>
                <Banknote size={16} color="#E74C3C" />
                <Text style={styles.paymentObligationText}>
                  Yolculuk onaylandı • İptal edilemez • Ücret: {currentRideFree ? 'Ücretsiz' : `₺${ridePrice}`}
                </Text>
              </View>
            )}
            {!tripCompleted && (
              <View style={styles.tripActiveBanner}>
                <View style={styles.tripActiveIcon}>
                  <Navigation size={16} color="#FFF" />
                </View>
                <View style={styles.etaContent}>
                  <Text style={styles.tripActiveLabel}>Yolculuk Devam Ediyor</Text>
                  <Text style={styles.tripActiveValue}>{selectedDest?.name ?? 'Hedefe'} • ~{tripEta} dk</Text>
                </View>
                <View style={styles.etaLive}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>CANLI</Text>
                </View>
              </View>
            )}
            {tripCompleted && (
              <View style={styles.tripArrivedBanner}>
                <Text style={styles.arrivedEmoji}>🎉</Text>
                <Text style={styles.tripArrivedText}>Çok Memnun Oldum, Görüşmek Üzere!</Text>
              </View>
            )}
            <View style={styles.driverInfo}>
              <View style={styles.driverAvatar}>
                <Text style={styles.driverAvatarText}>{currentDriver?.initials ?? 'XX'}</Text>
              </View>
              <View style={styles.driverDetails}>
                <Text style={styles.driverName}>{currentDriver?.shortName ?? 'Şoför'}</Text>
                <Text style={styles.driverVehicle}>{currentDriver?.vehicleModel ?? 'Araç'} • {currentDriver?.vehiclePlate ?? ''}</Text>
                <View style={styles.ratingRow}>
                  <Text style={styles.ratingText}>⭐ {currentDriver?.rating ?? 4.5}</Text>
                  <Text style={styles.ratingCount}>{currentDriver?.totalRides ?? 0} yolculuk</Text>
                </View>
              </View>
              <View style={styles.contactButtons}>
                <TouchableOpacity style={styles.contactBtn} onPress={() => {
                  Linking.openURL(`tel:${currentDriver?.phone ?? '+905001234567'}`).catch(() => {});
                }}>
                  <Phone size={16} color={Colors.dark.primary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.contactBtn} onPress={() => setShowChatModal(true)}>
                  <MessageCircle size={16} color={Colors.dark.primary} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.tripRouteInfo}>
              <View style={styles.tripRoutePoint}>
                <View style={styles.tripRouteDotGreen} />
                <Text style={styles.tripRouteText} numberOfLines={1}>
                  {user?.city ? `${user.city}${user.district ? ' / ' + user.district : ''}` : 'Başlangıç'}
                </Text>
              </View>
              <View style={styles.tripRouteLine} />
              <View style={styles.tripRoutePoint}>
                <View style={styles.tripRouteDotRed} />
                <Text style={styles.tripRouteText} numberOfLines={1}>{selectedDest?.name ?? 'Hedef'}</Text>
              </View>
            </View>

            {activeRideForOther && activeRideRecipient && (
              <View style={styles.activeRideGuestCard}>
                <Text style={styles.activeRideGuestTitle}>Yolculuk misafir adına takip ediliyor</Text>
                <Text style={styles.activeRideGuestSubtitle}>{activeRideRecipient.name} • {activeRideRecipient.phone}</Text>
                <View style={styles.activeRideGuestTags}>
                  {activeRideShareBySms && <Text style={styles.activeRideGuestTag}>SMS</Text>}
                  {activeRideShareByWhatsApp && <Text style={styles.activeRideGuestTag}>WhatsApp</Text>}
                  {activeRideLiveTracking && <Text style={styles.activeRideGuestTag}>Canlı takip</Text>}
                </View>
              </View>
            )}
            <View style={styles.tripInfo}>
              <View style={styles.tripInfoItem}>
                <Text style={styles.tripInfoLabel}>Mesafe</Text>
                <Text style={styles.tripInfoValue}>{rideDistance} km</Text>
              </View>
              <View style={styles.tripInfoDivider} />
              <View style={styles.tripInfoItem}>
                <Text style={styles.tripInfoLabel}>Kalan</Text>
                <Text style={styles.tripInfoValue}>~{tripEta} dk</Text>
              </View>
              <View style={styles.tripInfoDivider} />
              <View style={styles.tripInfoItem}>
                <Text style={styles.tripInfoLabel}>Ücret</Text>
                {currentRideFree ? (
                  <Text style={[styles.tripInfoValue, { color: Colors.dark.success }]}>ÜCRETSİZ</Text>
                ) : (
                  <Text style={[styles.tripInfoValue, { color: Colors.dark.primary }]}>₺{ridePrice}</Text>
                )}
              </View>
            </View>
            <View style={styles.actionButtons}>
              {tripCompleted && (
                <TouchableOpacity style={styles.completeButton} onPress={handleCompleteRide} activeOpacity={0.85}>
                  <Text style={styles.completeButtonText}>Yolculuğu Tamamla</Text>
                </TouchableOpacity>
              )}
              <View style={styles.actionRow}>
                {!tripCompleted && !customerConfirmedArrival && (
                  <TouchableOpacity style={styles.cancelButton} onPress={handleCancelRide}>
                    <Text style={styles.cancelButtonText}>İptal Et</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.sosButton} onPress={handleSOS}>
                  <Shield size={16} color="#FFF" />
                  <Text style={styles.sosButtonText}>SOS</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </SafeAreaView>
      {showReceiptModal && (
        <View style={styles.ratingOverlay}>
          <View style={styles.receiptModal}>
            <View style={styles.receiptHeader}>
              <View style={styles.receiptHeaderLeft}>
                <FileText size={28} color={Colors.dark.primary} />
                <Text style={styles.receiptTitle}>Yolculuk Fişi</Text>
              </View>
              <TouchableOpacity
                style={styles.receiptCloseX}
                onPress={() => setShowReceiptModal(false)}
                activeOpacity={0.7}
                testID="receipt-close-x"
              >
                <X size={20} color={'#888'} />
              </TouchableOpacity>
            </View>
            <View style={styles.receiptDivider} />
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Nereden</Text>
              <Text style={styles.receiptValue} numberOfLines={1}>
                {user?.city ? `${user.city}${user.district ? ' / ' + user.district : ''}` : 'Mevcut Konum'}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Nereye</Text>
              <Text style={styles.receiptValue} numberOfLines={1}>{selectedDest?.name ?? '-'}</Text>
            </View>
            <View style={styles.receiptDivider} />
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Mesafe</Text>
              <Text style={styles.receiptValue}>{rideDistance} km</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Süre</Text>
              <Text style={styles.receiptValue}>~{rideDuration} dk</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Şoför</Text>
              <Text style={styles.receiptValue}>{currentDriver?.shortName ?? 'Şoför'} ⭐ {currentDriver?.rating ?? 4.5}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Ödeme</Text>
              <Text style={styles.receiptValue}>{currentRideFree ? 'Ücretsiz sürüş' : paymentMethod === 'card' ? 'Kredi/Banka Kartı' : 'Nakit'}</Text>
            </View>
            {activeRideForOther && activeRideRecipient && (
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Misafir</Text>
                <Text style={styles.receiptValue}>{activeRideRecipient.name} • {activeRideRecipient.phone}</Text>
              </View>
            )}
            <View style={styles.receiptDivider} />
            <View style={styles.receiptTotalRow}>
              <Text style={styles.receiptTotalLabel}>Toplam</Text>
              <Text style={styles.receiptTotalValue}>
                {currentRideFree ? 'ÜCRETSİZ' : `₺${ridePrice}`}
              </Text>
            </View>
            {sponsorVenueName && (
              <View style={styles.receiptSafetyBanner}>
                <Shield size={14} color="#FFD700" />
                <Text style={styles.receiptSafetyText}>
                  Bu gece güvenli eve dönüşünüzü {sponsorVenueName} destekledi
                </Text>
              </View>
            )}
            <Text style={styles.receiptDate}>
              {new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </Text>
            <TouchableOpacity style={styles.receiptCloseBtn} onPress={handleCloseReceipt} activeOpacity={0.85}>
              <Text style={styles.receiptCloseBtnText}>Değerlendir</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {showCancelReasonModal && (
        <View style={styles.ratingOverlay}>
          <View style={styles.cancelReasonModal}>
            <TouchableOpacity
              style={styles.sosModalCloseX}
              onPress={() => setShowCancelReasonModal(false)}
              activeOpacity={0.7}
            >
              <X size={22} color="#999" />
            </TouchableOpacity>
            <View style={styles.cancelReasonHeader}>
              <View style={styles.cancelReasonIconWrap}>
                <AlertTriangle size={28} color="#E74C3C" />
              </View>
              <Text style={styles.cancelReasonTitle}>İptal Sebebi</Text>
              <Text style={styles.cancelReasonSubtitle}>Lütfen iptal nedeninizi seçin</Text>
            </View>
            <View style={styles.cancelReasonList}>
              {CUSTOMER_CANCEL_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.key}
                  style={[
                    styles.cancelReasonItem,
                    selectedCancelReason === reason.key && styles.cancelReasonItemSelected,
                  ]}
                  onPress={() => setSelectedCancelReason(reason.key)}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.cancelReasonRadio,
                    selectedCancelReason === reason.key && styles.cancelReasonRadioSelected,
                  ]}>
                    {selectedCancelReason === reason.key && <View style={styles.cancelReasonRadioDot} />}
                  </View>
                  <Text style={[
                    styles.cancelReasonLabel,
                    selectedCancelReason === reason.key && styles.cancelReasonLabelSelected,
                  ]}>{reason.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[
                styles.cancelReasonConfirmBtn,
                !selectedCancelReason && styles.cancelReasonConfirmBtnDisabled,
              ]}
              onPress={() => {
                if (selectedCancelReason) {
                  const label = CUSTOMER_CANCEL_REASONS.find(r => r.key === selectedCancelReason)?.label ?? '';
                  void handleConfirmCancelWithReason(label);
                }
              }}
              disabled={!selectedCancelReason}
              activeOpacity={0.85}
            >
              <Text style={styles.cancelReasonConfirmBtnText}>İptal Et</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelReasonBackBtn}
              onPress={() => setShowCancelReasonModal(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelReasonBackBtnText}>Vazgeç</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {showSOSModal && (
        <View style={styles.ratingOverlay}>
          <View style={styles.sosModal}>
            <TouchableOpacity
              style={styles.sosModalCloseX}
              onPress={() => setShowSOSModal(false)}
              activeOpacity={0.7}
              testID="sos-close-x"
            >
              <X size={22} color="#555" />
            </TouchableOpacity>
            <View style={styles.sosModalIconWrap}>
              <Shield size={36} color="#E74C3C" />
            </View>
            <Text style={styles.sosModalTitle}>Acil Durum</Text>
            <Text style={styles.sosModalSub}>Güvende değilseniz aşağıdaki seçeneklerden birini kullanın. Konumunuz otomatik paylaşılabilir.</Text>
            <View style={styles.sosModalActions}>
              <TouchableOpacity style={styles.sosModalBtn112} onPress={handleSOSCall112} activeOpacity={0.8}>
                <Phone size={18} color="#FFF" />
                <Text style={styles.sosModalBtnText112}>112 Acil Ara</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sosModalBtn155} onPress={handleSOSCall155} activeOpacity={0.8}>
                <Phone size={18} color="#FFF" />
                <Text style={styles.sosModalBtnText155}>155 Polis</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sosModalBtnWA} onPress={() => { handleShareWhatsAppLocation(); setShowSOSModal(false); }} activeOpacity={0.8}>
                <Share2 size={18} color="#25D366" />
                <Text style={styles.sosModalBtnTextWA}>WhatsApp Konum Paylaş</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sosModalBtnSMS} onPress={() => { handleSendSMS(); setShowSOSModal(false); }} activeOpacity={0.8}>
                <MessageCircle size={18} color="#1A73E8" />
                <Text style={styles.sosModalBtnTextSMS}>SMS ile Konum Gönder</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
      {showChatModal && (
        <KeyboardAvoidingView
          style={styles.ratingOverlay}
          behavior="padding"
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <View style={styles.chatModal}>
            <View style={styles.chatHeader}>
              <View style={styles.chatHeaderLeft}>
                <View style={styles.chatAvatar}>
                  <Text style={styles.chatAvatarText}>{currentDriver?.initials ?? 'XX'}</Text>
                </View>
                <View>
                  <Text style={styles.chatHeaderName}>{currentDriver?.shortName ?? 'Şoför'}</Text>
                  <Text style={styles.chatHeaderSub}>Şoförünüz</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowChatModal(false)}>
                <X size={22} color={'#777'} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.chatMessages} contentContainerStyle={styles.chatMessagesContent}>
              {chatMessages.map((msg) => (
                <View key={msg.id} style={[styles.chatBubble, msg.fromMe ? styles.chatBubbleMine : styles.chatBubbleTheirs]}>
                  <Text style={[styles.chatBubbleText, msg.fromMe ? styles.chatBubbleTextMine : styles.chatBubbleTextTheirs]}>
                    {msg.text}
                  </Text>
                  <Text style={styles.chatBubbleTime}>{msg.time}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                placeholder="Mesaj yazın..."
                placeholderTextColor={'#999'}
                value={chatInput}
                onChangeText={setChatInput}
                testID="chat-input"
              />
              <TouchableOpacity style={styles.chatSendBtn} onPress={handleSendChat}>
                <Send size={18} color={'#FFF'} />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
      {showRatingModal && (
        <View style={styles.ratingOverlay}>
          <Animated.View style={[
            styles.ratingModal,
            {
              transform: [{
                scale: ratingScaleAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.8, 1],
                }),
              }],
              opacity: ratingScaleAnim,
            },
          ]}>
            <View style={styles.ratingModalHandle} />
            <Text style={styles.ratingModalTitle}>Yolculuğunuz Nasıldı?</Text>
            <Text style={styles.ratingModalSub}>{currentDriver?.shortName ?? 'Şoför'} için değerlendirme yapın</Text>
            <View style={styles.ratingStarsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={star}
                  onPress={() => setRatingStars(star)}
                  activeOpacity={0.7}
                  style={styles.starButton}
                  testID={`star-${star}`}
                >
                  <Star
                    size={40}
                    color={star <= ratingStars ? '#F5A623' : '#E0E0E8'}
                    fill={star <= ratingStars ? '#F5A623' : 'transparent'}
                  />
                </TouchableOpacity>
              ))}
            </View>
            {ratingStars > 0 && (
              <Text style={styles.ratingLabel}>
                {ratingStars === 1 ? 'Kötü' : ratingStars === 2 ? 'Fena Değil' : ratingStars === 3 ? 'İyi' : ratingStars === 4 ? 'Çok İyi' : 'Mükemmel!'}
              </Text>
            )}
            <View style={styles.commentInputWrapper}>
              <TextInput
                style={styles.commentInput}
                placeholder="Yorumunuzu yazın (isteğe bağlı)"
                placeholderTextColor={'#999'}
                value={ratingComment}
                onChangeText={setRatingComment}
                multiline
                maxLength={200}
                textAlignVertical="top"
                testID="rating-comment-input"
              />
              {ratingComment.length > 0 && (
                <Text style={styles.commentCount}>{ratingComment.length}/200</Text>
              )}
            </View>
            <TouchableOpacity
              style={[
                styles.submitRatingBtn,
                ratingStars === 0 && styles.submitRatingBtnDisabled,
              ]}
              onPress={handleSubmitRating}
              disabled={ratingStars === 0}
              activeOpacity={0.85}
              testID="submit-rating"
            >
              <Send size={18} color={ratingStars > 0 ? '#FFF' : '#999'} />
              <Text style={[
                styles.submitRatingText,
                ratingStars === 0 && styles.submitRatingTextDisabled,
              ]}>Değerlendir</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.skipRatingBtn}
              onPress={handleSkipRating}
              activeOpacity={0.7}
            >
              <Text style={styles.skipRatingText}>Geç</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}
      {showCourierPanel && !showOrderSuccess && (
        <View style={styles.courierOverlay}>
          <SafeAreaView style={styles.courierSafeArea}>
            <View style={styles.courierHeader}>
              <TouchableOpacity
                style={styles.courierBackBtn}
                onPress={(selectedCourierBiz || showCustomOrder) ? handleBackToBizList : handleCloseCourier}
                activeOpacity={0.7}
              >
                <ChevronLeft size={22} color="#1A1A2E" />
              </TouchableOpacity>
              <Text style={styles.courierHeaderTitle} numberOfLines={1}>
                {showCustomOrder ? 'Özel Sipariş' : selectedCourierBiz ? selectedCourierBiz.name : `${user?.city ?? ''} İşletmeleri`}
              </Text>
              <TouchableOpacity onPress={handleCloseCourier} activeOpacity={0.7}>
                <X size={20} color="#888" />
              </TouchableOpacity>
            </View>
            {showCustomOrder ? (
              <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior="padding"
                keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 60}
              >
                <ScrollView
                  style={styles.courierScrollView}
                  contentContainerStyle={[styles.courierScrollContent, { paddingBottom: 120 }]}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="interactive"
                >
                  <View style={styles.customOrderBanner}>
                    <Edit3 size={20} color="#FFF" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.customOrderBannerTitle}>İstediğinizi Yazın</Text>
                      <Text style={styles.customOrderBannerSub}>Detaylı açıklama yaparak siparişinizi oluşturun</Text>
                    </View>
                  </View>

                  <Text style={styles.customOrderSectionLabel}>Sipariş Detayı</Text>
                  <View style={styles.customOrderInputWrap}>
                    <TextInput
                      style={styles.customOrderTextInput}
                      placeholder="Ne istediğinizi detaylı olarak yazın... Örn: 2 adet büyük pizza, 1 kola, sos ekstra olsun"
                      placeholderTextColor="#AAA"
                      value={customOrderText}
                      onChangeText={setCustomOrderText}
                      multiline
                      textAlignVertical="top"
                      testID="custom-order-text"
                    />
                  </View>

                  <Text style={styles.customOrderSectionLabel}>Görseller (İsteğe Bağlı)</Text>
                  <Text style={styles.customOrderSectionHint}>Sipariş ile ilgili görsel ekleyebilirsiniz</Text>
                  <View style={styles.customOrderImagesRow}>
                    {customOrderImages.map((uri, idx) => (
                      <View key={`img-${idx}`} style={styles.customOrderImageWrap}>
                        <Image source={{ uri }} style={styles.customOrderImage} resizeMode="cover" />
                        <TouchableOpacity
                          style={styles.customOrderImageRemove}
                          onPress={() => handleRemoveCustomImage(idx)}
                          activeOpacity={0.7}
                        >
                          <X size={12} color="#FFF" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity
                      style={styles.customOrderAddImageBtn}
                      onPress={handleCustomOrderPickImages}
                      activeOpacity={0.8}
                    >
                      <ImagePlus size={24} color={Colors.dark.primary} />
                      <Text style={styles.customOrderAddImageText}>Galeri</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.customOrderAddImageBtn}
                      onPress={handleCustomOrderTakePhoto}
                      activeOpacity={0.8}
                    >
                      <Camera size={24} color={Colors.dark.primary} />
                      <Text style={styles.customOrderAddImageText}>Kamera</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.customOrderSectionLabel}>Teslimat Konumu</Text>
                  <View style={styles.customOrderMapWrap}>
                    {Platform.OS === 'web' ? (
                      <WebMapFallback
                        style={styles.customOrderMap}
                        latitude={customOrderLocation?.latitude ?? mapRegion.latitude}
                        longitude={customOrderLocation?.longitude ?? mapRegion.longitude}
                        zoom={16}
                        interactive={true}
                        onRegionChange={(lat, lng) => {
                          setCustomOrderLocation({ latitude: lat, longitude: lng });
                          setCustomOrderLocationConfirmed(false);
                        }}
                      />
                    ) : (
                      <MapView
                        ref={customOrderMapRef}
                        style={styles.customOrderMap}
                        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                        initialRegion={{
                          latitude: customOrderLocation?.latitude ?? mapRegion.latitude,
                          longitude: customOrderLocation?.longitude ?? mapRegion.longitude,
                          latitudeDelta: 0.005,
                          longitudeDelta: 0.005,
                        }}
                        onRegionChangeComplete={(region) => {
                          setCustomOrderLocation({ latitude: region.latitude, longitude: region.longitude });
                          setCustomOrderLocationConfirmed(false);
                        }}
                        showsUserLocation
                        showsMyLocationButton={false}
                      />
                    )}
                    <View style={styles.customOrderMapPin} pointerEvents="none">
                      <MapPinned size={32} color={Colors.dark.accent} />
                    </View>
                    {!customOrderLocationConfirmed ? (
                      <TouchableOpacity
                        style={styles.customOrderConfirmLocBtn}
                        onPress={handleConfirmCustomLocation}
                        activeOpacity={0.85}
                      >
                        <MapPin size={16} color="#FFF" />
                        <Text style={styles.customOrderConfirmLocText}>Konumu Onayla</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.customOrderLocConfirmed}>
                        <CheckCircle size={16} color="#2ECC71" />
                        <Text style={styles.customOrderLocConfirmedText}>Konum Onaylandı</Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.customOrderSectionLabel}>Adres Bilgileri</Text>
                  <View style={styles.customOrderAddressWrap}>
                    <TextInput
                      style={styles.customOrderAddressInput}
                      placeholder="Açık adres (Mahalle, sokak, bina no)"
                      placeholderTextColor="#AAA"
                      value={customOrderAddress}
                      onChangeText={setCustomOrderAddress}
                      multiline
                      textAlignVertical="top"
                      testID="custom-order-address"
                    />
                  </View>
                  <View style={[styles.customOrderAddressWrap, { marginTop: 10 }]}>
                    <TextInput
                      style={styles.customOrderAddressDetailInput}
                      placeholder="Adres tarifi (Kat, daire, zil ismi vb.)"
                      placeholderTextColor="#AAA"
                      value={customOrderAddressDetail}
                      onChangeText={setCustomOrderAddressDetail}
                      testID="custom-order-address-detail"
                    />
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.customOrderSubmitBtn,
                      (!customOrderText.trim() || !customOrderAddress.trim()) && styles.customOrderSubmitBtnDisabled,
                    ]}
                    onPress={handleSubmitCustomOrder}
                    activeOpacity={0.85}
                    disabled={!customOrderText.trim() || !customOrderAddress.trim()}
                  >
                    <Send size={18} color="#FFF" />
                    <Text style={styles.customOrderSubmitText}>Siparişi Gönder</Text>
                  </TouchableOpacity>
                </ScrollView>
              </KeyboardAvoidingView>
            ) : !selectedCourierBiz ? (
              <ScrollView
                style={styles.courierScrollView}
                contentContainerStyle={styles.courierScrollContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.courierActionRow}>
                  <TouchableOpacity
                    style={[styles.customOrderCard, { flex: 1, marginBottom: 0 }]}
                    onPress={handleOpenCustomOrder}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.customOrderCardGradient, { flexDirection: 'column', alignItems: 'flex-start', gap: 10, paddingVertical: 16 }]}>
                      <View style={styles.customOrderCardIcon}>
                        <Edit3 size={24} color="#FFF" />
                      </View>
                      <View style={styles.customOrderCardContent}>
                        <Text style={[styles.customOrderCardTitle, { fontSize: 15 }]}>Özel Sipariş</Text>
                        <Text style={styles.customOrderCardDesc}>İstediğiniz her şeyi yazın ve teslim edelim</Text>
                      </View>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.callCourierCard, { flex: 1 }]}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      Alert.alert('Kurye Çağır', 'Anlık kurye çağırmak istediğinizden emin misiniz?', [
                        { text: 'Vazgeç', style: 'cancel' },
                        { text: 'Kurye Çağır', onPress: () => console.log('[Courier] Call courier pressed') },
                      ]);
                    }}
                    activeOpacity={0.85}
                  >
                    <View style={styles.callCourierCardInner}>
                      <View style={styles.callCourierCardIcon}>
                        <Bike size={24} color="#FFF" />
                      </View>
                      <View style={styles.customOrderCardContent}>
                        <Text style={[styles.customOrderCardTitle, { fontSize: 15 }]}>Kurye Çağır</Text>
                        <Text style={styles.customOrderCardDesc}>Anlık kurye gönderin, hızlı teslimat</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                </View>

                <View style={styles.courierStatusBanner}>
                  <View style={[styles.courierStatusDot, { backgroundColor: onlineCouriersCount > 0 ? '#2ECC71' : cityCouriers.length > 0 ? '#F59E0B' : '#EF4444' }]} />
                  <Text style={styles.courierStatusText}>
                    {onlineCouriersCount > 0
                      ? `${onlineCouriersCount} kurye çevrimiçi`
                      : cityCouriers.length > 0
                        ? `${cityCouriers.length} kayıtlı kurye (şu an çevrimdışı)`
                        : 'Henüz kurye yok'}
                  </Text>
                </View>

                <View style={styles.courierSubHeader}>
                  <Store size={18} color={Colors.dark.primary} />
                  <Text style={styles.courierSubtitle}>
                    {user?.district ?? ''}, {user?.city ?? ''} bölgesinden sipariş verin
                  </Text>
                </View>
                {cityBusinesses.map(biz => (
                  <TouchableOpacity
                    key={biz.id}
                    style={styles.bizCard}
                    onPress={() => handleSelectBusiness(biz)}
                    activeOpacity={0.85}
                  >
                    <Image source={{ uri: biz.image }} style={styles.bizImage} resizeMode="cover" />
                    <View style={styles.bizCardOverlay}>
                      <View style={styles.bizRatingBadge}>
                        <Star size={11} color="#F5A623" fill="#F5A623" />
                        <Text style={styles.bizRatingText}>{biz.rating}</Text>
                        <Text style={styles.bizReviewCount}>({biz.reviewCount})</Text>
                      </View>
                    </View>
                    <View style={styles.bizInfo}>
                      <Text style={styles.bizName}>{biz.name}</Text>
                      <Text style={styles.bizAddress} numberOfLines={1}>{biz.address}</Text>
                      <View style={styles.bizMetaRow}>
                        <View style={styles.bizMetaChip}>
                          <Clock size={12} color="#666" />
                          <Text style={styles.bizMetaText}>{biz.deliveryTime}</Text>
                        </View>
                        <View style={styles.bizMetaDot} />
                        <View style={styles.bizMetaChip}>
                          <Package size={12} color="#666" />
                          <Text style={styles.bizMetaText}>₺{biz.deliveryFee} teslimat</Text>
                        </View>
                        <View style={styles.bizMetaDot} />
                        <Text style={styles.bizMinOrder}>Min. ₺{biz.minOrder}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
                {cityBusinesses.length === 0 && (
                  <View style={styles.courierEmptyState}>
                    <Store size={48} color="#D0D0D0" />
                    <Text style={styles.courierEmptyTitle}>Henüz İşletme Yok</Text>
                    <Text style={styles.courierEmptyText}>
                      {user?.city ?? 'Bu bölge'} için işletmeler yakında eklenecek
                    </Text>
                  </View>
                )}
              </ScrollView>
            ) : (
              <View style={{ flex: 1 }}>
                <View style={styles.bizDetailHeader}>
                  <Image source={{ uri: selectedCourierBiz.image }} style={styles.bizDetailImage} resizeMode="cover" />
                  <View style={styles.bizDetailOverlay}>
                    <View style={styles.bizDetailMeta}>
                      <View style={styles.bizDetailBadge}>
                        <Star size={12} color="#F5A623" fill="#F5A623" />
                        <Text style={styles.bizDetailBadgeText}>{selectedCourierBiz.rating}</Text>
                      </View>
                      <View style={styles.bizDetailBadge}>
                        <Clock size={12} color="#FFF" />
                        <Text style={styles.bizDetailBadgeText}>{selectedCourierBiz.deliveryTime}</Text>
                      </View>
                      <View style={styles.bizDetailBadge}>
                        <Banknote size={12} color="#FFF" />
                        <Text style={styles.bizDetailBadgeText}>Min. ₺{selectedCourierBiz.minOrder}</Text>
                      </View>
                    </View>
                  </View>
                </View>
                <Text style={styles.menuSectionTitle}>Menü</Text>
                <ScrollView
                  style={styles.menuScrollView}
                  contentContainerStyle={styles.menuScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {selectedCourierBiz.menu.map(item => {
                    const cartItem = courierCart.find(c => c.menuItem.id === item.id);
                    const qty = cartItem?.quantity ?? 0;
                    return (
                      <View key={item.id} style={styles.menuItemCard}>
                        <Image source={{ uri: item.image }} style={styles.menuItemImage} resizeMode="cover" />
                        <View style={styles.menuItemInfo}>
                          <Text style={styles.menuItemName}>{item.name}</Text>
                          <Text style={styles.menuItemDesc} numberOfLines={2}>{item.description}</Text>
                          <View style={styles.menuItemBottom}>
                            <Text style={styles.menuItemPrice}>₺{item.price}</Text>
                            {qty === 0 ? (
                              <TouchableOpacity
                                style={styles.addToCartBtn}
                                onPress={() => handleAddToCart(item)}
                                activeOpacity={0.8}
                              >
                                <Plus size={16} color="#FFF" />
                              </TouchableOpacity>
                            ) : (
                              <View style={styles.cartQtyRow}>
                                <TouchableOpacity
                                  style={styles.cartQtyBtn}
                                  onPress={() => handleRemoveFromCart(item.id)}
                                  activeOpacity={0.7}
                                >
                                  <Minus size={14} color={Colors.dark.primary} />
                                </TouchableOpacity>
                                <Text style={styles.cartQtyText}>{qty}</Text>
                                <TouchableOpacity
                                  style={styles.cartQtyBtnAdd}
                                  onPress={() => handleAddToCart(item)}
                                  activeOpacity={0.7}
                                >
                                  <Plus size={14} color="#FFF" />
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
                {courierCart.length > 0 && (
                  <View style={styles.cartBar}>
                    <View style={styles.cartBarLeft}>
                      <View style={styles.cartBadge}>
                        <Text style={styles.cartBadgeText}>{courierCartCount}</Text>
                      </View>
                      <View>
                        <Text style={styles.cartBarTotal}>₺{courierCartTotal + selectedCourierBiz.deliveryFee}</Text>
                        <Text style={styles.cartBarSub}>₺{selectedCourierBiz.deliveryFee} teslimat dahil</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.cartOrderBtn,
                        courierCartTotal < selectedCourierBiz.minOrder && styles.cartOrderBtnDisabled,
                      ]}
                      onPress={handlePlaceCourierOrder}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.cartOrderBtnText}>Sipariş Ver</Text>
                      <ChevronRight size={16} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </SafeAreaView>
        </View>
      )}
      {showOrderSuccess && (
        <View style={styles.ratingOverlay}>
          <View style={styles.orderSuccessModal}>
            <View style={styles.orderSuccessIconWrap}>
              <CheckCircle size={52} color="#2ECC71" />
            </View>
            <Text style={styles.orderSuccessTitle}>Siparişiniz Alındı!</Text>
            <Text style={styles.orderSuccessSub}>
              {selectedCourierBiz?.name} siparişiniz hazırlanıyor.{"\n"}
              Tahmini teslimat: {selectedCourierBiz?.deliveryTime}
            </Text>
            <View style={styles.orderSuccessDetails}>
              <View style={styles.orderSuccessRow}>
                <Text style={styles.orderSuccessLabel}>Ürünler</Text>
                <Text style={styles.orderSuccessValue}>₺{courierCartTotal}</Text>
              </View>
              <View style={styles.orderSuccessRow}>
                <Text style={styles.orderSuccessLabel}>Teslimat</Text>
                <Text style={styles.orderSuccessValue}>₺{selectedCourierBiz?.deliveryFee ?? 0}</Text>
              </View>
              <View style={styles.orderSuccessDivider} />
              <View style={styles.orderSuccessRow}>
                <Text style={styles.orderSuccessTotalLabel}>Toplam</Text>
                <Text style={styles.orderSuccessTotalValue}>
                  ₺{courierCartTotal + (selectedCourierBiz?.deliveryFee ?? 0)}
                </Text>
              </View>
              <View style={styles.orderSuccessRow}>
                <Text style={styles.orderSuccessLabel}>Ödeme</Text>
                <Text style={styles.orderSuccessValue}>Nakit</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.orderSuccessBtn} onPress={handleCloseOrderSuccess} activeOpacity={0.85}>
              <Text style={styles.orderSuccessBtnText}>Tamam</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {showCustomOrderSuccess && (
        <View style={styles.ratingOverlay}>
          <View style={styles.orderSuccessModal}>
            <View style={styles.orderSuccessIconWrap}>
              <CheckCircle size={52} color="#2ECC71" />
            </View>
            <Text style={styles.orderSuccessTitle}>Özel Siparişiniz Alındı!</Text>
            <Text style={styles.orderSuccessSub}>
              Siparişiniz en kısa sürede değerlendirilecek.{"\n"}
              Size uygun kurye atanacaktır.
            </Text>
            <View style={styles.orderSuccessDetails}>
              <View style={styles.orderSuccessRow}>
                <Text style={styles.orderSuccessLabel}>Sipariş</Text>
                <Text style={styles.orderSuccessValue} numberOfLines={2}>Özel Sipariş</Text>
              </View>
              <View style={styles.orderSuccessRow}>
                <Text style={styles.orderSuccessLabel}>Görsel</Text>
                <Text style={styles.orderSuccessValue}>{customOrderImages.length} adet</Text>
              </View>
              <View style={styles.orderSuccessDivider} />
              <View style={styles.orderSuccessRow}>
                <Text style={styles.orderSuccessLabel}>Adres</Text>
                <Text style={styles.orderSuccessValue} numberOfLines={2}>{customOrderAddress}</Text>
              </View>
              <View style={styles.orderSuccessRow}>
                <Text style={styles.orderSuccessLabel}>Konum</Text>
                <Text style={styles.orderSuccessValue}>{customOrderLocationConfirmed ? 'Onaylandı' : 'Belirtilmedi'}</Text>
              </View>
              <View style={styles.orderSuccessRow}>
                <Text style={styles.orderSuccessLabel}>Ödeme</Text>
                <Text style={styles.orderSuccessValue}>Nakit</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.orderSuccessBtn} onPress={handleCloseCustomOrderSuccess} activeOpacity={0.85}>
              <Text style={styles.orderSuccessBtnText}>Tamam</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topBar: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  greeting: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  greetingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greetingLeft: {
    flex: 1,
  },
  hamburgerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF',
    borderWidth: 2,
    borderColor: '#FF8C00',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  greetingLocationBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  greetingText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  greetingSubtext: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  freeRideBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.dark.success,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  freeRideBadgeText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  bottomPanel: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  promoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245,166,35,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  promoBarText: {
    flex: 1,
    fontSize: 14,
    color: Colors.dark.primary,
    fontWeight: '500' as const,
  },
  promoInputRow: {
    marginBottom: 12,
  },
  promoInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  promoInput: {
    flex: 1,
    backgroundColor: '#F0F0F5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1A1A2E',
    letterSpacing: 1,
  },
  promoApplyBtn: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  promoApplyText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  promoActiveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(46,204,113,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.2)',
  },
  promoActiveText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.dark.success,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F0F5',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    marginBottom: 12,
  },
  searchPlaceholder: {
    fontSize: 16,
    color: '#999',
  },
  paymentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  paymentText: {
    fontSize: 13,
    color: Colors.dark.success,
    fontWeight: '600' as const,
  },
  quickDestinations: {
    backgroundColor: '#F0F0F5',
    borderRadius: 14,
    overflow: 'hidden',
  },
  quickDest: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  quickDestIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(245,166,35,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickDestTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#1A1A2E',
  },
  quickDestSub: {
    fontSize: 12,
    color: '#999',
    marginTop: 1,
  },
  quickDestDivider: {
    height: 1,
    backgroundColor: '#E8E8ED',
    marginLeft: 66,
  },
  searchPanelKeyboard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
    justifyContent: 'flex-end' as const,
  },
  searchPanel: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
    maxHeight: '75%' as unknown as number,
  },
  searchResultsScroll: {
    flexGrow: 0,
  },
  searchPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  searchPanelTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  searchInputRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 16,
  },
  searchDots: {
    alignItems: 'center',
    paddingTop: 14,
    gap: 4,
  },
  dotGreen: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.dark.success,
  },
  dotLine: {
    width: 2,
    height: 24,
    backgroundColor: '#D0D0DA',
  },
  dotRed: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.dark.accent,
  },
  searchInputs: {
    flex: 1,
    gap: 8,
  },
  searchInputWrapper: {
    backgroundColor: '#F0F0F5',
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  searchInput: {
    paddingVertical: 14,
    fontSize: 15,
    color: '#1A1A2E',
  },
  recentPlaces: {
    marginBottom: 12,
  },
  recentPlace: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 14,
  },
  recentPlaceIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F0F0F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recentPlaceContent: {
    flex: 1,
  },
  recentPlaceText: {
    fontSize: 15,
    color: '#1A1A2E',
  },
  recentPlaceSub: {
    fontSize: 12,
    color: '#8A8A9A',
    marginTop: 2,
  },
  noResultRow: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  noResultText: {
    fontSize: 13,
    color: '#8A8A9A',
  },
  selectedDestPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245,166,35,0.25)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.5)',
  },
  selectedDestText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  inputSpinner: {
    position: 'absolute',
    right: 12,
    top: 14,
  },
  pricePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  pricePreviewDistance: {
    fontSize: 12,
    color: '#999',
  },
  pricePreviewDot: {
    fontSize: 6,
    color: '#999',
  },
  pricePreviewPrice: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.dark.primary,
  },
  rideSummary: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    marginBottom: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#ECEEF3',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 4,
  },
  rideSummaryRow: {
    flexDirection: 'row',
    paddingVertical: 14,
    marginTop: 4,
    backgroundColor: '#F8F9FC',
    borderRadius: 18,
  },
  rideSummaryItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  rideSummaryLabel: {
    fontSize: 10,
    color: '#8E94A8',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    fontWeight: '700' as const,
  },
  rideSummaryValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#1A1A2E',
  },
  rideSummaryDivider: {
    width: 1,
    backgroundColor: '#E3E7EF',
    marginVertical: 10,
  },
  freePriceRow: {
    alignItems: 'center',
  },
  rideSummaryValueStrike: {
    fontSize: 12,
    color: '#999',
    textDecorationLine: 'line-through',
  },
  rideSummaryValueFree: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.dark.success,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#E8E8ED',
  },
  paymentRowText: {
    fontSize: 13,
    color: Colors.dark.success,
    fontWeight: '600' as const,
  },
  paymentMethodSelector: {
    flexDirection: 'row' as const,
    gap: 10,
    paddingTop: 14,
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#EEF1F5',
  },
  paymentMethodOption: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: '#F8F9FC',
    borderWidth: 1.5,
    borderColor: '#E3E7EF',
  },
  paymentMethodOptionActive: {
    backgroundColor: Colors.dark.success,
    borderColor: Colors.dark.success,
  },
  paymentMethodOptionActiveCard: {
    backgroundColor: '#1A73E8',
    borderColor: '#1A73E8',
  },
  paymentMethodText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#666',
  },
  paymentMethodTextActive: {
    color: '#FFF',
  },
  confirmButton: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 17,
    borderRadius: 18,
    alignItems: 'center',
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 6,
  },
  confirmButtonDisabled: {
    opacity: 0.4,
  },
  confirmButtonText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  statusPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 30,
    alignItems: 'center',
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#1A1A2E',
    marginTop: 16,
  },
  statusSub: {
    fontSize: 14,
    color: '#777',
    marginTop: 6,
    textAlign: 'center' as const,
    paddingHorizontal: 10,
  },
  altSuggestionIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(245,166,35,0.1)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 8,
  },
  altDriverPreview: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#F8F9FA',
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
    gap: 12,
    width: '100%' as const,
  },
  altDriverAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  altDriverAvatarText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  altDriverName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  altDriverVehicle: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  altDriverRating: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  altPriceRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    width: '100%' as const,
    marginTop: 12,
    paddingHorizontal: 4,
  },
  altPriceLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500' as const,
  },
  altPriceValue: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: '#2ECC71',
  },
  altAcceptBtn: {
    marginTop: 16,
    backgroundColor: Colors.dark.primary,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 14,
    width: '100%' as const,
    alignItems: 'center' as const,
  },
  altAcceptText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  altRejectBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    width: '100%' as const,
    alignItems: 'center' as const,
  },
  altRejectText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#999',
  },
  reassignBanner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(245,166,35,0.12)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 4,
  },
  cancelButton: {
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.dark.accent,
    textAlign: 'center' as const,
  },
  driverPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 20,
  },
  driverPanelHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E8',
    marginBottom: 16,
  },
  driverInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    width: '100%',
    marginBottom: 12,
  },
  driverAvatarNew: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
    position: 'relative' as const,
  },
  driverAvatarBadge: {
    position: 'absolute' as const,
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.dark.success,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  driverCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
    width: '100%' as unknown as number,
    backgroundColor: '#F8F8FC',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EFEFEF',
  },
  driverAvatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  driverAvatarText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  driverDetails: {
    flex: 1,
  },
  driverName: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  driverVehicle: {
    fontSize: 13,
    color: '#777',
    marginTop: 2,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  ratingText: {
    fontSize: 13,
    color: Colors.dark.primary,
    fontWeight: '600' as const,
  },
  ratingCount: {
    fontSize: 12,
    color: '#999',
  },
  tripInfo: {
    flexDirection: 'row',
    backgroundColor: '#F0F0F5',
    borderRadius: 14,
    paddingVertical: 16,
    width: '100%',
    marginBottom: 12,
  },
  tripInfoItem: {
    flex: 1,
    alignItems: 'center',
  },
  tripInfoLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  tripInfoValue: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  tripInfoDivider: {
    width: 1,
    backgroundColor: '#E8E8ED',
  },
  tripStatsRow: {
    flexDirection: 'row' as const,
    width: '100%' as unknown as number,
    backgroundColor: '#F8F8FC',
    borderRadius: 16,
    paddingVertical: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EFEFEF',
  },
  tripStatItem: {
    flex: 1,
    alignItems: 'center' as const,
    gap: 3,
  },
  tripStatValue: {
    fontSize: 17,
    fontWeight: '800' as const,
    color: '#1A1A2E',
  },
  tripStatLabel: {
    fontSize: 11,
    color: '#ABABBB',
    fontWeight: '500' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  tripStatDivider: {
    width: 1,
    backgroundColor: '#ECECF3',
  },
  paymentPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: 'rgba(46,204,113,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 50,
    marginBottom: 16,
    alignSelf: 'flex-start' as const,
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.15)',
  },
  paymentPillCard: {
    backgroundColor: 'rgba(26,115,232,0.07)',
    borderColor: 'rgba(26,115,232,0.15)',
  },
  paymentPillIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFF',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  paymentPillText: {
    fontSize: 13,
    color: Colors.dark.success,
    fontWeight: '600' as const,
  },
  driverActionRow: {
    flexDirection: 'row' as const,
    width: '100%' as unknown as number,
    gap: 10,
  },
  cancelBtnNew: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1.5,
    borderColor: '#E0E0E8',
    backgroundColor: '#F8F8FC',
  },
  cancelBtnNewText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#555',
  },
  sosBtnNew: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 15,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: '#E74C3C',
    shadowColor: '#E74C3C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  sosBtnNewText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFF',
    letterSpacing: 1,
  },
  paymentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(46,204,113,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    width: '100%',
    marginBottom: 16,
  },
  paymentBannerText: {
    fontSize: 14,
    color: Colors.dark.success,
    fontWeight: '600' as const,
  },
  actionButtons: {
    width: '100%',
    gap: 8,
    alignItems: 'center',
  },
  completeButton: {
    backgroundColor: Colors.dark.success,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    width: '100%',
  },
  completeButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  driverCarMarker: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 3,
    borderColor: '#FFF',
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 12,
    overflow: 'hidden' as const,
  },
  driverCarMarkerAndroid: {
    elevation: 0,
    shadowOpacity: 0,
    borderWidth: 3,
    borderColor: '#FFF',
  },
  driverMarkerPulse: {
    position: 'absolute' as const,
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2.5,
    borderColor: Colors.dark.primary,
    opacity: 0.25,
    top: -8,
    left: -8,
  },
  vehicleMarkerEmoji: {
    fontSize: 22,
    textAlign: 'center' as const,
  },
  etaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    width: '100%',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.15)',
  },
  etaPulse: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(245,166,35,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  etaContent: {
    flex: 1,
  },
  etaLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: '500' as const,
  },
  etaValue: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.dark.primary,
    marginTop: 1,
  },
  etaLive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(231,76,60,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.dark.accent,
  },
  liveText: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: Colors.dark.accent,
    letterSpacing: 1,
  },
  arrivedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(46,204,113,0.1)',
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 16,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.2)',
  },
  arrivedEmoji: {
    fontSize: 20,
  },
  arrivedText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.dark.success,
  },
  contactButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  contactBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(245,166,35,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contactBtnNew: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  contactBtnChat: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    shadowColor: 'transparent',
    elevation: 0,
  },
  pricingInfoBanner: {
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.12)',
    overflow: 'hidden',
  },
  pricingInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  pricingInfoTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.dark.primary,
  },
  pricingInfoBody: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 6,
  },
  pricingInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pricingInfoLabel: {
    fontSize: 13,
    color: '#777',
  },
  pricingInfoValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  pricingInfoDivider: {
    height: 1,
    backgroundColor: 'rgba(245,166,35,0.1)',
  },
  driverMarkerWithPrice: {
    alignItems: 'center',
  },
  driverPriceBubble: {
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 0,
  },
  driverPriceText: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: '#FFF',
    letterSpacing: 0.5,
  },
  driverPriceArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: Colors.dark.primary,
    marginBottom: -1,
  },
  ratingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    zIndex: 100,
  },
  ratingModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E8',
  },
  ratingModalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E8',
    marginBottom: 20,
  },
  ratingModalTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: '#1A1A2E',
    marginBottom: 4,
  },
  ratingModalSub: {
    fontSize: 14,
    color: '#777',
    marginBottom: 24,
  },
  ratingStarsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  starButton: {
    padding: 4,
  },
  ratingLabel: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.dark.primary,
    marginBottom: 20,
    marginTop: 4,
  },
  commentInputWrapper: {
    width: '100%',
    backgroundColor: '#F0F0F5',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E0E0E8',
    marginBottom: 20,
  },
  commentInput: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 15,
    color: '#1A1A2E',
    minHeight: 80,
    maxHeight: 120,
  },
  commentCount: {
    fontSize: 11,
    color: '#999',
    textAlign: 'right' as const,
    paddingRight: 14,
    paddingBottom: 10,
  },
  submitRatingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.dark.primary,
    paddingVertical: 16,
    borderRadius: 14,
    width: '100%',
  },
  submitRatingBtnDisabled: {
    backgroundColor: '#F0F0F5',
  },
  submitRatingText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  submitRatingTextDisabled: {
    color: '#999',
  },
  skipRatingBtn: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 4,
  },
  skipRatingText: {
    fontSize: 14,
    color: '#999',
    fontWeight: '500' as const,
  },
  actionRow: {
    flexDirection: 'row' as const,
    gap: 8,
    width: '100%',
  },
  sosModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 28,
    width: '100%',
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: '#E0E0E8',
  },
  sosModalCloseX: {
    position: 'absolute' as const,
    top: 14,
    right: 14,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F2F2F5',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    zIndex: 10,
  },
  sosModalIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#FDE8E8',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 16,
  },
  sosModalTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: '#E74C3C',
    marginBottom: 6,
  },
  sosModalSub: {
    fontSize: 13,
    color: '#777',
    textAlign: 'center' as const,
    marginBottom: 24,
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  sosModalActions: {
    width: '100%' as const,
    gap: 10,
  },
  sosModalBtn112: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: '#E74C3C',
    paddingVertical: 15,
    borderRadius: 14,
    width: '100%' as const,
  },
  sosModalBtnText112: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  sosModalBtn155: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: '#2563EB',
    paddingVertical: 15,
    borderRadius: 14,
    width: '100%' as const,
  },
  sosModalBtnText155: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  sosModalBtnWA: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: '#F0FFF4',
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#25D36640',
    width: '100%' as const,
  },
  sosModalBtnTextWA: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#25D366',
  },
  sosModalBtnSMS: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: '#EFF6FF',
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1A73E840',
    width: '100%' as const,
  },
  sosModalBtnTextSMS: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#1A73E8',
  },
  sosButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: '#E74C3C',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
  },
  sosButtonText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  receiptModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: '#E0E0E8',
  },
  receiptHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 20,
  },
  receiptHeaderLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  receiptCloseX: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F2F2F5',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  receiptTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  receiptDivider: {
    height: 1,
    backgroundColor: '#E8E8ED',
    marginVertical: 14,
  },
  receiptRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 6,
  },
  receiptLabel: {
    fontSize: 14,
    color: '#999',
  },
  receiptValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#1A1A2E',
    maxWidth: '60%' as unknown as number,
    textAlign: 'right' as const,
  },
  receiptTotalRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
  },
  receiptTotalLabel: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  receiptTotalValue: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.dark.primary,
  },
  receiptDate: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center' as const,
    marginTop: 8,
    marginBottom: 20,
  },
  receiptCloseBtn: {
    backgroundColor: Colors.dark.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center' as const,
  },
  receiptCloseBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  chatModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    width: '100%',
    height: '75%' as unknown as number,
    borderWidth: 1,
    borderColor: '#E0E0E8',
    overflow: 'hidden' as const,
  },
  chatHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8ED',
  },
  chatHeaderLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  chatAvatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  chatAvatarText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  chatHeaderName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  chatHeaderSub: {
    fontSize: 12,
    color: '#999',
  },
  chatMessages: {
    flex: 1,
    paddingHorizontal: 16,
  },
  chatMessagesContent: {
    paddingVertical: 16,
    gap: 10,
  },
  chatBubble: {
    maxWidth: '80%' as unknown as number,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  chatBubbleMine: {
    alignSelf: 'flex-end' as const,
    backgroundColor: Colors.dark.primary,
    borderBottomRightRadius: 4,
  },
  chatBubbleTheirs: {
    alignSelf: 'flex-start' as const,
    backgroundColor: '#F0F0F5',
    borderBottomLeftRadius: 4,
  },
  chatBubbleText: {
    fontSize: 15,
    lineHeight: 20,
  },
  chatBubbleTextMine: {
    color: '#FFF',
  },
  chatBubbleTextTheirs: {
    color: '#1A1A2E',
  },
  chatBubbleTime: {
    fontSize: 10,
    color: 'rgba(0,0,0,0.35)',
    marginTop: 4,
    textAlign: 'right' as const,
  },
  chatInputRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E8E8ED',
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#F0F0F5',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1A1A2E',
  },
  chatSendBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  tripPriceBubble: {
    backgroundColor: '#2ECC71',
  },
  tripPriceArrow: {
    borderTopColor: '#2ECC71',
  },
  tripCarMarker: {
    backgroundColor: '#2ECC71',
    shadowColor: '#2ECC71',
  },
  paymentObligationBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(231,76,60,0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    width: '100%' as unknown as number,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(231,76,60,0.2)',
  },
  paymentObligationText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#E74C3C',
  },
  tripActiveBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(46,204,113,0.08)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    width: '100%' as unknown as number,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.15)',
  },
  tripActiveIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2ECC71',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  tripActiveLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: '500' as const,
  },
  tripActiveValue: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#2ECC71',
    marginTop: 1,
  },
  tripArrivedBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: 'rgba(46,204,113,0.12)',
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 16,
    width: '100%' as unknown as number,
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.25)',
  },
  tripArrivedText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#2ECC71',
  },
  tripRouteInfo: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#F0F0F5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    width: '100%' as unknown as number,
    gap: 8,
  },
  tripRoutePoint: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    flex: 1,
  },
  tripRouteDotGreen: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2ECC71',
  },
  tripRouteDotRed: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.dark.accent,
  },
  tripRouteLine: {
    width: 20,
    height: 2,
    backgroundColor: '#E0E0E8',
  },
  tripRouteText: {
    fontSize: 12,
    color: '#777',
    flex: 1,
  },
  recenterButton: {
    position: 'absolute' as const,
    top: 100,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
  },
  nearbyDriverMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.9)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 2,
    borderColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 0,
    overflow: 'hidden' as const,
  },
  nearbyDriversBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    backgroundColor: 'rgba(245,166,35,0.06)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.12)',
  },
  nearbyDriversIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(245,166,35,0.15)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  nearbyDriversText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.dark.primary,
  },
  nearbyDriversLiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.dark.success,
  },
  homeBottomArea: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden' as const,
    backgroundColor: '#F5F6F8',
  },
  referralBanner: {
    backgroundColor: '#17C653',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  referralText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    flex: 1,
    letterSpacing: 0.1,
  },
  referralBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  referralBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#0A9E40',
  },
  userLocationMarker: {
    width: 28,
    height: 28,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  userLocationOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(66,133,244,0.22)',
    borderWidth: 1.5,
    borderColor: 'rgba(66,133,244,0.5)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  userLocationInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4285F4',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  homeBottomSheet: {
    backgroundColor: '#F5F6F8',
  },
  sheetHandleWrap: {
    alignItems: 'center' as const,
    paddingVertical: 8,
    cursor: 'grab' as unknown as undefined,
  },
  sheetHandleBar: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#C0C0C0',
  },
  sheetContent: {
    paddingHorizontal: 20,
    paddingBottom: 0,
  },
  rideForOtherEntry: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#FFFFFF',
    borderRadius: 15,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9EAF1',
  },
  rideForOtherEntryTop: {
    marginTop: 14,
    marginBottom: 0,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  rideForOtherEntryActive: {
    backgroundColor: '#1E1671',
    borderColor: '#1E1671',
  },
  rideForOtherEntryIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EAF8EF',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rideForOtherEntryContent: {
    flex: 1,
  },
  rideForOtherEntryTitle: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: '#1A1A2E',
  },
  rideForOtherEntryTitleActive: {
    color: '#FFFFFF',
  },
  rideForOtherEntrySubtitle: {
    marginTop: 1,
    fontSize: 10,
    color: '#7A7A93',
  },
  rideForOtherEntrySubtitleActive: {
    color: 'rgba(255,255,255,0.82)',
  },
  rideForOtherSummaryCard: {
    backgroundColor: '#F5F0FF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E1D7FF',
  },
  rideForOtherSummaryHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 6,
  },
  rideForOtherSummaryTitle: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: '#1E1671',
  },
  rideForOtherSummaryAction: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#6B5CE7',
  },
  rideForOtherSummaryName: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  rideForOtherSummaryPhone: {
    marginTop: 2,
    fontSize: 13,
    color: '#666A7B',
  },
  routePickerKeyboard: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.98)',
  },
  routePickerSafeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  routePickerSurface: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 14,
  },
  routePickerHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 14,
  },
  routePickerHeaderButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: '#F5F7FB',
    borderWidth: 1,
    borderColor: '#ECEEF3',
  },
  routePickerHeaderContent: {
    flex: 1,
    alignItems: 'center' as const,
    paddingHorizontal: 12,
  },
  routePickerHeaderTitle: {
    fontSize: 19,
    fontWeight: '800' as const,
    color: '#111111',
  },
  routePickerHeaderSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#8B90A0',
    fontWeight: '500' as const,
  },
  routePickerHeaderSpacer: {
    width: 42,
    height: 42,
  },
  routeComposerRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    marginBottom: 16,
  },
  routeComposerInputs: {
    flex: 1,
    gap: 8,
  },
  routeComposerOriginField: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#F8F9FC',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#ECEEF3',
  },
  routeComposerOriginDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#14AE5C',
    borderWidth: 4,
    borderColor: 'rgba(20,174,92,0.16)',
  },
  routeComposerOriginTextWrap: {
    flex: 1,
  },
  routeComposerFieldLabel: {
    fontSize: 11,
    color: '#8D93A6',
    fontWeight: '700' as const,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
    marginBottom: 2,
  },
  routeComposerOriginText: {
    flex: 1,
    fontSize: 15,
    color: '#222530',
    fontWeight: '600' as const,
  },
  routeComposerDestinationField: {
    minHeight: 72,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingLeft: 14,
    paddingRight: 12,
    borderWidth: 1.5,
    borderColor: '#D7DCE6',
    position: 'relative' as const,
    gap: 10,
    shadowColor: '#111827',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 3,
  },
  routeComposerSearchIconWrap: {
    width: 32,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  routeComposerDestinationTextWrap: {
    flex: 1,
    paddingVertical: 10,
  },
  routeComposerDestinationInput: {
    fontSize: 16,
    color: '#111111',
    fontWeight: '600' as const,
    paddingRight: 8,
    paddingVertical: 0,
  },
  routeComposerMapButton: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#F5F7FB',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: '#ECEEF3',
  },
  routeComposerSpinner: {
    position: 'absolute' as const,
    right: 56,
    top: 26,
  },
  routeComposerActions: {
    gap: 10,
    paddingTop: 2,
  },
  routeComposerActionButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: '#F5F7FB',
    borderWidth: 1,
    borderColor: '#ECEEF3',
  },
  routePickerList: {
    flex: 1,
  },
  routePickerListContent: {
    paddingBottom: 18,
  },
  routePickerSectionLabel: {
    fontSize: 12,
    fontWeight: '800' as const,
    color: '#8A8FA0',
    marginBottom: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  routePickerRecentList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ECEEF3',
    overflow: 'hidden' as const,
    marginBottom: 14,
  },
  routePickerRecentRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 12,
    paddingVertical: 13,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F1F4',
  },
  routePickerRecentIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: '#F5F7FB',
  },
  routePickerRecentContent: {
    flex: 1,
  },
  routePickerRecentTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#111111',
  },
  routePickerRecentSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#7B8192',
  },
  routePickerRecentTrailing: {
    width: 28,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  routePickerMapRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#ECEEF3',
    marginBottom: 14,
  },
  routePickerMapRowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F5F7FB',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  routePickerMapRowTextWrap: {
    flex: 1,
  },
  routePickerMapRowText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#111111',
  },
  routePickerMapRowSubtext: {
    marginTop: 2,
    fontSize: 12,
    color: '#8A8FA0',
  },
  routePickerSelectedCard: {
    backgroundColor: '#FFF9EF',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)',
    marginBottom: 14,
  },
  routePickerSelectedCardTopRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 10,
    gap: 12,
  },
  routePickerSelectedBadge: {
    backgroundColor: 'rgba(245,166,35,0.14)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  routePickerSelectedBadgeText: {
    fontSize: 11,
    color: '#A56A00',
    fontWeight: '800' as const,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  routePickerSelectedCardBottomRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 12,
  },
  routePickerSelectedInfo: {
    flex: 1,
  },
  routePickerSelectedTitle: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#1A1A2E',
  },
  routePickerSelectedMeta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginTop: 5,
  },
  routePickerSelectedMetaText: {
    fontSize: 12,
    color: '#7B8192',
    fontWeight: '600' as const,
  },
  routePickerSelectedMetaDot: {
    fontSize: 11,
    color: '#B6BAC7',
  },
  routePickerSelectedPriceWrap: {
    alignItems: 'flex-end' as const,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.18)',
  },
  routePickerSelectedPriceLabel: {
    fontSize: 11,
    color: '#9AA0AE',
    fontWeight: '700' as const,
  },
  routePickerSelectedPrice: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.dark.primary,
  },
  routePickerConfirmButton: {
    marginTop: 8,
  },
  activeRideGuestCard: {
    width: '100%' as unknown as number,
    backgroundColor: 'rgba(30,22,113,0.06)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(30,22,113,0.12)',
  },
  activeRideGuestTitle: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: '#1E1671',
  },
  activeRideGuestSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#646B81',
  },
  activeRideGuestTags: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
    marginTop: 10,
  },
  activeRideGuestTag: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#1E1671',
    backgroundColor: '#ECE7FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden' as const,
  },
  searchBarNew: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  searchPlaceholderNew: {
    fontSize: 17,
    color: '#888',
    fontWeight: '500' as const,
  },
  recentScroll: {
    marginBottom: 16,
  },
  recentScrollContent: {
    gap: 10,
  },
  recentChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#EAEAEA',
  },
  recentChipText: {
    fontSize: 13,
    color: '#333',
    maxWidth: 160,
  },
  serviceGrid: {
    flexDirection: 'row' as const,
    gap: 10,
    marginBottom: 0,
  },
  mainServiceCard: {
    flex: 1,
    backgroundColor: 'transparent',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    padding: 16,
    justifyContent: 'flex-end' as const,
  },
  mainServiceIconArea: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingVertical: 4,
  },
  mainCarImageWrap: {
    width: '100%' as unknown as number,
    position: 'relative' as const,
  },
  mainServiceCarImage: {
    width: '100%' as unknown as number,
    height: 100,
  },
  mainCarPlate: {
    position: 'absolute' as const,
    bottom: 2,
    alignSelf: 'center' as const,
    left: 0,
    right: 0,
    alignItems: 'center' as const,
  },
  mainCarPlateInner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#fff',
    borderRadius: 3,
    borderWidth: 1.2,
    borderColor: '#222',
    paddingHorizontal: 2,
    paddingVertical: 1,
    height: 14,
  },
  mainCarPlateBlueBand: {
    backgroundColor: '#003399',
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
    paddingHorizontal: 2,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    height: '100%' as unknown as number,
    marginRight: 3,
    marginLeft: -1,
  },
  mainCarPlateBlueBandText: {
    color: '#fff',
    fontSize: 5,
    fontWeight: '700' as const,
  },
  mainCarPlateText: {
    fontSize: 7,
    fontWeight: '800' as const,
    color: '#111',
    letterSpacing: 0.5,
  },
  mainServiceLabel: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 4,
  },
  mainServiceName: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: '#1A1A2E',
    letterSpacing: 1,
  },
  mainServiceDesc: {
    fontSize: 12,
    color: '#666',
  },
  sideServicesCol: {
    flex: 1,
    gap: 10,
  },
  sideServiceCard: {
    flex: 1,
    backgroundColor: '#F2F2F2',
    borderRadius: 16,
    padding: 14,
    justifyContent: 'center' as const,
    position: 'relative' as const,
    overflow: 'hidden' as const,
  },
  sideServiceCardDisabled: {
    opacity: 0.6,
    backgroundColor: '#F5F0F0',
  },
  sideServiceWeatherBadge: {
    position: 'absolute' as const,
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(231,76,60,0.85)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 2,
  },
  weatherRestrictedText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: '#E74C3C',
    marginTop: 2,
  },
  sideServiceRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  sideServiceInfo: {
    flex: 1,
  },
  sideServiceLabel: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  sideServiceName: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#1A1A2E',
  },
  sideServiceDescText: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  scooterTagRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    marginTop: 3,
  },
  scooterTagText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#F5A623',
    letterSpacing: 0.5,
  },
  scooterTagSupport: {
    fontSize: 8,
    color: '#999',
    marginTop: 1,
  },
  promoSectionNew: {
    marginBottom: 16,
  },
  partnerVenueSection: {
    marginBottom: 18,
    borderRadius: 16,
    overflow: 'hidden' as const,
    position: 'relative' as const,
  },
  partnerVenueImage: {
    width: '100%' as const,
    height: 200,
    borderRadius: 16,
  },
  partnerVenueOverlay: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingTop: 40,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  partnerVenueBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 8,
  },
  partnerVenueBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: '#FFD700',
    letterSpacing: 0.8,
  },
  partnerVenueText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: '#FFFFFF',
    lineHeight: 19,
    letterSpacing: 0.1,
  },
  michelinStarSection: {
    marginBottom: 18,
    borderRadius: 16,
    padding: 18,
    backgroundColor: '#137A4B',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.15)',
    alignItems: 'center' as const,
  },
  michelinStarRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 10,
  },
  michelinTitle: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: '#FFD700',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  michelinDesc: {
    fontSize: 12,
    fontWeight: '400' as const,
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 18,
    textAlign: 'center' as const,
    paddingHorizontal: 8,
  },
  michelinDivider: {
    width: '60%' as const,
    height: 1,
    backgroundColor: 'rgba(255,215,0,0.15)',
    marginVertical: 12,
  },
  michelinInfoRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 16,
    flexWrap: 'wrap' as const,
  },
  michelinInfoItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  michelinInfoText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 0.3,
  },
  promoBannerBadgeOnly: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: 'rgba(255,215,0,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.2)',
  },
  promoBannerBadgeOnlyText: {
    fontSize: 12,
    fontWeight: '800' as const,
    color: '#FFD700',
    letterSpacing: 1,
  },
  nearbyDriversBannerNew: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: '#F0FFF4',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 12,
  },
  nearbyDriversTextNew: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#2ECC71',
  },
  nearbyLiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2ECC71',
  },
  pricingInfoNew: {
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  pricingRowNew: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  pricingLabelNew: {
    fontSize: 13,
    color: '#666',
  },
  pricingValueNew: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  pricingDividerNew: {
    height: 1,
    backgroundColor: '#EDEDED',
    marginVertical: 8,
  },
  paymentInfoNew: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  paymentTextNew: {
    fontSize: 13,
    color: '#2ECC71',
    fontWeight: '600' as const,
  },
  promoInputAreaNew: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 14,
  },
  promoInputNew: {
    flex: 1,
    backgroundColor: '#F2F2F2',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1A1A2E',
    letterSpacing: 1,
  },
  promoApplyBtnNew: {
    backgroundColor: '#2ECC71',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  promoApplyTextNew: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  freeRidesBannerNew: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    backgroundColor: '#E8FFF1',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(10,158,64,0.3)',
  },
  freeRidesBannerTextNew: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#0A9E40',
  },
  venueSection: {
    marginBottom: 16,
  },
  venueSectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 10,
  },
  venueSectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  venueSectionBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: '#FFF8E7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  venueSectionBadgeText: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: '#F5A623',
    letterSpacing: 0.5,
  },
  venueCard: {
    borderRadius: 14,
    overflow: 'hidden' as const,
    height: 180,
    marginBottom: 8,
  },
  venueImage: {
    ...StyleSheet.absoluteFillObject,
  },
  venueOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between' as const,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  venueTopRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'flex-start' as const,
  },
  venueCategoryBadge: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  venueCategoryText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#FFF',
  },
  venueRatingBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  venueRatingText: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: '#F5A623',
  },
  venueReviewCount: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
  },
  venueBottom: {
    gap: 2,
  },
  venueName: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: '#FFF',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  venueAddress: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500' as const,
  },
  venueReviewCard: {
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  venueReviewHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    marginBottom: 8,
  },
  venueReviewerAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E8E0F0',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  venueReviewerInitial: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#6B4FA0',
  },
  venueReviewerInfo: {
    flex: 1,
  },
  venueReviewerName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#1A1A2E',
  },
  venueReviewStars: {
    flexDirection: 'row' as const,
    gap: 2,
    marginTop: 2,
  },
  venueReviewText: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
    fontStyle: 'italic' as const,
  },
  venueDotsRow: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 8,
  },
  venueDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D0D0D0',
  },
  venueDotActive: {
    width: 20,
    backgroundColor: '#F5A623',
    borderRadius: 3,
  },
  venueProgressBarBg: {
    height: 3,
    backgroundColor: '#EDEDED',
    borderRadius: 2,
    overflow: 'hidden' as const,
  },
  venueProgressBarFill: {
    height: '100%' as unknown as number,
    backgroundColor: '#F5A623',
    borderRadius: 2,
  },
  openMapsButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: '#1A73E8',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    paddingVertical: 12,
    borderRadius: 12,
  },
  openMapsButtonText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    flex: 1,
  },
  openMapsButtonPanel: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    backgroundColor: '#1A73E8',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    width: '100%' as unknown as number,
    marginBottom: 12,
    shadowColor: '#1A73E8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  openMapsButtonPanelContent: {
    flex: 1,
  },
  openMapsButtonPanelText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  openMapsButtonPanelSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 1,
  },
  courierOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    zIndex: 90,
  },
  courierSafeArea: {
    flex: 1,
  },
  courierHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  courierBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F2F2F2',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  courierHeaderTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#1A1A2E',
    flex: 1,
    textAlign: 'center' as const,
    marginHorizontal: 12,
  },
  courierScrollView: {
    flex: 1,
  },
  courierScrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  courierSubHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 18,
    backgroundColor: 'rgba(245,166,35,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  courierSubtitle: {
    fontSize: 14,
    color: Colors.dark.primary,
    fontWeight: '600' as const,
  },
  bizCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    overflow: 'hidden' as const,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#ECECEC',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  bizImage: {
    width: '100%' as unknown as number,
    height: 160,
  },
  bizCardOverlay: {
    position: 'absolute' as const,
    top: 12,
    right: 12,
  },
  bizInfo: {
    padding: 14,
  },
  bizName: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#1A1A2E',
    marginBottom: 4,
  },
  bizRatingBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  bizRatingText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#F5A623',
  },
  bizReviewCount: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
  },
  bizAddress: {
    fontSize: 13,
    color: '#888',
    marginBottom: 10,
  },
  bizMetaRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  bizMetaChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  bizMetaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#CCC',
  },
  bizMetaText: {
    fontSize: 12,
    color: '#666',
  },
  bizMinOrder: {
    fontSize: 12,
    color: '#999',
  },
  courierStatusBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: '#F8F9FA',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  courierStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  courierStatusText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#1A1A2E',
  },
  courierEmptyState: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 60,
    gap: 10,
  },
  courierEmptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  courierEmptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center' as const,
  },
  bizDetailHeader: {
    height: 150,
    position: 'relative' as const,
  },
  bizDetailImage: {
    ...StyleSheet.absoluteFillObject,
  },
  bizDetailOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end' as const,
    padding: 14,
  },
  bizDetailMeta: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  bizDetailBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  bizDetailBadgeText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#FFF',
  },
  menuSectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#1A1A2E',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
  },
  menuScrollView: {
    flex: 1,
  },
  menuScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  menuItemCard: {
    flexDirection: 'row' as const,
    backgroundColor: '#FFF',
    borderRadius: 14,
    overflow: 'hidden' as const,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0F0F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  menuItemImage: {
    width: 100,
    height: 100,
  },
  menuItemInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between' as const,
  },
  menuItemName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#1A1A2E',
  },
  menuItemDesc: {
    fontSize: 12,
    color: '#888',
    lineHeight: 16,
    marginTop: 2,
  },
  menuItemBottom: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginTop: 6,
  },
  menuItemPrice: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.dark.primary,
  },
  addToCartBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  cartQtyRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  cartQtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.dark.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  cartQtyBtnAdd: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  cartQtyText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#1A1A2E',
    minWidth: 20,
    textAlign: 'center' as const,
  },
  cartBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
  },
  cartBarLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  cartBadge: {
    backgroundColor: Colors.dark.primary,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  cartBadgeText: {
    fontSize: 12,
    fontWeight: '800' as const,
    color: '#FFF',
  },
  cartBarTotal: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  cartBarSub: {
    fontSize: 11,
    color: '#999',
  },
  cartOrderBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: '#2ECC71',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  cartOrderBtnDisabled: {
    backgroundColor: '#CCC',
  },
  cartOrderBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  orderSuccessModal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
    width: '100%' as unknown as number,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: '#E0E0E8',
  },
  orderSuccessIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(46,204,113,0.1)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 16,
  },
  orderSuccessTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: '#1A1A2E',
    marginBottom: 8,
  },
  orderSuccessSub: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: 20,
  },
  orderSuccessDetails: {
    width: '100%' as unknown as number,
    backgroundColor: '#F8F8F8',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    gap: 10,
  },
  orderSuccessRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  orderSuccessLabel: {
    fontSize: 14,
    color: '#888',
  },
  orderSuccessValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#1A1A2E',
  },
  orderSuccessDivider: {
    height: 1,
    backgroundColor: '#E8E8ED',
  },
  orderSuccessTotalLabel: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  orderSuccessTotalValue: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.dark.primary,
  },
  orderSuccessBtn: {
    backgroundColor: '#2ECC71',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center' as const,
    width: '100%' as unknown as number,
  },
  orderSuccessBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  courierActionRow: {
    flexDirection: 'row' as const,
    gap: 12,
    marginBottom: 18,
  },
  callCourierCard: {
    borderRadius: 16,
    overflow: 'hidden' as const,
    shadowColor: '#00C853',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  callCourierCardInner: {
    flexDirection: 'column' as const,
    alignItems: 'flex-start' as const,
    backgroundColor: '#00C853',
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 10,
    flex: 1,
  },
  callCourierCardIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  customOrderCard: {
    marginBottom: 18,
    borderRadius: 16,
    overflow: 'hidden' as const,
    shadowColor: '#F5A623',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  customOrderCardGradient: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#F5A623',
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 14,
  },
  customOrderCardIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  customOrderCardContent: {
    flex: 1,
  },
  customOrderCardTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: '#FFF',
    marginBottom: 3,
  },
  customOrderCardDesc: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 17,
  },
  customOrderBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    backgroundColor: '#F5A623',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
  },
  customOrderBannerTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  customOrderBannerSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 1,
  },
  customOrderSectionLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#1A1A2E',
    marginBottom: 8,
    marginTop: 4,
  },
  customOrderSectionHint: {
    fontSize: 12,
    color: '#999',
    marginBottom: 10,
    marginTop: -4,
  },
  customOrderInputWrap: {
    backgroundColor: '#F6F6F6',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ECECEC',
    marginBottom: 18,
  },
  customOrderTextInput: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 15,
    color: '#1A1A2E',
    minHeight: 120,
    maxHeight: 250,
    lineHeight: 22,
  },
  customOrderImagesRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    marginBottom: 20,
  },
  customOrderImageWrap: {
    width: 80,
    height: 80,
    borderRadius: 12,
    overflow: 'hidden' as const,
    position: 'relative' as const,
  },
  customOrderImage: {
    width: 80,
    height: 80,
  },
  customOrderImageRemove: {
    position: 'absolute' as const,
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  customOrderAddImageBtn: {
    width: 80,
    height: 80,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    borderStyle: 'dashed' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
    backgroundColor: '#FAFAFA',
  },
  customOrderAddImageText: {
    fontSize: 11,
    color: Colors.dark.primary,
    fontWeight: '600' as const,
  },
  customOrderMapWrap: {
    height: 200,
    borderRadius: 14,
    overflow: 'hidden' as const,
    marginBottom: 18,
    position: 'relative' as const,
    borderWidth: 1,
    borderColor: '#ECECEC',
  },
  customOrderMap: {
    ...StyleSheet.absoluteFillObject,
  },
  customOrderMapPin: {
    position: 'absolute' as const,
    top: '50%' as unknown as number,
    left: '50%' as unknown as number,
    marginLeft: -16,
    marginTop: -32,
    zIndex: 10,
  },
  customOrderConfirmLocBtn: {
    position: 'absolute' as const,
    bottom: 10,
    alignSelf: 'center' as const,
    left: 40,
    right: 40,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: Colors.dark.accent,
    paddingVertical: 10,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  customOrderConfirmLocText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  customOrderLocConfirmed: {
    position: 'absolute' as const,
    bottom: 10,
    alignSelf: 'center' as const,
    left: 40,
    right: 40,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: '#FFF',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.3)',
  },
  customOrderLocConfirmedText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#2ECC71',
  },
  customOrderAddressWrap: {
    backgroundColor: '#F6F6F6',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ECECEC',
  },
  customOrderAddressInput: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 15,
    color: '#1A1A2E',
    minHeight: 70,
    lineHeight: 22,
  },
  customOrderAddressDetailInput: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#1A1A2E',
  },
  customOrderSubmitBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: '#2ECC71',
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 24,
    marginBottom: 30,
    shadowColor: '#2ECC71',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  customOrderSubmitBtnDisabled: {
    backgroundColor: '#CCC',
    shadowOpacity: 0,
    elevation: 0,
  },
  customOrderSubmitText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  safetySection: {
    marginBottom: 18,
  },
  safetySectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 10,
  },
  safetySectionHeaderLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  safetySectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  safetySectionBadge: {
    backgroundColor: 'rgba(212,160,23,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  safetySectionBadgeText: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: '#D4A017',
    letterSpacing: 0.5,
  },
  safetyCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 16,
    gap: 14,
    marginBottom: 10,
    shadowColor: '#D4A017',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  safetyShieldWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255,215,0,0.12)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  safetyCardContent: {
    flex: 1,
  },
  safetyCardTitle: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#FFD700',
    marginBottom: 3,
  },
  safetyCardDesc: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 17,
  },
  safetyLevels: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(212,160,23,0.18)',
    shadowColor: '#D4A017',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  safetyLevelRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
    backgroundColor: '#FAFAF5',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  safetyLevelStars: {
    flexDirection: 'row' as const,
    gap: 3,
    width: 52,
  },
  safetyLevelInfo: {
    flex: 1,
  },
  safetyLevelName: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#1A1A2E',
    letterSpacing: 0.1,
  },
  safetyLevelDesc: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
    lineHeight: 16,
  },
  safetySlogan: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: 'rgba(46,204,113,0.06)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.12)',
  },
  safetySloganIcon: {
    fontSize: 14,
  },
  safetySloganText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: '#2ECC71',
  },
  mainCardSafetyBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    alignSelf: 'flex-start' as const,
    gap: 4,
    backgroundColor: '#1A1A2E',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 6,
  },
  mainCardSafetyText: {
    fontSize: 8,
    fontWeight: '800' as const,
    color: '#FFD700',
    letterSpacing: 0.5,
  },
  venueTopLeft: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 6,
    flex: 1,
  },
  venueSafetyBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.3)',
  },
  venueBottomSafety: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginTop: 2,
  },
  venueBottomSafetyText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#FFD700',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  bizSafetyOverlay: {
    position: 'absolute' as const,
    top: 12,
    left: 12,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: 'rgba(26,26,46,0.85)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.3)',
  },
  bizSafetyText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#FFD700',
  },
  receiptSafetyBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: '#FFFDF5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(212,160,23,0.2)',
  },
  receiptSafetyText: {
    flex: 1,
    fontSize: 12,
    color: '#8B7340',
    fontWeight: '600' as const,
    lineHeight: 17,
  },
  tripSafetyMsg: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: 'rgba(255,215,0,0.06)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    width: '100%' as unknown as number,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.15)',
  },
  tripSafetyMsgText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#8B7340',
  },
  cancelReasonModal: {
    width: '90%' as unknown as number,
    maxWidth: 400,
    backgroundColor: '#FFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 20,
  },
  cancelReasonHeader: {
    alignItems: 'center' as const,
    marginBottom: 20,
    marginTop: 8,
  },
  cancelReasonIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(231,76,60,0.08)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
  },
  cancelReasonTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: '#1A1A2E',
    marginBottom: 4,
  },
  cancelReasonSubtitle: {
    fontSize: 14,
    color: '#888',
    fontWeight: '500' as const,
  },
  cancelReasonList: {
    width: '100%' as unknown as number,
    gap: 8,
    marginBottom: 20,
  },
  cancelReasonItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#EDEDF2',
    backgroundColor: '#FAFAFC',
    gap: 12,
  },
  cancelReasonItemSelected: {
    borderColor: '#E74C3C',
    backgroundColor: 'rgba(231,76,60,0.04)',
  },
  cancelReasonRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#D0D0D8',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  cancelReasonRadioSelected: {
    borderColor: '#E74C3C',
  },
  cancelReasonRadioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E74C3C',
  },
  cancelReasonLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#444',
    flex: 1,
  },
  cancelReasonLabelSelected: {
    color: '#E74C3C',
  },
  cancelReasonConfirmBtn: {
    backgroundColor: '#E74C3C',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center' as const,
    width: '100%' as unknown as number,
    marginBottom: 10,
  },
  cancelReasonConfirmBtnDisabled: {
    backgroundColor: '#F0D0CC',
  },
  cancelReasonConfirmBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  cancelReasonBackBtn: {
    paddingVertical: 12,
    alignItems: 'center' as const,
    width: '100%' as unknown as number,
  },
  cancelReasonBackBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#888',
  },
  vehicleSelectInlineTitle: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: '#1A1A2E',
    marginBottom: 12,
  },
  vehicleSelectInlineRow: {
    flexDirection: 'row' as const,
    gap: 8,
    marginBottom: 14,
  },
  vehicleSelectInlineCard: {
    flex: 1,
    alignItems: 'center' as const,
    paddingVertical: 13,
    paddingHorizontal: 6,
    borderRadius: 16,
    backgroundColor: '#F8F9FC',
    borderWidth: 1.5,
    borderColor: '#E3E7EF',
    position: 'relative' as const,
  },
  vehicleSelectInlineCardActive: {
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  vehicleSelectInlineCardDisabled: {
    opacity: 0.5,
    backgroundColor: '#F9F0F0',
    borderColor: 'rgba(231,76,60,0.2)',
  },
  vehicleSelectInlineWeather: {
    position: 'absolute' as const,
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(231,76,60,0.8)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  vehicleSelectInlineEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  vehicleSelectInlineLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#555',
    marginBottom: 2,
    textAlign: 'center' as const,
  },
  vehicleSelectInlinePrice: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#888',
  },
  vehicleSelectInlineWeatherBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: '#FFF0F0',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(231,76,60,0.12)',
  },
  vehicleSelectInlineWeatherText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#C0392B',
    flex: 1,
  },

});
