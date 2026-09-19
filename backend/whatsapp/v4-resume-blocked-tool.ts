import type { WhatsappTenantContext } from './tenant-resolver.ts';
import type { ConversationState } from './conversation-state.ts';
import {
  type CandidateSelectionAwaiting,
  type CandidateSelectionOption,
  type CandidateSelectionResume,
  buildCandidateSelectionState,
  focusPatchFromCandidate,
  normalizeCandidateRows,
  type CandidateSelectionEntityType,
} from './v4-candidate-selection.ts';
import { isRealCandidateAmbiguity } from './entity-candidate-result.ts';
import { executeReadToolCall, prepareWriteToolCalls } from './agent/tool-executor.ts';
import { buildToolRegistryForTenant } from './agent/tool-registry.ts';
import {
  presentCashBalance,
  presentCashMovements,
  presentClientBalanceFromToolOutput,
  presentConfirmationPlan,
  presentNumberedCandidateSelection,
  presentOrderListFromToolOutput,
  presentOrderLookupFromToolOutput,
  presentCollaboratorList,
  presentCollaboratorDetail,
  presentToolAmbiguity,
} from './agent/agent-presenter.ts';
import { freezeOperationPlanPatch } from './v4-order-settle.ts';
import { AgentError } from './agent/agent-errors.ts';
import type { ToolExecutionResult } from './agent/tool-types.ts';
import {
  applyVisualDraftSelection,
  buildCatalogProductMatchQueryState,
  buildCreateProductNameState,
  buildVisualDraftIssueStatePatch,
  firstUnresolvedVisualIssue,
  isVisualDraftReadyToWrite,
  liveVisualDraft,
  parseVisualDraft,
  reviveVisualDraft,
  presentCreateProductNameAsk,
  presentVisualDraft,
  presentVisualDraftIssueReply,
  presentVisualItemLinked,
  rematchUnresolvedDraftItems,
  resolveVisualDraftBlockingIssue,
  type VisualDraftDeps,
  VISUAL_CANDIDATE_BACK,
  VISUAL_CATALOG_MATCH_PROMPT,
  VISUAL_CREATE_USE_REMITO_NAME,
  VISUAL_MANUAL_MATCH_BACK,
  VISUAL_NOT_FOUND_CREATE,
  VISUAL_NOT_FOUND_LINK,
  createAndLinkVisualDraftProduct,
} from './v4-visual-draft.ts';
import { freezeVisualDraftConfirmation } from './v4-visual-draft-confirmation.ts';
import { loadOrderPedidosConfig } from '../routes/orders.ts';
import {
  adjustPendingWritesForOrder,
  analyzePendingWrites,
  buildOrderAlreadyCompleteReply,
  compoundOrderPlanSummary,
  noEligibleOrdersMessage,
  orderCandidateFromRecord,
  resolveOrdersForOperation,
  type PendingWriteCall,
} from './v4-order-operation.ts';
import {
  firestoreGetOrderById,
  firestoreListOrdersByClientId,
} from './resolve-order-reference.ts';
import { formatWhatsappMessage } from '../../shared/whatsapp-format.ts';

function presenterForToolResult(name: string, output: Record<string, unknown>): string {
  const entityType =
    output.entityType === 'client' ||
    output.entityType === 'order' ||
    output.entityType === 'product' ||
    output.entityType === 'supplier' ||
    output.entityType === 'cash_account'
      ? (output.entityType as CandidateSelectionEntityType)
      : name.includes('order')
        ? 'order'
        : 'client';
  const ambiguous = presentToolAmbiguity(entityType, output);
  if (ambiguous) return ambiguous;
  if (name === 'list_orders') return presentOrderListFromToolOutput(output);
  if (name === 'find_order' || name === 'get_order') {
    return presentOrderLookupFromToolOutput(output) ?? String(output.message ?? 'Listo.');
  }
  if (name === 'get_client_balance') {
    return presentClientBalanceFromToolOutput(output);
  }
  if (name === 'list_cash_movements') return presentCashMovements(output);
  if (name === 'get_cash_balance') return presentCashBalance(output);
  if (name === 'list_collaborators') return presentCollaboratorList(output);
  if (name === 'find_collaborator' || name === 'get_collaborator') {
    if (output.status === 'resolved') return presentCollaboratorDetail(output);
  }
  if (output.status === 'not_found') {
    return String(output.message ?? 'No encontré resultados.');
  }
  if (output.status === 'filter_blocked') {
    const ambiguous = presentToolAmbiguity('client', output);
    if (ambiguous) return ambiguous;
    return String(output.message ?? 'No pude aplicar ese filtro.');
  }
  return 'Listo.';
}

