import { initTRPC } from "@trpc/server";
import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { bootstrapDbConfig, db, forceReloadStore, initializeStore } from "../db/store";
import { dbGet, getCachedDbConfig, isDbConfigured, setDbConfig } from "../db/rork-db";
import type { Driver, Session, User } from "../db/types";

function buildSessionRecordId(token: string): string {
  return token.replace(/[^a-zA-Z0-9]/g, "_");
}

let _dbBootstrapPromise: Promise<void> | null = null;
let _lastDbBootstrapAt = 0;

function readServerEnv(key: string): string {
  try {
    const bunEnv = (globalThis as any).Bun?.env as Record<string, string | undefined> | undefined;
    if (typeof bunEnv?.[key] === "string") {
      return bunEnv[key]?.trim() ?? "";
    }
  } catch (error) {
    console.log("[CONTEXT] Bun.env read error:", key, error);
  }

  try {
    if (typeof process !== "undefined" && typeof process.env?.[key] === "string") {
      return process.env[key]?.trim() ?? "";
    }
  } catch (error) {
    console.log("[CONTEXT] process.env read error:", key, error);
  }

  try {
    const d = (globalThis as any).Deno;
    if (d?.env?.get) {
      const value = d.env.get(key);
      return typeof value === "string" ? value.trim() : "";
    }
  } catch (error) {
    console.log("[CONTEXT] Deno.env read error:", key, error);
  }

  return "";
}

function isValidDbUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveDbConfigFromRequest(req: Request): { endpoint: string; namespace: string; token: string } | null {
  const cachedConfig = getCachedDbConfig();
  const endpoint = req.headers.get("x-db-endpoint")?.trim()
    || readServerEnv("EXPO_PUBLIC_RORK_DB_ENDPOINT")
    || readServerEnv("RORK_DB_ENDPOINT")
    || cachedConfig?.endpoint
    || "";
  const namespace = req.headers.get("x-db-namespace")?.trim()
    || readServerEnv("EXPO_PUBLIC_RORK_DB_NAMESPACE")
    || readServerEnv("RORK_DB_NAMESPACE")
    || cachedConfig?.namespace
    || "";
  const token = req.headers.get("x-db-token")?.trim()
    || readServerEnv("EXPO_PUBLIC_RORK_DB_TOKEN")
    || readServerEnv("RORK_DB_TOKEN")
    || cachedConfig?.token
    || "";

  if (!endpoint || !namespace || !token) {
    console.log("[CONTEXT] DB config missing for tRPC request", {
      hasEndpoint: !!endpoint,
      hasNamespace: !!namespace,
      hasToken: !!token,
    });
    return null;
  }

  if (!isValidDbUrl(endpoint)) {
    console.log("[CONTEXT] Ignoring invalid DB endpoint for tRPC request:", endpoint);
    return null;
  }

  return { endpoint, namespace, token };
}

async function ensureDbReadyForTrpc(req: Request): Promise<void> {
  const dbConfig = resolveDbConfigFromRequest(req);
  if (!dbConfig) {
    await initializeStore();
    return;
  }

  const now = Date.now();
  const hasLoadedAccounts = db.users.getAll().length > 0 || db.drivers.getAll().length > 0;

  if (_dbBootstrapPromise) {
    await _dbBootstrapPromise;
    return;
  }

  if (hasLoadedAccounts && now - _lastDbBootstrapAt < 15000) {
    return;
  }

  _dbBootstrapPromise = (async () => {
    const hadConfig = isDbConfigured();

    try {
      setDbConfig(dbConfig.endpoint, dbConfig.namespace, dbConfig.token);

      if (!hadConfig) {
        console.log("[CONTEXT] Bootstrapping DB config for tRPC request...");
        await bootstrapDbConfig(dbConfig.endpoint, dbConfig.namespace, dbConfig.token);
      } else {
        await initializeStore();
      }

      if (db.users.getAll().length === 0 && db.drivers.getAll().length === 0) {
        console.log("[CONTEXT] No accounts loaded in memory for tRPC, forcing store reload...");
        await forceReloadStore();
      }

      _lastDbBootstrapAt = Date.now();
      console.log("[CONTEXT] tRPC DB ready:", {
        users: db.users.getAll().length,
        drivers: db.drivers.getAll().length,
        configured: isDbConfigured(),
      });
    } catch (error) {
      console.log("[CONTEXT] ensureDbReadyForTrpc error:", error);
    } finally {
      _dbBootstrapPromise = null;
    }
  })();

  await _dbBootstrapPromise;
}

