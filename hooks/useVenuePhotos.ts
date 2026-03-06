import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import type { NightlifeVenue } from '@/constants/nightlifeVenues';
import { getGoogleMapsApiKey } from '@/utils/maps';

const GOOGLE_API_KEY = getGoogleMapsApiKey();

async function fetchVenuePhotoUrl(venue: NightlifeVenue): Promise<string | null> {
  try {
    const searchQuery = `${venue.name} ${venue.district || ''} ${venue.city} restoran`;
    const query = encodeURIComponent(searchQuery);
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=photos,place_id,formatted_address&key=${GOOGLE_API_KEY}`;

    console.log(`[VenuePhotos] Fetching photo for: ${venue.name}`);
    const response = await fetch(url);
    const data = await response.json();

    if (data.candidates?.[0]?.photos?.[0]?.photo_reference) {
      const photoRef = data.candidates[0].photos[0].photo_reference;
      const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${GOOGLE_API_KEY}`;
      console.log(`[VenuePhotos] Got photo for ${venue.name}`);
      return photoUrl;
    }

    console.log(`[VenuePhotos] No photo found for ${venue.name}`);
    return null;
  } catch (error) {
    console.log(`[VenuePhotos] Error fetching photo for ${venue.name}:`, error);
    return null;
  }
}

export function useVenuePhotos(venues: NightlifeVenue[]): Record<string, string> {
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const fetchedIdsRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef<boolean>(true);

  const fetchPhotos = useCallback(async (venueList: NightlifeVenue[]) => {
    if (Platform.OS === 'web') {
      console.log('[VenuePhotos] Skipping on web (CORS)');
      return;
    }

    const toFetch = venueList.filter(v => !fetchedIdsRef.current.has(v.id));
    if (toFetch.length === 0) return;

    toFetch.forEach(v => fetchedIdsRef.current.add(v.id));

    const batchSize = 3;
    for (let i = 0; i < toFetch.length; i += batchSize) {
      const batch = toFetch.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (venue) => {
          const photoUrl = await fetchVenuePhotoUrl(venue);
          return { id: venue.id, url: photoUrl };
        })
      );

      if (!isMountedRef.current) return;

      const newPhotos: Record<string, string> = {};
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.url) {
          newPhotos[result.value.id] = result.value.url;
        }
      });

      if (Object.keys(newPhotos).length > 0) {
        setPhotos(prev => ({ ...prev, ...newPhotos }));
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (venues.length > 0) {
      fetchPhotos(venues);
    }
    return () => {
      isMountedRef.current = false;
    };
  }, [venues, fetchPhotos]);

  return photos;
}
