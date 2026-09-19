/**
 * Document Understanding + FinancialDocumentReconciler
 *
 * La IA multimodal interpreta la factura (semantic).
 * Este módulo valida matemáticamente y elige net/gross sin hardcodear
 * proveedor ni tasa (p.ej. 22%).
 */

import {
  PURCHASE_TOTAL_MISMATCH_TOLERANCE,
  detectLinePriceTaxMode,
  inferDocumentTaxRate,
  inferTaxRateFromLineSumToGross,
  roundPurchaseMoney,
} from '../utils/purchase-document-totals.ts';

export const MAX_DOCUMENT_INTERPRETATION_ATTEMPTS = 2;

export type TaxPresentation = 'net_prices' | 'gross_prices' | 'mixed' | 'unknown';
export type PriceTaxMode = 'net' | 'gross' | 'unknown';

export type DocumentFinancialLineType =
  | 'product'
  | 'service'
  | 'shipping'
  | 'fee'
  | 'discount'
  | 'surcharge'
  | 'other_financial_line';

export type DocumentUnderstandingItem = {
  sourceLineNumber?: number | null;
  rawDescription?: string | null;
  normalizedDescription?: string | null;
  description?: string | null;
  quantity?: number | null;
  displayedUnitPrice?: number | null;
  displayedLineTotal?: number | null;
  displayedPriceBasis?: 'net' | 'gross' | 'unknown' | null;
  lineType?: DocumentFinancialLineType | string | null;
  taxRate?: number | null;
  taxAmount?: number | null;
  netUnitCost?: number | null;
  grossUnitCost?: number | null;
  confidence?: number | null;
};

export type DocumentTaxBucket = {
  rate?: number | null;
  taxableBase?: number | null;
  taxAmount?: number | null;
  label?: string | null;
};

/** Contrato estructurado (nombres alineados al PurchaseDraft existente). */
export type DocumentUnderstanding = {
  documentType?: string | null;
  supplierName?: string | null;
  supplierTaxId?: string | null;
  documentNumber?: string | null;
  documentDate?: string | null;
  currency?: string | null;
  taxPresentation?: TaxPresentation | PriceTaxMode | null;
  priceTaxMode?: PriceTaxMode | null;
  documentNetTotal?: number | null;
  documentTaxTotal?: number | null;
  documentGrossTotal?: number | null;
  documentTaxRate?: number | null;
  articleCount?: number | null;
  taxBreakdown?: DocumentTaxBucket[] | null;
  items: DocumentUnderstandingItem[];
  confidence?: number | null;
  ambiguities?: string[] | null;
  interpretationAttempt?: number | null;
};

export type FinancialReconcileOk = {
  ok: true;
  priceTaxMode: 'net' | 'gross';
  documentNetTotal?: number;
  documentTaxTotal?: number;
  documentGrossTotal?: number;
  documentTaxRate?: number;
  printedLineSum: number;
  articleCount?: number;
  chosenBy: 'ai_claim' | 'math_net' | 'math_gross' | 'detect';
};

export type FinancialReconcileFail = {
  ok: false;
  reason: 'ambiguous' | 'mismatch' | 'no_items';
  askUser: boolean;
  printedLineSum: number;
  documentNetTotal?: number;
  documentTaxTotal?: number;
  documentGrossTotal?: number;
  netInterpretationOk: boolean;
  grossInterpretationOk: boolean;
  articleCountOk: boolean;
  feedback: {
    expectedGross?: number;
    computedGrossFromLines: number;
    difference?: number;
    expectedNet?: number;
    expectedArticleCount?: number;
    computedArticleCount: number;
    netOk: boolean;
    grossOk: boolean;
  };
};

export type FinancialReconcileResult = FinancialReconcileOk | FinancialReconcileFail;

export const VISUAL_TAX_PRICES_INCLUDE_IVA = '__visual_tax_gross__';
export const VISUAL_TAX_PRICES_EXCLUDE_IVA = '__visual_tax_net__';

