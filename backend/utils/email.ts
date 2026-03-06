const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || '2GO <onboarding@resend.dev>';

if (!process.env.FROM_EMAIL) {
  console.log('[EMAIL] WARNING: FROM_EMAIL env var not set. Using Resend test address. To send to any email, verify a domain in Resend dashboard and set FROM_EMAIL env var.');
}

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(params: SendEmailParams): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log('[EMAIL] No RESEND_API_KEY configured, skipping email send');
    return false;
  }

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log('[EMAIL] Sending email to:', params.to, 'subject:', params.subject, 'attempt:', attempt + 1);

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [params.to],
          subject: params.subject,
          html: params.html,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        console.log('[EMAIL] Send failed:', response.status, JSON.stringify(result));
        if (attempt < maxRetries && response.status >= 500) {
          console.log('[EMAIL] Server error, retrying in 1s...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        return false;
      }

      console.log('[EMAIL] Sent successfully, id:', result.id);
      return true;
    } catch (err) {
      console.log('[EMAIL] Send error (attempt', attempt + 1, '):', err);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      return false;
    }
  }
  return false;
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
