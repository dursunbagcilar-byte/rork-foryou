import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../create-context";
import { db, initializeStore, forceReloadStore } from "../../db/store";
import type { Ride } from "../../db/types";
import { sanitizeInput } from "../../utils/security";
import { getTurkishPhoneValidationError, normalizeTurkishPhone } from "../../../utils/phone";
import { tryDispatchWaitingBusinessOrdersForCourier } from "./business-order-dispatch";

function normalizePhoneForComparison(phone: string | undefined): string {
  return normalizeTurkishPhone(phone);
}

function isPhoneTakenByAnotherAccount(phone: string, excludedId?: string): boolean {
  const normalizedPhone = normalizePhoneForComparison(phone);
  if (!normalizedPhone) {
    return false;
  }

  const matchingUser = db.users.getAll().find((item) => {
    return item.id !== excludedId && normalizePhoneForComparison(item.phone) === normalizedPhone;
  });

  if (matchingUser) {
    return true;
  }

  const matchingDriver = db.drivers.getAll().find((item) => {
    return item.id !== excludedId && normalizePhoneForComparison(item.phone) === normalizedPhone;
  });

  return !!matchingDriver;
}

function hasDriverAccess(ctx: { userId: string | null; userType: 'customer' | 'driver' | null }, driverId: string): boolean {
  return ctx.userType === 'driver' && ctx.userId === driverId;
}

function canCustomerAccessDriver(ctx: { userId: string | null; userType: 'customer' | 'driver' | null }, driverId: string): boolean {
  if (ctx.userType !== 'customer' || !ctx.userId) {
    return false;
  }

  return db.rides.getAll().some((ride) => {
    const rideHasDriver = ride.driverId === driverId || ride.assignedCourierId === driverId;
    if (!rideHasDriver) {
      return false;
    }

    return ride.customerId === ctx.userId && (ride.status === 'accepted' || ride.status === 'in_progress');
  });
}

function canAccessDriverProfile(ctx: { userId: string | null; userType: 'customer' | 'driver' | null }, driverId: string): boolean {
  return hasDriverAccess(ctx, driverId) || canCustomerAccessDriver(ctx, driverId);
}

function canAccessDriverLocation(ctx: { userId: string | null; userType: 'customer' | 'driver' | null }, driverId: string): boolean {
  return hasDriverAccess(ctx, driverId) || canCustomerAccessDriver(ctx, driverId);
}

function buildForbiddenDriverResponse(message = 'Bu işlem için yetkiniz yok') {
  return { success: false, error: message };
}

function normalizeDriverCategory(driverCategory?: string): NonNullable<Ride['requestedDriverCategory']> {
  if (driverCategory === 'scooter' || driverCategory === 'courier') {
    return driverCategory;
  }

  return 'driver';
}

function matchesRequestedDriverCategory(driverCategory: string | undefined, requestedCategory?: Ride['requestedDriverCategory']): boolean {
  if (!requestedCategory) {
    return true;
  }

  return normalizeDriverCategory(driverCategory) === requestedCategory;
}

