import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildRenamePreview,
  filterVariantsByConstraints,
  type ProductVariantRow,
} from '../domain/stock/product-rename-service.ts';
import { pageChoicePool } from './catalog-rank.ts';
import { WA_CHOICE_PAGE_SIZE } from '../../shared/whatsapp-format.ts';
import {
  VISUAL_MORE_OPTIONS,
  applyVisualDraftSelection,
  candidateOptionsForIssue,
  firstUnresolvedVisualIssue,
  presentVisualDraftIssueReply,
  type VisualDocumentDraft,
  type VisualDraftItem,
} from './v4-visual-draft.ts';
import { replyForCandidateSelectionToolOutput } from './agent/openai-agent.ts';
import { presentToolAmbiguity } from './agent/agent-presenter.ts';

function variant(partial: Partial<ProductVariantRow> & { id: string; name: string }): ProductVariantRow {
  return {
    nombreBase: 'Remera Dry',
    color: 'Negro',
    talle: 'S',
    stock: 10,
    price: 100,
    cost: 50,
    ...partial,
  };
}

function ambiguousDraft(poolSize: number): VisualDocumentDraft {
  const pool = Array.from({ length: poolSize }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Producto ${i + 1}`,
  }));
  const page = pageChoicePool(pool, 0, WA_CHOICE_PAGE_SIZE);
  const item: VisualDraftItem = {
    index: 1,
    sourceText: 'item',
    description: 'item',
    quantity: 1,
    matchStatus: 'ambiguous',
    candidates: page.shown,
    candidatePool: pool,
    candidateOffset: 0,
  };
  return {
    id: 'draft-1',
    kind: 'purchase',
    status: 'awaiting_resolution',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sourceMessageIds: ['m1'],
    items: [item],
  };
}

describe('product candidate pagination', () => {
  it('first page shows at most 3 products without Ver mas / Buscar numerados', () => {
    const draft = ambiguousDraft(8);
    const issue = firstUnresolvedVisualIssue(draft);
    assert.ok(issue);
    assert.equal(issue!.issueKind, 'product_candidate_selection');
    const options = candidateOptionsForIssue(issue!);
    const products = options.filter((row) => !String(row.entityId).startsWith('__visual_'));
    assert.equal(products.length, 3);
    assert.ok(!options.some((row) => row.entityId === VISUAL_MORE_OPTIONS));
    const reply = presentVisualDraftIssueReply(draft, issue!);
    assert.match(reply, /👕 Producto 1/);
    assert.doesNotMatch(reply, /Producto sin vincular|Encontré productos parecidos/i);
    assert.doesNotMatch(reply, /Remito:|El talle/);
    assert.doesNotMatch(reply, /Ver más opciones/);
    assert.doesNotMatch(reply, /Buscar con otro nombre/);
    assert.match(reply, /Si no es ninguno, indicame el nombre/);
    assert.match(reply, /0\. ❌ Cancelar compra/);
    assert.match(reply, /➕ Crear/);
    assert.doesNotMatch(reply, /^[1-9]\. ❌ Cancelar/m);
    const cancelOpt = options.find((row) => row.entityId.startsWith('__visual_candidate_cancel'));
    assert.equal(cancelOpt?.index, 0);
  });

  it('pool still pages when Ver mas is applied via selection API (compat)', () => {
    const draft = ambiguousDraft(8);
    const next = applyVisualDraftSelection({
      draft,
      option: { index: 4, entityId: VISUAL_MORE_OPTIONS, label: 'Ver mas' },
      resume: {
        originalUserText: 'foto',
        blockedTool: 'ingest_visual_document',
        draftId: draft.id,
        itemIndex: 1,
        party: 'item',
      },
    });
    const item = next.items[0]!;
    assert.equal(item.candidateOffset, 3);
    assert.deepEqual(
      item.candidates?.map((row) => row.id),
      ['p4', 'p5', 'p6']
    );
    const issue2 = firstUnresolvedVisualIssue(next)!;
    const ids = candidateOptionsForIssue(issue2)
      .filter((row) => !String(row.entityId).startsWith('__visual_'))
      .map((row) => row.entityId);
    assert.deepEqual(ids, ['p4', 'p5', 'p6']);
    assert.ok(!ids.includes('p1'));
  });

  it('does not offer more when only 2 reliable candidates', () => {
    const draft = ambiguousDraft(2);
    const issue = firstUnresolvedVisualIssue(draft)!;
    const options = candidateOptionsForIssue(issue);
    assert.equal(
      options.filter((row) => !String(row.entityId).startsWith('__visual_')).length,
      2
    );
    assert.ok(!options.some((row) => row.entityId === VISUAL_MORE_OPTIONS));
  });

  it('agent selection reply keeps visual presenter', () => {
    const draft = ambiguousDraft(8);
    const issue = firstUnresolvedVisualIssue(draft)!;
    const presented = presentVisualDraftIssueReply(draft, issue);
    const mangled = presentToolAmbiguity('product', {
      status: 'ambiguous',
      title: issue.title,
      candidates: issue.candidates,
    });
    assert.ok(mangled);
    assert.match(mangled!, /Indicame qué ítem querés usar|qué querés hacer|Si no es ninguno/);

    const reply = replyForCandidateSelectionToolOutput(
      {
        status: 'ambiguous',
        entityType: 'product',
        issueKind: 'product_candidate_selection',
        message: presented,
        candidates: issue.candidates,
        selectionPatch: { pendingIntent: 'candidate_selection_v4' },
        title: issue.title,
      },
      'product'
    );
    assert.equal(reply, presented);
    assert.match(reply, /0\. ❌ Cancelar compra/);
    assert.match(reply, /Si no es ninguno|qué querés hacer/i);
    assert.match(reply, /➕ Crear/);
  });
});

describe('product rename preview (structural family)', () => {
  it('bulk preview preserves variant suffixes', () => {
    const variants = [
      variant({ id: '1', name: 'Remera Dry Negro S', talle: 'S' }),
      variant({ id: '2', name: 'Remera Dry Negro M', talle: 'M' }),
      variant({ id: '3', name: 'Remera Dry Negro L', talle: 'L' }),
      variant({ id: '4', name: 'Remera Dry Negro XL', talle: 'XL' }),
    ];
    const preview = buildRenamePreview({
      variants,
      selected: variants,
      oldBaseName: 'Remera Dry',
      newBaseName: 'Remera Polo Dry',
      scope: 'matching_variants',
    });
    assert.equal(preview.status, 'ready');
    assert.equal(preview.selectedIds.length, 4);
    assert.deepEqual(
      preview.previewNames.map((row) => row.to),
      [
        'Remera Polo Dry Negro S',
        'Remera Polo Dry Negro M',
        'Remera Polo Dry Negro L',
        'Remera Polo Dry Negro XL',
      ]
    );
  });

  it('constraints can shrink scope before write', () => {
    const variants = [
      variant({ id: '1', name: 'Remera Dry Negro S', color: 'Negro', talle: 'S' }),
      variant({ id: '2', name: 'Remera Dry Negro XL', color: 'Negro', talle: 'XL' }),
      variant({ id: '3', name: 'Remera Dry Blanco M', color: 'Blanco', talle: 'M' }),
    ];
    const selected = filterVariantsByConstraints(variants, {
      colors: ['Negro'],
      sizes: ['S', 'M', 'L'],
    });
    assert.deepEqual(
      selected.map((row) => row.id),
      ['1']
    );
  });

  it('asks scope when auto and multiple variants', () => {
    const variants = [
      variant({ id: '1', name: 'Remera Dry Negro S', talle: 'S' }),
      variant({ id: '2', name: 'Remera Dry Negro M', talle: 'M' }),
    ];
    const preview = buildRenamePreview({
      variants,
      selected: variants,
      oldBaseName: 'Remera Dry',
      newBaseName: 'Remera Polo Dry',
      scope: 'matching_variants',
      needsScopeAsk: true,
    });
    assert.equal(preview.status, 'needs_scope');
    assert.equal(preview.previewNames.length, 0);
  });
});
