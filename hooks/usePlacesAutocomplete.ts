import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { getGoogleMapsApiKey } from '@/utils/maps';

const API_KEY = getGoogleMapsApiKey();

const AUTOCOMPLETE_URL_LEGACY = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const DETAILS_URL_LEGACY = 'https://maps.googleapis.com/maps/api/place/details/json';
const AUTOCOMPLETE_URL_NEW = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_URL_NEW = 'https://places.googleapis.com/v1/places';

const PREDICTION_CACHE_TTL = 5 * 60 * 1000;
const DETAILS_CACHE_TTL = 30 * 60 * 1000;
const MAX_CACHE_SIZE = 200;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const predictionsCache = new Map<string, CacheEntry<PlacePrediction[]>>();
const detailsCache = new Map<string, CacheEntry<PlaceDetails>>();

function getCachedPredictions(key: string): PlacePrediction[] | null {
  const entry = predictionsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > PREDICTION_CACHE_TTL) {
    predictionsCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedPredictions(key: string, data: PlacePrediction[]): void {
  if (predictionsCache.size >= MAX_CACHE_SIZE) {
    const firstKey = predictionsCache.keys().next().value;
    if (firstKey) predictionsCache.delete(firstKey);
  }
  predictionsCache.set(key, { data, timestamp: Date.now() });
}

function getCachedDetails(placeId: string): PlaceDetails | null {
  const entry = detailsCache.get(placeId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > DETAILS_CACHE_TTL) {
    detailsCache.delete(placeId);
    return null;
  }
  return entry.data;
}

function setCachedDetails(placeId: string, data: PlaceDetails): void {
  if (detailsCache.size >= MAX_CACHE_SIZE) {
    const firstKey = detailsCache.keys().next().value;
    if (firstKey) detailsCache.delete(firstKey);
  }
  detailsCache.set(placeId, { data, timestamp: Date.now() });
}

export interface PlacePrediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

export interface PlaceDetails {
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  placeId: string;
}

function getGoogleMaps(): any {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return (window as any).google?.maps;
  }
  return null;
}

let webAutocompleteService: any = null;
let webPlacesService: any = null;

function getWebAutocompleteService(): any {
  const gmaps = getGoogleMaps();
  if (!gmaps?.places) return null;
  if (!webAutocompleteService) {
    webAutocompleteService = new gmaps.places.AutocompleteService();
    console.log('[Places] Web AutocompleteService created');
  }
  return webAutocompleteService;
}

function getWebPlacesService(): any {
  const gmaps = getGoogleMaps();
  if (!gmaps?.places) return null;
  if (!webPlacesService) {
    const div = document.createElement('div');
    webPlacesService = new gmaps.places.PlacesService(div);
    console.log('[Places] Web PlacesService created');
  }
  return webPlacesService;
}

async function fetchPredictionsWeb(
  input: string,
  locationBias?: { latitude: number; longitude: number; radius?: number; strict?: boolean }
): Promise<PlacePrediction[]> {
  const service = getWebAutocompleteService();
  if (!service) {
    console.warn('[Places] Web AutocompleteService not available, falling back to REST API...');
    return await fetchPredictionsNew(input, locationBias);
  }
  return new Promise((resolve) => {
    doWebPrediction(service, input, locationBias, resolve);
  });
}

function doWebPrediction(
  service: any,
  input: string,
  locationBias: { latitude: number; longitude: number; radius?: number; strict?: boolean } | undefined,
  resolve: (value: PlacePrediction[]) => void
) {
  const gmaps = getGoogleMaps();
  const request: any = {
    input,
    language: 'tr',
    componentRestrictions: { country: 'tr' },
  };

  if (locationBias && gmaps) {
    request.location = new gmaps.LatLng(locationBias.latitude, locationBias.longitude);
    request.radius = locationBias.radius ?? 50000;
    if (locationBias.strict) {
      request.strictBounds = true;
    }
  }

  console.log('[Places Web] Fetching predictions for:', input);

  service.getPlacePredictions(request, (results: any[], status: string) => {
    console.log('[Places Web] Status:', status, 'Results:', results?.length ?? 0);
    if (status === 'OK' && results) {
      const mapped: PlacePrediction[] = results.map((r: any) => ({
        place_id: r.place_id,
        description: r.description,
        structured_formatting: {
          main_text: r.structured_formatting?.main_text ?? r.description,
          secondary_text: r.structured_formatting?.secondary_text ?? '',
        },
      }));
      resolve(mapped);
    } else {
      resolve([]);
    }
  });
}

