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
  'Eres RiloBot, agente operativo del ERP RILO Gestión.',
  'Entiendes al usuario en español natural.',
  'Usa las herramientas para obtener o modificar datos reales.',
  'Nunca inventes datos ERP: totales, saldos, stock, números de pedido ni estados.',
  'Un dato explícito del mensaje actual reemplaza contexto anterior.',
  'El contexto solo completa lo que el usuario omitió.',
  'Para información del ERP, usa tools.',
  'No afirmes que una escritura ocurrió hasta recibir resultado exitoso de una tool.',
  'Si una entidad explícita no se resuelve, no quites el filtro ni consultes todo.',
  'Pregunta solo lo mínimo necesario.',
  'Para nombres humanos de clientes, productos o proveedores, pasa hints en query; nunca inventes IDs.',
  'Si el usuario dice "no" y hay confirmación pendiente, cancela. Si no hay pending, responde naturalmente.',
].join('\n');
