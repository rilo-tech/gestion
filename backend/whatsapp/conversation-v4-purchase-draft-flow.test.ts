import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { handleV4WhatsappTurn } from './handle-v4-turn.ts';
import { buildCandidateSelectionState } from './v4-candidate-selection.ts';
import { WORKFLOW_CANCEL_REPLY } from './v4-workflow-manager.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import type { ToolExecutionContext } from './agent/tool-types.ts';
import {
  candidateOptionsForIssue,
  applyVisualDraftSelection,
  ensurePurchaseDraftTaxMetadata,
  computeDraftFinancialTotals,
  patchVisualDraft,
  presentVisualPurchaseItemsReview,
  presentVisualDraftIssueReply,
  resolveVisualDraftBlockingIssue,
  tryResolvePurchaseInstallmentsTurn,
  VISUAL_PAYMENT_BACK,
  type VisualDocumentDraft,
  type VisualDraftDeps,
} from './v4-visual-draft.ts';
import { medioPagoGeneratesImmediateCash } from '../utils/finance-config.ts';
import { ensureDefaultBusiness } from '../auth/business.ts';
import { db } from '../firebase.ts';

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

before(async () => {
  // Emulator vacío (y algunos entornos locales) no tienen el tenant de fixture.
  await ensureDefaultBusiness(tenant.businessId);
  const finanzasRef = db.doc(`negocios/${tenant.businessId}/config/app`);
  const snap = await finanzasRef.get();
  if (!snap.exists || !snap.data()?.finanzas) {
    await finanzasRef.set(
      {
        finanzas: {
          mediosPago: [
            { id: 'efectivo', label: 'Efectivo', activo: true, generaMovimientoCaja: true },
            { id: 'transferencia', label: 'Transferencia', activo: true, generaMovimientoCaja: true },
            { id: 'tarjeta', label: 'Tarjeta', activo: true, generaMovimientoCaja: false },
          ],
        },
        caja: {
          ambitos: [
            { id: 'negocio', label: 'Negocio', activo: true },
            { id: 'personal', label: 'Personal', activo: true },
          ],
        },
      },
      { merge: true }
    );
  }
});

