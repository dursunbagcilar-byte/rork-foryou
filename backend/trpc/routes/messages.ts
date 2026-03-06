import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../create-context";
import { db } from "../../db/store";

async function sendPushToUser(userId: string, title: string, body: string, data?: Record<string, string>): Promise<void> {
  const tokenData = db.pushTokens.get(userId);
  if (!tokenData) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
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
    .mutation(async ({ input }) => {
      const id = "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
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
      console.log("[MESSAGES] New message in ride:", input.rideId, "from:", input.senderName);

      const ride = db.rides.get(input.rideId);
      if (ride) {
        const recipientId = input.senderType === "customer" ? ride.driverId : ride.customerId;
        if (recipientId) {
          sendPushToUser(
            recipientId,
            `💬 ${input.senderName}`,
            input.text.length > 100 ? input.text.substring(0, 100) + '...' : input.text,
            { type: 'new_message', rideId: input.rideId, messageId: id }
          );
        }
      }

      return { success: true, message };
    }),

  getByRide: protectedProcedure
    .input(z.object({ rideId: z.string() }))
    .query(({ input }) => {
      const messages = db.messages.getByRide(input.rideId);
      console.log("[MESSAGES] getByRide:", input.rideId, "count:", messages.length);
      return messages;
    }),

  getUnreadCount: protectedProcedure
    .input(z.object({ userId: z.string(), rideId: z.string() }))
    .query(({ input }) => {
      const messages = db.messages.getByRide(input.rideId);
      const lastReadKey = `lastRead_${input.rideId}_${input.userId}`;
      const lastReadAt = db.messageReadStatus.get(lastReadKey);
      const unread = messages.filter(m => {
        if (m.senderId === input.userId) return false;
        if (lastReadAt && new Date(m.createdAt).getTime() <= new Date(lastReadAt).getTime()) return false;
        return true;
      });
      return { count: unread.length };
    }),

  markAsRead: protectedProcedure
    .input(z.object({ userId: z.string(), rideId: z.string() }))
    .mutation(({ input }) => {
      const lastReadKey = `lastRead_${input.rideId}_${input.userId}`;
      db.messageReadStatus.set(lastReadKey, new Date().toISOString());
      console.log("[MESSAGES] Marked as read:", input.rideId, "for user:", input.userId);
      return { success: true };
    }),

  getActiveChats: protectedProcedure
    .input(z.object({ userId: z.string(), userType: z.enum(["customer", "driver"]) }))
    .query(({ input }) => {
      const allRides = db.rides.getAll();
      const activeRides = allRides.filter(r => {
        const isParticipant = input.userType === "customer"
          ? r.customerId === input.userId
          : r.driverId === input.userId;
        return isParticipant && ["accepted", "in_progress"].includes(r.status);
      });

      const chats = activeRides.map(ride => {
        const messages = db.messages.getByRide(ride.id);
        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        const otherName = input.userType === "customer" ? ride.driverName : ride.customerName;
        const otherId = input.userType === "customer" ? ride.driverId : ride.customerId;

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

      chats.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      console.log("[MESSAGES] getActiveChats:", input.userId, "chats:", chats.length);
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
    .mutation(async ({ input }) => {
      const quickMessages: Record<string, string> = {
        on_my_way: "Yoldayım, birazdan orada olacağım.",
        arrived: "Geldim, sizi bekliyorum.",
        waiting: "Bekliyorum, lütfen acele edin.",
        running_late: "Biraz gecikiyorum, özür dilerim.",
        cancel_request: "Yolculuğu iptal etmek istiyorum.",
        thanks: "Teşekkür ederim, iyi yolculuklar!",
      };

      const text = quickMessages[input.quickMessageType] ?? input.quickMessageType;
      const id = "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
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
      console.log("[MESSAGES] Quick message:", input.quickMessageType, "in ride:", input.rideId);

      const ride = db.rides.get(input.rideId);
      if (ride) {
        const recipientId = input.senderType === "customer" ? ride.driverId : ride.customerId;
        if (recipientId) {
          sendPushToUser(recipientId, `💬 ${input.senderName}`, text, { type: 'new_message', rideId: input.rideId, messageId: id });
        }
      }

      return { success: true, message };
    }),
});