function asNum(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return roundPurchaseMoney(n);
}

function normalizeTaxRate(rate: number | undefined): number | undefined {
  if (rate == null || !Number.isFinite(rate) || rate < 0) return undefined;
  if (rate > 0 && rate < 1) return roundPurchaseMoney(rate * 100);
  return roundPurchaseMoney(rate);
}

export function mapTaxPresentationToPriceTaxMode(
  value: unknown
): PriceTaxMode | undefined {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return undefined;
  if (raw === 'net' || raw === 'net_prices' || raw === 'neto') return 'net';
  if (raw === 'gross' || raw === 'gross_prices' || raw === 'iva_incluido' || raw === 'incluido') {
    return 'gross';
  }
  if (raw === 'unknown' || raw === 'mixed') return 'unknown';
  return undefined;
}

export function isMatchableProductLine(lineType: unknown): boolean {
  const t = String(lineType ?? 'product')
    .trim()
    .toLowerCase();
  if (!t || t === 'product' || t === 'producto') return true;
  if (t === 'service' || t === 'servicio') return true;
  return false;
}

export function isFinancialOnlyLine(lineType: unknown): boolean {
  const t = String(lineType ?? '')
    .trim()
    .toLowerCase();
  return (
    t === 'shipping' ||
    t === 'envio' ||
    t === 'fee' ||
    t === 'discount' ||
    t === 'descuento' ||
    t === 'surcharge' ||
    t === 'recargo' ||
    t === 'other_financial_line' ||
    t === 'other'
  );
}

/** Suma de importes impresos en líneas (antes de gross-up). */
export function computeUnderstandingPrintedLineSum(
  items: DocumentUnderstandingItem[]
): number {
  let sum = 0;
  for (const item of items) {
    if (isFinancialOnlyLine(item.lineType) && String(item.lineType).toLowerCase().includes('discount')) {
      // descuentos restan si hay total de línea
      const lineTotal = asNum(item.displayedLineTotal);
      if (lineTotal != null) {
        sum -= Math.abs(lineTotal);
        continue;
      }
    }
    const qty = Math.max(0, Number(item.quantity) || 0);
    const lineTotal = asNum(item.displayedLineTotal);
    if (lineTotal != null && qty >= 0) {
      sum += lineTotal;
      continue;
    }
    const unit =
      asNum(item.displayedUnitPrice) ??
      asNum(item.netUnitCost) ??
      asNum(item.grossUnitCost) ??
      0;
    sum += qty * unit;
  }
  return roundPurchaseMoney(sum);
}

export function computeUnderstandingArticleCount(items: DocumentUnderstandingItem[]): number {
  let count = 0;
  for (const item of items) {
    if (isFinancialOnlyLine(item.lineType)) {
      const t = String(item.lineType).toLowerCase();
      if (t === 'discount' || t === 'descuento') continue;
    }
    count += Math.max(0, Number(item.quantity) || 0);
  }
  return roundPurchaseMoney(count);
}

function closes(a: number | undefined, b: number | undefined): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= PURCHASE_TOTAL_MISMATCH_TOLERANCE;
}

function netInterpretationOk(input: {
  printedLineSum: number;
  documentNetTotal?: number;
  documentTaxTotal?: number;
  documentGrossTotal?: number;
}): boolean {
  const { printedLineSum, documentNetTotal, documentTaxTotal, documentGrossTotal } = input;
  if (!(printedLineSum > 0)) return false;
  if (documentNetTotal != null && closes(printedLineSum, documentNetTotal)) {
    if (
      documentGrossTotal != null &&
      documentTaxTotal != null &&
      !closes(documentNetTotal + documentTaxTotal, documentGrossTotal)
    ) {
      return false;
    }
    return true;
  }
  if (
    documentGrossTotal != null &&
    documentTaxTotal != null &&
    closes(printedLineSum + documentTaxTotal, documentGrossTotal)
  ) {
    return true;
  }
  if (documentGrossTotal != null && documentGrossTotal > printedLineSum) {
    const ratio = documentGrossTotal / printedLineSum;
    if (ratio >= 1.05 && ratio <= 1.35) return true;
  }
  return false;
}

