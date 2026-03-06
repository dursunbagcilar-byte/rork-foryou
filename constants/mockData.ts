export interface User {
  id: string;
  name: string;
  phone: string;
  email: string;
  type: 'customer' | 'driver';
  gender?: 'male' | 'female';
  avatar?: string;
  city?: string;
  district?: string;
  vehiclePlate?: string;
  referralCode?: string;
  referredBy?: string;
  freeRidesRemaining?: number;
  createdAt?: string;
}

export interface Driver extends User {
  type: 'driver';
  driverCategory?: 'driver' | 'scooter' | 'courier';
  vehiclePlate: string;
  vehicleModel: string;
  vehicleColor: string;
  rating: number;
  totalRides: number;
  isOnline: boolean;
  isSuspended?: boolean;
  isApproved?: boolean;
  approvedAt?: string;
  licenseIssueDate?: string;
  partnerDriverId?: string;
  partnerDriverName?: string;
  dailyEarnings: number;
  weeklyEarnings: number;
  monthlyEarnings: number;
}

export interface Ride {
  id: string;
  customerId: string;
  customerName?: string;
  driverId: string;
  driverName: string;
  driverRating: number;
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  status: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
  price: number;
  distance: string;
  duration: string;
  createdAt: string;
  completedAt?: string;
  cancelledBy?: 'customer' | 'driver';
  cancelReason?: string;
  cancelledAt?: string;
  cancellationFee?: number;
  paymentMethod: 'cash' | 'card';
  paymentStatus?: 'pending' | 'paid' | 'failed';
  isFreeRide: boolean;
  city?: string;
}

export interface HeatPoint {
  id: string;
  latitude: number;
  longitude: number;
  intensity: number;
}

export interface DriverDocuments {
  driverId?: string;
  licenseFront?: string;
  licenseBack?: string;
  idCardFront?: string;
  idCardBack?: string;
  registrationFront?: string;
  registrationBack?: string;
  criminalRecord?: string;
  taxCertificate?: string;
  uploadedAt?: string;
}

export const MOCK_CUSTOMER: User = {
  id: 'c1',
  name: 'Ahmet Yılmaz',
  phone: '+90 532 123 4567',
  email: 'ahmet@email.com',
  type: 'customer',
  city: 'İstanbul',
  district: 'Kadıköy',
};

export const MOCK_DRIVER: Driver = {
  id: 'd1',
  name: 'Mehmet Demir',
  phone: '+90 533 987 6543',
  email: 'mehmet@email.com',
  type: 'driver',
  vehiclePlate: '34 ABC 123',
  vehicleModel: 'Toyota Corolla 2022',
  vehicleColor: 'Beyaz',
  rating: 4.8,
  totalRides: 342,
  isOnline: true,
  partnerDriverId: 'd2',
  partnerDriverName: 'Ali Kaya',
  dailyEarnings: 850,
  weeklyEarnings: 5200,
  monthlyEarnings: 21500,
  city: 'İstanbul',
  district: 'Beşiktaş',
};

export const MOCK_RIDES: Ride[] = [
  {
    id: 'r1',
    customerId: 'c1',
    driverId: 'd1',
    pickupAddress: 'Kadıköy Moda Caddesi',
    dropoffAddress: 'Beşiktaş Barbaros Bulvarı',
    status: 'completed',
    price: 185,
    distance: '12.3 km',
    duration: '25 dk',
    createdAt: '2026-02-14T01:30:00',
    driverName: 'Mehmet D.',
    driverRating: 4.8,
    paymentMethod: 'cash',
    isFreeRide: false,
  },
  {
    id: 'r2',
    customerId: 'c1',
    driverId: 'd2',
    pickupAddress: 'Taksim Meydanı',
    dropoffAddress: 'Şişli Mecidiyeköy',
    status: 'completed',
    price: 95,
    distance: '5.1 km',
    duration: '15 dk',
    createdAt: '2026-02-13T23:45:00',
    driverName: 'Ali K.',
    driverRating: 4.6,
    paymentMethod: 'cash',
    isFreeRide: false,
  },
  {
    id: 'r3',
    customerId: 'c1',
    driverId: 'd1',
    pickupAddress: 'Bebek Sahili',
    dropoffAddress: 'Levent Kanyon AVM',
    status: 'completed',
    price: 120,
    distance: '7.8 km',
    duration: '18 dk',
    createdAt: '2026-02-12T02:15:00',
    driverName: 'Mehmet D.',
    driverRating: 4.8,
    paymentMethod: 'cash',
    isFreeRide: false,
  },
];

