import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolvePurchaseLineTax } from '../utils/purchase-tax.ts';
import {
  detectLinePriceTaxMode,
  inferDocumentTaxRate,
} from '../utils/purchase-document-totals.ts';
import {
  buildProductMatchFooterActions,
  ensurePurchaseDraftTaxMetadata,
  finalUnitCostForVisualItem,
  firstUnresolvedVisualIssue,
  presentVisualDraftIssueReply,
  type VisualDocumentDraft,
  type VisualDraftItem,
} from './v4-visual-draft.ts';
import { WA_LIST_ASK_PRODUCT } from '../../shared/whatsapp-visual.ts';

function baseDraft(extra: Partial<VisualDocumentDraft> = {}): VisualDocumentDraft {
  return {
    id: 'vd_tax',
    kind: 'purchase',
    status: 'awaiting_resolution',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sourceMessageIds: [],
    supplierName: 'Proveedor',
    items: [],
    ...extra,
  };
}

describe('Product match footer actions', () => {
  it('A) FAMILY_MATCH list keeps Crear with suggested name', () => {
    const item: VisualDraftItem = {
      index: 1,
      sourceText: 'Remera Polo Dry Negro S',
      description: 'Remera Polo Dry Negro S',
      quantity: 1,
      unitCost: 204.1,
      matchStatus: 'ambiguous',
      matchKind: 'FAMILY_MATCH_VARIANT_MISSING',
      missingVariant: 'S',
      familyLabel: 'Remera Polo Dry Negro',
      candidates: [
        { id: 'l', name: 'Remera Polo Dry Negro L' },
        { id: 'm', name: 'Remera Polo Dry Negro M' },
        { id: 'xl', name: 'Remera Polo Dry Negro XL' },
      ],
      candidatePool: [
        { id: 'l', name: 'Remera Polo Dry Negro L' },
        { id: 'm', name: 'Remera Polo Dry Negro M' },
        { id: 'xl', name: 'Remera Polo Dry Negro XL' },
        { id: 'xs', name: 'Remera Polo Dry Negro XS' },
        { id: 'xxl', name: 'Remera Polo Dry Negro XXL' },
      ],
      candidateOffset: 0,
    };
    const draft = baseDraft({ items: [item] });
    const issue = firstUnresolvedVisualIssue(draft);
    assert.ok(issue);
    assert.equal(issue!.issueKind, 'product_candidate_selection');
    assert.ok(issue!.candidates.some((row) => row.id === '__visual_create__'));
    assert.ok(issue!.candidates.some((row) => /Crear .Remera Polo Dry Negro S./.test(row.name)));
    assert.ok(!issue!.candidates.some((row) => row.id === '__visual_link_existing__'));
    assert.ok(!issue!.candidates.some((row) => row.id === '__visual_more_options__'));
    assert.ok(issue!.candidates.some((row) => row.id === '__visual_free_line__'));
    const reply = presentVisualDraftIssueReply(draft, issue!);
    assert.match(reply, /Crear .Remera Polo Dry Negro S./);
    assert.doesNotMatch(reply, /Buscar con otro nombre/);
    assert.doesNotMatch(reply, /Ver más opciones/);
    assert.doesNotMatch(reply, /Encontré esta misma línea|Encontré productos parecidos|No encontré/);
    assert.doesNotMatch(reply, /El talle S no está creado/);
    assert.doesNotMatch(reply, /Remito:|Neto unitario|Costo final/);
    assert.match(reply, /📦 \*Remera Polo Dry Negro S\*/);
    assert.doesNotMatch(reply, /Empecemos por|Listo, asocié/);
    assert.match(reply, /1\. 👕 Remera Polo Dry Negro L/);
    assert.equal((reply.match(/Si no es ninguno/g) ?? []).length, 1);
    assert.ok(reply.endsWith(WA_LIST_ASK_PRODUCT));
  });

  it('footer actions stay stable across pages', () => {
    const item: VisualDraftItem = {
      index: 1,
      sourceText: 'Remera Polo Dry Negro S',
      description: 'Remera Polo Dry Negro S',
      matchStatus: 'ambiguous',
      candidates: [],
    };
    const page0 = buildProductMatchFooterActions({ kind: 'purchase' }, item, {
      hasMore: true,
      offset: 0,
    });
    const page1 = buildProductMatchFooterActions({ kind: 'purchase' }, item, {
      hasMore: false,
      offset: 3,
    });
    assert.ok(!page0.some((row) => row.id === '__visual_more_options__'));
    assert.ok(!page0.some((row) => row.id === '__visual_link_existing__'));
    assert.ok(page0.some((row) => row.id === '__visual_create__'));
    assert.ok(page1.some((row) => row.id === '__visual_create__'));
    assert.ok(page1.some((row) => row.id === '__visual_candidate_back__'));
  });
});

