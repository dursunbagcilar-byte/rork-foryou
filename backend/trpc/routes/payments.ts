import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../create-context";
import { initializeCheckoutForm, retrieveCheckoutFormResult, isIyzicoConfigured } from "../../utils/iyzico";
import { db } from "../../db/store";

export const paymentsRouter = createTRPCRouter({
  checkConfig: publicProcedure.query(() => {
    const configured = isIyzicoConfigured();
    console.log('[PAYMENTS] iyzico configured:', configured);
    return { configured };
  }),

  initializePayment: protectedProcedure
    .input(
      z.object({
        rideId: z.string(),
        customerId: z.string(),
        customerName: z.string(),
        customerEmail: z.string(),
        customerPhone: z.string(),
        customerCity: z.string(),
        customerIdentityNumber: z.string().optional(),
        price: z.number(),
        callbackUrl: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      console.log('[PAYMENTS] Initializing payment for ride:', input.rideId, 'price:', input.price);

      if (!isIyzicoConfigured()) {
        console.log('[PAYMENTS] iyzico not configured, returning error');
        return { success: false, error: 'iyzico yapılandırılmamış' };
      }

      const nameParts = input.customerName.trim().split(' ');
      const firstName = nameParts[0] || 'Müşteri';
      const surname = nameParts.slice(1).join(' ') || 'Kullanıcı';
      const conversationId = `ride_${input.rideId}_${Date.now()}`;
      const priceStr = input.price.toFixed(2);

      try {
        const result = await initializeCheckoutForm({
          locale: 'tr',
          conversationId,
          price: priceStr,
          paidPrice: priceStr,
          currency: 'TRY',
          basketId: input.rideId,
          paymentGroup: 'PRODUCT',
          callbackUrl: input.callbackUrl,
          buyer: {
            id: input.customerId,
            name: firstName,
            surname: surname,
            gsmNumber: input.customerPhone.replace(/\s/g, ''),
            email: input.customerEmail || 'musteri@app.com',
            identityNumber: input.customerIdentityNumber || '00000000000',
            registrationAddress: input.customerCity + ', Türkiye',
            ip: '85.34.78.112',
            city: input.customerCity,
            country: 'Turkey',
          },
          shippingAddress: {
            contactName: input.customerName,
            city: input.customerCity,
            country: 'Turkey',
            address: input.customerCity + ', Türkiye',
          },
          billingAddress: {
            contactName: input.customerName,
            city: input.customerCity,
            country: 'Turkey',
            address: input.customerCity + ', Türkiye',
          },
          basketItems: [
            {
              id: input.rideId,
              name: 'Yolculuk Ücreti',
              category1: 'Ulaşım',
              itemType: 'VIRTUAL',
              price: priceStr,
            },
          ],
        });

        if (result.status === 'success' && result.token) {
          db.payments.set(result.token, {
            token: result.token,
            rideId: input.rideId,
            customerId: input.customerId,
            conversationId,
            amount: input.price,
            status: 'pending',
            createdAt: new Date().toISOString(),
          });

          console.log('[PAYMENTS] Payment initialized successfully, token:', result.token.substring(0, 20) + '...');
          return {
            success: true,
            token: result.token,
            checkoutFormContent: result.checkoutFormContent,
            paymentPageUrl: result.paymentPageUrl,
          };
        }

        console.log('[PAYMENTS] Payment initialization failed:', result.errorMessage);
        return { success: false, error: result.errorMessage || 'Ödeme başlatılamadı' };
      } catch (err) {
        console.log('[PAYMENTS] Payment error:', err);
        return { success: false, error: 'Ödeme servisi hatası' };
      }
    }),

  verifyPayment: protectedProcedure
    .input(
      z.object({
        token: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      console.log('[PAYMENTS] Verifying payment, token:', input.token.substring(0, 20) + '...');

      const payment = db.payments.get(input.token);
      if (!payment) {
        console.log('[PAYMENTS] Payment not found');
        return { success: false, error: 'Ödeme bulunamadı' };
      }

      try {
        const result = await retrieveCheckoutFormResult(input.token, payment.conversationId);

        if (result.status === 'success' && result.paymentStatus === '1') {
          db.payments.set(input.token, {
            ...payment,
            status: 'completed',
            paymentId: result.paymentId,
          });

          const ride = db.rides.get(payment.rideId);
          if (ride) {
            db.rides.set(payment.rideId, {
              ...ride,
              paymentMethod: 'card',
              paymentStatus: 'paid',
            });
          }

          console.log('[PAYMENTS] Payment verified successfully, paymentId:', result.paymentId);
          return { success: true, paymentId: result.paymentId };
        }

        db.payments.set(input.token, { ...payment, status: 'failed' });
        console.log('[PAYMENTS] Payment verification failed:', result.errorMessage);
        return { success: false, error: result.errorMessage || 'Ödeme doğrulanamadı' };
      } catch (err) {
        console.log('[PAYMENTS] Verify error:', err);
        return { success: false, error: 'Doğrulama hatası' };
      }
    }),

  getPaymentStatus: protectedProcedure
    .input(z.object({ rideId: z.string() }))
    .query(({ input }) => {
      const payments = db.payments.getByRide(input.rideId);
      if (!payments) return null;
      return payments;
    }),
});
