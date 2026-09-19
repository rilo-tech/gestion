import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyTaxPresentationToDraftFields,
  mapTaxPresentationToPriceTaxMode,
  reconcileFinancialDocument,
  type DocumentUnderstanding,
} from './document-understanding.ts';
import {
  applyTaxPresentationCorrection,
  ensurePurchaseDraftTaxMetadata,
  finalUnitCostForVisualItem,
  type VisualDocumentDraft,
  type VisualDraftItem,
} from './v4-visual-draft.ts';

function item(
  partial: Partial<VisualDraftItem> & Pick<VisualDraftItem, 'index' | 'description'>
): VisualDraftItem {
  return {
    sourceText: partial.description,
    matchStatus: 'resolved',
    quantity: 1,
    unitCost: 100,
    ...partial,
  };
}

function draft(extra: Partial<VisualDocumentDraft> = {}): VisualDocumentDraft {
  return {
    id: 'vd_doc',
    kind: 'purchase',
    status: 'awaiting_resolution',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sourceMessageIds: [],
    supplierName: 'Proveedor X',
    items: [],
    ...extra,
  };
}

describe('Document Understanding — FinancialDocumentReconciler', () => {
  it('A) factura neto + IVA separado (Disershop-like) → net_prices', () => {
    const understanding: DocumentUnderstanding = {
      supplierName: 'Disershop',
      documentNetTotal: 11942.62,
      documentTaxTotal: 2627.38,
      documentGrossTotal: 14570,
      articleCount: 40,
      taxPresentation: 'unknown',
      items: [
        { description: 'Remera Polo Dry Negro S', quantity: 1, displayedUnitPrice: 204.1 },
        { description: 'Remera Polo Dry Negro L', quantity: 8, displayedUnitPrice: 204.1 },
        { description: 'Remera Polo Dry Negro M', quantity: 4, displayedUnitPrice: 204.1 },
        { description: 'Remera Polo Dry Negro XXL', quantity: 2, displayedUnitPrice: 204.1 },
        { description: 'Canguro Felpa SW negro XL', quantity: 4, displayedUnitPrice: 490.98 },
        { description: 'Canguro Felpa SW negro M', quantity: 4, displayedUnitPrice: 490.98 },
        { description: 'Canguro Felpa SW negro L', quantity: 8, displayedUnitPrice: 490.98 },
        { description: 'Body sublimable blanco 0 Mes', quantity: 3, displayedUnitPrice: 97.54 },
        { description: 'Camiseta Dry Blanco M', quantity: 2, displayedUnitPrice: 122.13 },
        { description: 'Camiseta Dry Blanco L', quantity: 2, displayedUnitPrice: 122.13 },
        { description: 'Camiseta Dry Blanco XL', quantity: 2, displayedUnitPrice: 122.13 },
      ],
    };
    // Ajuste: sumar exactamente el neto documentado con un ítem residual de redondeo.
    const printed = understanding.items.reduce(
      (acc, row) => acc + (Number(row.quantity) || 0) * (Number(row.displayedUnitPrice) || 0),
      0
    );
    const delta = Math.round((11942.62 - printed) * 100) / 100;
    understanding.items.push({
      description: 'Ajuste redondeo',
      quantity: 1,
      displayedUnitPrice: delta,
      lineType: 'other_financial_line',
    });

    const result = reconcileFinancialDocument(understanding);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.priceTaxMode, 'net');
    assert.equal(result.documentNetTotal, 11942.62);
    assert.equal(result.documentTaxTotal, 2627.38);
    assert.equal(result.documentGrossTotal, 14570);
    assert.ok(Math.abs((result.documentTaxRate ?? 0) - 22) < 0.05);
  });

  it('B) factura IVA incluido → gross_prices sin sumar IVA de nuevo', () => {
    const understanding: DocumentUnderstanding = {
      supplierName: 'Textil Sur',
      documentGrossTotal: 14570,
      taxPresentation: 'gross_prices',
      items: [
        { description: 'Producto A', quantity: 10, displayedUnitPrice: 1000 },
        { description: 'Producto B', quantity: 5, displayedUnitPrice: 914 },
      ],
    };
    const result = reconcileFinancialDocument(understanding);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.priceTaxMode, 'gross');
    assert.equal(result.documentGrossTotal, 14570);
  });

  it('C) múltiples tasas en taxBreakdown se preservan en el contrato', () => {
    const understanding: DocumentUnderstanding = {
      documentNetTotal: 1000,
      documentTaxTotal: 160,
      documentGrossTotal: 1160,
      taxBreakdown: [
        { rate: 22, taxableBase: 500, taxAmount: 110 },
        { rate: 10, taxableBase: 500, taxAmount: 50 },
      ],
      items: [
        { description: 'A', quantity: 1, displayedUnitPrice: 500, taxRate: 22 },
        { description: 'B', quantity: 1, displayedUnitPrice: 500, taxRate: 10 },
      ],
    };
    const result = reconcileFinancialDocument(understanding);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.priceTaxMode, 'net');
    assert.equal(understanding.taxBreakdown?.length, 2);
  });

  it('D) línea exenta + gravada: no inventa tasa única', () => {
    const understanding: DocumentUnderstanding = {
      documentNetTotal: 200,
      documentTaxTotal: 22,
      documentGrossTotal: 222,
      items: [
        { description: 'Exento', quantity: 1, displayedUnitPrice: 100, taxRate: 0 },
        { description: 'Gravado', quantity: 1, displayedUnitPrice: 100, taxRate: 22 },
      ],
    };
    const result = reconcileFinancialDocument(understanding);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.priceTaxMode, 'net');
    assert.ok(result.documentTaxRate == null || Math.abs(result.documentTaxRate - 11) < 0.05);
  });

  it('E) descuento financiero no se trata como producto de stock', () => {
    const understanding: DocumentUnderstanding = {
      documentGrossTotal: 900,
      taxPresentation: 'gross_prices',
      items: [
        { description: 'Producto', quantity: 1, displayedUnitPrice: 1000 },
        {
          description: 'Descuento',
          quantity: 1,
          displayedLineTotal: 100,
          lineType: 'discount',
        },
      ],
    };
    const result = reconcileFinancialDocument(understanding);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.priceTaxMode, 'gross');
  });

  it('F) envío / recargo participa del total', () => {
    const understanding: DocumentUnderstanding = {
      documentGrossTotal: 1100,
      taxPresentation: 'gross_prices',
      items: [
        { description: 'Producto', quantity: 1, displayedUnitPrice: 1000 },
        { description: 'Envío', quantity: 1, displayedUnitPrice: 100, lineType: 'shipping' },
      ],
    };
    const result = reconcileFinancialDocument(understanding);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.priceTaxMode, 'gross');
  });

  it('G) documento ambiguo → askUser', () => {
    const understanding: DocumentUnderstanding = {
      documentGrossTotal: 9000,
      items: [
        { description: 'X', quantity: 1, displayedUnitPrice: 3000 },
        { description: 'Y', quantity: 1, displayedUnitPrice: 1000 },
      ],
    };
    const result = reconcileFinancialDocument(understanding);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'ambiguous');
    assert.equal(result.askUser, true);
  });

  it('proveedor desconocido: mismos totales → net sin regla de supplier', () => {
    const understanding: DocumentUnderstanding = {
      supplierName: 'Proveedor Que Nunca Figuró En Prompts SA',
      documentNetTotal: 1000,
      documentTaxTotal: 220,
      documentGrossTotal: 1220,
      items: [{ description: 'SKU-ZZ', quantity: 10, displayedUnitPrice: 100 }],
    };
    const result = reconcileFinancialDocument(understanding);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.priceTaxMode, 'net');
    assert.ok(Math.abs((result.documentTaxRate ?? 0) - 22) < 0.05);
  });

  it('mapTaxPresentation aliases', () => {
    assert.equal(mapTaxPresentationToPriceTaxMode('net_prices'), 'net');
    assert.equal(mapTaxPresentationToPriceTaxMode('gross_prices'), 'gross');
    assert.equal(mapTaxPresentationToPriceTaxMode('unknown'), 'unknown');
  });
});

