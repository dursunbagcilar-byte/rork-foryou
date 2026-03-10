import { buildApiUrl, getBaseUrl, normalizeApiBaseUrl, waitForBaseUrl } from '@/lib/trpc';
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

interface ParsedResponse<T> {
  data: T | null;
  rawText: string;
  contentType: string;
  isInvalid: boolean;
}

function getProjectFallbackBase(): string {
  const projectId = process.env.EXPO_PUBLIC_PROJECT_ID;
  const teamId = process.env.EXPO_PUBLIC_TEAM_ID;
  if (projectId && teamId) {
    return normalizeApiBaseUrl(`https://${projectId}-${teamId}.rork.app`);
  }
  return '';
}

function getWindowOriginBase(): string {
  try {
    if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
      return normalizeApiBaseUrl(window.location.origin);
    }
  } catch (error) {
    console.log('[AuthVerification] window origin fallback error:', error);
  }

  return '';
}

async function resolveApiCandidates(path: string): Promise<string[]> {
  const candidates: string[] = [];

  const pushCandidate = (value: string | null | undefined) => {
    const trimmedValue = value?.trim() ?? '';
    if (!trimmedValue) {
      return;
    }

    if (!candidates.includes(trimmedValue)) {
      candidates.push(trimmedValue);
    }
  };

  const currentBase = normalizeApiBaseUrl(getBaseUrl());
  if (currentBase) {
    pushCandidate(`${currentBase}${path}`);
  }

  if (!currentBase) {
    const awaitedBase = normalizeApiBaseUrl(await waitForBaseUrl(8000));
    if (awaitedBase) {
      pushCandidate(`${awaitedBase}${path}`);
    }
  }

  const projectFallbackBase = getProjectFallbackBase();
  if (projectFallbackBase) {
    pushCandidate(`${projectFallbackBase}${path}`);
  }

  pushCandidate(buildApiUrl(path));

  const windowOriginBase = getWindowOriginBase();
  if (windowOriginBase) {
    pushCandidate(`${windowOriginBase}${path}`);
  }

  if (candidates.length === 0) {
    throw new Error('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.');
  }

  console.log('[AuthVerification] Candidate URLs:', candidates.join(' | '));
  return candidates;
}

function isHtmlLikeResponse(rawText: string, contentType: string): boolean {
  const trimmedText = rawText.trim().toLowerCase();
  return contentType.includes('text/html') ||
    trimmedText.startsWith('<!doctype html') ||
    trimmedText.startsWith('<html') ||
    trimmedText.includes('<body');
}

function extractParsedErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (!('error' in value)) {
    return null;
  }

  const errorValue = value.error;
  if (typeof errorValue === 'string' && errorValue.trim()) {
    return errorValue;
  }

  return null;
}

async function parseResponse<T>(response: Response): Promise<ParsedResponse<T>> {
  const contentType = response.headers.get('content-type') ?? '';
  const rawText = await response.text();

  if (!rawText) {
    return {
      data: null,
      rawText,
      contentType,
      isInvalid: false,
    };
  }

  if (isHtmlLikeResponse(rawText, contentType)) {
    return {
      data: null,
      rawText,
      contentType,
      isInvalid: true,
    };
  }

  try {
    return {
      data: JSON.parse(rawText) as T,
      rawText,
      contentType,
      isInvalid: false,
    };
  } catch (parseError) {
    console.log('[AuthVerification] Response parse error:', parseError, rawText.substring(0, 200));
    return {
      data: null,
      rawText,
      contentType,
      isInvalid: true,
    };
  }
}

async function postJson<T>(path: string, input: Record<string, unknown>): Promise<T> {
  const urls = await resolveApiCandidates(path);
  let lastError: Error | null = null;

  for (const url of urls) {
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

      const parsedResponse = await parseResponse<T>(response);
      console.log(
        '[AuthVerification] Response status:',
        response.status,
        'contentType:',
        parsedResponse.contentType || 'unknown',
        'len:',
        parsedResponse.rawText.length,
      );

      if (parsedResponse.isInvalid) {
        console.log('[AuthVerification] Invalid response from:', url, parsedResponse.rawText.substring(0, 200));
        lastError = new Error('Sunucu geçersiz bir yanıt döndürdü. Lütfen tekrar deneyin.');
        continue;
      }

      if (!response.ok) {
        const parsedError = extractParsedErrorMessage(parsedResponse.data);
        if (parsedError) {
          throw new Error(parsedError);
        }

        throw new Error(`HTTP ${response.status}`);
      }

      if (!parsedResponse.data) {
        throw new Error('Sunucu boş yanıt döndürdü. Lütfen tekrar deneyin.');
      }

      return parsedResponse.data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error('Sunucu yanıt vermedi. Lütfen tekrar deneyin.');
        continue;
      }

      if (error instanceof Error) {
        lastError = error;
        if (!error.message.includes('Sunucu geçersiz bir yanıt döndürdü')) {
          break;
        }
        continue;
      }

      lastError = new Error('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.');
      break;
    }
  }

  throw lastError ?? new Error('Sunucu geçersiz bir yanıt döndürdü. Lütfen tekrar deneyin.');
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
