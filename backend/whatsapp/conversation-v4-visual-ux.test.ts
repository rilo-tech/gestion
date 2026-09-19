import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeCandidateResult } from './entity-candidate-result.ts';
import {
  ingestVisualDocument,
  patchVisualDraft,
  presentManualProductMatchMenu,
  presentVisualNotFoundItemMenu,
  presentVisualPurchaseFinalReview,
  type VisualDocumentDraft,
  type VisualDraftDeps,
} from './v4-visual-draft.ts';
import type { ConversationState } from './conversation-state.ts';
import type { ToolExecutionContext } from './agent/tool-types.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';

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
  return { tenant, state, messageId: 'wa-ux-1', rawUserMessage: raw };
}

function emptyState(extra?: Partial<ConversationState>): ConversationState {
  return { businessId: tenant.businessId, phone: tenant.phone, updatedAt: new Date().toISOString(), ...extra };
}

const mockPaymentDeps: Pick<VisualDraftDeps, 'loadPurchasePaymentContext'> = {
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
};

const visualDeps: VisualDraftDeps = {
  ...mockPaymentDeps,
  findSupplier: async (_businessId, query) => ({
    status: 'resolved',
    entity: { id: 'sup-1', name: 'Disershop' },
    query,
  }),
  findProduct: async (_businessId, query) => {
    const q = String(query ?? '').toLowerCase();
    if (q.includes('taza aa')) {
      if (q.includes('solo')) {
        return {
          status: 'resolved',
          entity: { id: 'taza-blanco', name: 'Taza AA Blanco' },
          query,
        };
      }
      return {
        status: 'ambiguous',
        query,
        candidates: [
          { id: 'taza-blanco', name: 'Taza AA Blanco' },
          { id: 'taza-premium', name: 'Taza Premium AA' },
        ],
      };
    }
    return { status: 'not_found', query };
  },
};

