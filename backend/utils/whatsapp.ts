const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN?.trim() ?? '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? '';
const WHATSAPP_RESET_TEMPLATE_NAME = process.env.WHATSAPP_RESET_TEMPLATE_NAME?.trim() ?? '';
const WHATSAPP_TEMPLATE_LANGUAGE = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() ?? 'tr';
const WHATSAPP_GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION?.trim() ?? 'v21.0';

export type SendWhatsAppErrorCode = 'not_configured' | 'invalid_phone' | 'provider_error' | 'network_error';

export interface SendPasswordResetWhatsAppParams {
  toPhone: string;
  code: string;
}

export interface SendPasswordResetWhatsAppResult {
  success: boolean;
  errorCode: SendWhatsAppErrorCode | null;
  providerMessage: string | null;
  messageId: string | null;
}

function hasWhatsAppResetConfig(): boolean {
  return Boolean(WHATSAPP_ACCESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_RESET_TEMPLATE_NAME);
}

function normalizeWhatsAppDestination(phone: string): string {
  return phone.replace(/\D/g, '').trim();
}

function getObjectValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || !(key in value)) {
    return null;
  }

  return (value as Record<string, unknown>)[key];
}

function getProviderMessage(payload: unknown): string | null {
  const directMessage = getObjectValue(payload, 'message');
  if (typeof directMessage === 'string' && directMessage.trim()) {
    return directMessage;
  }

  const directError = getObjectValue(payload, 'error');
  if (typeof directError === 'string' && directError.trim()) {
    return directError;
  }

  const nestedError = getObjectValue(payload, 'error');
  const nestedMessage = getObjectValue(nestedError, 'message');
  if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
    return nestedMessage;
  }

  return null;
}

function getMessageId(payload: unknown): string | null {
  const messages = getObjectValue(payload, 'messages');
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const firstMessage = messages[0];
  const id = getObjectValue(firstMessage, 'id');
  return typeof id === 'string' && id.trim() ? id : null;
}

export function getWhatsAppResetFallbackMessage(result: SendPasswordResetWhatsAppResult): string {
  if (result.errorCode === 'not_configured') {
    return 'WhatsApp doğrulama servisi henüz tamamlanmadı. Kod talebiniz destek hattına yönlendirildi.';
  }

  if (result.errorCode === 'invalid_phone') {
    return 'Kayıtlı telefon numarası WhatsApp için uygun görünmüyor. Kod talebiniz destek hattına yönlendirildi.';
  }

  return 'WhatsApp kodu şu anda otomatik gönderilemedi. Kod talebiniz destek hattına yönlendirildi.';
}

export async function sendPasswordResetWhatsAppCode(params: SendPasswordResetWhatsAppParams): Promise<SendPasswordResetWhatsAppResult> {
  if (!hasWhatsAppResetConfig()) {
    console.log('[WHATSAPP] Missing WhatsApp reset delivery config');
    return {
      success: false,
      errorCode: 'not_configured',
      providerMessage: null,
      messageId: null,
    };
  }

  const normalizedPhone = normalizeWhatsAppDestination(params.toPhone);
  if (!normalizedPhone) {
    console.log('[WHATSAPP] Invalid phone for reset code delivery:', params.toPhone);
    return {
      success: false,
      errorCode: 'invalid_phone',
      providerMessage: null,
      messageId: null,
    };
  }

  const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizedPhone,
    type: 'template',
    template: {
      name: WHATSAPP_RESET_TEMPLATE_NAME,
      language: {
        code: WHATSAPP_TEMPLATE_LANGUAGE,
      },
      components: [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: params.code,
            },
          ],
        },
      ],
    },
  };

  console.log('[WHATSAPP] Sending password reset code to:', normalizedPhone, 'template:', WHATSAPP_RESET_TEMPLATE_NAME);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let parsedPayload: unknown = null;

    try {
      parsedPayload = rawText ? JSON.parse(rawText) as unknown : null;
    } catch (parseError) {
      console.log('[WHATSAPP] Could not parse response JSON:', parseError);
    }

    const providerMessage = getProviderMessage(parsedPayload);
    if (!response.ok) {
      console.log('[WHATSAPP] Send failed:', response.status, providerMessage ?? rawText);
      return {
        success: false,
        errorCode: 'provider_error',
        providerMessage: providerMessage ?? (rawText || null),
        messageId: null,
      };
    }

    const messageId = getMessageId(parsedPayload);
    console.log('[WHATSAPP] Reset code sent successfully, messageId:', messageId ?? 'unknown');
    return {
      success: true,
      errorCode: null,
      providerMessage: null,
      messageId,
    };
  } catch (error) {
    console.log('[WHATSAPP] Network error while sending reset code:', error);
    return {
      success: false,
      errorCode: 'network_error',
      providerMessage: error instanceof Error ? error.message : null,
      messageId: null,
    };
  }
}
