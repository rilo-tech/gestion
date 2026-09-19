/** Tolerancia técnica para reconciliar total de factura vs líneas reconocidas. */
export const PURCHASE_TOTAL_MISMATCH_TOLERANCE = 0.05;

export type PurchaseDocumentTotals = {
  documentNetTotal?: number;
  documentTaxTotal?: number;
  documentGrossTotal?: number;
  priceTaxMode?: 'net' | 'gross' | 'unknown';
  documentTaxRate?: number;
};

export function roundPurchaseMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function readPurchaseDocumentTotals(
  body: Record<string, unknown>
): PurchaseDocumentTotals {
  const documentNetTotal = roundOptional(body.documentNetTotal ?? body.netTotal);
  const documentTaxTotal = roundOptional(body.documentTaxTotal ?? body.taxTotal);
  const documentGrossTotal = roundOptional(body.documentGrossTotal ?? body.grossTotal);
  const documentTaxRate = roundOptional(body.documentTaxRate);
  const priceTaxMode =
    body.priceTaxMode === 'net' || body.priceTaxMode === 'gross'
      ? body.priceTaxMode
      : body.priceTaxMode === 'unknown'
        ? 'unknown'
        : undefined;
  return {
    ...(documentNetTotal != null ? { documentNetTotal } : {}),
    ...(documentTaxTotal != null ? { documentTaxTotal } : {}),
    ...(documentGrossTotal != null ? { documentGrossTotal } : {}),
    ...(documentTaxRate != null ? { documentTaxRate } : {}),
    ...(priceTaxMode ? { priceTaxMode } : {}),
  };
}

function roundOptional(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return roundPurchaseMoney(n);
}

export function sumLineImportes(items: Array<{ importe?: number }>): number {
  return roundPurchaseMoney(items.reduce((sum, line) => sum + (Number(line.importe) || 0), 0));
}

export function purchaseFinancialGrossTotal(input: {
  total: number;
  documentGrossTotal?: number;
}): number {
  if (input.documentGrossTotal != null && input.documentGrossTotal > 0) {
    return roundPurchaseMoney(input.documentGrossTotal);
  }
  return roundPurchaseMoney(input.total);
}

/** Escala obligaciones de pago al total bruto cuando difiere del neto de líneas. */
export function payablesTotalsByAmbito(
  items: Array<{ importe: number; ambito: string }>,
  financialGrossTotal: number
): Map<string, number> {
  const lineTotals = new Map<string, number>();
  for (const line of items) {
    const ambito = String(line.ambito ?? 'negocio').trim().toLowerCase();
    lineTotals.set(
      ambito,
      roundPurchaseMoney((lineTotals.get(ambito) ?? 0) + (Number(line.importe) || 0))
    );
  }
  const lineSum = roundPurchaseMoney([...lineTotals.values()].reduce((acc, value) => acc + value, 0));
  if (lineSum <= 0) return lineTotals;
  if (Math.abs(financialGrossTotal - lineSum) < 0.01) return lineTotals;

  const scaled = new Map<string, number>();
  const entries = [...lineTotals.entries()];
  let remaining = financialGrossTotal;
  for (let i = 0; i < entries.length; i++) {
    const [ambito, net] = entries[i]!;
    const isLast = i === entries.length - 1;
    const gross = isLast
      ? roundPurchaseMoney(remaining)
      : roundPurchaseMoney((net / lineSum) * financialGrossTotal);
    remaining = roundPurchaseMoney(remaining - gross);
    scaled.set(ambito, gross);
  }
  return scaled;
}

export function purchaseTotalMismatch(
  documentGrossTotal: number | undefined,
  recognizedTotal: number,
  tolerance = PURCHASE_TOTAL_MISMATCH_TOLERANCE
): { mismatch: boolean; difference: number } {
  if (documentGrossTotal == null || documentGrossTotal <= 0) {
    return { mismatch: false, difference: 0 };
  }
  const difference = roundPurchaseMoney(documentGrossTotal - recognizedTotal);
  return { mismatch: Math.abs(difference) > tolerance, difference };
}

/** Tasa de IVA derivada de totales del comprobante (nunca inventada). */
export function inferDocumentTaxRate(input: {
  documentNetTotal?: number;
  documentTaxTotal?: number;
  documentGrossTotal?: number;
}): number | undefined {
  const net = Number(input.documentNetTotal);
  const tax = Number(input.documentTaxTotal);
  const gross = Number(input.documentGrossTotal);
  if (Number.isFinite(net) && net > 0 && Number.isFinite(tax) && tax >= 0) {
    return roundPurchaseMoney((tax / net) * 100);
  }
  if (Number.isFinite(net) && net > 0 && Number.isFinite(gross) && gross > net) {
    return roundPurchaseMoney(((gross - net) / net) * 100);
  }
  return undefined;
}

/**
 * Detecta si los importes de línea están netos o con IVA incluido,
 * contrastando contra totales del comprobante.
 */
export function detectLinePriceTaxMode(input: {
  lineSum: number;
  documentNetTotal?: number;
  documentTaxTotal?: number;
  documentGrossTotal?: number;
}): 'net' | 'gross' | 'unknown' {
  const lineSum = roundPurchaseMoney(Number(input.lineSum) || 0);
  if (!(lineSum > 0)) return 'unknown';
  const net = Number(input.documentNetTotal);
  const tax = Number(input.documentTaxTotal);
  const gross = Number(input.documentGrossTotal);
  if (Number.isFinite(net) && Math.abs(lineSum - net) <= PURCHASE_TOTAL_MISMATCH_TOLERANCE) {
    return 'net';
  }
  if (Number.isFinite(gross) && Math.abs(lineSum - gross) <= PURCHASE_TOTAL_MISMATCH_TOLERANCE) {
    return 'gross';
  }
  if (
    Number.isFinite(gross) &&
    Number.isFinite(tax) &&
    Math.abs(lineSum + tax - gross) <= PURCHASE_TOTAL_MISMATCH_TOLERANCE
  ) {
    return 'net';
  }
  if (Number.isFinite(gross) && gross > lineSum) {
    const ratio = gross / lineSum;
    // Rango amplio de tasas reales (mínimo ~5% … máximo ~35%), sin fijar 22.
    if (ratio >= 1.05 && ratio <= 1.35) return 'net';
  }
  return 'unknown';
}

/** Tasa implícita cuando las líneas suman neto y el total es bruto. */
export function inferTaxRateFromLineSumToGross(lineSum: number, documentGrossTotal?: number): number | undefined {
  const net = roundPurchaseMoney(Number(lineSum) || 0);
  const gross = Number(documentGrossTotal);
  if (!(net > 0) || !Number.isFinite(gross) || !(gross > net)) return undefined;
  const ratio = gross / net;
  if (ratio < 1.05 || ratio > 1.35) return undefined;
  return roundPurchaseMoney((ratio - 1) * 100);
}