export const driversRouter = createTRPCRouter({
  updateLocation: protectedProcedure
    .input(
      z.object({
        driverId: z.string(),
        latitude: z.number(),
        longitude: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!hasDriverAccess(ctx, input.driverId)) {
        return buildForbiddenDriverResponse();
      }

      db.driverLocations.set(input.driverId, {
        latitude: input.latitude,
        longitude: input.longitude,
      });

      const driver = db.drivers.get(input.driverId);
      if (driver?.isOnline && driver.driverCategory === 'courier') {
        const dispatchedCount = await tryDispatchWaitingBusinessOrdersForCourier(input.driverId);
        console.log('[DRIVERS] updateLocation triggered business order dispatch:', input.driverId, 'count:', dispatchedCount);
      }

      return { success: true };
    }),

  getLocation: protectedProcedure
    .input(z.object({ driverId: z.string() }))
    .query(({ input, ctx }) => {
      if (!canAccessDriverLocation(ctx, input.driverId)) {
        return null;
      }

      return db.driverLocations.get(input.driverId) ?? null;
    }),

  setOnlineStatus: protectedProcedure
    .input(
      z.object({
        driverId: z.string(),
        isOnline: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!hasDriverAccess(ctx, input.driverId)) {
        return buildForbiddenDriverResponse();
      }

      const driver = db.drivers.get(input.driverId);
      if (!driver) return { success: false, error: "Şoför bulunamadı" };

      await db.drivers.setSync(input.driverId, { ...driver, isOnline: input.isOnline });
      console.log("[DRIVERS] Online status:", input.driverId, input.isOnline);

      if (input.isOnline && driver.driverCategory === 'courier') {
        const dispatchedCount = await tryDispatchWaitingBusinessOrdersForCourier(input.driverId);
        console.log('[DRIVERS] setOnlineStatus triggered business order dispatch:', input.driverId, 'count:', dispatchedCount);
      }

      return { success: true };
    }),

  getOnlineByCity: protectedProcedure
    .input(z.object({
      city: z.string(),
      requestedDriverCategory: z.enum(["driver", "scooter", "courier"]).optional(),
    }))
    .query(({ input }) => {
      const drivers = db.drivers.getOnlineByCity(input.city)
        .filter((driver) => !db.rides.getActiveByDriver(driver.id))
        .filter((driver) => driver.isApproved !== false)
        .filter((driver) => !driver.isSuspended)
        .filter((driver) => matchesRequestedDriverCategory(driver.driverCategory, input.requestedDriverCategory));
      console.log('[DRIVERS] getOnlineByCity available drivers:', input.city, 'category:', input.requestedDriverCategory ?? 'all', 'count:', drivers.length);
      return drivers.map(d => {
        const loc = db.driverLocations.get(d.id);
        return {
          id: d.id,
          name: d.name,
          vehicleModel: d.vehicleModel,
          vehicleColor: d.vehicleColor,
          vehiclePlate: d.vehiclePlate,
          rating: d.rating,
          location: loc ?? null,
        };
      });
    }),

  getProfile: protectedProcedure
    .input(z.object({ driverId: z.string() }))
    .query(({ input, ctx }) => {
      if (!canAccessDriverProfile(ctx, input.driverId)) {
        return null;
      }

      return db.drivers.get(input.driverId) ?? null;
    }),

  saveDocuments: protectedProcedure
    .input(
      z.object({
        driverId: z.string(),
        licenseFront: z.string().optional(),
        licenseBack: z.string().optional(),
        idCardFront: z.string().optional(),
        idCardBack: z.string().optional(),
        registrationFront: z.string().optional(),
        registrationBack: z.string().optional(),
        criminalRecord: z.string().optional(),
        taxCertificate: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!hasDriverAccess(ctx, input.driverId)) {
        return buildForbiddenDriverResponse();
      }

      const driver = db.drivers.get(input.driverId);
      if (!driver) return { success: false, error: "Şoför bulunamadı" };

      const existing = db.driverDocuments.get(input.driverId);
      const merged = {
        driverId: input.driverId,
        licenseFront: input.licenseFront ?? existing?.licenseFront,
        licenseBack: input.licenseBack ?? existing?.licenseBack,
        idCardFront: input.idCardFront ?? existing?.idCardFront,
        idCardBack: input.idCardBack ?? existing?.idCardBack,
        registrationFront: input.registrationFront ?? existing?.registrationFront,
        registrationBack: input.registrationBack ?? existing?.registrationBack,
        criminalRecord: input.criminalRecord ?? existing?.criminalRecord,
        taxCertificate: input.taxCertificate ?? existing?.taxCertificate,
        uploadedAt: new Date().toISOString(),
      };

      await db.driverDocuments.setSync(input.driverId, merged);
      console.log("[DRIVERS] Documents saved (sync) for:", input.driverId);
      return { success: true };
    }),

  checkApprovalStatus: protectedProcedure
    .input(z.object({ driverId: z.string() }))
    .query(async ({ input, ctx }) => {
      if (!hasDriverAccess(ctx, input.driverId)) {
        return { found: false, isApproved: false, isSuspended: false };
      }

      await initializeStore();
      let driver = db.drivers.get(input.driverId);
      if (!driver) {
        const allDrivers = db.drivers.getAll();
        driver = allDrivers.find(d => d.id === input.driverId) ?? undefined;
      }
      if (!driver) {
        console.log('[DRIVERS] checkApprovalStatus: driver not found in memory, trying force reload:', input.driverId);
        try {
          await forceReloadStore();
          driver = db.drivers.get(input.driverId);
          if (!driver) {
            const allDrivers = db.drivers.getAll();
            driver = allDrivers.find(d => d.id === input.driverId) ?? undefined;
          }
        } catch (e) {
          console.log('[DRIVERS] checkApprovalStatus: force reload failed:', e);
        }
      }
      if (!driver) {
        console.log('[DRIVERS] checkApprovalStatus: driver not found after reload:', input.driverId, 'total drivers:', db.drivers.getAll().length);
        return { found: false, isApproved: false, isSuspended: false };
      }
      console.log('[DRIVERS] checkApprovalStatus:', input.driverId, 'approved:', driver.isApproved);
      return {
        found: true,
        isApproved: driver.isApproved ?? false,
        isSuspended: driver.isSuspended ?? false,
        approvedAt: driver.approvedAt,
      };
    }),

  getCouriersByCity: protectedProcedure
    .input(z.object({ city: z.string(), district: z.string().optional() }))
    .query(({ input }) => {
      const couriers = input.district
        ? db.drivers.getCouriersByCityAndDistrict(input.city, input.district)
        : db.drivers.getCouriersByCity(input.city);
      console.log('[DRIVERS] Couriers in city:', input.city, 'district:', input.district ?? 'all', 'count:', couriers.length);
      return couriers.map(d => ({
        id: d.id,
        name: d.name,
        phone: d.phone,
        vehicleModel: d.vehicleModel,
        rating: d.rating,
        isOnline: d.isOnline,
        district: d.district,
      }));
    }),

  getOnlineCouriersByCity: protectedProcedure
    .input(z.object({ city: z.string(), district: z.string().optional() }))
    .query(({ input }) => {
      const couriers = input.district
        ? db.drivers.getOnlineCouriersByCityAndDistrict(input.city, input.district)
        : db.drivers.getOnlineCouriersByCity(input.city);
      console.log('[DRIVERS] Online couriers in city:', input.city, 'district:', input.district ?? 'all', 'count:', couriers.length);
      return couriers.map(d => {
        const loc = db.driverLocations.get(d.id);
        return {
          id: d.id,
          name: d.name,
          phone: d.phone,
          vehicleModel: d.vehicleModel,
          rating: d.rating,
          location: loc ?? null,
          district: d.district,
        };
      });
    }),

  getEarningsHistory: protectedProcedure
    .input(z.object({ driverId: z.string(), days: z.number().min(1).max(30).optional() }))
    .query(({ input, ctx }) => {
      if (!hasDriverAccess(ctx, input.driverId)) {
        return {
          history: [],
          dailyEarnings: 0,
          weeklyEarnings: 0,
          monthlyEarnings: 0,
          totalRides: 0,
          avgHoursPerDay: 0,
          weeklyGrowth: 0,
        };
      }

      const days = input.days ?? 7;
      const rides = db.rides.getByDriver(input.driverId);
      const now = new Date();
      const history: { date: string; label: string; amount: number; ridesCount: number }[] = [];
      const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const label = `${d.getDate()} ${months[d.getMonth()]}`;
        const dayRides = rides.filter((r: Ride) => {
          if (r.status !== 'completed') return false;
          const rDate = new Date(r.completedAt ?? r.createdAt).toISOString().split('T')[0];
          return rDate === dateStr;
        });
        const amount = dayRides.reduce((sum: number, r: Ride) => sum + (r.price ?? 0), 0);
        history.push({ date: dateStr, label, amount, ridesCount: dayRides.length });
      }

      const driver = db.drivers.get(input.driverId);
      const todayStr = now.toISOString().split('T')[0];
      rides.filter((r: Ride) => {
        if (r.status !== 'completed') return false;
        const rDate = new Date(r.completedAt ?? r.createdAt).toISOString().split('T')[0];
        return rDate === todayStr;
      });
      const avgHoursPerDay = history.length > 0
        ? (history.reduce((s, h) => s + h.ridesCount, 0) / history.length * 0.4)
        : 0;

      const prevWeekStart = new Date(now);
      prevWeekStart.setDate(prevWeekStart.getDate() - 14);
      const prevWeekEnd = new Date(now);
      prevWeekEnd.setDate(prevWeekEnd.getDate() - 7);
      const thisWeekEarnings = history.slice(-7).reduce((s, h) => s + h.amount, 0);
      const prevWeekRides = rides.filter((r: Ride) => {
        if (r.status !== 'completed') return false;
        const rDate = new Date(r.completedAt ?? r.createdAt);
        return rDate >= prevWeekStart && rDate < prevWeekEnd;
      });
      const prevWeekEarnings = prevWeekRides.reduce((s: number, r: Ride) => s + (r.price ?? 0), 0);
      const weeklyGrowth = prevWeekEarnings > 0
        ? Math.round(((thisWeekEarnings - prevWeekEarnings) / prevWeekEarnings) * 100)
        : (thisWeekEarnings > 0 ? 100 : 0);

      console.log('[DRIVERS] getEarningsHistory:', input.driverId, 'days:', days, 'entries:', history.length);
      return {
        history,
        dailyEarnings: driver?.dailyEarnings ?? 0,
        weeklyEarnings: driver?.weeklyEarnings ?? 0,
        monthlyEarnings: driver?.monthlyEarnings ?? 0,
        totalRides: driver?.totalRides ?? 0,
        avgHoursPerDay: Math.round(avgHoursPerDay * 10) / 10,
        weeklyGrowth,
      };
    }),

  getDriverStats: protectedProcedure
    .input(z.object({ driverId: z.string() }))
    .query(({ input, ctx }) => {
      if (!hasDriverAccess(ctx, input.driverId)) {
        return null;
      }

      const driver = db.drivers.get(input.driverId);
      if (!driver) return null;
      const rides = db.rides.getByDriver(input.driverId);
      const completed = rides.filter((r: Ride) => r.status === 'completed');
      const cancelled = rides.filter((r: Ride) => r.status === 'cancelled');
      const totalEarnings = completed.reduce((s: number, r: Ride) => s + (r.price ?? 0), 0);
      const avgRating = driver.rating;
      console.log('[DRIVERS] getDriverStats:', input.driverId, 'completed:', completed.length, 'cancelled:', cancelled.length);
      return {
        totalRides: driver.totalRides,
        completedRides: completed.length,
        cancelledRides: cancelled.length,
        totalEarnings,
        avgRating,
        dailyEarnings: driver.dailyEarnings,
        weeklyEarnings: driver.weeklyEarnings,
        monthlyEarnings: driver.monthlyEarnings,
      };
    }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        driverId: z.string(),
        name: z.string().optional(),
        phone: z.string().optional(),
        vehiclePlate: z.string().optional(),
        vehicleModel: z.string().optional(),
        vehicleColor: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.userType !== 'driver' || ctx.userId !== input.driverId) {
        return { success: false, error: 'Bu işlem için yetkiniz yok' };
      }

      const driver = db.drivers.get(input.driverId);
      if (!driver) {
        return { success: false, error: 'Şoför bulunamadı' };
      }

      const sanitizedPhone = input.phone ? normalizeTurkishPhone(sanitizeInput(input.phone)) : undefined;
      if (input.phone) {
        const phoneValidationError = getTurkishPhoneValidationError(sanitizedPhone);
        if (phoneValidationError) {
          return { success: false, error: phoneValidationError };
        }
      }

      if (sanitizedPhone && isPhoneTakenByAnotherAccount(sanitizedPhone, input.driverId)) {
        return { success: false, error: 'Bu telefon numarası başka bir hesapta kullanılıyor' };
      }

      const updated = {
        ...driver,
        ...(input.name && { name: sanitizeInput(input.name) }),
        ...(sanitizedPhone && { phone: sanitizedPhone }),
        ...(input.vehiclePlate && { vehiclePlate: sanitizeInput(input.vehiclePlate) }),
        ...(input.vehicleModel && { vehicleModel: sanitizeInput(input.vehicleModel) }),
        ...(input.vehicleColor && { vehicleColor: sanitizeInput(input.vehicleColor) }),
      };

      await db.drivers.setSync(input.driverId, updated);

      if (sanitizedPhone) {
        const ownedBusiness = db.businesses.getByOwner(input.driverId);
        if (ownedBusiness) {
          const syncedBusiness = {
            ...ownedBusiness,
            phone: sanitizedPhone,
            updatedAt: new Date().toISOString(),
          };
          await db.businesses.setSync(ownedBusiness.id, syncedBusiness);
          console.log('[DRIVERS] Synced business phone after profile update:', ownedBusiness.id, sanitizedPhone);
        }
      }

      console.log('[DRIVERS] Updated profile:', input.driverId, updated.phone);
      return { success: true, driver: updated };
    }),
});