async function getPlaceDetailsWeb(placeId: string): Promise<PlaceDetails | null> {
  return new Promise((resolve) => {
    const service = getWebPlacesService();
    if (!service) {
      console.warn('[Places] Web PlacesService not available');
      resolve(null);
      return;
    }

    console.log('[Places Web] Fetching details for:', placeId);

    service.getDetails(
      { placeId, fields: ['name', 'geometry', 'formatted_address'] },
      (place: any, status: string) => {
        console.log('[Places Web] Details status:', status);
        if (status === 'OK' && place?.geometry?.location) {
          resolve({
            name: place.name ?? place.formatted_address ?? '',
            latitude: place.geometry.location.lat(),
            longitude: place.geometry.location.lng(),
            address: place.formatted_address ?? '',
            placeId,
          });
        } else {
          resolve(null);
        }
      }
    );
  });
}

async function fetchPredictionsRest(
  input: string,
  locationBias?: { latitude: number; longitude: number; radius?: number; strict?: boolean }
): Promise<PlacePrediction[]> {
  const legacyResult = await fetchPredictionsLegacy(input, locationBias);
  if (legacyResult.length > 0) {
    return legacyResult;
  }
  console.log('[Places REST] Legacy returned 0 results, trying new API...');
  return await fetchPredictionsNew(input, locationBias);
}

async function fetchPredictionsLegacy(
  input: string,
  locationBias?: { latitude: number; longitude: number; radius?: number; strict?: boolean }
): Promise<PlacePrediction[]> {
  try {
    const params = new URLSearchParams({
      input,
      key: API_KEY,
      language: 'tr',
      components: 'country:tr',
    });

    if (locationBias) {
      params.append('location', `${locationBias.latitude},${locationBias.longitude}`);
      params.append('radius', String(locationBias.radius ?? 50000));
      if (locationBias.strict) {
        params.append('strictbounds', 'true');
      }
    }

    const url = `${AUTOCOMPLETE_URL_LEGACY}?${params.toString()}`;
    console.log('[Places Legacy] Fetching predictions for:', input);

    const response = await fetch(url);

    if (!response.ok) {
      console.warn('[Places Legacy] Response not OK:', response.status);
      return [];
    }

    const data = await response.json();
    console.log('[Places Legacy] Status:', data.status, 'Results:', data.predictions?.length ?? 0);

    if (data.status === 'OK' && data.predictions && data.predictions.length > 0) {
      const mapped: PlacePrediction[] = data.predictions.map((p: any) => ({
        place_id: p.place_id ?? '',
        description: p.description ?? '',
        structured_formatting: {
          main_text: p.structured_formatting?.main_text ?? p.description ?? '',
          secondary_text: p.structured_formatting?.secondary_text ?? '',
        },
      }));
      console.log('[Places Legacy] Got', mapped.length, 'predictions');
      return mapped;
    }

    if (data.status === 'REQUEST_DENIED') {
      console.warn('[Places Legacy] Request denied:', data.error_message);
    } else if (data.status === 'ZERO_RESULTS') {
      console.log('[Places Legacy] Zero results for:', input);
    } else if (data.status !== 'OK') {
      console.warn('[Places Legacy] Unexpected status:', data.status, data.error_message);
    }

    return [];
  } catch (error) {
    console.error('[Places Legacy] Fetch error:', error);
    return [];
  }
}

