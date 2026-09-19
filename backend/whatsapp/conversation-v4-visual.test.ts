import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOpenAiUserMessage } from './agent/openai-image-input.ts';
import { buildAgentOperationPlan } from './agent/tools/write-tools.ts';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import { buildCandidateSelectionState } from './v4-candidate-selection.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import type { AgentOperationPlan } from './agent/tool-types.ts';
import type { ToolExecutionContext } from './agent/tool-types.ts';
import {
  ingestVisualDocument,
  isVisualDraftReadyToWrite,
  patchVisualDraft,
  plannedWriteFromVisualDraft,
  presentVisualNotFoundItemMenu,
  type VisualDocumentDraft,
  type VisualDraftDeps,
} from './v4-visual-draft.ts';

const tenant: WhatsappTenantContext = {
  businessId: 'rilo',
  phone: '+59899111111',
  platformAccess: {
    whatsappEnabled: true,
    aiEnabled: true,
    erpWebEnabled: true,
    whatsappOperationalStatus: 'active',
  } as WhatsappTenantContext['platformAccess'],
};

function ctx(state: ConversationState | null = null, raw = 'registrame esta compra'): ToolExecutionContext {
  return {
    tenant,
    state,
    messageId: 'wa-img-1',
    rawUserMessage: raw,
  };
}

function emptyState(extra?: Partial<ConversationState>): ConversationState {
  return {
    businessId: tenant.businessId,
    phone: tenant.phone,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

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
    if (q.includes('jarra cervecera')) {
      if (q.includes('ambiguo')) {
        return {
          status: 'ambiguous',
          query,
          candidates: [
            { id: 'jarra-1', name: 'Jarra Cervecera Esmerilada 375 ml' },
            { id: 'jarra-2', name: 'Jarra Cervecera Transparente 500 ml' },
            { id: 'jarra-3', name: 'Jarra Cervecera Blanca 450 ml' },
          ],
        };
      }
      return {
        status: 'resolved',
        entity: { id: 'jarra-1', name: 'Jarra Cervecera Esmerilada 375 ml' },
        query,
      };
    }
    if (q.includes('remera algodon')) {
      return {
        status: 'resolved',
        entity: { id: 'prod-a', name: 'Remera algodón · Negra · M' },
        query,
      };
    }
    if (q.includes('canguro')) {
      return {
        status: 'ambiguous',
        query,
        candidates: [
          { id: 'prod-b1', name: 'Remera algodón · Negra · M' },
          { id: 'prod-b2', name: 'Canguro azul XL' },
          { id: 'prod-b3', name: 'Remera algodón · Negra · L' },
        ],
      };
    }
    if (q.includes('gorra')) {
      return { status: 'not_found', query };
    }
    return { status: 'not_found', query };
  },
  findSupplier: async (_businessId, query) => ({
    status: 'resolved',
    entity: { id: 'sup-1', name: 'Textil Norte' },
    query,
  }),
  findClient: async (_businessId, query) => ({
    status: 'resolved',
    entity: { id: 'cli-maria', name: 'María' },
    query,
  }),
};

const noopPersist = {
  rememberOp: async () => {},
  clearState: async () => {},
  saveState: async (_b: string, _p: string, patch: Partial<ConversationState>) =>
    ({
      businessId: tenant.businessId,
      phone: tenant.phone,
      updatedAt: new Date().toISOString(),
      ...patch,
    }) as ConversationState,
  appendTurns: async () => {},
  assertAi: async () => {},
};

describe('V4 image input', () => {
  it('arma Responses API user content con input_image real', () => {
    const message = buildOpenAiUserMessage({
      text: 'registrame esta compra',
      image: { buffer: Buffer.from('fake-jpeg'), contentType: 'image/jpeg' },
    });
    assert.equal(message.role, 'user');
    assert.ok(Array.isArray(message.content));
    const parts = message.content as Array<Record<string, unknown>>;
    assert.equal(parts.some((part) => part.type === 'input_text'), true);
    const image = parts.find((part) => part.type === 'input_image');
    assert.ok(image);
    assert.match(String(image.image_url), /^data:image\/jpeg;base64,/);
  });
});

