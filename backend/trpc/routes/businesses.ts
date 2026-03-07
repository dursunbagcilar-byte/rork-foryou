import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../create-context";
import { db } from "../../db/store";
import { sanitizeInput } from "../../utils/security";
import type { Business, BusinessMenuItem } from "../../db/types";

function normalizeWebsite(url: string): string {
  const trimmed = sanitizeInput(url).trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function buildDefaultBusinessMenu(name: string, image: string, category: string): BusinessMenuItem[] {
  const categoryLabel = category || "İşletme";
  return [
    {
      id: `menu_${Date.now()}_standard`,
      name: `${categoryLabel} Standart Teslimat`,
      description: `${name} için standart kurye teslimat siparişi`,
      price: 120,
      image,
    },
    {
      id: `menu_${Date.now()}_express`,
      name: `${categoryLabel} Express Teslimat`,
      description: `${name} için öncelikli ve hızlı teslimat seçeneği`,
      price: 180,
      image,
    },
    {
      id: `menu_${Date.now()}_bulk`,
      name: `${categoryLabel} Toplu Sipariş`,
      description: `${name} için çoklu paket veya büyük sepet teslimatı`,
      price: 240,
      image,
    },
  ];
}

export const businessesRouter = createTRPCRouter({
  register: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(120),
        website: z.string().min(3).max(300),
        image: z.string().min(5).max(1000),
        description: z.string().max(400).optional(),
        category: z.string().min(2).max(80),
        address: z.string().min(5).max(240),
        city: z.string().min(1).max(100),
        district: z.string().min(1).max(100),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        phone: z.string().max(30).optional(),
        deliveryTime: z.string().max(40).optional(),
        deliveryFee: z.number().min(0).max(1000).optional(),
        minOrder: z.number().min(0).max(5000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.userType !== "driver" || !ctx.userId) {
        return { success: false, error: "Bu işlem için yetkiniz yok", business: null };
      }

      const ownerDriver = db.drivers.get(ctx.userId);
      if (!ownerDriver) {
        return { success: false, error: "Şoför hesabı bulunamadı", business: null };
      }

      const existing = db.businesses.getByOwner(ctx.userId);
      const now = new Date().toISOString();
      const businessId = existing?.id ?? `biz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const safeName = sanitizeInput(input.name);
      const safeImage = sanitizeInput(input.image);
      const safeCategory = sanitizeInput(input.category);

      const business: Business = {
        id: businessId,
        ownerDriverId: ctx.userId,
        name: safeName,
        website: normalizeWebsite(input.website),
        image: safeImage,
        description: sanitizeInput(input.description ?? "") || `${safeName} işletmesi 2GO üzerinde sipariş kabul ediyor.`,
        category: safeCategory,
        city: sanitizeInput(input.city),
        district: sanitizeInput(input.district),
        address: sanitizeInput(input.address),
        latitude: input.latitude,
        longitude: input.longitude,
        phone: sanitizeInput(input.phone ?? ownerDriver.phone),
        rating: existing?.rating ?? 4.8,
        reviewCount: existing?.reviewCount ?? 0,
        deliveryTime: sanitizeInput(input.deliveryTime ?? existing?.deliveryTime ?? "25-35 dk"),
        deliveryFee: input.deliveryFee ?? existing?.deliveryFee ?? 25,
        minOrder: input.minOrder ?? existing?.minOrder ?? 100,
        menu: existing?.menu?.length ? existing.menu : buildDefaultBusinessMenu(safeName, safeImage, safeCategory),
        isActive: true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      await db.businesses.setSync(businessId, business);
      console.log("[BUSINESSES] Business registered:", businessId, safeName, business.city, business.district);
      return { success: true, error: null, business };
    }),

  getMine: protectedProcedure.query(({ ctx }) => {
    if (ctx.userType !== "driver" || !ctx.userId) {
      return null;
    }
    return db.businesses.getByOwner(ctx.userId);
  }),

  listByCity: protectedProcedure
    .input(z.object({ city: z.string().min(1), district: z.string().optional() }))
    .query(({ input }) => {
      const businesses = db.businesses.getByCity(input.city, input.district).filter((business) => business.isActive);
      console.log("[BUSINESSES] listByCity:", input.city, input.district ?? "all", businesses.length);
      return businesses;
    }),
});
