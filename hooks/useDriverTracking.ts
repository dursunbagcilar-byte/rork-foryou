import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { trpc } from '@/lib/trpc';

interface DriverLocation {
  latitude: number;
  longitude: number;
  updatedAt: number;
  heading?: number;
  speed?: number;
}

type RidePhase = 'idle' | 'searching' | 'accepted' | 'arriving' | 'in_progress';

interface UseDriverTrackingOptions {
  driverId: string | null;
  enabled: boolean;
  pollingInterval?: number;
  ridePhase?: RidePhase;
}

const PHASE_INTERVALS: Record<RidePhase, number> = {
  idle: 10000,
  searching: 5000,
  accepted: 3000,
  arriving: 2000,
  in_progress: 3000,
};

export function useDriverTracking({ driverId, enabled, pollingInterval, ridePhase = 'idle' }: UseDriverTrackingOptions) {
  const [driverLocation, setDriverLocation] = useState<DriverLocation | null>(null);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'poor' | 'offline'>('good');
  const [isAppActive, setIsAppActive] = useState<boolean>(true);
  const previousLocationRef = useRef<DriverLocation | null>(null);
  const failCountRef = useRef<number>(0);

  const adaptiveInterval = useMemo(() => {
    if (pollingInterval) return pollingInterval;
    return PHASE_INTERVALS[ridePhase] ?? 5000;
  }, [pollingInterval, ridePhase]);

  useEffect(() => {
    const handleAppState = (state: AppStateStatus) => {
      setIsAppActive(state === 'active');
      console.log('[DriverTracking] App state:', state, 'tracking paused:', state !== 'active');
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, []);

  const locationQuery = trpc.drivers.getLocation.useQuery(
    { driverId: driverId ?? '' },
    {
      enabled: enabled && !!driverId && isAppActive,
      refetchInterval: isAppActive ? adaptiveInterval : false,
      refetchIntervalInBackground: false,
      retry: 2,
      retryDelay: 1000,
      staleTime: adaptiveInterval * 0.8,
    }
  );

  useEffect(() => {
    if (locationQuery.data && enabled) {
      const loc = locationQuery.data;
      const newLocation: DriverLocation = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        updatedAt: loc.updatedAt,
      };

      failCountRef.current = 0;
      setConnectionQuality('good');

      const prev = previousLocationRef.current;
      const hasChanged = !prev ||
        Math.abs(prev.latitude - newLocation.latitude) > 0.00001 ||
        Math.abs(prev.longitude - newLocation.longitude) > 0.00001;

      if (hasChanged) {
        setDriverLocation(newLocation);
        previousLocationRef.current = newLocation;
        setLastUpdate(Date.now());
        setIsTracking(true);
        console.log('[DriverTracking] Location updated:', newLocation.latitude.toFixed(5), newLocation.longitude.toFixed(5));
      }
    } else if (locationQuery.isError && enabled) {
      failCountRef.current += 1;
      if (failCountRef.current >= 3) {
        setConnectionQuality('poor');
      }
      if (failCountRef.current >= 6) {
        setConnectionQuality('offline');
      }
      console.log('[DriverTracking] Query failed, failCount:', failCountRef.current);
    }
  }, [locationQuery.data, locationQuery.isError, enabled]);

  useEffect(() => {
    if (!enabled) {
      setIsTracking(false);
      setDriverLocation(null);
      previousLocationRef.current = null;
    }
  }, [enabled]);

  const getDistanceToDriver = useCallback((
    customerLat: number,
    customerLng: number
  ): number | null => {
    if (!driverLocation) return null;

    const R = 6371;
    const dLat = (driverLocation.latitude - customerLat) * Math.PI / 180;
    const dLon = (driverLocation.longitude - customerLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(customerLat * Math.PI / 180) * Math.cos(driverLocation.latitude * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }, [driverLocation]);

  const getEstimatedEta = useCallback((
    customerLat: number,
    customerLng: number,
    averageSpeedKmh: number = 30
  ): number | null => {
    const distance = getDistanceToDriver(customerLat, customerLng);
    if (distance === null) return null;
    return Math.max(1, Math.ceil((distance / averageSpeedKmh) * 60));
  }, [getDistanceToDriver]);

  const isLocationStale = useCallback((): boolean => {
    if (!driverLocation) return true;
    const staleThreshold = 30000;
    return (Date.now() - driverLocation.updatedAt) > staleThreshold;
  }, [driverLocation]);

  return {
    driverLocation,
    isTracking,
    lastUpdate,
    connectionQuality,
    isLoading: locationQuery.isLoading,
    isLocationStale,
    getDistanceToDriver,
    getEstimatedEta,
  };
}
