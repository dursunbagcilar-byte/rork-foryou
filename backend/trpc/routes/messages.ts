import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../create-context";
import { db } from "../../db/store";
import type { Ride } from "../../db/types";

type ActorType = "customer" | "driver";

type ActorContext = {
  userId: string | null;
  userType: ActorType | null;
};

async function sendPushToUser(userId: string, title: string, body: string, data?: Record<string, string>): Promise<void> {
  const tokenData = db.pushTokens.get(userId);
  if (!tokenData) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: tokenData.token,
        sound: 'default',
        title,
        body,
        data: data ?? {},
        priority: 'high',
        channelId: 'messages',
      }),
    });
  } catch (err) {
    console.log('[MESSAGES-PUSH] Error:', err);
  }
}

function getRideForActor(ctx: ActorContext, rideId: string): Ride | null {
  if (!ctx.userId || !ctx.userType) {
    return null;
  }

  const ride = db.rides.get(rideId);
  if (!ride) {
    return null;
  }

  if (ctx.userType === 'customer' && ride.customerId === ctx.userId) {
    return ride;
  }

  if (ctx.userType === 'driver' && (ride.driverId === ctx.userId || ride.assignedCourierId === ctx.userId)) {
    return ride;
  }

  return null;
}

function getRideForMessageSender(ctx: ActorContext, rideId: string, senderId: string, senderType: ActorType): Ride | null {
  if (!ctx.userId || !ctx.userType) {
    return null;
  }

  if (ctx.userId !== senderId || ctx.userType !== senderType) {
    return null;
  }

  return getRideForActor(ctx, rideId);
}

function getRecipientId(ride: Ride, senderType: ActorType): string {
  return senderType === 'customer' ? ride.driverId : ride.customerId;
}

function canAccessRequestedUser(ctx: ActorContext, userId: string, userType: ActorType): boolean {
  return ctx.userId === userId && ctx.userType === userType;
}

