import { assertCanUseAi, formatThrownUsage } from '../auth/usage-gates.ts';
import {
  appendConversationTurns,
  clearConversationState,
  getConversationState,
  rememberLastOperation,
  getConversationState,
  saveConversationState,
  type ConversationState,
  type LastWhatsappOperation,
} from './conversation-state.ts';
import { logWhatsappTurn } from './conversation-log.ts';
import type { WhatsappHandlerResult, WhatsappInboundMessage } from './message-handler.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import { AgentError, agentErrorReply } from './agent/agent-errors.ts';
import { createConversationAgent } from './agent/conversation-agent.ts';
import type { ConversationAgent } from './agent/tool-types.ts';
import { presentConfirmationPlan } from './agent/agent-presenter.ts';
import { executeAgentOperationPlan, prepareWriteToolCalls } from './agent/tool-executor.ts';
import { parseAgentOperationPlan } from './agent/tools/write-tools.ts';
import type { AgentOperationPlan } from './agent/tool-types.ts';
import {
  V4_CONFIRM_INTENT,
  isDeterministicNo,
  isDeterministicYes,
  isHardConfirmCancel,
  isSoftConfirmReject,
  mapFrozenWriteError,
  shouldAutoExecuteAmendedConfirm,
  shouldCancelFrozenPlan,
  shouldExecuteFrozenPlan,
  shouldInviteConfirmEdit,
  shouldReinterpretPendingConfirm,
} from './v4-confirm.ts';
import {
  autoCommitFocusPatch,
  presentDirectExecuteReply,
} from './v4-auto-commit.ts';
import { planAllowsAutoCommit } from './v4-write-disposition.ts';
import { verifyExecutedPlanAgainstDb } from './v4-write-verify.ts';
import {
  buildRecentOperationFromWrite,
  conversationPatchFromRecentOperation,
} from './v4-recent-operation.ts';
import {
  getCandidateSelectionAwaiting,
  isCandidateMenuZeroOptionTurn,
  isExactNumericOnly,
  parseNumericSelectionTurn,
  resolveCandidateSelectionTurn,
  focusPatchFromCandidate,
} from './v4-candidate-selection.ts';
import {
  orderSettleAmountPatch,
  orderSettleChoicePatch,
  parseOrderSettleTarget,
  planHasCollect,
  planIsStatusOnly,
  V4_ORDER_SETTLE_AMOUNT_INTENT,
  V4_ORDER_SETTLE_INTENT,
  type OrderSettleTarget,
} from './v4-order-settle.ts';
import { buildToolRegistryForTenant } from './agent/tool-registry.ts';
import { logV4ContextBefore } from './v4-conversation-context.ts';
import { formatV4InvalidCandidateSelection, V4_CONFIRM_EDIT_PROMPT } from './v4-ui-copy.ts';
import { resumeBlockedToolAfterSelection } from './v4-resume-blocked-tool.ts';
import {
  aliasesFromVisualDraft,
  liveVisualDraft,
  parseVisualDraft,
  presentVisualPurchaseItemsReview,
  purchaseDraftAwaitingItemsReview,
  tryAcknowledgeOrphanPurchaseItemsReview,
  tryResolveOrphanVisualDraftPaymentSelection,
  tryResolveVisualCatalogProductTurn,
  tryResolvePurchaseCardDueDayTurn,
  tryResolvePurchaseInstallmentsTurn,
  tryResolveVisualReviewSelection,
  reviveVisualDraft,
  shouldRouteVisualDraftFreeTextToAgent,
  isPurchasePaymentFreeformBackTurn,
  type VisualDraftDeps,
} from './v4-visual-draft.ts';
import { rememberSpokenProductTerms } from './language-memory.ts';
import { rememberConfirmedCandidateAlias } from './v4-remember-candidate-alias.ts';
import { saveSupplierProductMapping } from './product-aliases.ts';
import {
  cancelActiveWorkflow,
  getWorkflowResumeSelectionAwaiting,
  hasCancellableActiveWorkflow,
  isExactWorkflowCancel,
  planMatchesPresentedConfirmation,
  resumeWorkflow,
  resolveWorkflowResumeSelectionTurn,
  shouldAutoSuspendForAgent,
  suspendActiveWorkflow,
  syncActiveWorkflow,
  WORKFLOW_CANCEL_REPLY,
} from './v4-workflow-manager.ts';
import {
  firstSuccessTipForSection,
  tryHandleV4OnboardingTurn,
  V4_ONBOARDING_INTENT,
} from './v4-onboarding.ts';
import {
  loadWhatsAppOnboardingState,
  recordFirstSuccessfulAction,
  recordTipShown,
  shouldShowTip,
} from './v4-onboarding-state.ts';
import {
  trackBotBusinessOperationCompleted,
  trackFirstBotMessage,
} from '../analytics/analytics-event-service.ts';
import { resolveBotCapabilitiesForTenant } from './bot-capability-service.ts';
import {
  classifyCapabilitySpeech,
  formatCapabilityResolutionReply,
  resolveCapabilityFromUtterance,
} from './capability-resolution.ts';

function mergeStatePatch(
  state: ConversationState | null,
  tenant: WhatsappTenantContext,
  phone: string,
  patch: Partial<ConversationState>
): ConversationState {
  return {
    businessId: tenant.businessId,
    phone,
    updatedAt: new Date().toISOString(),
    ...(state ?? {}),
    ...patch,
  };
}

async function persistStatePatch(
  tenant: WhatsappTenantContext,
  phone: string,
  state: ConversationState | null,
  patch: Partial<ConversationState>,
  saveState: HandleV4Deps['saveState']
): Promise<ConversationState> {
  const merged = mergeStatePatch(state, tenant, phone, patch);
  await (saveState ?? saveConversationState)(tenant.businessId, phone, patch);
  return merged;
}

const AI_QUOTA_REPLY = 'Llegaste al límite de acciones de tu plan.';

