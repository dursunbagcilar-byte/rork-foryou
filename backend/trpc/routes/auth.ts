import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "../create-context";
import { db } from "../../db/store";
import {
  checkLoginAttempt,
  recordLoginFailure,
  recordLoginSuccess,
  generateSecureToken,
  hashPassword,
  verifyPassword,
  sanitizeInput,
  validateEmail,
  validatePassword,
} from "../../utils/security";
import { sendEmail, generateResetCode, buildResetCodeEmail, buildVerificationCodeEmail, type SendEmailErrorCode } from "../../utils/email";

async function createSession(userId: string, userType: "customer" | "driver"): Promise<string> {
  const token = generateSecureToken(64);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await db.sessions.setSync(token, {
    token,
    userId,
    userType,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  console.log("[AUTH] Secure session created for:", userId, "expires:", expiresAt.toISOString());
  return token;
}

function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'FY';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getUniqueReferralCode(): string {
  let attempts = 0;
  while (attempts < 20) {
    const code = generateReferralCode();
    const existing = db.referralCodeIndex.get(code);
    if (!existing) return code;
    attempts++;
  }
  return 'FY' + Date.now().toString(36).toUpperCase().slice(-5);
}

function getEmailSendErrorMessage(errorCode: SendEmailErrorCode | null): string {
  if (errorCode === 'missing_from_email' || errorCode === 'invalid_from_email') {
    return 'E-posta servisi henüz tamamlanmadı. Lütfen daha sonra tekrar deneyin.';
  }

  if (errorCode === 'missing_api_key') {
    return 'E-posta servisi geçici olarak kullanılamıyor. Lütfen daha sonra tekrar deneyin.';
  }

  return 'E-posta gönderilemedi. Lütfen e-posta adresinizi kontrol edin veya daha sonra tekrar deneyin.';
}

export const authRouter = createTRPCRouter({
  sendVerificationCode: publicProcedure
    .input(z.object({
      email: z.string().email().max(254),
      name: z.string().min(1).max(100),
    }))
    .mutation(async ({ input }) => {
      const cleanEmail = input.email.toLowerCase().trim();

      const loginCheck = checkLoginAttempt(`verify_${cleanEmail}`);
      if (!loginCheck.allowed) {
        return { success: false, error: "Çok fazla deneme. Lütfen daha sonra tekrar deneyin." };
      }

      const existingUser = db.users.getByEmail(cleanEmail);
      const existingDriver = db.drivers.getByEmail(cleanEmail);
      if (existingUser || existingDriver) {
        return { success: false, error: "Bu e-posta adresi zaten kayıtlı" };
      }

      const code = generateResetCode();
      const codeKey = `verify_${cleanEmail}`;
      db.resetCodes.set(codeKey, code);
      console.log('[AUTH] sendVerificationCode - stored code:', code, 'for key:', codeKey);

      const emailResult = await sendEmail({
        to: cleanEmail,
        subject: '2GO - E-posta Doğrulama Kodu',
        html: buildVerificationCodeEmail(code, sanitizeInput(input.name)),
      });

      if (!emailResult.success) {
        console.log(
          "[AUTH] Verification email send failed for:",
          cleanEmail,
          "code:",
          code,
          "errorCode:",
          emailResult.errorCode,
          "providerMessage:",
          emailResult.providerMessage,
        );
        return {
          success: false,
          error: getEmailSendErrorMessage(emailResult.errorCode),
          emailSent: false,
        };
      }

      recordLoginSuccess(`verify_${cleanEmail}`);
      console.log("[AUTH] Verification code sent to:", cleanEmail, 'code:', code);
      return { success: true, error: null, emailSent: true };
    }),

  verifyEmailCode: publicProcedure
    .input(z.object({
      email: z.string().email().max(254),
      code: z.string().min(6).max(6),
    }))
    .mutation(async ({ input }) => {
      const cleanEmail = input.email.toLowerCase().trim();
      const codeKey = `verify_${cleanEmail}`;

      console.log('[AUTH] verifyEmailCode - looking up code for:', codeKey, 'input code:', input.code);

      const stored = await db.resetCodes.getAsync(codeKey);
      if (!stored) {
        console.log('[AUTH] verifyEmailCode - NO CODE FOUND for:', codeKey);
        return { success: false, error: "Doğrulama kodu bulunamadı veya süresi dolmuş" };
      }

      console.log('[AUTH] verifyEmailCode - stored code:', stored.code, 'input code:', input.code, 'attempts:', stored.attempts);

      if (stored.attempts >= 5) {
        db.resetCodes.delete(codeKey);
        return { success: false, error: "Çok fazla hatalı deneme. Yeni kod talep edin." };
      }

      if (stored.code !== input.code) {
        await db.resetCodes.incrementAttemptsAsync(codeKey);
        console.log('[AUTH] verifyEmailCode - CODE MISMATCH for:', codeKey, 'stored:', stored.code, 'input:', input.code);
        return { success: false, error: "Doğrulama kodu hatalı" };
      }

      db.resetCodes.delete(codeKey);
      console.log("[AUTH] Email verified for registration:", cleanEmail);
      return { success: true, error: null };
    }),

  registerCustomer: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        phone: z.string().min(1).max(20),
        email: z.string().email().max(254),
        password: z.string().min(8).max(128),
        gender: z.enum(["male", "female"]),
        city: z.string().min(1).max(100),
        district: z.string().min(1).max(100),
        referralCode: z.string().max(20).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const cleanName = sanitizeInput(input.name);
      const cleanPhone = sanitizeInput(input.phone);
      const cleanEmail = input.email.toLowerCase().trim();

      if (!validateEmail(cleanEmail)) {
        return { success: false, error: "Geçersiz e-posta adresi", user: null, token: null };
      }

      const pwdValidation = validatePassword(input.password);
      if (!pwdValidation.valid) {
        return { success: false, error: pwdValidation.reason, user: null, token: null };
      }

      const existing = db.users.getByEmail(cleanEmail);
      if (existing) {
        return { success: false, error: "Bu e-posta zaten kayıtlı", user: null, token: null };
      }

      const existingDriver = db.drivers.getByEmail(cleanEmail);
      if (existingDriver) {
        return { success: false, error: "Bu e-posta zaten kayıtlı", user: null, token: null };
      }

      let referrerUserId: string | undefined;
      if (input.referralCode) {
        const code = input.referralCode.toUpperCase().trim();
        referrerUserId = db.referralCodeIndex.get(code);
        if (!referrerUserId) {
          console.log("[AUTH] Invalid referral code:", code);
        } else {
          console.log("[AUTH] Valid referral code:", code, "referrer:", referrerUserId);
        }
      }

      const id = "c_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
      const myReferralCode = getUniqueReferralCode();
      const freeRides = referrerUserId ? 2 : 0;

      const user = {
        id,
        name: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        type: "customer" as const,
        gender: input.gender,
        city: sanitizeInput(input.city),
        district: sanitizeInput(input.district),
        referralCode: myReferralCode,
        referredBy: referrerUserId,
        freeRidesRemaining: freeRides,
        createdAt: new Date().toISOString(),
      };

      await db.users.setSync(id, user);
      db.referralCodeIndex.set(myReferralCode, id);

      if (referrerUserId) {
        const referrer = db.users.get(referrerUserId);
        if (referrer) {
          const updatedReferrer = {
            ...referrer,
            freeRidesRemaining: (referrer.freeRidesRemaining || 0) + 2,
          };
          await db.users.setSync(referrerUserId, updatedReferrer);
          console.log("[AUTH] Referrer awarded 2 free rides:", referrerUserId, "total:", updatedReferrer.freeRidesRemaining);
        }

        const refId = "ref_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6);
        db.referrals.set(refId, {
          id: refId,
          referrerUserId,
          referredUserId: id,
          referredName: cleanName,
          freeRidesAwarded: 2,
          createdAt: new Date().toISOString(),
        });
        console.log("[AUTH] Referral recorded:", refId, "referrer:", referrerUserId, "referred:", id);
      }

      const hashedPwd = await hashPassword(input.password);
      await db.passwords.setSync(cleanEmail, hashedPwd);

      const token = await createSession(id, "customer");
      console.log("[AUTH] Customer registered:", id, cleanName, "referralCode:", myReferralCode, "freeRides:", freeRides);
      return { success: true, error: null, user, token };
    }),

  registerDriver: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        phone: z.string().min(1).max(20),
        email: z.string().email().max(254),
        password: z.string().min(8).max(128),
        vehiclePlate: z.string().max(20).optional(),
        vehicleModel: z.string().min(1).max(100),
        vehicleColor: z.string().min(1).max(50),
        partnerDriverName: z.string().max(100).optional(),
        licenseIssueDate: z.string().max(50).optional(),
        driverCategory: z.enum(["driver", "scooter", "courier"]).optional(),
        city: z.string().min(1).max(100),
        district: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ input }) => {
      const cleanName = sanitizeInput(input.name);
      const cleanEmail = input.email.toLowerCase().trim();

      if (!validateEmail(cleanEmail)) {
        return { success: false, error: "Geçersiz e-posta adresi", driver: null, token: null };
      }

      const pwdValidation = validatePassword(input.password);
      if (!pwdValidation.valid) {
        return { success: false, error: pwdValidation.reason, driver: null, token: null };
      }

      const existing = db.drivers.getByEmail(cleanEmail);
      if (existing) {
        return { success: false, error: "Bu e-posta zaten kayıtlı", driver: null, token: null };
      }

      const existingUser = db.users.getByEmail(cleanEmail);
      if (existingUser) {
        return { success: false, error: "Bu e-posta zaten kayıtlı", driver: null, token: null };
      }

      const id = "d_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
      const driver = {
        id,
        name: cleanName,
        phone: sanitizeInput(input.phone),
        email: cleanEmail,
        type: "driver" as const,
        driverCategory: input.driverCategory ?? "driver",
        vehiclePlate: input.vehiclePlate ? sanitizeInput(input.vehiclePlate).toUpperCase() : "",
        vehicleModel: sanitizeInput(input.vehicleModel),
        vehicleColor: sanitizeInput(input.vehicleColor),
        rating: 5.0,
        totalRides: 0,
        isOnline: false,
        isApproved: true,
        approvedAt: new Date().toISOString(),
        licenseIssueDate: input.licenseIssueDate,
        partnerDriverName: input.partnerDriverName ? sanitizeInput(input.partnerDriverName) : undefined,
        dailyEarnings: 0,
        weeklyEarnings: 0,
        monthlyEarnings: 0,
        city: sanitizeInput(input.city),
        district: sanitizeInput(input.district),
        createdAt: new Date().toISOString(),
      };

      await db.drivers.setSync(id, driver);
      const hashedDriverPwd = await hashPassword(input.password);
      await db.passwords.setSync(cleanEmail, hashedDriverPwd);

      const token = await createSession(id, "driver");
      console.log("[AUTH] Driver registered:", id, cleanName);
      return { success: true, error: null, driver, token };
    }),

  loginByEmail: publicProcedure
    .input(
      z.object({
        email: z.string().email().max(254),
        password: z.string().min(1).max(128),
        type: z.enum(["customer", "driver"]),
      })
    )
    .mutation(async ({ input }) => {
      const cleanEmail = input.email.toLowerCase().trim();

      const loginCheck = checkLoginAttempt(cleanEmail);
      if (!loginCheck.allowed) {
        const remainingMinutes = Math.ceil((loginCheck.lockedUntil - Date.now()) / 60000);
        console.log(`[AUTH] Login blocked for ${cleanEmail}, locked for ${remainingMinutes} more minutes`);
        return {
          success: false,
          error: `Çok fazla başarısız giriş denemesi. ${remainingMinutes} dakika sonra tekrar deneyin.`,
          user: null,
          token: null,
        };
      }

      let storedHash = db.passwords.get(cleanEmail);
      let user = db.users.getByEmail(cleanEmail);
      let driver = db.drivers.getByEmail(cleanEmail);

      console.log('[AUTH] loginByEmail - initial lookup for:', cleanEmail, 'hasHash:', !!storedHash, 'user:', !!user, 'driver:', !!driver);

      if (!storedHash || (!user && !driver)) {
        console.log('[AUTH] loginByEmail - data missing, doing single store reload for:', cleanEmail);
        try {
          const { initializeStore } = await import('../../db/store');
          await initializeStore();
          storedHash = db.passwords.get(cleanEmail);
          user = db.users.getByEmail(cleanEmail);
          driver = db.drivers.getByEmail(cleanEmail);
          console.log('[AUTH] loginByEmail - after initializeStore: hasHash:', !!storedHash, 'user:', !!user, 'driver:', !!driver);
        } catch (initErr) {
          console.log('[AUTH] loginByEmail - initializeStore error:', initErr);
        }
      }

      if (!storedHash || (!user && !driver)) {
        console.log('[AUTH] loginByEmail - still missing, trying direct DB lookup for:', cleanEmail);
        try {
          const { dbSearchPasswordByEmail, dbFindByEmail } = await import('../../db/rork-db');

          if (!storedHash) {
            const result = await dbSearchPasswordByEmail(cleanEmail);
            if (result && result.hash) {
              storedHash = result.hash;
              db.passwords.set(cleanEmail, result.hash);
              console.log('[AUTH] loginByEmail - recovered password from direct DB for:', cleanEmail);
            }
          }

          if (!user && !driver) {
            const dbUser = await dbFindByEmail<any>('users', cleanEmail);
            if (dbUser) {
              const id = dbUser.rorkId || dbUser._originalId || dbUser.id;
              if (id && typeof id === 'string') {
                dbUser.id = id;
                user = dbUser;
                db.users.set(id, dbUser);
                console.log('[AUTH] loginByEmail - recovered user from direct DB:', id);
              }
            }
            if (!user) {
              const dbDriver = await dbFindByEmail<any>('drivers', cleanEmail);
              if (dbDriver) {
                const id = dbDriver.rorkId || dbDriver._originalId || dbDriver.id;
                if (id && typeof id === 'string') {
                  dbDriver.id = id;
                  driver = dbDriver;
                  db.drivers.set(id, dbDriver);
                  console.log('[AUTH] loginByEmail - recovered driver from direct DB:', id);
                }
              }
            }
          }
        } catch (dbErr) {
          console.log('[AUTH] loginByEmail - direct DB lookup error:', dbErr);
        }
      }

      if (!storedHash) {
        recordLoginFailure(cleanEmail);
        console.log("[AUTH] No password hash found for:", cleanEmail, 'after all retries, user:', !!user, 'driver:', !!driver);
        return { success: false, error: "Kullanıcı bulunamadı veya şifre ayarlanmamış. Lütfen 'Şifremi Unuttum' ile yeni şifre oluşturun.", user: null, token: null };
      }

      const passwordMatch = await verifyPassword(input.password, storedHash);
      if (!passwordMatch) {
        recordLoginFailure(cleanEmail);
        const updatedCheck = checkLoginAttempt(cleanEmail);
        const remaining = updatedCheck.remainingAttempts;
        const errorMsg = remaining <= 2 && remaining > 0
          ? `Şifre hatalı. ${remaining} deneme hakkınız kaldı.`
          : "Şifre hatalı";
        return { success: false, error: errorMsg, user: null, token: null };
      }

      if (user && driver) {
        const preferred = input.type === "driver" ? driver : user;
        const preferredType = input.type === "driver" ? "driver" : "customer";
        if (preferredType === "driver" && driver.isSuspended) {
          return { success: false, error: "Hesabınız askıya alınmıştır. Yönetici ile iletişime geçin.", user: null, token: null };
        }
        recordLoginSuccess(cleanEmail);
        const token = await createSession(preferred.id, preferredType);
        console.log(`[AUTH] Login (both accounts exist, using ${preferredType}):`, preferred.id, preferred.name);
        return { success: true, error: null, user: { ...preferred, type: preferredType }, token };
      }

      if (user) {
        recordLoginSuccess(cleanEmail);
        const token = await createSession(user.id, "customer");
        console.log("[AUTH] Customer login:", user.id, user.name);
        return { success: true, error: null, user: { ...user, type: "customer" as const }, token };
      }

      if (driver) {
        if (driver.isSuspended) {
          console.log("[AUTH] Suspended driver tried to login:", driver.id);
          return { success: false, error: "Hesabınız askıya alınmıştır. Yönetici ile iletişime geçin.", user: null, token: null };
        }
        recordLoginSuccess(cleanEmail);
        const token = await createSession(driver.id, "driver");
        console.log("[AUTH] Driver login:", driver.id, driver.name);
        return { success: true, error: null, user: { ...driver, type: "driver" as const }, token };
      }

      recordLoginFailure(cleanEmail);
      return { success: false, error: "Kullanıcı bulunamadı. Lütfen kayıt olduğunuz e-posta adresini kontrol edin.", user: null, token: null };
    }),

  validateSession: publicProcedure
    .input(z.object({ token: z.string().max(256) }))
    .query(async ({ input }) => {
      if (!input.token || input.token.length < 4) {
        return { valid: false, user: null, userType: null };
      }

      let session = db.sessions.get(input.token);

      if (!session) {
        console.log('[AUTH] validateSession - session not found in memory, trying reload...');
        try {
          const { forceReloadStore, initializeStore } = await import('../../db/store');
          await initializeStore();
          await forceReloadStore();
          session = db.sessions.get(input.token);
          console.log('[AUTH] validateSession - after reload, session found:', !!session);
        } catch (reloadErr) {
          console.log('[AUTH] validateSession - reload error:', reloadErr);
        }
      }

      if (!session) {
        console.log('[AUTH] validateSession - session still not found after reload');
        return { valid: false, user: null, userType: null };
      }

      if (new Date(session.expiresAt).getTime() < Date.now()) {
        db.sessions.delete(input.token);
        console.log("[AUTH] Session expired for:", session.userId);
        return { valid: false, user: null, userType: null };
      }

      if (session.userType === "customer") {
        let user = db.users.get(session.userId);
        if (!user) {
          const allUsers = db.users.getAll();
          user = allUsers.find(u => u.id === session!.userId) ?? undefined;
        }
        return { valid: true, user: user ?? null, userType: "customer" as const };
      } else {
        let driver = db.drivers.get(session.userId);
        if (!driver) {
          const allDrivers = db.drivers.getAll();
          driver = allDrivers.find(d => d.id === session!.userId) ?? undefined;
        }
        return { valid: true, user: driver ?? null, userType: "driver" as const };
      }
    }),

  logout: publicProcedure
    .input(z.object({ token: z.string().max(256) }))
    .mutation(({ input }) => {
      db.sessions.delete(input.token);
      console.log("[AUTH] Session invalidated");
      return { success: true };
    }),

  getProfile: protectedProcedure
    .input(z.object({ userId: z.string().max(100) }))
    .query(({ input }) => {
      const user = db.users.get(input.userId);
      if (user) return { type: "customer" as const, profile: user };

      const driver = db.drivers.get(input.userId);
      if (driver) return { type: "driver" as const, profile: driver };

      return { type: null, profile: null };
    }),

  sendResetCode: publicProcedure
    .input(z.object({
      email: z.string().email().max(254),
    }))
    .mutation(async ({ input }) => {
      const cleanEmail = input.email.toLowerCase().trim();

      const loginCheck = checkLoginAttempt(`resetcode_${cleanEmail}`);
      if (!loginCheck.allowed) {
        return { success: false, error: "Çok fazla deneme. Lütfen daha sonra tekrar deneyin." };
      }

      let user = db.users.getByEmail(cleanEmail);
      let driver = db.drivers.getByEmail(cleanEmail);
      let account = user || driver;
      let hasPassword = db.passwords.get(cleanEmail);

      console.log('[AUTH] sendResetCode - first lookup for:', cleanEmail, 'user:', !!user, 'driver:', !!driver, 'hasPassword:', !!hasPassword);

      if (!account || !hasPassword) {
        console.log('[AUTH] sendResetCode - data incomplete, doing store init...');
        try {
          const { initializeStore } = await import('../../db/store');
          await initializeStore();
        } catch (reloadErr) {
          console.log('[AUTH] sendResetCode - init error:', reloadErr);
        }
        if (!account) {
          user = db.users.getByEmail(cleanEmail);
          driver = db.drivers.getByEmail(cleanEmail);
          account = user || driver;
        }
        if (!hasPassword) hasPassword = db.passwords.get(cleanEmail);
        console.log('[AUTH] sendResetCode - after init: account:', !!account, 'hasPassword:', !!hasPassword);
      }

      if (!account || !hasPassword) {
        console.log('[AUTH] sendResetCode - still incomplete, trying direct DB lookup for:', cleanEmail);
        try {
          const { dbFindByEmail, dbSearchPasswordByEmail } = await import('../../db/rork-db');
          if (!account) {
            const dbUser = await dbFindByEmail<any>('users', cleanEmail);
            if (dbUser) {
              const id = dbUser.rorkId || dbUser._originalId || dbUser.id;
              if (id && typeof id === 'string') {
                dbUser.id = id;
                user = dbUser;
                account = dbUser;
                db.users.set(id, dbUser);
              }
            }
          }
          if (!account) {
            const dbDriver = await dbFindByEmail<any>('drivers', cleanEmail);
            if (dbDriver) {
              const id = dbDriver.rorkId || dbDriver._originalId || dbDriver.id;
              if (id && typeof id === 'string') {
                dbDriver.id = id;
                driver = dbDriver;
                account = dbDriver;
                db.drivers.set(id, dbDriver);
              }
            }
          }
          if (!hasPassword) {
            const pwdResult = await dbSearchPasswordByEmail(cleanEmail);
            if (pwdResult && pwdResult.hash) {
              hasPassword = pwdResult.hash;
              db.passwords.set(cleanEmail, pwdResult.hash);
            }
          }
        } catch (dbErr) {
          console.log('[AUTH] sendResetCode - direct DB lookup error:', dbErr);
        }
      }

      if (!account && !hasPassword) {
        recordLoginFailure(`resetcode_${cleanEmail}`);
        console.log('[AUTH] sendResetCode - NO ACCOUNT FOUND after all attempts for:', cleanEmail);
        return { success: false, error: "Bu e-posta adresiyle kayıtlı hesap bulunamadı" };
      }

      const accountName = account?.name || cleanEmail.split('@')[0];

      const code = generateResetCode();
      db.resetCodes.set(cleanEmail, code);
      console.log('[AUTH] sendResetCode - stored code:', code, 'for email:', cleanEmail);

      const storedCheck = db.resetCodes.get(cleanEmail);
      console.log('[AUTH] sendResetCode - verify stored code:', storedCheck?.code, 'matches:', storedCheck?.code === code);

      const emailResult = await sendEmail({
        to: cleanEmail,
        subject: '2GO - Şifre Sıfırlama Kodu',
        html: buildResetCodeEmail(code, accountName),
      });

      if (!emailResult.success) {
        console.log(
          "[AUTH] Reset email send failed for:",
          cleanEmail,
          "code:",
          code,
          "errorCode:",
          emailResult.errorCode,
          "providerMessage:",
          emailResult.providerMessage,
        );
        return {
          success: false,
          error: getEmailSendErrorMessage(emailResult.errorCode),
          emailSent: false,
        };
      }

      recordLoginSuccess(`resetcode_${cleanEmail}`);
      console.log("[AUTH] Reset code sent to:", cleanEmail, 'code:', code);
      return { success: true, error: null, emailSent: true };
    }),

  verifyResetCode: publicProcedure
    .input(z.object({
      email: z.string().email().max(254),
      code: z.string().min(6).max(6),
    }))
    .mutation(async ({ input }) => {
      const cleanEmail = input.email.toLowerCase().trim();
      const inputCode = input.code.trim();

      console.log('[AUTH] verifyResetCode - looking up code for:', cleanEmail, 'input code:', inputCode);

      const stored = await db.resetCodes.getAsync(cleanEmail);
      if (!stored) {
        console.log('[AUTH] verifyResetCode - NO CODE FOUND for:', cleanEmail);
        return { success: false, error: "Doğrulama kodu bulunamadı veya süresi dolmuş. Lütfen yeni kod talep edin." };
      }

      console.log('[AUTH] verifyResetCode - stored code:', stored.code, 'input code:', inputCode, 'attempts:', stored.attempts);

      if (stored.attempts >= 5) {
        db.resetCodes.delete(cleanEmail);
        return { success: false, error: "Çok fazla hatalı deneme. Yeni kod talep edin." };
      }

      if (stored.code !== inputCode) {
        await db.resetCodes.incrementAttemptsAsync(cleanEmail);
        const remaining = 4 - stored.attempts;
        console.log('[AUTH] verifyResetCode - CODE MISMATCH for:', cleanEmail, 'stored:', stored.code, 'input:', inputCode, 'remaining:', remaining);
        return { success: false, error: remaining > 0 ? `Doğrulama kodu hatalı. ${remaining} deneme hakkınız kaldı.` : "Doğrulama kodu hatalı. Yeni kod talep edin." };
      }

      console.log("[AUTH] Reset code verified for:", cleanEmail);
      return { success: true, error: null };
    }),

  resetPassword: publicProcedure
    .input(z.object({
      email: z.string().email().max(254),
      code: z.string().min(6).max(6),
      newPassword: z.string().min(8).max(128),
    }))
    .mutation(async ({ input }) => {
      const cleanEmail = input.email.toLowerCase().trim();
      const inputCode = input.code.trim();

      const stored = await db.resetCodes.getAsync(cleanEmail);
      if (!stored) {
        console.log('[AUTH] resetPassword - NO CODE FOUND for:', cleanEmail);
        return { success: false, error: "Doğrulama kodu bulunamadı veya süresi dolmuş. Lütfen yeni kod talep edin." };
      }

      console.log('[AUTH] resetPassword - stored code:', stored.code, 'input code:', inputCode);

      if (stored.code !== inputCode) {
        console.log('[AUTH] resetPassword - CODE MISMATCH for:', cleanEmail);
        return { success: false, error: "Doğrulama kodu hatalı" };
      }

      const pwdValidation = validatePassword(input.newPassword);
      if (!pwdValidation.valid) {
        return { success: false, error: pwdValidation.reason };
      }

      let storedHash = db.passwords.get(cleanEmail);
      if (!storedHash) {
        console.log('[AUTH] resetPassword - password hash not found, trying force reload...');
        try {
          const { forceReloadStore, initializeStore } = await import('../../db/store');
          await initializeStore();
          await forceReloadStore();
        } catch (reloadErr) {
          console.log('[AUTH] resetPassword - force reload error:', reloadErr);
        }
        storedHash = db.passwords.get(cleanEmail);
      }

      const resetHashedPwd = await hashPassword(input.newPassword);
      await db.passwords.setSync(cleanEmail, resetHashedPwd);
      db.resetCodes.delete(cleanEmail);
      console.log("[AUTH] Password reset successfully for:", cleanEmail, 'hadPreviousHash:', !!storedHash);
      return { success: true, error: null };
    }),

  updateCustomerProfile: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        name: z.string().min(1).max(100).optional(),
        phone: z.string().min(1).max(20).optional(),
        city: z.string().min(1).max(100).optional(),
        district: z.string().min(1).max(100).optional(),
        avatar: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const user = db.users.get(input.userId);
      if (!user) return { success: false, error: "Kullanıcı bulunamadı", user: null };

      const updated = {
        ...user,
        ...(input.name && { name: sanitizeInput(input.name) }),
        ...(input.phone && { phone: sanitizeInput(input.phone) }),
        ...(input.city && { city: sanitizeInput(input.city) }),
        ...(input.district && { district: sanitizeInput(input.district) }),
        ...(input.avatar !== undefined && { avatar: input.avatar }),
      };

      await db.users.setSync(input.userId, updated);
      console.log("[AUTH] Customer profile updated:", input.userId, updated.name);
      return { success: true, error: null, user: updated };
    }),

  changePassword: publicProcedure
    .input(z.object({
      email: z.string().email().max(254),
      oldPassword: z.string().min(1).max(128),
      newPassword: z.string().min(8).max(128),
    }))
    .mutation(async ({ input }) => {
      const cleanEmail = input.email.toLowerCase().trim();

      const loginCheck = checkLoginAttempt(`pwd_${cleanEmail}`);
      if (!loginCheck.allowed) {
        return { success: false, error: "Çok fazla deneme. Lütfen daha sonra tekrar deneyin." };
      }

      const storedHash = db.passwords.get(cleanEmail);
      const oldPwdMatch = storedHash ? await verifyPassword(input.oldPassword, storedHash) : false;
      if (!storedHash || !oldPwdMatch) {
        recordLoginFailure(`pwd_${cleanEmail}`);
        return { success: false, error: "Mevcut şifre hatalı" };
      }

      const newPwdValidation = validatePassword(input.newPassword);
      if (!newPwdValidation.valid) {
        return { success: false, error: newPwdValidation.reason };
      }

      if (input.oldPassword === input.newPassword) {
        return { success: false, error: "Yeni şifre eski şifreden farklı olmalıdır" };
      }

      recordLoginSuccess(`pwd_${cleanEmail}`);
      const newHashedPwd = await hashPassword(input.newPassword);
      await db.passwords.setSync(cleanEmail, newHashedPwd);
      console.log("[AUTH] Password changed for:", cleanEmail);
      return { success: true, error: null };
    }),

  validateReferralCode: publicProcedure
    .input(z.object({ code: z.string().max(20) }))
    .query(({ input }) => {
      const code = input.code.toUpperCase().trim();
      const userId = db.referralCodeIndex.get(code);
      if (!userId) {
        return { valid: false, referrerName: null };
      }
      const user = db.users.get(userId);
      return { valid: true, referrerName: user?.name ?? null };
    }),

  getReferralInfo: publicProcedure
    .input(z.object({ userId: z.string().max(100) }))
    .query(({ input }) => {
      const user = db.users.get(input.userId);
      if (!user) {
        return { referralCode: null, freeRidesRemaining: 0, referrals: [] };
      }
      const myReferrals = db.referrals.getByReferrer(input.userId);
      return {
        referralCode: user.referralCode || null,
        freeRidesRemaining: user.freeRidesRemaining || 0,
        referrals: myReferrals.map(r => ({
          id: r.id,
          referredName: r.referredName,
          freeRidesAwarded: r.freeRidesAwarded,
          createdAt: r.createdAt,
        })),
      };
    }),

  useFreeRide: publicProcedure
    .input(z.object({ userId: z.string().max(100) }))
    .mutation(async ({ input }) => {
      const user = db.users.get(input.userId);
      if (!user) {
        return { success: false, error: "Kullanıcı bulunamadı", freeRidesRemaining: 0 };
      }
      if ((user.freeRidesRemaining || 0) <= 0) {
        return { success: false, error: "Ücretsiz sürüş hakkınız bulunmuyor", freeRidesRemaining: 0 };
      }
      const updated = { ...user, freeRidesRemaining: user.freeRidesRemaining - 1 };
      await db.users.setSync(input.userId, updated);
      console.log("[AUTH] Free ride used by:", input.userId, "remaining:", updated.freeRidesRemaining);
      return { success: true, error: null, freeRidesRemaining: updated.freeRidesRemaining };
    }),
});
