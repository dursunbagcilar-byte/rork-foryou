import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../create-context";
import { db } from "../../db/store";

export const scheduledRidesRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        date: z.string(),
        time: z.string(),
        pickup: z.string(),
        dropoff: z.string().optional(),
        vehicleType: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const id = "sr_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      const ride = {
        id,
        userId: input.userId,
        date: input.date,
        time: input.time,
        pickup: input.pickup,
        dropoff: input.dropoff ?? "Hedef belirlenecek",
        vehicleType: input.vehicleType ?? "Otomobil",
        status: "scheduled" as const,
        createdAt: new Date().toISOString(),
      };

      db.scheduledRides.set(id, ride);
      console.log("[SCHEDULED-RIDES] Created:", id, "for user:", input.userId, "date:", input.date, input.time);
      return { success: true, ride };
    }),

  getByUser: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(({ input }) => {
      const rides = db.scheduledRides.getByUser(input.userId);
      console.log("[SCHEDULED-RIDES] getByUser:", input.userId, "count:", rides.length);
      return rides;
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.string(), userId: z.string() }))
    .mutation(({ input }) => {
      const ride = db.scheduledRides.get(input.id);
      if (!ride) {
        return { success: false, error: "Zamanlanmış yolculuk bulunamadı" };
      }
      if (ride.userId !== input.userId) {
        return { success: false, error: "Bu yolculuğu iptal etme yetkiniz yok" };
      }
      db.scheduledRides.cancel(input.id);
      console.log("[SCHEDULED-RIDES] Cancelled:", input.id);
      return { success: true };
    }),
});