export type HandleV4Deps = {
  executePlan?: typeof executeAgentOperationPlan;
  createAgent?: () => ConversationAgent;
  resumeAfterSelection?: typeof resumeBlockedToolAfterSelection;
  rememberOp?: typeof rememberLastOperation;
  clearState?: typeof clearConversationState;
  saveState?: typeof saveConversationState;
  appendTurns?: typeof appendConversationTurns;
  assertAi?: typeof assertCanUseAi;
  visualDraftDeps?: VisualDraftDeps;
  saveSupplierProductMapping?: typeof saveSupplierProductMapping;
  tryOnboarding?: typeof tryHandleV4OnboardingTurn;
  verifyPlan?: typeof verifyExecutedPlanAgainstDb;
  trackFirstBotMessage?: typeof trackFirstBotMessage;
  trackBotOperation?: typeof trackBotBusinessOperationCompleted;
  resolveCapabilities?: typeof resolveBotCapabilitiesForTenant;
};

function planFromState(state: ConversationState | null): AgentOperationPlan | null {
  if (!state) return null;
  const direct = parseAgentOperationPlan(state.operationPlan);
  if (direct) return direct;
  const pending = state.pendingPayload as { plan?: AgentOperationPlan } | null | undefined;
  return pending?.plan ? parseAgentOperationPlan(pending.plan) : null;
}

/**
 * Plan congelado recuperable aunque `pendingIntent` se haya perdido:
 * sí/no exacto + operationPlan (o pendingPayload.plan) + lastPresentedConfirmation coherente.
 */
function recoverableConfirmPlanFromState(
  state: ConversationState | null,
  text: string
): AgentOperationPlan | null {
  if (!isDeterministicYes(text) && !isDeterministicNo(text)) return null;
  if (shouldExecuteFrozenPlan(state?.pendingIntent, text)) return null;
  if (shouldCancelFrozenPlan(state?.pendingIntent, text)) return null;
  const plan = planFromState(state);
  if (!plan) return null;
  if (!planMatchesPresentedConfirmation(state, plan)) return null;
  return plan;
}

