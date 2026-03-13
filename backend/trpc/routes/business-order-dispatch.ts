import { db } from '../../db/store';
import type { Ride } from '../../db/types';

export const MAX_BUSINESS_COURIER_DISTANCE_KM = 10;
export const BUSINESS_COURIER_RESPONSE_WINDOW_MS = 60 * 1000;

export type BusinessRide = Ride & {
  assignedCourierId?: string;
  courierRequestExpiresAt?: string;
  courierDispatchedAt?: string;
  courierAttemptedDriverIds?: string[];
  courierRejectedDriverIds?: string[];
  maxCourierDistanceKm?: number;
};

interface CourierCandidate {
  driverId: string;
  driverName: string;
  distanceKm: number;
  rating: number;
}

interface DispatchOptions {
  skippedCourierId?: string;
  trigger?: 'created' | 'timeout' | 'declined' | 'courier_available' | 'expired_refresh';
}

interface DispatchResult {
  assigned: boolean;
  courierId?: string;
  distanceKm?: number;
  reason: 'assigned' | 'no_courier_within_range' | 'ride_not_pending' | 'not_business_order';
  attemptedCount: number;
}

export async function sendPushToUser(userId: string, title: string, body: string, data?: Record<string, string>): Promise<void> {
  const tokenData = db.pushTokens.get(userId);
  if (!tokenData) {
    console.log('[RIDES-PUSH] No push token for user:', userId);
    return;
  }

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: tokenData.token,
        sound: 'default',
        title,
        body,
        data: data ?? {},
        priority: 'high',
        channelId: 'rides',
      }),
    });
    const result = await response.json();
    console.log('[RIDES-PUSH] Sent to', userId, ':', JSON.stringify(result));
  } catch (err) {
    console.log('[RIDES-PUSH] Error sending to', userId, ':', err);
  }
}

export function createRideNotification(userId: string, title: string, body: string, data?: Record<string, string>): void {
  const notificationId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.notifications.set(notificationId, {
    id: notificationId,
    userId,
    title,
    body,
    data,
    read: false,
    createdAt: new Date().toISOString(),
  });
}

export function isBusinessRide(ride: Ride | null | undefined): ride is BusinessRide {
  return !!ride && (ride.orderType === 'business_delivery' || ride.orderType === 'custom_delivery');
}