describe('V4 visual purchase UX', () => {
  it('unresolved menu offers create / free / discard / cancel (no Buscar numerado)', () => {
    const menu = presentVisualNotFoundItemMenu(5, {
      index: 5,
      sourceText: 'Caja de Mantenimiento Epson F170',
      description: 'Caja de Mantenimiento Epson F170',
      quantity: 1,
      unitCost: 1433.61,
      matchStatus: 'not_found',
    });
    assert.doesNotMatch(menu, /Buscar con otro nombre/);
    assert.doesNotMatch(menu, /Ver más opciones/);
    assert.doesNotMatch(menu, /No encontré un producto suficientemente parecido/);
    assert.doesNotMatch(menu, /Remito:|Neto unitario|Costo final/);
    assert.match(menu, /1\. ➕ Crear "Caja de Mantenimiento Epson F170"/);
    assert.match(menu, /2\. 🧰 Registrar como insumo sin stock/);
    assert.match(menu, /3\. 🗑️ Descartar del documento/);
    assert.match(menu, /0\. ❌ Cancelar compra/);
    assert.match(menu, /Si no es ninguno, indicame el nombre/);
  });

  it('manual product search shows numbered candidates and does not auto-link', async () => {
    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [{ description: 'Caja Epson F170', quantity: 1, unitCost: 1433.61 }],
      },
      ctx(),
      visualDeps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    const patched = await patchVisualDraft(
      { itemIndex: 1, productQuery: 'taza aa', manualProductSearch: true },
      ctx(emptyState({ visualDraft: draft })),
      visualDeps
    );
    assert.equal(patched.productLinkStatus, 'awaiting_selection');
    const updated = patched.draft as VisualDocumentDraft;
    assert.equal(updated.items[0]?.matchStatus, 'ambiguous');
    assert.match(String(patched.message), /Taza AA Blanco/);
    assert.doesNotMatch(String(patched.message), /No encontré|Encontré productos parecidos|Producto sin vincular/);
    assert.doesNotMatch(String(patched.message), /Ver más opciones/);
    assert.doesNotMatch(String(patched.message), /Buscar con otro nombre/);
  });

  it('manual search with one result still asks for numeric selection', async () => {
    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [{ description: 'Linea X', quantity: 1, unitCost: 100 }],
      },
      ctx(),
      visualDeps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    const patched = await patchVisualDraft(
      { itemIndex: 1, productQuery: 'taza aa solo', manualProductSearch: true },
      ctx(emptyState({ visualDraft: draft })),
      visualDeps
    );
    assert.equal(patched.productLinkStatus, 'awaiting_selection');
    assert.match(String(patched.message), /Taza AA Blanco/);
    assert.match(String(patched.message), /¿Es \*Taza AA Blanco\*\? Respondé \*1\* para confirmar/);
    assert.doesNotMatch(String(patched.message), /No encontré|Encontré productos parecidos|Producto sin vincular/);
    assert.doesNotMatch(String(patched.message), /Si no es ninguno, indicame el nombre/);
  });

  it('manual match single result asks ¿Es este?', () => {
    const menu = presentManualProductMatchMenu(
      1,
      [
        { id: 'a', name: 'Camiseta algodón Gris S' },
        { id: '__visual_create__', name: '➕ Crear "Camiseta gris melange S"' },
        { id: '__visual_manual_back__', name: '↩️ Volver' },
      ],
      true,
      {
        index: 1,
        sourceText: 'Camiseta gris melange S',
        description: 'Camiseta gris melange S',
        matchStatus: 'ambiguous',
      }
    );
    assert.match(menu, /1\. 👕 Camiseta algodón Gris S/);
    assert.match(menu, /¿Es \*Camiseta algodón Gris S\*\? Respondé \*1\* para confirmar/);
    assert.doesNotMatch(menu, /Si no es ninguno/);
  });

  it('manual search miss says No encontré with the typed name', async () => {
    const ingested = await ingestVisualDocument(
      {
        kind: 'purchase',
        supplierHint: 'Disershop',
        items: [{ description: 'Camiseta gris melange M', quantity: 1, unitCost: 199 }],
      },
      ctx(),
      visualDeps
    );
    const draft = ingested.draft as VisualDocumentDraft;
    const patched = await patchVisualDraft(
      { itemIndex: 1, productQuery: 'Camiseta inexistente XYZ', manualProductSearch: true },
      ctx(emptyState({ visualDraft: draft })),
      visualDeps
    );
    assert.equal(patched.productLinkStatus, 'not_found');
    assert.match(String(patched.message), /No encontré \*Camiseta inexistente XYZ\* en tu catálogo/);
    assert.match(String(patched.message), /Camiseta gris melange M/);
    assert.match(String(patched.message), /1\. ➕ Crear/);
  });

  it('automatic resolution still auto-resolves a single confident match', () => {
    const result = normalizeCandidateResult([{ id: 'a', name: 'Solo' }]);
    assert.equal(result.status, 'resolved');
  });

  it('final purchase review shows totals + payment and Confirmo', () => {
    const draft: VisualDocumentDraft = {
      id: 'vd1',
      kind: 'purchase',
      status: 'awaiting_confirmation',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sourceMessageIds: [],
      supplierName: 'Disershop',
      itemsReviewAcknowledged: true,
      paymentMedioId: 'efectivo',
      paymentMedioLabel: 'Contado',
      cashAccountId: 'rilo',
      cashAccountLabel: 'Rilo',
      documentNetTotal: 148,
      documentTaxTotal: 32.35,
      documentGrossTotal: 180.35,
      items: [
        {
          index: 1,
          sourceText: 'Taza AA Blanco',
          description: 'Taza AA Blanco',
          quantity: 5,
          unitCostNet: 36.07,
          unitCost: 36.07,
          matchStatus: 'resolved',
          matchedProductId: 'taza',
          matchedProductName: 'Taza AA Blanco',
        },
      ],
    };
    const menu = presentVisualPurchaseFinalReview(draft);
    assert.match(menu, /Compra · Disershop/);
    assert.match(menu, /Total \$/);
    assert.match(menu, /5 artículos/);
    assert.match(menu, /5 Taza AA Blanco · \$/);
    assert.match(menu, /Pago/);
    assert.match(menu, /¿Confirmo\?/);
    assert.doesNotMatch(menu, /Match|Cantidad:|Neto unit/);
  });

  it('manual match menu includes 0 Volver', () => {
    const menu = presentManualProductMatchMenu(
      1,
      [
        { id: 'a', name: 'Prod A' },
        { id: '__visual_manual_back__', name: '↩️ Volver' },
      ],
      false,
      {
        index: 1,
        sourceText: 'X',
        description: 'X',
        matchStatus: 'ambiguous',
      }
    );
    assert.match(menu, /0\. ↩️ Volver/);
    assert.match(menu, /Si no es ninguno/);
  });
});