describe('Purchase invoice tax / final cost', () => {
  it('B2) taxRate fracción 0.22 se normaliza a 22%', () => {
    const snap = resolvePurchaseLineTax({
      unitCostNet: 204.1,
      taxRate: 0.22,
      priceTaxMode: 'net',
    });
    assert.equal(snap.taxRate, 22);
    assert.equal(snap.grossUnitCost, 249);
  });

  it('B) net 204.10 + IVA 22% → final ≈ 249.00', () => {
    const draft = baseDraft({
      documentNetTotal: 11942.62,
      documentTaxTotal: 2627.38,
      documentGrossTotal: 14570,
      total: 14570,
      items: [
        {
          index: 1,
          sourceText: 'Remera Polo Dry Negro',
          description: 'Remera Polo Dry Negro',
          quantity: 1,
          unitCost: 204.1,
          matchStatus: 'resolved',
          matchedProductId: 'p1',
          matchedProductName: 'Remera Polo Dry Negro L',
        },
      ],
    });
    ensurePurchaseDraftTaxMetadata(draft, null);
    assert.equal(draft.priceTaxMode, 'net');
    assert.ok(Math.abs((draft.documentTaxRate ?? 0) - 22) < 0.05);
    const item = draft.items[0]!;
    assert.equal(item.unitCostNet, 204.1);
    assert.equal(item.grossUnitCost, 249);
    assert.equal(finalUnitCostForVisualItem(item), 249);
    assert.equal(item.unitCost, 249);
  });

  it('C) gross lines do not double-apply IVA', () => {
    const snap = resolvePurchaseLineTax(
      { unitCost: 249, priceTaxMode: 'gross', taxRate: 22 },
      { defaultPurchaseTaxRate: 22 }
    );
    assert.equal(snap.grossUnitCost, 249);
    const draft = baseDraft({
      documentGrossTotal: 249,
      total: 249,
      items: [
        {
          index: 1,
          sourceText: 'X',
          description: 'X',
          quantity: 1,
          unitCost: 249,
          matchStatus: 'resolved',
          matchedProductId: 'p1',
        },
      ],
    });
    ensurePurchaseDraftTaxMetadata(draft, 22);
    assert.equal(draft.priceTaxMode, 'gross');
    assert.equal(draft.items[0]!.unitCost, 249);
    assert.equal(finalUnitCostForVisualItem(draft.items[0]!), 249);
  });

  it('D) detected rate is not hardcoded 22', () => {
    const draft = baseDraft({
      documentNetTotal: 1000,
      documentTaxTotal: 100,
      documentGrossTotal: 1100,
      total: 1100,
      items: [
        {
          index: 1,
          sourceText: 'Y',
          description: 'Y',
          quantity: 1,
          unitCost: 1000,
          matchStatus: 'resolved',
          matchedProductId: 'p2',
        },
      ],
    });
    ensurePurchaseDraftTaxMetadata(draft, 22);
    assert.equal(draft.priceTaxMode, 'net');
    assert.equal(draft.documentTaxRate, 10);
    assert.equal(draft.items[0]!.grossUnitCost, 1100);
    assert.equal(inferDocumentTaxRate({ documentNetTotal: 1000, documentTaxTotal: 100 }), 10);
  });

  it('E) reconciles neto + IVA = total', () => {
    assert.equal(
      detectLinePriceTaxMode({
        lineSum: 11942.62,
        documentNetTotal: 11942.62,
        documentTaxTotal: 2627.38,
        documentGrossTotal: 14570,
      }),
      'net'
    );
    const draft = baseDraft({
      documentNetTotal: 11942.62,
      documentTaxTotal: 2627.38,
      documentGrossTotal: 14570,
      total: 14570,
      items: [
        {
          index: 1,
          sourceText: 'L1',
          description: 'L1',
          quantity: 1,
          unitCost: 11942.62,
          matchStatus: 'resolved',
          matchedProductId: 'p1',
        },
      ],
    });
    ensurePurchaseDraftTaxMetadata(draft, null);
    assert.equal(draft.documentNetTotal, 11942.62);
    assert.equal(draft.documentTaxTotal, 2627.38);
    assert.equal(draft.documentGrossTotal, 14570);
    assert.ok(Math.abs(11942.62 + 2627.38 - 14570) < 0.01);
  });
});
