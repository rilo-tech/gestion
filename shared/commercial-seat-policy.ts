import type { TrialProductId } from './platform-access.ts';

/** Seats de panel web: solo Gestión / Completo. Bot no vende “usuario adicional”. */
export function productSellsErpUserAddons(productId: TrialProductId | null | undefined): boolean {
  return productId === 'erp' || productId === 'completo';
}

/** Líneas WhatsApp cobrables: Bot / Caja / Completo. Gestión no vende números. */
export function productSellsWhatsappNumberAddons(
  productId: TrialProductId | null | undefined
): boolean {
  return productId === 'cash' || productId === 'whatsapp' || productId === 'completo';
}
