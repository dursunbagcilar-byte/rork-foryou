import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Switch, Platform, Alert, ScrollView, Linking, Image, Dimensions, ActivityIndicator, TextInput, KeyboardAvoidingView, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Circle, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import WebMapFallback from '@/components/WebMapFallback';
import type { WebMapMarker, WebMapPolyline } from '@/components/WebMapFallback';
import {
  Wifi, WifiOff, Users, Navigation, Car, Phone, MapPin,
  Volume2, VolumeX, AlertTriangle, ChevronRight, CornerUpRight,
  CornerUpLeft, ArrowUp, RotateCw, Route, Banknote, Clock,
  UserCheck, Camera, Menu, User, X, MessageCircle, Send,
} from 'lucide-react-native';
import * as Speech from 'expo-speech';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Colors } from '@/constants/colors';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from '@/hooks/useLocation';
import { useAppActive } from '@/hooks/useAppActive';
import { useMounted } from '@/hooks/useMounted';
import { ISTANBUL_REGION, generateHeatPoints } from '@/constants/mockData';
import type { HeatPoint } from '@/constants/mockData';
import { getCityByName, getCityRegion } from '@/constants/cities';
import { calculateDistance, estimateDuration } from '@/constants/pricing';
import { getVehicleImageUrl } from '@/constants/vehicleImages';
import type { Driver } from '@/constants/mockData';
import { buildApiUrl, getSessionToken, trpc } from '@/lib/trpc';
import { getDbHeaders } from '@/utils/db';
import { getGoogleMapsApiKey, getGeocodingUrl, logMapsKeyStatus } from '@/utils/maps';
import { keyboardAvoidingBehavior, keyboardVerticalOffset } from '@/utils/platform';

const GOOGLE_API_KEY = getGoogleMapsApiKey();
const ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const geocodeCache = new Map<string, { address: string; timestamp: number }>();
const GEOCODE_CACHE_TTL = 30 * 60 * 1000;

async function cachedReverseGeocode(lat: number, lng: number): Promise<string | null> {
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < GEOCODE_CACHE_TTL) {
    console.log('[Geocode] Cache hit for:', cacheKey);
    return cached.address;
  }
  try {
    const url = getGeocodingUrl(lat, lng);
    if (!url) {
      console.warn('[Geocode] No API key, cannot reverse geocode');
      return null;
    }
    const res = await fetch(url);
    const data = await res.json();
    if (data.status === 'REQUEST_DENIED') {
      console.warn('[Geocode] API key rejected:', data.error_message);
      return null;
    }
    if (data.results && data.results.length > 0) {
      const addr = data.results[0].formatted_address ?? '';
      geocodeCache.set(cacheKey, { address: addr, timestamp: Date.now() });
      if (geocodeCache.size > 100) {
        const firstKey = geocodeCache.keys().next().value;
        if (firstKey) geocodeCache.delete(firstKey);
      }
      return addr;
    }
    return null;
  } catch (e) {
    console.log('[Geocode] Error:', e);
    return null;
  }
}

if (Platform.OS === 'web') {
  logMapsKeyStatus();
}

