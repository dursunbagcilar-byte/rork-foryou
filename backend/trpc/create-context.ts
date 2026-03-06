import { initTRPC } from "@trpc/server";
import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { db } from "../db/store";

export const createContext = async (opts: FetchCreateContextFnOptions) => {
  const authHeader = opts.req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "") || null;

  let userId: string | null = null;
  let userType: "customer" | "driver" | null = null;
  let isAdmin = false;

  if (token && token.length > 4) {
    const session = db.sessions.get(token);
    if (session) {
      const isExpired = new Date(session.expiresAt).getTime() < Date.now();
      if (!isExpired) {
        userId = session.userId;
        userType = session.userType;
        if (session.userType === 'driver') {
          const driver = db.drivers.get(session.userId);
          if (driver && driver.email) {
            const adminEmail = process.env.ADMIN_EMAIL || 'admin@2go.app';
            isAdmin = driver.email.toLowerCase() === adminEmail.toLowerCase();
          }
        }
      } else {
        db.sessions.delete(token);
        console.log('[CONTEXT] Session expired for token, cleaned up');
      }
    }
  }

  return {
    req: opts.req,
    userId,
    userType,
    isAdmin,
    token,
  };
};

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    console.log('[AUTH-MW] Unauthorized request - no valid session');
    throw new Error("Unauthorized - Geçersiz oturum");
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
      userType: ctx.userType,
      isAdmin: ctx.isAdmin,
    },
  });
});

export const adminProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    console.log('[AUTH-MW] Admin: Unauthorized request - no valid session');
    throw new Error("Unauthorized - Geçersiz oturum");
  }
  if (!ctx.isAdmin) {
    console.log('[AUTH-MW] Admin: Forbidden - user is not admin:', ctx.userId);
    throw new Error("Forbidden - Yönetici yetkisi gerekli");
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
      userType: ctx.userType,
      isAdmin: true,
    },
  });
});
