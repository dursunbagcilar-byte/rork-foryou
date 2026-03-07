import { createTRPCRouter } from "./create-context";
import { authRouter } from "./routes/auth";
import { ridesRouter } from "./routes/rides";
import { ratingsRouter } from "./routes/ratings";
import { driversRouter } from "./routes/drivers";
import { messagesRouter } from "./routes/messages";
import { paymentsRouter } from "./routes/payments";
import { notificationsRouter } from "./routes/notifications";
import { adminRouter } from "./routes/admin";
import { scheduledRidesRouter } from "./routes/scheduled-rides";
import { businessesRouter } from "./routes/businesses";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  rides: ridesRouter,
  ratings: ratingsRouter,
  drivers: driversRouter,
  messages: messagesRouter,
  payments: paymentsRouter,
  notifications: notificationsRouter,
  admin: adminRouter,
  scheduledRides: scheduledRidesRouter,
  businesses: businessesRouter,
});

export type AppRouter = typeof appRouter;
