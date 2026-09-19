import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatWhatsappMessage } from '../../shared/whatsapp-format.ts';
import { computeFirstInstallmentDate, formatPurchaseDateEs } from '../utils/card-payment-schedule.ts';
import { resolvePurchaseLineTax } from '../utils/purchase-tax.ts';
import {
  computeDraftFinancialTotals,
  computeDraftTotal,
  computeRecognizedGrossTotal,
  computeRecognizedGrossTotal,
  presentVisualNotFoundItemMenu,
  presentManualProductMatchMenu,
  presentVisualPurchaseFinalReview,
  resolveVisualDraftBlockingIssue,
  type VisualDocumentDraft,
} from './v4-visual-draft.ts';
import { V4_CANDIDATE_SELECTION_PROMPT } from './v4-ui-copy.ts';

describe('Purchase integral UX', () => {
  it('lists have blank line before instruction', () => {
    const card = formatWhatsappMessage({
      title: 'Productos encontrados',
      lines: ['1. Taza AA Blanco', '2. Taza AA Negro', '0. Volver'],
      ask: V4_CANDIDATE_SELECTION_PROMPT,
    });
    assert.match(card, /0\. Volver\n\nIndicame qué ítem querés usar/);
  });

  it('unresolved menu is short without redundant ask', () => {
    const menu = presentVisualNotFoundItemMenu(5, {
      index: 5,
      sourceText: 'Caja mantenimiento Epson F170',
      description: 'Caja mantenimiento Epson F170',
      quantity: 1,
      unitCost: 1433.61,
      matchStatus: 'not_found',
    });
    assert.match(menu, /Registrar como insumo sin stock/);
    assert.match(menu, /Descartar del documento/);
  });

  it('manual match menu uses product candidate ask', () => {
    const menu = presentManualProductMatchMenu(5, [
      { id: 'a', name: 'Taza AA Blanco' },
      { id: 'b', name: 'Taza AA Premium' },
    ], false);
    assert.match(menu, /1\. 👕 Taza AA Blanco/);
    assert.match(menu, /Si no es ninguno|Indicame qué producto|escribime el nombre/);
    assert.doesNotMatch(menu, /Producto sin vincular|Encontré productos parecidos|Respondeme/i);
  });
});

describe('Purchase tax snapshot', () => {
  it('gross mode does not double-apply IVA', () => {
    const snap = resolvePurchaseLineTax(
      { unitCost: 122, priceTaxMode: 'gross', taxRate: 22 },
      { defaultPurchaseTaxRate: 22 }
    );
    assert.equal(snap.grossUnitCost, 122);
    assert.notEqual(snap.grossUnitCost, 148.84);
  });

  it('net mode adds configured tax rate', () => {
    const snap = resolvePurchaseLineTax(
      { unitCost: 100, unitCostNet: 100, priceTaxMode: 'net', taxRate: 22 },
      { defaultPurchaseTaxRate: 22 }
    );
    assert.equal(snap.netUnitCost, 100);
    assert.equal(snap.grossUnitCost, 122);
  });
});

describe('Card installment schedule', () => {
  it('computes first installment from configured due day', () => {
    const due = computeFirstInstallmentDate('2026-08-31', { diaVencimiento: 10 });
    assert.equal(due, '2026-09-10');
    assert.equal(formatPurchaseDateEs(due!), '10/09/2026');
  });
});

describe('Purchase total invariant', () => {
  it('detects mismatch between document gross and recognized lines', () => {
    const draft: VisualDocumentDraft = {
      id: 'vd_test',
      kind: 'purchase',
      status: 'awaiting_confirmation',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      sourceMessageIds: [],
      supplierName: 'Disershop',
      documentGrossTotal: 4357,
      documentNetTotal: 3571.31,
      documentTaxTotal: 785.69,
      priceTaxMode: 'net',
      documentTaxRate: 22,
      items: [
        {
          index: 1,
          sourceText: 'Camiseta L',
          description: 'Camiseta L',
          quantity: 6,
          unitCost: 163.11,
          matchStatus: 'resolved',
          matchedProductId: 'p1',
          matchedProductName: 'Camiseta algodón Negro L',
        },
        {
          index: 2,
          sourceText: 'Taza',
          description: 'Taza',
          quantity: 5,
          unitCost: 36.07,
          matchStatus: 'resolved',
          matchedProductId: 'p2',
          matchedProductName: 'Taza AA Blanco',
        },
      ],
    };
    const lineNet = 6 * 163.11 + 5 * 36.07;
    const recognizedGross = computeRecognizedGrossTotal(draft);
    assert.ok(Math.abs(recognizedGross - lineNet * 1.22) < 0.1);
    assert.notEqual(recognizedGross, 4357);
    assert.equal(computeDraftTotal(draft), 4357);
  });
});