async function fetchPredictionsNew(
  input: string,
  locationBias?: { latitude: number; longitude: number; radius?: number; strict?: boolean }
): Promise<PlacePrediction[]> {
  try {
    const body: any = {
      input,
      languageCode: 'tr',
      includedRegionCodes: ['tr'],
    };

    if (locationBias) {
      const circleConfig = {
        circle: {
          center: {
            latitude: locationBias.latitude,
            longitude: locationBias.longitude,
          },
          radius: locationBias.radius ?? 50000,
        },
      };
      if (locationBias.strict) {
        body.locationRestriction = circleConfig;
      } else {
        body.locationBias = circleConfig;
      }
    }

    console.log('[Places New] Fetching predictions for:', input);

    const response = await fetch(AUTOCOMPLETE_URL_NEW, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.warn('[Places New] Response not OK:', response.status);
      return [];
    }

    const data = await response.json();
    console.log('[Places New] Response keys:', Object.keys(data));

    if (data.suggestions && data.suggestions.length > 0) {
      const mapped: PlacePrediction[] = data.suggestions
        .filter((s: any) => s.placePrediction)
        .map((s: any) => {
          const p = s.placePrediction;
          return {
            place_id: p.placeId ?? p.place_id ?? '',
            description: p.text?.text ?? '',
            structured_formatting: {
              main_text: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
              secondary_text: p.structuredFormat?.secondaryText?.text ?? '',
            },
          };
        });
      console.log('[Places New] Got', mapped.length, 'predictions');
      return mapped;
    }

    return [];
  } catch (error) {
    console.error('[Places New] Fetch error:', error);
    return [];
  }
}

async function getPlaceDetailsRest(placeId: string): Promise<PlaceDetails | null> {
  const legacyResult = await getPlaceDetailsLegacy(placeId);
  if (legacyResult) {
    return legacyResult;
  }
  console.log('[Places REST] Legacy details failed, trying new API...');
  return await getPlaceDetailsNew(placeId);
}

async function getPlaceDetailsLegacy(placeId: string): Promise<PlaceDetails | null> {
  try {
    const cleanId = placeId.startsWith('places/') ? placeId.replace('places/', '') : placeId;
    const params = new URLSearchParams({
      place_id: cleanId,
      key: API_KEY,
      language: 'tr',
      fields: 'name,geometry,formatted_address',
    });

    const url = `${DETAILS_URL_LEGACY}?${params.toString()}`;
    console.log('[Places Legacy] Fetching details for:', placeId);

    const response = await fetch(url);

    if (!response.ok) {
      console.warn('[Places Legacy] Details response not OK:', response.status);
      return null;
    }

    const data = await response.json();
    console.log('[Places Legacy] Details status:', data.status);

    if (data.status === 'OK' && data.result?.geometry?.location) {
      const details: PlaceDetails = {
        name: data.result.name ?? data.result.formatted_address ?? '',
        latitude: data.result.geometry.location.lat,
        longitude: data.result.geometry.location.lng,
        address: data.result.formatted_address ?? '',
        placeId,
      };
      console.log('[Places Legacy] Got details:', details.name, details.latitude, details.longitude);
      return details;
    }

    if (data.status !== 'OK') {
      console.warn('[Places Legacy] Details error:', data.status, data.error_message);
    }

    return null;
  } catch (error) {
    console.error('[Places Legacy] Details fetch error:', error);
    return null;
  }
}

async function getPlaceDetailsNew(placeId: string): Promise<PlaceDetails | null> {
  try {
    const fields = 'displayName,formattedAddress,location';
    const cleanId = placeId.startsWith('places/') ? placeId.replace('places/', '') : placeId;
    const url = `${DETAILS_URL_NEW}/${cleanId}?languageCode=tr`;

    console.log('[Places New] Fetching details for:', placeId);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': fields,
      },
    });

    if (!response.ok) {
      console.warn('[Places New] Details response not OK:', response.status);
      return null;
    }

    const data = await response.json();

    if (data.location) {
      const details: PlaceDetails = {
        name: data.displayName?.text ?? data.formattedAddress ?? '',
        latitude: data.location.latitude,
        longitude: data.location.longitude,
        address: data.formattedAddress ?? '',
        placeId,
      };
      console.log('[Places New] Got details:', details.name);
      return details;
    }

    return null;
  } catch (error) {
    console.error('[Places New] Details fetch error:', error);
    return null;
  }
}

