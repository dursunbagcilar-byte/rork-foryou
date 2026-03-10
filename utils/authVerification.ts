import { getBaseUrl, normalizeApiBaseUrl, waitForBaseUrl } from '@/lib/trpc';
import { getDbHeaders } from '@/utils/db';

export type VerificationDeliveryChannel = 'sms';
export type VerificationSmsProvider = 'netgsm';

export interface SendRegistrationVerificationInput {
  name: string;
  email: string;
  phone: string;
  deliveryMethod?: VerificationDeliveryChannel;
}

export interface SendRegistrationVerificationResponse {
  success: boolean;
  error?: string | null;
  emailSent?: boolean;
  deliveryChannel?: VerificationDeliveryChannel;
  maskedPhone?: string | null;
  deliveryNote?: string | null;
  smsProvider?: VerificationSmsProvider;
}

export interface VerifyRegistrationVerificationInput {
  email: string;
  code: string;
}

export interface VerifyRegistrationVerificationResponse {
  success: boolean;
  error?: string | null;
}

async function resolveApiBase(): Promise<string> {
  let base = getBaseUrl();
  if (!base) {
    base = await waitForBaseUrl(8000);
  }

  if (!base) {
    const projectId = process.env.EXPO_PUBLIC_PROJECT_ID;
    const teamId = process.env.EXPO_PUBLIC_TEAM_ID;
    if (projectId && teamId) {
      base = normalizeApiBaseUrl(`https://${projectId}-${teamId}.rork.app`);
    }
  }

  if (!base) {
    throw new Error('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.');
  }

  return normalizeApiBaseUrl(base);
}

async function postJson<T>(path: string, input: Record<string, unknown>): Promise<T> {
  const apiBase = await resolveApiBase();
  const url = `${apiBase}${path}`;
  console.log('[AuthVerification] POST:', url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getDbHeaders(),
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const rawText = await response.text();
    console.log('[AuthVerification] Response status:', response.status, 'len:', rawText.length);

    let parsed: T | null = null;
    if (rawText) {
      try {
        parsed = JSON.parse(rawText) as T;
      } catch (parseError) {
        console.log('[AuthVerification] Response parse error:', parseError, rawText.substring(0, 200));
        throw new Error('Sunucu geçersiz bir yanıt döndürdü. Lütfen tekrar deneyin.');
      }
    }

    if (!response.ok) {
      const parsedError = parsed && typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? parsed.error
        : null;
      if (typeof parsedError === 'string' && parsedError.trim()) {
        throw new Error(parsedError);
      }
      throw new Error(`HTTP ${response.status}`);
    }

    if (!parsed) {
      throw new Error('Sunucu boş yanıt döndürdü. Lütfen tekrar deneyin.');
    }

    return parsed;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Sunucu yanıt vermedi. Lütfen tekrar deneyin.');
    }
    throw error;
  }
}

export async function sendRegistrationVerificationCode(
  input: SendRegistrationVerificationInput,
): Promise<SendRegistrationVerificationResponse> {
  return postJson<SendRegistrationVerificationResponse>('/api/auth/send-verification-code', {
    name: input.name,
    email: input.email,
    phone: input.phone,
    deliveryMethod: 'sms',
  });
}

export async function verifyRegistrationVerificationCode(
  input: VerifyRegistrationVerificationInput,
): Promise<VerifyRegistrationVerificationResponse> {
  return postJson<VerifyRegistrationVerificationResponse>('/api/auth/verify-verification-code', {
    email: input.email,
    code: input.code,
  });
}