function buildStatePatchFromResume(
  toolName: string,
  output: Record<string, unknown>,
  option: CandidateSelectionOption,
  awaiting: CandidateSelectionAwaiting,
  previous: ConversationState | null
): Partial<ConversationState> {
  const patch: Partial<ConversationState> = {
    pendingIntent: null,
    pendingPayload: null,
    pendingPrompt: null,
    activeTask: null,
    focusEntities: focusPatchFromCandidate(awaiting.entityType, option, previous?.focusEntities),
  };

  if (toolName === 'list_orders' && Array.isArray(output.items)) {
    const filter = (output.filter ?? {}) as Record<string, unknown>;
    patch.lastQuery = {
      intent: 'query_orders',
      slots: {
        clientName: String(filter.clientName ?? option.label.split(' · ')[0] ?? ''),
        entity: 'orders',
        metric: 'list',
        status: filter.status ? String(filter.status) : undefined,
        limit: output.items.length,
        offset: Number(output.nextOffset) || 0,
      },
    };
    patch.listContext = {
      type: 'orders',
      items: output.items.map((row) => String((row as { number?: string }).number ?? '')),
      currentPage: 1,
      pageSize: output.items.length,
      totalResults: Number(output.total) || output.items.length,
      hasMore: output.hasMore === true,
      offset: Number(output.nextOffset) || 0,
      clientId: option.entityId,
      filters: patch.lastQuery.slots,
      title: filter.clientName ? `Pedidos de ${filter.clientName}` : 'Pedidos',
    };
  }

  return patch;
}

function buildNestedCandidatePatch(
  entityType: CandidateSelectionEntityType,
  candidates: unknown[],
  resume: CandidateSelectionResume
): Partial<ConversationState> {
  const options = normalizeCandidateRows(entityType, candidates);
  return buildCandidateSelectionState({ entityType, options, resume });
}

async function prepareOrderContinuationPlan(input: {
  tenant: WhatsappTenantContext;
  state: ConversationState | null;
  awaiting: CandidateSelectionAwaiting;
  order: { id: string; data: Record<string, unknown> };
  pendingWrites: PendingWriteCall[];
  registry: Awaited<ReturnType<typeof buildToolRegistryForTenant>>;
  option: CandidateSelectionOption;
}): Promise<{ reply: string; statePatch: Partial<ConversationState> } | null> {
  const config = await loadOrderPedidosConfig(input.tenant.businessId);
  const adjusted = adjustPendingWritesForOrder(
    input.pendingWrites,
    { id: input.order.id, data: input.order.data },
    config
  );
  if (!adjusted.length) {
    return {
      reply: buildOrderAlreadyCompleteReply(
        { id: input.order.id, data: input.order.data },
        analyzePendingWrites(input.pendingWrites),
        config
      ),
      statePatch: {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
      },
    };
  }
  console.info(
    '[v4:continuation:resume]',
    JSON.stringify({ operationTypes: adjusted.map((row) => row.tool) })
  );
  const plan = await prepareWriteToolCalls(
    adjusted.map((row, idx) => ({
      id: `resume:${row.tool}:${idx}`,
      name: row.tool,
      arguments: row.arguments,
    })),
    {
      tenant: input.tenant,
      state: input.state,
      messageId: undefined,
      rawUserMessage: input.awaiting.resume.originalUserText,
    },
    input.registry
  );
  const summary = compoundOrderPlanSummary({ id: input.order.id, data: input.order.data }, adjusted, config);
  plan.summary = summary;
  const reply = presentConfirmationPlan(plan);
  return {
    reply,
    statePatch: {
      ...freezeOperationPlanPatch(plan, input.state, { reply }),
      focusEntities: focusPatchFromCandidate(
        input.awaiting.entityType,
        input.option,
        input.state?.focusEntities
      ),
    },
  };
}

