import type { ConversationState } from '../conversation-state.ts';
import type { WhatsappTenantContext } from '../tenant-resolver.ts';

export type AgentContextSummary = {
  focusClient?: { id?: string; name?: string };
  focusOrder?: { id?: string; label?: string; clientName?: string; status?: string };
  focusProduct?: { id?: string; name?: string };
  lastQuery?: ConversationState['lastQuery'];
  listContext?: ConversationState['listContext'];
  pendingConfirmation?: boolean;
  recentTurns?: Array<{ role: 'user' | 'bot'; text: string }>;
};

export function buildAgentContextSummary(
  tenant: WhatsappTenantContext,
  state: ConversationState | null
): AgentContextSummary {
  const focus = state?.focusEntities ?? {};
  return {
    focusClient: focus.client?.name || focus.client?.id ? focus.client : undefined,
    focusOrder: state?.focusOrder
      ? {
          id: state.focusOrder.id,
          label: state.focusOrder.label,
          clientName: state.focusOrder.clientName,
          status: state.focusOrder.status,
        }
      : focus.order?.id
        ? focus.order
        : undefined,
    focusProduct: focus.product?.name || focus.product?.id ? focus.product : undefined,
    lastQuery: state?.lastQuery ?? undefined,
    listContext: state?.listContext ?? undefined,
    pendingConfirmation: Boolean(state?.pendingIntent?.startsWith('confirm:')),
    recentTurns: (state?.turns ?? []).slice(-6).map((turn) => ({ role: turn.role, text: turn.text })),
  };
}

export function buildAgentDeveloperContext(
  tenant: WhatsappTenantContext,
  state: ConversationState | null
): string {
  const summary = buildAgentContextSummary(tenant, state);
  const lines = [
    'CONTEXTO CONVERSACIONAL (solo completa lo omitido; NUNCA reemplaza entidades explícitas del mensaje actual).',
    summary.focusClient?.name ? `focusClient=${summary.focusClient.name}` : 'focusClient=none',
    summary.focusOrder?.label
      ? `focusOrder=#${summary.focusOrder.label}${summary.focusOrder.clientName ? ` (${summary.focusOrder.clientName})` : ''}`
      : 'focusOrder=none',
    summary.focusProduct?.name ? `focusProduct=${summary.focusProduct.name}` : 'focusProduct=none',
    summary.lastQuery
      ? `lastQuery=${summary.lastQuery.intent} ${JSON.stringify(summary.lastQuery.slots)}`
      : 'lastQuery=none',
    summary.listContext?.type ? `listContext=${summary.listContext.type} total=${summary.listContext.totalResults}` : 'listContext=none',
    summary.pendingConfirmation ? 'pendingConfirmation=true' : 'pendingConfirmation=false',
  ];
  if (summary.recentTurns?.length) {
    lines.push('recentTurns:');
    for (const turn of summary.recentTurns) {
      lines.push(`- ${turn.role}: ${turn.text.slice(0, 180)}`);
    }
  }
  lines.push(`businessId=${tenant.businessId}`);
  return lines.join('\n');
}

export const RILOBOT_V4_SYSTEM_INSTRUCTION = [
  'Eres RiloBot V4, agente operativo del ERP RILO Gestión.',
  'Interpretás español natural. El backend NO interpreta español: solo valida, resuelve IDs, aplica reglas ERP y ejecuta Domain Services.',
  'Usá herramientas para leer o preparar cambios reales. Nunca inventes IDs, precios, saldos, stock, estados ni totales.',
  'MENSAJE ACTUAL > CONTEXTO > DEFAULTS: un dato explícito del turno actual reemplaza focusEntities/lastQuery anteriores.',
  'Si el usuario dio un filtro (cliente, producto, estado, fecha), conservalo. Si no se resuelve la entidad, NO consultes todo el ERP.',
  'Para hints humanos usá clientQuery/productQuery/orderNumber; los resolvers devuelven IDs reales.',
  'Listas sin cantidad: limit=10, más recientes primero. "más" continúa la misma queryContext.',
  'Writes sensibles: prepará tool call → backend congela OperationPlan → pedí confirmación. No afirmes ejecución antes del resultado.',
  'Pago ≠ estado. "ya está pago" es cobro; "ponelo listo" es estado. Podés combinar varias tools en un plan.',
  'Si una tool devuelve ambiguous/not_found/filter_blocked, no inventes ni abras la query global.',
  'Respondé compacto. Listados numerados cuando el backend lo pida para desambiguación.',
].join('\n');