function emptyState(extra?: Partial<ConversationState>): ConversationState {
  return {
    businessId: tenant.businessId,
    phone: tenant.phone,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

function resolvedPurchaseDraft(extra?: Partial<VisualDocumentDraft>): VisualDocumentDraft {
  return {
    id: 'vd_flow',
    kind: 'purchase',
    status: 'awaiting_resolution',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    sourceMessageIds: [],
    supplierId: 'sup-1',
    supplierName: 'Disershop',
    documentGrossTotal: 817.01,
    documentNetTotal: 669.68,
    documentTaxTotal: 147.33,
    priceTaxMode: 'net',
    documentTaxRate: 22,
    items: [
      {
        index: 1,
        sourceText: 'Camiseta negra L',
        description: 'Camiseta negra L',
        quantity: 3,
        unitCost: 163.11,
        matchStatus: 'resolved',
        matchedProductId: 'p1',
        matchedProductName: 'Camiseta algodón Negro L',
        selectionSource: 'user_selected',
      },
      {
        index: 2,
        sourceText: 'Jarro sublimable AA',
        description: 'Jarro sublimable AA',
        quantity: 5,
        unitCost: 36.07,
        matchStatus: 'resolved',
        matchedProductId: 'p2',
        matchedProductName: 'Taza AA Blanco',
        selectionSource: 'supplier_mapping',
      },
    ],
    ...extra,
  };
}

const paymentCtx = {
  medios: [
    {
      id: 'efectivo',
      label: 'Efectivo',
      activo: true,
      generaEgresoCaja: true,
      generaCuentasPagar: false,
    },
    {
      id: 'tarjeta_credito',
      label: 'Tarjeta de crédito',
      activo: true,
      comportamiento: 'cuotas',
      cuentaHija: true,
      generaCuotas: true,
      generaCuentasPagar: true,
      requiereCuentaHija: true,
      generaCaja: false,
    },
    {
      id: 'proveedor',
      label: 'Crédito proveedor',
      activo: true,
      comportamiento: 'proveedor',
      generaCuentasPagar: true,
      generaEgresoCaja: false,
    },
  ],
  tarjetas: [
    {
      id: 'card-brou',
      label: 'BROU Master',
      medioPagoId: 'tarjeta_credito',
      activa: true,
      diaVencimiento: 10,
    },
  ],
};

const visualDeps: VisualDraftDeps = {
  loadPurchasePaymentContext: async () => paymentCtx,
  findProduct: async (_businessId, query) => {
    const q = String(query ?? '').toLowerCase();
    if (q.includes('camiseta clásica')) {
      return {
        status: 'resolved',
        entity: { id: 'p-classic', name: 'Camiseta niño clásica Negro 10' },
        query,
      };
    }
    return { status: 'not_found', query };
  },
};

function ctx(state: ConversationState | null = null, raw = 'ninguno'): ToolExecutionContext {
  return { tenant, state, messageId: 'wa-1', rawUserMessage: raw };
}

describe('Purchase draft flow — items review before payment', () => {
  it('shows items review as first post-resolution step (not cash)', async () => {
    const draft = resolvedPurchaseDraft();
    const issue = await resolveVisualDraftBlockingIssue(draft, tenant.businessId, paymentCtx as never);
    assert.equal(issue?.issueKind, 'purchase_items_review');
    assert.equal(issue?.party, 'review');
    assert.doesNotMatch(presentVisualPurchaseItemsReview(draft), /caja/i);
    assert.match(presentVisualPurchaseItemsReview(draft), /5 Taza AA Blanco · \$/);
    assert.doesNotMatch(presentVisualPurchaseItemsReview(draft), /Cantidad:|Neto unit/);
    assert.match(presentVisualPurchaseItemsReview(draft), /Camiseta algodón Negro L/);
    assert.match(presentVisualPurchaseItemsReview(draft), /¿Continuar con el pago\?/);
    assert.doesNotMatch(presentVisualPurchaseItemsReview(draft), /Remito:/i);
    assert.match(presentVisualPurchaseItemsReview(draft), /IVA \$/);
    assert.match(presentVisualPurchaseItemsReview(draft), /\*Total \$/);
  });

  it('infers net+IVA from e-ticket total when unit costs are net', () => {
    const draft = resolvedPurchaseDraft({
      documentGrossTotal: undefined,
      documentNetTotal: undefined,
      documentTaxTotal: undefined,
      priceTaxMode: undefined,
      documentTaxRate: undefined,
      total: 4153,
      items: [
        {
          index: 1,
          sourceText: 'CAMISETA NEGRA L',
          description: 'CAMISETA NEGRA L',
          quantity: 3,
          unitCost: 163.11,
          matchStatus: 'resolved',
          matchedProductId: 'p1',
          matchedProductName: 'Camiseta algodón Negro L',
        },
        {
          index: 2,
          sourceText: 'CAMISETA AZUL MARINO L',
          description: 'CAMISETA AZUL MARINO L',
          quantity: 1,
          unitCost: 163.11,
          matchStatus: 'resolved',
          matchedProductId: 'p1b',
          matchedProductName: 'Camiseta algodón Azul marino L',
        },
        {
          index: 3,
          sourceText: 'Buzo Felpa SW azul marino M',
          description: 'Buzo Felpa SW azul marino M',
          quantity: 1,
          unitCost: 409.02,
          matchStatus: 'resolved',
          matchedProductId: 'p3',
          matchedProductName: 'Canguro felpa Azul marino M',
        },
        {
          index: 4,
          sourceText: 'Buzo Felpa SW azul marino XL',
          description: 'Buzo Felpa SW azul marino XL',
          quantity: 1,
          unitCost: 409.02,
          matchStatus: 'resolved',
          matchedProductId: 'p4',
          matchedProductName: 'Canguro felpa Azul marino XL',
        },
        {
          index: 5,
          sourceText: 'JARRO SUBLIMABLE AA',
          description: 'JARRO SUBLIMABLE AA',
          quantity: 5,
          unitCost: 36.07,
          matchStatus: 'resolved',
          matchedProductId: 'p2',
          matchedProductName: 'Taza AA Blanco',
        },
        {
          index: 6,
          sourceText: 'CAMISETA NIÑO NEGRA 10',
          description: 'CAMISETA NIÑO NEGRA 10',
          quantity: 1,
          unitCost: 122.13,
          matchStatus: 'resolved',
          matchedProductId: 'p6',
          matchedProductName: 'Camiseta algodón niño Negro 10',
        },
        {
          index: 7,
          sourceText: 'Tinta DTF Otter Pro 500ml Blanco',
          description: 'Tinta DTF Otter Pro 500ml Blanco',
          quantity: 1,
          unitCost: 1631.15,
          matchStatus: 'resolved',
          unresolvedAction: 'free_line',
          selectionSource: 'created',
        },
      ],
    });
    ensurePurchaseDraftTaxMetadata(draft, 22);
    assert.equal(draft.priceTaxMode, 'net');
    const financial = computeDraftFinancialTotals(draft);
    assert.ok(Math.abs(financial.grossTotal - 4153) < 0.1);
    assert.ok(Math.abs(financial.netTotal - 3404.1) < 0.2);
  });

  it('asks payment method before cash account (no OCR prefill)', async () => {
    const draft = resolvedPurchaseDraft({
      paymentStatus: 'Contado',
      paymentMedioId: undefined,
      itemsReviewAcknowledged: true,
    });
    const issue = await resolveVisualDraftBlockingIssue(draft, tenant.businessId, paymentCtx as never);
    assert.equal(issue?.issueKind, 'purchase_payment');
    assert.notEqual(issue?.issueKind, 'purchase_cash_account');
  });

  it('asks payment method after review continue, not before', async () => {
    const draft = resolvedPurchaseDraft();
    const continued = applyVisualDraftSelection({
      draft,
      option: { index: 1, entityId: '__visual_review_continue__', label: 'Sí, confirmar' },
      resume: { originalUserText: '1', blockedTool: 'ingest_visual_document', draftId: draft.id, party: 'review' },
    });
    assert.equal(continued.itemsReviewAcknowledged, true);
    const issue = await resolveVisualDraftBlockingIssue(continued, tenant.businessId, paymentCtx as never);
    assert.equal(issue?.issueKind, 'purchase_payment');
    assert.notEqual(issue?.issueKind, 'purchase_cash_account');
  });

  it('accepts «Si» on purchase items review (not only numbered 1)', async () => {
    const draft = resolvedPurchaseDraft();
    const awaiting = buildCandidateSelectionState({
      entityType: 'supplier',
      options: [
        { index: 1, entityId: '__visual_review_continue__', label: '✅ Sí, confirmar' },
        { index: 2, entityId: '__visual_review_change__', label: '✏️ No, cambiar ítem' },
        { index: 0, entityId: '__visual_review_cancel__', label: '❌ Cancelar compra' },
      ],
      resume: {
        originalUserText: 'foto',
        blockedTool: 'ingest_visual_document',
        draftId: draft.id,
        party: 'review',
      },
    });
    let agentCalls = 0;
    let selected = false;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'Si', messageId: 'review-si-1' },
        text: 'Si',
        state: emptyState({ ...awaiting, visualDraft: draft }),
      },
      {
        rememberOp: async () => {},
        clearState: async () => {},
        saveState: async (_b, _p, patch) =>
          ({
            businessId: tenant.businessId,
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            ...patch,
          }) as ConversationState,
        appendTurns: async () => {},
        assertAi: async () => {},
        visualDraftDeps: visualDeps,
        resumeAfterSelection: async () => {
          selected = true;
          return {
            reply: '¿Cómo pagaste?',
            statePatch: { visualDraft: { ...draft, itemsReviewAcknowledged: true } },
          };
        },
        createAgent: () => {
          agentCalls += 1;
          return {
            runTurn: async () => ({
              reply: 'No hay ninguna operación pendiente de confirmación.',
              intent: 'v4_agent',
              executed: false,
              statePatch: {},
            }),
          };
        },
      }
    );
    assert.equal(selected, true);
    assert.equal(agentCalls, 0);
    assert.equal(result.intent, 'v4_candidate_selected');
    assert.match(result.reply, /pagaste|pago|medio/i);
  });

  it('orphan «Sí» resumes purchase review if numbered menu was cleared', async () => {
    const draft = resolvedPurchaseDraft();
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'Sí', messageId: 'orphan-si-1' },
        text: 'Sí',
        state: emptyState({ visualDraft: draft, pendingIntent: null, activeTask: null }),
      },
      {
        rememberOp: async () => {},
        clearState: async () => {},
        saveState: async (_b, _p, patch) =>
          ({
            businessId: tenant.businessId,
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            visualDraft: draft,
            ...patch,
          }) as ConversationState,
        appendTurns: async () => {},
        assertAi: async () => {},
        visualDraftDeps: visualDeps,
        createAgent: () => ({
          runTurn: async () => ({
            reply: 'should not run',
            intent: 'v4_agent',
            executed: false,
            statePatch: {},
          }),
        }),
      }
    );
    assert.equal(result.intent, 'v4_purchase_review_acknowledged');
    assert.match(result.reply, /pago|pagaste|medio|tarjeta|efectivo|crédito|credito/i);
  });

  it('orphan payment pick «3» works without candidate menu in state', async () => {
    const draft = resolvedPurchaseDraft({ itemsReviewAcknowledged: true });
    let agentCalls = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '3', messageId: 'orphan-pay-3' },
        text: '3',
        state: emptyState({ visualDraft: draft, pendingIntent: null, activeTask: null }),
      },
      {
        rememberOp: async () => {},
        clearState: async () => {},
        saveState: async (_b, _p, patch) =>
          ({
            businessId: tenant.businessId,
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            visualDraft: draft,
            ...patch,
          }) as ConversationState,
        appendTurns: async () => {},
        assertAi: async () => {},
        visualDraftDeps: visualDeps,
        createAgent: () => {
          agentCalls += 1;
          return {
            runTurn: async () => ({
              reply: 'No hay un borrador de imagen activo.',
              intent: 'v4_agent',
              executed: false,
              statePatch: {},
            }),
          };
        },
      }
    );
    assert.equal(agentCalls, 0);
    assert.equal(result.intent, 'v4_purchase_payment_selected');
    assert.doesNotMatch(result.reply, /borrador de imagen activo/i);
  });

  it('non-stock item does not trigger cash before payment', async () => {
    const draft = resolvedPurchaseDraft({
      items: [
        {
          index: 1,
          sourceText: 'Tinta DTF',
          description: 'Tinta DTF Otter Pro 500ml Blanco',
          quantity: 1,
          unitCost: 1631.15,
          matchStatus: 'resolved',
          unresolvedAction: 'free_line',
          selectionSource: 'created',
        },
      ],
    });
    const issue = await resolveVisualDraftBlockingIssue(draft, tenant.businessId, paymentCtx as never);
    assert.equal(issue?.issueKind, 'purchase_items_review');
  });
});