export const messagesRouter = createTRPCRouter({
  send: protectedProcedure
    .input(
      z.object({
        rideId: z.string(),
        senderId: z.string(),
        senderName: z.string(),
        senderType: z.enum(["customer", "driver"]),
        text: z.string().min(1).max(1000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ride = getRideForMessageSender(ctx, input.rideId, input.senderId, input.senderType);
      if (!ride) {
        return { success: false, error: 'Bu konuşmaya mesaj gönderme yetkiniz yok', message: null };
      }

      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const message = {
        id,
        rideId: input.rideId,
        senderId: input.senderId,
        senderName: input.senderName,
        senderType: input.senderType,
        text: input.text,
        createdAt: new Date().toISOString(),
      };

      db.messages.addToRide(input.rideId, message);
      console.log('[MESSAGES] New message in ride:', input.rideId, 'from:', input.senderName);

      const recipientId = getRecipientId(ride, input.senderType);
      if (recipientId) {
        void sendPushToUser(
          recipientId,
          `💬 ${input.senderName}`,
          input.text.length > 100 ? `${input.text.substring(0, 100)}...` : input.text,
          { type: 'new_message', rideId: input.rideId, messageId: id }
        );
      }

      return { success: true, error: null, message };
    }),

  getByRide: protectedProcedure
    .input(z.object({ rideId: z.string() }))
    .query(({ input, ctx }) => {
      const ride = getRideForActor(ctx, input.rideId);
      if (!ride) {
        return [];
      }

      const messages = db.messages.getByRide(ride.id);
      console.log('[MESSAGES] getByRide:', input.rideId, 'count:', messages.length);
      return messages;
    }),

  getUnreadCount: protectedProcedure
    .input(z.object({ userId: z.string(), rideId: z.string() }))
    .query(({ input, ctx }) => {
      const ride = getRideForActor(ctx, input.rideId);
      if (!ride || ctx.userId !== input.userId) {
        return { count: 0 };
      }

      const messages = db.messages.getByRide(ride.id);
      const lastReadKey = `lastRead_${input.rideId}_${input.userId}`;
      const lastReadAt = db.messageReadStatus.get(lastReadKey);
      const unread = messages.filter((message) => {
        if (message.senderId === input.userId) return false;
        if (lastReadAt && new Date(message.createdAt).getTime() <= new Date(lastReadAt).getTime()) return false;
        return true;
      });
      return { count: unread.length };
    }),

  markAsRead: protectedProcedure
    .input(z.object({ userId: z.string(), rideId: z.string() }))
    .mutation(({ input, ctx }) => {
      const ride = getRideForActor(ctx, input.rideId);
      if (!ride || ctx.userId !== input.userId) {
        return { success: false, error: 'Bu konuşmayı güncelleme yetkiniz yok' };
      }

      const lastReadKey = `lastRead_${input.rideId}_${input.userId}`;
      db.messageReadStatus.set(lastReadKey, new Date().toISOString());
      console.log('[MESSAGES] Marked as read:', input.rideId, 'for user:', input.userId);
      return { success: true, error: null };
    }),

  getActiveChats: protectedProcedure
    .input(z.object({ userId: z.string(), userType: z.enum(["customer", "driver"]) }))
    .query(({ input, ctx }) => {
      if (!canAccessRequestedUser(ctx, input.userId, input.userType)) {
        return [];
      }

      const allRides = db.rides.getAll();
      const activeRides = allRides.filter((ride) => {
        const isParticipant = input.userType === 'customer'
          ? ride.customerId === input.userId
          : ride.driverId === input.userId || ride.assignedCourierId === input.userId;
        return isParticipant && ["accepted", "in_progress"].includes(ride.status);
      });

      const chats = activeRides.map((ride) => {
        const messages = db.messages.getByRide(ride.id);
        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        const otherName = input.userType === 'customer' ? ride.driverName : ride.customerName;
        const otherId = input.userType === 'customer' ? ride.driverId : ride.customerId;

        return {
          rideId: ride.id,
          otherName,
          otherId,
          pickupAddress: ride.pickupAddress,
          dropoffAddress: ride.dropoffAddress,
          rideStatus: ride.status,
          lastMessage: lastMessage?.text ?? null,
          lastMessageAt: lastMessage?.createdAt ?? ride.createdAt,
          lastMessageSenderType: lastMessage?.senderType ?? null,
          messageCount: messages.length,
        };
      });

      chats.sort((left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime());
      console.log('[MESSAGES] getActiveChats:', input.userId, 'chats:', chats.length);
      return chats;
    }),

  sendQuickMessage: protectedProcedure
    .input(
      z.object({
        rideId: z.string(),
        senderId: z.string(),
        senderName: z.string(),
        senderType: z.enum(["customer", "driver"]),
        quickMessageType: z.enum([
          "on_my_way",
          "arrived",
          "waiting",
          "running_late",
          "cancel_request",
          "thanks",
        ]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ride = getRideForMessageSender(ctx, input.rideId, input.senderId, input.senderType);
      if (!ride) {
        return { success: false, error: 'Bu konuşmaya mesaj gönderme yetkiniz yok', message: null };
      }

      const quickMessages: Record<string, string> = {
        on_my_way: 'Yoldayım, birazdan orada olacağım.',
        arrived: 'Geldim, sizi bekliyorum.',
        waiting: 'Bekliyorum, lütfen acele edin.',
        running_late: 'Biraz gecikiyorum, özür dilerim.',
        cancel_request: 'Yolculuğu iptal etmek istiyorum.',
        thanks: 'Teşekkür ederim, iyi yolculuklar!',
      };

      const text = quickMessages[input.quickMessageType] ?? input.quickMessageType;
      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const message = {
        id,
        rideId: input.rideId,
        senderId: input.senderId,
        senderName: input.senderName,
        senderType: input.senderType,
        text,
        createdAt: new Date().toISOString(),
      };

      db.messages.addToRide(input.rideId, message);
      console.log('[MESSAGES] Quick message:', input.quickMessageType, 'in ride:', input.rideId);

      const recipientId = getRecipientId(ride, input.senderType);
      if (recipientId) {
        void sendPushToUser(recipientId, `💬 ${input.senderName}`, text, { type: 'new_message', rideId: input.rideId, messageId: id });
      }

      return { success: true, error: null, message };
    }),
});