async function executeFrozenV4Plan(
  tenant: WhatsappTenantContext,
  phone: string,
  plan: AgentOperationPlan,
  deps: HandleV4Deps,
  opts?: { askSettleIfNeeded?: boolean; autoCommit?: boolean }
): Promise<WhatsappHandlerResult> {
  const executePlan = deps.executePlan ?? executeAgentOperationPlan;
  const rememberOp = deps.rememberOp ?? rememberLastOperation;
  const saveState = deps.saveState ?? saveConversationState;
  const appendTurns = deps.appendTurns ?? appendConversationTurns;
  const verifyPlan = deps.verifyPlan ?? verifyExecutedPlanAgainstDb;

  console.info(
    '[v4:plan:execute:start]',
    JSON.stringify({
      businessId: tenant.businessId,
      idempotencyKey: plan.idempotencyKey ?? null,
      autoCommit: opts?.autoCommit === true,
      writes: plan.writes.map((row) => ({
        tool: row.tool,
        orderId: row.args.orderId ?? null,
        orderNumber: row.args.orderNumber ?? null,
        status: row.args.status ?? row.args.requestedStatus ?? null,
      })),
    })
  );

  const result = await executePlan(tenant, plan);
  let data = (result.data ?? {}) as Record<string, unknown>;
  let executorReply = String(result.reply ?? '').trim();

  let verified: { reply: string; data: Record<string, unknown> };
  try {
    verified = await verifyPlan({
      tenant,
      plan,
      reply: executorReply,
      data,
    });
  } catch (error) {
    console.error('[v4:plan:execute] WRITE_NOT_VERIFIED', error);
    throw error instanceof Error ? error : new Error('WRITE_NOT_PERSISTED');
  }
  data = verified.data;
  executorReply = verified.reply;

  if (data.persisted === false) {
    throw new Error('WRITE_NOT_PERSISTED');
  }
  const renameWrite = plan.writes.find((row) => row.tool === 'rename_products');
  if (renameWrite) {
    const expected = Array.isArray(renameWrite.args.productIds)
      ? renameWrite.args.productIds.map((id) => String(id ?? '').trim()).filter(Boolean).length
      : 0;
    const got = Array.isArray(data.productIds)
      ? data.productIds.map((id) => String(id ?? '').trim()).filter(Boolean).length
      : Number(data.count) || 0;
    if (expected > 0 && got < expected) {
      throw new Error('WRITE_NOT_PERSISTED: rename incompleto');
    }
  }
  let recent = buildRecentOperationFromWrite(plan, data);
  // Salvaguarda: si el executor no devolvió IDs pero el plan sí los tiene, igual persistimos contexto.
  if (!recent) {
    for (const write of plan.writes) {
      const salvage = buildRecentOperationFromWrite(
        { ...plan, writes: [write] },
        {
          ...data,
          productIds: data.productIds ?? write.args.productIds,
          recordIds: data.recordIds ?? write.args.recordIds,
          labels: data.labels,
          kind: data.kind,
          count: data.count ?? (Array.isArray(write.args.productIds) ? write.args.productIds.length : undefined),
        }
      );
      if (salvage) {
        recent = salvage;
        break;
      }
    }
  }
  if (!recent) {
    console.warn(
      '[v4:recentOperation:missing]',
      JSON.stringify({
        businessId: tenant.businessId,
        tools: plan.writes.map((row) => row.tool),
        dataKeys: Object.keys(data),
      })
    );
  } else {
    console.info(
      '[v4:recentOperation:built]',
      JSON.stringify({
        businessId: tenant.businessId,
        entityKind: recent.entityKind,
        action: recent.action,
        count: recent.recordIds.length,
        tool: recent.tool ?? null,
      })
    );
  }
  const productIds = Array.isArray(data.productIds)
    ? data.productIds.map((id) => String(id ?? '').trim()).filter(Boolean)
    : [];
  const operation: LastWhatsappOperation = {
    kind:
      data.kind === 'cash'
        ? 'cash'
        : data.kind === 'payment'
          ? 'payment'
          : data.kind === 'client'
            ? 'client'
            : data.kind === 'sale'
              ? 'sale'
              : data.kind === 'purchase'
                ? 'purchase'
                : 'order',
    id: String(
      data.orderId ||
        data.clientId ||
        data.productId ||
        productIds[0] ||
        data.ventaId ||
        data.compraId ||
        data.collaboratorId ||
        data.supplierId ||
        data.movementId ||
        ''
    ),
    label: data.label ? String(data.label) : undefined,
    clientName: data.clientName ? String(data.clientName) : undefined,
    clientId: data.clientId ? String(data.clientId) : undefined,
    status: data.status ? String(data.status) : undefined,
    amount: data.amount != null ? Number(data.amount) : undefined,
    productId: data.productId ? String(data.productId) : productIds[0] || undefined,
    productName: data.productName ? String(data.productName) : undefined,
    at: new Date().toISOString(),
  };

  let reply = opts?.autoCommit ? presentDirectExecuteReply(executorReply, plan) : executorReply;
  let settlePatch: Partial<ConversationState> | null = null;
  const saldoRemaining = Number(data.saldoRemaining);
  if (
    opts?.askSettleIfNeeded !== false &&
    !opts?.autoCommit &&
    planIsStatusOnly(plan) &&
    !planHasCollect(plan) &&
    Number.isFinite(saldoRemaining) &&
    saldoRemaining > 0.009 &&
    data.orderId
  ) {
    const target: OrderSettleTarget = {
      orderId: String(data.orderId),
      label: String(data.label ?? plan.writes[0]?.args.orderNumber ?? ''),
      clientName: data.clientName ? String(data.clientName) : undefined,
      clientId: data.clientId ? String(data.clientId) : undefined,
      saldo: saldoRemaining,
    };
    settlePatch = orderSettleChoicePatch(target);
    reply = `${executorReply}\n\n${settlePatch.pendingPrompt}`;
  }

  try {
    const prev = await getConversationState(tenant.businessId, phone);
    const botTurn = {
      role: 'bot' as const,
      text: String(reply ?? '').trim().slice(0, 480),
      at: new Date().toISOString(),
    };
    const nextTurns = botTurn.text
      ? [...(prev?.turns ?? []), botTurn].slice(-10)
      : prev?.turns;

    if (recent) {
      const recentPatch = conversationPatchFromRecentOperation(recent, prev);
      const focusFromAuto = opts?.autoCommit
        ? autoCommitFocusPatch(plan, data, recentPatch.focusEntities ?? prev?.focusEntities)
        : recentPatch.focusEntities;
      const fullPatch: Partial<ConversationState> = {
        ...recentPatch,
        focusEntities: focusFromAuto ?? recentPatch.focusEntities,
        ...(nextTurns ? { turns: nextTurns } : {}),
        // Preserve order focus on payment/cash when recent patch didn't set an order.
        ...(operation.kind === 'payment' || operation.kind === 'cash'
          ? {
              focusOrder: prev?.focusOrder ?? null,
              focusEntities: {
                ...(prev?.focusEntities ?? {}),
                ...(focusFromAuto ?? recentPatch.focusEntities ?? {}),
                order: prev?.focusEntities?.order,
              },
            }
          : {}),
      };
      try {
        await saveState(tenant.businessId, phone, fullPatch);
      } catch (saveError) {
        console.error('[v4:recentOperation:save-failed-retry-minimal]', saveError);
        // Mínimo viable: no perder IDs aunque falle el patch completo (foco/listContext).
        await saveState(tenant.businessId, phone, {
          recentOperation: recent,
          lastQueryResultIds: recent.recordIds,
          pendingIntent: null,
          pendingPayload: null,
          pendingPrompt: null,
          activeTask: null,
          operationPlan: null,
          lastPresentedConfirmation: null,
          ...(nextTurns ? { turns: nextTurns } : {}),
        });
      }
      console.info(
        '[v4:recentOperation:saved]',
        JSON.stringify({
          businessId: tenant.businessId,
          entityKind: recent.entityKind,
          count: recent.recordIds.length,
        })
      );
    } else if (opts?.autoCommit) {
      await saveState(tenant.businessId, phone, {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
        operationPlan: null,
        lastPresentedConfirmation: null,
        focusEntities: autoCommitFocusPatch(plan, data, prev?.focusEntities),
        // Conservar IDs previos si el write no armó recent (no borrar contexto usable).
        lastQueryResultIds: prev?.lastQueryResultIds ?? null,
        recentOperation: prev?.recentOperation ?? null,
        ...(nextTurns ? { turns: nextTurns } : {}),
      });
    } else if (operation.id) {
      await rememberOp(tenant.businessId, phone, operation);
      if (nextTurns) {
        await saveState(tenant.businessId, phone, { turns: nextTurns });
      }
    } else {
      await saveState(tenant.businessId, phone, {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
        operationPlan: null,
        lastPresentedConfirmation: null,
        recentOperation: prev?.recentOperation ?? null,
        lastQueryResultIds: prev?.lastQueryResultIds ?? null,
        ...(nextTurns ? { turns: nextTurns } : {}),
      });
    }
    if (settlePatch) {
      await saveState(tenant.businessId, phone, settlePatch);
    }
  } catch (error) {
    console.error('[v4:plan:execute] WRITE_EXECUTED_BUT_RESPONSE_FAILED', error);
    try {
      const trackOp = deps.trackBotOperation ?? trackBotBusinessOperationCompleted;
      await trackOp({
        businessId: tenant.businessId,
        tools: plan.writes.map((row) => row.tool),
        source: 'whatsapp_v4_execute',
      });
    } catch (analyticsError) {
      console.warn('[analytics:bot_operation]', analyticsError);
    }
    return {
      reply,
      intent: 'v4_execute_persist_failed',
      executed: true,
      businessId: tenant.businessId,
    };
  }
  try {
    const trackOp = deps.trackBotOperation ?? trackBotBusinessOperationCompleted;
    await trackOp({
      businessId: tenant.businessId,
      tools: plan.writes.map((row) => row.tool),
      source: opts?.autoCommit ? 'whatsapp_v4_auto_commit' : 'whatsapp_v4_execute',
    });
  } catch (analyticsError) {
    console.warn('[analytics:bot_operation]', analyticsError);
  }
  return {
    reply,
    intent: settlePatch ? 'v4_execute_ask_settle' : opts?.autoCommit ? 'v4_auto_commit' : 'v4_execute',
    executed: true,
    businessId: tenant.businessId,
  };
}

