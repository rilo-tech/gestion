import {
  loadFinanzasConfig,
  medioPagoGeneratesImmediateCash,
  medioPagoGeneratesPayables,
  medioPagoRequiereCuentaHija,
  type MedioPagoConfig,
  type TarjetaConfig,
} from '../utils/finance-config.ts';
import { todayDateOnly } from './lookups.ts';
import type { WhatsappCommandEntities } from './ai-command-parser.ts';

export const SELECT_PAYMENT_INTENT = 'select_purchase_payment';
export const SELECT_CARD_INTENT = 'select_purchase_card';

export const DRAFT_REQUEST =
  /\b(borrador|despu[eé]s|completar (en )?el panel|lo completo yo|guardar borrador)\b/i;

export type PurchasePaymentContext = {
  medios: MedioPagoConfig[];
  tarjetas: TarjetaConfig[];
};

export async function loadPurchasePaymentContext(
  businessId: string
): Promise<PurchasePaymentContext> {
  const finanzas = await loadFinanzasConfig(businessId);
  return {
    medios: (finanzas.mediosPago ?? []).filter((medio) => medio.activo !== false),
    tarjetas: (finanzas.tarjetas ?? []).filter((tarjeta) => tarjeta.activa !== false),
  };
}

export function isDraftRequest(text: string): boolean {
  return DRAFT_REQUEST.test(String(text ?? '').trim());
}

export function extractPaymentCuotas(text: string): number | undefined {
  const match = String(text ?? '').match(/(\d{1,2})\s*cuotas?/i);
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return Math.min(120, n);
}