function grossInterpretationOk(input: {
  printedLineSum: number;
  documentGrossTotal?: number;
  documentNetTotal?: number;
}): boolean {
  const { printedLineSum, documentGrossTotal, documentNetTotal } = input;
  if (!(printedLineSum > 0)) return false;
  if (documentGrossTotal != null && closes(printedLineSum, documentGrossTotal)) return true;
  // Sin gross explícito: si líneas ≈ net declarado y no hay tax, no es gross.
  if (documentNetTotal != null && closes(printedLineSum, documentNetTotal)) return false;
  return false;
}

/**
 * Elige net vs gross por matemática del documento.
 * No inventa tasas ni asume proveedor.
 */
export function reconcileFinancialDocument(
  understanding: DocumentUnderstanding
): FinancialReconcileResult {
  const items = Array.isArray(understanding.items) ? understanding.items : [];
  const printedLineSum = computeUnderstandingPrintedLineSum(items);
  const computedArticleCount = computeUnderstandingArticleCount(items);
  const documentNetTotal = asNum(understanding.documentNetTotal);
  const documentTaxTotal = asNum(understanding.documentTaxTotal);
  const documentGrossTotal =
    asNum(understanding.documentGrossTotal) ??
    (documentNetTotal != null && documentTaxTotal != null
      ? roundPurchaseMoney(documentNetTotal + documentTaxTotal)
      : undefined);
  const articleCount = asNum(understanding.articleCount);
  const articleCountOk =
    articleCount == null || closes(articleCount, computedArticleCount);

  if (!items.length || !(printedLineSum > 0)) {
    return {
      ok: false,
      reason: 'no_items',
      askUser: false,
      printedLineSum,
      documentNetTotal,
      documentTaxTotal,
      documentGrossTotal,
      netInterpretationOk: false,
      grossInterpretationOk: false,
      articleCountOk,
      feedback: {
        expectedGross: documentGrossTotal,
        computedGrossFromLines: printedLineSum,
        difference:
          documentGrossTotal != null
            ? roundPurchaseMoney(documentGrossTotal - printedLineSum)
            : undefined,
        expectedNet: documentNetTotal,
        expectedArticleCount: articleCount,
        computedArticleCount,
        netOk: false,
        grossOk: false,
      },
    };
  }

  const hasDocumentAnchors =
    documentNetTotal != null || documentTaxTotal != null || documentGrossTotal != null;

  // Sin totales del comprobante: no bloquear matching; el draft sigue con modo unknown.
  if (!hasDocumentAnchors) {
    return {
      ok: false,
      reason: 'ambiguous',
      askUser: false,
      printedLineSum,
      documentNetTotal,
      documentTaxTotal,
      documentGrossTotal,
      netInterpretationOk: false,
      grossInterpretationOk: false,
      articleCountOk,
      feedback: {
        computedGrossFromLines: printedLineSum,
        computedArticleCount,
        netOk: false,
        grossOk: false,
      },
    };
  }

  const netOk = netInterpretationOk({
    printedLineSum,
    documentNetTotal,
    documentTaxTotal,
    documentGrossTotal,
  });
  const grossOk = grossInterpretationOk({
    printedLineSum,
    documentGrossTotal,
    documentNetTotal,
  });

  const aiMode =
    mapTaxPresentationToPriceTaxMode(understanding.taxPresentation) ??
    mapTaxPresentationToPriceTaxMode(understanding.priceTaxMode);

  const detected = detectLinePriceTaxMode({
    lineSum: printedLineSum,
    documentNetTotal,
    documentTaxTotal,
    documentGrossTotal,
  });

  let chosen: 'net' | 'gross' | undefined;
  let chosenBy: FinancialReconcileOk['chosenBy'] = 'detect';

  if (aiMode === 'net' && netOk) {
    chosen = 'net';
    chosenBy = 'ai_claim';
  } else if (aiMode === 'gross' && grossOk) {
    chosen = 'gross';
    chosenBy = 'ai_claim';
  } else if (netOk && !grossOk) {
    chosen = 'net';
    chosenBy = 'math_net';
  } else if (grossOk && !netOk) {
    chosen = 'gross';
    chosenBy = 'math_gross';
  } else if (netOk && grossOk) {
    // Ambas cierran (p.ej. tax=0): preferir AI o detected.
    if (aiMode === 'net' || aiMode === 'gross') {
      chosen = aiMode;
      chosenBy = 'ai_claim';
    } else if (detected === 'net' || detected === 'gross') {
      chosen = detected;
      chosenBy = 'detect';
    } else {
      chosen = documentTaxTotal != null && documentTaxTotal > 0.009 ? 'net' : 'gross';
      chosenBy = chosen === 'net' ? 'math_net' : 'math_gross';
    }
  } else if (detected === 'net' || detected === 'gross') {
    // Detect débil solo si una interpretación no falló explícitamente.
    if (detected === 'net' && (netOk || documentNetTotal == null)) {
      chosen = 'net';
      chosenBy = 'detect';
    } else if (detected === 'gross' && (grossOk || documentGrossTotal == null)) {
      chosen = 'gross';
      chosenBy = 'detect';
    }
  }

  if (!chosen) {
    console.info(
      '[purchase:document:reconcile:ambiguous]',
      JSON.stringify({
        printedLineSum,
        documentNetTotal,
        documentTaxTotal,
        documentGrossTotal,
        netOk,
        grossOk,
        aiMode: aiMode ?? null,
      })
    );
    return {
      ok: false,
      reason: 'ambiguous',
      askUser: true,
      printedLineSum,
      documentNetTotal,
      documentTaxTotal,
      documentGrossTotal,
      netInterpretationOk: netOk,
      grossInterpretationOk: grossOk,
      articleCountOk,
      feedback: {
        expectedGross: documentGrossTotal,
        computedGrossFromLines: printedLineSum,
        difference:
          documentGrossTotal != null
            ? roundPurchaseMoney(documentGrossTotal - printedLineSum)
            : undefined,
        expectedNet: documentNetTotal,
        expectedArticleCount: articleCount,
        computedArticleCount,
        netOk,
        grossOk,
      },
    };
  }

  let documentTaxRate = normalizeTaxRate(asNum(understanding.documentTaxRate));
  if (documentTaxRate == null) {
    documentTaxRate = inferDocumentTaxRate({
      documentNetTotal,
      documentTaxTotal,
      documentGrossTotal,
    });
  }
  if (documentTaxRate == null && chosen === 'net') {
    documentTaxRate = inferTaxRateFromLineSumToGross(printedLineSum, documentGrossTotal);
  }

  let resolvedNet = documentNetTotal;
  let resolvedTax = documentTaxTotal;
  let resolvedGross = documentGrossTotal;

  if (chosen === 'net') {
    resolvedNet = resolvedNet ?? printedLineSum;
    if (resolvedGross == null && resolvedNet != null && resolvedTax != null) {
      resolvedGross = roundPurchaseMoney(resolvedNet + resolvedTax);
    }
    if (resolvedTax == null && resolvedNet != null && resolvedGross != null) {
      resolvedTax = roundPurchaseMoney(resolvedGross - resolvedNet);
    }
  } else {
    resolvedGross = resolvedGross ?? printedLineSum;
    if (resolvedNet == null && resolvedGross != null && resolvedTax != null) {
      resolvedNet = roundPurchaseMoney(resolvedGross - resolvedTax);
    }
    if (resolvedTax == null && resolvedNet != null && resolvedGross != null) {
      resolvedTax = roundPurchaseMoney(resolvedGross - resolvedNet);
    }
  }

  console.info(
    '[purchase:document:reconcile:ok]',
    JSON.stringify({
      priceTaxMode: chosen,
      chosenBy,
      printedLineSum,
      documentNetTotal: resolvedNet ?? null,
      documentTaxTotal: resolvedTax ?? null,
      documentGrossTotal: resolvedGross ?? null,
      documentTaxRate: documentTaxRate ?? null,
      articleCountOk,
    })
  );

  return {
    ok: true,
    priceTaxMode: chosen,
    documentNetTotal: resolvedNet,
    documentTaxTotal: resolvedTax,
    documentGrossTotal: resolvedGross,
    documentTaxRate,
    printedLineSum,
    articleCount: articleCount ?? computedArticleCount,
    chosenBy,
  };
}

