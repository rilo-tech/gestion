/**
 * Feature flag del lector de códigos de barras (ERP web).
 *
 * Kill-switch global: BARCODE_SCANNER_DISABLED=true (env) o BARCODE_SCANNER_KILL_SWITCH.
 * Beta IDs: siempre habilitados (compat).
 * Producción: habilitado cuando el negocio tiene ERP web operativo.
 */
export const BARCODE_SCANNER_BETA_BUSINESS_IDS = ['rilo'] as const;

/** Kill-switch en código (además de env). */
export const BARCODE_SCANNER_KILL_SWITCH = false;

export function isBarcodeScannerGloballyDisabled(): boolean {
  if (BARCODE_SCANNER_KILL_SWITCH) return true;
  const env =
    typeof process !== 'undefined'
      ? String(process.env?.BARCODE_SCANNER_DISABLED ?? '')
          .trim()
          .toLowerCase()
      : '';
  return env === '1' || env === 'true' || env === 'yes';
}

export function isBarcodeScannerBetaBusiness(
  businessId: string | null | undefined
): boolean {
  const id = String(businessId ?? '')
    .trim()
    .toLowerCase();
  if (!id) return false;
  return (BARCODE_SCANNER_BETA_BUSINESS_IDS as readonly string[]).includes(id);
}

/**
 * @param opts.erpWebEnabled — si el tenant opera ERP web (Gestión / Completo / etc.)
 */
export function isBarcodeScannerEnabledForBusiness(
  businessId: string | null | undefined,
  opts?: { erpWebEnabled?: boolean | null }
): boolean {
  if (isBarcodeScannerGloballyDisabled()) return false;
  const id = String(businessId ?? '')
    .trim()
    .toLowerCase();
  if (!id) return false;
  if (isBarcodeScannerBetaBusiness(id)) return true;
  if (opts?.erpWebEnabled === true) return true;
  // Sin info de producto: no abrir a todos (requiere erpWebEnabled o beta).
  return false;
}