async function executeSettleCollectFull(
  tenant: WhatsappTenantContext,
  phone: string,
  target: OrderSettleTarget,
  deps: HandleV4Deps
): Promise<WhatsappHandlerResult> {
  const registry = await buildToolRegistryForTenant(tenant);
  const plan = await prepareWriteToolCalls(
    [
      {
        id: 'settle:collect_full',
        name: 'collect_order_full_balance',
        arguments: {
          orderId: target.orderId,
          orderNumber: target.label,
          clientName: target.clientName,
        },
      },
    ],
    {
      tenant,
      state: null,
      messageId: undefined,
      rawUserMessage: 'saldar todo',
    },
    registry
  );
  return executeFrozenV4Plan(tenant, phone, plan, deps, { askSettleIfNeeded: false });
}

async function executeSettlePartialAmount(
  tenant: WhatsappTenantContext,
  phone: string,
  target: OrderSettleTarget,
  amount: number,
  deps: HandleV4Deps
): Promise<WhatsappHandlerResult> {
  const registry = await buildToolRegistryForTenant(tenant);
  const plan = await prepareWriteToolCalls(
    [
      {
        id: 'settle:partial',
        name: 'register_order_payment',
        arguments: {
          orderId: target.orderId,
          orderNumber: target.label,
          clientName: target.clientName,
          amount,
        },
      },
    ],
    {
      tenant,
      state: null,
      messageId: undefined,
      rawUserMessage: `cobrar ${amount}`,
    },
    registry
  );
  return executeFrozenV4Plan(tenant, phone, plan, deps, { askSettleIfNeeded: false });
}

