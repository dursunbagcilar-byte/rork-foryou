import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "../create-context";
import { db } from "../../db/store";

export const adminRouter = createTRPCRouter({
  approveDriver: adminProcedure
    .input(z.object({ driverId: z.string() }))
    .mutation(async ({ input }) => {
      const driver = db.drivers.get(input.driverId);
      if (!driver) return { success: false, error: "Şoför bulunamadı" };

      const updated = {
        ...driver,
        isApproved: true,
        approvedAt: new Date().toISOString(),
        isSuspended: false,
      };

      await db.drivers.setSync(input.driverId, updated);
      console.log("[ADMIN] Driver approved:", input.driverId, driver.name);
      return { success: true, driver: updated };
    }),

  suspendDriver: adminProcedure
    .input(z.object({ driverId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const driver = db.drivers.get(input.driverId);
      if (!driver) return { success: false, error: "Şoför bulunamadı" };

      const updated = {
        ...driver,
        isSuspended: true,
        isOnline: false,
      };

      await db.drivers.setSync(input.driverId, updated);
      console.log("[ADMIN] Driver suspended:", input.driverId, driver.name, "reason:", input.reason);
      return { success: true, driver: updated };
    }),

  unsuspendDriver: adminProcedure
    .input(z.object({ driverId: z.string() }))
    .mutation(async ({ input }) => {
      const driver = db.drivers.get(input.driverId);
      if (!driver) return { success: false, error: "Şoför bulunamadı" };

      const updated = {
        ...driver,
        isSuspended: false,
      };

      await db.drivers.setSync(input.driverId, updated);
      console.log("[ADMIN] Driver unsuspended:", input.driverId, driver.name);
      return { success: true, driver: updated };
    }),

  rejectDriver: adminProcedure
    .input(z.object({ driverId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const driver = db.drivers.get(input.driverId);
      if (!driver) return { success: false, error: "Şoför bulunamadı" };

      const updated = {
        ...driver,
        isApproved: false,
      };

      await db.drivers.setSync(input.driverId, updated);
      console.log("[ADMIN] Driver rejected:", input.driverId, driver.name, "reason:", input.reason);
      return { success: true, driver: updated };
    }),

  getAllDrivers: adminProcedure
    .query(() => {
      const allDrivers = db.drivers.getAll();
      console.log("[ADMIN] getAllDrivers:", allDrivers.length);
      return allDrivers.map(d => ({
        id: d.id,
        name: d.name,
        email: d.email,
        phone: d.phone,
        city: d.city,
        district: d.district,
        vehiclePlate: d.vehiclePlate,
        vehicleModel: d.vehicleModel,
        vehicleColor: d.vehicleColor,
        driverCategory: d.driverCategory,
        rating: d.rating,
        totalRides: d.totalRides,
        isOnline: d.isOnline,
        isApproved: d.isApproved ?? false,
        isSuspended: d.isSuspended ?? false,
        approvedAt: d.approvedAt,
        createdAt: d.createdAt,
        dailyEarnings: d.dailyEarnings,
        weeklyEarnings: d.weeklyEarnings,
        monthlyEarnings: d.monthlyEarnings,
      }));
    }),

  getPendingDrivers: adminProcedure
    .query(() => {
      const allDrivers = db.drivers.getAll();
      const pending = allDrivers.filter(d => !d.isApproved && !d.isSuspended);
      console.log("[ADMIN] getPendingDrivers:", pending.length);
      return pending.map(d => ({
        id: d.id,
        name: d.name,
        email: d.email,
        phone: d.phone,
        city: d.city,
        district: d.district,
        vehiclePlate: d.vehiclePlate,
        vehicleModel: d.vehicleModel,
        driverCategory: d.driverCategory,
        createdAt: d.createdAt,
      }));
    }),

  getAllCustomers: adminProcedure
    .query(() => {
      const allUsers = db.users.getAll();
      console.log("[ADMIN] getAllCustomers:", allUsers.length);
      return allUsers.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        city: u.city,
        district: u.district,
        gender: u.gender,
        createdAt: u.createdAt,
      }));
    }),

  deleteCustomer: adminProcedure
    .input(z.object({ customerId: z.string() }))
    .mutation(({ input }) => {
      const user = db.users.get(input.customerId);
      if (!user) return { success: false, error: "Kullanıcı bulunamadı" };

      db.users.delete(input.customerId);
      console.log("[ADMIN] Customer deleted:", input.customerId, user.name);
      return { success: true };
    }),

  deleteDriver: adminProcedure
    .input(z.object({ driverId: z.string() }))
    .mutation(({ input }) => {
      const driver = db.drivers.get(input.driverId);
      if (!driver) return { success: false, error: "Şoför bulunamadı" };

      db.drivers.delete(input.driverId);
      console.log("[ADMIN] Driver deleted:", input.driverId, driver.name);
      return { success: true };
    }),

  getDriverDocuments: adminProcedure
    .input(z.object({ driverId: z.string() }))
    .query(({ input }) => {
      const docs = db.driverDocuments.get(input.driverId);
      console.log("[ADMIN] getDriverDocuments:", input.driverId, docs ? "found" : "not found");
      return docs ?? null;
    }),

  getDashboardStats: adminProcedure
    .query(() => {
      const allUsers = db.users.getAll();
      const allDrivers = db.drivers.getAll();
      const allRides = db.rides.getAll();
      const allRatings = db.ratings.getAll();

      const onlineDrivers = allDrivers.filter(d => d.isOnline);
      const approvedDrivers = allDrivers.filter(d => d.isApproved);
      const suspendedDrivers = allDrivers.filter(d => d.isSuspended);
      const pendingDrivers = allDrivers.filter(d => !d.isApproved && !d.isSuspended);

      const completedRides = allRides.filter(r => r.status === "completed");
      const cancelledRides = allRides.filter(r => r.status === "cancelled");
      const activeRides = allRides.filter(r => ["pending", "accepted", "in_progress"].includes(r.status));
      const totalRevenue = completedRides.reduce((s, r) => s + (r.price ?? 0), 0);

      const today = new Date().toISOString().split("T")[0];
      const todayRides = completedRides.filter(r => {
        const rDate = new Date(r.completedAt ?? r.createdAt).toISOString().split("T")[0];
        return rDate === today;
      });
      const todayRevenue = todayRides.reduce((s, r) => s + (r.price ?? 0), 0);

      console.log("[ADMIN] getDashboardStats: users:", allUsers.length, "drivers:", allDrivers.length, "rides:", allRides.length);

      return {
        totalCustomers: allUsers.length,
        totalDrivers: allDrivers.length,
        onlineDrivers: onlineDrivers.length,
        approvedDrivers: approvedDrivers.length,
        suspendedDrivers: suspendedDrivers.length,
        pendingDrivers: pendingDrivers.length,
        totalRides: allRides.length,
        completedRides: completedRides.length,
        cancelledRides: cancelledRides.length,
        activeRides: activeRides.length,
        totalRevenue,
        todayRevenue,
        todayRides: todayRides.length,
        totalRatings: allRatings.length,
      };
    }),

  getAllRides: adminProcedure
    .input(z.object({
      page: z.number().min(1).optional(),
      limit: z.number().min(1).max(100).optional(),
      status: z.enum(["pending", "accepted", "in_progress", "completed", "cancelled"]).optional(),
    }))
    .query(({ input }) => {
      const page = input.page ?? 1;
      const limit = input.limit ?? 20;
      let allRides = db.rides.getAll()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      if (input.status) {
        allRides = allRides.filter(r => r.status === input.status);
      }

      const total = allRides.length;
      const offset = (page - 1) * limit;
      const paginated = allRides.slice(offset, offset + limit);

      console.log("[ADMIN] getAllRides: page:", page, "total:", total, "returned:", paginated.length);
      return {
        rides: paginated,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + limit < total,
      };
    }),
});