describe('Purchase draft flow — payment before cash', () => {
  it('credit card does not ask cash account', async () => {
    const draft = resolvedPurchaseDraft({
      itemsReviewAcknowledged: true,
      documentGrossTotal: 817.01,
      documentNetTotal: 669.68,
      documentTaxTotal: 147.33,
      paymentMedioId: 'tarjeta_credito',
      paymentMedioLabel: 'Tarjeta de crédito',
      paymentTarjetaId: 'card-brou',
      paymentTarjetaLabel: 'BROU Master',
      paymentCuotas: 3,
      paymentDueDate: '2026-09-10',
    });
    const issue = await resolveVisualDraftBlockingIssue(draft, tenant.businessId, paymentCtx as never);
    assert.notEqual(issue?.issueKind, 'purchase_cash_account');
    assert.equal(issue, null);
  });

  it('cash payment may ask cash account when multiple', async () => {
    const draft = resolvedPurchaseDraft({
      itemsReviewAcknowledged: true,
      paymentMedioId: 'efectivo',
      paymentMedioLabel: 'Efectivo',
    });
    const issue = await resolveVisualDraftBlockingIssue(draft, tenant.businessId, paymentCtx as never, {
      loadPurchasePaymentContext: async () => paymentCtx,
    });
    const efectivo = paymentCtx.medios.find((m) => m.id === 'efectivo')!;
    assert.equal(medioPagoGeneratesImmediateCash(efectivo as never), true);
    assert.ok(issue == null || issue.issueKind === 'purchase_cash_account' || issue.issueKind === 'purchase_total_mismatch');
  });

  it('natural payment via patch sets card and installments', async () => {
    const draft = resolvedPurchaseDraft({ itemsReviewAcknowledged: true });
    const patched = await patchVisualDraft(
      {
        paymentMedioQuery: 'tarjeta',
        paymentTarjetaQuery: 'BROU',
        paymentCuotas: 3,
      },
      ctx(emptyState({ visualDraft: draft })),
      visualDeps
    );
    const updated = patched.draft as VisualDocumentDraft;
    assert.equal(updated.paymentMedioId, 'tarjeta_credito');
    assert.equal(updated.paymentTarjetaId, 'card-brou');
    assert.equal(updated.paymentCuotas, 3);
  });

  it('installments step accepts a number instead of a menu', async () => {
    const draft = resolvedPurchaseDraft({
      itemsReviewAcknowledged: true,
      paymentMedioId: 'tarjeta_credito',
      paymentMedioLabel: 'Tarjeta de crédito',
      paymentTarjetaId: 'card-brou',
      paymentTarjetaLabel: 'BROU Master',
    });
    const issue = await resolveVisualDraftBlockingIssue(draft, tenant.businessId, paymentCtx as never);
    assert.equal(issue?.issueKind, 'purchase_payment_installments');
    assert.match(presentVisualDraftIssueReply(draft, issue!), /Escribí un número/i);

    const resolved = await tryResolvePurchaseInstallmentsTurn({
      text: '3',
      tenant,
      state: emptyState({
        visualDraft: draft,
        activeTask: {
          intent: 'visual_draft_resolution',
          awaiting: { type: 'purchase_payment_installments', draftId: draft.id },
        },
      }),
      deps: visualDeps,
    });
    assert.ok(resolved);
    assert.match(resolved!.reply, /Confirmar compra/i);
    assert.equal(resolved!.intent, 'confirm_v4');
    assert.equal(resolved!.statePatch.pendingIntent, 'confirm:v4_write');
  });
});

