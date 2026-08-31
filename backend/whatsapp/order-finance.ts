/**
 * Acción financiera relacionada a un pedido/venta que se está creando.
 * No es un cobro huérfano: el monto entra al comprobante nuevo (seña o pago total).
 */
import { isLlmFirstEngine } from './engine-version.ts';

export type RelatedOrderFinanceKind = 'none' | 'partial' | 'full';

export type RelatedOrderFinance = {
  total: number;
  cobro: number;
  saldo: number;
  kind: RelatedOrderFinanceKind;
};

/**
 * El dueño dijo que la plata de ESTE pedido ya está: pagado / cobrado / saldado /
 * abonado / ya pagó. Familia semántica, no una frase fija.
 */
export function looksLikeRelatedOrderPayment(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  return /(?<![\p{L}])((?:ya\s+)?(?:est[aá]|qued[oó]|sali[oó])\s+(?:todo\s+)?(?:pag[oa]|pagad[oa]|cobrad[oa]|saldad[oa]|abonad[oa])|ya\s+(?:me\s+|lo\s+|le\s+)?(?:pag[oó]|cobr[oó]|sald[oó]|abon[oó])|(?:pagad[oa]|cobrad[oa]|saldad[oa]|abonad[oa])(?:\s+(?:todo|completo|el\s+total))?|sald(?:alo|ar)(?!\s+de)|todo\s+el\s+saldo)(?![\p{L}])/iu.test(
    t
  );
}

function money(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

export function sumSpokenExtraCosts(extras?: Array<{ costo?: number }> | null): number {
  return money((extras ?? []).reduce((sum, extra) => sum + (Number(extra.costo) || 0), 0));
}

export const ORDER_EXTRA_COST_ASK = '💲 Indicame el costo extra y el importe, o *NO*.';

/** Preguntar extras solo si el negocio los tiene habilitados y el dueño todavía no informó ninguno. */
export function shouldAskOrderExtraCosts(entities: {
  extraCostsEnabled?: boolean;
  extraCostsAsked?: boolean;
  extraCosts?: Array<{ costo?: number }> | null;
}): boolean {
  if (entities.extraCostsEnabled !== true) return false;
  if (entities.extraCostsAsked) return false;
  if (sumSpokenExtraCosts(entities.extraCosts) > 0) return false;
  return true;
}

/**
 * Economía interna del pedido, igual que el panel:
 * venta = qty × precioVenta; costoReal = costo maestro + costos extra; ganancia = venta − costoReal.
 * Los extras NO entran al precio de venta ni al saldo.
 */
export function planOrderEconomics(input: {
  salePrice?: number | null;
  baseCost?: number | null;
  extraCosts?: Array<{ costo?: number }> | null;
}): {
  salePrice: number;
  baseCost: number;
  extraCost: number;
  totalCost: number;
  profit: number;
} {
  const salePrice = money(Number(input.salePrice) || 0);
  const baseCost = money(Number(input.baseCost) || 0);
  const extraCost = sumSpokenExtraCosts(input.extraCosts);
  const totalCost = money(baseCost + extraCost);
  return {
    salePrice,
    baseCost,
    extraCost,
    totalCost,
    profit: money(salePrice - totalCost),
  };
}

export function planRelatedOrderFinance(input: {
  amount?: number | null;
  extraCosts?: Array<{ costo?: number }> | null;
  collectionAmount?: number | null;
  seniaAmount?: number | null;
  paid?: boolean | null;
  payFullBalance?: boolean | null;
  sourceText?: string | null;
}): RelatedOrderFinance {
  const total = money(Number(input.amount) || 0);
  const senia = money(Number(input.seniaAmount) || 0);
  const locked = money(Number(input.collectionAmount) || 0);
  const prepaid =
    input.paid === true ||
    input.payFullBalance === true ||
    (!isLlmFirstEngine() && looksLikeRelatedOrderPayment(String(input.sourceText ?? '')));

  if (input.payFullBalance === true && total > 0) {
    return { total, cobro: total, saldo: 0, kind: 'full' };
  }
  if (locked > 0 && total > 0) {
    const cobro = Math.min(locked, total);
    return {
      total,
      cobro,
      saldo: money(total - cobro),
      kind: cobro >= total ? 'full' : cobro > 0 ? 'partial' : 'none',
    };
  }
  if (prepaid && total > 0) {
    if (senia > 0 && senia < total) {
      return { total, cobro: senia, saldo: money(total - senia), kind: 'partial' };
    }
    return { total, cobro: total, saldo: 0, kind: 'full' };
  }
  if (senia > 0 && total > 0) {
    const cobro = Math.min(senia, total);
    return {
      total,
      cobro,
      saldo: money(total - cobro),
      kind: cobro >= total ? 'full' : 'partial',
    };
  }
  return { total, cobro: 0, saldo: total, kind: 'none' };
}

export function formatSpokenMoney(value: number): string {
  const rounded = Math.round(Math.max(0, value) * 100) / 100;
  const [int, dec] = rounded.toFixed(2).split('.');
  const withDots = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec === '00' ? `$${withDots}` : `$${withDots},${dec}`;
}

export function formatOrderFinanceLines(
  plan: RelatedOrderFinance,
  options?: { bold?: boolean }
): string[] {
  if (plan.total <= 0 && plan.kind === 'none') return [];
  const wrap = (label: string) => (options?.bold ? `*${label}:*` : `${label}:`);
  const lines = [`${wrap('Venta')} ${formatSpokenMoney(plan.total)}`];
  if (plan.kind !== 'none') {
    lines.push(
      `${wrap('Pago')} ${formatSpokenMoney(plan.cobro)} → saldo ${formatSpokenMoney(plan.saldo)}`
    );
  }
  return lines;
}

/** Línea de costos extra internos. Va DESPUÉS de venta/pago; no cambia el total de venta. */
export function formatOrderExtraCostLines(
  extras?: Array<{ nombre?: string; costo?: number }> | null,
  options?: { bold?: boolean }
): string[] {
  const list = (extras ?? []).filter(
    (item) => String(item.nombre ?? '').trim() && Number(item.costo) > 0
  );
  if (!list.length) return [];
  const wrap = (label: string) => (options?.bold ? `*${label}:*` : `${label}:`);
  const detail = list
    .map((item) => {
      const raw = String(item.nombre).trim();
      const nombre = raw.replace(/^[a-záéíóúüñ]/, (ch) => ch.toUpperCase());
      return `${nombre} ${formatSpokenMoney(Number(item.costo))}`;
    })
    .join(', ');
  return [`${wrap('Costo extra')} ${detail}`];
}
