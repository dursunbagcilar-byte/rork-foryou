export const AUTH_SMS_PROVIDER = 'netgsm' as const;

export type AuthSmsProvider = typeof AUTH_SMS_PROVIDER;

export function generateAuthCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
