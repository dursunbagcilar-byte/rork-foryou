import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../create-context";
import { db } from "../../db/store";
import type { Ride } from "../../db/types";
import {
  createRideNotification,
  dispatchBusinessOrderToNearestCourier,
  isBusinessRide,
  refreshExpiredBusinessOrderAssignments,
  sendPushToUser,
} from "./business-order-dispatch";

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

function scoreDriver(driver: {
  id: string;
  name: string;
  rating: number;
  totalRides: number;
  driverCategory?: string;
  isApproved?: boolean;
  isSuspended?: boolean;
  distance: number;
}, requestedCategory?: string): number {
  let score = 0;

  const maxDistance = 50;
  const distanceScore = Math.max(0, 1 - (driver.distance / maxDistance));
  score += distanceScore * 40;

  score += (driver.rating / 5) * 25;

  const ridesScore = Math.min(driver.totalRides / 500, 1);
  score += ridesScore * 15;

  if (requestedCategory && driver.driverCategory === requestedCategory) {
    score += 20;
  } else if (!requestedCategory) {
    score += 10;
  }

  return score;
}

export const ridesRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        customerName: z.string(),
        pickupAddress: z.string(),
        dropoffAddress: z.string(),
        pickupLat: z.number().optional(),
        pickupLng: z.number().optional(),
        dropoffLat: z.number().optional(),
        dropoffLng: z.number().optional(),
        price: z.number(),
        distance: z.string(),
        duration: z.string(),
        isFreeRide: z.boolean(),
        city: z.string(),
        paymentMethod: z.enum(["cash", "card"]).optional(),
        rideForOther: z.boolean().optional(),
        recipientName: z.string().optional(),
        recipientPhone: z.string().optional(),
        recipientRelation: z.string().optional(),
        guestPaymentMode: z.enum(["customer_app", "guest_in_car"]).optional(),
        guestTrackingEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = "r_" + Date.now();
      const ride = {
        id,
        customerId: input.customerId,
        customerName: input.customerName,
        driverId: "",
        driverName: "",
        driverRating: 0,
        pickupAddress: input.pickupAddress,
        dropoffAddress: input.dropoffAddress,
        pickupLat: input.pickupLat,
        pickupLng: input.pickupLng,
        dropoffLat: input.dropoffLat,
        dropoffLng: input.dropoffLng,
        status: "pending" as const,
        price: input.price,
        distance: input.distance,
        duration: input.duration,
        createdAt: new Date().toISOString(),
        paymentMethod: input.paymentMethod ?? ("cash" as const),
        isFreeRide: input.isFreeRide,
        city: input.city,
        rideForOther: input.rideForOther,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        recipientRelation: input.recipientRelation,
        guestPaymentMode: input.guestPaymentMode,
        guestTrackingEnabled: input.guestTrackingEnabled,
      };

      await db.rides.setSync(id, ride);
      console.log("[RIDES] Created ride:", id, "city:", input.city, "payment:", ride.paymentMethod, "forOther:", input.rideForOther ?? false);

      setTimeout(() => {
        const currentRide = db.rides.get(id);
        if (currentRide && currentRide.status === 'pending') {
          const timedOut = { ...currentRide, status: 'cancelled' as const, cancelledBy: 'customer' as const, cancelReason: 'Zaman aşımı - şoför bulunamadı', cancelledAt: new Date().toISOString() };
          void db.rides.setSync(id, timedOut);
          void sendPushToUser(input.customerId, '⏱️ Yolculuk Zaman Aşımı', 'Müsait şoför bulunamadı. Lütfen tekrar deneyin.', { type: 'ride_timeout', rideId: id });
          console.log('[RIDES] Ride timed out after 5 minutes:', id);
        }
      }, 5 * 60 * 1000);

      const onlineDrivers = db.drivers.getOnlineByCity(input.city);
      for (const driver of onlineDrivers) {
        void sendPushToUser(driver.id, '🔔 Yeni Yolculuk Talebi!', `${input.pickupAddress} → ${input.dropoffAddress}`, { type: 'new_ride_request', rideId: id });
      }

      return { success: true, ride };
    }),

  createBusinessOrder: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        customerName: z.string(),
        city: z.string(),
        district: z.string().optional(),
        businessId: z.string(),
        businessName: z.string(),
        businessImage: z.string().optional(),
        businessWebsite: z.string().optional(),
        pickupAddress: z.string(),
        dropoffAddress: z.string(),
        pickupLat: z.number().optional(),
        pickupLng: z.number().optional(),
        dropoffLat: z.number().optional(),
        dropoffLng: z.number().optional(),
        orderItems: z.array(z.object({
          id: z.string(),
          name: z.string(),
          quantity: z.number().min(1),
          unitPrice: z.number().min(0),
        })).min(1),
        orderNote: z.string().max(500).optional(),
        subtotal: z.number().min(0),
        deliveryFee: z.number().min(0),
        duration: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const ride: Ride = {
        id,
        customerId: input.customerId,
        customerName: input.customerName,
        driverId: '',
        driverName: '',
        driverRating: 0,
        pickupAddress: input.pickupAddress,
        dropoffAddress: input.dropoffAddress,
        pickupLat: input.pickupLat,
        pickupLng: input.pickupLng,
        dropoffLat: input.dropoffLat,
        dropoffLng: input.dropoffLng,
        status: 'pending' as const,
        price: input.subtotal + input.deliveryFee,
        distance: 'İşletme teslimatı',
        duration: input.duration ?? '25-35 dk',
        createdAt: new Date().toISOString(),
        paymentMethod: 'cash' as const,
        isFreeRide: false,
        city: input.city,
        orderType: 'business_delivery' as const,
        businessId: input.businessId,
        businessName: input.businessName,
        businessImage: input.businessImage,
        businessWebsite: input.businessWebsite,
        orderItems: input.orderItems,
        orderNote: input.orderNote,
        assignedCourierId: undefined,
        courierRequestExpiresAt: undefined,
        courierDispatchedAt: undefined,
        courierAttemptedDriverIds: [],
        courierRejectedDriverIds: [],
        maxCourierDistanceKm: 10,
      };

      await db.rides.setSync(id, ride);
      console.log('[RIDES] Business order created:', id, input.businessName, 'items:', input.orderItems.length, 'city:', input.city);

      const dispatchResult = await dispatchBusinessOrderToNearestCourier(id, { trigger: 'created' });
      const storedRide = db.rides.get(id) ?? ride;
      const customerNotificationTitle = dispatchResult.assigned ? '✅ Siparişiniz alındı' : '⚠️ Kurye aranıyor';
      const customerNotificationBody = dispatchResult.assigned
        ? `${input.businessName} siparişiniz en yakın kuryeye gönderildi.`
        : `${input.businessName} siparişiniz alındı. 10 km içinde müsait kurye aranıyor.`;
      const notifiedScope = dispatchResult.assigned ? 'nearest_courier_within_10km' : 'waiting_for_courier_within_10km';

      createRideNotification(
        input.customerId,
        customerNotificationTitle,
        customerNotificationBody,
        {
          type: dispatchResult.assigned ? 'business_delivery_created' : 'business_delivery_waiting',
          rideId: id,
          businessId: input.businessId,
        }
      );
      void sendPushToUser(
        input.customerId,
        customerNotificationTitle,
        customerNotificationBody,
        {
          type: dispatchResult.assigned ? 'business_delivery_created' : 'business_delivery_waiting',
          rideId: id,
          businessId: input.businessId,
        }
      );

      return {
        success: true,
        ride: storedRide,
        notifiedCouriers: dispatchResult.assigned ? 1 : 0,
        notifiedScope,
        dispatchResult,
      };
    }),

  declineBusinessOrder: protectedProcedure
    .input(
      z.object({
        rideId: z.string(),
        driverId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const ride = db.rides.get(input.rideId);
      if (!isBusinessRide(ride)) return { success: false, error: 'İşletme siparişi bulunamadı' };
      if (ride.status !== 'pending') return { success: false, error: 'Sipariş artık beklemede değil' };
      if (ride.assignedCourierId !== input.driverId) return { success: false, error: 'Bu sipariş size atanmadı' };

      const reassignment = await dispatchBusinessOrderToNearestCourier(input.rideId, {
        skippedCourierId: input.driverId,
        trigger: 'declined',
      });

      console.log('[RIDES] Business order declined by courier:', input.rideId, input.driverId, 'reassigned:', reassignment.assigned);
      return { success: true, reassignment };
    }),

  accept: protectedProcedure
    .input(
      z.object({
        rideId: z.string(),
        driverId: z.string(),
        driverName: z.string(),
        driverRating: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const ride = db.rides.get(input.rideId);
      if (!ride) return { success: false, error: "Yolculuk bulunamadı" };
      if (ride.status !== "pending") {
        console.log('[RIDES] Race condition: ride', input.rideId, 'status is', ride.status, 'not pending. Already accepted by:', ride.driverId);
        return { success: false, error: "Yolculuk zaten kabul edilmiş" };
      }
      if (ride.driverId && ride.driverId !== '' && ride.driverId !== input.driverId) {
        console.log('[RIDES] Race condition: ride', input.rideId, 'already has driver:', ride.driverId);
        return { success: false, error: "Yolculuk başka bir şoför tarafından kabul edildi" };
      }

      if (isBusinessRide(ride)) {
        if (!ride.assignedCourierId || ride.assignedCourierId !== input.driverId) {
          return { success: false, error: 'Bu sipariş size atanmadı' };
        }

        const expiresAtMs = ride.courierRequestExpiresAt ? new Date(ride.courierRequestExpiresAt).getTime() : 0;
        if (expiresAtMs > 0 && Date.now() > expiresAtMs) {
          await refreshExpiredBusinessOrderAssignments(ride.city);
          return { success: false, error: 'Sipariş süresi doldu. Sistem başka kurye arıyor.' };
        }
      }

      const updated: Ride = {
        ...ride,
        status: "accepted" as const,
        driverId: input.driverId,
        driverName: input.driverName,
        driverRating: input.driverRating,
        assignedCourierId: undefined,
        courierRequestExpiresAt: undefined,
      };

      await db.rides.setSync(input.rideId, updated);
      console.log("[RIDES] Accepted ride:", input.rideId, "by driver:", input.driverId);

      const customerTitle = isBusinessRide(ride) ? '✅ Kurye siparişi kabul etti' : '✅ Yolculuk Kabul Edildi';
      const customerBody = isBusinessRide(ride)
        ? `${input.driverName} siparişinizi teslim almak için yola çıktı!`
        : `${input.driverName} yolculuğunuzu kabul etti!`;
      const customerType = isBusinessRide(ride) ? 'business_delivery_accepted' : 'ride_accepted';

      createRideNotification(ride.customerId, customerTitle, customerBody, {
        type: customerType,
        rideId: input.rideId,
        driverName: input.driverName,
      });
      void sendPushToUser(ride.customerId, customerTitle, customerBody, {
        type: customerType,
        rideId: input.rideId,
        driverName: input.driverName,
      });

      return { success: true, ride: updated };
    }),

  startRide: protectedProcedure
    .input(z.object({ rideId: z.string() }))
    .mutation(async ({ input }) => {
      const ride = db.rides.get(input.rideId);
      if (!ride) return { success: false, error: "Yolculuk bulunamadı" };

      const updated = { ...ride, status: "in_progress" as const };
      await db.rides.setSync(input.rideId, updated);
      console.log("[RIDES] Started ride:", input.rideId);

      void sendPushToUser(ride.customerId, '🚗 Yolculuk Başladı', 'Şoförünüz yola çıktı. İyi yolculuklar!', { type: 'ride_started', rideId: input.rideId });

      return { success: true, ride: updated };
    }),

  complete: protectedProcedure
    .input(z.object({ rideId: z.string() }))
    .mutation(async ({ input }) => {
      const ride = db.rides.get(input.rideId);
      if (!ride) return { success: false, error: "Yolculuk bulunamadı" };

      const updated = {
        ...ride,
        status: "completed" as const,
        completedAt: new Date().toISOString(),
      };
      await db.rides.setSync(input.rideId, updated);

      const driver = db.drivers.get(ride.driverId);
      if (driver) {
        const updatedDriver = {
          ...driver,
          totalRides: driver.totalRides + 1,
          dailyEarnings: driver.dailyEarnings + ride.price,
          weeklyEarnings: driver.weeklyEarnings + ride.price,
          monthlyEarnings: driver.monthlyEarnings + ride.price,
        };
        await db.drivers.setSync(ride.driverId, updatedDriver);
      }

      console.log("[RIDES] Completed ride:", input.rideId);

      void sendPushToUser(ride.customerId, '🎉 Yolculuk Tamamlandı', `Toplam: ₺${ride.price.toFixed(2)}. İyi günler!`, { type: 'ride_completed', rideId: input.rideId, price: ride.price.toString() });

      return { success: true, ride: updated };
    }),

  driverArrived: protectedProcedure
    .input(z.object({ rideId: z.string(), driverName: z.string() }))
    .mutation(async ({ input }) => {
      const ride = db.rides.get(input.rideId);
      if (!ride) return { success: false, error: "Yolculuk bulunamadı" };

      void sendPushToUser(
        ride.customerId,
        '📍 Şoför Adresinize Geldi!',
        `${input.driverName} konumunuza ulaştı. Lütfen varışı onaylayın. Onayladıktan sonra yolculuğu iptal edemezsiniz ve yolculuk bedelini ödemekle yükümlüsünüz.`,
        { type: 'driver_arrived', rideId: input.rideId, driverName: input.driverName }
      );

      console.log("[RIDES] Driver arrived notification sent for ride:", input.rideId);
      return { success: true };
    }),

  cancel: protectedProcedure
    .input(z.object({
      rideId: z.string(),
      cancelledBy: z.enum(["customer", "driver"]).optional(),
      cancelReason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const ride = db.rides.get(input.rideId);
      if (!ride) return { success: false, error: "Yolculuk bulunamadı" };

      if (ride.status === 'completed' || ride.status === 'cancelled') {
        return { success: false, error: "Bu yolculuk zaten tamamlanmış veya iptal edilmiş" };
      }

      let cancellationFee = 0;
      const cancelledBy = input.cancelledBy ?? "customer";

      if (cancelledBy === 'customer' && ride.status === 'accepted') {
        const createdAt = new Date(ride.createdAt).getTime();
        const timeSinceCreation = Date.now() - createdAt;
        const TWO_MINUTES = 2 * 60 * 1000;
        if (timeSinceCreation > TWO_MINUTES) {
          cancellationFee = Math.round(ride.price * 0.1 * 100) / 100;
          console.log('[RIDES] Cancellation fee applied:', cancellationFee, 'TL for ride:', input.rideId);
        }
      }

      if (cancelledBy === 'customer' && ride.status === 'in_progress') {
        cancellationFee = Math.round(ride.price * 0.5 * 100) / 100;
        console.log('[RIDES] In-progress cancellation fee:', cancellationFee, 'TL for ride:', input.rideId);
      }

      const updated = {
        ...ride,
        status: "cancelled" as const,
        cancelledBy,
        cancelReason: input.cancelReason ?? "",
        cancelledAt: new Date().toISOString(),
        cancellationFee,
      };
      await db.rides.setSync(input.rideId, updated);
      console.log("[RIDES] Cancelled ride:", input.rideId, "by:", cancelledBy, "reason:", input.cancelReason, "fee:", cancellationFee);

      if (input.cancelledBy === "driver" && ride.customerId) {
        void sendPushToUser(ride.customerId, '❌ Yolculuk İptal Edildi', `Şoför yolculuğu iptal etti. Sebep: ${input.cancelReason ?? 'Belirtilmedi'}`, { type: 'ride_cancelled', rideId: input.rideId });
      } else if (input.cancelledBy === "customer" && ride.driverId) {
        void sendPushToUser(ride.driverId, '❌ Yolculuk İptal Edildi', `${ride.customerName} yolculuğu iptal etti. Sebep: ${input.cancelReason ?? 'Belirtilmedi'}`, { type: 'ride_cancelled', rideId: input.rideId });
      } else {
        if (ride.driverId) {
          void sendPushToUser(ride.driverId, '❌ Yolculuk İptal Edildi', `${ride.customerName} yolculuğu iptal etti.`, { type: 'ride_cancelled', rideId: input.rideId });
        }
        if (ride.customerId) {
          void sendPushToUser(ride.customerId, '❌ Yolculuk İptal Edildi', 'Yolculuğunuz iptal edildi.', { type: 'ride_cancelled', rideId: input.rideId });
        }
      }

      return { success: true, ride: updated };
    }),

  getById: protectedProcedure
    .input(z.object({ rideId: z.string() }))
    .query(({ input }) => {
      return db.rides.get(input.rideId) ?? null;
    }),

  getCustomerRides: protectedProcedure
    .input(z.object({
      customerId: z.string(),
      page: z.number().min(1).optional(),
      limit: z.number().min(1).max(50).optional(),
      status: z.enum(["pending", "accepted", "in_progress", "completed", "cancelled"]).optional(),
    }))
    .query(({ input }) => {
      const page = input.page ?? 1;
      const limit = input.limit ?? 20;
      let rides = db.rides.getByCustomer(input.customerId);
      if (input.status) {
        rides = rides.filter(r => r.status === input.status);
      }
      const total = rides.length;
      const offset = (page - 1) * limit;
      const paginated = rides.slice(offset, offset + limit);
      console.log('[RIDES] getCustomerRides:', input.customerId, 'page:', page, 'total:', total, 'returned:', paginated.length);
      return {
        rides: paginated,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + limit < total,
      };
    }),

  getDriverRides: protectedProcedure
    .input(z.object({
      driverId: z.string(),
      page: z.number().min(1).optional(),
      limit: z.number().min(1).max(50).optional(),
      status: z.enum(["pending", "accepted", "in_progress", "completed", "cancelled"]).optional(),
    }))
    .query(({ input }) => {
      const page = input.page ?? 1;
      const limit = input.limit ?? 20;
      let rides = db.rides.getByDriver(input.driverId);
      if (input.status) {
        rides = rides.filter(r => r.status === input.status);
      }
      const total = rides.length;
      const offset = (page - 1) * limit;
      const paginated = rides.slice(offset, offset + limit);
      console.log('[RIDES] getDriverRides:', input.driverId, 'page:', page, 'total:', total, 'returned:', paginated.length);
      return {
        rides: paginated,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + limit < total,
      };
    }),

  getPendingByCity: protectedProcedure
    .input(z.object({
      city: z.string(),
      driverCategory: z.enum(['driver', 'scooter', 'courier']).optional(),
      driverId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      await refreshExpiredBusinessOrderAssignments(input.city);
      const pendingRides = db.rides.getPendingByCity(input.city);
      if (input.driverCategory === 'courier') {
        if (!input.driverId) {
          return [];
        }
        return pendingRides
          .filter((ride) => isBusinessRide(ride))
          .filter((ride) => ride.assignedCourierId === input.driverId)
          .filter((ride) => {
            if (!ride.courierRequestExpiresAt) {
              return true;
            }
            return new Date(ride.courierRequestExpiresAt).getTime() > Date.now();
          });
      }
      return pendingRides.filter((ride) => !isBusinessRide(ride));
    }),

  findBestDriver: protectedProcedure
    .input(
      z.object({
        city: z.string(),
        pickupLat: z.number().optional(),
        pickupLng: z.number().optional(),
        vehicleCategory: z.string().optional(),
        excludeDriverIds: z.array(z.string()).optional(),
      })
    )
    .query(({ input }) => {
      const onlineDrivers = db.drivers.getOnlineByCity(input.city);
      const excludeIds = new Set(input.excludeDriverIds ?? []);

      const candidates = onlineDrivers
        .filter(d => !excludeIds.has(d.id))
        .filter(d => d.isApproved !== false)
        .filter(d => !d.isSuspended)
        .map(d => {
          const loc = db.driverLocations.get(d.id);
          let distance = 999;
          if (loc && input.pickupLat && input.pickupLng) {
            distance = haversineDistance(input.pickupLat, input.pickupLng, loc.latitude, loc.longitude);
          } else if (loc) {
            distance = 10;
          }
          return {
            id: d.id,
            name: d.name,
            phone: d.phone,
            vehicleModel: d.vehicleModel,
            vehiclePlate: d.vehiclePlate,
            vehicleColor: d.vehicleColor,
            rating: d.rating,
            totalRides: d.totalRides,
            driverCategory: d.driverCategory,
            isApproved: d.isApproved,
            isSuspended: d.isSuspended,
            distance,
            location: loc ?? null,
          };
        });

      if (candidates.length === 0) {
        console.log('[RIDES] findBestDriver: no candidates in', input.city, 'category:', input.vehicleCategory);
        return { found: false, driver: null, totalOnline: onlineDrivers.length, reason: 'no_drivers' as const };
      }

      const scored = candidates.map(d => ({
        ...d,
        score: scoreDriver(d, input.vehicleCategory),
      }));

      scored.sort((a, b) => b.score - a.score);

      const best = scored[0];
      console.log('[RIDES] findBestDriver: best=', best.name, 'score=', best.score.toFixed(1), 'dist=', best.distance.toFixed(2), 'km, category:', best.driverCategory, 'requested:', input.vehicleCategory);
      console.log('[RIDES] findBestDriver: candidates:', scored.map(s => `${s.name}(${s.score.toFixed(1)})`).join(', '));

      const shortName = best.name.split(' ').length > 1
        ? best.name.split(' ')[0] + ' ' + best.name.split(' ')[best.name.split(' ').length - 1].charAt(0) + '.'
        : best.name;
      const initials = best.name.split(' ').map((n: string) => n.charAt(0)).join('').substring(0, 2).toUpperCase();

      return {
        found: true,
        driver: {
          id: best.id,
          name: best.name,
          shortName,
          initials,
          phone: best.phone,
          vehicleModel: best.vehicleModel,
          vehiclePlate: best.vehiclePlate,
          vehicleColor: best.vehicleColor,
          vehicleType: best.driverCategory === 'scooter' ? 'scooter' as const : best.driverCategory === 'courier' ? 'motorcycle' as const : 'car' as const,
          rating: best.rating,
          totalRides: best.totalRides,
          distance: best.distance,
          score: best.score,
          location: best.location,
        },
        totalOnline: onlineDrivers.length,
        reason: 'found' as const,
      };
    }),

  getActiveRide: protectedProcedure
    .input(z.object({ userId: z.string(), type: z.enum(["customer", "driver"]) }))
    .query(({ input }) => {
      if (input.type === "customer") {
        return db.rides.getActiveByCustomer(input.userId) ?? null;
      }
      return db.rides.getActiveByDriver(input.userId) ?? null;
    }),
});
