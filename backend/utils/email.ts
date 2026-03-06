const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim() ?? '';
const RAW_FROM_EMAIL = process.env.FROM_EMAIL?.trim() ?? '';

export type SendEmailErrorCode = 'missing_api_key' | 'missing_from_email' | 'invalid_from_email' | 'resend_error' | 'network_error';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  success: boolean;
  errorCode: SendEmailErrorCode | null;
  providerMessage: string | null;
  responseId: string | null;
}

function extractEmailAddress(value: string): string {
  const angleMatch = value.match(/<([^>]+)>/);
  return angleMatch?.[1]?.trim() ?? value.trim();
}

function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function resolveFromEmail(): { value: string | null; errorCode: SendEmailErrorCode | null; isTestAddress: boolean } {
  if (!RAW_FROM_EMAIL) {
    if (RESEND_API_KEY) {
      console.log('[EMAIL] FROM_EMAIL not set, using Resend test address (onboarding@resend.dev). Emails will only be delivered to the Resend account owner email.');
      return { value: 'onboarding@resend.dev', errorCode: null, isTestAddress: true };
    }
    return { value: null, errorCode: 'missing_from_email', isTestAddress: false };
  }

  const extractedEmail = extractEmailAddress(RAW_FROM_EMAIL);
  if (!isValidEmailAddress(extractedEmail)) {
    return { value: null, errorCode: 'invalid_from_email', isTestAddress: false };
  }

  return { value: RAW_FROM_EMAIL, errorCode: null, isTestAddress: false };
}

const FROM_EMAIL_CONFIG = resolveFromEmail();

if (!RESEND_API_KEY) {
  console.log('[EMAIL] WARNING: RESEND_API_KEY env var not set. Email sending is disabled.');
}

if (FROM_EMAIL_CONFIG.errorCode === 'missing_from_email') {
  console.log('[EMAIL] WARNING: FROM_EMAIL env var not set and no RESEND_API_KEY. Email sending is fully disabled.');
} else if (FROM_EMAIL_CONFIG.isTestAddress) {
  console.log('[EMAIL] INFO: Using Resend test address. To send to any email, set FROM_EMAIL with a verified domain.');
}

if (FROM_EMAIL_CONFIG.errorCode === 'invalid_from_email') {
  console.log('[EMAIL] WARNING: FROM_EMAIL env var is invalid:', RAW_FROM_EMAIL);
}

function getProviderMessage(result: unknown): string | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const message = 'message' in result ? result.message : null;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }

  const error = 'error' in result ? result.error : null;
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return null;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) {
    return {
      success: false,
      errorCode: 'missing_api_key',
      providerMessage: null,
      responseId: null,
    };
  }

  if (!FROM_EMAIL_CONFIG.value) {
    return {
      success: false,
      errorCode: FROM_EMAIL_CONFIG.errorCode ?? 'missing_from_email',
      providerMessage: null,
      responseId: null,
    };
  }

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        '[EMAIL] Sending email to:',
        params.to,
        'subject:',
        params.subject,
        'from:',
        FROM_EMAIL_CONFIG.value,
        'attempt:',
        attempt + 1,
      );

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL_CONFIG.value,
          to: [params.to],
          subject: params.subject,
          html: params.html,
        }),
      });

      let result: unknown = null;
      try {
        result = await response.json();
      } catch (parseErr) {
        console.log('[EMAIL] Could not parse Resend response JSON:', parseErr);
      }

      const providerMessage = getProviderMessage(result);

      if (!response.ok) {
        console.log('[EMAIL] Send failed:', response.status, providerMessage ?? 'No provider message');
        if (attempt < maxRetries && response.status >= 500) {
          console.log('[EMAIL] Server error, retrying in 1s...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        return {
          success: false,
          errorCode: 'resend_error',
          providerMessage,
          responseId: null,
        };
      }

      const responseId = result && typeof result === 'object' && 'id' in result && typeof result.id === 'string'
        ? result.id
        : null;

      console.log('[EMAIL] Sent successfully, id:', responseId ?? 'unknown');
      return {
        success: true,
        errorCode: null,
        providerMessage: null,
        responseId,
      };
    } catch (err) {
      console.log('[EMAIL] Send error (attempt', attempt + 1, '):', err);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      return {
        success: false,
        errorCode: 'network_error',
        providerMessage: err instanceof Error ? err.message : null,
        responseId: null,
      };
    }
  }

  return {
    success: false,
    errorCode: 'network_error',
    providerMessage: 'Unknown email send failure',
    responseId: null,
  };
}

