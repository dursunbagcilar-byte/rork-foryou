export type VehicleType = 'scooter' | 'motorcycle' | 'car';

export const PRICING = {
  baseDistanceKm: 10,
  extraPerKm: 50,
  promoCode: '2GO2',
  freeRidesWithPromo: 2,
  vehicleBasePrice: {
    scooter: 500,
    motorcycle: 700,
    car: 800,
  } as Record<VehicleType, number>,
} as const;

export function calculatePrice(distanceKm: number, vehicleType: VehicleType = 'car'): number {
  const basePrice = PRICING.vehicleBasePrice[vehicleType];
  if (distanceKm <= PRICING.baseDistanceKm) {
    return basePrice;
  }
  const extraKm = Math.ceil(distanceKm - PRICING.baseDistanceKm);
  return basePrice + (extraKm * PRICING.extraPerKm);
}

export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export function estimateDuration(distanceKm: number): number {
  return Math.max(Math.round(distanceKm * 2.5), 5);
}

export interface DestinationOption {
  name: string;
  latitude: number;
  longitude: number;
}

export const POPULAR_DESTINATIONS: DestinationOption[] = [
  { name: 'Kadıköy Moda Caddesi', latitude: 40.9862, longitude: 29.0258 },
  { name: 'Taksim Meydanı', latitude: 41.0370, longitude: 28.9850 },
  { name: 'Beşiktaş Çarşı', latitude: 41.0430, longitude: 29.0050 },
  { name: 'Şişli Mecidiyeköy', latitude: 41.0632, longitude: 28.9930 },
  { name: 'Levent Kanyon AVM', latitude: 41.0795, longitude: 29.0110 },
  { name: 'Bakırköy Sahil', latitude: 40.9800, longitude: 28.8720 },
  { name: 'Üsküdar Meydanı', latitude: 41.0252, longitude: 29.0155 },
  { name: 'Ataşehir Bulvar', latitude: 40.9923, longitude: 29.1120 },
];
