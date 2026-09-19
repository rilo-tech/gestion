import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aliasesFromVisualDraft,
  ingestVisualDocument,
  patchVisualDraft,
  rematchUnresolvedDraftItems,
  reconcilePurchaseDraftItems,
  type VisualDocumentDraft,
  type VisualDraftDeps,
} from './v4-visual-draft.ts';
import {
  normalizeExternalDescription,
  productAliasKey,
  mappingExternalDescription,
} from './product-aliases.ts';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import { buildAgentOperationPlan } from './agent/tools/write-tools.ts';
import type { ConversationState } from './conversation-state.ts';
import type { ToolExecutionContext } from './agent/tool-types.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';

const tenant: WhatsappTenantContext = {
  businessId: 'biz-mapping',
  phone: '+59899112233',
  platformAccess: {
    whatsappEnabled: true,
    aiEnabled: true,
    erpWebEnabled: true,
    whatsappOperationalStatus: 'active',
  } as WhatsappTenantContext['platformAccess'],
};

const SUPPLIER_A = 'sup-disershop';
const SUPPLIER_B = 'sup-other';
const PRODUCT_X = { id: 'prod-jarra', name: 'Jarra Cervecera Esmerilada 375 ml' };
const PRODUCT_Y = { id: 'prod-vaso', name: 'Vaso Térmico 500 ml' };
const EXTERNAL = 'JARRA CERV 375';

type StoredMapping = {
  supplierId: string;
  raw: string;
  productId: string;
  productName: string;
  useCount: number;
  lastConfirmedPurchaseIds: string[];
};

function mappingStore() {
  const rows = new Map<string, StoredMapping>();
  const key = (supplierId: string, raw: string) =>
    `${supplierId}::${productAliasKey(mappingExternalDescription(raw))}`;

  return {
    save(
      supplierId: string,
      raw: string,
      product: { id: string; nombre: string },
      confirmedPurchaseId?: string
    ) {
      const canonical = mappingExternalDescription(raw);
      const id = key(supplierId, canonical);
      const existing = rows.get(id);
      if (confirmedPurchaseId && existing?.lastConfirmedPurchaseIds.includes(confirmedPurchaseId)) {
        return;
      }
      rows.set(id, {
        supplierId,
        raw: canonical,
        productId: product.id,
        productName: product.nombre,
        useCount: existing?.useCount ?? 0,
        lastConfirmedPurchaseIds: confirmedPurchaseId
          ? [...new Set([...(existing?.lastConfirmedPurchaseIds ?? []), confirmedPurchaseId])]
          : existing?.lastConfirmedPurchaseIds ?? [],
      });
    },
    find(supplierId: string, raw: string) {
      const canonical = mappingExternalDescription(raw);
      const row =
        rows.get(key(supplierId, canonical)) ??
        rows.get(key(supplierId, raw));
      if (!row) return null;
      row.useCount += 1;
      return { kind: 'product' as const, productId: row.productId, productName: row.productName };
    },
    get(supplierId: string, raw: string) {
      return rows.get(key(supplierId, raw)) ?? null;
    },
    size() {
      return rows.size;
    },
  };
}

function ctx(state: ConversationState | null = null, raw = 'registrame esta compra'): ToolExecutionContext {
  return { tenant, state, messageId: 'wa-1', rawUserMessage: raw };
}

function emptyState(extra?: Partial<ConversationState>): ConversationState {
  return { businessId: tenant.businessId, phone: tenant.phone, updatedAt: new Date().toISOString(), ...extra };
}

function purchaseDeps(store: ReturnType<typeof mappingStore>): VisualDraftDeps {
  return {
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
    findSupplier: async (_businessId, query) => {
      const q = String(query ?? '').toLowerCase();
      if (q.includes('disershop')) {
        return { status: 'resolved', entity: { id: SUPPLIER_A, name: 'Disershop' }, query };
      }
      if (q.includes('otro proveedor')) {
        return { status: 'resolved', entity: { id: SUPPLIER_B, name: 'Otro Proveedor' }, query };
      }
      return { status: 'not_found', query };
    },
    findProduct: async (_businessId, query) => {
      const q = String(query ?? '').toLowerCase();
      if (q.includes('jarra cervecera')) {
        return { status: 'resolved', entity: PRODUCT_X, query };
      }
      if (q.includes('vaso termico')) {
        return { status: 'resolved', entity: PRODUCT_Y, query };
      }
      return { status: 'not_found', query };
    },
    findSupplierProductMapping: async (_businessId, supplierId, externalDescription) =>
      store.find(supplierId, externalDescription),
  };
}