async function resumeOrderContinuationAfterClient(input: {
  tenant: WhatsappTenantContext;
  state: ConversationState | null;
  awaiting: CandidateSelectionAwaiting;
  option: CandidateSelectionOption;
  registry: Awaited<ReturnType<typeof buildToolRegistryForTenant>>;
}): Promise<{ reply: string; statePatch: Partial<ConversationState> } | null> {
  const pendingWrites = input.awaiting.resume.continuation?.pendingWrites ?? [];
  if (!pendingWrites.length) return null;

  const clientId = input.option.entityId;
  const clientName = input.option.label.replace(/^👤\s*/, '').split(' · ')[0]?.trim() || input.option.label;
  console.info(
    '[v4:candidate:selected]',
    JSON.stringify({ entityType: 'client', selectedId: clientId })
  );

  const config = await loadOrderPedidosConfig(input.tenant.businessId);
  const ops = analyzePendingWrites(pendingWrites);
  const rows = await firestoreListOrdersByClientId(input.tenant.businessId, clientId, 10);
  const resolution = resolveOrdersForOperation(rows, ops, config);
  console.info('[v4:order:eligible]', JSON.stringify({ clientId, count: rows.length, resolution: resolution.kind }));

  if (resolution.kind === 'none') {
    return {
      reply: noEligibleOrdersMessage(clientName, ops, config),
      statePatch: {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
        focusEntities: focusPatchFromCandidate('client', input.option, input.state?.focusEntities),
      },
    };
  }

  if (resolution.kind === 'resolved' || resolution.kind === 'already_complete' || resolution.kind === 'partial_satisfied') {
    return prepareOrderContinuationPlan({
      tenant: input.tenant,
      state: input.state,
      awaiting: input.awaiting,
      option: input.option,
      registry: input.registry,
      order: resolution.order,
      pendingWrites,
    });
  }

  const eligibleRows = resolution.kind === 'ambiguous' ? resolution.candidates : [];
  if (eligibleRows.length === 1) {
    return prepareOrderContinuationPlan({
      tenant: input.tenant,
      state: input.state,
      awaiting: input.awaiting,
      option: input.option,
      registry: input.registry,
      order: eligibleRows[0]!,
      pendingWrites,
    });
  }

  if (!eligibleRows.length) {
    return {
      reply: noEligibleOrdersMessage(clientName, ops, config),
      statePatch: {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
        focusEntities: focusPatchFromCandidate('client', input.option, input.state?.focusEntities),
      },
    };
  }

  const candidates = eligibleRows.map((row) => orderCandidateFromRecord(row));
  const resume: CandidateSelectionResume = {
    originalUserText: input.awaiting.resume.originalUserText,
    blockedTool: input.awaiting.resume.blockedTool,
    blockedArgs: { ...input.awaiting.resume.blockedArgs, clientId, clientName },
    sourceTool: input.awaiting.resume.sourceTool,
    continuation: input.awaiting.resume.continuation,
  };
  const options = normalizeCandidateRows('order', candidates);
  const numbered = options.map((row) => `${row.index}. ${row.label}`);
  return {
    reply: formatWhatsappMessage({
      title: `📋 Pedidos de ${clientName}`,
      lines: numbered,
      ask: 'Indicame qué ítem querés usar, escribime el nombre, o qué querés hacer.',
    }),
    statePatch: buildCandidateSelectionState({ entityType: 'order', options, resume }),
  };
}

async function resumeOrderContinuationAfterOrder(input: {
  tenant: WhatsappTenantContext;
  state: ConversationState | null;
  awaiting: CandidateSelectionAwaiting;
  option: CandidateSelectionOption;
  registry: Awaited<ReturnType<typeof buildToolRegistryForTenant>>;
}): Promise<{ reply: string; statePatch: Partial<ConversationState> } | null> {
  const pendingWrites = input.awaiting.resume.continuation?.pendingWrites ?? [];
  if (!pendingWrites.length) return null;

  const orderId = input.option.entityId;
  console.info(
    '[v4:candidate:selected]',
    JSON.stringify({ entityType: 'order', selectedId: orderId })
  );
  const order = await firestoreGetOrderById(input.tenant.businessId, orderId);
  if (!order) {
    return {
      reply: 'No encontré ese pedido.',
      statePatch: {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
      },
    };
  }
  return prepareOrderContinuationPlan({
    ...input,
    order,
    pendingWrites,
  });
}