describe('Final purchase review', () => {
  it('shows card installments in payment section', () => {
    const draft: VisualDocumentDraft = {
      id: 'vd_review',
      kind: 'purchase',
      status: 'awaiting_confirmation',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      sourceMessageIds: [],
      supplierName: 'Disershop',
      paymentMedioLabel: 'Tarjeta de crédito',
      paymentTarjetaLabel: 'BROU Recompensa Master',
      paymentCuotas: 3,
      paymentDueDate: '2026-09-10',
      itemsReviewAcknowledged: true,
      documentGrossTotal: 150,
      documentNetTotal: 122.95,
      documentTaxTotal: 27.05,
      items: [
        {
          index: 1,
          sourceText: 'Taza',
          description: 'Taza',
          quantity: 5,
          unitCost: 36.07,
          matchStatus: 'resolved',
          matchedProductId: 'p1',
          matchedProductName: 'Taza AA Blanco',
        },
      ],
    };
    const review = presentVisualPurchaseFinalReview(draft);
    assert.match(review, /3 cuotas|Cuotas: 3|Pago:.*3/);
    assert.match(review, /10\/09\/2026/);
    assert.match(review, /Neto \$122,95/);
    assert.match(review, /IVA \$27,05/);
    assert.match(review, /\*Total \$150\*/);
    assert.doesNotMatch(review, /Match:/i);
    assert.match(review, /5 Taza AA Blanco · \$/);
  });
});

describe('Non-stock purchase item', () => {
  it('includes supply in financial total without stock line', () => {
    const draft: VisualDocumentDraft = {
      id: 'vd_supply',
      kind: 'purchase',
      status: 'awaiting_confirmation',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      sourceMessageIds: [],
      supplierName: 'Proveedor',
      documentGrossTotal: 183,
      documentNetTotal: 150,
      documentTaxTotal: 33,
      priceTaxMode: 'net',
      documentTaxRate: 22,
      items: [
        {
          index: 1,
          sourceText: 'Product A',
          description: 'Product A',
          quantity: 1,
          unitCost: 100,
          matchStatus: 'resolved',
          matchedProductId: 'p1',
          matchedProductName: 'Product A',
        },
        {
          index: 2,
          sourceText: 'Supply',
          description: 'Supply',
          quantity: 1,
          unitCost: 50,
          matchStatus: 'resolved',
          unresolvedAction: 'free_line',
        },
      ],
    };
    assert.equal(computeRecognizedGrossTotal(draft), 183);
    assert.equal(computeDraftTotal(draft), 183);
  });
});

describe('Discard semantics', () => {
  it('excludes discarded item from totals', () => {
    const draft: VisualDocumentDraft = {
      id: 'vd_discard',
      kind: 'purchase',
      status: 'awaiting_confirmation',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      sourceMessageIds: [],
      supplierName: 'Proveedor',
      documentGrossTotal: 100,
      items: [
        {
          index: 1,
          sourceText: 'Real',
          description: 'Real',
          quantity: 1,
          unitCost: 100,
          matchStatus: 'resolved',
          matchedProductId: 'p1',
          matchedProductName: 'Real',
        },
        {
          index: 2,
          sourceText: 'OCR false',
          description: 'OCR false',
          quantity: 1,
          unitCost: 999,
          matchStatus: 'discarded',
          unresolvedAction: 'discard',
        },
      ],
    };
    const financial = computeDraftFinancialTotals(draft);
    assert.equal(financial.netTotal, 100);
  });
});

describe('Purchase total mismatch guard', () => {
  it('blocks confirmation when document gross exceeds recognized lines', async () => {
    const draft: VisualDocumentDraft = {
      id: 'vd_mismatch',
      kind: 'purchase',
      status: 'awaiting_resolution',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      sourceMessageIds: [],
      supplierName: 'Disershop',
      supplierId: 'sup1',
      documentGrossTotal: 4357,
      documentNetTotal: 3571.31,
      documentTaxTotal: 785.69,
      priceTaxMode: 'net',
      documentTaxRate: 22,
      paymentMedioId: 'tarjeta_credito',
      paymentMedioLabel: 'Tarjeta de crédito',
      paymentTarjetaId: 'card1',
      paymentTarjetaLabel: 'Master',
      paymentCuotas: 3,
      paymentDueDate: '2026-09-10',
      itemsReviewAcknowledged: true,
      items: [
        {
          index: 1,
          sourceText: 'Taza',
          description: 'Taza',
          quantity: 5,
          unitCost: 36.07,
          matchStatus: 'resolved',
          matchedProductId: 'p1',
          matchedProductName: 'Taza AA Blanco',
        },
      ],
    };
    const issue = await resolveVisualDraftBlockingIssue(draft, 'rilo', {
      medios: [
        {
          id: 'tarjeta_credito',
          label: 'Tarjeta de crédito',
          activo: true,
          cuentaHija: true,
          generaCuotas: true,
          generaCaja: false,
        },
      ],
      tarjetas: [
        { id: 'card1', label: 'Master', medioPagoId: 'tarjeta_credito', activa: true, diaVencimiento: 10 },
      ],
    } as never);
    assert.equal(issue?.issueKind, 'purchase_total_mismatch');
    assert.match(issue?.title ?? '', /Falta importe por resolver/);
  });
});