export const MOCK_HEAT_POINTS: HeatPoint[] = [
  { id: 'h1', latitude: 41.0082, longitude: 28.9784, intensity: 0.9 },
  { id: 'h2', latitude: 41.0135, longitude: 28.9850, intensity: 0.7 },
  { id: 'h3', latitude: 41.0225, longitude: 28.9744, intensity: 0.8 },
  { id: 'h4', latitude: 41.0310, longitude: 28.9910, intensity: 0.6 },
  { id: 'h5', latitude: 41.0055, longitude: 28.9630, intensity: 0.95 },
  { id: 'h6', latitude: 41.0180, longitude: 28.9520, intensity: 0.5 },
  { id: 'h7', latitude: 41.0400, longitude: 29.0100, intensity: 0.85 },
  { id: 'h8', latitude: 41.0350, longitude: 28.9850, intensity: 0.4 },
  { id: 'h9', latitude: 41.0100, longitude: 29.0200, intensity: 0.75 },
  { id: 'h10', latitude: 41.0450, longitude: 29.0050, intensity: 0.6 },
  { id: 'h11', latitude: 41.0200, longitude: 29.0300, intensity: 0.55 },
  { id: 'h12', latitude: 41.0280, longitude: 28.9600, intensity: 0.7 },
];

export function generateHeatPoints(centerLat: number, centerLng: number): HeatPoint[] {
  const offsets = [
    { dlat: 0, dlng: 0, intensity: 0.9 },
    { dlat: 0.005, dlng: 0.007, intensity: 0.7 },
    { dlat: 0.014, dlng: -0.004, intensity: 0.8 },
    { dlat: 0.023, dlng: 0.013, intensity: 0.6 },
    { dlat: -0.003, dlng: -0.015, intensity: 0.95 },
    { dlat: 0.010, dlng: -0.026, intensity: 0.5 },
    { dlat: 0.032, dlng: 0.032, intensity: 0.85 },
    { dlat: 0.027, dlng: 0.007, intensity: 0.4 },
    { dlat: 0.002, dlng: 0.042, intensity: 0.75 },
    { dlat: 0.037, dlng: 0.027, intensity: 0.6 },
    { dlat: 0.012, dlng: 0.052, intensity: 0.55 },
    { dlat: 0.020, dlng: -0.018, intensity: 0.7 },
  ];
  return offsets.map((o, i) => ({
    id: `dh${i + 1}`,
    latitude: centerLat + o.dlat,
    longitude: centerLng + o.dlng,
    intensity: o.intensity,
  }));
}

export function generatePickupDropoff(centerLat: number, centerLng: number) {
  return {
    pickup: {
      latitude: centerLat + 0.005,
      longitude: centerLng + 0.007,
    },
    dropoff: {
      latitude: centerLat + 0.027,
      longitude: centerLng + 0.025,
    },
  };
}