function hasActiveRideForCourier(driverId: string): boolean {
  return !!db.rides.getActiveByDriver(driverId);
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getPickupLocation(ride: BusinessRide): { latitude: number; longitude: number } | null {
  if (typeof ride.pickupLat !== 'number' || typeof ride.pickupLng !== 'number') {
    return null;
  }

  return {
    latitude: ride.pickupLat,
    longitude: ride.pickupLng,
  };
}

function getEligibleCourierCandidates(ride: BusinessRide): CourierCandidate[] {
  const pickupLocation = getPickupLocation(ride);
  if (!pickupLocation) {
    console.log('[RIDES] Business order has no pickup coordinates, cannot calculate nearest courier:', ride.id);
    return [];
  }

  const attemptedCourierIds = new Set(ride.courierAttemptedDriverIds ?? []);
  const rejectedCourierIds = new Set(ride.courierRejectedDriverIds ?? []);

  return db.drivers.getOnlineCouriersByCity(ride.city)
    .filter((courier) => courier.isApproved !== false)
    .filter((courier) => !courier.isSuspended)
    .filter((courier) => !hasActiveRideForCourier(courier.id))
    .filter((courier) => !attemptedCourierIds.has(courier.id))
    .filter((courier) => !rejectedCourierIds.has(courier.id))
    .map((courier) => {
      const location = db.driverLocations.get(courier.id);
      if (!location) {
        return null;
      }

      const distanceKm = haversineDistance(
        pickupLocation.latitude,
        pickupLocation.longitude,
        location.latitude,
        location.longitude,
      );

      if (distanceKm > MAX_BUSINESS_COURIER_DISTANCE_KM) {
        return null;
      }

      return {
        driverId: courier.id,
        driverName: courier.name,
        distanceKm,
        rating: courier.rating,
      };
    })
    .filter((candidate): candidate is CourierCandidate => candidate !== null)
    .sort((a, b) => {
      if (a.distanceKm !== b.distanceKm) {
        return a.distanceKm - b.distanceKm;
      }
      return b.rating - a.rating;
    });
}

async function assignBusinessOrderToCourier(ride: BusinessRide, candidate: CourierCandidate, attemptedCourierIds: string[]): Promise<void> {
  const expiresAt = new Date(Date.now() + BUSINESS_COURIER_RESPONSE_WINDOW_MS).toISOString();
  const updatedRide: BusinessRide = {
    ...ride,
    assignedCourierId: candidate.driverId,
    courierRequestExpiresAt: expiresAt,
    courierDispatchedAt: new Date().toISOString(),
    courierAttemptedDriverIds: attemptedCourierIds,
    maxCourierDistanceKm: MAX_BUSINESS_COURIER_DISTANCE_KM,
  };

  await db.rides.setSync(ride.id, updatedRide);
  console.log('[RIDES] Business order assigned:', ride.id, 'courier:', candidate.driverId, 'distanceKm:', candidate.distanceKm.toFixed(2));

  const assignmentData: Record<string, string> = {
    type: 'business_delivery',
    rideId: ride.id,
    businessId: ride.businessId ?? '',
    assignmentExpiresAt: expiresAt,
    maxDistanceKm: MAX_BUSINESS_COURIER_DISTANCE_KM.toString(),
  };

  createRideNotification(
    candidate.driverId,
    '📦 Size en yakın sipariş',
    `${ride.businessName ?? 'İşletme'} • ${candidate.distanceKm.toFixed(1)} km • 1 dk içinde onaylayın`,
    assignmentData,
  );

  await sendPushToUser(
    candidate.driverId,
    '📦 Size en yakın sipariş',
    `${ride.businessName ?? 'İşletme'} • ${candidate.distanceKm.toFixed(1)} km • 1 dk içinde onaylayın`,
    assignmentData,
  );

  setTimeout(() => {
    void handleBusinessOrderAssignmentTimeout(ride.id, candidate.driverId);
  }, BUSINESS_COURIER_RESPONSE_WINDOW_MS + 250);
}

async function handleBusinessOrderAssignmentTimeout(rideId: string, assignedCourierId: string): Promise<void> {
  const ride = db.rides.get(rideId);
  if (!isBusinessRide(ride)) {
    return;
  }

  if (ride.status !== 'pending') {
    console.log('[RIDES] Timeout skipped, ride is no longer pending:', rideId, ride.status);
    return;
  }

  if (ride.assignedCourierId !== assignedCourierId) {
    console.log('[RIDES] Timeout skipped, courier assignment changed:', rideId, 'expected:', assignedCourierId, 'current:', ride.assignedCourierId ?? 'none');
    return;
  }

  const expiresAtMs = ride.courierRequestExpiresAt ? new Date(ride.courierRequestExpiresAt).getTime() : 0;
  if (expiresAtMs > Date.now()) {
    console.log('[RIDES] Timeout skipped, assignment still active:', rideId, 'courier:', assignedCourierId);
    return;
  }

  createRideNotification(
    assignedCourierId,
    '⌛ Sipariş başka kuryeye geçti',
    '1 dakika içinde onay gelmediği için sipariş başka bir kuryeye yönlendirildi.',
    { type: 'business_delivery_expired', rideId, businessId: ride.businessId ?? '' },
  );

  await sendPushToUser(
    assignedCourierId,
    '⌛ Sipariş başka kuryeye geçti',
    '1 dakika içinde onay gelmediği için sipariş başka bir kuryeye yönlendirildi.',
    { type: 'business_delivery_expired', rideId, businessId: ride.businessId ?? '' },
  );

  const reassignment = await dispatchBusinessOrderToNearestCourier(rideId, {
    skippedCourierId: assignedCourierId,
    trigger: 'timeout',
  });

  if (!reassignment.assigned) {
    createRideNotification(
      ride.customerId,
      '⚠️ Kurye aranıyor',
      `${ride.businessName ?? 'İşletme'} siparişiniz için 10 km içinde başka müsait kurye bulunamadı.`,
      { type: 'business_delivery_waiting', rideId, businessId: ride.businessId ?? '' },
    );

    await sendPushToUser(
      ride.customerId,
      '⚠️ Kurye aranıyor',
      `${ride.businessName ?? 'İşletme'} siparişiniz için 10 km içinde başka müsait kurye bulunamadı.`,
      { type: 'business_delivery_waiting', rideId, businessId: ride.businessId ?? '' },
    );
  }
}

export async function dispatchBusinessOrderToNearestCourier(rideId: string, options?: DispatchOptions): Promise<DispatchResult> {
  const ride = db.rides.get(rideId);
  if (!isBusinessRide(ride)) {
    return { assigned: false, reason: 'not_business_order', attemptedCount: 0 };
  }

  if (ride.status !== 'pending') {
    return {
      assigned: false,
      reason: 'ride_not_pending',
      attemptedCount: (ride.courierAttemptedDriverIds ?? []).length,
    };
  }

  const attemptedCourierIds = new Set(ride.courierAttemptedDriverIds ?? []);
  const rejectedCourierIds = new Set(ride.courierRejectedDriverIds ?? []);

  if (options?.skippedCourierId) {
    attemptedCourierIds.add(options.skippedCourierId);
    rejectedCourierIds.add(options.skippedCourierId);
  }

  const preparedRide: BusinessRide = {
    ...ride,
    assignedCourierId: undefined,
    courierRequestExpiresAt: undefined,
    courierAttemptedDriverIds: Array.from(attemptedCourierIds),
    courierRejectedDriverIds: Array.from(rejectedCourierIds),
    maxCourierDistanceKm: MAX_BUSINESS_COURIER_DISTANCE_KM,
  };

  const candidates = getEligibleCourierCandidates(preparedRide);
  if (candidates.length === 0) {
    await db.rides.setSync(rideId, preparedRide);
    console.log('[RIDES] No eligible courier within 10 km:', rideId, 'trigger:', options?.trigger ?? 'manual');
    return {
      assigned: false,
      reason: 'no_courier_within_range',
      attemptedCount: preparedRide.courierAttemptedDriverIds?.length ?? 0,
    };
  }

  const nextCourier = candidates[0];
  attemptedCourierIds.add(nextCourier.driverId);
  const attemptedList = Array.from(attemptedCourierIds);

  await assignBusinessOrderToCourier(preparedRide, nextCourier, attemptedList);

  return {
    assigned: true,
    courierId: nextCourier.driverId,
    distanceKm: nextCourier.distanceKm,
    reason: 'assigned',
    attemptedCount: attemptedList.length,
  };
}

export async function refreshExpiredBusinessOrderAssignments(city: string): Promise<void> {
  const expiredAssignedOrders = db.rides.getPendingByCity(city)
    .filter((ride) => isBusinessRide(ride))
    .filter((ride) => !!ride.assignedCourierId)
    .filter((ride) => {
      if (!ride.courierRequestExpiresAt) {
        return false;
      }
      return new Date(ride.courierRequestExpiresAt).getTime() <= Date.now();
    });

  for (const ride of expiredAssignedOrders) {
    const assignedCourierId = ride.assignedCourierId;
    if (!assignedCourierId) {
      continue;
    }
    await handleBusinessOrderAssignmentTimeout(ride.id, assignedCourierId);
  }
}

export async function tryDispatchWaitingBusinessOrdersForCourier(driverId: string): Promise<number> {
  const driver = db.drivers.get(driverId);
  if (!driver) {
    return 0;
  }

  if (driver.driverCategory !== 'courier' || !driver.isOnline || driver.isApproved === false || driver.isSuspended) {
    return 0;
  }

  const driverLocation = db.driverLocations.get(driverId);
  if (!driverLocation) {
    return 0;
  }

  if (hasActiveRideForCourier(driverId)) {
    console.log('[RIDES] Skipping courier dispatch because courier already has active ride:', driverId);
    return 0;
  }

  const candidateOrders = db.rides.getPendingByCity(driver.city)
    .filter((ride) => isBusinessRide(ride))
    .filter((ride) => !ride.assignedCourierId)
    .filter((ride) => typeof ride.pickupLat === 'number' && typeof ride.pickupLng === 'number')
    .filter((ride) => !(ride.courierAttemptedDriverIds ?? []).includes(driverId))
    .filter((ride) => !(ride.courierRejectedDriverIds ?? []).includes(driverId))
    .filter((ride) => {
      const pickupLat = ride.pickupLat;
      const pickupLng = ride.pickupLng;
      if (typeof pickupLat !== 'number' || typeof pickupLng !== 'number') {
        return false;
      }
      const distanceKm = haversineDistance(
        pickupLat,
        pickupLng,
        driverLocation.latitude,
        driverLocation.longitude,
      );
      return distanceKm <= MAX_BUSINESS_COURIER_DISTANCE_KM;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  let dispatchedCount = 0;

  for (const ride of candidateOrders) {
    const result = await dispatchBusinessOrderToNearestCourier(ride.id, { trigger: 'courier_available' });
    if (result.assigned) {
      dispatchedCount += 1;
    }
  }

  if (dispatchedCount > 0) {
    console.log('[RIDES] Waiting business orders dispatched after courier availability:', driverId, 'count:', dispatchedCount);
  }

  return dispatchedCount;
}