export function presentTaxPresentationAmbiguityAsk(): string {
  return [
    '*🧾 No pude determinar cómo están expresados los precios.*',
    '',
    '¿Los importes de los productos ya incluyen IVA?',
    '',
    '1. ✅ Sí',
    '2. ❌ No',
    '',
    '0. ❌ Cancelar compra',
    '',
    'Elegí una opción.',
  ].join('\n');
}

export function buildTaxPresentationAmbiguityCandidates(): Array<{ id: string; name: string }> {
  return [
    { id: VISUAL_TAX_PRICES_INCLUDE_IVA, name: '✅ Sí' },
    { id: VISUAL_TAX_PRICES_EXCLUDE_IVA, name: '❌ No' },
    { id: '__visual_candidate_cancel__', name: '❌ Cancelar compra' },
  ];
}

/**
 * Aplica corrección fiscal al draft SIN tocar matches de producto.
 */
export function applyTaxPresentationToDraftFields(
  draft: {
    priceTaxMode?: PriceTaxMode;
    documentNetTotal?: number;
    documentTaxTotal?: number;
    documentGrossTotal?: number;
    documentTaxRate?: number;
    total?: number;
    taxPresentationResolved?: boolean;
    items: Array<{
      unitCost?: number;
      unitCostNet?: number;
      taxRate?: number;
      taxAmount?: number;
      grossUnitCost?: number;
      priceTaxMode?: PriceTaxMode;
      subtotal?: number;
      quantity?: number;
      matchStatus?: string;
      unresolvedAction?: string | null;
    }>;
  },
  mode: 'net' | 'gross',
  opts?: { documentTaxRate?: number | null }
): void {
  draft.priceTaxMode = mode;
  draft.taxPresentationResolved = true;

  // Reset computed tax fields on lines; keep printed amounts as unitCostNet or unitCost.
  for (const item of draft.items) {
    if (item.matchStatus === 'discarded' || item.unresolvedAction === 'discard') continue;
    const printed =
      mode === 'net'
        ? Number(item.unitCostNet) > 0
          ? Number(item.unitCostNet)
          : Number(item.unitCost) || 0
        : Number(item.unitCost) > 0
          ? Number(item.unitCost)
          : Number(item.unitCostNet) || 0;
    if (mode === 'net') {
      item.unitCostNet = roundPurchaseMoney(printed);
      item.unitCost = roundPurchaseMoney(printed);
      item.grossUnitCost = undefined;
      item.taxAmount = undefined;
      item.priceTaxMode = 'net';
    } else {
      item.unitCost = roundPurchaseMoney(printed);
      item.grossUnitCost = roundPurchaseMoney(printed);
      item.unitCostNet = undefined;
      item.taxAmount = undefined;
      item.priceTaxMode = 'gross';
    }
  }

  if (opts?.documentTaxRate != null && Number(opts.documentTaxRate) > 0) {
    draft.documentTaxRate = normalizeTaxRate(Number(opts.documentTaxRate));
  }

  // Recalcular documentTax desde totales si están.
  if (
    draft.documentNetTotal != null &&
    draft.documentGrossTotal != null &&
    draft.documentTaxTotal == null
  ) {
    draft.documentTaxTotal = roundPurchaseMoney(draft.documentGrossTotal - draft.documentNetTotal);
  }
  if (draft.documentGrossTotal != null) {
    draft.total = draft.documentGrossTotal;
  }
}