describe('Purchase draft flow — payment back navigation', () => {
  it('«0» at cash account menu rewinds to payment instead of cancelling workflow', async () => {
    const draft = resolvedPurchaseDraft({
      itemsReviewAcknowledged: true,
      paymentMedioId: 'transferencia',
      paymentMedioLabel: 'Transferencia',
    });
    const issue = {
      party: 'cash_account' as const,
      entityType: 'cash_account' as const,
      issueKind: 'purchase_cash_account' as const,
      candidates: [
        { id: 'caja-rilo', name: 'Rilo' },
        { id: 'caja-personal', name: 'Personal' },
      ],
      title: '¿Desde qué caja?',
    };
    const options = candidateOptionsForIssue(issue);
    const candidatePatch = buildCandidateSelectionState({
      entityType: 'cash_account',
      options,
      resume: { draftId: draft.id, party: 'cash_account', originalUserText: '3' },
    });
    let resumeCalled = false;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '0', messageId: 'cash-back-0' },
        text: '0',
        state: emptyState({ visualDraft: draft, ...candidatePatch }),
      },
      {
        rememberOp: async () => {},
        clearState: async () => {},
        saveState: async (_b, _p, patch) =>
          ({
            businessId: tenant.businessId,
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            visualDraft: draft,
            ...patch,
          }) as ConversationState,
        appendTurns: async () => {},
        assertAi: async () => {},
        visualDraftDeps: visualDeps,
        resumeAfterSelection: async ({ option }) => {
          resumeCalled = true;
          assert.equal(option.entityId, VISUAL_PAYMENT_BACK);
          const rewound = applyVisualDraftSelection({
            draft,
            option,
            resume: { draftId: draft.id, party: 'cash_account' },
          });
          assert.equal(rewound.paymentMedioId, undefined);
          assert.equal(rewound.cashAccountId, undefined);
          return {
            reply: presentVisualDraftIssueReply(rewound, {
              party: 'payment',
              entityType: 'payment',
              issueKind: 'purchase_payment',
              candidates: paymentCtx.medios.map((m) => ({ id: m.id, name: m.label })),
              title: '¿Cómo se pagó?',
            }),
            statePatch: { visualDraft: rewound },
          };
        },
        createAgent: () => ({
          runTurn: async () => ({
            reply: 'should not run',
            intent: 'v4_agent',
            executed: false,
            statePatch: {},
          }),
        }),
      }
    );
    assert.equal(resumeCalled, true);
    assert.notEqual(result.intent, 'v4_workflow_cancelled');
    assert.doesNotMatch(result.reply, new RegExp(WORKFLOW_CANCEL_REPLY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(result.reply, /pagó|pago/i);
  });

  it('«0» at installments step rewinds instead of cancelling workflow', async () => {
    const draft = resolvedPurchaseDraft({
      itemsReviewAcknowledged: true,
      paymentMedioId: 'tarjeta_credito',
      paymentMedioLabel: 'Tarjeta de crédito',
      paymentTarjetaId: 'card-brou',
      paymentTarjetaLabel: 'BROU Master',
    });
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: '0', messageId: 'inst-back-0' },
        text: '0',
        state: emptyState({
          visualDraft: draft,
          activeTask: {
            intent: 'visual_draft_resolution',
            awaiting: { type: 'purchase_payment_installments', draftId: draft.id },
          },
        }),
      },
      {
        rememberOp: async () => {},
        clearState: async () => {},
        saveState: async (_b, _p, patch) =>
          ({
            businessId: tenant.businessId,
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            visualDraft: draft,
            ...patch,
          }) as ConversationState,
        appendTurns: async () => {},
        assertAi: async () => {},
        visualDraftDeps: visualDeps,
        createAgent: () => ({
          runTurn: async () => ({
            reply: 'should not run',
            intent: 'v4_agent',
            executed: false,
            statePatch: {},
          }),
        }),
      }
    );
    assert.notEqual(result.intent, 'v4_workflow_cancelled');
    assert.doesNotMatch(result.reply, new RegExp(WORKFLOW_CANCEL_REPLY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(result.reply, /cuotas|pagó|pago|tarjeta/i);
  });
});