import { decideCatalogMatch } from './catalog-rank.ts';

describe('catalog size filter for purchase matching', () => {
  it('returns family_variant_missing when numeric size does not match any candidate', () => {
    const decision = decideCatalogMatch(
      [
        { id: 'c0', nombre: 'Camiseta algodón niño Negro 0', score: 80 },
        { id: 'c2', nombre: 'Camiseta algodón niño Negro 2', score: 78 },
        { id: 'c4', nombre: 'Camiseta algodón niño Negro 4', score: 76 },
      ],
      { type: 'camiseta', color: 'negro', size: '10' }
    );
    assert.equal(decision.status, 'ambiguous');
    if (decision.status === 'ambiguous') {
      assert.equal(decision.kind, 'FAMILY_MATCH_VARIANT_MISSING');
      assert.equal(decision.missingVariant, '10');
    }
  });
});

describe('supplier product mapping normalization', () => {
  it('normalizes equivalent external descriptions to the same key', () => {
    const variants = ['JARRA CERV 375', 'jarra cerv. 375', 'JARRA  CERV 375'];
    const keys = variants.map((row) => productAliasKey(row));
    assert.equal(keys[0], keys[1]);
    assert.equal(keys[1], keys[2]);
    assert.equal(
      normalizeExternalDescription('JARRA CERV 375'),
      normalizeExternalDescription('jarra cerv. 375')
    );
  });

  it('strips quantity prefix before mapping key', () => {
    assert.equal(
      mappingExternalDescription('3,00 CAMISETA NEGRA L'),
      'CAMISETA NEGRA L'
    );
    assert.equal(
      productAliasKey('3,00 CAMISETA NEGRA L'),
      productAliasKey('CAMISETA NEGRA L')
    );
  });
});

describe('supplier product mapping resolution in visual purchase', () => {
  it('first purchase without mapping stays unresolved until manual link', async () => {
    const store = mappingStore();
    const deps = purchaseDeps(store);
    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [{ description: EXTERNAL, quantity: 12, unitCost: 100 }],
      },
      ctx(),
      deps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    assert.equal(draft.supplierId, SUPPLIER_A);
    assert.equal(draft.items[0]?.matchStatus, 'not_found');
    assert.equal(store.size(), 0);

    const linked = await patchVisualDraft(
      { itemIndex: 1, productQuery: 'jarra cervecera' },
      ctx(emptyState({ visualDraft: draft })),
      deps
    );
    const updated = linked.draft as VisualDocumentDraft;
    assert.equal(updated.items[0]?.matchStatus, 'resolved');
    assert.equal(updated.items[0]?.selectionSource, 'user_selected');
    assert.equal(updated.items[0]?.matchedProductId, PRODUCT_X.id);
    assert.equal(store.size(), 0);
  });

  it('second purchase auto-resolves via supplier mapping without candidate selection', async () => {
    const store = mappingStore();
    store.save(SUPPLIER_A, EXTERNAL, { id: PRODUCT_X.id, nombre: PRODUCT_X.name });
    const deps = purchaseDeps(store);

    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [{ description: EXTERNAL, quantity: 6, unitCost: 120 }],
      },
      ctx(),
      deps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    assert.equal(draft.items[0]?.matchStatus, 'resolved');
    assert.equal(draft.items[0]?.selectionSource, 'supplier_mapping');
    assert.equal(draft.items[0]?.matchedProductId, PRODUCT_X.id);
    assert.equal(draft.items[0]?.selectionSource, 'supplier_mapping');
  });

  it('normalized variant reuses the same supplier mapping', async () => {
    const store = mappingStore();
    store.save(SUPPLIER_A, EXTERNAL, { id: PRODUCT_X.id, nombre: PRODUCT_X.name });
    const deps = purchaseDeps(store);

    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [{ description: 'jarra cerv. 375', quantity: 1, unitCost: 50 }],
      },
      ctx(),
      deps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    assert.equal(draft.items[0]?.selectionSource, 'supplier_mapping');
    assert.equal(draft.items[0]?.matchedProductId, PRODUCT_X.id);
  });

  it('does not reuse mapping from another supplier', async () => {
    const store = mappingStore();
    store.save(SUPPLIER_A, EXTERNAL, { id: PRODUCT_X.id, nombre: PRODUCT_X.name });
    const deps = purchaseDeps(store);

    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Otro Proveedor',
        items: [{ description: EXTERNAL, quantity: 3, unitCost: 80 }],
      },
      ctx(),
      deps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    assert.equal(draft.supplierId, SUPPLIER_B);
    assert.equal(draft.items[0]?.matchStatus, 'not_found');
    assert.notEqual(draft.items[0]?.selectionSource, 'supplier_mapping');
  });

  it('stale mapping is ignored and resolver falls back to not_found', async () => {
    const store = mappingStore();
    const deps: VisualDraftDeps = {
      ...purchaseDeps(store),
      findSupplierProductMapping: async () => null,
    };
    store.save(SUPPLIER_A, EXTERNAL, { id: 'deleted-product', nombre: 'Fantasma' });

    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [{ description: EXTERNAL, quantity: 1, unitCost: 10 }],
      },
      ctx(),
      deps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    assert.equal(draft.items[0]?.matchStatus, 'not_found');
  });
});

