export const TURKISH_PHONE_LENGTH = 11;
export const TURKISH_PHONE_PREFIX = '0';

export function normalizeTurkishPhone(value: string | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(0, TURKISH_PHONE_LENGTH);
}

export function isValidTurkishPhone(value: string | undefined): boolean {
  const normalizedPhone = normalizeTurkishPhone(value);
  return normalizedPhone.length === TURKISH_PHONE_LENGTH && normalizedPhone.startsWith(TURKISH_PHONE_PREFIX);
}

export function getTurkishPhoneValidationError(value: string | undefined): string | null {
  const normalizedPhone = normalizeTurkishPhone(value);

  if (!normalizedPhone) {
    return 'Telefon numarası gerekli';
  }

  if (!normalizedPhone.startsWith(TURKISH_PHONE_PREFIX)) {
    return 'Telefon numarası 0 ile başlamalı';
  }

  if (normalizedPhone.length !== TURKISH_PHONE_LENGTH) {
    return 'Telefon numarası 11 haneli olmalı';
  }

  return null;
}
