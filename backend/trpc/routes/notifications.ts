import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../create-context";
import { db } from "../../db/store";

interface PushMessage {
  to: string;
  sound: string;
  title: string;
  body: string;
  data: Record<string, string>;
  priority: string;
  channelId: string;
}

const pushQueue: PushMessage[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_FLUSH_INTERVAL = 500;
const MAX_BATCH_SIZE = 100;

async function flushPushQueue(): Promise<void> {
  if (pushQueue.length === 0) return;
  const batch = pushQueue.splice(0, MAX_BATCH_SIZE);
  console.log('[PUSH] Flushing batch of', batch.length, 'notifications');
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
    });
    const result = await response.json();
    const tickets = result.data ?? (Array.isArray(result) ? result : [result]);
    let successCount = 0;
    let errorCount = 0;
    if (Array.isArray(tickets)) {
      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          errorCount++;
          console.log('[PUSH] Ticket error:', ticket.message, ticket.details?.error);
          if (ticket.details?.error === 'DeviceNotRegistered') {
            const msg = batch.find(m => m.to === ticket.to);
            if (msg) {
              const allTokens = db.pushTokens.getAll();
              const staleToken = allTokens.find(t => t.token === msg.to);
              if (staleToken) {
                db.pushTokens.delete(staleToken.userId);
                console.log('[PUSH] Removed stale token for user:', staleToken.userId);
              }
            }
          }
        } else {
          successCount++;
        }
      }
    }
    console.log('[PUSH] Batch result: success:', successCount, 'errors:', errorCount);
  } catch (err) {
    console.log('[PUSH] Batch send error:', err);
  }
  if (pushQueue.length > 0) {
    await flushPushQueue();
  }
}

function schedulePushFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPushQueue().catch(err => console.log('[PUSH] Flush error:', err));
  }, BATCH_FLUSH_INTERVAL);
}

async function sendExpoPush(pushToken: string, title: string, body: string, data?: Record<string, string>): Promise<boolean> {
  pushQueue.push({
    to: pushToken,
    sound: 'default',
    title,
    body,
    data: data ?? {},
    priority: 'high',
    channelId: 'default',
  });
  schedulePushFlush();
  console.log('[PUSH] Queued notification, queue size:', pushQueue.length);
  return true;
}

async function sendPushToUser(userId: string, title: string, body: string, data?: Record<string, string>): Promise<boolean> {
  const tokenData = db.pushTokens.get(userId);
  if (!tokenData) {
    console.log('[PUSH] No push token found for user:', userId);
    return false;
  }
  console.log('[PUSH] Sending to user:', userId, 'token:', tokenData.token.substring(0, 25) + '...');
  return sendExpoPush(tokenData.token, title, body, data);
}

async function sendPushToMultipleUsers(userIds: string[], title: string, body: string, data?: Record<string, string>): Promise<number> {
  let sentCount = 0;
  for (const userId of userIds) {
    const sent = await sendPushToUser(userId, title, body, data);
    if (sent) sentCount++;
  }
  console.log('[PUSH] Sent to', sentCount, '/', userIds.length, 'users');
  return sentCount;
}