describe('supplier product mapping persistence', () => {
  it('aliasesFromVisualDraft exports confirmed purchase lines (manual, mapping and auto)', () => {
    const draft: VisualDocumentDraft = {
      id: 'vd_1',
      kind: 'purchase',
      status: 'awaiting_confirmation',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      sourceMessageIds: ['wa-1'],
      supplierId: SUPPLIER_A,
      items: [
        {
          index: 1,
          sourceText: EXTERNAL,
          description: EXTERNAL,
          quantity: 1,
          matchStatus: 'resolved',
          matchedProductId: PRODUCT_X.id,
          matchedProductName: PRODUCT_X.name,
          selectionSource: 'user_selected',
        },
        {
          index: 2,
          sourceText: 'OTRO',
          description: 'OTRO',
          quantity: 1,
          matchStatus: 'resolved',
          matchedProductId: PRODUCT_Y.id,
          matchedProductName: PRODUCT_Y.name,
          selectionSource: 'supplier_mapping',
        },
        {
          index: 3,
          sourceText: 'AUTO',
          description: 'AUTO',
          quantity: 1,
          matchStatus: 'resolved',
          matchedProductId: PRODUCT_X.id,
          matchedProductName: PRODUCT_X.name,
          selectionSource: 'auto',
        },
      ],
    };
    const aliases = aliasesFromVisualDraft(draft);
    assert.equal(aliases.length, 3);
    assert.ok(aliases.some((row) => row.spoken === EXTERNAL && row.source === 'confirmed_manual_match'));
    assert.ok(aliases.some((row) => row.spoken === 'OTRO' && row.source === 'confirmed_auto_match'));
    assert.ok(aliases.some((row) => row.spoken === 'AUTO' && row.source === 'confirmed_auto_match'));
  });

  it('persists mapping even when remito text matches catalog product name', async () => {
    const catalogName = 'Camiseta algodón Negro M';
    const saved: Array<{ spoken: string; productId: string }> = [];
    const draft: VisualDocumentDraft = {
      id: 'vd_same_name',
      kind: 'purchase',
      status: 'awaiting_confirmation',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      sourceMessageIds: ['wa-1'],
      supplierId: SUPPLIER_A,
      supplierName: 'Disershop',
      items: [
        {
          index: 1,
          sourceText: catalogName,
          description: catalogName,
          quantity: 2,
          unitCost: 100,
          matchStatus: 'resolved',
          matchedProductId: 'prod-camiseta-m',
          matchedProductName: catalogName,
          selectionSource: 'user_selected',
        },
      ],
    };
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'create_purchase',
          label: 'Compra · Disershop',
          args: {
            supplierId: SUPPLIER_A,
            purchaseLines: [
              { productId: 'prod-camiseta-m', productName: catalogName, quantity: 2, unitCost: 100 },
            ],
            visualDraftId: draft.id,
          },
        },
      ],
      'sí',
      'wa:confirm-same-name'
    );

    await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'sí', messageId: 'confirm-same' },
        text: 'sí',
        state: emptyState({
          pendingIntent: 'confirm:v4_write',
          pendingPayload: { plan },
          operationPlan: plan as unknown as Record<string, unknown>,
          visualDraft: draft,
          lastPresentedConfirmation: { planId: plan.planId!, presentedAt: new Date().toISOString() },
        }),
      },
      {
        saveState: async () => undefined,
        appendTurns: async () => undefined,
        rememberOp: async () => undefined,
        createAgent: () => {
          throw new Error('LLM should not run');
        },
        executePlan: async () => ({
          reply: 'Listo.',
          data: { kind: 'purchase', compraId: 'compra-same', label: 'C-0002' },
        }),
        saveSupplierProductMapping: async (_businessId, spoken, product) => {
          saved.push({ spoken, productId: product.id });
        },
      }
    );

    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.spoken, catalogName);
    assert.equal(saved[0]?.productId, 'prod-camiseta-m');
  });

  it('persists mapping only after successful purchase execution', async () => {
    const store = mappingStore();
    const saved: Array<{ spoken: string; productId: string; purchaseId?: string }> = [];
    const draft: VisualDocumentDraft = {
      id: 'vd_confirm',
      kind: 'purchase',
      status: 'awaiting_confirmation',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      sourceMessageIds: ['wa-1'],
      supplierId: SUPPLIER_A,
      supplierName: 'Disershop',
      items: [
        {
          index: 1,
          sourceText: EXTERNAL,
          description: EXTERNAL,
          quantity: 12,
          unitCost: 100,
          matchStatus: 'resolved',
          matchedProductId: PRODUCT_X.id,
          matchedProductName: PRODUCT_X.name,
          selectionSource: 'user_selected',
        },
      ],
    };
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'create_purchase',
          label: 'Compra · Disershop',
          args: {
            supplierId: SUPPLIER_A,
            supplierName: 'Disershop',
            purchaseLines: [
              { productId: PRODUCT_X.id, productName: PRODUCT_X.name, quantity: 12, unitCost: 100 },
            ],
            visualDraftId: draft.id,
          },
        },
      ],
      'sí',
      'wa:confirm-purchase:vd_confirm:create_purchase'
    );

    await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'sí', messageId: 'confirm-1' },
        text: 'sí',
        state: emptyState({
          pendingIntent: 'confirm:v4_write',
          pendingPayload: { plan },
          operationPlan: plan as unknown as Record<string, unknown>,
          visualDraft: draft,
        }),
      },
      {
        saveState: async () => undefined,
        appendTurns: async () => undefined,
        rememberOp: async () => undefined,
        createAgent: () => {
          throw new Error('LLM should not run');
        },
        executePlan: async () => ({
          reply: 'Listo.',
          data: { kind: 'purchase', compraId: 'compra-1', label: 'C-0001' },
        }),
        saveSupplierProductMapping: async (_businessId, spoken, product, options) => {
          saved.push({
            spoken,
            productId: product.id,
            purchaseId: options.confirmedPurchaseId ?? undefined,
          });
          store.save(options.supplierId, spoken, product, options.confirmedPurchaseId ?? undefined);
        },
      }
    );

    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.productId, PRODUCT_X.id);
    assert.equal(store.size(), 1);

    await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'sí', messageId: 'confirm-dup' },
        text: 'sí',
        state: emptyState({
          pendingIntent: 'confirm:v4_write',
          pendingPayload: { plan },
          operationPlan: plan as unknown as Record<string, unknown>,
          visualDraft: draft,
        }),
      },
      {
        saveState: async () => undefined,
        appendTurns: async () => undefined,
        rememberOp: async () => undefined,
        createAgent: () => {
          throw new Error('LLM should not run');
        },
        executePlan: async () => ({
          reply: 'Listo.',
          data: { kind: 'purchase', compraId: 'compra-1', label: 'C-0001' },
        }),
        saveSupplierProductMapping: async (_businessId, spoken, product, options) => {
          saved.push({
            spoken,
            productId: product.id,
            purchaseId: options.confirmedPurchaseId ?? undefined,
          });
          store.save(options.supplierId, spoken, product, options.confirmedPurchaseId ?? undefined);
        },
      }
    );
    assert.equal(saved.length, 2);
    assert.equal(store.get(SUPPLIER_A, EXTERNAL)?.lastConfirmedPurchaseIds.length, 1);
  });

  it('correction updates mapping only after successful purchase, not while draft is open', async () => {
    const store = mappingStore();
    store.save(SUPPLIER_A, EXTERNAL, { id: PRODUCT_X.id, nombre: PRODUCT_X.name });
    const deps = purchaseDeps(store);

    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [{ description: EXTERNAL, quantity: 2, unitCost: 90 }],
      },
      ctx(),
      deps
    );
    let draft = ingested.draft as VisualDocumentDraft;
    assert.equal(draft.items[0]?.matchedProductId, PRODUCT_X.id);
    assert.equal(draft.items[0]?.selectionSource, 'supplier_mapping');

    const corrected = await patchVisualDraft(
      { itemIndex: 1, productQuery: 'vaso termico' },
      ctx(emptyState({ visualDraft: draft })),
      deps
    );
    draft = corrected.draft as VisualDocumentDraft;
    assert.equal(draft.items[0]?.matchedProductId, PRODUCT_Y.id);
    assert.equal(draft.items[0]?.selectionSource, 'user_selected');
    assert.equal(store.get(SUPPLIER_A, EXTERNAL)?.productId, PRODUCT_X.id);

    const aliases = aliasesFromVisualDraft(draft);
    assert.equal(aliases[0]?.productId, PRODUCT_Y.id);
  });
});

