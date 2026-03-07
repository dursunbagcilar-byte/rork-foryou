export const SUPPORT_WHATSAPP_NUMBER = '905516300624';
export const SUPPORT_WHATSAPP_DISPLAY = '0551 630 06 24';
export const SUPPORT_PHONE_TEL_URL = 'tel:+905516300624';
export const SUPPORT_WHATSAPP_URL = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`;

export function buildSupportWhatsAppUrl(message: string): string {
  return `${SUPPORT_WHATSAPP_URL}?text=${encodeURIComponent(message)}`;
}
