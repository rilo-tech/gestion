import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import { buildCandidateSelectionState } from './v4-candidate-selection.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import {
  isCatalogDeixisOrShowOptionsRequest,
  extractCatalogProductQueryFromUserText,
  matchShownCatalogCandidate,
  presentVisualDraftIssueReply,
  resolveCatalogSearchQueryFromUserText,
  tryResolveVisualCatalogProductTurn,
  VISUAL_CANDIDATE_CANCEL,
  VISUAL_NOT_FOUND_CREATE,
  VISUAL_NOT_FOUND_DISCARD,
  VISUAL_NOT_FOUND_FREE,
  VISUAL_NOT_FOUND_LINK,
  type VisualDocumentDraft,
  type VisualDraftDeps,
} from './v4-visual-draft.ts';
import { WA_LIST_ASK_PRODUCT } from '../../shared/whatsapp-visual.ts';

const tenant: WhatsappTenantContext = {
  businessId: 'rilo',
  phone: '+59899112233',
  platformAccess: {
    whatsappEnabled: true,
    aiEnabled: true,
    erpWebEnabled: true,
    whatsappOperationalStatus: 'active',
  } as WhatsappTenantContext['platformAccess'],
};

const poloFamily = [
  { id: 'polo-l', name: 'Remera Polo Dry Negro L' },
  { id: 'polo-m', name: 'Remera Polo Dry Negro M' },
  { id: 'polo-xl', name: 'Remera Polo Dry Negro XL' },
  { id: 'polo-xs', name: 'Remera Polo Dry Negro XS' },
  { id: 'polo-xxl', name: 'Remera Polo Dry Negro XXL' },
];

const visualDeps: VisualDraftDeps = {
  loadPurchasePaymentContext: async () => ({
    medios: [
      {
        id: 'proveedor',
        label: 'Crédito',
        activo: true,
        comportamiento: 'proveedor',
        generaCuentasPagar: true,
        generaEgresoCaja: false,
      },
    ],
    tarjetas: [],
  }),
  findProduct: async (_businessId, query) => {
    const q = String(query ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '');
    if (q.includes('remera polo dry negro') && (q.includes(' s') || q.endsWith('s'))) {
      return {
        status: 'family_variant_missing',
        query,
        candidates: poloFamily,
        missingVariant: 'S',
        familyLabel: 'Remera Polo Dry Negro',
        matchKind: 'FAMILY_MATCH_VARIANT_MISSING',
      };
    }
    if (q === 'es ese' || q === 'ese mismo' || q === 'mostrame opciones') {
      return { status: 'not_found', query };
    }
    return { status: 'not_found', query };
  },
  findSupplier: async (_businessId, query) => ({
    status: 'resolved',
    entity: { id: 'sup-1', name: 'Textil Norte' },
    query,
  }),
};