export function generateResetCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function buildVerificationCodeEmail(code: string, userName: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background: #0A0A12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 480px; margin: 0 auto; padding: 40px 24px; }
    .logo { text-align: center; margin-bottom: 32px; }
    .logo span { font-size: 36px; font-weight: 900; color: #F5A623; letter-spacing: -1px; }
    .card { background: rgba(18,18,30,0.95); border-radius: 20px; padding: 32px 24px; border: 1px solid rgba(245,166,35,0.15); }
    h2 { color: #FFFFFF; font-size: 20px; margin: 0 0 8px 0; text-align: center; }
    .subtitle { color: rgba(255,255,255,0.5); font-size: 14px; text-align: center; margin-bottom: 28px; }
    .code-box { background: rgba(245,166,35,0.1); border: 2px dashed rgba(245,166,35,0.4); border-radius: 14px; padding: 20px; text-align: center; margin: 24px 0; }
    .code { font-size: 36px; font-weight: 900; color: #F5A623; letter-spacing: 8px; }
    .warning { color: rgba(255,255,255,0.35); font-size: 12px; text-align: center; margin-top: 24px; line-height: 1.6; }
    .footer { text-align: center; margin-top: 32px; color: rgba(255,255,255,0.25); font-size: 11px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo"><span>2GO</span></div>
    <div class="card">
      <h2>E-posta Doğrulama</h2>
      <p class="subtitle">Merhaba ${userName}, hesabınızı doğrulamak için aşağıdaki kodu kullanın.</p>
      <div class="code-box">
        <div class="code">${code}</div>
      </div>
      <p class="warning">
        Bu kodu kimseyle paylaşmayın.<br/>
        Kod 10 dakika içinde geçerliliğini yitirecektir.<br/>
        Eğer bu işlemi siz yapmadıysanız, bu e-postayı görmezden gelin.
      </p>
    </div>
    <p class="footer">© 2GO - Güvenli Ulaşım</p>
  </div>
</body>
</html>`;
}

export function buildResetCodeEmail(code: string, userName: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background: #0A0A12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 480px; margin: 0 auto; padding: 40px 24px; }
    .logo { text-align: center; margin-bottom: 32px; }
    .logo span { font-size: 36px; font-weight: 900; color: #F5A623; letter-spacing: -1px; }
    .card { background: rgba(18,18,30,0.95); border-radius: 20px; padding: 32px 24px; border: 1px solid rgba(245,166,35,0.15); }
    h2 { color: #FFFFFF; font-size: 20px; margin: 0 0 8px 0; text-align: center; }
    .subtitle { color: rgba(255,255,255,0.5); font-size: 14px; text-align: center; margin-bottom: 28px; }
    .code-box { background: rgba(245,166,35,0.1); border: 2px dashed rgba(245,166,35,0.4); border-radius: 14px; padding: 20px; text-align: center; margin: 24px 0; }
    .code { font-size: 36px; font-weight: 900; color: #F5A623; letter-spacing: 8px; }
    .warning { color: rgba(255,255,255,0.35); font-size: 12px; text-align: center; margin-top: 24px; line-height: 1.6; }
    .footer { text-align: center; margin-top: 32px; color: rgba(255,255,255,0.25); font-size: 11px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo"><span>2GO</span></div>
    <div class="card">
      <h2>Şifre Sıfırlama</h2>
      <p class="subtitle">Merhaba ${userName}, şifre sıfırlama kodunuz aşağıdadır.</p>
      <div class="code-box">
        <div class="code">${code}</div>
      </div>
      <p class="warning">
        Bu kodu kimseyle paylaşmayın.<br/>
        Kod 10 dakika içinde geçerliliğini yitirecektir.<br/>
        Eğer bu işlemi siz yapmadıysanız, bu e-postayı görmezden gelin.
      </p>
    </div>
    <p class="footer">© 2GO - Güvenli Ulaşım</p>
  </div>
</body>
</html>`;
}
