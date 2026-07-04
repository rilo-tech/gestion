/** Misma normalización que el backend (`normalizeBarcodeKey`). */
export function normalizeBarcodeKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '');
}

export function looksLikeBarcodeQuery(value: string): boolean {
  const key = normalizeBarcodeKey(value);
  return key.length >= 4 && /^[0-9A-Za-z\-]+$/.test(key);
}

/** Limpia y valida un valor leído por cámara antes de usarlo. */
export function sanitizeScannedBarcode(value: unknown): string | null {
  let key = normalizeBarcodeKey(value);
  if (!key) return null;

  if (key.length >= 3 && key.startsWith('*') && key.endsWith('*')) {
    key = key.slice(1, -1);
  }

  if (/^\d+$/.test(key) && key.length >= 3) {
    return key;
  }

  return looksLikeBarcodeQuery(key) ? key : null;
}