describe('V4 purchase image matching', () => {
  it('A resolved / B ambiguous / C not_found and does not write ERP', async () => {
    const output = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Textil Norte',
        items: [
          { description: 'Remera algodón negra M', quantity: 10, unitCost: 250 },
          { description: 'Canguro azul XL', quantity: 5, unitCost: 800 },
          { description: 'Gorra roja', quantity: 2, unitCost: 400 },
        ],
      },
      ctx(),
      visualDeps
    );

    const draft = output.draft as VisualDocumentDraft;
    assert.equal(output.wroteErp, false);
    assert.equal(draft.items[0]?.matchStatus, 'resolved');
    assert.equal(draft.items[0]?.matchedProductId, 'prod-a');
    assert.equal(draft.items[0]?.selectionSource, 'auto');
    assert.equal(draft.items[1]?.matchStatus, 'ambiguous');
    assert.equal(draft.items[2]?.matchStatus, 'not_found');
    assert.equal(isVisualDraftReadyToWrite(draft), false);
    assert.equal(output.status, 'ambiguous');
    assert.equal(output.itemIndex, 2);
    assert.ok(Array.isArray(output.candidates) && (output.candidates as unknown[]).length >= 3);
  });

  it('not_found menu offers create / free / search / discard / cancel', async () => {
    const output = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Textil Norte',
        items: [{ description: 'Gorra roja', quantity: 2, unitCost: 400 }],
      },
      ctx(),
      visualDeps
    );
    assert.equal((output.draft as VisualDocumentDraft).items[0]?.matchStatus, 'not_found');
    assert.equal(output.itemIndex, 1);
    assert.ok(Array.isArray(output.candidates) && (output.candidates as unknown[]).length === 4);
    const menu = presentVisualNotFoundItemMenu(1, (output.draft as VisualDocumentDraft).items[0]);
    assert.doesNotMatch(menu, /Buscar con otro nombre/);
    assert.doesNotMatch(menu, /No encontré un producto suficientemente parecido/);
    assert.doesNotMatch(menu, /Remito:|Neto unitario|Costo final/);
    assert.match(menu, /1\. ➕ Crear/);
    assert.match(menu, /Si no es ninguno, indicame el nombre con el que está guardado/);
    assert.doesNotMatch(menu, /Ver más opciones/);
  });
});

describe('V4 visual draft discard', () => {
  it('descarta el ítem 2 y deja 1 y 3', async () => {
    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Textil Norte',
        items: [
          { description: 'Remera algodón negra M', quantity: 10, unitCost: 250 },
          { description: 'Canguro azul XL', quantity: 5, unitCost: 800 },
          { description: 'Gorra roja', quantity: 2, unitCost: 400 },
        ],
      },
      ctx(),
      visualDeps
    );
    const state = emptyState({ visualDraft: ingested.draft as VisualDocumentDraft });
    const patched = await patchVisualDraft({ itemIndex: 2, discard: true }, ctx(state), visualDeps);
    const draft = patched.draft as VisualDocumentDraft;
    assert.equal(draft.items[1]?.matchStatus, 'discarded');
    assert.equal(draft.items[0]?.matchStatus, 'resolved');
    assert.equal(draft.items[2]?.matchStatus, 'not_found');
    assert.equal(draft.items.length, 3);
  });
});

