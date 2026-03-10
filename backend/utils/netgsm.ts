const NETGSM_API_URL = 'https://api.netgsm.com.tr/sms/send/xml';

function sanitizeNetgsmEnvValue(value: string | undefined): string {
  const trimmedValue = value?.trim() ?? '';
  if (!trimmedValue) {
    return '';
  }

  return trimmedValue
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '')
    .replace(/[\r\n\t]+/g, '')
    .trim();
}

function normalizeNetgsmMsgHeader(value: string): string {
  return sanitizeNetgsmEnvValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ıİ]/g, 'I')
    .replace(/[şŞ]/g, 'S')
    .replace(/[ğĞ]/g, 'G')
    .replace(/[üÜ]/g, 'U')
    .replace(/[öÖ]/g, 'O')
    .replace(/[çÇ]/g, 'C')
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .trim();
}

function readNetgsmEnvValue(...keys: string[]): string {
  for (const key of keys) {
    const value = sanitizeNetgsmEnvValue(process.env[key]);
    if (value) {
      return value;
    }
  }

  return '';
}

function buildNetgsmMsgHeaderCandidates(value: string): string[] {
  const exactValue = sanitizeNetgsmEnvValue(value);
  const normalizedValue = normalizeNetgsmMsgHeader(value);
  const candidates = [exactValue, normalizedValue].filter((item): item is string => Boolean(item));
  return Array.from(new Set(candidates));
}

const NETGSM_USERCODE = readNetgsmEnvValue('NETGSM_USERCODE', 'NETGSM_USER_CODE', 'NETGSM_USERNAME');
const NETGSM_PASSWORD = readNetgsmEnvValue('NETGSM_PASSWORD', 'NETGSM_USER_PASSWORD');
const NETGSM_MSGHEADER = readNetgsmEnvValue('NETGSM_MSGHEADER', 'NETGSM_HEADER', 'NETGSM_SENDER');
const NETGSM_MSGHEADER_CANDIDATES = buildNetgsmMsgHeaderCandidates(NETGSM_MSGHEADER);
const PRIMARY_NETGSM_MSGHEADER = NETGSM_MSGHEADER_CANDIDATES[0] ?? '';

function getMissingNetgsmConfigKeys(): string[] {
  const missingKeys: string[] = [];

  if (!NETGSM_USERCODE) {
    missingKeys.push('NETGSM_USERCODE');
  }

  if (!NETGSM_PASSWORD) {
    missingKeys.push('NETGSM_PASSWORD');
  }

  if (!NETGSM_MSGHEADER) {
    missingKeys.push('NETGSM_MSGHEADER');
  }

  return missingKeys;
}

export type SendNetgsmErrorCode = 'not_configured' | 'invalid_phone' | 'provider_error' | 'network_error';
export type NetgsmCodePurpose = 'password_reset' | 'account_verification';

export interface SendNetgsmCodeSmsParams {
  toPhone: string;
  code: string;
  purpose?: NetgsmCodePurpose;
}

export interface SendNetgsmCodeSmsResult {
  success: boolean;
  errorCode: SendNetgsmErrorCode | null;
  providerMessage: string | null;
  messageId: string | null;
}

export type SendPasswordResetSmsParams = Omit<SendNetgsmCodeSmsParams, 'purpose'>;
export type SendPasswordResetSmsResult = SendNetgsmCodeSmsResult;

export interface NetgsmConfigStatus {
  configured: boolean;
  missingKeys: string[];
  senderName: string | null;
  normalizedSenderName: string | null;
  senderVariants: string[];
}

export function getNetgsmConfigStatus(): NetgsmConfigStatus {
  const missingKeys = getMissingNetgsmConfigKeys();
  const normalizedSenderName = NETGSM_MSGHEADER_CANDIDATES[1] ?? PRIMARY_NETGSM_MSGHEADER ?? null;

  return {
    configured: missingKeys.length === 0,
    missingKeys,
    senderName: PRIMARY_NETGSM_MSGHEADER || null,
    normalizedSenderName,
    senderVariants: NETGSM_MSGHEADER_CANDIDATES,
  };
}

function buildNetgsmCodeMessage(code: string, purpose: NetgsmCodePurpose): string {
  if (purpose === 'account_verification') {
    return `2GO hesap dogrulama kodunuz: ${code}. Bu kodu kimseyle paylasmayin.`;
  }

  return `2GO sifre sifirlama kodunuz: ${code}. Bu kodu kimseyle paylasmayin.`;
}

