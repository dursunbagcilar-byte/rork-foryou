export const SUPPORT_WHATSAPP_NUMBER = '905516300624';
export const SUPPORT_WHATSAPP_DISPLAY = '0551 630 06 24';
export const SUPPORT_PHONE_TEL_URL = 'tel:+905516300624';
export const SUPPORT_WHATSAPP_URL = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`;

export function buildSupportWhatsAppUrl(message: string): string {
  return `${SUPPORT_WHATSAPP_URL}?text=${encodeURIComponent(message)}`;
}

export function normalizePhoneForWhatsApp(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0090') && digits.length >= 14) return digits.slice(2);
  if (digits.startsWith('90') && digits.length >= 12) return digits;
  if (digits.startsWith('0') && digits.length === 11) return `90${digits.slice(1)}`;
  if (digits.length === 10) return `90${digits}`;
  return digits;
}

export function getWhatsAppDeliveryNote(maskedPhone?: string | null): string {
  const phoneLabel = maskedPhone ? ` ${maskedPhone}` : '';
  return `Kod, kayıtlı${phoneLabel} numarasının bağlı olduğu WhatsApp hesabına gönderilir. WhatsApp veya WhatsApp Business fark etmez.`;
}

export function getWhatsAppSupportDeliveryNote(maskedPhone?: string | null): string {
  const phoneLabel = maskedPhone ? ` ${maskedPhone}` : '';
  return `Otomatik gönderim kullanılamazsa talep destek hattına açılır ve kod, kayıtlı${phoneLabel} numarasının bağlı olduğu WhatsApp hesabı için hazırlanır.`;
}

function isEmailLike(value: string): boolean {
  return value.includes('@');
}

export function buildPasswordResetSupportMessage(identifier: string, maskedPhone: string | null, reason?: string): string {
  const trimmedIdentifier = identifier.trim();
  const identifierLabel = isEmailLike(trimmedIdentifier) ? 'E-posta' : 'Telefon';
  const lines: string[] = [
    'Merhaba 2GO destek,',
    'şifre sıfırlama kodu talep ediyorum.',
    `${identifierLabel}: ${trimmedIdentifier || 'belirtilmedi'}`,
    `Kayıtlı telefon: ${maskedPhone ?? 'sistemde kontrol ediniz'}`,
    getWhatsAppSupportDeliveryNote(maskedPhone),
  ];

  if (reason) {
    lines.push(`Not: ${reason}`);
  }

  return lines.join('\n');
}

export function buildPasswordResetSupportWhatsAppUrl(identifier: string, maskedPhone: string | null, reason?: string): string {
  return buildSupportWhatsAppUrl(buildPasswordResetSupportMessage(identifier, maskedPhone, reason));
}