describe('V4 visual numeric candidate selection', () => {
  it('"2" assigns productId of option 2 without LLM', async () => {
    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Textil Norte',
        items: [
          { description: 'Remera algodón negra M', quantity: 10, unitCost: 250 },
          { description: 'Canguro azul XL', quantity: 5, unitCost: 800 },
          { description: 'Gorra roja', quantity: 2, unitCost: 400 },
        ],
      },
      ctx(),
      visualDeps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    const awaiting = buildCandidateSelectionState({
      entityType: 'product',
      options: [
        { index: 1, entityId: 'prod-b1', label: 'Remera algodón · Negra · M' },
        { index: 2, entityId: 'prod-b2', label: 'Canguro azul XL' },
        { index: 3, entityId: 'prod-b3', label: 'Remera algodón · Negra · L' },
      ],
      resume: {
        originalUserText: 'registrame esta compra',
        blockedTool: 'ingest_visual_document',
        draftId: draft.id,
        itemIndex: 2,
        party: 'item',
      },
    });
    let agentCalls = 0;
    let saved: ConversationState | null = null;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '2', messageId: 'pick-2' },
        text: '2',
        state: emptyState({ ...awaiting, visualDraft: draft }),
      },
      {
        ...noopPersist,
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
          agentCalls += 1;
          throw new Error('LLM should not run on exact numeric pick');
        },
      }
    );

    assert.equal(agentCalls, 0);
    assert.equal(result.intent, 'v4_candidate_selected');
    const updated = saved?.visualDraft as VisualDocumentDraft;
    assert.equal(updated.items[1]?.matchedProductId, 'prod-b2');
    assert.equal(updated.items[1]?.selectionSource, 'user_selected');
    assert.equal(updated.items[0]?.matchedProductId, 'prod-a');
  });
});