interface DirectionStep {
  instruction: string;
  distance: string;
  duration: string;
  maneuver?: string;
  startLocation: { latitude: number; longitude: number };
  endLocation: { latitude: number; longitude: number };
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

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

interface DriverSyncResponse {
  success: boolean;
  error?: string | null;
}

async function postDriverSync(path: string, body: Record<string, unknown>): Promise<DriverSyncResponse> {
  const sessionToken = await getSessionToken();
  if (!sessionToken) {
    throw new Error('Oturum bulunamadı');
  }

  const headers = getDbHeaders({
    authorization: `Bearer ${sessionToken}`,
  });

  const endpoint = buildApiUrl(path);
  console.log('[Driver] REST sync request:', endpoint, JSON.stringify(body));
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const rawText = await response.text();
  let data: DriverSyncResponse | null = null;

  try {
    data = rawText ? JSON.parse(rawText) as DriverSyncResponse : null;
  } catch (error) {
    console.log('[Driver] REST sync parse error:', path, error, rawText.substring(0, 180));
    throw new Error('Sunucu geçersiz yanıt verdi');
  }

  if (!response.ok || !data?.success) {
    console.log('[Driver] REST sync failed:', path, response.status, data?.error);
    throw new Error(data?.error ?? 'Sürücü durumu eşitlenemedi');
  }

  return data;
}

function getManeuverIcon(maneuver?: string) {
  if (!maneuver) return <ArrowUp size={18} color={Colors.dark.primary} />;
  if (maneuver.includes('left')) return <CornerUpLeft size={18} color={Colors.dark.primary} />;
  if (maneuver.includes('right')) return <CornerUpRight size={18} color={Colors.dark.primary} />;
  if (maneuver.includes('uturn') || maneuver.includes('u-turn')) return <RotateCw size={18} color={Colors.dark.accent} />;
  return <ArrowUp size={18} color={Colors.dark.primary} />;
}

function getDistanceBetween(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function DriverHomeScreen() {
  const { user, customVehicleImage, updateCustomVehicleImage, profilePhoto, updateProfilePhoto } = useAuth();
  const router = useRouter();
  const driver = user as Driver | null;
  const [isScreenFocused, setIsScreenFocused] = useState<boolean>(true);
  const { isAppActive } = useAppActive();
  const isRealtimeScreenActive = isScreenFocused && isAppActive;

  const { location: gpsLocation, permissionGranted: _permissionGranted, isLoading: _locationLoading } = useLocation(true, 5000);

  const DEFAULT_MEGANE_IMAGE = 'https://r2-pub.rork.com/generated-images/046712ad-abc8-4571-8041-039fc3ac0356.png';

  const _defaultVehicleImageUrl = React.useMemo(
    () => getVehicleImageUrl(driver?.vehicleModel ?? ''),
    [driver?.vehicleModel]
  );

  const vehicleImageUrl = customVehicleImage ?? DEFAULT_MEGANE_IMAGE;

  const driverCity = driver?.city ? getCityByName(driver.city) : null;
  const fallbackRegion = driverCity ? getCityRegion(driverCity) : ISTANBUL_REGION;

  const cityCenter = driverCity
    ? { latitude: driverCity.latitude, longitude: driverCity.longitude }
    : { latitude: ISTANBUL_REGION.latitude, longitude: ISTANBUL_REGION.longitude };

  const mapRegion = gpsLocation
    ? { latitude: gpsLocation.latitude, longitude: gpsLocation.longitude, latitudeDelta: 0.008, longitudeDelta: 0.008 }
    : { ...fallbackRegion, latitudeDelta: 0.008, longitudeDelta: 0.008 };

  useFocusEffect(
    useCallback(() => {
      console.log('[Driver] Map focused - realtime polling resumed');
      setIsScreenFocused(true);
      return () => {
        console.log('[Driver] Map blurred - idle polling paused');
        setIsScreenFocused(false);
      };
    }, [])
  );

  const { driverApproved: isApproved } = useAuth();
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [hasRideRequest, setHasRideRequest] = useState<boolean>(false);
  const [rideAccepted, setRideAccepted] = useState<boolean>(false);
  const [driverSimLoc, setDriverSimLoc] = useState<{ latitude: number; longitude: number } | null>(null);
  const [etaToPickup, setEtaToPickup] = useState<number>(0);
  const [etaToDropoff, setEtaToDropoff] = useState<number>(0);
  const [arrivedAtPickup, setArrivedAtPickup] = useState<boolean>(false);
  const [confirmedArrival, setConfirmedArrival] = useState<boolean>(false);
  const [customerPickedUp, setCustomerPickedUp] = useState<boolean>(false);
  const [navigatingToDropoff, setNavigatingToDropoff] = useState<boolean>(false);
  const [arrivedAtDropoff, setArrivedAtDropoff] = useState<boolean>(false);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [navigationSteps, setNavigationSteps] = useState<DirectionStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(false);
  const [voiceDisclaimerShown, setVoiceDisclaimerShown] = useState<boolean>(false);
  const [totalDistance, setTotalDistance] = useState<string>('');
  const [_totalDuration, setTotalDuration] = useState<string>('');
  const [isFetchingRoute, setIsFetchingRoute] = useState<boolean>(false);
  const [showCourteousWarning, setShowCourteousWarning] = useState<boolean>(false);
  const [dropoffAddressResolved, setDropoffAddressResolved] = useState<string>('');
  const [pickupAddressResolved, setPickupAddressResolved] = useState<string>('');
  const [isProcessingVehicle, setIsProcessingVehicle] = useState<boolean>(false);
  const [showHeatMap, _setShowHeatMap] = useState<boolean>(true);
  const [showDriverCancelReasonModal, setShowDriverCancelReasonModal] = useState<boolean>(false);
  const [selectedDriverCancelReason, setSelectedDriverCancelReason] = useState<string>('');
  const [currentRideId, setCurrentRideId] = useState<string | null>(null);
  const [currentCustomerName, setCurrentCustomerName] = useState<string>('');
  const [showDriverChatModal, setShowDriverChatModal] = useState<boolean>(false);
  const [driverChatInput, setDriverChatInput] = useState<string>('');
  const [driverChatMessages, setDriverChatMessages] = useState<Array<{ id: string; text: string; fromMe: boolean; time: string }>>([]);
  const [currentCustomerPhone, setCurrentCustomerPhone] = useState<string>('');
  const [_currentRidePrice, setCurrentRidePrice] = useState<number>(0);

  const mounted = useMounted();

  const heatPoints = React.useMemo<HeatPoint[]>(() => {
    return generateHeatPoints(cityCenter.latitude, cityCenter.longitude);
  }, [cityCenter.latitude, cityCenter.longitude]);

  const driverPathRef = useRef<{ latitude: number; longitude: number }[]>([]);
  const driverPathIdxRef = useRef<number>(0);
  const trackingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestAnim = useRef(new Animated.Value(0)).current;
  const mapRef = useRef<MapView>(null);
  const spokenStepsRef = useRef<Set<number>>(new Set());
  const userInteractingRef = useRef<boolean>(false);
  const [mapCentered, setMapCentered] = useState<boolean>(true);
  const driverMarkerCoord = useRef<{ latitude: number; longitude: number }>({
    latitude: mapRegion.latitude,
    longitude: mapRegion.longitude,
  });
  const locationOffsetRef = useRef({
    lat: (Math.random() - 0.5) * 0.01,
    lng: (Math.random() - 0.5) * 0.01,
  });
  const syncDriverLocationMutation = useMutation({
    mutationFn: async (payload: { driverId: string; latitude: number; longitude: number }) => {
      return postDriverSync('/drivers/update-location', payload);
    },
  });
  const syncDriverOnlineStatusMutation = useMutation({
    mutationFn: async (payload: { driverId: string; isOnline: boolean }) => {
      return postDriverSync('/drivers/set-online-status', payload);
    },
  });
  const syncDriverLocationMutateRef = useRef(syncDriverLocationMutation.mutate);
  const syncDriverOnlineStatusMutateRef = useRef(syncDriverOnlineStatusMutation.mutate);
  const lastOnlineStatusSyncKeyRef = useRef<string | null>(null);
  const onlineStatusSyncInFlightKeyRef = useRef<string | null>(null);
  const acceptRideMutation = trpc.rides.accept.useMutation();
  const declineRideMutation = trpc.rides.decline.useMutation();
  const declineBusinessOrderMutation = trpc.rides.declineBusinessOrder.useMutation();
  const startRideMutation = trpc.rides.startRide.useMutation();
  const completeRideMutation = trpc.rides.complete.useMutation();
  const cancelRideMutation = trpc.rides.cancel.useMutation();
  const sendMessageMutation = trpc.messages.send.useMutation();
  const rideMessagesQuery = trpc.messages.getByRide.useQuery(
    { rideId: currentRideId ?? '' },
    {
      enabled: !!currentRideId && showDriverChatModal && isRealtimeScreenActive,
      refetchInterval: isRealtimeScreenActive ? 5000 : false,
      staleTime: 4000,
    }
  );

  const pendingRidesQuery = trpc.rides.getPendingByCity.useQuery(
    {
      city: driver?.city ?? '',
      driverCategory: driver?.driverCategory ?? 'driver',
      driverId: driver?.id ?? '',
    },
    {
      enabled: isRealtimeScreenActive && isOnline && !!driver?.city && !rideAccepted && !hasRideRequest,
      refetchInterval: isRealtimeScreenActive ? 5000 : false,
      staleTime: 4000,
    }
  );

  const activeRideQuery = trpc.rides.getActiveRide.useQuery(
    { userId: driver?.id ?? '', type: 'driver' as const },
    {
      enabled: !!driver?.id && isOnline && isRealtimeScreenActive,
      refetchInterval: isRealtimeScreenActive ? ((rideAccepted || hasRideRequest) ? 5000 : 15000) : false,
      staleTime: 4000,
    }
  );

  useEffect(() => {
    syncDriverLocationMutateRef.current = syncDriverLocationMutation.mutate;
  }, [syncDriverLocationMutation.mutate]);

  useEffect(() => {
    syncDriverOnlineStatusMutateRef.current = syncDriverOnlineStatusMutation.mutate;
  }, [syncDriverOnlineStatusMutation.mutate]);

  const pendingRide = React.useMemo(() => {
    const pending = pendingRidesQuery.data ?? [];
    if (pending.length === 0) return null;
    return pending[0];
  }, [pendingRidesQuery.data]);

  const activeOrPendingRide = activeRideQuery.data ?? pendingRide;
  const isBusinessDelivery = activeOrPendingRide?.orderType === 'business_delivery' || activeOrPendingRide?.orderType === 'custom_delivery';
  const currentRideIsFree = activeOrPendingRide?.isFreeRide ?? false;
  const currentRidePrice = activeOrPendingRide?.price ?? _currentRidePrice;
  const pickupLocationTitle = isBusinessDelivery ? 'İşletme Noktası' : 'Müşteri Konumu';
  const inlineRequestTitle = isBusinessDelivery ? 'Yeni İşletme Siparişi!' : 'Yeni Yolculuk Talebi!';
  const pickupActionLabel = isBusinessDelivery ? 'Siparişi Aldım' : 'Müşteriyi Aldım';
  const pickupWaitingLabel = isBusinessDelivery ? 'Sipariş sizi bekliyor' : 'Müşteri sizi bekliyor';
  const pickupTravellingLabel = isBusinessDelivery ? 'İşletmeye gidiliyor' : 'Müşteriye gidiliyor';
  const safeDrivingReminder = 'Müşterimizi en güvenli şekilde evine ulaştır. Trafikte son derece dikkatli ol, unutma: acelen yok.';

  const pickupCoord = React.useMemo(() => {
    if (pendingRide?.pickupLat && pendingRide?.pickupLng) {
      return { latitude: pendingRide.pickupLat, longitude: pendingRide.pickupLng };
    }
    if (currentRideId && activeRideQuery.data) {
      const ar = activeRideQuery.data;
      if (ar.pickupLat && ar.pickupLng) {
        return { latitude: ar.pickupLat, longitude: ar.pickupLng };
      }
    }
    return {
      latitude: cityCenter.latitude + 0.005,
      longitude: cityCenter.longitude + 0.007,
    };
  }, [pendingRide, currentRideId, activeRideQuery.data, cityCenter.latitude, cityCenter.longitude]);

  const dropoffCoord = React.useMemo(() => {
    if (pendingRide?.dropoffLat && pendingRide?.dropoffLng) {
      return { latitude: pendingRide.dropoffLat, longitude: pendingRide.dropoffLng };
    }
    if (currentRideId && activeRideQuery.data) {
      const ar = activeRideQuery.data;
      if (ar.dropoffLat && ar.dropoffLng) {
        return { latitude: ar.dropoffLat, longitude: ar.dropoffLng };
      }
    }
    return {
      latitude: cityCenter.latitude + 0.027,
      longitude: cityCenter.longitude + 0.025,
    };
  }, [pendingRide, currentRideId, activeRideQuery.data, cityCenter.latitude, cityCenter.longitude]);

  useEffect(() => {
    if (pendingRide && isOnline && !hasRideRequest && !rideAccepted) {
      console.log('[Driver] New pending ride from backend:', pendingRide.id, pendingRide.pickupAddress);
      setCurrentRideId(pendingRide.id);
      setCurrentCustomerName((pendingRide as any).businessName ?? (pendingRide as any).customerName ?? 'Müşteri');
      setCurrentCustomerPhone('');
      setCurrentRidePrice(pendingRide.price ?? 0);
      setHasRideRequest(true);
      Animated.spring(requestAnim, { toValue: 1, useNativeDriver: true }).start();
    }
  }, [pendingRide, isOnline, hasRideRequest, rideAccepted, requestAnim]);

  useEffect(() => {
    if (!hasRideRequest || rideAccepted) return;
    if (pendingRide) return;
    if (activeRideQuery.data) return;
    if (!currentRideId) return;

    console.log('[Driver] Pending ride request cleared or reassigned:', currentRideId);
    setHasRideRequest(false);
    setCurrentRideId(null);
    Animated.timing(requestAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
  }, [activeRideQuery.data, currentRideId, hasRideRequest, pendingRide, requestAnim, rideAccepted]);

  useEffect(() => {
    if (isOnline) {
      setVoiceEnabled(true);
      console.log('[Voice] Sesli yanıt sistemi aktif - şoför müsait');
    } else {
      setVoiceEnabled(false);
      try {
        if (Platform.OS !== 'web') {
          void Speech.stop();
        }
      } catch (error) {
        console.log('[Voice] Stop error while going offline:', error);
      }
      console.log('[Voice] Sesli yanıt sistemi kapalı - şoför meşgul');
    }
  }, [isOnline]);

  useEffect(() => {
    if (!driver?.id) {
      return;
    }
    if (!isAppActive) {
      console.log('[Driver] App inactive - online status sync paused');
      return;
    }

    const syncKey = `${driver.id}:${isOnline ? 'online' : 'offline'}`;
    if (lastOnlineStatusSyncKeyRef.current === syncKey) {
      console.log('[Driver] Online status already synced, skipping duplicate request:', syncKey);
      return;
    }
    if (onlineStatusSyncInFlightKeyRef.current === syncKey) {
      console.log('[Driver] Online status sync already in flight, skipping duplicate request:', syncKey);
      return;
    }

    onlineStatusSyncInFlightKeyRef.current = syncKey;
    syncDriverOnlineStatusMutateRef.current(
      { driverId: driver.id, isOnline },
      {
        onSuccess: () => {
          lastOnlineStatusSyncKeyRef.current = syncKey;
          console.log('[Driver] Online status synced:', isOnline);
        },
        onError: (error: unknown) => {
          console.log('[Driver] Online status sync error:', error);
        },
        onSettled: () => {
          if (onlineStatusSyncInFlightKeyRef.current === syncKey) {
            onlineStatusSyncInFlightKeyRef.current = null;
          }
        },
      }
    );
  }, [isOnline, driver?.id, isAppActive]);

  const lastSentLocationRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const isLocationSyncInFlightRef = useRef<boolean>(false);
  const latestGpsLocationRef = useRef<{ latitude: number; longitude: number } | null>(
    gpsLocation ? { latitude: gpsLocation.latitude, longitude: gpsLocation.longitude } : null
  );
  const latestFallbackRegionRef = useRef<{ latitude: number; longitude: number }>({
    latitude: fallbackRegion.latitude,
    longitude: fallbackRegion.longitude,
  });

  useEffect(() => {
    latestGpsLocationRef.current = gpsLocation
      ? { latitude: gpsLocation.latitude, longitude: gpsLocation.longitude }
      : null;
  }, [gpsLocation]);

  useEffect(() => {
    latestFallbackRegionRef.current = {
      latitude: fallbackRegion.latitude,
      longitude: fallbackRegion.longitude,
    };
  }, [fallbackRegion.latitude, fallbackRegion.longitude]);

  const locationSendInterval = React.useMemo(() => {
    if (rideAccepted && !arrivedAtPickup) return 5000;
    if (customerPickedUp && navigatingToDropoff) return 5000;
    return 20000;
  }, [rideAccepted, arrivedAtPickup, customerPickedUp, navigatingToDropoff]);

  const shouldSyncDriverLocation = isOnline && !!driver?.id && isRealtimeScreenActive;

  useEffect(() => {
    if (!shouldSyncDriverLocation || !driver?.id) return;
    const driverId = driver.id;
    const MIN_DISTANCE_METERS = 5;

    const hasMoved = (lat: number, lng: number): boolean => {
      const last = lastSentLocationRef.current;
      if (!last) return true;
      const R = 6371000;
      const dLat = (lat - last.lat) * Math.PI / 180;
      const dLon = (lng - last.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(last.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return dist > MIN_DISTANCE_METERS;
    };

    const sendLocation = () => {
      const liveLocation = latestGpsLocationRef.current;
      const fallbackLocation = latestFallbackRegionRef.current;

      let lat: number;
      let lng: number;
      if (liveLocation) {
        lat = liveLocation.latitude;
        lng = liveLocation.longitude;
      } else {
        lat = fallbackLocation.latitude + locationOffsetRef.current.lat + (Math.random() - 0.5) * 0.001;
        lng = fallbackLocation.longitude + locationOffsetRef.current.lng + (Math.random() - 0.5) * 0.001;
      }

      if (hasMoved(lat, lng)) {
        if (isLocationSyncInFlightRef.current) {
          console.log('[Driver] Skipping location sync because previous request is still in flight');
          return;
        }
        isLocationSyncInFlightRef.current = true;
        syncDriverLocationMutateRef.current(
          { driverId, latitude: lat, longitude: lng },
          {
            onError: (error: unknown) => {
              console.log('[Driver] Location sync error:', error);
            },
            onSettled: () => {
              isLocationSyncInFlightRef.current = false;
            },
          }
        );
        lastSentLocationRef.current = { lat, lng, time: Date.now() };
        console.log('[Driver] Location broadcast:', lat.toFixed(5), lng.toFixed(5), 'interval:', locationSendInterval);
      } else {
        const timeSinceLast = lastSentLocationRef.current ? Date.now() - lastSentLocationRef.current.time : 999999;
        if (timeSinceLast > 45000) {
          if (isLocationSyncInFlightRef.current) {
            console.log('[Driver] Skipping heartbeat sync because previous request is still in flight');
            return;
          }
          isLocationSyncInFlightRef.current = true;
          syncDriverLocationMutateRef.current(
            { driverId, latitude: lat, longitude: lng },
            {
              onError: (error: unknown) => {
                console.log('[Driver] Heartbeat location sync error:', error);
              },
              onSettled: () => {
                isLocationSyncInFlightRef.current = false;
              },
            }
          );
          lastSentLocationRef.current = { lat, lng, time: Date.now() };
          console.log('[Driver] Heartbeat location broadcast');
        }
      }
    };
    sendLocation();
    const locationInterval = setInterval(sendLocation, locationSendInterval);
    return () => clearInterval(locationInterval);
  }, [shouldSyncDriverLocation, driver?.id, locationSendInterval]);

  const pickupAddress = pickupAddressResolved || pendingRide?.pickupAddress || activeRideQuery.data?.pickupAddress || (driver?.district ? `${driver.district} Merkez` : (isBusinessDelivery ? 'İşletme Adresi' : 'Alış Noktası'));
  const dropoffAddress = dropoffAddressResolved || pendingRide?.dropoffAddress || activeRideQuery.data?.dropoffAddress || 'Varış Noktası';
  const fallbackDistanceKm = calculateDistance(pickupCoord.latitude, pickupCoord.longitude, dropoffCoord.latitude, dropoffCoord.longitude);
  const currentRideDistanceLabel = activeOrPendingRide?.distance ?? `${fallbackDistanceKm} km`;
  const currentRideDurationLabel = activeOrPendingRide?.duration ?? `~${estimateDuration(fallbackDistanceKm)} dk`;
  const currentRidePriceLabel = currentRideIsFree ? 'Ücretsiz' : `₺${currentRidePrice.toFixed(0)}`;

  useEffect(() => {
    if (dropoffCoord) {
      void cachedReverseGeocode(dropoffCoord.latitude, dropoffCoord.longitude).then(addr => {
        if (addr) {
          setDropoffAddressResolved(addr);
          console.log('[Geocode] Dropoff address resolved:', addr);
        } else {
          setDropoffAddressResolved(driver?.city ? `${driver.city} Varış Noktası` : 'Varış Noktası');
        }
      });
    }
  }, [dropoffCoord, driver?.city]);

  useEffect(() => {
    if (pickupCoord) {
      void cachedReverseGeocode(pickupCoord.latitude, pickupCoord.longitude).then(addr => {
        if (addr) {
          setPickupAddressResolved(addr);
          console.log('[Geocode] Pickup address resolved:', addr);
        } else {
          setPickupAddressResolved(driver?.district ? `${driver.district} Merkez` : (isBusinessDelivery ? 'İşletme Adresi' : 'Alış Noktası'));
        }
      });
    }
  }, [pickupCoord, driver?.district, isBusinessDelivery]);

  const handlePickProfilePhoto = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('İzin Gerekli', 'Fotoğraf seçebilmek için galeri erişim izni gereklidir.');
        return;
      }

      Alert.alert(
        'Profil Fotoğrafı',
        'Profil fotoğrafınızı nasıl değiştirmek istersiniz?',
        [
          {
            text: 'Galeriden Seç',
            onPress: async () => {
              try {
                const result = await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ImagePicker.MediaTypeOptions.Images,
                  allowsEditing: true,
                  aspect: [1, 1],
                  quality: 0.8,
                });
                if (!result.canceled && result.assets[0]?.uri) {
                  void updateProfilePhoto(result.assets[0].uri);
                  console.log('[Driver] Profile photo set from gallery');
                }
              } catch (e) {
                console.log('[Driver] Gallery pick error:', e);
              }
            },
          },
          {
            text: 'Kamera ile Çek',
            onPress: async () => {
              try {
                const camStatus = await ImagePicker.requestCameraPermissionsAsync();
                if (camStatus.status !== 'granted') {
                  Alert.alert('İzin Gerekli', 'Kamera erişim izni gereklidir.');
                  return;
                }
                const result = await ImagePicker.launchCameraAsync({
                  allowsEditing: true,
                  aspect: [1, 1],
                  quality: 0.8,
                });
                if (!result.canceled && result.assets[0]?.uri) {
                  void updateProfilePhoto(result.assets[0].uri);
                  console.log('[Driver] Profile photo set from camera');
                }
              } catch (e) {
                console.log('[Driver] Camera pick error:', e);
              }
            },
          },
          { text: 'İptal', style: 'cancel' as const },
        ]
      );
    } catch (e) {
      console.log('[Driver] Pick profile photo error:', e);
    }
  }, [updateProfilePhoto]);

  const processVehicleBackground = useCallback(async (imageUri: string) => {
    setIsProcessingVehicle(true);
    try {
      console.log('[AI] Starting background removal for vehicle image...');
      let base64Data = '';
      if (Platform.OS === 'web') {
        const response = await fetch(imageUri);
        const blob = await response.blob();
        base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1] || '');
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        base64Data = await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      const editResponse = await fetch('https://toolkit.rork.com/images/edit/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Remove the entire background from this car/vehicle photo. Keep ONLY the car/vehicle itself with a completely clean transparent or white background. Remove all buildings, roads, trees, people, sky, and any other background elements. The result should look like a professional car showroom cutout photo with just the vehicle visible.',
          images: [{ type: 'image', image: base64Data }],
          aspectRatio: '16:9',
        }),
      });

      if (!editResponse.ok) {
        throw new Error(`API error: ${editResponse.status}`);
      }

      const editResult = await editResponse.json();
      if (editResult?.image?.base64Data) {
        const mimeType = editResult.image.mimeType || 'image/png';
        const processedUri = `data:${mimeType};base64,${editResult.image.base64Data}`;
        void updateCustomVehicleImage(processedUri);
        console.log('[AI] Vehicle background removed successfully');
      } else {
        throw new Error('No image data in response');
      }
    } catch (e) {
      console.log('[AI] Background removal error:', e);
      Alert.alert(
        'Arka Plan Kaldırma',
        'Arka plan kaldırılamadı, orijinal fotoğraf kullanılacak.',
        [{ text: 'Tamam' }]
      );
      void updateCustomVehicleImage(imageUri);
    } finally {
      setIsProcessingVehicle(false);
    }
  }, [updateCustomVehicleImage]);

  const handlePickVehicleImage = useCallback(async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('İzin Gerekli', 'Fotoğraf seçebilmek için galeri erişim izni gereklidir.');
        return;
      }

      Alert.alert(
        'Araç Görseli',
        'Araç görselinizi nasıl değiştirmek istersiniz?',
        [
          {
            text: 'Galeriden Seç',
            onPress: async () => {
              try {
                const result = await ImagePicker.launchImageLibraryAsync({
                  mediaTypes: ImagePicker.MediaTypeOptions.Images,
                  allowsEditing: true,
                  aspect: [16, 9],
                  quality: 0.8,
                });
                if (!result.canceled && result.assets[0]?.uri) {
                  void processVehicleBackground(result.assets[0].uri);
                  console.log('[Driver] Custom vehicle image picked from gallery, processing...');
                }
              } catch (e) {
                console.log('[Driver] Gallery pick error:', e);
              }
            },
          },
          {
            text: 'Kamera ile Çek',
            onPress: async () => {
              try {
                const camStatus = await ImagePicker.requestCameraPermissionsAsync();
                if (camStatus.status !== 'granted') {
                  Alert.alert('İzin Gerekli', 'Kamera erişim izni gereklidir.');
                  return;
                }
                const result = await ImagePicker.launchCameraAsync({
                  allowsEditing: true,
                  aspect: [16, 9],
                  quality: 0.8,
                });
                if (!result.canceled && result.assets[0]?.uri) {
                  void processVehicleBackground(result.assets[0].uri);
                  console.log('[Driver] Custom vehicle image taken from camera, processing...');
                }
              } catch (e) {
                console.log('[Driver] Camera pick error:', e);
              }
            },
          },
          ...(customVehicleImage ? [{
            text: 'Varsayılana Dön',
            style: 'destructive' as const,
            onPress: () => {
              void updateCustomVehicleImage(null);
              console.log('[Driver] Vehicle image reset to default');
            },
          }] : []),
          { text: 'İptal', style: 'cancel' as const },
        ]
      );
    } catch (e) {
      console.log('[Driver] Pick vehicle image error:', e);
    }
  }, [customVehicleImage, updateCustomVehicleImage, processVehicleBackground]);

  useEffect(() => {
    if (!isOnline) {
      if (hasRideRequest && !rideAccepted) {
        setHasRideRequest(false);
        requestAnim.setValue(0);
        console.log('[Driver] Meşgul durumda - bekleyen yolculuk talebi iptal edildi');
      }
    }
  }, [isOnline, hasRideRequest, rideAccepted, requestAnim]);

  const generateFallbackPath = useCallback((
    origin: { latitude: number; longitude: number },
    destination: { latitude: number; longitude: number }
  ) => {
    const steps = 40;
    const path: { latitude: number; longitude: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      path.push({
        latitude: origin.latitude + (destination.latitude - origin.latitude) * t,
        longitude: origin.longitude + (destination.longitude - origin.longitude) * t,
      });
    }
    setRouteCoords(path);
    driverPathRef.current = path;
    driverPathIdxRef.current = 0;
    setNavigationSteps([{
      instruction: 'Müşteriye doğru ilerleyin',
      distance: '',
      duration: '',
      startLocation: origin,
      endLocation: destination,
    }]);
    return path;
  }, []);

  const fetchDirectionsClassic = useCallback(async (
    origin: { latitude: number; longitude: number },
    destination: { latitude: number; longitude: number }
  ): Promise<{ latitude: number; longitude: number }[] | null> => {
    try {
      console.log('[Navigation] Trying classic Directions API...');
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&mode=driving&language=tr&units=metric&key=${GOOGLE_API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const leg = route.legs?.[0];
        const overviewPolyline = route.overview_polyline?.points;

        if (!overviewPolyline) {
          console.log('[Navigation] Classic API: No polyline');
          return null;
        }

        const points = decodePolyline(overviewPolyline);
        setRouteCoords(points);
        driverPathRef.current = points;
        driverPathIdxRef.current = 0;

        const steps: DirectionStep[] = (leg?.steps ?? []).map((step: {
          html_instructions?: string;
          distance?: { text: string };
          duration?: { text: string };
          maneuver?: string;
          start_location?: { lat: number; lng: number };
          end_location?: { lat: number; lng: number };
        }) => ({
          instruction: stripHtml(step.html_instructions ?? 'İlerleyin'),
          distance: step.distance?.text ?? '',
          duration: step.duration?.text ?? '',
          maneuver: step.maneuver?.toLowerCase(),
          startLocation: {
            latitude: step.start_location?.lat ?? origin.latitude,
            longitude: step.start_location?.lng ?? origin.longitude,
          },
          endLocation: {
            latitude: step.end_location?.lat ?? destination.latitude,
            longitude: step.end_location?.lng ?? destination.longitude,
          },
        }));

        setNavigationSteps(steps);
        setCurrentStepIndex(0);

        const distText = leg?.distance?.text ?? '';
        const durText = leg?.duration?.text ?? '';
        const durSeconds = leg?.duration?.value ?? 0;

        setTotalDistance(distText);
        setTotalDuration(durText);
        setEtaToPickup(Math.max(1, Math.ceil(durSeconds / 60)));

        console.log('[Navigation] Classic API route loaded:', steps.length, 'steps,', distText, durText);
        return points;
      } else {
        console.log('[Navigation] Classic API error:', data.status, data.error_message ?? '');
        return null;
      }
    } catch (error) {
      console.log('[Navigation] Classic API fetch error:', error);
      return null;
    }
  }, []);

  const fetchDirections = useCallback(async (
    origin: { latitude: number; longitude: number },
    destination: { latitude: number; longitude: number }
  ) => {
    setIsFetchingRoute(true);
    try {
      console.log('[Navigation] Fetching directions via Routes API (New)...');

      const requestBody = {
        origin: {
          location: {
            latLng: { latitude: origin.latitude, longitude: origin.longitude },
          },
        },
        destination: {
          location: {
            latLng: { latitude: destination.latitude, longitude: destination.longitude },
          },
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        languageCode: 'tr',
        units: 'METRIC',
      };

      const response = await fetch(ROUTES_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction,routes.legs.steps.localizedValues,routes.legs.steps.startLocation,routes.legs.steps.endLocation,routes.legs.duration,routes.legs.distanceMeters,routes.legs.localizedValues',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const leg = route.legs?.[0];

        const encodedPolyline = route.polyline?.encodedPolyline;
        if (!encodedPolyline) {
          console.log('[Navigation] No polyline in Routes API response, trying classic...');
          const classicResult = await fetchDirectionsClassic(origin, destination);
          return classicResult ?? generateFallbackPath(origin, destination);
        }

        const points = decodePolyline(encodedPolyline);
        setRouteCoords(points);
        driverPathRef.current = points;
        driverPathIdxRef.current = 0;

        const steps: DirectionStep[] = (leg?.steps ?? []).map((step: {
          navigationInstruction?: { instructions?: string; maneuver?: string };
          localizedValues?: { distance?: { text: string }; staticDuration?: { text: string } };
          startLocation?: { latLng?: { latitude: number; longitude: number } };
          endLocation?: { latLng?: { latitude: number; longitude: number } };
        }) => ({
          instruction: step.navigationInstruction?.instructions ?? 'İlerleyin',
          distance: step.localizedValues?.distance?.text ?? '',
          duration: step.localizedValues?.staticDuration?.text ?? '',
          maneuver: step.navigationInstruction?.maneuver?.toLowerCase(),
          startLocation: {
            latitude: step.startLocation?.latLng?.latitude ?? origin.latitude,
            longitude: step.startLocation?.latLng?.longitude ?? origin.longitude,
          },
          endLocation: {
            latitude: step.endLocation?.latLng?.latitude ?? destination.latitude,
            longitude: step.endLocation?.latLng?.longitude ?? destination.longitude,
          },
        }));

        setNavigationSteps(steps);
        setCurrentStepIndex(0);

        const distText = leg?.localizedValues?.distance?.text ?? `${Math.round((route.distanceMeters ?? 0) / 1000)} km`;
        const durText = leg?.localizedValues?.duration?.text ?? `${Math.round(parseInt(route.duration ?? '0', 10) / 60)} dk`;
        const durSeconds = parseInt(route.duration?.replace('s', '') ?? '0', 10);

        setTotalDistance(distText);
        setTotalDuration(durText);
        setEtaToPickup(Math.max(1, Math.ceil(durSeconds / 60)));

        console.log('[Navigation] Routes API loaded:', steps.length, 'steps,', distText, durText);
        return points;
      } else {
        console.log('[Navigation] Routes API failed:', JSON.stringify(data.error ?? data));
        console.log('[Navigation] Falling back to classic Directions API...');
        const classicResult = await fetchDirectionsClassic(origin, destination);
        return classicResult ?? generateFallbackPath(origin, destination);
      }
    } catch (error) {
      console.log('[Navigation] Routes API error:', error);
      console.log('[Navigation] Falling back to classic Directions API...');
      const classicResult = await fetchDirectionsClassic(origin, destination);
      return classicResult ?? generateFallbackPath(origin, destination);
    } finally {
      setIsFetchingRoute(false);
    }
  }, [generateFallbackPath, fetchDirectionsClassic]);

  const safeSpeechStop = useCallback(() => {
    try {
      if (Platform.OS !== 'web') {
        void Speech.stop();
      }
    } catch (e) {
      console.log('[Voice] Stop error:', e);
    }
  }, []);

  const speakInstruction = useCallback((text: string) => {
    if (!voiceEnabled) return;
    try {
      safeSpeechStop();
      if (Platform.OS !== 'web') {
        Speech.speak(text, {
          language: 'tr-TR',
          rate: 0.9,
          pitch: 1.0,
        });
      }
      console.log('[Voice] Speaking:', text);
    } catch (e) {
      console.log('[Voice] Speech error:', e);
    }
  }, [voiceEnabled, safeSpeechStop]);

  const handleToggleVoice = useCallback(() => {
    if (voiceEnabled) {
      if (!voiceDisclaimerShown) {
        Alert.alert(
          'Sesli Navigasyonu Kapat',
          'Sesli uyarıları kapattığınızda yol güvenliği tamamen sizin sorumluluğunuzdadır. Yanlış şeride girme, trafik kurallarını ihlal etme gibi durumlardan uygulama sorumlu tutulamaz.\n\nDevam etmek istiyor musunuz?',
          [
            { text: 'İptal', style: 'cancel' },
            {
              text: 'Kabul Ediyorum',
              style: 'destructive',
              onPress: () => {
                setVoiceEnabled(false);
                setVoiceDisclaimerShown(true);
                safeSpeechStop();
                console.log('[Voice] Disabled with disclaimer accepted');
              },
            },
          ]
        );
      } else {
        setVoiceEnabled(false);
        safeSpeechStop();
      }
    } else {
      setVoiceEnabled(true);
      speakInstruction('Sesli navigasyon açıldı');
    }
  }, [voiceEnabled, voiceDisclaimerShown, speakInstruction, safeSpeechStop]);

  const handleAcceptRide = useCallback(async () => {
    if (!currentRideId || !driver) {
      Alert.alert('Hata', 'Sipariş bilgisi bulunamadı.');
      return;
    }

    try {
      const result = await acceptRideMutation.mutateAsync({
        rideId: currentRideId,
        driverId: driver.id,
        driverName: driver.name ?? 'Şoför',
        driverRating: driver.rating ?? 5.0,
      });

      if (!result?.success) {
        Alert.alert('Sipariş alınamadı', result?.error ?? 'Sipariş başka bir kuryeye geçti.');
        setHasRideRequest(false);
        setCurrentRideId(null);
        Animated.timing(requestAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
        return;
      }

      console.log('[Driver] Ride accepted on backend:', currentRideId, 'isFreeRide:', currentRideIsFree);
    } catch (err) {
      console.log('[Driver] Accept ride backend error:', err);
      Alert.alert('Sipariş alınamadı', 'Sipariş başka bir kuryeye geçti veya süresi doldu.');
      setHasRideRequest(false);
      setCurrentRideId(null);
      Animated.timing(requestAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      return;
    }

    setHasRideRequest(false);
    setRideAccepted(true);
    setArrivedAtPickup(false);
    setShowCourteousWarning(true);
    spokenStepsRef.current = new Set();
    Animated.timing(requestAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
  }, [currentRideId, driver, acceptRideMutation, requestAnim, currentRideIsFree]);

  const handleCourteousWarningOk = useCallback(async () => {
    setShowCourteousWarning(false);

    if (!currentRideId) {
      Alert.alert('Hata', 'Sipariş bilgisi bulunamadı.');
      return;
    }

    const driverOrigin = { latitude: mapRegion.latitude, longitude: mapRegion.longitude };
    const path = await fetchDirections(driverOrigin, pickupCoord);

    if (path && path.length > 0) {
      setDriverSimLoc(path[0]);
      driverMarkerCoord.current = {
        latitude: path[0].latitude,
        longitude: path[0].longitude,
      };
      speakInstruction(isBusinessDelivery ? 'Sipariş kabul edildi. İşletmeye doğru yola çıkılıyor.' : 'Yolculuk kabul edildi. Müşteriye doğru yola çıkılıyor.');
    }
  }, [fetchDirections, speakInstruction, mapRegion.latitude, mapRegion.longitude, pickupCoord, currentRideId, isBusinessDelivery]);

  const handleDeclineRide = useCallback(async () => {
    if (!currentRideId || !driver?.id) {
      Alert.alert('Hata', 'Yolculuk bilgisi bulunamadı.');
      return;
    }

    try {
      if (isBusinessDelivery) {
        const result = await declineBusinessOrderMutation.mutateAsync({
          rideId: currentRideId,
          driverId: driver.id,
        });
        if (!result?.success) {
          const errorMessage = 'error' in result && typeof result.error === 'string'
            ? result.error
            : 'Sipariş şu an reddedilemiyor. Lütfen tekrar deneyin.';
          Alert.alert('Talep Reddedilemedi', errorMessage);
          return;
        }
        const reassigned = 'reassignment' in result && result.reassignment ? result.reassignment.assigned : false;
        console.log('[Driver] Business order declined:', currentRideId, 'reassigned:', reassigned);
      } else {
        const result = await declineRideMutation.mutateAsync({
          rideId: currentRideId,
          driverId: driver.id,
        });
        if (!result?.success) {
          const errorMessage = 'error' in result && typeof result.error === 'string'
            ? result.error
            : 'Yolculuk şu an reddedilemiyor. Lütfen tekrar deneyin.';
          Alert.alert('Talep Reddedilemedi', errorMessage);
          return;
        }
        const reassignedCount = 'newlyNotifiedDriversCount' in result && typeof result.newlyNotifiedDriversCount === 'number'
          ? result.newlyNotifiedDriversCount
          : 0;
        console.log('[Driver] Ride declined:', currentRideId, 'newlyNotifiedDrivers:', reassignedCount);
      }
    } catch (error) {
      console.log('[Driver] Decline ride error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Talep şu an reddedilemiyor. Lütfen tekrar deneyin.';
      Alert.alert('Talep Reddedilemedi', errorMessage);
      return;
    }

    setHasRideRequest(false);
    setCurrentRideId(null);
    setCurrentCustomerName('');
    setCurrentRidePrice(0);
    Animated.timing(requestAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    void pendingRidesQuery.refetch();
  }, [currentRideId, declineBusinessOrderMutation, declineRideMutation, driver?.id, isBusinessDelivery, pendingRidesQuery, requestAnim]);

  useEffect(() => {
    if (rideAccepted && driverSimLoc && !arrivedAtPickup && driverPathRef.current.length > 0) {
      trackingRef.current = setInterval(() => {
        const idx = driverPathIdxRef.current + 1;
        const path = driverPathRef.current;
        if (idx < path.length) {
          driverPathIdxRef.current = idx;
          const currentLoc = path[idx];
          setDriverSimLoc(currentLoc);

          driverMarkerCoord.current = {
            latitude: currentLoc.latitude,
            longitude: currentLoc.longitude,
          };

          const remaining = path.length - idx;
          const etaMin = Math.max(1, Math.ceil(remaining * 0.3));
          setEtaToPickup(etaMin);

          if (navigationSteps.length > 0) {
            let closestStep = currentStepIndex;
            for (let s = currentStepIndex; s < navigationSteps.length; s++) {
              const step = navigationSteps[s];
              const dist = getDistanceBetween(
                currentLoc.latitude, currentLoc.longitude,
                step.startLocation.latitude, step.startLocation.longitude
              );
              if (dist < 80) {
                closestStep = s;
                break;
              }
              const distEnd = getDistanceBetween(
                currentLoc.latitude, currentLoc.longitude,
                step.endLocation.latitude, step.endLocation.longitude
              );
              if (distEnd < 50 && s + 1 < navigationSteps.length) {
                closestStep = s + 1;
                break;
              }
            }

            if (closestStep !== currentStepIndex) {
              setCurrentStepIndex(closestStep);
            }

            if (!spokenStepsRef.current.has(closestStep)) {
              const step = navigationSteps[closestStep];
              if (step) {
                const distToStep = getDistanceBetween(
                  currentLoc.latitude, currentLoc.longitude,
                  step.startLocation.latitude, step.startLocation.longitude
                );
                if (distToStep < 150) {
                  spokenStepsRef.current.add(closestStep);
                  speakInstruction(step.instruction);
                }
              }
            }
          }

          if (mapRef.current && idx % 2 === 0 && !userInteractingRef.current) {
            mapRef.current.animateToRegion({
              latitude: currentLoc.latitude,
              longitude: currentLoc.longitude,
              latitudeDelta: 0.0015,
              longitudeDelta: 0.0015,
            }, 600);
          }
        } else {
          setEtaToPickup(0);
          setArrivedAtPickup(true);
          speakInstruction(isBusinessDelivery ? 'İşletme noktasına ulaştınız. Siparişi teslim almadan önce dış detay kaydınızı alın.' : 'Müşteri noktasına ulaştınız. Lütfen aracınızın dış detay fotoğraf ve videosunu çekin.');
          Alert.alert(
            '⚠️ Araç Dış Görünüm Kaydı',
            isBusinessDelivery
              ? 'İşletme adresine ulaştınız.\n\nSiparişi teslim almadan önce aracınızın dış detay fotoğraf ve videosunu çekmeniz önerilir.\n\nBu kayıtlar olası anlaşmazlıklarda sizi koruyacaktır.'
              : 'Müşteri adresine ulaştınız.\n\nYolculuğa başlamadan önce aracınızın dış detay fotoğraf ve videosunu çekmeniz gerekmektedir.\n\nBu kayıtlar olası hasar anlaşmazlıklarında sizi koruyacaktır.',
            [
              {
                text: 'Tamam, Anladım',
                style: 'default',
              },
            ]
          );
          if (trackingRef.current) {
            clearInterval(trackingRef.current);
            trackingRef.current = null;
          }
          console.log('[Ride] Arrived at pickup location - exterior photo/video warning shown');
        }
      }, 800);
      return () => {
        if (trackingRef.current) {
          clearInterval(trackingRef.current);
          trackingRef.current = null;
        }
      };
    }
  }, [rideAccepted, driverSimLoc, arrivedAtPickup, navigationSteps, currentStepIndex, speakInstruction, isBusinessDelivery]);

  useEffect(() => {
    if (customerPickedUp && navigatingToDropoff && driverSimLoc && !arrivedAtDropoff && driverPathRef.current.length > 0) {
      trackingRef.current = setInterval(() => {
        const idx = driverPathIdxRef.current + 1;
        const path = driverPathRef.current;
        if (idx < path.length) {
          driverPathIdxRef.current = idx;
          const currentLoc = path[idx];
          setDriverSimLoc(currentLoc);
          driverMarkerCoord.current = {
            latitude: currentLoc.latitude,
            longitude: currentLoc.longitude,
          };

          const remaining = path.length - idx;
          const etaMin = Math.max(1, Math.ceil(remaining * 0.3));
          setEtaToDropoff(etaMin);

          if (navigationSteps.length > 0) {
            let closestStep = currentStepIndex;
            for (let s = currentStepIndex; s < navigationSteps.length; s++) {
              const step = navigationSteps[s];
              const dist = getDistanceBetween(
                currentLoc.latitude, currentLoc.longitude,
                step.startLocation.latitude, step.startLocation.longitude
              );
              if (dist < 80) {
                closestStep = s;
                break;
              }
              const distEnd = getDistanceBetween(
                currentLoc.latitude, currentLoc.longitude,
                step.endLocation.latitude, step.endLocation.longitude
              );
              if (distEnd < 50 && s + 1 < navigationSteps.length) {
                closestStep = s + 1;
                break;
              }
            }

            if (closestStep !== currentStepIndex) {
              setCurrentStepIndex(closestStep);
            }

            if (!spokenStepsRef.current.has(closestStep)) {
              const step = navigationSteps[closestStep];
              if (step) {
                const distToStep = getDistanceBetween(
                  currentLoc.latitude, currentLoc.longitude,
                  step.startLocation.latitude, step.startLocation.longitude
                );
                if (distToStep < 150) {
                  spokenStepsRef.current.add(closestStep);
                  speakInstruction(step.instruction);
                }
              }
            }
          }

          if (mapRef.current && idx % 2 === 0 && !userInteractingRef.current) {
            mapRef.current.animateToRegion({
              latitude: currentLoc.latitude,
              longitude: currentLoc.longitude,
              latitudeDelta: 0.0015,
              longitudeDelta: 0.0015,
            }, 600);
          }
        } else {
          setArrivedAtDropoff(true);
          setNavigatingToDropoff(false);
          setEtaToDropoff(0);
          speakInstruction('Varış noktasına ulaştınız. Yolculuğu tamamlayabilirsiniz.');
          if (trackingRef.current) {
            clearInterval(trackingRef.current);
            trackingRef.current = null;
          }
          console.log('[Ride] Arrived at dropoff location');
        }
      }, 800);
      return () => {
        if (trackingRef.current) {
          clearInterval(trackingRef.current);
          trackingRef.current = null;
        }
      };
    }
  }, [customerPickedUp, navigatingToDropoff, driverSimLoc, arrivedAtDropoff, navigationSteps, currentStepIndex, speakInstruction]);

  const driverArrivedMutation = trpc.rides.driverArrived.useMutation();

  const handleConfirmArrival = useCallback(() => {
    setConfirmedArrival(true);
    speakInstruction(isBusinessDelivery ? 'İşletme noktasına geldiniz. Siparişi aldığınızda devam edin.' : 'Adrese geldiniz. Müşteriye bildirim gönderildi. Müşteriyi aldığınızda bildirin.');
    const rideId = currentRideId ?? 'current_ride';
    console.log('[Ride] Driver confirmed arrival at pickup - sending notification, rideId:', rideId);
    driverArrivedMutation.mutate(
      { rideId, driverName: driver?.name ?? 'Şoför' },
      {
        onSuccess: () => {
          console.log('[Ride] Driver arrival notification sent to customer successfully');
        },
        onError: (err) => {
          console.log('[Ride] Driver arrival notification error:', err);
        },
      }
    );
  }, [speakInstruction, driver?.name, driverArrivedMutation, currentRideId, isBusinessDelivery]);

  const handlePickupCustomer = useCallback(() => {
    Alert.alert(
      isBusinessDelivery ? 'Siparişi Aldınız mı?' : 'Müşteriyi Aldınız mı?',
      isBusinessDelivery ? 'İşletmeden siparişi teslim aldığınızı onaylıyorsunuz.' : 'Müşteriyi aldığınızı onaylıyorsunuz.',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Evet, Aldım',
          onPress: async () => {
            if (currentRideId) {
              try {
                const result = await startRideMutation.mutateAsync({ rideId: currentRideId });
                if (!result?.success) {
                  const errorMessage = 'error' in result && typeof result.error === 'string'
                    ? result.error
                    : 'Yolculuk şu an başlatılamıyor. Lütfen tekrar deneyin.';
                  Alert.alert('Yolculuk Başlatılamadı', errorMessage);
                  return;
                }
                console.log('[Ride] Ride started on backend:', currentRideId, 'businessDelivery:', isBusinessDelivery);
              } catch (err) {
                console.log('[Ride] Start ride backend error:', err);
                const errorMessage = err instanceof Error ? err.message : 'Yolculuk şu an başlatılamıyor. Lütfen tekrar deneyin.';
                Alert.alert('Yolculuk Başlatılamadı', errorMessage);
                return;
              }
            }
            setCustomerPickedUp(true);
            setNavigatingToDropoff(true);
            setArrivedAtDropoff(false);
            spokenStepsRef.current = new Set();

            if (trackingRef.current) {
              clearInterval(trackingRef.current);
              trackingRef.current = null;
            }

            driverPathRef.current = [];
            driverPathIdxRef.current = 0;
            setRouteCoords([]);
            setNavigationSteps([]);
            setCurrentStepIndex(0);

            const origin = driverSimLoc ?? pickupCoord;
            const path = await fetchDirections(origin, dropoffCoord);

            if (path && path.length > 0) {
              setDriverSimLoc(path[0]);
              driverMarkerCoord.current = {
                latitude: path[0].latitude,
                longitude: path[0].longitude,
              };
              speakInstruction(isBusinessDelivery ? 'Sipariş teslim alındı. Varış noktasına doğru yola çıkılıyor.' : 'Müşteri alındı. Varış noktasına doğru yola çıkılıyor.');
            }
            console.log('[Ride] Customer picked up, navigating to dropoff');
          },
        },
      ]
    );
  }, [speakInstruction, dropoffCoord, driverSimLoc, pickupCoord, fetchDirections, startRideMutation, currentRideId, isBusinessDelivery]);

  const openLocationInMaps = useCallback((lat: number, lng: number, label: string) => {
    const url = Platform.select({
      ios: `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`,
      android: `google.navigation:q=${lat},${lng}&mode=d`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
    }) as string;
    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) {
          void Linking.openURL(url);
        } else {
          void Linking.openURL(webUrl);
        }
      })
      .catch(() => {
        void Linking.openURL(webUrl);
      });
    console.log('[Maps] Opening location:', label, lat, lng);
  }, []);

  const resetRideState = useCallback(() => {
    safeSpeechStop();
    setRideAccepted(false);
    setDriverSimLoc(null);
    setEtaToPickup(0);
    setEtaToDropoff(0);
    setArrivedAtPickup(false);
    setConfirmedArrival(false);
    setCustomerPickedUp(false);
    setNavigatingToDropoff(false);
    setArrivedAtDropoff(false);
    setRouteCoords([]);
    setNavigationSteps([]);
    setCurrentStepIndex(0);
    setTotalDistance('');
    setTotalDuration('');
    driverPathRef.current = [];
    driverPathIdxRef.current = 0;
    spokenStepsRef.current = new Set();
    if (trackingRef.current) {
      clearInterval(trackingRef.current);
      trackingRef.current = null;
    }
  }, [safeSpeechStop]);

  const handleCompleteRide = useCallback(async () => {
    if (currentRideId) {
      try {
        const result = await completeRideMutation.mutateAsync({ rideId: currentRideId });
        if (!result?.success) {
          const errorMessage = 'error' in result && typeof result.error === 'string'
            ? result.error
            : 'Yolculuk şu an tamamlanamıyor. Lütfen tekrar deneyin.';
          Alert.alert('Yolculuk Tamamlanamadı', errorMessage);
          return;
        }
        console.log('[Driver] Ride completed on backend:', currentRideId);
      } catch (err) {
        console.log('[Driver] Complete ride backend error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Yolculuk şu an tamamlanamıyor. Lütfen tekrar deneyin.';
        Alert.alert('Yolculuk Tamamlanamadı', errorMessage);
        return;
      }
    }
    setCurrentRideId(null);
    setCurrentCustomerName('');
    setCurrentRidePrice(0);
    resetRideState();
    void activeRideQuery.refetch();
    void pendingRidesQuery.refetch();
    Alert.alert('Yolculuk Tamamlandı', 'Kazançlarınız güncellendi. İyi yolculuklar!');
  }, [resetRideState, currentRideId, completeRideMutation, activeRideQuery, pendingRidesQuery]);

  const DRIVER_CANCEL_REASONS = [
    { key: 'customer_no_show', label: 'Müşteri gelmedi' },
    { key: 'customer_unreachable', label: 'Müşteriye ulaşamıyorum' },
    { key: 'wrong_address', label: 'Adres yanlış/bulunamıyor' },
    { key: 'vehicle_issue', label: 'Araç arızası' },
    { key: 'emergency', label: 'Acil durum' },
    { key: 'other', label: 'Diğer' },
  ];

  const handleCancelRideDriver = useCallback(() => {
    if (confirmedArrival && !customerPickedUp) {
      setShowDriverCancelReasonModal(true);
      setSelectedDriverCancelReason('');
    } else {
      Alert.alert(
        'Yolculuğu İptal Et',
        'İptal etmek istediğinize emin misiniz?\n\nİptal Politikası:\n• Sık iptal, puanınızı düşürür\n• Günlük 3\'ten fazla iptal hesabınızı geçici olarak askıya alabilir\n\nMüşteriye bildirim gönderilecek ve yeni şoför atanacaktır.',
        [
          { text: 'Vazgeç', style: 'cancel' },
          {
            text: 'İptal Et',
            style: 'destructive',
            onPress: async () => {
              if (currentRideId) {
                try {
                  const result = await cancelRideMutation.mutateAsync({ rideId: currentRideId, cancelledBy: 'driver', cancelReason: 'Şoför iptal etti' });
                  if (!result?.success) {
                    const errorMessage = 'error' in result && typeof result.error === 'string'
                      ? result.error
                      : 'Yolculuk şu an iptal edilemiyor. Lütfen tekrar deneyin.';
                    Alert.alert('İptal Edilemedi', errorMessage);
                    return;
                  }
                  console.log('[Ride] Driver cancelled ride on backend:', currentRideId);
                } catch (err) {
                  console.log('[Ride] Cancel ride backend error:', err);
                  const errorMessage = err instanceof Error ? err.message : 'Yolculuk şu an iptal edilemiyor. Lütfen tekrar deneyin.';
                  Alert.alert('İptal Edilemedi', errorMessage);
                  return;
                }
              }
              setCurrentRideId(null);
              setCurrentCustomerName('');
              setCurrentRidePrice(0);
              resetRideState();
              console.log('[Ride] Driver cancelled ride - customer notified, reassignment triggered');
              Alert.alert(
                'İptal Edildi',
                'Yolculuk iptal edildi. Müşteriye bildirim gönderildi ve yeni şoför atanıyor.',
                [{ text: 'Tamam' }]
              );
            },
          },
        ]
      );
    }
  }, [resetRideState, confirmedArrival, customerPickedUp, cancelRideMutation, currentRideId]);

  const handleConfirmDriverCancelWithReason = useCallback(async (reason: string) => {
    setShowDriverCancelReasonModal(false);
    setSelectedDriverCancelReason('');
    if (currentRideId) {
      try {
        const result = await cancelRideMutation.mutateAsync({ rideId: currentRideId, cancelledBy: 'driver', cancelReason: reason });
        if (!result?.success) {
          const errorMessage = 'error' in result && typeof result.error === 'string'
            ? result.error
            : 'Yolculuk şu an iptal edilemiyor. Lütfen tekrar deneyin.';
          Alert.alert('İptal Edilemedi', errorMessage);
          return;
        }
        console.log('[Ride] Driver cancel with reason on backend:', currentRideId, reason);
      } catch (err) {
        console.log('[Ride] Cancel with reason backend error:', err);
        const errorMessage = err instanceof Error ? err.message : 'Yolculuk şu an iptal edilemiyor. Lütfen tekrar deneyin.';
        Alert.alert('İptal Edilemedi', errorMessage);
        return;
      }
    }
    setCurrentRideId(null);
    setCurrentCustomerName('');
    setCurrentRidePrice(0);
    resetRideState();
    console.log('[Ride] Driver cancelled ride at pickup - reason:', reason);
    Alert.alert(
      'İptal Edildi',
      'Yolculuk iptal edildi. Müşteriye bildirim gönderildi.',
      [{ text: 'Tamam' }]
    );
  }, [resetRideState, currentRideId, cancelRideMutation]);

  useEffect(() => {
    if (rideMessagesQuery.data && rideMessagesQuery.data.length > 0) {
      const mapped = rideMessagesQuery.data.map((m: { id: string; text: string; senderId: string; createdAt: string }) => ({
        id: m.id,
        text: m.text,
        fromMe: m.senderId === driver?.id,
        time: new Date(m.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      }));
      setDriverChatMessages(mapped);
    }
  }, [rideMessagesQuery.data, driver?.id]);

  const handleDriverSendChat = useCallback((text: string) => {
    if (!text.trim()) return;
    const msgText = text.trim();
    const newMsg = {
      id: 'msg_' + Date.now(),
      text: msgText,
      fromMe: true,
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    };
    setDriverChatMessages(prev => [...prev, newMsg]);
    setDriverChatInput('');

    if (currentRideId && driver) {
      sendMessageMutation.mutate(
        {
          rideId: currentRideId,
          senderId: driver.id,
          senderName: driver.name ?? 'Şoför',
          senderType: 'driver',
          text: msgText,
        },
        {
          onSuccess: () => console.log('[Driver Chat] Message sent to backend'),
          onError: (err) => console.log('[Driver Chat] Backend send error:', err),
        }
      );
    }
    console.log('[Driver Chat] Sent:', msgText);
  }, [currentRideId, driver, sendMessageMutation]);

  const currentStep = navigationSteps[currentStepIndex] ?? null;
  const nextStep = navigationSteps[currentStepIndex + 1] ?? null;
  const isActivelyNavigating = (!arrivedAtPickup && !customerPickedUp) || (navigatingToDropoff && !arrivedAtDropoff);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 6) return 'İyi geceler';
    if (hour < 12) return 'Günaydın';
    if (hour < 18) return 'İyi günler';
    return 'İyi akşamlar';
  };

  return (
    <View style={styles.container}>
      {(!mounted || Platform.OS === 'web') ? (
        mounted ? (
          <WebMapFallback
            style={StyleSheet.absoluteFillObject}
            latitude={gpsLocation?.latitude ?? mapRegion.latitude}
            longitude={gpsLocation?.longitude ?? mapRegion.longitude}
            showUserLocation={true}
            zoom={15}
            markers={[
              ...(rideAccepted && !navigatingToDropoff ? [{
                id: 'pickup',
                latitude: pickupCoord.latitude,
                longitude: pickupCoord.longitude,
                title: pickupLocationTitle,
                color: '#2ECC71',
              }] : []),
              ...(rideAccepted && navigatingToDropoff ? [{
                id: 'dropoff',
                latitude: dropoffCoord.latitude,
                longitude: dropoffCoord.longitude,
                title: 'Varış Noktası',
                color: Colors.dark.accent,
              }] : []),
              ...(rideAccepted && driverSimLoc ? [{
                id: 'driver-sim',
                latitude: driverSimLoc.latitude,
                longitude: driverSimLoc.longitude,
                title: 'Siz',
                emoji: '🚗',
              }] : []),
            ] as WebMapMarker[]}
            polylines={[
              ...(rideAccepted && routeCoords.length > 1 ? [{
                id: 'route',
                coordinates: routeCoords.slice(driverPathIdxRef.current),
                color: Colors.dark.primary,
                width: 5,
              }] : []),
            ] as WebMapPolyline[]}
          />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#E5E5E5' }]} />
        )
      ) : (
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={mapRegion}
        showsUserLocation
        showsMyLocationButton={false}
        showsTraffic={rideAccepted}

        onPanDrag={() => {
          userInteractingRef.current = true;
          setMapCentered(false);
        }}
      >
        {!rideAccepted && showHeatMap && heatPoints.map((hp) => (
          <Circle
            key={hp.id}
            center={{ latitude: hp.latitude, longitude: hp.longitude }}
            radius={hp.intensity > 0.7 ? 400 : hp.intensity > 0.5 ? 300 : 200}
            fillColor={
              hp.intensity > 0.8 ? 'rgba(231,76,60,0.25)' :
              hp.intensity > 0.6 ? 'rgba(255,152,0,0.2)' :
              'rgba(255,224,178,0.18)'
            }
            strokeColor={
              hp.intensity > 0.8 ? 'rgba(231,76,60,0.4)' :
              hp.intensity > 0.6 ? 'rgba(255,152,0,0.35)' :
              'rgba(255,224,178,0.3)'
            }
            strokeWidth={1}
          />
        ))}
        {!rideAccepted && (
          <Marker
            coordinate={{ latitude: mapRegion.latitude, longitude: mapRegion.longitude }}
            title="Konumunuz"
          >
            <View style={styles.driverMarker}>
              <Navigation size={16} color="#FFF" />
            </View>
          </Marker>
        )}
        {rideAccepted && !navigatingToDropoff && (
          <Marker coordinate={pickupCoord} title={pickupLocationTitle} anchor={{ x: 0.5, y: 1 }}>
            <View style={styles.pickupMarker}>
              <MapPin size={18} color="#FFF" />
            </View>
          </Marker>
        )}
        {rideAccepted && navigatingToDropoff && (
          <Marker coordinate={dropoffCoord} title="Varış Noktası" anchor={{ x: 0.5, y: 1 }}>
            <View style={styles.dropoffMarker}>
              <MapPin size={18} color="#FFF" />
            </View>
          </Marker>
        )}
        {rideAccepted && driverSimLoc && (
          <Marker
            coordinate={driverSimLoc}
            title="Siz"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.driverTrackMarker}>
              <Car size={16} color="#FFF" />
            </View>
          </Marker>
        )}
        {rideAccepted && routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords.slice(driverPathIdxRef.current)}
            strokeColor={Colors.dark.primary}
            strokeWidth={5}
          />
        )}
      </MapView>
      )}
      {!mapCentered && rideAccepted && (
        <TouchableOpacity
          style={styles.recenterButton}
          onPress={() => {
            userInteractingRef.current = false;
            setMapCentered(true);
            if (mapRef.current && driverSimLoc) {
              mapRef.current.animateToRegion({
                latitude: driverSimLoc.latitude,
                longitude: driverSimLoc.longitude,
                latitudeDelta: 0.0015,
                longitudeDelta: 0.0015,
              }, 600);
            }
          }}
          activeOpacity={0.8}
        >
          <Navigation size={18} color={Colors.dark.primary} />
        </TouchableOpacity>
      )}

      {rideAccepted && isActivelyNavigating && currentStep && (
        <View style={styles.navInstructionBar}>
          <SafeAreaView edges={['top']} style={styles.navInstructionInner}>
            <View style={styles.navTopRow}>
              <View style={styles.navManeuverIcon}>
                {getManeuverIcon(currentStep.maneuver)}
              </View>
              <View style={styles.navTextContainer}>
                <Text style={styles.navInstructionText} numberOfLines={2}>
                  {currentStep.instruction}
                </Text>
                {currentStep.distance ? (
                  <Text style={styles.navDistanceText}>{currentStep.distance}</Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={[styles.voiceToggle, !voiceEnabled && styles.voiceToggleOff]}
                onPress={handleToggleVoice}
                activeOpacity={0.7}
              >
                {voiceEnabled ? (
                  <Volume2 size={20} color={Colors.dark.primary} />
                ) : (
                  <VolumeX size={20} color={Colors.dark.accent} />
                )}
              </TouchableOpacity>
            </View>
            {nextStep ? (
              <View style={styles.navNextStep}>
                <Text style={styles.navNextLabel}>Sonra:</Text>
                <ChevronRight size={12} color={Colors.dark.textMuted} />
                <Text style={styles.navNextText} numberOfLines={1}>{nextStep.instruction}</Text>
              </View>
            ) : null}
          </SafeAreaView>
        </View>
      )}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        {!rideAccepted && (
          <>
            <View style={styles.topBar} pointerEvents="box-none">
              <TouchableOpacity
                style={styles.hamburgerBtn}
                activeOpacity={0.7}
                onPress={() => router.push('/driver-menu' as any)}
                testID="driver-hamburger-menu"
              >
                <Menu size={26} color="#FFF" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
            {driver?.partnerDriverName ? (
              <View style={styles.topBarPartner} pointerEvents="box-none">
                <View style={styles.partnerCard}>
                  <Users size={16} color={Colors.dark.primary} />
                  <Text style={styles.partnerText}>Partner: {driver.partnerDriverName}</Text>
                </View>
              </View>
            ) : null}

            {isApproved && !isOnline ? (
              <View style={styles.offlinePanel}>
                <WifiOff size={32} color="#999" />
                <Text style={styles.offlineTitle}>Meşgulsünüz</Text>
                <Text style={styles.offlineSub}>Yolculuk almak için müsait olun</Text>
              </View>
            ) : null}
            <View style={styles.driverBottomSheet}>
              <View style={styles.driverSheetHandle}>
                <View style={styles.driverSheetHandleBar} />
              </View>

              <View style={styles.driverGreetingRow}>
                <View style={styles.driverGreetingLeft}>
                  <Text style={styles.driverGreetingText}>{getGreeting()}, {driver?.name?.split(' ')[0] ?? 'Şoför'}</Text>
                  <Text style={styles.driverGreetingSubtext}>
                    {driver?.city ?? ''}{driver?.district ? ` / ${driver.district}` : ''}
                  </Text>
                </View>
                <View style={styles.driverStatusToggle}>
                  <View style={[styles.driverStatusDot, isOnline ? styles.driverStatusDotOnline : styles.driverStatusDotOffline]} />
                  <Text style={[styles.driverStatusText, isOnline ? styles.driverStatusTextOnline : styles.driverStatusTextOffline]}>
                    {isOnline ? 'Müsait' : 'Meşgul'}
                  </Text>
                  <Switch
                    value={isOnline}
                    onValueChange={(val) => {
                      setIsOnline(val);
                    }}
                    trackColor={{ false: '#E0E0E0', true: 'rgba(46,204,113,0.3)' }}
                    thumbColor={isOnline ? '#2ECC71' : '#999'}
                    style={styles.driverSwitch}
                  />
                </View>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.driverSheetScroll}
                bounces={false}
              >
                {isOnline ? (
                  <View style={styles.driverOnlineBanner}>
                    <Wifi size={16} color="#2ECC71" />
                    <Text style={styles.driverOnlineBannerText}>Yolculuk talepleri alınıyor</Text>

                  </View>
                ) : null}

                {hasRideRequest ? (
                  <Animated.View style={[styles.inlineRequestPanel, { opacity: requestAnim, transform: [{ scale: requestAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }] }]}>
                    <View style={styles.inlineRequestHeader}>
                      <View style={styles.inlineRequestPulse}>
                        <Navigation size={18} color="#FFF" />
                      </View>
                      <Text style={styles.inlineRequestTitle}>{inlineRequestTitle}</Text>
                    </View>
                    <View style={styles.requestRoute}>
                      <View style={styles.routeDots}>
                        <MapPin size={14} color={Colors.dark.success} />
                        <View style={styles.routeLine} />
                        <MapPin size={14} color={Colors.dark.accent} />
                      </View>
                      <View style={styles.routeAddresses}>
                        <TouchableOpacity onPress={() => openLocationInMaps(pickupCoord.latitude, pickupCoord.longitude, 'Alış Noktası')} activeOpacity={0.6}>
                          <Text style={styles.inlineRouteLabel}>Alış Noktası</Text>
                          <Text style={styles.inlineRouteAddress} numberOfLines={2}>{pickupAddress}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => openLocationInMaps(dropoffCoord.latitude, dropoffCoord.longitude, 'Varış Noktası')} activeOpacity={0.6}>
                          <Text style={styles.inlineRouteLabelRed}>Varış Noktası</Text>
                          <Text style={styles.inlineRouteAddress} numberOfLines={2}>{dropoffAddress}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {currentRideIsFree ? (
                      <View style={styles.freeRideDriverBanner} testID="driver-free-ride-banner">
                        <View style={styles.freeRideDriverBadge}>
                          <Text style={styles.freeRideDriverBadgeText}>ÜCRETSİZ SÜRÜŞ</Text>
                        </View>
                        <Text style={styles.freeRideDriverBannerText}>
                          Bu yolculuk promosyon kapsamında. Ücret müşteriye yansıtılmayacak.
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.inlineFareRow}>
                      <View style={styles.inlineFareItem}>
                        <Banknote size={16} color={currentRideIsFree ? Colors.dark.success : Colors.dark.primary} />
                        <Text style={[styles.inlineFareValue, currentRideIsFree && styles.inlineFareValueFree]}>{currentRidePriceLabel}</Text>
                      </View>
                      <View style={styles.inlineFareDivider} />
                      <View style={styles.inlineFareItem}>
                        <Route size={14} color="#2ECC71" />
                        <Text style={styles.inlineFareSmall}>{currentRideDistanceLabel}</Text>
                      </View>
                      <View style={styles.inlineFareDivider} />
                      <View style={styles.inlineFareItem}>
                        <Clock size={14} color="#3498DB" />
                        <Text style={styles.inlineFareSmall}>{currentRideDurationLabel}</Text>
                      </View>
                    </View>
                    <View style={styles.inlineRequestButtons}>
                      <TouchableOpacity style={styles.inlineDeclineBtn} onPress={handleDeclineRide} activeOpacity={0.7}>
                        <Text style={styles.inlineDeclineBtnText}>Reddet</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.inlineAcceptBtn} onPress={handleAcceptRide} activeOpacity={0.85}>
                        <Text style={styles.inlineAcceptBtnText}>Kabul Et</Text>
                      </TouchableOpacity>
                    </View>
                  </Animated.View>
                ) : null}

                <View style={styles.driverVehicleCard}>
                  <TouchableOpacity
                    style={styles.vehicleShowroomBox}
                    activeOpacity={0.85}
                    onPress={handlePickVehicleImage}
                  >
                    <View style={styles.vehicleShowroomBg}>
                      <View style={styles.mainCarImageWrap}>
                        <Image
                          source={{ uri: vehicleImageUrl }}
                          style={customVehicleImage ? styles.driverVehicleImageCustom : styles.driverVehicleImage}
                          resizeMode="contain"
                        />
                        <View style={styles.vehicleGroundShadow} />
                        {isProcessingVehicle ? (
                          <View style={styles.vehicleProcessingOverlay}>
                            <ActivityIndicator size="small" color="#2ECC71" />
                            <Text style={styles.vehicleProcessingText}>AI arka plan kaldırılıyor...</Text>
                          </View>
                        ) : null}
                        <View style={styles.vehicleImageEditBadge}>
                          <Camera size={12} color="#FFF" />
                        </View>
                        <View style={styles.mainCarPlate}>
                          <View style={styles.driverPlateInner}>
                            <View style={styles.driverPlateBlueBand}>
                              <Text style={styles.driverPlateBlueBandText}>TR</Text>
                            </View>
                            <Text style={styles.driverPlateText}>{driver?.vehiclePlate ?? '34 XX 000'}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                    <View style={styles.vehicleShowroomInfo}>
                      <View style={styles.driverVehicleBrandRow}>
                        <Car size={16} color="#2ECC71" strokeWidth={2.5} />
                        <Text style={styles.driverVehicleBrand}>2GO</Text>
                      </View>
                      <Text style={styles.driverVehicleModelText}>
                        {driver?.vehicleModel ?? 'Araç'}{driver?.vehicleColor ? ` • ${driver.vehicleColor}` : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <View style={styles.driverProfileCardBox}>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={handlePickProfilePhoto}
                      style={styles.profilePhotoTouchable}
                    >
                      {profilePhoto ? (
                        <Image
                          source={{ uri: profilePhoto }}
                          style={styles.profilePhotoImageBox}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.profilePhotoPlaceholderBox}>
                          <User size={36} color="#FFF" />
                        </View>
                      )}
                      <View style={styles.profilePhotoEditBadge}>
                        <Camera size={10} color="#FFF" />
                      </View>
                    </TouchableOpacity>
                    <Text style={styles.profilePhotoLabelBox}>{driver?.name?.split(' ')[0] ?? 'Şoför'}</Text>
                    <Text style={styles.profilePhotoSubLabel}>İkinci Şoför</Text>
                  </View>
                </View>
              </ScrollView>
            </View>
          </>
        )}


        {rideAccepted ? (
          <View style={styles.activeRidePanel}>
            <View style={styles.requestHandle} />

            {isActivelyNavigating && (navigatingToDropoff ? etaToDropoff > 0 : etaToPickup > 0) ? (
              <View style={styles.trackingBanner}>
                <View style={styles.trackingPulse}>
                  <Navigation size={14} color={Colors.dark.primary} />
                </View>
                <View style={styles.trackingContent}>
                  <Text style={styles.trackingLabel}>{navigatingToDropoff ? 'Varış noktasına gidiliyor' : pickupTravellingLabel}</Text>
                  <View style={styles.trackingRow}>
                    <Text style={styles.trackingEta}>~{navigatingToDropoff ? etaToDropoff : etaToPickup} dk</Text>
                    {totalDistance ? (
                      <Text style={styles.trackingDist}> • {totalDistance}</Text>
                    ) : null}
                  </View>
                </View>

              </View>
            ) : null}

            {isActivelyNavigating && !voiceEnabled ? (
              <View style={styles.voiceWarningBanner}>
                <AlertTriangle size={14} color={Colors.dark.warning} />
                <Text style={styles.voiceWarningText}>
                  Sesli navigasyon kapalı - sorumluluk size aittir
                </Text>
              </View>
            ) : null}

            {arrivedAtPickup && !confirmedArrival ? (
              <View style={styles.arrivedBanner}>
                <Text style={styles.arrivedEmoji}>📍</Text>
                <Text style={styles.arrivedText}>{isBusinessDelivery ? 'İşletme noktasına ulaştınız!' : 'Müşteri noktasına ulaştınız!'}</Text>
              </View>
            ) : null}

            {arrivedAtPickup && !confirmedArrival ? (
              <View style={styles.photoWarningBanner}>
                <Camera size={18} color="#FF9500" />
                <View style={styles.photoWarningContent}>
                  <Text style={styles.photoWarningTitle}>Araç Dış Görünüm Kaydı</Text>
                  <Text style={styles.photoWarningText}>Aracınızın dış detay fotoğraf ve videosunu çekin</Text>
                </View>
              </View>
            ) : null}

            {confirmedArrival && !customerPickedUp ? (
              <View style={styles.waitingBanner}>
                <UserCheck size={18} color={Colors.dark.primary} />
                <Text style={styles.waitingText}>{isBusinessDelivery ? 'Sipariş hazırlanıyor olabilir...' : 'Müşteriyi bekliyorsunuz...'}</Text>
              </View>
            ) : null}

            {customerPickedUp && arrivedAtDropoff ? (
              <View style={styles.arrivedBanner}>
                <Text style={styles.arrivedEmoji}>🏁</Text>
                <Text style={styles.arrivedText}>Varış noktasına ulaştınız!</Text>
              </View>
            ) : null}

            <View style={styles.safeDriveBanner} testID="driver-safe-drive-banner">
              <AlertTriangle size={16} color="#C96A00" />
              <Text style={styles.safeDriveBannerText}>{safeDrivingReminder}</Text>
            </View>

            {currentRideIsFree ? (
              <View style={styles.freeRideDriverBanner}>
                <View style={styles.freeRideDriverBadge}>
                  <Text style={styles.freeRideDriverBadgeText}>ÜCRETSİZ SÜRÜŞ</Text>
                </View>
                <Text style={styles.freeRideDriverBannerText}>
                  Bu yolculuk promosyon kapsamında. Müşteriye ücret yansıtılmaz.
                </Text>
              </View>
            ) : null}

            <View style={styles.activeRideHeader}>
              <View style={styles.activeRideAvatar}>
                <Text style={styles.activeRideAvatarText}>{currentCustomerName ? currentCustomerName.split(' ').map((n: string) => n.charAt(0)).join('').substring(0, 2).toUpperCase() : 'M'}</Text>
              </View>
              <View style={styles.activeRideInfo}>
                <Text style={styles.activeRideName}>{currentCustomerName || 'Müşteri'}</Text>
                <Text style={styles.activeRideSub}>
                  {navigatingToDropoff ? (arrivedAtDropoff ? 'Varış noktasına ulaşıldı' : 'Varış noktasına gidiliyor') : (arrivedAtPickup ? pickupWaitingLabel : pickupTravellingLabel)}
                </Text>
              </View>
              <TouchableOpacity style={styles.driverChatButton} onPress={() => {
                setShowDriverChatModal(true);
                console.log('[Driver] Opening chat modal for ride:', currentRideId);
              }}>
                <MessageCircle size={16} color={Colors.dark.primary} />
              </TouchableOpacity>
              {currentCustomerPhone ? (
                <TouchableOpacity style={styles.callButton} onPress={() => {
                  Linking.openURL(`tel:${currentCustomerPhone}`).catch(() => {
                    Alert.alert('Hata', 'Arama başlatılamadı.');
                  });
                }}>
                  <Phone size={16} color={Colors.dark.primary} />
                </TouchableOpacity>
              ) : null}
            </View>

            {isActivelyNavigating && navigationSteps.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.stepsScroll}
                contentContainerStyle={styles.stepsScrollContent}
                scrollEnabled={Platform.OS !== 'web'}
              >
                {navigationSteps.slice(currentStepIndex, currentStepIndex + 4).map((step, i) => {
                  const stepIdx = currentStepIndex + i;
                  const isActive = stepIdx === currentStepIndex;
                  return (
                    <View
                      key={stepIdx}
                      style={[styles.stepChip, isActive && styles.stepChipActive]}
                    >
                      {getManeuverIcon(step.maneuver)}
                      <Text
                        style={[styles.stepChipText, isActive && styles.stepChipTextActive]}
                        numberOfLines={1}
                      >
                        {step.distance || step.instruction.substring(0, 20)}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            ) : null}

            <View style={styles.requestRoute}>
              <View style={styles.routeDots}>
                <MapPin size={14} color={Colors.dark.success} />
                <View style={styles.routeLine} />
                <MapPin size={14} color={Colors.dark.accent} />
              </View>
              <View style={styles.routeAddresses}>
                <TouchableOpacity onPress={() => openLocationInMaps(pickupCoord.latitude, pickupCoord.longitude, 'Alış Noktası')} activeOpacity={0.6}>
                  <Text style={styles.routeLabel}>Alış Noktası</Text>
                  <Text style={styles.routeAddress} numberOfLines={2}>{pickupAddress}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => openLocationInMaps(dropoffCoord.latitude, dropoffCoord.longitude, 'Varış Noktası')} activeOpacity={0.6}>
                  <Text style={styles.routeLabelRed}>Varış Noktası</Text>
                  <Text style={styles.routeAddress} numberOfLines={2}>{dropoffAddress}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {arrivedAtPickup && !confirmedArrival && (
              <TouchableOpacity style={styles.arrivedButton} onPress={handleConfirmArrival} activeOpacity={0.85}>
                <MapPin size={20} color="#FFF" />
                <Text style={styles.arrivedButtonText}>Adrese Geldim</Text>
              </TouchableOpacity>
            )}

            {confirmedArrival && !customerPickedUp && (
              <View style={styles.driverArrivalActions}>
                <TouchableOpacity style={styles.pickupButton} onPress={handlePickupCustomer} activeOpacity={0.85}>
                  <UserCheck size={20} color="#FFF" />
                  <Text style={styles.pickupButtonText}>{pickupActionLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.completeButton, styles.cancelRideButton, { marginTop: 8 }]} onPress={handleCancelRideDriver} activeOpacity={0.85}>
                  <Text style={styles.cancelRideButtonText}>{isBusinessDelivery ? 'Sipariş Hazır Değil - İptal Et' : 'Müşteri Gelmedi - İptal Et'}</Text>
                </TouchableOpacity>
              </View>
            )}

            {customerPickedUp && arrivedAtDropoff && (
              <TouchableOpacity style={styles.completeButton} onPress={handleCompleteRide} activeOpacity={0.85}>
                <Text style={styles.completeButtonText}>Yolculuğu Tamamla</Text>
              </TouchableOpacity>
            )}

            {!arrivedAtPickup && (
              <TouchableOpacity style={[styles.completeButton, styles.cancelRideButton]} onPress={handleCancelRideDriver} activeOpacity={0.85}>
                <Text style={styles.cancelRideButtonText}>Yolculuğu İptal Et</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}
      </SafeAreaView>

      {showDriverCancelReasonModal ? (
        <View style={styles.loadingOverlay}>
          <View style={styles.driverCancelReasonModal}>
            <TouchableOpacity
              style={styles.driverCancelCloseX}
              onPress={() => setShowDriverCancelReasonModal(false)}
              activeOpacity={0.7}
            >
              <X size={22} color="#999" />
            </TouchableOpacity>
            <View style={styles.driverCancelHeader}>
              <View style={styles.driverCancelIconWrap}>
                <AlertTriangle size={28} color="#E74C3C" />
              </View>
              <Text style={styles.driverCancelTitle}>İptal Sebebi</Text>
              <Text style={styles.driverCancelSubtitle}>Lütfen iptal nedeninizi seçin</Text>
            </View>
            <View style={styles.driverCancelReasonList}>
              {DRIVER_CANCEL_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.key}
                  style={[
                    styles.driverCancelReasonItem,
                    selectedDriverCancelReason === reason.key && styles.driverCancelReasonItemSelected,
                  ]}
                  onPress={() => setSelectedDriverCancelReason(reason.key)}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.driverCancelRadio,
                    selectedDriverCancelReason === reason.key && styles.driverCancelRadioSelected,
                  ]}>
                    {selectedDriverCancelReason === reason.key && <View style={styles.driverCancelRadioDot} />}
                  </View>
                  <Text style={[
                    styles.driverCancelLabel,
                    selectedDriverCancelReason === reason.key && styles.driverCancelLabelSelected,
                  ]}>{reason.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[
                styles.driverCancelConfirmBtn,
                !selectedDriverCancelReason && styles.driverCancelConfirmBtnDisabled,
              ]}
              onPress={() => {
                if (selectedDriverCancelReason) {
                  const label = DRIVER_CANCEL_REASONS.find(r => r.key === selectedDriverCancelReason)?.label ?? '';
                  void handleConfirmDriverCancelWithReason(label);
                }
              }}
              disabled={!selectedDriverCancelReason}
              activeOpacity={0.85}
            >
              <Text style={styles.driverCancelConfirmBtnText}>İptal Et</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.driverCancelBackBtn}
              onPress={() => setShowDriverCancelReasonModal(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.driverCancelBackBtnText}>Vazgeç</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {showCourteousWarning ? (
        <View style={styles.loadingOverlay}>
          <View style={styles.courteousWarningBox}>
            <View style={styles.courteousIconRow}>
              <AlertTriangle size={32} color="#FF9500" />
            </View>
            <Text style={styles.courteousTitle}>Güvenli Sürüş Uyarısı</Text>
            <Text style={styles.courteousMessage}>
              {safeDrivingReminder}
            </Text>
            <TouchableOpacity
              style={styles.courteousButton}
              onPress={handleCourteousWarningOk}
              activeOpacity={0.85}
            >
              <Text style={styles.courteousButtonText}>Tamam</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {isFetchingRoute ? (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingBox}>
            <Text style={styles.loadingText}>Rota hesaplanıyor...</Text>
          </View>
        </View>
      ) : null}

      {showDriverChatModal ? (
        <View style={styles.loadingOverlay}>
          <KeyboardAvoidingView
            behavior={keyboardAvoidingBehavior()}
            keyboardVerticalOffset={keyboardVerticalOffset()}
            style={styles.driverChatModalWrap}
          >
            <View style={styles.driverChatModal}>
              <View style={styles.driverChatHeader}>
                <Text style={styles.driverChatTitle}>{currentCustomerName || 'Müşteri'}</Text>
                <TouchableOpacity onPress={() => setShowDriverChatModal(false)} activeOpacity={0.7}>
                  <X size={22} color="#999" />
                </TouchableOpacity>
              </View>
              <FlatList
                data={driverChatMessages}
                keyExtractor={(item) => item.id}
                style={styles.driverChatList}
                contentContainerStyle={styles.driverChatListContent}
                renderItem={({ item }) => (
                  <View style={[styles.driverChatBubble, item.fromMe ? styles.driverChatBubbleMe : styles.driverChatBubbleOther]}>
                    <Text style={[styles.driverChatBubbleText, item.fromMe ? styles.driverChatBubbleTextMe : styles.driverChatBubbleTextOther]}>{item.text}</Text>
                    <Text style={styles.driverChatBubbleTime}>{item.time}</Text>
                  </View>
                )}
                ListEmptyComponent={
                  <View style={styles.driverChatEmpty}>
                    <MessageCircle size={32} color="#CCC" />
                    <Text style={styles.driverChatEmptyText}>Henüz mesaj yok</Text>
                  </View>
                }
              />
              <View style={styles.driverChatQuickRow}>
                {['Yoldayım', 'Geldim', 'Bekliyorum'].map((q) => (
                  <TouchableOpacity
                    key={q}
                    style={styles.driverChatQuickBtn}
                    onPress={() => handleDriverSendChat(q)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.driverChatQuickText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.driverChatInputRow}>
                <TextInput
                  style={styles.driverChatInput}
                  placeholder="Mesaj yazın..."
                  placeholderTextColor="#999"
                  value={driverChatInput}
                  onChangeText={setDriverChatInput}
                  multiline
                  maxLength={500}
                />
                <TouchableOpacity
                  style={[styles.driverChatSendBtn, !driverChatInput.trim() && styles.driverChatSendBtnDisabled]}
                  onPress={() => handleDriverSendChat(driverChatInput.trim())}
                  disabled={!driverChatInput.trim()}
                  activeOpacity={0.7}
                >
                  <Send size={18} color="#FFF" />
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      ) : null}
    </View>
  );
}

const _darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] },
];

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  driverMarker: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: '#FFF',
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  topBar: { paddingHorizontal: 16, paddingTop: 8, gap: 8, flexDirection: 'row' as const, alignItems: 'center' as const },
  topBarPartner: { paddingHorizontal: 16, paddingTop: 4, gap: 8 },
  hamburgerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(10,10,18,0.7)',
    borderWidth: 2,
    borderColor: '#2ECC71',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  driverBottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 16,
    maxHeight: Dimensions.get('window').height * 0.72,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  driverSheetHandle: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  driverSheetHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D0D0D0',
  },
  driverGreetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  driverGreetingLeft: {
    flex: 1,
  },
  driverGreetingText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  driverGreetingSubtext: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  driverStatusToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  driverStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  driverStatusDotOnline: {
    backgroundColor: '#2ECC71',
  },
  driverStatusDotOffline: {
    backgroundColor: '#E74C3C',
  },
  driverStatusText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  driverStatusTextOnline: {
    color: '#2ECC71',
  },
  driverStatusTextOffline: {
    color: '#E74C3C',
  },
  driverSwitch: {
    transform: [{ scale: 0.85 }],
  },
  driverSheetScroll: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  driverOnlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(46,204,113,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 14,
  },
  driverOnlineBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#2ECC71',
  },
  driverLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(231,76,60,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  driverLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E74C3C',
  },
  driverLiveText: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: '#E74C3C',
    letterSpacing: 1,
  },
  driverVehicleCard: {
    flexDirection: 'row' as const,
    borderRadius: 16,
    marginBottom: 14,
    alignItems: 'stretch' as const,
    gap: 10,
    overflow: 'hidden' as const,
  },
  vehicleShowroomBox: {
    flex: 1,
    backgroundColor: 'transparent',
    borderRadius: 16,
    padding: 16,
    justifyContent: 'flex-end' as const,
  },
  vehicleShowroomBg: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingVertical: 4,
  },
  mainCarImageWrap: {
    width: '100%' as unknown as number,
    position: 'relative' as const,
    alignItems: 'center' as const,
  },
  vehicleGroundShadow: {
    width: '70%' as unknown as number,
    height: 18,
    borderRadius: 100,
    marginTop: -10,
    alignSelf: 'center' as const,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 8,
    backgroundColor: Platform.OS === 'web' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.10)',
  },
  mainCarPlate: {
    position: 'absolute' as const,
    bottom: 2,
    alignSelf: 'center' as const,
    left: 0,
    right: 0,
    alignItems: 'center' as const,
  },
  vehicleShowroomInfo: {
    alignItems: 'flex-start' as const,
    paddingTop: 8,
    gap: 4,
  },
  driverProfileCardBox: {
    flex: 1,
    backgroundColor: '#F2F2F2',
    borderRadius: 16,
    padding: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  profilePhotoTouchable: {
    position: 'relative' as const,
  },
  profilePhotoImageBox: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: '#2ECC71',
  },
  profilePhotoPlaceholderBox: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#C0C0C0',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 3,
    borderColor: '#2ECC71',
  },
  profilePhotoEditBadge: {
    position: 'absolute' as const,
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2ECC71',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  profilePhotoLabelBox: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#1A1A2E',
    marginTop: 8,
    textAlign: 'center' as const,
  },
  profilePhotoSubLabel: {
    fontSize: 10,
    fontWeight: '500' as const,
    color: '#999',
    marginTop: 2,
    textAlign: 'center' as const,
  },
  driverVehicleImage: {
    width: '100%' as unknown as number,
    height: 100,
  },
  driverVehicleImageCustom: {
    width: '100%' as unknown as number,
    height: 100,
  },
  vehicleProcessingOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.85)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderRadius: 12,
    zIndex: 10,
    gap: 6,
  },
  vehicleProcessingText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: '#2ECC71',
    textAlign: 'center' as const,
  },
  vehicleImageEditBadge: {
    position: 'absolute' as const,
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#2ECC71',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 2,
    borderColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  driverPlateInner: {
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
  driverPlateBlueBand: {
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
  driverPlateBlueBandText: {
    color: '#fff',
    fontSize: 5,
    fontWeight: '700' as const,
  },
  driverPlateText: {
    fontSize: 7,
    fontWeight: '800' as const,
    color: '#111',
    letterSpacing: 0.5,
  },
  driverVehicleBrandRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 4,
  },
  driverVehicleBrand: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: '#1A1A2E',
    letterSpacing: 1,
  },
  driverVehicleModelText: {
    fontSize: 12,
    color: '#666',
  },
  inlineRequestPanel: {
    backgroundColor: '#F0FAF4',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(46,204,113,0.3)',
  },
  inlineRequestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  inlineRequestPulse: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2ECC71',
    justifyContent: 'center',
    alignItems: 'center',
  },
  inlineRequestTitle: {
    fontSize: 17,
    fontWeight: '800' as const,
    color: '#1A1A2E',
  },
  inlineRouteLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#2ECC71',
    marginBottom: 2,
  },
  inlineRouteLabelRed: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: '#E74C3C',
    marginBottom: 2,
  },
  inlineRouteAddress: {
    fontSize: 13,
    color: '#1A1A2E',
  },
  freeRideDriverBanner: {
    backgroundColor: '#ECFDF3',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.2)',
    gap: 8,
  },
  freeRideDriverBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#16A34A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  freeRideDriverBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: 0.6,
  },
  freeRideDriverBannerText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#166534',
    fontWeight: '600' as const,
  },
  inlineFareRow: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#ECECEC',
  },
  inlineFareItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  inlineFareValue: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.dark.primary,
  },
  inlineFareValueFree: {
    color: '#16A34A',
  },
  inlineFareSmall: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  inlineFareDivider: {
    width: 1,
    backgroundColor: '#E0E0E0',
  },
  inlineRequestButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  inlineDeclineBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E74C3C',
    alignItems: 'center',
    backgroundColor: '#FFF',
  },
  inlineDeclineBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#E74C3C',
  },
  inlineAcceptBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2ECC71',
    alignItems: 'center',
  },
  inlineAcceptBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  partnerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(245,166,35,0.1)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, alignSelf: 'flex-start',
  },
  partnerText: { fontSize: 13, fontWeight: '600' as const, color: Colors.dark.primary },
  offlinePanel: {
    position: 'absolute', top: '35%', left: 0, right: 0,
    alignItems: 'center', gap: 8,
  },
  offlineTitle: { fontSize: 20, fontWeight: '700' as const, color: '#1A1A2E' },
  offlineSub: { fontSize: 14, color: '#888' },
  approvalPendingPanel: {
    position: 'absolute' as const, top: '25%', left: 20, right: 20,
    alignItems: 'center' as const, gap: 10,
    backgroundColor: 'rgba(245,158,11,0.08)', borderRadius: 20,
    paddingHorizontal: 24, paddingVertical: 28,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.2)',
  },
  approvalPendingIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(245,158,11,0.12)', justifyContent: 'center' as const, alignItems: 'center' as const,
    marginBottom: 4,
  },
  approvalPendingTitle: { fontSize: 18, fontWeight: '700' as const, color: '#F59E0B', textAlign: 'center' as const },
  approvalPendingSub: { fontSize: 13, color: '#92400E', textAlign: 'center' as const, lineHeight: 20 },
  requestPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.dark.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 30, alignItems: 'center',
  },
  requestHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#D0D0D0', marginBottom: 16,
  },
  requestTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.dark.primary, marginBottom: 16 },
  requestRoute: { flexDirection: 'row', gap: 12, width: '100%', marginBottom: 16 },
  routeDots: { alignItems: 'center', paddingTop: 4, gap: 4 },
  dotGreen: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.dark.success },
  routeLine: { width: 2, height: 20, backgroundColor: '#D0D0D0' },
  dotRed: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.dark.accent },
  routeAddresses: { flex: 1, justifyContent: 'space-between', gap: 4 },
  routeLabel: { fontSize: 11, fontWeight: '600' as const, color: '#2ECC71', marginBottom: 2 },
  routeLabelRed: { fontSize: 11, fontWeight: '600' as const, color: '#E74C3C', marginBottom: 2 },
  routeAddress: { fontSize: 13, color: '#1A1A2E' },
  fareHighlight: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(245,166,35,0.1)', borderRadius: 14,
    paddingHorizontal: 18, paddingVertical: 14, width: '100%', marginBottom: 10,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)',
  },
  fareHighlightLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fareHighlightLabel: { fontSize: 15, fontWeight: '600' as const, color: Colors.dark.text },
  fareHighlightValue: { fontSize: 24, fontWeight: '800' as const, color: Colors.dark.primary },
  fareSub: {
    fontSize: 11, color: Colors.dark.textMuted, textAlign: 'center',
    marginBottom: 14, marginTop: -4,
  },
  requestInfo: {
    flexDirection: 'row', backgroundColor: Colors.dark.card, borderRadius: 14,
    paddingVertical: 14, width: '100%', marginBottom: 16,
  },
  requestInfoItem: { flex: 1, alignItems: 'center' },
  requestInfoIconRow: { marginBottom: 6 },
  requestInfoLabel: { fontSize: 11, color: Colors.dark.textMuted, marginBottom: 4 },
  requestInfoValue: { fontSize: 15, fontWeight: '700' as const, color: Colors.dark.text },
  requestInfoDivider: { width: 1, backgroundColor: Colors.dark.divider },
  requestButtons: { flexDirection: 'row', gap: 12, width: '100%' },
  declineButton: {
    flex: 1, paddingVertical: 16, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.dark.accent, alignItems: 'center',
  },
  declineButtonText: { fontSize: 16, fontWeight: '600' as const, color: Colors.dark.accent, includeFontPadding: false },
  acceptButton: {
    flex: 2, paddingVertical: 16, borderRadius: 14,
    backgroundColor: Colors.dark.success, alignItems: 'center',
  },
  acceptButtonText: { fontSize: 16, fontWeight: '700' as const, color: '#FFF', includeFontPadding: false },
  activeRidePanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 30, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 12,
  },
  safeDriveBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    width: '100%',
    backgroundColor: '#FFF7ED',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.18)',
  },
  safeDriveBannerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: '#9A3412',
    fontWeight: '700' as const,
  },
  activeRideHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 14, width: '100%', marginBottom: 16,
  },
  activeRideAvatar: {
    width: 48, height: 48, borderRadius: 16,
    backgroundColor: Colors.dark.primary, justifyContent: 'center', alignItems: 'center',
  },
  activeRideAvatarText: { fontSize: 16, fontWeight: '700' as const, color: '#FFF' },
  activeRideInfo: { flex: 1 },
  activeRideName: { fontSize: 17, fontWeight: '700' as const, color: '#1A1A2E', includeFontPadding: false },
  activeRideSub: { fontSize: 13, color: '#888', marginTop: 2, includeFontPadding: false },
  completeButton: {
    backgroundColor: Colors.dark.success, paddingVertical: 18, borderRadius: 16,
    alignItems: 'center', width: '100%', marginTop: 8,
  },
  completeButtonText: { fontSize: 17, fontWeight: '700' as const, color: '#FFF', includeFontPadding: false },
  pickupMarker: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.dark.success, justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: '#FFF',
  },
  dropoffMarker: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.dark.accent, justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: '#FFF',
  },
  driverTrackMarker: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.dark.primary, justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: '#FFF',
    shadowColor: Colors.dark.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 8, elevation: 8,
  },
  trackingBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFF8EE', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
    width: '100%', gap: 12, borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)',
  },
  trackingPulse: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.15)', justifyContent: 'center', alignItems: 'center',
  },
  trackingContent: { flex: 1 },
  trackingLabel: { fontSize: 12, color: '#888', fontWeight: '500' as const },
  trackingRow: { flexDirection: 'row', alignItems: 'center' },
  trackingEta: { fontSize: 15, fontWeight: '700' as const, color: Colors.dark.primary, marginTop: 1 },
  trackingDist: { fontSize: 13, color: '#888', marginTop: 1 },
  trackingLive: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(231,76,60,0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  trackingLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#E74C3C' },
  trackingLiveText: { fontSize: 10, fontWeight: '800' as const, color: '#E74C3C', letterSpacing: 1 },
  arrivedBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#F0FAF4', borderRadius: 14, paddingVertical: 14,
    marginBottom: 14, width: '100%', borderWidth: 1, borderColor: 'rgba(46,204,113,0.25)',
  },
  arrivedEmoji: { fontSize: 18 },
  arrivedText: { fontSize: 15, fontWeight: '700' as const, color: '#2ECC71' },
  photoWarningBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF8EE', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
    width: '100%', borderWidth: 1, borderColor: 'rgba(255,149,0,0.25)',
  },
  photoWarningContent: { flex: 1 },
  photoWarningTitle: { fontSize: 13, fontWeight: '700' as const, color: '#FF9500' },
  photoWarningText: { fontSize: 12, color: '#888', marginTop: 2 },
  waitingBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#FFF8EE', borderRadius: 14, paddingVertical: 14,
    marginBottom: 14, width: '100%', borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)',
  },
  waitingText: { fontSize: 15, fontWeight: '700' as const, color: Colors.dark.primary },
  pickedUpBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#F0FAF4', borderRadius: 14, paddingVertical: 14,
    marginBottom: 14, width: '100%', borderWidth: 1, borderColor: 'rgba(46,204,113,0.25)',
  },
  pickedUpText: { fontSize: 15, fontWeight: '700' as const, color: '#2ECC71' },
  arrivedButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.dark.primary, paddingVertical: 18, borderRadius: 16,
    width: '100%', marginTop: 8,
  },
  arrivedButtonText: { fontSize: 17, fontWeight: '700' as const, color: '#FFF' },
  pickupButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.dark.success, paddingVertical: 18, borderRadius: 16,
    width: '100%', marginTop: 8,
  },
  pickupButtonText: { fontSize: 17, fontWeight: '700' as const, color: '#FFF' },
  cancelRideButton: {
    backgroundColor: '#FFF', borderWidth: 1.5, borderColor: '#E74C3C',
  },
  cancelRideButtonText: { fontSize: 15, fontWeight: '600' as const, color: '#E74C3C' },
  callButton: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: '#FFF8EE', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)',
  },
  navInstructionBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
    backgroundColor: 'rgba(10,10,18,0.95)',
    borderBottomLeftRadius: 20, borderBottomRightRadius: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 12,
  },
  navInstructionInner: {
    paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4,
  },
  navTopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  navManeuverIcon: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: 'rgba(245,166,35,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  navTextContainer: { flex: 1 },
  navInstructionText: {
    fontSize: 15, fontWeight: '700' as const, color: Colors.dark.text, lineHeight: 20,
  },
  navDistanceText: {
    fontSize: 13, fontWeight: '600' as const, color: Colors.dark.primary, marginTop: 2,
  },
  voiceToggle: {
    width: 42, height: 42, borderRadius: 14,
    backgroundColor: 'rgba(245,166,35,0.1)',
    justifyContent: 'center', alignItems: 'center',
  },
  voiceToggleOff: {
    backgroundColor: 'rgba(231,76,60,0.1)',
  },
  navNextStep: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 10, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
  },
  navNextLabel: { fontSize: 11, color: Colors.dark.textMuted, fontWeight: '600' as const },
  navNextText: { fontSize: 12, color: Colors.dark.textSecondary, flex: 1 },
  voiceWarningBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF8EE', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10, width: '100%',
    borderWidth: 1, borderColor: 'rgba(243,156,18,0.2)',
  },
  voiceWarningText: { fontSize: 11, color: '#E67E22', flex: 1, fontWeight: '500' as const },
  stepsScroll: { maxHeight: 44, marginBottom: 12, width: '100%' },
  stepsScrollContent: { gap: 8, paddingRight: 4 },
  stepChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F5F5F5', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: '#ECECEC',
  },
  stepChipActive: {
    backgroundColor: '#FFF8EE',
    borderColor: 'rgba(245,166,35,0.3)',
  },
  stepChipText: { fontSize: 11, color: '#888', fontWeight: '600' as const },
  stepChipTextActive: { color: Colors.dark.primary },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 200,
  },
  loadingBox: {
    backgroundColor: '#FFFFFF', borderRadius: 16,
    paddingHorizontal: 28, paddingVertical: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 12, elevation: 8,
  },
  loadingText: { fontSize: 15, fontWeight: '600' as const, color: '#1A1A2E' },
  courteousWarningBox: {
    backgroundColor: '#FFFFFF', borderRadius: 24,
    paddingHorizontal: 28, paddingVertical: 28, marginHorizontal: 24,
    alignItems: 'center' as const, borderWidth: 1, borderColor: 'rgba(255,149,0,0.2)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15, shadowRadius: 24, elevation: 16,
  },
  courteousIconRow: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#FFF3E0', justifyContent: 'center' as const,
    alignItems: 'center' as const, marginBottom: 18,
  },
  courteousTitle: {
    fontSize: 20, fontWeight: '800' as const, color: '#1A1A2E',
    marginBottom: 12, textAlign: 'center' as const,
  },
  courteousMessage: {
    fontSize: 15, lineHeight: 22, color: '#666',
    textAlign: 'center' as const, marginBottom: 24,
  },
  courteousButton: {
    backgroundColor: '#FF9500', paddingVertical: 16, borderRadius: 14,
    alignItems: 'center' as const, width: '100%' as unknown as number,
  },
  courteousButtonText: { fontSize: 17, fontWeight: '700' as const, color: '#FFF' },
  recenterButton: {
    position: 'absolute' as const,
    top: 100,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(10,10,18,0.9)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.dark.primary,
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  driverArrivalActions: {
    width: '100%' as unknown as number,
  },
  driverCancelReasonModal: {
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
  driverCancelCloseX: {
    position: 'absolute' as const,
    top: 16,
    right: 16,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F2F2F5',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  driverCancelHeader: {
    alignItems: 'center' as const,
    marginBottom: 20,
    marginTop: 8,
  },
  driverCancelIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(231,76,60,0.08)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 12,
  },
  driverCancelTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: '#1A1A2E',
    marginBottom: 4,
  },
  driverCancelSubtitle: {
    fontSize: 14,
    color: '#888',
    fontWeight: '500' as const,
  },
  driverCancelReasonList: {
    width: '100%' as unknown as number,
    gap: 8,
    marginBottom: 20,
  },
  driverCancelReasonItem: {
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
  driverCancelReasonItemSelected: {
    borderColor: '#E74C3C',
    backgroundColor: 'rgba(231,76,60,0.04)',
  },
  driverCancelRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#D0D0D8',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  driverCancelRadioSelected: {
    borderColor: '#E74C3C',
  },
  driverCancelRadioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E74C3C',
  },
  driverCancelLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#444',
    flex: 1,
  },
  driverCancelLabelSelected: {
    color: '#E74C3C',
  },
  driverCancelConfirmBtn: {
    backgroundColor: '#E74C3C',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center' as const,
    width: '100%' as unknown as number,
    marginBottom: 10,
  },
  driverCancelConfirmBtnDisabled: {
    backgroundColor: '#F0D0CC',
  },
  driverCancelConfirmBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  driverCancelBackBtn: {
    paddingVertical: 12,
    alignItems: 'center' as const,
    width: '100%' as unknown as number,
  },
  driverCancelBackBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#888',
  },
  driverChatButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(46,204,113,0.1)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.3)',
  },
  driverChatModalWrap: {
    flex: 1,
    justifyContent: 'flex-end' as const,
  },
  driverChatModal: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: Dimensions.get('window').height * 0.7,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
  },
  driverChatHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  driverChatTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#1A1A2E',
  },
  driverChatList: {
    maxHeight: Dimensions.get('window').height * 0.35,
  },
  driverChatListContent: {
    padding: 16,
    gap: 8,
  },
  driverChatBubble: {
    maxWidth: '80%' as unknown as number,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  driverChatBubbleMe: {
    alignSelf: 'flex-end' as const,
    backgroundColor: Colors.dark.primary,
    borderBottomRightRadius: 4,
  },
  driverChatBubbleOther: {
    alignSelf: 'flex-start' as const,
    backgroundColor: '#F2F2F7',
    borderBottomLeftRadius: 4,
  },
  driverChatBubbleText: {
    fontSize: 15,
    lineHeight: 20,
  },
  driverChatBubbleTextMe: {
    color: '#FFF',
  },
  driverChatBubbleTextOther: {
    color: '#1A1A2E',
  },
  driverChatBubbleTime: {
    fontSize: 10,
    color: 'rgba(150,150,150,0.8)',
    marginTop: 4,
    textAlign: 'right' as const,
  },
  driverChatEmpty: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 40,
    gap: 8,
  },
  driverChatEmptyText: {
    fontSize: 14,
    color: '#999',
  },
  driverChatQuickRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  driverChatQuickBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F2F2F7',
    borderWidth: 1,
    borderColor: '#E8E8ED',
  },
  driverChatQuickText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#555',
  },
  driverChatInputRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    paddingHorizontal: 16,
    gap: 10,
  },
  driverChatInput: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1A1A2E',
    maxHeight: 80,
  },
  driverChatSendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  driverChatSendBtnDisabled: {
    backgroundColor: '#D0D0D0',
  },
});