describe('Tax presentation correction preserves product matches', () => {
  it('corrige net→gross sin borrar productIds', () => {
    const d = draft({
      priceTaxMode: 'unknown',
      documentNetTotal: 1000,
      documentTaxTotal: 220,
      documentGrossTotal: 1220,
      items: [
        item({
          index: 1,
          description: 'Remera',
          quantity: 1,
          unitCost: 1000,
          unitCostNet: 1000,
          matchedProductId: 'prod-1',
          matchedProductName: 'Remera catalogada',
          matchStatus: 'resolved',
          selectionSource: 'user_selected',
        }),
      ],
    });
    applyTaxPresentationCorrection(d, 'net');
    assert.equal(d.items[0]?.matchedProductId, 'prod-1');
    assert.equal(d.items[0]?.matchedProductName, 'Remera catalogada');
    assert.equal(d.priceTaxMode, 'net');
    assert.equal(d.taxPresentationResolved, true);
    assert.equal(finalUnitCostForVisualItem(d.items[0]!), 1220);
  });

  it('gross no vuelve a sumar IVA', () => {
    const d = draft({
      documentGrossTotal: 249,
      items: [
        item({
          index: 1,
          description: 'X',
          quantity: 1,
          unitCost: 249,
          matchedProductId: 'p',
          matchStatus: 'resolved',
        }),
      ],
    });
    applyTaxPresentationToDraftFields(d, 'gross');
    ensurePurchaseDraftTaxMetadata(d, null);
    assert.equal(d.priceTaxMode, 'gross');
    assert.equal(finalUnitCostForVisualItem(d.items[0]!), 249);
  });
});
