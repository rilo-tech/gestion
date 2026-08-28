/** Convención RILO: el nombre del cliente suele ser «Nombre Apellido + celular», y el cel también va en `telefono`. */

const TRAILING_PHONE_RE = /^(.*?)[\s,;:\-–—]*(\+?\d[\d\s\-().]{6,})$/;
const PHONE_TOKEN_RE = /^\+?\d[\d\-().]{5,}$/;

export function phoneMatchKey(value: string): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length >= 8) return digits.slice(-8);
  return digits;
}

export function looksLikePhoneQuery(value: string): boolean {
  const digits = String(value ?? '').replace(/\D/g, '');
  const letters = String(value ?? '').replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
  return digits.length >= 8 && letters.length < 3;
}

export function parsePersonNameAndPhone(raw: string): { nombre: string; telefono: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { nombre: '', telefono: '' };
  const match = text.match(TRAILING_PHONE_RE);
  if (!match?.[1]?.trim() || !match[2]) {
    if (looksLikePhoneQuery(text)) return { nombre: '', telefono: formatLocalPhone(text) };
    return { nombre: text, telefono: '' };
  }
  return {
    nombre: match[1].trim().replace(/[\s\-–—]+$/, ''),
    telefono: formatLocalPhone(match[2]),
  };
}

/** Uruguay: 09xxxxxxx si es un 8 dígitos que empiezan en 9. */
export function formatLocalPhone(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 8 && digits.startsWith('9')) return `0${digits}`;
  if (digits.length === 11 && digits.startsWith('598')) return `0${digits.slice(3)}`;
  if (digits.length === 9 && digits.startsWith('0')) return digits;
  if (raw.trim().startsWith('+')) return `+${digits}`;
  return digits.startsWith('0') ? digits : raw.replace(/[\s\-().]/g, '').trim() || digits;
}

export function nameTokensWithoutPhone(normalized: string): string[] {
  return String(normalized ?? '')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token && token !== '-' && !PHONE_TOKEN_RE.test(token));
}

export function formatClientNombreConCel(nombre: string, telefono?: string): {
  nombre: string;
  telefono: string;
} {
  const parsed = parsePersonNameAndPhone(nombre);
  const phone = formatLocalPhone(telefono || parsed.telefono);
  const base = parsed.nombre.trim() || nombre.trim();
  if (!phone) return { nombre: base, telefono: '' };
  const already = phoneMatchKey(base) === phoneMatchKey(phone);
  return {
    nombre: already ? base : `${base} ${phone}`.trim(),
    telefono: phone,
  };
}