function hasNetgsmConfig(): boolean {
  return getMissingNetgsmConfigKeys().length === 0;
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

function getNetgsmProviderMessage(rawText: string, status: number, attemptedHeader?: string): string {
  const code = extractProviderCode(rawText);
  if (code === '20') {
    return 'SMS metni geçersiz veya karakter limiti aşıldı.';
  }

  if (code === '30') {
    return 'NetGSM kullanıcı bilgileri geçersiz veya API yetkisi kapalı.';
  }

  if (code === '40') {
    const headerSuffix = attemptedHeader ? ` Denenen başlık: ${attemptedHeader}.` : '';
    return `NetGSM mesaj başlığı sistemde tanımlı değil.${headerSuffix} NETGSM_MSGHEADER değeri, NetGSM panelindeki onaylı başlık ile birebir aynı olmalı. Başlık İşlemleri bölümündeki aktif başlığı kopyalayıp env alanına yapıştırın ve uygulamayı yeniden başlatın.`;
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

export function getNetgsmSendErrorMessage(result: SendNetgsmCodeSmsResult): string {
  if (result.errorCode === 'not_configured') {
    return 'SMS servisi henüz yapılandırılmadı. NetGSM bilgilerini ekleyip tekrar deneyin.';
  }

  if (result.errorCode === 'invalid_phone') {
    return 'Kayıtlı telefon numarası geçerli değil. Lütfen profil telefon numarasını kontrol edin.';
  }

  if (result.errorCode === 'provider_error') {
    const providerMessage = result.providerMessage?.trim() ?? '';
    if (providerMessage.includes('mesaj başlığı sistemde tanımlı değil')) {
      return providerMessage;
    }

    return providerMessage || 'SMS gönderilemedi. Lütfen tekrar deneyin.';
  }

  return 'SMS servisine bağlanılamadı. Lütfen tekrar deneyin.';
}

export async function sendNetgsmCodeSms(params: SendNetgsmCodeSmsParams): Promise<SendNetgsmCodeSmsResult> {
  if (!hasNetgsmConfig()) {
    console.log('[NETGSM] Missing NetGSM SMS config. Missing keys:', getMissingNetgsmConfigKeys().join(', '));
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

  const purpose = params.purpose ?? 'password_reset';
  const message = buildNetgsmCodeMessage(params.code, purpose);

  try {
    let lastProviderMessage: string | null = null;

    for (const currentMsgHeader of NETGSM_MSGHEADER_CANDIDATES) {
      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<mainbody>
  <header>
    <company dil="TR">Netgsm</company>
    <usercode>${escapeXml(NETGSM_USERCODE)}</usercode>
    <password>${escapeXml(NETGSM_PASSWORD)}</password>
    <type>1:n</type>
    <msgheader>${escapeXml(currentMsgHeader)}</msgheader>
  </header>
  <body>
    <msg><![CDATA[${message}]]></msg>
    <no>${escapeXml(normalizedPhone)}</no>
  </body>
</mainbody>`;

      console.log('[NETGSM] Sending auth SMS to:', normalizedPhone, 'purpose:', purpose, 'msgheader:', currentMsgHeader, 'msgheaderLength:', currentMsgHeader.length, 'allHeaders:', NETGSM_MSGHEADER_CANDIDATES.join(' | '));

      const response = await fetch(NETGSM_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=UTF-8',
          Accept: 'text/plain, text/xml, application/xml;q=0.9, */*;q=0.8',
        },
        body: xmlPayload,
      });

      const rawText = (await response.text()).trim();
      console.log('[NETGSM] SMS response status:', response.status, 'msgheader:', currentMsgHeader, 'body:', rawText || 'empty');

      if (!response.ok) {
        const providerMessage = getNetgsmProviderMessage(rawText, response.status, currentMsgHeader);
        lastProviderMessage = providerMessage;
        const providerCode = extractProviderCode(rawText);
        const shouldRetryWithNextHeader = providerCode === '40' && currentMsgHeader !== NETGSM_MSGHEADER_CANDIDATES[NETGSM_MSGHEADER_CANDIDATES.length - 1];
        if (shouldRetryWithNextHeader) {
          console.log('[NETGSM] Retrying with next sender header candidate after code 40:', currentMsgHeader);
          continue;
        }

        return {
          success: false,
          errorCode: 'provider_error',
          providerMessage,
          messageId: null,
        };
      }

      const providerCode = extractProviderCode(rawText);
      if (providerCode && ['20', '30', '40', '50', '60', '70', '80', '85'].includes(providerCode)) {
        const providerMessage = getNetgsmProviderMessage(rawText, response.status, currentMsgHeader);
        lastProviderMessage = providerMessage;
        const shouldRetryWithNextHeader = providerCode === '40' && currentMsgHeader !== NETGSM_MSGHEADER_CANDIDATES[NETGSM_MSGHEADER_CANDIDATES.length - 1];
        if (shouldRetryWithNextHeader) {
          console.log('[NETGSM] Retrying with next sender header candidate after provider code 40:', currentMsgHeader);
          continue;
        }

        return {
          success: false,
          errorCode: 'provider_error',
          providerMessage,
          messageId: null,
        };
      }

      const messageId = extractMessageId(rawText);
      console.log('[NETGSM] Auth SMS sent successfully, purpose:', purpose, 'messageId:', messageId ?? 'unknown', 'msgheader:', currentMsgHeader);
      return {
        success: true,
        errorCode: null,
        providerMessage: null,
        messageId,
      };
    }

    return {
      success: false,
      errorCode: 'provider_error',
      providerMessage: lastProviderMessage ?? 'NetGSM mesaj başlığı sistemde tanımlı değil.',
      messageId: null,
    };
  } catch (error) {
    console.log('[NETGSM] Network error while sending auth SMS:', error);
    return {
      success: false,
      errorCode: 'network_error',
      providerMessage: error instanceof Error ? error.message : null,
      messageId: null,
    };
  }
}

export async function sendPasswordResetSmsCode(params: SendPasswordResetSmsParams): Promise<SendPasswordResetSmsResult> {
  return sendNetgsmCodeSms({
    ...params,
    purpose: 'password_reset',
  });
}

export async function sendVerificationSmsCode(params: Omit<SendNetgsmCodeSmsParams, 'purpose'>): Promise<SendNetgsmCodeSmsResult> {
  return sendNetgsmCodeSms({
    ...params,
    purpose: 'account_verification',
  });
}
