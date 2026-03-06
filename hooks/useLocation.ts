import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';

interface LocationCoords {
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  timestamp?: number;
}

interface UseLocationResult {
  location: LocationCoords | null;
  errorMsg: string | null;
  permissionGranted: boolean;
  isLoading: boolean;
  isTracking: boolean;
  lastUpdateTime: number;
  requestPermission: () => Promise<boolean>;
  stopTracking: () => void;
  resumeTracking: () => void;
}

export function useLocation(watchPosition = false, intervalMs = 3000): UseLocationResult {
  const [location, setLocation] = useState<LocationCoords | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);
  const [trackingPaused, setTrackingPaused] = useState<boolean>(false);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const webWatchIdRef = useRef<number | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const stopTracking = useCallback(() => {
    setTrackingPaused(true);
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    if (webWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(webWatchIdRef.current);
      webWatchIdRef.current = null;
    }
    setIsTracking(false);
    console.log('[Location] Tracking stopped by user');
  }, []);

  const resumeTracking = useCallback(() => {
    setTrackingPaused(false);
    console.log('[Location] Tracking resumed by user');
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      if (Platform.OS === 'web') {
        return new Promise<boolean>((resolve) => {
          if (!navigator.geolocation) {
            setErrorMsg('Tarayıcınız konum hizmetlerini desteklemiyor');
            setPermissionGranted(false);
            resolve(false);
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setPermissionGranted(true);
              setLocation({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy ?? undefined,
                heading: pos.coords.heading ?? undefined,
                speed: pos.coords.speed ?? undefined,
                timestamp: pos.timestamp,
              });
              setLastUpdateTime(Date.now());
              setIsLoading(false);
              console.log('[Location] Web permission granted');
              resolve(true);
            },
            (err) => {
              setErrorMsg('Konum izni reddedildi');
              setPermissionGranted(false);
              setIsLoading(false);
              console.log('[Location] Web permission denied:', err.message);
              resolve(false);
            },
            { enableHighAccuracy: true, timeout: 10000 }
          );
        });
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Konum izni reddedildi');
        setPermissionGranted(false);
        setIsLoading(false);
        console.log('[Location] Permission denied');
        return false;
      }

      setPermissionGranted(true);
      console.log('[Location] Permission granted');

      const currentPos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      setLocation({
        latitude: currentPos.coords.latitude,
        longitude: currentPos.coords.longitude,
        accuracy: currentPos.coords.accuracy ?? undefined,
        heading: currentPos.coords.heading ?? undefined,
        speed: currentPos.coords.speed ?? undefined,
        timestamp: currentPos.timestamp,
      });
      setLastUpdateTime(Date.now());
      setIsLoading(false);
      console.log('[Location] Initial position:', currentPos.coords.latitude.toFixed(5), currentPos.coords.longitude.toFixed(5), 'accuracy:', currentPos.coords.accuracy?.toFixed(1));
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Konum alınamadı';
      setErrorMsg(message);
      setIsLoading(false);
      console.log('[Location] Error requesting permission:', message);
      return false;
    }
  }, []);

  useEffect(() => {
    requestPermission();
  }, [requestPermission]);

  useEffect(() => {
    if (!permissionGranted || !watchPosition || trackingPaused) return;

    if (Platform.OS === 'web') {
      if (!navigator.geolocation) return;
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          const now = Date.now();
          setLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? undefined,
            heading: pos.coords.heading ?? undefined,
            speed: pos.coords.speed ?? undefined,
            timestamp: pos.timestamp,
          });
          setLastUpdateTime(now);
          setIsTracking(true);
          console.log('[Location] Web watch update:', pos.coords.latitude.toFixed(5), pos.coords.longitude.toFixed(5));
        },
        (err) => {
          console.log('[Location] Web watch error:', err.message);
        },
        { enableHighAccuracy: true }
      );
      webWatchIdRef.current = id;
      setIsTracking(true);
      return () => {
        navigator.geolocation.clearWatch(id);
        webWatchIdRef.current = null;
        setIsTracking(false);
      };
    }

    let cancelled = false;

    const startWatching = async () => {
      try {
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: intervalMs,
            distanceInterval: 3,
          },
          (loc) => {
            if (cancelled) return;
            const now = Date.now();
            setLocation({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              accuracy: loc.coords.accuracy ?? undefined,
              heading: loc.coords.heading ?? undefined,
              speed: loc.coords.speed ?? undefined,
              timestamp: loc.timestamp,
            });
            setLastUpdateTime(now);
            setIsTracking(true);
            console.log('[Location] Watch update:', loc.coords.latitude.toFixed(5), loc.coords.longitude.toFixed(5), 'acc:', loc.coords.accuracy?.toFixed(1), 'spd:', loc.coords.speed?.toFixed(1));
          }
        );
        if (!cancelled) {
          subscriptionRef.current = sub;
          setIsTracking(true);
        } else {
          sub.remove();
        }
      } catch (err) {
        console.log('[Location] Watch error:', err);
      }
    };

    startWatching();

    return () => {
      cancelled = true;
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
      setIsTracking(false);
    };
  }, [permissionGranted, watchPosition, intervalMs, trackingPaused]);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (appStateRef.current === 'active' && nextState.match(/inactive|background/)) {
        console.log('[Location] App going to background');
      } else if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        console.log('[Location] App returning to foreground');
        if (permissionGranted && watchPosition && !trackingPaused) {
          requestPermission();
        }
      }
      appStateRef.current = nextState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [permissionGranted, watchPosition, trackingPaused, requestPermission]);

  return { location, errorMsg, permissionGranted, isLoading, isTracking, lastUpdateTime, requestPermission, stopTracking, resumeTracking };
}