describe('Purchase draft flow — candidate free text', () => {
  it('"ninguno" routes to agent instead of invalid numeric', async () => {
    const draft = resolvedPurchaseDraft({
      items: [
        {
          index: 6,
          sourceText: 'Camiseta niño negra 10',
          description: 'Camiseta niño negra 10',
          quantity: 1,
          unitCost: 122.13,
          matchStatus: 'ambiguous',
          candidates: [
            { id: 'c1', name: 'Camiseta algodón niño Negro 10' },
            { id: 'c2', name: 'Camiseta dry cool Niño Negro 10' },
          ],
        },
      ],
    });
    const awaiting = buildCandidateSelectionState({
      entityType: 'product',
      options: [
        { index: 1, entityId: 'c1', label: 'Camiseta algodón niño Negro 10' },
        { index: 2, entityId: 'c2', label: 'Camiseta dry cool Niño Negro 10' },
      ],
      resume: {
        originalUserText: 'foto',
        blockedTool: 'ingest_visual_document',
        draftId: draft.id,
        itemIndex: 6,
        party: 'item',
      },
    });
    let agentCalls = 0;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'ninguno', messageId: 'none-1' },
        text: 'ninguno',
        state: emptyState({ ...awaiting, visualDraft: draft }),
      },
      {
        rememberOp: async () => {},
        clearState: async () => {},
        saveState: async (_b, _p, patch) =>
          ({
            businessId: tenant.businessId,
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            ...patch,
          }) as ConversationState,
        appendTurns: async () => {},
        assertAi: async () => {},
        createAgent: () => {
          agentCalls += 1;
          return {
            runTurn: async () => ({
              reply: 'ok',
              intent: 'v4_agent',
              executed: false,
              statePatch: {},
            }),
          };
        },
      }
    );
    assert.equal(agentCalls, 1);
    assert.notEqual(result.intent, 'v4_candidate_invalid');
    assert.doesNotMatch(result.reply, /No hay un borrador de imagen activo/i);
  });

  it('free-text candidate rejection keeps PurchaseDraft (no auto-suspend)', async () => {
    const draft = resolvedPurchaseDraft({
      items: [
        {
          index: 1,
          sourceText: 'Camiseta dry cool',
          description: 'Camiseta dry cool',
          quantity: 1,
          unitCost: 100,
          matchStatus: 'ambiguous',
          candidates: [
            { id: 'c1', name: 'Camiseta dry cool Negro S' },
            { id: 'c2', name: 'Camiseta Dry Dama Negro S' },
            { id: 'c3', name: 'Remera Polo Algodón Negro S' },
          ],
          candidatePool: [
            { id: 'c1', name: 'Camiseta dry cool Negro S' },
            { id: 'c2', name: 'Camiseta Dry Dama Negro S' },
            { id: 'c3', name: 'Remera Polo Algodón Negro S' },
          ],
          candidateOffset: 0,
        },
      ],
    });
    const awaiting = buildCandidateSelectionState({
      entityType: 'product',
      options: [
        { index: 1, entityId: 'c1', label: 'Camiseta dry cool Negro S' },
        { index: 2, entityId: 'c2', label: 'Camiseta Dry Dama Negro S' },
        { index: 3, entityId: 'c3', label: 'Remera Polo Algodón Negro S' },
      ],
      resume: {
        originalUserText: 'foto',
        blockedTool: 'ingest_visual_document',
        draftId: draft.id,
        itemIndex: 1,
        party: 'item',
      },
    });
    let savedDraftId: string | null = null;
    const result = await handleV4WhatsappTurn(
      {
        tenant,
        phone: tenant.phone,
        message: { from: tenant.phone, text: 'No es ninguna', messageId: 'none-2' },
        text: 'No es ninguna',
        state: emptyState({ ...awaiting, visualDraft: draft }),
      },
      {
        rememberOp: async () => {},
        clearState: async () => {},
        saveState: async (_b, _p, patch) => {
          const next = {
            businessId: tenant.businessId,
            phone: tenant.phone,
            updatedAt: new Date().toISOString(),
            ...patch,
          } as ConversationState;
          if (next.visualDraft && typeof next.visualDraft === 'object') {
            savedDraftId = String((next.visualDraft as { id?: string }).id ?? '');
          }
          return next;
        },
        appendTurns: async () => {},
        assertAi: async () => {},
        createAgent: () => ({
          runTurn: async (input) => {
            const live = input.state?.visualDraft as { id?: string; items?: unknown[] } | null;
            assert.ok(live?.id, 'agent must receive active visualDraft');
            assert.equal(live.id, draft.id);
            assert.ok(Array.isArray(live.items) && live.items.length >= 1);
            return {
              reply: 'Busco otra opción',
              intent: 'v4_agent',
              executed: false,
              statePatch: { visualDraft: draft },
            };
          },
        }),
      }
    );
    assert.doesNotMatch(result.reply, /No hay un borrador de imagen activo/i);
    assert.equal(savedDraftId, draft.id);
  });

  it('create_new_product via conversationAction crea y vincula el producto', async () => {
    const draft = resolvedPurchaseDraft({
      items: [
        {
          index: 6,
          sourceText: 'Camiseta niño negra 10',
          description: 'Camiseta niño negra 10',
          quantity: 1,
          unitCost: 122.13,
          matchStatus: 'ambiguous',
          candidates: [
            { id: 'c1', name: 'Camiseta algodón niño Negro 10' },
            { id: 'c2', name: 'Camiseta dry cool Niño Negro 10' },
          ],
        },
      ],
    });
    const patched = await patchVisualDraft(
      { itemIndex: 6, conversationAction: 'create_new_product' },
      ctx(emptyState({ visualDraft: draft }), 'creá uno nuevo'),
      {
        ...visualDeps,
        createProduct: async ({ name, cost }) => ({
          id: 'created-6',
          name: String(name),
          salePrice: 0,
          cost: Number(cost) || 0,
        }),
      }
    );
    const updated = patched.draft as VisualDocumentDraft;
    const item = updated.items.find((row) => row.index === 6);
    assert.equal(item?.unresolvedAction, 'create');
    assert.equal(item?.matchStatus, 'resolved');
    assert.equal(item?.matchedProductId, 'created-6');
    assert.equal(item?.matchedProductName, 'Camiseta niño negra 10');
    assert.equal(item?.selectionSource, 'created');
  });

  it('search_other_product pide confirmación numerada (no auto-vincula)', async () => {
    const draft = resolvedPurchaseDraft({
      items: [
        {
          index: 6,
          sourceText: 'Camiseta niño negra 10',
          description: 'Camiseta niño negra 10',
          quantity: 1,
          unitCost: 122.13,
          matchStatus: 'ambiguous',
          candidates: [
            { id: 'c1', name: 'Camiseta algodón niño Negro 10' },
            { id: 'c2', name: 'Camiseta dry cool Niño Negro 10' },
          ],
        },
      ],
    });
    const patched = await patchVisualDraft(
      {
        itemIndex: 6,
        conversationAction: 'search_other_product',
        productQuery: 'Camiseta clásica',
      },
      ctx(emptyState({ visualDraft: draft }), 'buscalo como Camiseta clásica'),
      visualDeps
    );
    const updated = patched.draft as VisualDocumentDraft;
    const item = updated.items.find((row) => row.index === 6);
    assert.equal(patched.productLinkStatus, 'awaiting_selection');
    assert.equal(item?.matchStatus, 'ambiguous');
    assert.equal(item?.manualLinkPending, true);
    assert.equal(item?.matchedProductId, undefined);
    assert.equal(item?.candidates?.[0]?.id, 'p-classic');
    assert.match(String(patched.message), /¿Es|p-classic|Clásica|clásica|1\./i);
  });
});

describe('Purchase draft flow — edit before confirm', () => {
  it('editItemIndex resets supplier mapping for rematch', async () => {
    const draft = resolvedPurchaseDraft({ itemsReviewAcknowledged: false });
    const patched = await patchVisualDraft(
      { editItemIndex: 2 },
      ctx(emptyState({ visualDraft: draft })),
      visualDeps
    );
    const updated = patched.draft as VisualDocumentDraft;
    const item = updated.items.find((row) => row.index === 2);
    assert.equal(item?.matchStatus, 'not_found');
    assert.equal(item?.matchedProductId, undefined);
    assert.equal(item?.proposedSupplierMapping, undefined);
  });
});
