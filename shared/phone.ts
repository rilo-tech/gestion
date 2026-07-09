export type PhoneCountryOption = {
  iso: string;
  dial: string;
  label: string;
  stripLeadingZero?: boolean;
  localMinLength: number;
  localMaxLength: number;
};

export const DEFAULT_PHONE_DIAL = '598';

export const PHONE_COUNTRY_OPTIONS: PhoneCountryOption[] = [
  { iso: 'UY', dial: '598', label: 'Uruguay', stripLeadingZero: true, localMinLength: 8, localMaxLength: 9 },
  { iso: 'AR', dial: '54', label: 'Argentina', localMinLength: 10, localMaxLength: 11 },
  { iso: 'BR', dial: '55', label: 'Brasil', localMinLength: 10, localMaxLength: 11 },
  { iso: 'CL', dial: '56', label: 'Chile', localMinLength: 9, localMaxLength: 9 },
  { iso: 'PY', dial: '595', label: 'Paraguay', localMinLength: 9, localMaxLength: 9 },
  { iso: 'BO', dial: '591', label: 'Bolivia', localMinLength: 8, localMaxLength: 8 },
  { iso: 'PE', dial: '51', label: 'Perú', localMinLength: 9, localMaxLength: 9 },
  { iso: 'CO', dial: '57', label: 'Colombia', localMinLength: 10, localMaxLength: 10 },
  { iso: 'MX', dial: '52', label: 'México', localMinLength: 10, localMaxLength: 10 },
  { iso: 'ES', dial: '34', label: 'España', localMinLength: 9, localMaxLength: 9 },
  { iso: 'US', dial: '1', label: 'Estados Unidos', localMinLength: 10, localMaxLength: 10 },
];

const COUNTRY_NAME_TO_DIAL: Record<string, string> = {
  uruguay: '598',
  uy: '598',
  argentina: '54',
  ar: '54',
  brasil: '55',
  brazil: '55',
  br: '55',
  chile: '56',
  cl: '56',
  paraguay: '595',
  py: '595',
  bolivia: '591',
  bo: '591',
  peru: '51',
  perú: '51',
  pe: '51',
  colombia: '57',
  co: '57',
  mexico: '52',
  méxico: '52',
  mx: '52',
  espana: '34',
  españa: '34',
  spain: '34',
  es: '34',
  'estados unidos': '1',
  usa: '1',
  us: '1',
};

function findCountryByDial(dial: string): PhoneCountryOption | undefined {
  return PHONE_COUNTRY_OPTIONS.find((c) => c.dial === dial);
}

export function dialFromCountryName(pais: string): string | null {
  const key = pais.trim().toLowerCase();
  const byLabel = PHONE_COUNTRY_OPTIONS.find(
    (c) => c.label.toLowerCase() === key || c.iso.toLowerCase() === key
  );
  if (byLabel) return byLabel.dial;
  return COUNTRY_NAME_TO_DIAL[key] ?? null;
}

export function normalizePhoneParts(dialCode: string, localInput: string): string {
  const dial = dialCode.replace(/\D/g, '');
  let local = localInput.replace(/\D/g, '');
  if (!dial || !local) return '';

  const country = findCountryByDial(dial);
  if (country?.stripLeadingZero && local.startsWith('0')) {
    local = local.replace(/^0+/, '');
  }

  return `+${dial}${local}`;
}

/** Normaliza un número completo o local a formato E.164 (+XXXXXXXX). */
export function normalizePhone(input: string, defaultDial = DEFAULT_PHONE_DIAL): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  const sorted = [...PHONE_COUNTRY_OPTIONS].sort((a, b) => b.dial.length - a.dial.length);
  for (const country of sorted) {
    if (digits.startsWith(country.dial) && digits.length > country.dial.length + country.localMinLength - 1) {
      return normalizePhoneParts(country.dial, digits.slice(country.dial.length));
    }
  }

  if (defaultDial === '598' && digits.length === 8) {
    return normalizePhoneParts('598', digits);
  }
  if (defaultDial === '598' && digits.length === 9 && digits.startsWith('0')) {
    return normalizePhoneParts('598', digits);
  }

  if (trimmed.startsWith('+')) return `+${digits}`;
  return normalizePhoneParts(defaultDial, digits);
}

export function parsePhoneInput(
  dialCode: string | undefined,
  localInput: string,
  fallbackDial = DEFAULT_PHONE_DIAL
): string {
  const local = localInput.trim();
  if (!local) return '';

  const dial = (dialCode ?? fallbackDial).replace(/\D/g, '') || fallbackDial;
  if (local.startsWith('+') || (!dialCode && local.replace(/\D/g, '').length > 11)) {
    return normalizePhone(local, dial);
  }
  return normalizePhoneParts(dial, local);
}

export function isValidE164Phone(e164: string): boolean {
  return /^\+\d{10,15}$/.test(e164);
}

export function isValidPhoneForCountry(dialCode: string, localInput: string): boolean {
  const dial = dialCode.replace(/\D/g, '');
  const local = localInput.replace(/\D/g, '').replace(/^0+/, '');
  const country = findCountryByDial(dial);
  if (!country || !dial || !local) return false;
  return local.length >= country.localMinLength && local.length <= country.localMaxLength;
}

export function formatPhoneDisplay(e164: string): string {
  if (!e164.startsWith('+')) return e164;
  const digits = e164.slice(1);
  const sorted = [...PHONE_COUNTRY_OPTIONS].sort((a, b) => b.dial.length - a.dial.length);
  for (const country of sorted) {
    if (digits.startsWith(country.dial)) {
      const local = digits.slice(country.dial.length);
      return `+${country.dial} ${local}`;
    }
  }
  return e164;
}

export function phoneCountryLabel(dialCode: string): string {
  const dial = dialCode.replace(/\D/g, '');
  const country = findCountryByDial(dial);
  return country ? `${country.label} (+${country.dial})` : `+${dial}`;
}
