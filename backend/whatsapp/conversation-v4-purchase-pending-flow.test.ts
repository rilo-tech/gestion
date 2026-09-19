import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VISUAL_NOT_FOUND_CREATE,
  applyVisualDraftSelection,
  buildProductResolutionLead,
  countUnresolvedVisualItems,
  firstUnresolvedVisualIssue,
  presentVisualDraftIssueReply,
  shouldResumeExistingPurchaseDraft,
  type VisualDocumentDraft,
  type VisualDraftItem,
} from './v4-visual-draft.ts';
import { WA_LIST_ASK_PRODUCT } from '../../shared/whatsapp-visual.ts';

function draftWithPending(items: VisualDraftItem[]): VisualDocumentDraft {
  return {
    id: 'vd_pending',
    kind: 'purchase',
    status: 'awaiting_resolution',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sourceMessageIds: ['m1'],
    invoiceNumber: 'A-100',
    supplierName: 'Proveedor',
    items,
  };
}

describe('Purchase pending product resolution flow', () => {
  it('Case D not_found: create / search / free / cancel — no weak products', () => {
    const item: VisualDraftItem = {
      index: 1,
      sourceText: 'Body sublimable blanco 0 Mes',
      description: 'Body sublimable blanco 0 Mes',
      quantity: 2,
      unitCostNet: 100,
      taxRate: 22,
      unitCost: 122,
      matchStatus: 'not_found',
    };
    const draft = draftWithPending([item]);
    const issue = firstUnresolvedVisualIssue(draft)!;
    assert.equal(issue.issueKind, 'visual_not_found_menu');
    const reply = presentVisualDraftIssueReply(draft, issue, { lead: 'start' });
    assert.doesNotMatch(reply, /No encontré un producto suficientemente parecido/);
    assert.doesNotMatch(reply, /Remito:|Neto unitario|Costo final|Cantidad:/);
    assert.match(reply, /📦 \*Body sublimable blanco 0 Mes\*/);
    assert.doesNotMatch(reply, /Empecemos por|Ahora falta|Listo, asocié/);
    assert.match(reply, /Crear .Body sublimable blanco 0 Mes./);
    assert.doesNotMatch(reply, /Buscar con otro nombre/);
    assert.doesNotMatch(reply, /Ver más opciones/);
    assert.match(reply, /Registrar como insumo sin stock/);
    assert.doesNotMatch(reply, /👕 /);
    assert.ok(reply.endsWith(WA_LIST_ASK_PRODUCT));
    assert.equal((reply.match(/Si no es ninguno/g) ?? []).length, 1);
  });

  it('sequential: resolve first → continue lead + options for next', () => {
    const items: VisualDraftItem[] = [
      {
        index: 1,
        sourceText: 'Remera Polo Dry Negro S',
        description: 'Remera Polo Dry Negro S',
        quantity: 1,
        unitCostNet: 204.1,
        taxRate: 22,
        unitCost: 249,
        matchStatus: 'ambiguous',
        matchKind: 'FAMILY_MATCH_VARIANT_MISSING',
        missingVariant: 'S',
        familyLabel: 'Remera Polo Dry Negro',
        candidates: [
          { id: 'l', name: 'Remera Polo Dry Negro L' },
          { id: 'm', name: 'Remera Polo Dry Negro M' },
        ],
        candidatePool: [
          { id: 'l', name: 'Remera Polo Dry Negro L' },
          { id: 'm', name: 'Remera Polo Dry Negro M' },
          { id: 'xl', name: 'Remera Polo Dry Negro XL' },
        ],
        candidateOffset: 0,
      },
      {
        index: 2,
        sourceText: 'Body sublimable blanco 0 Mes',
        description: 'Body sublimable blanco 0 Mes',
        quantity: 3,
        unitCostNet: 50,
        taxRate: 22,
        unitCost: 61,
        matchStatus: 'not_found',
      },
    ];
    const draft = draftWithPending(items);
    assert.equal(countUnresolvedVisualItems(draft), 2);
    const first = firstUnresolvedVisualIssue(draft)!;
    assert.equal(first.itemIndex, 1);
    const startReply = presentVisualDraftIssueReply(draft, first, { lead: 'start' });
    assert.match(startReply, /Quedan 2 productos por resolver/);
    assert.match(startReply, /📦 \*Remera Polo Dry Negro S\*/);
    assert.match(startReply, /Crear "Remera Polo Dry Negro S"/);
    assert.doesNotMatch(startReply, /Empecemos por|Remito:|El talle|No encontré|Encontré productos/);

    const after = applyVisualDraftSelection({
      draft,
      option: { index: 2, entityId: 'm', label: 'Remera Polo Dry Negro M' },
      resume: {
        originalUserText: 'foto',
        blockedTool: 'ingest_visual_document',
        draftId: draft.id,
        itemIndex: 1,
        party: 'item',
      },
    });
    assert.equal(after.items[0]?.matchStatus, 'resolved');
    assert.equal(after.items[0]?.unitCostNet, 204.1);
    assert.equal(after.items[0]?.taxRate, 22);
    assert.equal(after.items[0]?.unitCost, 249);
    assert.equal(countUnresolvedVisualItems(after), 1);
    const next = firstUnresolvedVisualIssue(after)!;
    assert.equal(next.itemIndex, 2);
    const continueReply = presentVisualDraftIssueReply(after, next, { lead: 'continue' });
    assert.doesNotMatch(continueReply, /Listo, asocié|Empecemos por|Ahora falta/);
    assert.match(continueReply, /Queda 1 producto por resolver/);
    assert.match(continueReply, /📦 \*Body sublimable blanco 0 Mes\*/);
    assert.match(continueReply, /Crear "Body sublimable blanco 0 Mes"/);
    assert.doesNotMatch(continueReply, /¿Querés seguir/);
  });

  it('same remito name links once and propagates to duplicate lines', () => {
    const items: VisualDraftItem[] = [
      {
        index: 1,
        sourceText: 'Body sublimable blanco 0 Mes',
        description: 'Body sublimable blanco 0 Mes',
        quantity: 3,
        unitCostNet: 97.54,
        matchStatus: 'ambiguous',
        candidates: [{ id: 'body-1', name: 'Body sublimable blanco 0 Mes' }],
      },
      {
        index: 2,
        sourceText: 'Camiseta Dry Blanco M',
        description: 'Camiseta Dry Blanco M',
        quantity: 1,
        unitCost: 100,
        matchStatus: 'not_found',
      },
      {
        index: 3,
        sourceText: 'Body sublimable blanco 0 Mes',
        description: 'Body sublimable blanco 0 Mes',
        quantity: 2,
        unitCostNet: 97.54,
        matchStatus: 'not_found',
      },
    ];
    const draft = draftWithPending(items);
    assert.equal(countUnresolvedVisualItems(draft), 3);
    const after = applyVisualDraftSelection({
      draft,
      option: { index: 1, entityId: 'body-1', label: 'Body sublimable blanco 0 Mes' },
      resume: {
        originalUserText: 'foto',
        blockedTool: 'ingest_visual_document',
        draftId: draft.id,
        itemIndex: 1,
        party: 'item',
      },
    });
    assert.equal(after.items[0]?.matchStatus, 'resolved');
    assert.equal(after.items[0]?.matchedProductId, 'body-1');
    assert.equal(after.items[0]?.quantity, 3);
    assert.equal(after.items[2]?.matchStatus, 'resolved');
    assert.equal(after.items[2]?.matchedProductId, 'body-1');
    assert.equal(after.items[2]?.quantity, 2);
    assert.equal(countUnresolvedVisualItems(after), 1);
    const next = firstUnresolvedVisualIssue(after)!;
    assert.equal(next.itemIndex, 2);
    const reply = presentVisualDraftIssueReply(after, next, { lead: 'continue' });
    assert.match(reply, /Queda 1 producto por resolver/);
    assert.match(reply, /📦 \*Camiseta Dry Blanco M\*/);
    assert.doesNotMatch(reply, /Body sublimable|Listo, asocié|Empecemos por/);
  });

  it('resume same invoice shows first pending options immediately', () => {
    const draft = draftWithPending([
      {
        index: 1,
        sourceText: 'Camiseta Dry Blanco M',
        description: 'Camiseta Dry Blanco M',
        quantity: 1,
        unitCost: 100,
        matchStatus: 'not_found',
      },
    ]);
    assert.equal(
      shouldResumeExistingPurchaseDraft(draft, {
        kind: 'purchase',
        invoiceNumber: 'A-100',
        items: [{ description: 'Camiseta Dry Blanco M', quantity: 1, unitCost: 100 }],
      }),
      true
    );
    const issue = firstUnresolvedVisualIssue(draft)!;
    const lead = buildProductResolutionLead(draft, issue, 'resume');
    const reply = presentVisualDraftIssueReply(draft, issue, { lead: 'resume' });
    assert.match(String(lead), /Esta factura ya está cargada/);
    assert.match(reply, /📦 \*Camiseta Dry Blanco M\*/);
    assert.doesNotMatch(reply, /Empecemos por/);
    assert.match(reply, /Crear "Camiseta Dry Blanco M"/);
    assert.match(reply, /Crear "Camiseta Dry Blanco M"/);
    assert.doesNotMatch(reply, /listado anterior/i);
  });

  it('Crear stays on every page of the pool (compat)', () => {
    const pool = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Producto ${i + 1}`,
    }));
    const draft = draftWithPending([
      {
        index: 1,
        sourceText: 'Producto X',
        description: 'Producto X',
        matchStatus: 'ambiguous',
        candidates: pool.slice(0, 3),
        candidatePool: pool,
        candidateOffset: 0,
      },
    ]);
    const issue = firstUnresolvedVisualIssue(draft)!;
    assert.ok(issue.candidates.some((row) => row.id === VISUAL_NOT_FOUND_CREATE));
    assert.ok(!issue.candidates.some((row) => row.id === '__visual_more_options__'));
    assert.ok(!issue.candidates.some((row) => row.id === '__visual_link_existing__'));
    const next = applyVisualDraftSelection({
      draft,
      option: { index: 4, entityId: '__visual_more_options__', label: 'Ver mas' },
      resume: {
        originalUserText: 'foto',
        blockedTool: 'ingest_visual_document',
        draftId: draft.id,
        itemIndex: 1,
        party: 'item',
      },
    });
    const issue2 = firstUnresolvedVisualIssue(next)!;
    assert.ok(issue2.candidates.some((row) => row.id === VISUAL_NOT_FOUND_CREATE));
    assert.match(presentVisualDraftIssueReply(next, issue2), /Crear .Producto X./);
  });
});