export const ISTANBUL_REGION = {
  latitude: 41.0082,
  longitude: 28.9784,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

export interface MockDriverInfo {
  id: string;
  name: string;
  shortName: string;
  initials: string;
  phone: string;
  vehicleModel: string;
  vehiclePlate: string;
  vehicleColor: string;
  vehicleType: 'scooter' | 'motorcycle' | 'car';
  rating: number;
  totalRides: number;
}

export const MOCK_DRIVERS_POOL: MockDriverInfo[] = [
  { id: 'md1', name: 'Mehmet Demir', shortName: 'Mehmet D.', initials: 'MD', phone: '+905331234567', vehicleModel: 'Toyota Corolla', vehiclePlate: '34 ABC 123', vehicleColor: 'Beyaz', vehicleType: 'car', rating: 4.8, totalRides: 342 },
  { id: 'md2', name: 'Ali Yıldırım', shortName: 'Ali Y.', initials: 'AY', phone: '+905441234567', vehicleModel: 'Hyundai i20', vehiclePlate: '34 DEF 456', vehicleColor: 'Gri', vehicleType: 'car', rating: 4.6, totalRides: 218 },
  { id: 'md3', name: 'Hasan Kaya', shortName: 'Hasan K.', initials: 'HK', phone: '+905551234567', vehicleModel: 'Renault Clio', vehiclePlate: '34 GHI 789', vehicleColor: 'Siyah', vehicleType: 'car', rating: 4.9, totalRides: 567 },
  { id: 'md4', name: 'Emre Çelik', shortName: 'Emre Ç.', initials: 'EÇ', phone: '+905361234567', vehicleModel: 'Yamaha NMAX', vehiclePlate: '34 JKL 012', vehicleColor: 'Mavi', vehicleType: 'motorcycle', rating: 4.7, totalRides: 189 },
  { id: 'md5', name: 'Burak Şahin', shortName: 'Burak Ş.', initials: 'BŞ', phone: '+905421234567', vehicleModel: 'Honda PCX', vehiclePlate: '34 MNO 345', vehicleColor: 'Kırmızı', vehicleType: 'motorcycle', rating: 4.5, totalRides: 421 },
  { id: 'md6', name: 'Okan Demir', shortName: 'Okan D.', initials: 'OD', phone: '+905381234567', vehicleModel: 'Xiaomi E-Scooter Pro', vehiclePlate: '34 PRS 678', vehicleColor: 'Siyah', vehicleType: 'scooter', rating: 4.8, totalRides: 305 },
  { id: 'md7', name: 'Serkan Aydın', shortName: 'Serkan A.', initials: 'SA', phone: '+905471234567', vehicleModel: 'Opel Astra', vehiclePlate: '34 TUV 901', vehicleColor: 'Gümüş', vehicleType: 'car', rating: 4.4, totalRides: 156 },
  { id: 'md8', name: 'Yusuf Eren', shortName: 'Yusuf E.', initials: 'YE', phone: '+905491234567', vehicleModel: 'Segway E-Scooter', vehiclePlate: '34 XYZ 234', vehicleColor: 'Beyaz', vehicleType: 'scooter', rating: 4.7, totalRides: 278 },
];

export function getRandomDriver(excludeIds: string[] = [], vehicleType?: string): MockDriverInfo | null {
  const available = MOCK_DRIVERS_POOL.filter(d => !excludeIds.includes(d.id));
  if (vehicleType) {
    const typed = available.filter(d => d.vehicleType === vehicleType);
    if (typed.length > 0) {
      return typed[Math.floor(Math.random() * typed.length)];
    }
    return null;
  }
  if (available.length === 0) return MOCK_DRIVERS_POOL[0];
  return available[Math.floor(Math.random() * available.length)];
}

export type VehicleAvailability = {
  vehicleType: string;
  available: boolean;
  driverCount: number;
};

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  scooter: 'E-Scooter',
  motorcycle: 'Motorsiklet',
  car: 'Otomobil',
};

export function getVehicleTypeLabel(type: string): string {
  return VEHICLE_TYPE_LABELS[type] ?? type;
}

export function findBestAlternativeVehicle(requestedType: string, excludeIds: string[] = []): { driver: MockDriverInfo; vehicleType: string } | null {
  const priority: string[] = requestedType === 'scooter'
    ? ['motorcycle', 'car']
    : requestedType === 'motorcycle'
    ? ['car', 'scooter']
    : ['motorcycle', 'scooter'];

  for (const type of priority) {
    const driver = getRandomDriver(excludeIds, type);
    if (driver) {
      return { driver, vehicleType: type };
    }
  }
  return null;
}

export const DRIVER_EARNINGS_HISTORY = [
  { date: '14 Şub', amount: 850 },
  { date: '13 Şub', amount: 720 },
  { date: '12 Şub', amount: 980 },
  { date: '11 Şub', amount: 650 },
  { date: '10 Şub', amount: 1100 },
  { date: '9 Şub', amount: 890 },
  { date: '8 Şub', amount: 760 },
];
