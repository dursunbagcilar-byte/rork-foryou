import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { View, StyleSheet, Text, Platform, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/colors';
import { getGoogleMapsApiKey } from '@/utils/maps';

export interface WebMapMarker {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  color?: string;
  label?: string;
  emoji?: string;
}

export interface WebMapPolyline {
  id: string;
  coordinates: { latitude: number; longitude: number }[];
  color?: string;
  width?: number;
}

interface WebMapFallbackProps {
  latitude?: number;
  longitude?: number;
  style?: any;
  children?: React.ReactNode;
  markers?: WebMapMarker[];
  polylines?: WebMapPolyline[];
  showUserLocation?: boolean;
  zoom?: number;
  onRegionChange?: (lat: number, lng: number) => void;
  interactive?: boolean;
  darkMode?: boolean;
}

const DARK_MAP_STYLE = [
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

let googleMapsLoaded = false;
let googleMapsLoading = false;
const loadCallbacks: ((success: boolean) => void)[] = [];
const GOOGLE_MAPS_SCRIPT_SELECTOR = 'script[data-rork-google-maps="true"], script[src*="maps.googleapis.com/maps/api/js"]';

function resetGlobalState() {
  googleMapsLoaded = false;
  googleMapsLoading = false;
  loadCallbacks.length = 0;
}

function flushLoadCallbacks(success: boolean): void {
  const pendingCallbacks = [...loadCallbacks];
  loadCallbacks.length = 0;
  pendingCallbacks.forEach((callback) => callback(success));
}

function resolveGoogleMapsLoad(success: boolean): void {
  const isReady = success && !!(window as any).google?.maps;
  googleMapsLoaded = isReady;
  googleMapsLoading = false;
  flushLoadCallbacks(isReady);
}

function waitForGoogleMapsReady(timeoutMs: number = 20000): void {
  const startTime = Date.now();

  const checkReady = () => {
    if ((window as any).google?.maps) {
      console.log('[WebMap] Google Maps JS API loaded successfully');
      resolveGoogleMapsLoad(true);
      return;
    }

    if (Date.now() - startTime >= timeoutMs) {
      console.error('[WebMap] Script load timeout after 20s');
      resolveGoogleMapsLoad(false);
      return;
    }

    setTimeout(checkReady, 100);
  };

  checkReady();
}

function loadGoogleMapsScript(apiKey: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (googleMapsLoaded && (window as any).google?.maps) {
      console.log('[WebMap] Google Maps already available');
      resolve(true);
      return;
    }

    if ((window as any).google?.maps) {
      googleMapsLoaded = true;
      googleMapsLoading = false;
      console.log('[WebMap] Google Maps found on window');
      resolve(true);
      return;
    }

    loadCallbacks.push(resolve);

    if (googleMapsLoading) {
      console.log('[WebMap] Script already loading, waiting...');
      return;
    }

    googleMapsLoading = true;
    const existingScript = document.querySelector(GOOGLE_MAPS_SCRIPT_SELECTOR) as HTMLScriptElement | null;

    if (existingScript) {
      console.log('[WebMap] Reusing existing Google Maps script');
      waitForGoogleMapsReady();
      return;
    }

    console.log('[WebMap] Loading Google Maps script with key:', apiKey.substring(0, 10) + '...');

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.setAttribute('data-rork-google-maps', 'true');

    script.onload = () => {
      waitForGoogleMapsReady();
    };

    script.onerror = (e) => {
      console.error('[WebMap] Failed to load Google Maps JS API', e);
      resolveGoogleMapsLoad(false);
    };

    document.head.appendChild(script);
  });
}

let instanceCounter = 0;