async function loadSessionFromDb(token: string): Promise<Session | null> {
  try {
    const directSession = await dbGet<Record<string, unknown>>("sessions", buildSessionRecordId(token));
    if (!directSession) {
      return null;
    }

    const hydratedSession: Session = {
      token,
      userId: typeof directSession.userId === "string" ? directSession.userId : "",
      userType: directSession.userType === "driver" ? "driver" : "customer",
      createdAt: typeof directSession.createdAt === "string" ? directSession.createdAt : new Date().toISOString(),
      expiresAt: typeof directSession.expiresAt === "string" ? directSession.expiresAt : new Date().toISOString(),
    };

    if (!hydratedSession.userId) {
      return null;
    }

    db.sessions.set(token, hydratedSession);
    console.log("[CONTEXT] Session recovered from direct DB:", hydratedSession.userId);
    return hydratedSession;
  } catch (error) {
    console.log("[CONTEXT] Direct session lookup error:", error);
    return null;
  }
}

async function hydrateSessionAccount(session: Session): Promise<User | Driver | null> {
  if (session.userType === "customer") {
    const memoryUser = db.users.get(session.userId);
    if (memoryUser) {
      return memoryUser;
    }

    try {
      const dbUser = await dbGet<Record<string, unknown>>("users", session.userId);
      if (!dbUser) {
        return null;
      }

      const hydratedUser: User = {
        ...(dbUser as unknown as User),
        id: session.userId,
        type: "customer",
      };
      db.users.set(session.userId, hydratedUser);
      console.log("[CONTEXT] Customer hydrated from direct DB:", session.userId);
      return hydratedUser;
    } catch (error) {
      console.log("[CONTEXT] Customer hydrate error:", error);
      return null;
    }
  }

  const memoryDriver = db.drivers.get(session.userId);
  if (memoryDriver) {
    return memoryDriver;
  }

  try {
    const dbDriver = await dbGet<Record<string, unknown>>("drivers", session.userId);
    if (!dbDriver) {
      return null;
    }

    const hydratedDriver: Driver = {
      ...(dbDriver as unknown as Driver),
      id: session.userId,
      type: "driver",
    };
    db.drivers.set(session.userId, hydratedDriver);
    console.log("[CONTEXT] Driver hydrated from direct DB:", session.userId);
    return hydratedDriver;
  } catch (error) {
    console.log("[CONTEXT] Driver hydrate error:", error);
    return null;
  }
}

async function resolveValidSession(token: string) {
  let session: Session | null | undefined = db.sessions.get(token);

  if (!session) {
    console.log("[CONTEXT] Session not found in memory, attempting store reload");
    try {
      await initializeStore();
      await forceReloadStore();
      session = db.sessions.get(token);
      console.log("[CONTEXT] Session reload result:", !!session);
    } catch (error) {
      console.log("[CONTEXT] Session reload error:", error);
    }
  }

  if (!session) {
    session = await loadSessionFromDb(token);
  }

  if (!session) {
    return null;
  }

  const isExpired = new Date(session.expiresAt).getTime() < Date.now();
  if (isExpired) {
    db.sessions.delete(token);
    console.log("[CONTEXT] Session expired for token, cleaned up");
    return null;
  }

  const account = await hydrateSessionAccount(session);
  if (!account) {
    console.log("[CONTEXT] Session account not found, invalidating token for:", session.userId);
    db.sessions.delete(token);
    return null;
  }

  return session;
}

export const createContext = async (opts: FetchCreateContextFnOptions) => {
  await ensureDbReadyForTrpc(opts.req);

  const authHeader = opts.req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "") || null;

  let userId: string | null = null;
  let userType: "customer" | "driver" | null = null;
  let isAdmin = false;

  if (token && token.length > 4) {
    const session = await resolveValidSession(token);
    if (session) {
      userId = session.userId;
      userType = session.userType;
      if (session.userType === 'driver') {
        const driver = db.drivers.get(session.userId);
        if (driver && driver.email) {
          const adminEmail = process.env.ADMIN_EMAIL || 'admin@2go.app';
          isAdmin = driver.email.toLowerCase() === adminEmail.toLowerCase();
        }
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