export async function handleV4WhatsappTurn(
  input: {
    tenant: WhatsappTenantContext;
    phone: string;
    message: WhatsappInboundMessage;
    text: string;
    state: ConversationState | null;
    image?: { buffer: Buffer; contentType: string } | null;
  },
  deps: HandleV4Deps = {}
): Promise<WhatsappHandlerResult> {
  const { tenant, phone, message, text, image } = input;
  const clearState = deps.clearState ?? clearConversationState;
  const appendTurns = deps.appendTurns ?? appendConversationTurns;
  const saveState = deps.saveState ?? saveConversationState;
  let state = input.state ?? (await getConversationState(tenant.businessId, phone));
  const pendingPlan = planFromState(state);
  logV4ContextBefore(state, pendingPlan);

  if ((text && text.trim()) || image) {
    const trackFirst = deps.trackFirstBotMessage ?? trackFirstBotMessage;
    void trackFirst({
      businessId: tenant.businessId,
      source: 'whatsapp_v4',
    }).catch((error) => console.warn('[analytics:first_bot_message]', error));
  }

  const workflowSync = syncActiveWorkflow(state);
  if (Object.keys(workflowSync).length) {
    state = await persistStatePatch(tenant, phone, state, workflowSync, saveState);
  }

  const recoverableConfirmPlan = recoverableConfirmPlanFromState(state, text);

  if (shouldCancelFrozenPlan(state?.pendingIntent, text) || (recoverableConfirmPlan && isHardConfirmCancel(text))) {
    const draft = parseVisualDraft(state?.visualDraft);
    const patch: Partial<ConversationState> = {
      pendingIntent: null,
      pendingPayload: null,
      pendingPrompt: null,
      operationPlan: null,
      activeTask: null,
      lastPresentedConfirmation: null,
    };
    if (draft && draft.status === 'awaiting_confirmation') {
      patch.visualDraft = { ...draft, status: 'awaiting_resolution' };
    }
    await saveState(tenant.businessId, phone, patch);
    const reply = 'Listo, cancelado.';
    await appendTurns(tenant.businessId, phone, [
      { role: 'user', text },
      { role: 'bot', text: reply },
    ]);
    return { reply, intent: 'v4_cancel', executed: false, businessId: tenant.businessId };
  }

  if (
    shouldInviteConfirmEdit(state?.pendingIntent, text) ||
    (recoverableConfirmPlan && isSoftConfirmReject(text))
  ) {
    const plan = recoverableConfirmPlan ?? planFromState(state);
    const patch: Partial<ConversationState> = {
      pendingIntent: V4_CONFIRM_INTENT,
      pendingPrompt: V4_CONFIRM_EDIT_PROMPT,
      ...(plan ? { operationPlan: plan, pendingPayload: { plan } } : {}),
    };
    await saveState(tenant.businessId, phone, patch);
    const reply = V4_CONFIRM_EDIT_PROMPT;
    await appendTurns(tenant.businessId, phone, [
      { role: 'user', text },
      { role: 'bot', text: reply },
    ]);
    return { reply, intent: 'v4_confirm_edit', executed: false, businessId: tenant.businessId };
  }

  // Confirmación antes de onboarding / menús: si el plan congelado sigue en estado,
  // "sí" lo ejecuta aunque pendingIntent se haya perdido.
  if (shouldExecuteFrozenPlan(state?.pendingIntent, text) || (recoverableConfirmPlan && isDeterministicYes(text))) {
    const plan = recoverableConfirmPlan ?? planFromState(state);
    if (plan && planMatchesPresentedConfirmation(state, plan)) {
      console.info(
        '[v4:confirmation] accepted',
        JSON.stringify({
          businessId: tenant.businessId,
          pendingIntent: state?.pendingIntent ?? null,
          recovered: Boolean(recoverableConfirmPlan),
          hasPlan: Boolean(plan),
          planId: plan.planId ?? null,
          writes: plan.writes.map((row) => row.tool),
        })
      );
      try {
        await appendTurns(tenant.businessId, phone, [{ role: 'user', text }]);
        const executed = await executeFrozenV4Plan(tenant, phone, plan, deps);
        const draft = parseVisualDraft(state?.visualDraft);
        if (executed.executed && draft) {
          try {
            const persistMapping = deps.saveSupplierProductMapping ?? saveSupplierProductMapping;
            const confirmedPurchaseId =
              String(plan.idempotencyKey ?? plan.planId ?? draft.id ?? '').trim() || undefined;
            for (const alias of aliasesFromVisualDraft(draft)) {
              try {
                await rememberSpokenProductTerms({
                  businessId: tenant.businessId,
                  phone,
                  spoken: alias.spoken,
                  resolvedName: alias.resolvedName,
                  productId: alias.productId,
                });
              } catch (error) {
                console.warn('[v4:visual-draft] spoken-term memory failed', error);
              }
              if (alias.productId && draft.supplierId) {
                await persistMapping(
                  tenant.businessId,
                  alias.spoken,
                  { id: alias.productId, nombre: alias.resolvedName },
                  {
                    supplierId: draft.supplierId,
                    source: alias.source ?? 'confirmed_manual_match',
                    confirmedPurchaseId,
                    updatedBy: phone,
                  }
                );
              }
            }
          } catch (error) {
            console.warn('[v4:visual-draft] alias persist failed', error);
          }
          await saveState(tenant.businessId, phone, {
            visualDraft: { ...draft, status: 'executed' },
          });
        }
        return executed;
      } catch (error) {
        const mapped = mapFrozenWriteError(error);
        if (error instanceof AgentError) {
          mapped.code = error.code;
          mapped.reply = agentErrorReply(error);
        }
        console.error('[v4:plan:execute:error]', mapped.code, error);
        const reply = mapped.reply;
        await appendTurns(tenant.businessId, phone, [{ role: 'bot', text: reply }]);
        logWhatsappTurn({
          rawMessage: text,
          engine: 'v4',
          intent: 'v4_execute_error',
          executed: false,
          whyFallbackWasUsed: mapped.code,
        });
        return {
          reply,
          intent: 'v4_execute_error',
          executed: false,
          businessId: tenant.businessId,
        };
      }
    }
  }

  if (state?.pendingIntent === V4_ORDER_SETTLE_INTENT) {
    const target = parseOrderSettleTarget(state);
    const selection = parseNumericSelectionTurn(text);
    if (!target) {
      await saveState(tenant.businessId, phone, {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
      });
    } else if (selection.index === 1) {
      await appendTurns(tenant.businessId, phone, [{ role: 'user', text }]);
      return executeSettleCollectFull(tenant, phone, target, deps);
    } else if (selection.index === 2) {
      const amountPatch = orderSettleAmountPatch(target);
      state = await saveState(tenant.businessId, phone, amountPatch);
      await appendTurns(tenant.businessId, phone, [
        { role: 'user', text },
        { role: 'bot', text: String(amountPatch.pendingPrompt ?? '') },
      ]);
      return {
        reply: String(amountPatch.pendingPrompt ?? ''),
        intent: 'v4_order_settle_amount',
        executed: false,
        businessId: tenant.businessId,
      };
    } else if (selection.index === 3 || shouldCancelFrozenPlan(V4_CONFIRM_INTENT, text)) {
      const reply = `Ok, el pedido #${target.label} queda con saldo de $${target.saldo.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}.`;
      await saveState(tenant.businessId, phone, {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
      });
      await appendTurns(tenant.businessId, phone, [
        { role: 'user', text },
        { role: 'bot', text: reply },
      ]);
      return { reply, intent: 'v4_order_settle_leave', executed: false, businessId: tenant.businessId };
    } else if (selection.index != null) {
      const reply = 'Elegí 1 (saldar todo), 2 (cobrar un monto) o 3 (dejar con saldo).';
      await appendTurns(tenant.businessId, phone, [
        { role: 'user', text },
        { role: 'bot', text: reply },
      ]);
      return { reply, intent: 'v4_order_settle_invalid', executed: false, businessId: tenant.businessId };
    }
    // Free text while settle pending → agent below with settle context still in state.
  }

  if (state?.pendingIntent === V4_ORDER_SETTLE_AMOUNT_INTENT) {
    const target = parseOrderSettleTarget(state);
    const amountMatch = text.replace(',', '.').match(/(\d+(?:\.\d+)?)/);
    const amount = amountMatch ? Number(amountMatch[1]) : NaN;
    if (!target) {
      await saveState(tenant.businessId, phone, {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
      });
    } else if (Number.isFinite(amount) && amount > 0) {
      await appendTurns(tenant.businessId, phone, [{ role: 'user', text }]);
      return executeSettlePartialAmount(tenant, phone, target, amount, deps);
    } else if (shouldCancelFrozenPlan(V4_CONFIRM_INTENT, text) || parseNumericSelectionTurn(text).index === 0) {
      const choicePatch = orderSettleChoicePatch(target);
      state = await saveState(tenant.businessId, phone, choicePatch);
      await appendTurns(tenant.businessId, phone, [
        { role: 'user', text },
        { role: 'bot', text: String(choicePatch.pendingPrompt ?? '') },
      ]);
      return {
        reply: String(choicePatch.pendingPrompt ?? ''),
        intent: 'v4_order_settle_choice',
        executed: false,
        businessId: tenant.businessId,
      };
    } else {
      const reply = `Decime el monto a cobrar (saldo $${target.saldo.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}).`;
      await appendTurns(tenant.businessId, phone, [
        { role: 'user', text },
        { role: 'bot', text: reply },
      ]);
      return { reply, intent: 'v4_order_settle_amount_invalid', executed: false, businessId: tenant.businessId };
    }
  }

  const capabilitySpeech = classifyCapabilitySpeech(text);
  if (
    capabilitySpeech === 'capability_question' ||
    capabilitySpeech === 'how_to' ||
    capabilitySpeech === 'capability_overview' ||
    capabilitySpeech === 'capability_limits'
  ) {
    const resolveCaps = deps.resolveCapabilities ?? resolveBotCapabilitiesForTenant;
    const snapshot = await resolveCaps(tenant);
    const resolution = resolveCapabilityFromUtterance(text, snapshot);
    const reply = formatCapabilityResolutionReply(resolution);
    await appendTurns(tenant.businessId, phone, [
      { role: 'user', text },
      { role: 'bot', text: reply },
    ]);
    logWhatsappTurn({
      rawMessage: text,
      engine: 'v4',
      intent: 'v4_capability_resolution',
      executed: false,
      whyFallbackWasUsed: `capability:${resolution.capability}:${resolution.status}`,
    });
    return {
      reply,
      intent: 'v4_capability_resolution',
      executed: false,
      businessId: tenant.businessId,
    };
  }

  const workflowResumeAwaiting = getWorkflowResumeSelectionAwaiting(state);
  if (workflowResumeAwaiting) {
    const resolution = resolveWorkflowResumeSelectionTurn(text, workflowResumeAwaiting);
    if (resolution.kind === 'invalid') {
      const reply = formatV4InvalidCandidateSelection(resolution.max);
      await appendTurns(tenant.businessId, phone, [{ role: 'user', text }, { role: 'bot', text: reply }]);
      return { reply, intent: 'v4_workflow_resume_invalid', executed: false, businessId: tenant.businessId };
    }
    if (resolution.kind === 'selected') {
      const resumed = resumeWorkflow(state, resolution.workflowId);
      state = await saveState(tenant.businessId, phone, {
        ...resumed.patch,
        pendingIntent: null,
        pendingPayload: null,
      });
      await appendTurns(tenant.businessId, phone, [{ role: 'user', text }, { role: 'bot', text: resumed.reply }]);
      return { reply: resumed.reply, intent: resumed.intent, executed: false, businessId: tenant.businessId };
    }
  }

  const draftActive = Boolean(parseVisualDraft(state?.visualDraft));
  const otherActiveTask =
    Boolean(state?.activeTask?.intent) && state?.activeTask?.intent !== V4_ONBOARDING_INTENT;
  const onboardingBlocked =
    Boolean(getCandidateSelectionAwaiting(state)) ||
    state?.pendingIntent === V4_CONFIRM_INTENT ||
    Boolean(recoverableConfirmPlan) ||
    Boolean(pendingPlan && shouldExecuteFrozenPlan(state?.pendingIntent, text)) ||
    draftActive ||
    otherActiveTask;
  if (!onboardingBlocked) {
    const onboarding = await (deps.tryOnboarding ?? tryHandleV4OnboardingTurn)({
      tenant,
      text,
      state,
    });
    if (onboarding.kind === 'handled') {
      state = await persistStatePatch(tenant, phone, state, onboarding.statePatch, saveState);
      await appendTurns(tenant.businessId, phone, [
        { role: 'user', text },
        { role: 'bot', text: onboarding.reply },
      ]);
      logWhatsappTurn({
        rawMessage: text,
        engine: 'v4',
        intent: onboarding.intent,
        executed: false,
        whyFallbackWasUsed: 'v4_onboarding',
      });
      return {
        reply: onboarding.reply,
        intent: onboarding.intent,
        executed: false,
        businessId: tenant.businessId,
      };
    }
    if (onboarding.kind === 'escape') {
      state = await persistStatePatch(tenant, phone, state, onboarding.statePatch ?? {}, saveState);
    }
  }

  const candidateAwaiting = getCandidateSelectionAwaiting(state);
  let skipAutoSuspendForVisualFreeText = false;
  const deferWorkflowCancelForMenuBack =
    isCandidateMenuZeroOptionTurn(text, candidateAwaiting) ||
    isPurchasePaymentFreeformBackTurn(text, state);

  if (
    isExactWorkflowCancel(text) &&
    hasCancellableActiveWorkflow(state) &&
    !deferWorkflowCancelForMenuBack
  ) {
    const cancelPatch = cancelActiveWorkflow(state);
    state = await persistStatePatch(tenant, phone, state, cancelPatch, saveState);
    await appendTurns(tenant.businessId, phone, [
      { role: 'user', text },
      { role: 'bot', text: WORKFLOW_CANCEL_REPLY },
    ]);
    return {
      reply: WORKFLOW_CANCEL_REPLY,
      intent: 'v4_workflow_cancelled',
      executed: false,
      businessId: tenant.businessId,
    };
  }

  if (candidateAwaiting) {
    let resolution = resolveCandidateSelectionTurn(text, candidateAwaiting);
    if (resolution.kind === 'not_applicable') {
      const reviewPick = tryResolveVisualReviewSelection(text, candidateAwaiting);
      if (reviewPick) resolution = reviewPick;
    }
    const routeVisualFreeText =
      (resolution.kind === 'invalid' || resolution.kind === 'not_applicable') &&
      shouldRouteVisualDraftFreeTextToAgent(candidateAwaiting, state);
    if (routeVisualFreeText) {
      // Misma compra por imagen: free text (ninguno / otro nombre / «es ese») NO suspende ni borra el draft.
      skipAutoSuspendForVisualFreeText = true;
      // Antes del Agent: resolver deixis / mostrar opciones con el texto extraído del ítem.
      const visualMatch = await tryResolveVisualCatalogProductTurn({
        text,
        state,
        candidateAwaiting,
        tenant,
        deps: deps.visualDraftDeps,
      });
      if (visualMatch) {
        state = await persistStatePatch(tenant, phone, state, visualMatch.statePatch, saveState);
        await appendTurns(tenant.businessId, phone, [
          { role: 'user', text },
          { role: 'bot', text: visualMatch.reply },
        ]);
        return {
          reply: visualMatch.reply,
          intent: visualMatch.intent,
          executed: false,
          businessId: tenant.businessId,
        };
      }
    }

    if (resolution.kind === 'not_applicable' && !routeVisualFreeText) {
      const visualMatch = await tryResolveVisualCatalogProductTurn({
        text,
        state,
        candidateAwaiting,
        tenant,
        deps: deps.visualDraftDeps,
      });
      if (visualMatch) {
        state = await persistStatePatch(tenant, phone, state, visualMatch.statePatch, saveState);
        await appendTurns(tenant.businessId, phone, [
          { role: 'user', text },
          { role: 'bot', text: visualMatch.reply },
        ]);
        return {
          reply: visualMatch.reply,
          intent: visualMatch.intent,
          executed: false,
          businessId: tenant.businessId,
        };
      }
    }

    if (!routeVisualFreeText) {
      if (resolution.kind === 'invalid') {
        const reply = formatV4InvalidCandidateSelection(resolution.max);
        await appendTurns(tenant.businessId, phone, [
          { role: 'user', text },
          { role: 'bot', text: reply },
        ]);
        return {
          reply,
          intent: 'v4_candidate_invalid',
          executed: false,
          businessId: tenant.businessId,
        };
      }
      if (resolution.kind === 'selected') {
        void rememberConfirmedCandidateAlias({
          businessId: tenant.businessId,
          phone,
          awaiting: candidateAwaiting,
          option: resolution.option,
        });
        if (resolution.remainder) {
          await appendTurns(tenant.businessId, phone, [{ role: 'user', text }]);
          const focusPatch = {
            focusEntities: focusPatchFromCandidate(
              candidateAwaiting.entityType,
              resolution.option,
              state?.focusEntities
            ),
          };
          state = await saveState(tenant.businessId, phone, {
            ...focusPatch,
            pendingIntent: null,
            pendingPayload: null,
            pendingPrompt: null,
            activeTask: null,
          });
          const agent = (deps.createAgent ?? createConversationAgent)();
          const result = await agent.runTurn({
            tenant,
            state,
            text: resolution.remainder,
            messageId: message.messageId,
            transcript: resolution.remainder,
            image,
          });
          const patch = {
            ...(result.statePatch ?? {}),
            operationPlan: result.operationPlan
              ? (result.operationPlan as unknown as Record<string, unknown>)
              : result.statePatch?.operationPlan,
          };
          if (Object.keys(patch).length) {
            state = await saveState(tenant.businessId, phone, patch);
          }
          await appendTurns(tenant.businessId, phone, [{ role: 'bot', text: result.reply }]);
          return {
            reply: result.reply,
            intent: result.intent,
            executed: result.executed,
            businessId: tenant.businessId,
          };
        }

        const resumed = await (deps.resumeAfterSelection ?? resumeBlockedToolAfterSelection)({
          tenant,
          state,
          awaiting: candidateAwaiting,
          option: resolution.option,
          visualDraftDeps: deps.visualDraftDeps,
        });
        const resumedPlan = parseAgentOperationPlan(
          resumed.statePatch.operationPlan ?? (resumed.statePatch.pendingPayload as { plan?: unknown } | null)?.plan
        );
        if (resumedPlan && planAllowsAutoCommit(resumedPlan) && resumed.statePatch.pendingIntent === V4_CONFIRM_INTENT) {
          console.info('[v4:auto-commit] after candidate selection', {
            planId: resumedPlan.planId ?? null,
            writes: resumedPlan.writes.map((row) => row.tool),
          });
          await appendTurns(tenant.businessId, phone, [{ role: 'user', text }]);
          return executeFrozenV4Plan(tenant, phone, resumedPlan, deps, {
            askSettleIfNeeded: false,
            autoCommit: true,
          });
        }
        state = await persistStatePatch(tenant, phone, state, resumed.statePatch, saveState);
        await appendTurns(tenant.businessId, phone, [
          { role: 'user', text },
          { role: 'bot', text: resumed.reply },
        ]);
        return {
          reply: resumed.reply,
          intent: 'v4_candidate_selected',
          executed: false,
          businessId: tenant.businessId,
        };
      }
      if (
        resolution.kind === 'not_applicable' &&
        candidateAwaiting.resume.party === 'review'
      ) {
        const draft = liveVisualDraft(state);
        if (draft && purchaseDraftAwaitingItemsReview(draft)) {
          const reply = presentVisualPurchaseItemsReview(draft);
          await appendTurns(tenant.businessId, phone, [
            { role: 'user', text },
            { role: 'bot', text: reply },
          ]);
          return {
            reply,
            intent: 'v4_purchase_review_reprompt',
            executed: false,
            businessId: tenant.businessId,
          };
        }
      }
    }
  }

  const orphanReview =
    shouldExecuteFrozenPlan(state?.pendingIntent, text) ||
    shouldCancelFrozenPlan(state?.pendingIntent, text) ||
    Boolean(recoverableConfirmPlan)
      ? null
      : await tryAcknowledgeOrphanPurchaseItemsReview({
          text,
          state,
          tenant,
          deps: deps.visualDraftDeps,
        });
  if (orphanReview) {
    state = await persistStatePatch(tenant, phone, state, orphanReview.statePatch, saveState);
    await appendTurns(tenant.businessId, phone, [
      { role: 'user', text },
      { role: 'bot', text: orphanReview.reply },
    ]);
    return {
      reply: orphanReview.reply,
      intent: orphanReview.intent,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  const orphanPayment = await tryResolveOrphanVisualDraftPaymentSelection({
    text,
    state,
    tenant,
    deps: deps.visualDraftDeps,
  });
  if (orphanPayment) {
    state = await persistStatePatch(tenant, phone, state, orphanPayment.statePatch, saveState);
    await appendTurns(tenant.businessId, phone, [
      { role: 'user', text },
      { role: 'bot', text: orphanPayment.reply },
    ]);
    return {
      reply: orphanPayment.reply,
      intent: orphanPayment.intent,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  const installmentsTurn = await tryResolvePurchaseInstallmentsTurn({
    text,
    state,
    tenant,
    deps: deps.visualDraftDeps,
  });
  if (installmentsTurn) {
    state = await persistStatePatch(tenant, phone, state, installmentsTurn.statePatch, saveState);
    await appendTurns(tenant.businessId, phone, [
      { role: 'user', text },
      { role: 'bot', text: installmentsTurn.reply },
    ]);
    return {
      reply: installmentsTurn.reply,
      intent: installmentsTurn.intent,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  const cardDueDay = await tryResolvePurchaseCardDueDayTurn({
    text,
    state,
    tenant,
    deps: deps.visualDraftDeps,
  });
  if (cardDueDay) {
    state = await persistStatePatch(tenant, phone, state, cardDueDay.statePatch, saveState);
    await appendTurns(tenant.businessId, phone, [
      { role: 'user', text },
      { role: 'bot', text: cardDueDay.reply },
    ]);
    return {
      reply: cardDueDay.reply,
      intent: cardDueDay.intent,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  const catalogMatch = await tryResolveVisualCatalogProductTurn({
    text,
    state,
    candidateAwaiting: null,
    tenant,
    deps: deps.visualDraftDeps,
  });
  if (catalogMatch) {
    state = await persistStatePatch(tenant, phone, state, catalogMatch.statePatch, saveState);
    await appendTurns(tenant.businessId, phone, [
      { role: 'user', text },
      { role: 'bot', text: catalogMatch.reply },
    ]);
    return {
      reply: catalogMatch.reply,
      intent: catalogMatch.intent,
      executed: false,
      businessId: tenant.businessId,
    };
  }

  const reinterpretConfirm = shouldReinterpretPendingConfirm(state?.pendingIntent, text);
  const autoExecuteAmend = shouldAutoExecuteAmendedConfirm(state?.pendingIntent, text);
  if (reinterpretConfirm) {
    console.info('[v4:confirmation] correction → agent', {
      text: text.slice(0, 80),
      pendingPlanId: pendingPlan?.planId ?? null,
      autoExecuteAmend,
    });
  } else if (
    shouldAutoSuspendForAgent(state, text, {
      skipWhenVisualProductMatch: skipAutoSuspendForVisualFreeText,
    })
  ) {
    const suspendPatch = suspendActiveWorkflow(state);
    state = await persistStatePatch(tenant, phone, state, suspendPatch, saveState);
  }

  const revivedDraft = reviveVisualDraft(state);
  if (
    revivedDraft?.kind === 'purchase' &&
    revivedDraft.itemsReviewAcknowledged &&
    isExactNumericOnly(text) &&
    !getCandidateSelectionAwaiting(state)
  ) {
    const paymentRetry = await tryResolveOrphanVisualDraftPaymentSelection({
      text,
      state,
      tenant,
      deps: deps.visualDraftDeps,
    });
    if (paymentRetry) {
      state = await persistStatePatch(tenant, phone, state, paymentRetry.statePatch, saveState);
      await appendTurns(tenant.businessId, phone, [
        { role: 'user', text },
        { role: 'bot', text: paymentRetry.reply },
      ]);
      return {
        reply: paymentRetry.reply,
        intent: paymentRetry.intent,
        executed: false,
        businessId: tenant.businessId,
      };
    }
  }

  if (
    isDeterministicYes(text) &&
    purchaseDraftAwaitingItemsReview(revivedDraft ?? liveVisualDraft(state))
  ) {
    const plan = planFromState(state);
    const frozenConfirmReady =
      shouldExecuteFrozenPlan(state?.pendingIntent, text) &&
      Boolean(plan && planMatchesPresentedConfirmation(state, plan));
    if (!frozenConfirmReady) {
      const recovered = await tryAcknowledgeOrphanPurchaseItemsReview({
        text,
        state,
        tenant,
        deps: deps.visualDraftDeps,
      });
      if (recovered) {
        state = await persistStatePatch(tenant, phone, state, recovered.statePatch, saveState);
        await appendTurns(tenant.businessId, phone, [
          { role: 'user', text },
          { role: 'bot', text: recovered.reply },
        ]);
        return {
          reply: recovered.reply,
          intent: recovered.intent,
          executed: false,
          businessId: tenant.businessId,
        };
      }
    }
  }

  try {
    await (deps.assertAi ?? assertCanUseAi)(tenant.businessId, 2);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const reply =
      code === 'AI_QUOTA_EXCEEDED'
        ? AI_QUOTA_REPLY
        : await formatThrownUsage(error, tenant.businessId);
    return {
      reply,
      intent: code === 'AI_QUOTA_EXCEEDED' ? 'ai_quota' : 'usage_blocked',
      executed: false,
      businessId: tenant.businessId,
    };
  }

  if (text) {
    await appendTurns(tenant.businessId, phone, [{ role: 'user', text }]);
  }

  try {
    const agent = (deps.createAgent ?? createConversationAgent)();
    const result = await agent.runTurn({
      tenant,
      state,
      text,
      messageId: message.messageId,
      transcript: text,
      image,
    });

    if (autoExecuteAmend && result.operationPlan && !result.executed) {
      console.info('[v4:confirmation] amend → auto-execute', {
        planId: result.operationPlan.planId ?? null,
        writes: result.operationPlan.writes.map((row) => row.tool),
      });
      return executeFrozenV4Plan(tenant, phone, result.operationPlan, deps, {
        askSettleIfNeeded: false,
      });
    }

    if (result.operationPlan && !result.executed && planAllowsAutoCommit(result.operationPlan)) {
      console.info('[v4:auto-commit] direct execute', {
        planId: result.operationPlan.planId ?? null,
        writes: result.operationPlan.writes.map((row) => row.tool),
      });
      return executeFrozenV4Plan(tenant, phone, result.operationPlan, deps, {
        askSettleIfNeeded: false,
        autoCommit: true,
      });
    }

    const patch = {
      ...(result.statePatch ?? {}),
      operationPlan: result.operationPlan
        ? (result.operationPlan as unknown as Record<string, unknown>)
        : result.statePatch?.operationPlan,
    };
    if (Object.keys(patch).length) {
      state = await saveState(tenant.businessId, phone, patch);
    }

    let reply = result.reply;
    if (result.executed) {
      const onboardingState = await loadWhatsAppOnboardingState(tenant.businessId);
      const recorded = await recordFirstSuccessfulAction(tenant.businessId);
      const tipId = 'first_success_cash';
      const section = onboardingState.currentSection;
      const tip = firstSuccessTipForSection(section);
      if (recorded && tip && shouldShowTip(onboardingState, tipId)) {
        reply = `${reply}\n\n${tip}`;
        await recordTipShown(tenant.businessId, tipId);
      }
    }

    await appendTurns(tenant.businessId, phone, [{ role: 'bot', text: reply }]);

    logWhatsappTurn({
      rawMessage: text,
      engine: 'v4',
      intent: result.intent,
      executed: result.executed,
      finalOperationPlan: result.operationPlan ? presentConfirmationPlan(result.operationPlan).slice(0, 180) : null,
      resolvedEntities: result.toolResults
        ?.flatMap((row) => Object.keys(row.output ?? {}))
        .slice(0, 8),
      llmOutput: result.reply.slice(0, 400),
    });

    console.info(
      '[whatsapp:v4:turn]',
      JSON.stringify({
        businessId: tenant.businessId,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        toolCalls: result.toolCalls?.map((row) => ({
          name: row.name,
          args: row.arguments,
        })),
        executed: result.executed,
      })
    );

    return {
      reply,
      intent: result.intent,
      executed: result.executed,
      businessId: tenant.businessId,
    };
  } catch (error) {
    console.error('[v4:turn] unhandled error', error);
    const reply = agentErrorReply(error);
    await appendTurns(tenant.businessId, phone, [{ role: 'bot', text: reply }]);
    logWhatsappTurn({
      rawMessage: text,
      engine: 'v4',
      intent: 'v4_error',
      executed: false,
      whyFallbackWasUsed: error instanceof Error ? error.message : 'unknown',
    });
    return {
      reply,
      intent: 'v4_error',
      executed: false,
      businessId: tenant.businessId,
    };
  }
}