function emptyState(extra?: Partial<ConversationState>): ConversationState {
  return {
    businessId: tenant.businessId,
    phone: tenant.phone,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

function notFoundPoloDraft(): VisualDocumentDraft {
  return {
    id: 'draft-polo-1',
    kind: 'purchase',
    status: 'awaiting_resolution',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    supplierId: 'sup-1',
    supplierName: 'Textil Norte',
    supplierMatchStatus: 'resolved',
    items: [
      {
        index: 1,
        sourceText: 'Remera Polo Dry Negro S',
        description: 'Remera Polo Dry Negro S',
        quantity: 1,
        unitCost: 1200,
        matchStatus: 'not_found',
        attributes: { type: 'remera', fabric: 'dry', color: 'negro', size: 'S', model: 'polo' },
      },
    ],
  };
}

describe('visual catalog deixis + family missing', () => {
  it('detects deixis / show-options phrases', () => {
    assert.equal(isCatalogDeixisOrShowOptionsRequest('es ese'), true);
    assert.equal(isCatalogDeixisOrShowOptionsRequest('ese mismo'), true);
    assert.equal(isCatalogDeixisOrShowOptionsRequest('mostrame opciones'), true);
    assert.equal(isCatalogDeixisOrShowOptionsRequest('Remera Polo Dry Negro S'), false);
  });

  it('maps «es ese» to extracted remito text', () => {
    const resolved = resolveCatalogSearchQueryFromUserText({
      text: 'es ese',
      extractedDescription: 'Remera Polo Dry Negro S',
    });
    assert.equal(resolved.query, 'Remera Polo Dry Negro S');
    assert.equal(resolved.confirmedExtracted, true);
    assert.equal(resolved.showOptions, true);
  });

  it('strips «está con el nombre…» and glued nombreCamiseta', () => {
    assert.equal(
      extractCatalogProductQueryFromUserText('Está con el nombreCamiseta algodón gris S'),
      'Camiseta algodón gris S'
    );
    assert.equal(
      extractCatalogProductQueryFromUserText('se llama Camiseta algodón Gris S'),
      'Camiseta algodón Gris S'
    );
    const resolved = resolveCatalogSearchQueryFromUserText({
      text: 'Está con el nombreCamiseta algodón gris S',
    });
    assert.equal(resolved.query, 'Camiseta algodón gris S');
  });

  it('matchShownCatalogCandidate picks the listed product by restated name', () => {
    const hit = matchShownCatalogCandidate('Está con el nombreCamiseta algodón gris S', [
      { id: 'p1', name: 'Camiseta algodón Gris S' },
      { id: 'p2', name: 'Camiseta dry Negro M' },
    ]);
    assert.ok(hit);
    assert.equal(hit!.id, 'p1');
  });

  it('free-text catalog name pide confirmar el candidato mostrado (no auto-vincula)', async () => {
    const draft: VisualDocumentDraft = {
      id: 'draft-camiseta-1',
      kind: 'purchase',
      status: 'awaiting_resolution',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      supplierId: 'sup-1',
      supplierName: 'Textil Norte',
      supplierMatchStatus: 'resolved',
      items: [
        {
          index: 1,
          sourceText: 'Camiseta gris melange S',
          description: 'Camiseta gris melange S',
          quantity: 1,
          unitCost: 500,
          matchStatus: 'ambiguous',
          candidates: [{ id: 'cam-gris-s', name: 'Camiseta algodón Gris S' }],
          candidatePool: [{ id: 'cam-gris-s', name: 'Camiseta algodón Gris S' }],
          candidateOffset: 0,
        },
      ],
    };
    const selection = buildCandidateSelectionState({
      entityType: 'product',
      options: [
        { index: 0, entityId: VISUAL_CANDIDATE_CANCEL, label: '❌ Cancelar compra' },
        { index: 1, entityId: 'cam-gris-s', label: '👕 Camiseta algodón Gris S' },
        { index: 2, entityId: VISUAL_NOT_FOUND_CREATE, label: '➕ Crear producto' },
        { index: 3, entityId: VISUAL_NOT_FOUND_FREE, label: '🧰 Registrar como insumo sin stock' },
        { index: 4, entityId: VISUAL_NOT_FOUND_DISCARD, label: '🗑️ Descartar del documento' },
      ],
      prompt: 'Elegí producto',
      resume: {
        originalUserText: 'remito',
        blockedTool: 'ingest_visual_document',
        sourceTool: 'ingest_visual_document',
        draftId: draft.id,
        itemIndex: 1,
        party: 'item',
      },
    });

    let saved: ConversationState | null = null;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: {
          from: tenant.phone,
          text: 'Está con el nombreCamiseta algodón gris S',
          messageId: 'name-1',
        },
        text: 'Está con el nombreCamiseta algodón gris S',
        state: emptyState({
          visualDraft: draft,
          ...selection,
          activeTask: {
            intent: 'visual_draft_resolution',
            awaiting: {
              type: 'unresolved_catalog_item',
              itemIndex: 1,
              draftId: draft.id,
              extractedDescription: 'Camiseta gris melange S',
            },
          },
        }),
      },
      {
        rememberOp: async () => {},
        clearState: async () => {},
        appendTurns: async () => {},
        assertAi: async () => {},
        visualDraftDeps: {
          ...visualDeps,
          findProduct: async (_businessId, query) => {
            const q = String(query ?? '')
              .toLowerCase()
              .normalize('NFD')
              .replace(/\p{Diacritic}/gu, '');
            if (q.includes('camiseta') && q.includes('algodon') && q.includes('gris')) {
              return {
                status: 'resolved',
                entity: { id: 'cam-gris-s', name: 'Camiseta algodón Gris S' },
                query,
              };
            }
            return { status: 'not_found', query };
          },
        },
        saveState: async (_b, _p, patch) => {
          saved = {
            businessId: tenant.businessId,
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            ...patch,
          } as ConversationState;
          return saved;
        },
        createAgent: () => {
          throw new Error('LLM must not clear candidates when user restates catalog name');
        },
      }
    );

    assert.match(result.reply, /1\. 👕 Camiseta algod[oó]n Gris S/i);
    assert.match(result.reply, /¿Es \*Camiseta algod[oó]n Gris S\*\? Respondé \*1\* para confirmar/i);
    assert.equal(result.intent, 'v4_visual_product_match');
    const updated = saved?.visualDraft as VisualDocumentDraft;
    assert.equal(updated.items[0]?.matchStatus, 'ambiguous');
    assert.equal(updated.items[0]?.manualLinkPending, true);
    assert.equal(updated.items[0]?.candidates?.[0]?.id, 'cam-gris-s');
  });

  it('«es ese» from not_found menu shows family candidates, never number-without-list', async () => {
    const draft = notFoundPoloDraft();
    const selection = buildCandidateSelectionState({
      entityType: 'product',
      options: [
        { index: 0, entityId: VISUAL_CANDIDATE_CANCEL, label: '❌ Cancelar compra' },
        { index: 1, entityId: VISUAL_NOT_FOUND_CREATE, label: '➕ Crear producto' },
        { index: 2, entityId: VISUAL_NOT_FOUND_FREE, label: '🧰 Registrar como insumo sin stock' },
        { index: 3, entityId: VISUAL_NOT_FOUND_LINK, label: '🔎 Buscar con otro nombre' },
        { index: 4, entityId: VISUAL_NOT_FOUND_DISCARD, label: '🗑️ Descartar del documento' },
      ],
      prompt: 'No encontré ese producto',
      resume: {
        originalUserText: 'remito',
        blockedTool: 'ingest_visual_document',
        sourceTool: 'ingest_visual_document',
        draftId: draft.id,
        itemIndex: 1,
        party: 'item',
      },
    });

    let saved: ConversationState | null = null;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'es ese', messageId: 'deixis-1' },
        text: 'es ese',
        state: emptyState({
          visualDraft: draft,
          ...selection,
          activeTask: {
            intent: 'visual_draft_resolution',
            awaiting: {
              type: 'unresolved_catalog_item',
              itemIndex: 1,
              draftId: draft.id,
              extractedDescription: 'Remera Polo Dry Negro S',
            },
          },
        }),
      },
      {
        rememberOp: async () => {},
        clearState: async () => {},
        appendTurns: async () => {},
        assertAi: async () => {},
        visualDraftDeps: visualDeps,
        saveState: async (_b, _p, patch) => {
          saved = {
            businessId: tenant.businessId,
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            ...patch,
          } as ConversationState;
          return saved;
        },
        createAgent: () => {
          throw new Error('LLM must not invent «Indicame el número» without a list');
        },
      }
    );

    assert.match(result.reply, /Remera Polo Dry Negro S/i);
    assert.match(result.reply, /1\.\s*(?:👕\s*)?Remera Polo Dry Negro L/i);
    assert.doesNotMatch(result.reply, /talle S no (está|aparece)/i);
    assert.doesNotMatch(result.reply, /Indicame el número/i);
    const asks = result.reply.match(/Si no es ninguno|Indicame qué producto querés usar/g) ?? [];
    assert.equal(asks.length, 1, result.reply);
    assert.ok(result.reply.endsWith(WA_LIST_ASK_PRODUCT));

    const updated = saved?.visualDraft as VisualDocumentDraft;
    assert.equal(updated.items[0]?.matchKind, 'FAMILY_MATCH_VARIANT_MISSING');
    assert.equal(updated.items[0]?.missingVariant, 'S');
    assert.ok((updated.items[0]?.candidates?.length ?? 0) >= 3);
  });

  it('presentVisualDraftIssueReply ends with a single product ask', () => {
    const draft = notFoundPoloDraft();
    draft.items[0] = {
      ...draft.items[0]!,
      matchStatus: 'ambiguous',
      matchKind: 'FAMILY_MATCH_VARIANT_MISSING',
      missingVariant: 'S',
      familyLabel: 'Remera Polo Dry Negro',
      candidates: poloFamily.slice(0, 5),
      candidatePool: poloFamily,
      candidateOffset: 0,
    };
    const reply = presentVisualDraftIssueReply(draft, {
      party: 'item',
      itemIndex: 1,
      entityType: 'product',
      issueKind: 'product_candidate_selection',
      candidates: [
        ...poloFamily,
        { id: '__visual_candidate_cancel__', name: '❌ Cancelar compra' },
      ],
      title: 'Misma línea',
    });
    assert.doesNotMatch(reply, /Encontré esta misma línea|No encontré|El talle|Empecemos por/i);
    assert.match(reply, /📦 \*Remera Polo Dry Negro S\*/);
    assert.match(reply, /1\.\s*(?:👕\s*)?Remera Polo Dry Negro/i);
    assert.equal((reply.match(/Si no es ninguno|Indicame qué /g) ?? []).length, 1);
  });

  it('tryResolveVisualCatalogProductTurn rematches extracted text on show-options', async () => {
    const draft = notFoundPoloDraft();
    const out = await tryResolveVisualCatalogProductTurn({
      text: 'mostrame opciones',
      state: emptyState({
        visualDraft: draft,
        activeTask: {
          intent: 'visual_draft_resolution',
          awaiting: {
            type: 'unresolved_catalog_item',
            itemIndex: 1,
            draftId: draft.id,
            extractedDescription: 'Remera Polo Dry Negro S',
          },
        },
      }),
      tenant,
      deps: visualDeps,
    });
    assert.ok(out);
    assert.match(out!.reply, /1\.\s*(?:👕\s*)?Remera Polo Dry Negro/i);
    assert.doesNotMatch(out!.reply, /No encontré exactamente Remera Polo Dry Negro S/i);
    assert.match(out!.reply, /Si no es ninguno, indicame el nombre/);
  });
});