export const notificationsRouter = createTRPCRouter({
  registerPushToken: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        token: z.string(),
        platform: z.enum(["ios", "android", "web"]),
      })
    )
    .mutation(({ input }) => {
      db.pushTokens.set(input.userId, {
        userId: input.userId,
        token: input.token,
        platform: input.platform,
        createdAt: new Date().toISOString(),
      });
      console.log("[NOTIFICATIONS] Push token registered for:", input.userId, "platform:", input.platform);
      return { success: true };
    }),

  removePushToken: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(({ input }) => {
      db.pushTokens.delete(input.userId);
      console.log("[NOTIFICATIONS] Push token removed for:", input.userId);
      return { success: true };
    }),

  send: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        title: z.string(),
        body: z.string(),
        data: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = "notif_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      const notification = {
        id,
        userId: input.userId,
        title: input.title,
        body: input.body,
        data: input.data,
        read: false,
        createdAt: new Date().toISOString(),
      };
      db.notifications.set(id, notification);
      console.log("[NOTIFICATIONS] Notification created:", id, "for user:", input.userId);

      const pushSent = await sendPushToUser(input.userId, input.title, input.body, input.data);
      console.log("[NOTIFICATIONS] Push sent:", pushSent, "for user:", input.userId);

      return { success: true, notification, pushSent };
    }),

  sendToUser: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        title: z.string(),
        body: z.string(),
        data: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = "notif_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      const notification = {
        id,
        userId: input.userId,
        title: input.title,
        body: input.body,
        data: input.data,
        read: false,
        createdAt: new Date().toISOString(),
      };
      db.notifications.set(id, notification);

      const pushSent = await sendPushToUser(input.userId, input.title, input.body, input.data);
      return { success: true, notification, pushSent };
    }),

  getByUser: protectedProcedure
    .input(z.object({
      userId: z.string(),
      page: z.number().min(1).optional(),
      limit: z.number().min(1).max(50).optional(),
    }))
    .query(({ input }) => {
      const page = input.page ?? 1;
      const limit = input.limit ?? 30;
      const all = db.notifications.getByUser(input.userId);
      const total = all.length;
      const offset = (page - 1) * limit;
      const paginated = all.slice(offset, offset + limit);
      console.log('[NOTIFICATIONS] getByUser:', input.userId, 'page:', page, 'total:', total, 'returned:', paginated.length);
      return {
        notifications: paginated,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + limit < total,
      };
    }),

  markRead: protectedProcedure
    .input(z.object({ notificationId: z.string() }))
    .mutation(({ input }) => {
      db.notifications.markRead(input.notificationId);
      return { success: true };
    }),

  getUnreadCount: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(({ input }) => {
      const notifications = db.notifications.getByUser(input.userId);
      return { count: notifications.filter(n => !n.read).length };
    }),

  broadcastToCity: protectedProcedure
    .input(
      z.object({
        city: z.string(),
        title: z.string(),
        body: z.string(),
        data: z.record(z.string(), z.string()).optional(),
        targetType: z.enum(["drivers", "customers", "all"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const targetType = input.targetType ?? "all";
      const userIds: string[] = [];

      if (targetType === "drivers" || targetType === "all") {
        const drivers = db.drivers.getOnlineByCity(input.city);
        userIds.push(...drivers.map(d => d.id));
      }

      if (targetType === "customers" || targetType === "all") {
        const allUsers = db.users.getAll();
        const cityUsers = allUsers.filter(u => u.city === input.city);
        userIds.push(...cityUsers.map(u => u.id));
      }

      const uniqueUserIds = [...new Set(userIds)];
      const sentCount = await sendPushToMultipleUsers(uniqueUserIds, input.title, input.body, input.data);
      console.log('[NOTIFICATIONS] Broadcast to', input.city, 'target:', targetType, 'sent:', sentCount, 'total targeted:', uniqueUserIds.length);
      return { success: true, sentCount, totalTargeted: uniqueUserIds.length };
    }),

  sendProximityAlert: protectedProcedure
    .input(
      z.object({
        customerId: z.string(),
        driverName: z.string(),
        etaMinutes: z.number(),
        rideId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const title = input.etaMinutes <= 1
        ? '📍 Şoförünüz Geldi!'
        : `🚗 Şoför ${input.etaMinutes} dk Uzakta`;
      const body = input.etaMinutes <= 1
        ? `${input.driverName} konumunuza ulaştı!`
        : `${input.driverName} yaklaşık ${input.etaMinutes} dakika içinde gelecek.`;

      const id = "notif_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      const notification = {
        id,
        userId: input.customerId,
        title,
        body,
        data: { type: 'proximity_alert', rideId: input.rideId, eta: String(input.etaMinutes) },
        read: false,
        createdAt: new Date().toISOString(),
      };
      db.notifications.set(id, notification);

      const pushSent = await sendPushToUser(input.customerId, title, body, { type: 'proximity_alert', rideId: input.rideId });
      console.log('[NOTIFICATIONS] Proximity alert sent to', input.customerId, 'eta:', input.etaMinutes, 'push:', pushSent);
      return { success: true, pushSent };
    }),
});