describe('V4 visual catalog product link', () => {
  async function notFoundDraft() {
    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Textil Norte',
        items: [{ description: 'JARRA CERV X12', sourceText: 'JARRA CERV X12', quantity: 12, unitCost: 150 }],
      },
      ctx(),
      visualDeps
    );
    return ingested.draft as VisualDocumentDraft;
  }

  it('free text product name during not_found resuelve sin Agent y luego permite elegir 1', async () => {
    const draft = await notFoundDraft();
    assert.equal(draft.items[0]?.matchStatus, 'not_found');
    const awaiting = buildCandidateSelectionState({
      entityType: 'product',
      options: [
        { index: 1, entityId: '__visual_create__', label: 'Crear producto' },
        { index: 2, entityId: '__visual_free_line__', label: 'Dejarlo sin catálogo' },
        { index: 3, entityId: '__visual_discard__', label: 'Descartar ítem' },
      ],
      resume: {
        originalUserText: 'registrame esta compra',
        blockedTool: 'ingest_visual_document',
        draftId: draft.id,
        itemIndex: 1,
        party: 'item',
      },
    });
    let agentCalls = 0;
    let saved: ConversationState | null = null;
    const search = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'jarra cervecera', messageId: 'link-free' },
        text: 'jarra cervecera',
        state: emptyState({ ...awaiting, visualDraft: draft }),
      },
      {
        ...noopPersist,
        visualDraftDeps: visualDeps,
        saveState: async (_b, _p, patch) => {
          saved = { businessId: tenant.businessId, phone: tenant.phone, updatedAt: new Date().toISOString(), ...patch } as ConversationState;
          return saved;
        },
        createAgent: () => ({
          runTurn: async () => {
            agentCalls += 1;
            throw new Error('LLM should not run on free-text catalog match');
          },
        }),
      }
    );
    assert.equal(agentCalls, 0);
    assert.equal(search.intent, 'v4_visual_product_match');
    assert.doesNotMatch(search.reply, /No hay un borrador de imagen activo/i);
    assert.match(search.reply, /Jarra Cervecera Esmerilada 375 ml/);
    assert.doesNotMatch(search.reply, /Encontré productos parecidos|Producto encontrado|Producto sin vincular/i);

    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '1', messageId: 'pick-jarra' },
        text: '1',
        state: saved!,
      },
      {
        ...noopPersist,
        visualDraftDeps: visualDeps,
        saveState: async (_b, _p, patch) => {
          saved = { businessId: tenant.businessId, phone: tenant.phone, updatedAt: new Date().toISOString(), ...patch } as ConversationState;
          return saved;
        },
      }
    );
    assert.equal(result.intent, 'v4_candidate_selected');
    const updated = saved?.visualDraft as VisualDocumentDraft;
    assert.equal(updated.items[0]?.matchedProductId, 'jarra-1');
    assert.equal(updated.items[0]?.matchedProductName, 'Jarra Cervecera Esmerilada 375 ml');
    assert.equal(updated.items[0]?.selectionSource, 'user_selected');
    assert.equal(updated.items[0]?.sourceText, 'JARRA CERV X12');
    assert.equal(updated.items[0]?.quantity, 12);
    assert.equal(updated.items[0]?.unitCost, 150);
    assert.doesNotMatch(result.reply, /Listo, asocié/i);
    assert.match(result.reply, /Jarra Cervecera|Confirmo|¿Cómo se pagó|Compra/i);
  });

  it('free text desde menú unresolved busca y pide selección', async () => {
    const draft = await notFoundDraft();
    let saved: ConversationState | null = null;
    const linked = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'jarra cervecera', messageId: 'link-free-direct' },
        text: 'jarra cervecera',
        state: emptyState({
          visualDraft: draft,
          activeTask: {
            intent: 'visual_draft_resolution',
            awaiting: {
              type: 'unresolved_catalog_item',
              itemIndex: 1,
              draftId: draft.id,
              extractedDescription: 'JARRA CERV X12',
            },
          },
        }),
      },
      {
        ...noopPersist,
        visualDraftDeps: visualDeps,
        saveState: async (_b, _p, patch) => {
          saved = { businessId: tenant.businessId, phone: tenant.phone, updatedAt: new Date().toISOString(), ...patch } as ConversationState;
          return saved;
        },
        createAgent: () => {
          throw new Error('LLM should not run on free-text catalog match');
        },
      }
    );
    assert.equal(linked.intent, 'v4_visual_product_match');
    assert.match(linked.reply, /Jarra Cervecera Esmerilada 375 ml/);
    assert.doesNotMatch(linked.reply, /Encontré productos parecidos|Producto encontrado|Producto sin vincular/i);
    assert.equal((saved?.visualDraft as VisualDocumentDraft).items[0]?.matchedProductId, undefined);
  });

  it('2+ candidatos muestra selección numerada', async () => {
    const draft = await notFoundDraft();
    const patched = await patchVisualDraft(
      { itemIndex: 1, productQuery: 'jarra cervecera ambiguo' },
      ctx(emptyState({ visualDraft: draft })),
      visualDeps
    );
    assert.equal(patched.productLinkStatus, 'awaiting_selection');
    const candidates = Array.isArray(patched.candidates) ? (patched.candidates as Array<{ id: string }>) : [];
    const products = candidates.filter((row) => !String(row.id).startsWith('__visual_'));
    assert.ok(products.length >= 2);
    assert.match(String(patched.message), /1\./);
    assert.match(String(patched.message), /Si no es ninguno|qué querés hacer|Indicame/);
  });

  it('0 candidatos mantiene el draft pendiente y dice qué no encontró', async () => {
    const draft = await notFoundDraft();
    const patched = await patchVisualDraft(
      { itemIndex: 1, productQuery: 'producto inventado xyz', manualProductSearch: true },
      ctx(emptyState({ visualDraft: draft })),
      visualDeps
    );
    const updated = patched.draft as VisualDocumentDraft;
    assert.equal(updated.items[0]?.matchStatus, 'not_found');
    assert.equal(updated.items[0]?.sourceText, 'JARRA CERV X12');
    assert.equal(patched.productLinkStatus, 'not_found');
    assert.match(String(patched.message), /No encontré \*producto inventado xyz\* en tu catálogo/);
    assert.doesNotMatch(String(patched.message), /No encontré un producto suficientemente parecido/);
    assert.doesNotMatch(String(patched.message), /Remito:|Neto unitario/);
    assert.match(String(patched.message), /1\. ➕ Crear/);
    assert.doesNotMatch(String(patched.message), /Buscar con otro nombre/);
    assert.match(String(patched.message), /Si no es ninguno/);
  });
});