/** Continúa una operación bloqueada por ambigüedad, sin LLM. */
export async function resumeBlockedToolAfterSelection(input: {
  tenant: WhatsappTenantContext;
  state: ConversationState | null;
  awaiting: CandidateSelectionAwaiting;
  option: CandidateSelectionOption;
  visualDraftDeps?: VisualDraftDeps;
}): Promise<{ reply: string; statePatch: Partial<ConversationState>; toolResult?: ToolExecutionResult }> {
  const { tenant, state, awaiting, option, visualDraftDeps } = input;
  const registry = await buildToolRegistryForTenant(tenant);

  if (awaiting.resume.draftId) {
    const current = reviveVisualDraft(state) ?? liveVisualDraft(state) ?? parseVisualDraft(state?.visualDraft);
    if (current && (!awaiting.resume.draftId || current.id === awaiting.resume.draftId)) {
      if (option.entityId === VISUAL_NOT_FOUND_LINK) {
        const itemIndex = Number(awaiting.resume.itemIndex ?? 0);
        return {
          reply: VISUAL_CATALOG_MATCH_PROMPT,
          statePatch: buildCatalogProductMatchQueryState(current, itemIndex),
        };
      }
      if (option.entityId === VISUAL_NOT_FOUND_CREATE && awaiting.resume.itemIndex != null) {
        const itemIndex = Number(awaiting.resume.itemIndex);
        const item = current.items.find((row) => row.index === itemIndex);
        if (!item) {
          return {
            reply: 'No encontré el ítem del borrador para crear el producto.',
            statePatch: { visualDraft: current },
          };
        }
        return {
          reply: presentCreateProductNameAsk(item),
          statePatch: buildCreateProductNameState(current, itemIndex),
        };
      }
      let workingDraft = current;
      if (
        (option.entityId === VISUAL_CREATE_USE_REMITO_NAME ||
          (option.entityId === VISUAL_CANDIDATE_BACK &&
            awaiting.options.some((row) => row.entityId === VISUAL_CREATE_USE_REMITO_NAME))) &&
        awaiting.resume.itemIndex != null
      ) {
        const itemIndex = Number(awaiting.resume.itemIndex);
        if (option.entityId === VISUAL_CANDIDATE_BACK) {
          let issue = firstUnresolvedVisualIssue(current);
          if (!issue && current.kind === 'purchase') {
            issue = await resolveVisualDraftBlockingIssue(current, tenant.businessId);
          }
          return {
            reply: issue
              ? presentVisualDraftIssueReply(current, issue, { lead: 'start' })
              : presentVisualDraft(current),
            statePatch: issue
              ? {
                  ...buildVisualDraftIssueStatePatch(current, issue, awaiting.resume.originalUserText),
                  visualDraft: current,
                }
              : { visualDraft: current, pendingIntent: null, pendingPayload: null, pendingPrompt: null },
          };
        }
        const created = await createAndLinkVisualDraftProduct(
          tenant.businessId,
          current,
          itemIndex,
          visualDraftDeps ?? {}
        );
        workingDraft = created.draft;
        let issue = firstUnresolvedVisualIssue(workingDraft);
        if (!issue && workingDraft.kind === 'purchase') {
          issue = await resolveVisualDraftBlockingIssue(workingDraft, tenant.businessId);
        }
        const replyParts = [
          presentVisualItemLinked(
            workingDraft.items.find((row) => row.index === itemIndex)!,
            created.created.name
          ),
        ];
        if (issue) {
          replyParts.push(presentVisualDraftIssueReply(workingDraft, issue, { lead: 'continue' }));
          return {
            reply: replyParts.filter(Boolean).join('\n\n'),
            statePatch: {
              ...buildVisualDraftIssueStatePatch(workingDraft, issue, awaiting.resume.originalUserText),
              visualDraft: workingDraft,
            },
          };
        }
        if (isVisualDraftReadyToWrite(workingDraft)) {
          const frozen = await freezeVisualDraftConfirmation({
            draft: workingDraft,
            tenant,
            state: {
              ...(state ?? {
                businessId: tenant.businessId,
                phone: tenant.phone,
                updatedAt: new Date().toISOString(),
              }),
              visualDraft: workingDraft,
            },
            rawUserMessage: awaiting.resume.originalUserText,
          });
          if (frozen) {
            return {
              reply: replyParts.filter(Boolean).concat(frozen.reply).join('\n\n'),
              statePatch: frozen.statePatch,
            };
          }
        }
        return {
          reply: replyParts.filter(Boolean).join('\n\n'),
          statePatch: {
            pendingIntent: null,
            pendingPayload: null,
            pendingPrompt: null,
            activeTask: null,
            visualDraft: workingDraft,
          },
        };
      }
      const selected = applyVisualDraftSelection({
        draft: workingDraft,
        option,
        resume: awaiting.resume,
      });
      const updated =
        awaiting.resume.party === 'supplier'
          ? await rematchUnresolvedDraftItems(
              tenant.businessId,
              selected,
              awaiting.resume.originalUserText,
              visualDraftDeps ?? {}
            )
          : selected;
      let issue = firstUnresolvedVisualIssue(updated);
      if (!issue && updated.kind === 'purchase') {
        issue = await resolveVisualDraftBlockingIssue(updated, tenant.businessId);
      }
      const linkedItem =
        awaiting.resume.party === 'item' &&
        option.entityId !== VISUAL_MANUAL_MATCH_BACK &&
        !option.entityId.startsWith('__visual_')
          ? updated.items.find((row) => row.index === awaiting.resume.itemIndex)
          : undefined;
      const replyParts: string[] = [];
      if (linkedItem?.matchedProductName && linkedItem.matchStatus === 'resolved') {
        replyParts.push(presentVisualItemLinked(linkedItem, linkedItem.matchedProductName));
      }
      if (issue) {
        replyParts.push(presentVisualDraftIssueReply(updated, issue));
        return {
          reply: replyParts.filter(Boolean).join('\n\n'),
          statePatch: {
            ...buildVisualDraftIssueStatePatch(updated, issue, awaiting.resume.originalUserText),
            visualDraft: updated,
            focusEntities: option.entityId.startsWith('__visual_')
              ? state?.focusEntities
              : focusPatchFromCandidate(awaiting.entityType, option, state?.focusEntities),
          },
        };
      }
      if (isVisualDraftReadyToWrite(updated)) {
        const frozen = await freezeVisualDraftConfirmation({
          draft: updated,
          tenant,
          state: {
            ...(state ?? {
              businessId: tenant.businessId,
              phone: tenant.phone,
              updatedAt: new Date().toISOString(),
            }),
            visualDraft: updated,
          },
          rawUserMessage: awaiting.resume.originalUserText,
        });
        if (frozen) {
          return {
            reply: frozen.reply,
            statePatch: {
              ...frozen.statePatch,
              focusEntities: option.entityId.startsWith('__visual_')
                ? state?.focusEntities
                : focusPatchFromCandidate(awaiting.entityType, option, state?.focusEntities),
            },
          };
        }
      }
      return {
        reply: presentVisualDraft(updated),
        statePatch: {
          pendingIntent: null,
          pendingPayload: null,
          pendingPrompt: null,
          activeTask: null,
          visualDraft: updated,
          focusEntities: option.entityId.startsWith('__visual_')
            ? state?.focusEntities
            : focusPatchFromCandidate(awaiting.entityType, option, state?.focusEntities),
        },
      };
    }
  }

  const blockedTool = String(awaiting.resume.blockedTool ?? 'list_orders');
  const blockedArgs = { ...(awaiting.resume.blockedArgs ?? {}) };

  if (awaiting.entityType === 'client') {
    blockedArgs.clientId = option.entityId;
    delete blockedArgs.clientQuery;
    delete blockedArgs.query;
    const orderContinuation = await resumeOrderContinuationAfterClient({
      tenant,
      state,
      awaiting,
      option,
      registry,
    });
    if (orderContinuation) return orderContinuation;
  } else if (awaiting.entityType === 'product') {
    blockedArgs.productId = option.entityId;
    delete blockedArgs.productQuery;
  } else if (awaiting.entityType === 'supplier') {
    blockedArgs.supplierId = option.entityId;
    delete blockedArgs.supplierQuery;
  } else if (awaiting.entityType === 'order') {
    blockedArgs.orderId = option.entityId;
    delete blockedArgs.orderNumber;
    delete blockedArgs.query;
    const orderContinuation = await resumeOrderContinuationAfterOrder({
      tenant,
      state,
      awaiting,
      option,
      registry,
    });
    if (orderContinuation) return orderContinuation;
  } else if (awaiting.entityType === 'cash_account') {
    blockedArgs.ambitoId = option.entityId;
    blockedArgs.cashAccountId = option.entityId;
    delete blockedArgs.cashAccountHint;
  } else if (awaiting.entityType === 'work_log') {
    blockedArgs.movementId = option.entityId;
  }

  if (awaiting.entityType === 'work_log' && blockedTool === 'update_collaborator_movement') {
    try {
      const plan = await prepareWriteToolCalls(
        [{ id: 'resume:update_collaborator_movement', name: blockedTool, arguments: blockedArgs }],
        {
          tenant,
          state,
          messageId: undefined,
          rawUserMessage: awaiting.resume.originalUserText,
        },
        registry
      );
      return {
        reply: presentConfirmationPlan(plan),
        statePatch: freezeOperationPlanPatch(plan, state, {
          reply: presentConfirmationPlan(plan),
        }),
      };
    } catch (error) {
      if (error instanceof AgentError) {
        return {
          reply: error.message,
          statePatch: {
            pendingIntent: null,
            pendingPayload: null,
            pendingPrompt: null,
            activeTask: null,
          },
        };
      }
      throw error;
    }
  }

  if (awaiting.entityType === 'cash_account' && blockedTool === 'register_cash_movement') {
    try {
      const plan = await prepareWriteToolCalls(
        [{ id: 'resume:register_cash_movement', name: blockedTool, arguments: blockedArgs }],
        {
          tenant,
          state,
          messageId: undefined,
          rawUserMessage: awaiting.resume.originalUserText,
        },
        registry
      );
      return {
        reply: presentConfirmationPlan(plan),
        statePatch: {
          ...freezeOperationPlanPatch(plan, state, {
            reply: presentConfirmationPlan(plan),
          }),
          focusEntities: focusPatchFromCandidate(awaiting.entityType, option, state?.focusEntities),
        },
      };
    } catch (error) {
      if (error instanceof AgentError) {
        return {
          reply: error.message,
          statePatch: {
            pendingIntent: null,
            pendingPayload: null,
            pendingPrompt: null,
            activeTask: null,
          },
        };
      }
      throw error;
    }
  }

  if (blockedTool === 'find_client' && !awaiting.resume.continuation?.pendingWrites?.length) {
    const clientId = option.entityId;
    const clientName = option.label.split(' · ')[0]?.trim() || option.label;
    const ctx = {
      tenant,
      state,
      messageId: undefined,
      rawUserMessage: awaiting.resume.originalUserText,
    };

    const pendingReads = awaiting.resume.continuation?.pendingReads ?? [];
    const wantsBalance =
      pendingReads.some((row) => row.tool === 'get_client_balance') || pendingReads.length === 0;
    const wantsOrders = pendingReads.some(
      (row) => row.tool === 'list_orders' || row.tool === 'find_order'
    );

    const balanceResult = wantsBalance
      ? await executeReadToolCall(
          { id: 'resume:get_client_balance', name: 'get_client_balance', arguments: { clientId } },
          ctx,
          registry
        )
      : null;
    const ordersResult =
      wantsOrders && !wantsBalance
        ? await executeReadToolCall(
            {
              id: 'resume:list_orders',
              name: 'list_orders',
              arguments: {
                clientId,
                clientQuery: clientName,
                limit: 10,
                sort: 'recent_desc',
              },
            },
            ctx,
            registry
          )
        : null;

    for (const row of pendingReads) {
      if (row.tool === 'get_client_balance' || row.tool === 'list_orders' || row.tool === 'find_order') {
        continue;
      }
      await executeReadToolCall(
        {
          id: `resume:${row.tool}`,
          name: row.tool,
          arguments: { ...(row.arguments ?? {}), clientId },
        },
        ctx,
        registry
      );
    }

    if (balanceResult?.ok) {
      return {
        reply: presentClientBalanceFromToolOutput(balanceResult.output ?? {}),
        statePatch: {
          ...buildStatePatchFromResume(
            'get_client_balance',
            balanceResult.output ?? {},
            option,
            awaiting,
            state
          ),
          focusEntities: focusPatchFromCandidate('client', option, state?.focusEntities),
          lastQuery: {
            intent: 'query_balance',
            slots: {
              clientName: String(balanceResult.output?.clientName ?? clientName).trim(),
              entity: 'client',
              metric: 'balance',
            },
          },
        },
        toolResult: balanceResult,
      };
    }

    if (ordersResult?.ok && Array.isArray(ordersResult.output?.items)) {
      const resolvedName = String(ordersResult.output?.filter?.clientName ?? clientName).trim();
      return {
        reply: presentOrderListFromToolOutput({
          ...ordersResult.output,
          detail: true,
          filter: {
            ...((ordersResult.output.filter as Record<string, unknown> | undefined) ?? {}),
            clientId,
            clientName: resolvedName,
          },
        }),
        statePatch: {
          ...buildStatePatchFromResume(
            'list_orders',
            ordersResult.output ?? {},
            option,
            awaiting,
            state
          ),
          focusEntities: focusPatchFromCandidate('client', option, state?.focusEntities),
        },
        toolResult: ordersResult,
      };
    }

    const result = await executeReadToolCall(
      {
        id: 'resume:get_client',
        name: 'get_client',
        arguments: { clientId },
      },
      ctx,
      registry
    );
    const entity = (result.output?.entity ?? {}) as Record<string, unknown>;
    const name = String(entity.name ?? clientName).trim();
    return {
      reply: `Cliente: *${name}*`,
      statePatch: {
        ...buildStatePatchFromResume('get_client', result.output ?? {}, option, awaiting, state),
        focusEntities: focusPatchFromCandidate('client', option, state?.focusEntities),
      },
      toolResult: result,
    };
  }

  const result = await executeReadToolCall(
    {
      id: `resume:${blockedTool}`,
      name: blockedTool,
      arguments: blockedArgs,
    },
    {
      tenant,
      state,
      messageId: undefined,
      rawUserMessage: awaiting.resume.originalUserText,
    },
    registry
  );

  const output = result.output ?? {};
  if (
    (output.status === 'ambiguous' || output.errorCode === 'ENTITY_AMBIGUOUS') &&
    isRealCandidateAmbiguity(output.candidates as unknown[])
  ) {
    const entityType =
      output.entityType === 'order' ||
      output.entityType === 'client' ||
      output.entityType === 'product' ||
      output.entityType === 'supplier' ||
      output.entityType === 'cash_account'
        ? (output.entityType as CandidateSelectionEntityType)
        : awaiting.entityType;
    const reply = presentNumberedCandidateSelection(entityType, output.candidates as unknown[]);
    return {
      reply,
      statePatch: buildNestedCandidatePatch(entityType, output.candidates as unknown[], {
        originalUserText: awaiting.resume.originalUserText,
        blockedTool,
        blockedArgs,
        sourceTool: blockedTool,
        continuation: awaiting.resume.continuation,
      }),
    };
  }

  if (blockedTool === 'list_orders' && awaiting.entityType === 'client' && Array.isArray(output.items)) {
    const clientId = option.entityId;
    const balanceResult = await executeReadToolCall(
      { id: 'resume:get_client_balance', name: 'get_client_balance', arguments: { clientId } },
      {
        tenant,
        state,
        messageId: undefined,
        rawUserMessage: awaiting.resume.originalUserText,
      },
      registry
    );
    const clientName =
      String(balanceResult.output?.clientName ?? option.label.split(' · ')[0] ?? '').trim() ||
      undefined;
    return {
      reply: presentOrderListFromToolOutput({
        ...output,
        detail: true,
        clientBalance: balanceResult.ok ? Number(balanceResult.output?.balance) || 0 : undefined,
        filter: {
          ...((output.filter as Record<string, unknown> | undefined) ?? {}),
          clientId,
          clientName,
        },
      }),
      statePatch: buildStatePatchFromResume(blockedTool, output, option, awaiting, state),
      toolResult: result,
    };
  }

  return {
    reply: presenterForToolResult(blockedTool, output),
    statePatch: buildStatePatchFromResume(blockedTool, output, option, awaiting, state),
    toolResult: result,
  };
}
