import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../create-context";
import { db } from "../../db/store";

export const ratingsRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        rideId: z.string(),
        customerId: z.string(),
        driverId: z.string(),
        stars: z.number().min(1).max(5),
        comment: z.string(),
      })
    )
    .mutation(({ input }) => {
      const existing = db.ratings.getByRide(input.rideId);
      if (existing) {
        return { success: false, error: "Bu yolculuk zaten değerlendirilmiş" };
      }

      const id = "rt_" + Date.now();
      const rating = {
        id,
        rideId: input.rideId,
        customerId: input.customerId,
        driverId: input.driverId,
        stars: input.stars,
        comment: input.comment,
        createdAt: new Date().toISOString(),
      };

      db.ratings.set(id, rating);

      const driverRatings = db.ratings.getByDriver(input.driverId);
      const avgRating =
        driverRatings.reduce((sum, r) => sum + r.stars, 0) / driverRatings.length;

      const driver = db.drivers.get(input.driverId);
      if (driver) {
        db.drivers.set(input.driverId, {
          ...driver,
          rating: Math.round(avgRating * 10) / 10,
        });
      }

      console.log("[RATINGS] Created rating:", id, "stars:", input.stars);
      return { success: true, rating };
    }),

  getByRide: protectedProcedure
    .input(z.object({ rideId: z.string() }))
    .query(({ input }) => {
      return db.ratings.getByRide(input.rideId) ?? null;
    }),

  getByDriver: protectedProcedure
    .input(z.object({ driverId: z.string() }))
    .query(({ input }) => {
      return db.ratings.getByDriver(input.driverId);
    }),
});