export function usePlacesAutocomplete(locationBias?: { latitude: number; longitude: number; radius?: number; strict?: boolean }, cityName?: string) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef<string>('');
  const isWeb = Platform.OS === 'web';

  const locationBiasRef = useRef(locationBias);
  locationBiasRef.current = locationBias;

  const cityNameRef = useRef(cityName);
  cityNameRef.current = cityName;

  const DEBOUNCE_MS = useMemo(() => {
    return isWeb ? 400 : 350;
  }, [isWeb]);

  const fetchPredictions = useCallback(async (input: string) => {
    if (!input || input.length < 2) {
      setPredictions([]);
      setIsLoading(false);
      lastQueryRef.current = '';
      return;
    }

    if (input === lastQueryRef.current) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const city = cityNameRef.current;
    const cacheKey = `${input}|${city ?? ''}|${locationBiasRef.current?.latitude ?? ''}|${locationBiasRef.current?.strict ?? ''}`;
    const cached = getCachedPredictions(cacheKey);
    if (cached) {
      console.log('[Places] Cache hit for:', input, 'results:', cached.length);
      setPredictions(cached);
      setIsLoading(false);
      lastQueryRef.current = input;
      return;
    }

    setIsLoading(true);

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const bias = locationBiasRef.current;
        const hasCity = !!city && !!bias;
        console.log('[Places] Search input:', input, 'City:', city, 'HasCityRestriction:', hasCity, 'Platform:', Platform.OS);
        let results: PlacePrediction[] = [];

        if (controller.signal.aborted) return;

        if (hasCity) {
          const strictBias = { ...bias, strict: true };
          const citySearchInput = `${input} ${city}`;
          if (isWeb) {
            results = await fetchPredictionsWeb(citySearchInput, strictBias);
          } else {
            results = await fetchPredictionsRest(citySearchInput, strictBias);
          }
          console.log('[Places] City+name search results:', results.length);

          if (results.length === 0 && !controller.signal.aborted) {
            if (isWeb) {
              results = await fetchPredictionsWeb(input, strictBias);
            } else {
              results = await fetchPredictionsRest(input, strictBias);
            }
            console.log('[Places] Strict bias search results:', results.length);
          }
        } else {
          if (isWeb) {
            results = await fetchPredictionsWeb(input, bias);
          } else {
            results = await fetchPredictionsRest(input, bias);
          }
          console.log('[Places] No city restriction search results:', results.length);
        }

        if (!controller.signal.aborted) {
          console.log('[Places] Final predictions count:', results.length);
          setPredictions(results);
          lastQueryRef.current = input;
          if (results.length > 0) {
            setCachedPredictions(cacheKey, results);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('[Places] Fetch error:', error);
          setPredictions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, DEBOUNCE_MS);
  }, [isWeb, DEBOUNCE_MS]);

  const getPlaceDetails = useCallback(async (placeId: string): Promise<PlaceDetails | null> => {
    const cached = getCachedDetails(placeId);
    if (cached) {
      console.log('[Places] Details cache hit for:', placeId);
      return cached;
    }

    let result: PlaceDetails | null;
    if (isWeb) {
      result = await getPlaceDetailsWeb(placeId);
    } else {
      result = await getPlaceDetailsRest(placeId);
    }

    if (result) {
      setCachedDetails(placeId, result);
    }
    return result;
  }, [isWeb]);

  const clearPredictions = useCallback(() => {
    setPredictions([]);
    lastQueryRef.current = '';
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    predictions,
    isLoading,
    fetchPredictions,
    getPlaceDetails,
    clearPredictions,
  };
}