function normalize(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const HINT_ALIASES: Array<{ ids: string[]; patterns: RegExp }> = [
  { ids: ['efectivo'], patterns: [/\b(efectivo|contado|cash|en plata)\b/i] },
  { ids: ['transferencia'], patterns: [/\b(transferencia|transf\.?|banco|debito automatico)\b/i] },
  { ids: ['debito'], patterns: [/\b(debito|d[eé]bito)\b/i] },
  { ids: ['mercado_pago'], patterns: [/\b(mercado\s*pago|mercadopago|\bmp\b)\b/i] },
  { ids: ['tarjeta_credito', 'credito'], patterns: [/\b(tarjeta|visa|mastercard|amex|cr[eé]dito)\b/i] },
  {
    ids: ['proveedor'],
    patterns: [/\b(proveedor|fiado|cuenta\s+corriente|pendiente|a\s+pagar|debo)\b/i],
  },
];

export function matchMedioFromText(
  text: string,
  medios: MedioPagoConfig[]
): MedioPagoConfig | null {
  const raw = String(text ?? '').trim();
  if (!raw || !medios.length) return null;
  const n = normalize(raw);

  const byId = medios.find((m) => normalize(m.id) === n || normalize(m.label) === n);
  if (byId) return byId;

  const labelHit = medios.filter(
    (m) => n.includes(normalize(m.label)) || normalize(m.label).includes(n)
  );
  if (labelHit.length === 1) return labelHit[0]!;

  for (const alias of HINT_ALIASES) {
    if (!alias.patterns.some((re) => re.test(raw))) continue;
    const found = alias.ids
      .map((id) => medios.find((m) => m.id === id))
      .filter((m): m is MedioPagoConfig => Boolean(m));
    if (found.length) return found[0]!;
  }
  return null;
}

export function cardsForMedio(tarjetas: TarjetaConfig[], medioPagoId: string): TarjetaConfig[] {
  const id = String(medioPagoId ?? '').trim().toLowerCase();
  return tarjetas.filter((t) => String(t.medioPagoId ?? '').trim().toLowerCase() === id);
}

export function applyMedioToEntities(
  entities: WhatsappCommandEntities,
  medio: MedioPagoConfig
): void {
  entities.paymentMedioId = medio.id;
  entities.paymentMedioLabel = medio.label;
  entities.saveAsDraft = false;
  if (!medioPagoRequiereCuentaHija(medio)) {
    entities.paymentTarjetaId = undefined;
    entities.paymentTarjetaLabel = undefined;
  }
  if (medioPagoGeneratesPayables(medio) && !entities.paymentDueDate) {
    entities.paymentDueDate = todayDateOnly();
  }
  if (!entities.paymentCuotas) entities.paymentCuotas = 1;
}

export function applyCardToEntities(entities: WhatsappCommandEntities, card: TarjetaConfig): void {
  entities.paymentTarjetaId = card.id;
  entities.paymentTarjetaLabel = card.label;
}

export function applyDraftToEntities(entities: WhatsappCommandEntities, reason?: string): void {
  entities.saveAsDraft = true;
  if (reason) entities.paymentIncompleteReason = reason;
}

export function paymentNeedsCard(
  medio: MedioPagoConfig | undefined,
  entities: WhatsappCommandEntities
): boolean {
  if (!medio || entities.saveAsDraft) return false;
  return medioPagoRequiereCuentaHija(medio) && !String(entities.paymentTarjetaId ?? '').trim();
}

export function canConfirmPurchaseFully(
  entities: WhatsappCommandEntities,
  ctx: PurchasePaymentContext
): boolean {
  if (entities.saveAsDraft) return false;
  const medioId = String(entities.paymentMedioId ?? '').trim();
  if (!medioId) return false;
  const medio = ctx.medios.find((m) => m.id === medioId);
  if (!medio) return false;
  if (medioPagoRequiereCuentaHija(medio) && !String(entities.paymentTarjetaId ?? '').trim()) {
    return false;
  }
  return true;
}

export function formatPaymentChoices(medios: MedioPagoConfig[]): string {
  const lines = ['¿Cómo se pagó esta compra?'];
  medios.forEach((medio, index) => {
    const extra = medioPagoGeneratesImmediateCash(medio)
      ? ' — sale de caja'
      : medioPagoGeneratesPayables(medio)
        ? ' — cuentas a pagar'
        : '';
    lines.push(`${index + 1}. ${medio.label}${extra}`);
  });
  lines.push(`${medios.length + 1}. Guardar borrador (completar en el panel, no mueve stock)`);
  lines.push('\nRespondé el número, el nombre del medio, o NO para cancelar.');
  return lines.join('\n');
}

export function formatCardChoices(cards: Array<{ id: string; label: string }>): string {
  const lines = ['¿Con qué cuenta o tarjeta se pagó?'];
  cards.forEach((card, index) => {
    lines.push(`${index + 1}. ${card.label}`);
  });
  lines.push(`${cards.length + 1}. Guardar borrador (completar en el panel)`);
  lines.push('\nRespondé el número o NO para cancelar.');
  return lines.join('\n');
}

export function paymentSummaryLine(entities: WhatsappCommandEntities): string {
  if (entities.saveAsDraft) {
    return entities.paymentIncompleteReason
      ? `Borrador: ${entities.paymentIncompleteReason}`
      : 'Borrador (completar pago en el panel)';
  }
  const medio = String(entities.paymentMedioLabel ?? entities.paymentMedioId ?? '').trim();
  if (!medio) return 'Pago: (sin definir)';
  const parts = [medio];
  if (entities.paymentTarjetaLabel) parts.push(entities.paymentTarjetaLabel);
  const cuotas = Number(entities.paymentCuotas) || 1;
  if (cuotas > 1) parts.push(`${cuotas} cuotas`);
  return `Pago: ${parts.join(' · ')}`;
}

export function purchasePanelUrl(compraId: string, draft: boolean): string {
  const base = (process.env.APP_URL ?? 'https://rilo-7eff4.web.app').replace(/\/$/, '');
  if (draft) return `${base}/purchases/new?draftId=${encodeURIComponent(compraId)}`;
  return `${base}/purchases`;
}