export default function WebMapFallback({
  latitude,
  longitude,
  style,
  children,
  markers = [],
  polylines = [],
  showUserLocation = true,
  zoom = 15,
  onRegionChange,
  interactive = true,
  darkMode = false,
}: WebMapFallbackProps) {
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const polylinesRef = useRef<any[]>([]);
  const userMarkerRef = useRef<any>(null);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [retryKey, setRetryKey] = useState<number>(0);
  const initDoneRef = useRef<boolean>(false);
  const retryCountRef = useRef<number>(0);
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRetryCountRef = useRef<number>(0);
  const onRegionChangeRef = useRef(onRegionChange);
  onRegionChangeRef.current = onRegionChange;

  const mapId = useMemo(() => {
    instanceCounter += 1;
    return `webmap-${instanceCounter}-${Date.now()}-${retryKey}`;
  }, [retryKey]);

  const centerLat = latitude ?? 41.0082;
  const centerLng = longitude ?? 28.9784;

  const scheduleAutoRetry = useCallback(() => {
    if (autoRetryCountRef.current >= 10) {
      console.log('[WebMap] Max auto-retries reached, will keep showing loading');
      return;
    }
    const delay = Math.min(2000 * Math.pow(1.5, autoRetryCountRef.current), 15000);
    autoRetryCountRef.current += 1;
    console.log(`[WebMap] Auto-retry #${autoRetryCountRef.current} in ${Math.round(delay)}ms`);
    autoRetryTimerRef.current = setTimeout(() => {
      resetGlobalState();
      initDoneRef.current = false;
      retryCountRef.current = 0;
      mapInstanceRef.current = null;
      setIsLoaded(false);
      setRetryKey((k) => k + 1);
    }, delay);
  }, []);

  const initMap = useCallback(() => {
    if (Platform.OS !== 'web') return;
    if (initDoneRef.current && mapInstanceRef.current) return;

    const google = (window as any).google;
    if (!google?.maps) {
      console.error('[WebMap] Google Maps not available on window, auto-retrying...');
      scheduleAutoRetry();
      return;
    }

    const mapDiv = document.getElementById(mapId);
    if (!mapDiv) {
      if (retryCountRef.current < 30) {
        retryCountRef.current += 1;
        console.log(`[WebMap] DOM not ready, retry ${retryCountRef.current}/30 for ${mapId}`);
        setTimeout(() => initMap(), 250);
        return;
      }
      console.error('[WebMap] Could not find DOM node after retries, auto-retrying...');
      scheduleAutoRetry();
      return;
    }

    try {
      const mapOptions: any = {
        center: { lat: centerLat, lng: centerLng },
        zoom: zoom,
        disableDefaultUI: true,
        zoomControl: interactive,
        gestureHandling: interactive ? 'greedy' : 'none',
        backgroundColor: '#0A0A12',
      };

      const map = new google.maps.Map(mapDiv, mapOptions);

      if (darkMode) {
        try {
          map.setOptions({ styles: DARK_MAP_STYLE });
        } catch (styleErr) {
          console.warn('[WebMap] Failed to apply dark styles, using default:', styleErr);
        }
      }
      mapInstanceRef.current = map;
      initDoneRef.current = true;
      setIsLoaded(true);
      autoRetryCountRef.current = 0;
      console.log('[WebMap] Map initialized at', centerLat.toFixed(4), centerLng.toFixed(4), 'id:', mapId);

      map.addListener('center_changed', () => {
        const center = map.getCenter();
        if (center && onRegionChangeRef.current) {
          onRegionChangeRef.current(center.lat(), center.lng());
        }
      });
    } catch (err) {
      console.error('[WebMap] Map init error:', err);
      scheduleAutoRetry();
    }
  }, [mapId, centerLat, centerLng, zoom, interactive, darkMode, scheduleAutoRetry]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    initDoneRef.current = false;
    retryCountRef.current = 0;
    mapInstanceRef.current = null;
    setIsLoaded(false);

    const apiKey = getGoogleMapsApiKey();
    console.log('[WebMap] API key check:', apiKey ? 'Key found (' + apiKey.substring(0, 8) + '...)' : 'No key');

    if (!apiKey) {
      console.error('[WebMap] No Google Maps API key found');
      return;
    }

    if ((window as any).google?.maps) {
      console.log('[WebMap] Google Maps already on window, init directly');
      googleMapsLoaded = true;
      googleMapsLoading = false;
      setTimeout(() => initMap(), 100);
      return;
    }

    void loadGoogleMapsScript(apiKey).then((success) => {
      if (success) {
        console.log('[WebMap] Script loaded, scheduling initMap');
        setTimeout(() => initMap(), 200);
      } else {
        console.error('[WebMap] Script load failed, auto-retrying...');
        scheduleAutoRetry();
      }
    });
  }, [initMap, retryKey, scheduleAutoRetry]);

  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded) return;
    const map = mapInstanceRef.current;
    try {
      const currentCenter = map.getCenter();
      if (currentCenter) {
        const dist = Math.abs(currentCenter.lat() - centerLat) + Math.abs(currentCenter.lng() - centerLng);
        if (dist > 0.0005) {
          map.panTo({ lat: centerLat, lng: centerLng });
        }
      }
    } catch (e) {
      console.log('[WebMap] Pan error:', e);
    }
  }, [centerLat, centerLng, isLoaded]);

  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded) return;
    const google = (window as any).google;
    if (!google?.maps) return;
    const map = mapInstanceRef.current;

    markersRef.current.forEach((m) => { try { m.setMap(null); } catch {} });
    markersRef.current = [];

    markers.forEach((m) => {
      const markerOptions: any = {
        position: { lat: m.latitude, lng: m.longitude },
        map: map,
        title: m.title ?? '',
      };

      if (m.emoji) {
        markerOptions.label = {
          text: m.emoji,
          fontSize: '20px',
        };
        markerOptions.icon = {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 0,
        };
      } else if (m.color) {
        markerOptions.icon = {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: m.color,
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
        };
      }

      try {
        const gMarker = new google.maps.Marker(markerOptions);
        markersRef.current.push(gMarker);
      } catch {}
    });
  }, [markers, isLoaded]);

  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded) return;
    const google = (window as any).google;
    if (!google?.maps) return;
    const map = mapInstanceRef.current;

    polylinesRef.current.forEach((p) => { try { p.setMap(null); } catch {} });
    polylinesRef.current = [];

    polylines.forEach((pl) => {
      if (pl.coordinates.length < 2) return;
      const path = pl.coordinates.map((c) => ({ lat: c.latitude, lng: c.longitude }));
      try {
        const gPolyline = new google.maps.Polyline({
          path,
          strokeColor: pl.color ?? '#4A90E2',
          strokeWeight: pl.width ?? 4,
          strokeOpacity: 0.9,
          map: map,
        });
        polylinesRef.current.push(gPolyline);
      } catch {}
    });
  }, [polylines, isLoaded]);

  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded || !showUserLocation) return;
    const google = (window as any).google;
    if (!google?.maps) return;
    const map = mapInstanceRef.current;

    try {
      if (userMarkerRef.current) {
        userMarkerRef.current.setPosition({ lat: centerLat, lng: centerLng });
        return;
      }

      userMarkerRef.current = new google.maps.Marker({
        position: { lat: centerLat, lng: centerLng },
        map: map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#4285F4',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 3,
        },
        title: 'Konumunuz',
        zIndex: 999,
      });
    } catch {}
  }, [centerLat, centerLng, showUserLocation, isLoaded]);

  useEffect(() => {
    return () => {
      const google = Platform.OS === 'web' ? (window as any).google : null;
      if (google?.maps?.event && mapInstanceRef.current) {
        try {
          google.maps.event.clearInstanceListeners(mapInstanceRef.current);
        } catch {}
      }
      markersRef.current.forEach((m) => { try { m.setMap(null); } catch {} });
      polylinesRef.current.forEach((p) => { try { p.setMap(null); } catch {} });
      if (userMarkerRef.current) { try { userMarkerRef.current.setMap(null); } catch {} }
      if (autoRetryTimerRef.current) { clearTimeout(autoRetryTimerRef.current); }
      markersRef.current = [];
      polylinesRef.current = [];
      userMarkerRef.current = null;
      mapInstanceRef.current = null;
      initDoneRef.current = false;
    };
  }, []);

  const mapContainerRef = useRef<View>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = mapContainerRef.current as any;
    if (!node) return;

    const domNode = node instanceof HTMLElement ? node : (node as any)?.getNode?.() ?? null;
    if (!domNode) return;

    const mapDiv = document.createElement('div');
    mapDiv.id = mapId;
    mapDiv.style.width = '100%';
    mapDiv.style.height = '100%';
    mapDiv.style.position = 'absolute';
    mapDiv.style.top = '0';
    mapDiv.style.left = '0';
    domNode.appendChild(mapDiv);

    return () => {
      try {
        if (mapDiv && mapDiv.parentNode) {
          mapDiv.parentNode.removeChild(mapDiv);
        }
      } catch (e) {
        console.log('[WebMap] Cleanup error (safe):', e);
        try {
          mapDiv.remove();
        } catch {}
      }
    };
  }, [mapId]);

  if (Platform.OS !== 'web') {
    return (
      <View style={[styles.container, style]}>
        <Text style={styles.fallbackText}>Harita sadece mobilde</Text>
      </View>
    );
  }

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return (
      <View style={[styles.container, style]}>
        <View style={styles.noKeyOverlay}>
          <Text style={styles.noKeyEmoji}>🗺️</Text>
          <Text style={styles.noKeyTitle}>Harita Kullanılamıyor</Text>
          <Text style={styles.noKeyMessage}>
            Google Maps API anahtarı yapılandırılmamış. Haritayı görmek için geçerli bir API anahtarı gereklidir.
          </Text>
        </View>
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <View
        ref={mapContainerRef}
        style={styles.mapView}
      />
      <View style={[styles.loadingOverlay, { display: isLoaded ? 'none' : 'flex' }]}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
        <Text style={styles.loadingText}>Harita yükleniyor...</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0A0A12',
    overflow: 'hidden' as const,
  },
  mapView: {
    flex: 1,
    width: '100%',
    height: '100%',
  } as any,
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A0A12',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },

  fallbackText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    textAlign: 'center' as const,
    marginTop: 20,
  },
  noKeyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A0A12',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 32,
    gap: 8,
  },
  noKeyEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  noKeyTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.dark.text,
    textAlign: 'center' as const,
  },
  noKeyMessage: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 19,
  },
});