describe('supplier rematch after supplier selection', () => {
  it('rematches unresolved items when supplier becomes available', async () => {
    const store = mappingStore();
    store.save(SUPPLIER_A, EXTERNAL, { id: PRODUCT_X.id, nombre: PRODUCT_X.name });
    const deps = purchaseDeps(store);

    const draft: VisualDocumentDraft = {
      id: 'vd_rematch',
      kind: 'purchase',
      status: 'draft',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      sourceMessageIds: ['wa-1'],
      supplierId: SUPPLIER_A,
      supplierName: 'Disershop',
      items: [
        {
          index: 1,
          sourceText: EXTERNAL,
          description: EXTERNAL,
          quantity: 4,
          unitCost: 70,
          matchStatus: 'not_found',
        },
      ],
    };

    const rematched = await rematchUnresolvedDraftItems(tenant.businessId, draft, 'remito', deps);
    assert.equal(rematched.items[0]?.matchStatus, 'resolved');
    assert.equal(rematched.items[0]?.selectionSource, 'supplier_mapping');
    assert.equal(rematched.items[0]?.matchedProductId, PRODUCT_X.id);
  });

  it('reuses mapping when invoice line includes quantity prefix', async () => {
    const store = mappingStore();
    store.save(SUPPLIER_A, 'CAMISETA NEGRA L', {
      id: 'prod-camiseta-l',
      nombre: 'Camiseta algodón Negro L',
    });
    const deps = purchaseDeps(store);

    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [
          {
            sourceText: '3,00 CAMISETA NEGRA L',
            description: 'CAMISETA NEGRA L',
            quantity: 3,
            unitCost: 120,
          },
        ],
      },
      ctx(),
      deps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    assert.equal(draft.items.length, 1);
    assert.equal(draft.items[0]?.matchStatus, 'resolved');
    assert.equal(draft.items[0]?.selectionSource, 'supplier_mapping');
    assert.equal(draft.items[0]?.matchedProductId, 'prod-camiseta-l');
    assert.equal(draft.items[0]?.quantity, 3);
  });

  it('reuses JARRO mapping and keeps item in draft with quantity', async () => {
    const store = mappingStore();
    const JARRO = 'JARRO SUBLIMABLE AA';
    const TAZA = { id: 'prod-taza', name: 'Taza AA Blanco' };
    store.save(SUPPLIER_A, JARRO, { id: TAZA.id, nombre: TAZA.name });
    const deps = purchaseDeps(store);

    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [{ description: JARRO, quantity: 5, unitCost: 50 }],
      },
      ctx(),
      deps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    assert.equal(draft.items[0]?.matchStatus, 'resolved');
    assert.equal(draft.items[0]?.matchedProductName, TAZA.name);
    assert.equal(draft.items[0]?.quantity, 5);
    const reconcile = reconcilePurchaseDraftItems(draft);
    assert.equal(reconcile.ok, true);
    assert.equal(reconcile.extractedCount, 1);
    assert.equal(reconcile.resolvedCount, 1);
  });

  it('does not force wrong size candidates for CAMISETA NIÑO NEGRA 10', async () => {
    const store = mappingStore();
    const deps: VisualDraftDeps = {
      ...purchaseDeps(store),
      findProduct: async (_businessId, query, options) => {
        if (String(options?.attributes?.size ?? '') === '10') {
          return { status: 'not_found', query };
        }
        return { status: 'not_found', query };
      },
    };

    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [
          {
            description: 'CAMISETA NIÑO NEGRA 10',
            quantity: 1,
            unitCost: 122.13,
            size: '10',
            color: 'negro',
          },
        ],
      },
      ctx(),
      deps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    assert.equal(draft.items[0]?.matchStatus, 'not_found');
    assert.equal(draft.items[0]?.candidates?.length ?? 0, 0);
  });

  it('reconcilePurchaseDraftItems fails when an item is lost', () => {
    const draft: VisualDocumentDraft = {
      id: 'vd_loss',
      kind: 'purchase',
      status: 'draft',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      sourceMessageIds: [],
      supplierId: SUPPLIER_A,
      items: [
        {
          index: 1,
          sourceText: 'A',
          description: 'A',
          quantity: 1,
          matchStatus: 'resolved',
          matchedProductId: 'p1',
          matchedProductName: 'Product A',
          selectionSource: 'auto',
        },
        {
          index: 2,
          sourceText: 'B',
          description: 'B',
          quantity: 1,
          matchStatus: 'unresolved' as VisualDocumentDraft['items'][number]['matchStatus'],
        },
      ],
    };
    draft.items[1]!.matchStatus = 'unresolved';
    const result = reconcilePurchaseDraftItems(draft);
    assert.equal(result.ok, true);
    assert.equal(result.unresolvedCount, 1);
  });

  it('aliasesFromVisualDraft exports proposedSupplierMapping on user selection', () => {
    const draft: VisualDocumentDraft = {
      id: 'vd_prop',
      kind: 'purchase',
      status: 'awaiting_confirmation',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      sourceMessageIds: [],
      supplierId: SUPPLIER_A,
      items: [
        {
          index: 1,
          sourceText: '3,00 CAMISETA NEGRA L',
          description: 'CAMISETA NEGRA L',
          quantity: 3,
          matchStatus: 'resolved',
          matchedProductId: 'prod-camiseta-l',
          matchedProductName: 'Camiseta algodón Negro L',
          selectionSource: 'user_selected',
          proposedSupplierMapping: {
            supplierId: SUPPLIER_A,
            externalDescription: 'CAMISETA NEGRA L',
            productId: 'prod-camiseta-l',
            productName: 'Camiseta algodón Negro L',
          },
        },
      ],
    };
    const aliases = aliasesFromVisualDraft(draft);
    assert.equal(aliases.length, 1);
    assert.equal(aliases[0]?.spoken, 'CAMISETA NEGRA L');
  });
});