describe('V4 visual purchase confirm', () => {
  it('sí executes create_purchase once without adjust_stock', async () => {
    const plan: AgentOperationPlan = buildAgentOperationPlan(
      [
        {
          tool: 'create_purchase',
          label: 'Compra · Textil Norte',
          args: {
            supplierId: 'sup-1',
            supplierName: 'Textil Norte',
            purchaseLines: [
              { productId: 'prod-a', productName: 'Remera algodón negra M', quantity: 10, unitCost: 250 },
            ],
            visualDraftId: 'vd_test',
          },
        },
      ],
      'registrame esta compra',
      'wa:confirm-purchase:vd_test:create_purchase'
    );
    let executeCalls = 0;
    let agentCalls = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'sí', messageId: 'confirm-purchase' },
        text: 'sí',
        state: emptyState({
          pendingIntent: 'confirm:v4_write',
          pendingPayload: { plan },
          operationPlan: plan as unknown as Record<string, unknown>,
        }),
      },
      {
        ...noopPersist,
        createAgent: () => {
          agentCalls += 1;
          throw new Error('LLM should not run on deterministic sí');
        },
        executePlan: async (_tenant, received) => {
          executeCalls += 1;
          assert.equal(received.writes.length, 1);
          assert.equal(received.writes[0]?.tool, 'create_purchase');
          assert.equal(
            received.writes.some((row) => row.tool === 'adjust_stock'),
            false
          );
          return {
            reply: 'Listo. Compra registrada.',
            data: { kind: 'purchase', compraId: 'compra-1', label: 'C-0001' },
          };
        },
      }
    );
    assert.equal(agentCalls, 0);
    assert.equal(executeCalls, 1);
    assert.equal(result.executed, true);
    assert.equal(result.intent, 'v4_execute');
  });
});

describe('V4 handwritten order image', () => {
  it('builds OrderDraft, matches catalog, and confirms create_order', async () => {
    const output = await ingestVisualDocument(
      {
        kind: 'order',
        clientHint: 'María',
        deliveryDate: '2026-09-04',
        items: [
          { description: 'Remera negra M', quantity: 2 },
          { description: 'Canguro azul XL', quantity: 1 },
        ],
      },
      ctx(null, 'pedido manuscrito'),
      {
        ...visualDeps,
        findProduct: async (_businessId, query) => {
          const q = String(query ?? '').toLowerCase();
          if (q.includes('canguro')) {
            return { status: 'resolved', entity: { id: 'prod-order-2', name: 'Canguro azul XL' }, query };
          }
          return { status: 'resolved', entity: { id: 'prod-order-1', name: 'Remera negra M' }, query };
        },
      }
    );
    const draft = output.draft as VisualDocumentDraft;
    assert.equal(draft.kind, 'order');
    assert.equal(draft.clientId, 'cli-maria');
    assert.equal(draft.items[0]?.matchStatus, 'resolved');
    assert.equal(draft.items[1]?.matchStatus, 'resolved');
    assert.equal(isVisualDraftReadyToWrite(draft), true);
    const write = plannedWriteFromVisualDraft(draft);
    assert.equal(write.tool, 'create_order');
    assert.equal(write.args.clientId, 'cli-maria');
    assert.ok(Array.isArray(write.args.items) && (write.args.items as unknown[]).length === 2);

    const plan = buildAgentOperationPlan(
      [write],
      'pedido manuscrito',
      `wa:order-img:${draft.id}:create_order`
    );
    let createOrder = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'sí', messageId: 'confirm-order' },
        text: 'sí',
        state: emptyState({
          pendingIntent: 'confirm:v4_write',
          pendingPayload: { plan },
          operationPlan: plan as unknown as Record<string, unknown>,
          visualDraft: draft,
        }),
      },
      {
        ...noopPersist,
        createAgent: () => {
          throw new Error('LLM should not run on deterministic sí');
        },
        executePlan: async (_tenant, received) => {
          assert.equal(received.writes[0]?.tool, 'create_order');
          createOrder += 1;
          return {
            reply: 'Listo. Pedido creado.',
            data: { kind: 'order', orderId: 'ord-1', label: '00001', clientName: 'María' },
          };
        },
      }
    );
    assert.equal(createOrder, 1);
    assert.equal(result.executed, true);
  });
});
