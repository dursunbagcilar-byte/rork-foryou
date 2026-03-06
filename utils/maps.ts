import { Platform } from 'react-native';

export function getGoogleMapsApiKey(): string {
  const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (key && key.length > 10 && key !== 'undefined' && key !== 'null') {
    return key;
  }
  console.warn('[Maps] No valid Google Maps API key found via EXPO_PUBLIC_GOOGLE_MAPS_API_KEY');
  return '';
}

export function hasValidApiKey(): boolean {
  return getGoogleMapsApiKey().length > 10;
}

export function getDirectionsApiUrl(): string {
  return 'https://maps.googleapis.com/maps/api/directions/json';
}

export function getGeocodingUrl(lat: number, lng: number): string {
  const key = getGoogleMapsApiKey();
  if (!key) {
    console.warn('[Maps] Cannot create geocoding URL without API key');
    return '';
  }
  return `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=tr&key=${key}`;
}

export function logMapsKeyStatus(): void {
  const key = getGoogleMapsApiKey();
  if (key) {
    console.log('[Maps] API Key status: Valid (' + key.substring(0, 10) + '...)');
  } else {
    console.warn('[Maps] API Key status: MISSING - Maps will not display properly');
    if (Platform.OS === 'web') {
      console.warn('[Maps] Web: Google Maps JS API requires a valid key');
    } else {
      console.warn('[Maps] Native: react-native-maps may show limited functionality');
    }
  }
}
