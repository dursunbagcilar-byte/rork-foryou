const NETGSM_API_URL = 'https://api.netgsm.com.tr/sms/send/xml';
const NETGSM_USERCODE = process.env.NETGSM_USERCODE?.trim() ?? process.env.NETGSM_USERNAME?.trim() ?? '';
const NETGSM_PASSWORD = process.env.NETGSM_PASSWORD?.trim() ?? process.env.NETGSM_USER_PASSWORD?.trim() ?? '';
const NETGSM_MSGHEADER = process.env.NETGSM_MSGHEADER?.trim() ?? process.env.NETGSM_HEADER?.trim() ?? '';

export type SendNetgsmErrorCode = 'not_configured' | 'invalid_phone' | 'provider_error' | 'network_error';

export interface SendPasswordResetSmsParams {
  toPhone: string;
  code: string;
}

export interface SendPasswordResetSmsResult {
  success: boolean;
  errorCode: SendNetgsmErrorCode | null;
  providerMessage: string | null;
  messageId: string | null;
}

function hasNetgsmConfig(): boolean {
  return Boolean(NETGSM_USERCODE && NETGSM_PASSWORD && NETGSM_MSGHEADER);
}

function normalizeNetgsmPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').trim();
  if (!digits) {
    return '';
  }

  if (digits.startsWith('0090') && digits.length >= 14) {
    return digits.slice(2);
  }

  if (digits.startsWith('90') && digits.length >= 12) {
    return digits;
  }

  if (digits.startsWith('0') && digits.length === 11) {
    return `90${digits.slice(1)}`;
  }

  if (digits.length === 10) {
    return `90${digits}`;
  }

  return digits;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function extractXmlValue(rawText: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}>([^<]+)</${tagName}>`, 'i');
  const match = rawText.match(regex);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

function extractMessageId(rawText: string): string | null {
  const xmlJobId = extractXmlValue(rawText, 'jobid');
  if (xmlJobId) {
    return xmlJobId;
  }

  const line = rawText.split(/[\r\n]+/).map((item) => item.trim()).find(Boolean) ?? '';
  const parts = line.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && /^\d+$/.test(parts[1])) {
    return parts[1];
  }

  const numericMatch = rawText.match(/\b\d{6,}\b/);
  return numericMatch?.[0] ?? null;
}

function extractProviderCode(rawText: string): string | null {
  const xmlCode = extractXmlValue(rawText, 'code');
  if (xmlCode) {
    return xmlCode;
  }

  const line = rawText.split(/[\r\n]+/).map((item) => item.trim()).find(Boolean) ?? '';
  const firstToken = line.split(/\s+/).find(Boolean) ?? '';
  return /^\d+$/.test(firstToken) ? firstToken : null;
}

function getNetgsmProviderMessage(rawText: string, status: number): string {
  const code = extractProviderCode(rawText);
  if (code === '20') {
    return 'SMS metni geçersiz veya karakter limiti aşıldı.';
  }

  if (code === '30') {
    return 'NetGSM kullanıcı bilgileri geçersiz veya API yetkisi kapalı.';
  }

  if (code === '40') {
    return 'NetGSM mesaj başlığı sistemde tanımlı değil.';
  }

  if (code === '50') {
    return 'NetGSM hesabı bu gönderime izin vermiyor.';
  }

  if (code === '60') {
    return 'NetGSM servisi isteği geçersiz buldu.';
  }

  if (code === '70') {
    return 'NetGSM servisi alıcı numarayı kabul etmedi.';
  }

  if (code === '80') {
    return 'NetGSM servisinde geçici bir hata oluştu.';
  }

  if (code === '85') {
    return 'NetGSM bakiyesi yetersiz.';
  }

  return rawText.trim() || `NetGSM isteği başarısız oldu (HTTP ${status}).`;
}

export function getNetgsmSendErrorMessage(result: SendPasswordResetSmsResult): string {
  if (result.errorCode === 'not_configured') {
    return 'SMS servisi henüz yapılandırılmadı. NetGSM bilgilerini ekleyip tekrar deneyin.';
  }

  if (result.errorCode === 'invalid_phone') {
    return 'Kayıtlı telefon numarası geçerli değil. Lütfen profil telefon numarasını kontrol edin.';
  }

  if (result.errorCode === 'provider_error') {
    return result.providerMessage?.trim() || 'SMS gönderilemedi. Lütfen tekrar deneyin.';
  }

  return 'SMS servisine bağlanılamadı. Lütfen tekrar deneyin.';
}

export async function sendPasswordResetSmsCode(params: SendPasswordResetSmsParams): Promise<SendPasswordResetSmsResult> {
  if (!hasNetgsmConfig()) {
    console.log('[NETGSM] Missing NetGSM SMS config');
    return {
      success: false,
      errorCode: 'not_configured',
      providerMessage: null,
      messageId: null,
    };
  }

  const normalizedPhone = normalizeNetgsmPhone(params.toPhone);
  if (!normalizedPhone) {
    console.log('[NETGSM] Invalid phone for reset code delivery:', params.toPhone);
    return {
      success: false,
      errorCode: 'invalid_phone',
      providerMessage: null,
      messageId: null,
    };
  }

  const message = `2GO sifre sifirlama kodunuz: ${params.code}. Bu kodu kimseyle paylasmayin.`;
  const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<mainbody>
  <header>
    <company dil="TR">Netgsm</company>
    <usercode>${escapeXml(NETGSM_USERCODE)}</usercode>
    <password>${escapeXml(NETGSM_PASSWORD)}</password>
    <type>1:n</type>
    <msgheader>${escapeXml(NETGSM_MSGHEADER)}</msgheader>
  </header>
  <body>
    <msg><![CDATA[${message}]]></msg>
    <no>${escapeXml(normalizedPhone)}</no>
  </body>
</mainbody>`;

  console.log('[NETGSM] Sending password reset SMS to:', normalizedPhone, 'msgheader:', NETGSM_MSGHEADER);

  try {
    const response = await fetch(NETGSM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=UTF-8',
        Accept: 'text/plain, text/xml, application/xml;q=0.9, */*;q=0.8',
      },
      body: xmlPayload,
    });

    const rawText = (await response.text()).trim();
    console.log('[NETGSM] SMS response status:', response.status, 'body:', rawText || 'empty');

    if (!response.ok) {
      return {
        success: false,
        errorCode: 'provider_error',
        providerMessage: getNetgsmProviderMessage(rawText, response.status),
        messageId: null,
      };
    }

    const providerCode = extractProviderCode(rawText);
    if (providerCode && ['20', '30', '40', '50', '60', '70', '80', '85'].includes(providerCode)) {
      return {
        success: false,
        errorCode: 'provider_error',
        providerMessage: getNetgsmProviderMessage(rawText, response.status),
        messageId: null,
      };
    }

    const messageId = extractMessageId(rawText);
    console.log('[NETGSM] Reset SMS sent successfully, messageId:', messageId ?? 'unknown');
    return {
      success: true,
      errorCode: null,
      providerMessage: null,
      messageId,
    };
  } catch (error) {
    console.log('[NETGSM] Network error while sending reset SMS:', error);
    return {
      success: false,
      errorCode: 'network_error',
      providerMessage: error instanceof Error ? error.message : null,
      messageId: null,
    };
  }
}
