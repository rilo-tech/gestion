import { formatWhatsappMessage, waBold } from '../../../shared/whatsapp-format.ts';
import { presentEntityList, presentOrderListItem } from '../conversation-query.ts';
import { normalizeCandidateRows, type CandidateSelectionEntityType } from '../v4-candidate-selection.ts';
import {
  formatV4CandidateSelection,
  formatV4Confirmation,
  V4_CANDIDATE_SELECTION_PROMPT,
} from '../v4-ui-copy.ts';
import type { AgentOperationPlan } from './tool-types.ts';

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function presentOrderListFromToolOutput(output: Record<string, unknown>): string {
  if (output.status === 'filter_blocked') {
    return String(output.message ?? 'No pude aplicar ese filtro.');
  }
  if (output.mode === 'count') {
    const total = Number(output.total) || 0;
    const filter = (output.filter ?? {}) as { clientName?: string; status?: string };
    const subject = filter.clientName ? `*${filter.clientName}*` : 'El negocio';
    const statusHint = filter.status ? ` ${filter.status}` : '';
    return `${subject} tiene ${total} pedido${total === 1 ? '' : 's'}${statusHint}.`;
  }
  const items = Array.isArray(output.items) ? output.items : [];
  const filter = (output.filter ?? {}) as { clientName?: string; status?: string };
  const title = filter.clientName
    ? `Pedidos de ${filter.clientName}${filter.status ? ` (${filter.status})` : ''}`
    : filter.status
      ? `Pedidos ${filter.status}`
      : 'Pedidos';
  const lines = items.map((row) => {
    const item = row as Record<string, unknown>;
    return presentOrderListItem({
      label: String(item.number ?? item.id ?? ''),
      date: String(item.deliveryDate ?? item.createdAt ?? ''),
      statusLabel: String(item.statusLabel ?? item.status ?? ''),
      total: Number(item.total) || undefined,
    });
  });
  const total = Number(output.total) || items.length;
  return presentEntityList({
    title,
    lines,
    shown: items.length,
    total,
    hasMore: output.hasMore === true,
    requestAll: false,
    emptyText: filter.clientName
      ? `No hay pedidos para *${filter.clientName}* con esos filtros.`
      : 'No hay pedidos con esos filtros.',
    footer: output.footer ? String(output.footer) : undefined,
  });
}

export function presentCashBalance(output: Record<string, unknown>): string {
  const saldo = Number(output.saldo) || 0;
  const rows = Array.isArray(output.byAmbito) ? output.byAmbito : [];
  if (rows.length > 1) {
    const lines = rows.map((row) => {
      const item = row as { label?: string; saldo?: number };
      return `• ${item.label ?? 'Caja'}: $${money(Number(item.saldo) || 0)}`;
    });
    return formatWhatsappMessage({ title: 'Caja', lines, ask: `Total: $${money(saldo)}` });
  }
  return formatWhatsappMessage({
    title: 'Caja',
    lines: output.empty ? ['Las cajas están en $0.'] : [`Saldo: ${waBold(`$${money(saldo)}`)}`],
  });
}

export function presentConfirmationPlan(plan: AgentOperationPlan): string {
  return formatV4Confirmation({
    title: plan.summary.title,
    lines: plan.summary.lines,
  });
}

export function presentClientList(output: Record<string, unknown>): string {
  const items = Array.isArray(output.items) ? output.items : [];
  const lines = items.map((row) => {
    const item = row as { name?: string; telefono?: string };
    return `• ${item.name ?? 'Cliente'}${item.telefono ? ` · ${item.telefono}` : ''}`;
  });
  return presentEntityList({
    title: 'Clientes',
    lines,
    shown: items.length,
    total: Number(output.total) || items.length,
    hasMore: output.hasMore === true,
    emptyText: 'No encontré clientes.',
  });
}

export function presentAmbiguousEntity(message: string, candidates: unknown[]): string {
  return presentNumberedCandidateSelection('client', candidates, message);
}

export function presentNumberedCandidateSelection(
  entityType: CandidateSelectionEntityType,
  candidates: unknown[],
  title?: string
): string {
  const options = normalizeCandidateRows(entityType, candidates);
  const numberedLines = options.map((row) => `${row.index}. ${row.label}`);
  return formatV4CandidateSelection({ entityType, numberedLines, title });
}

/** Re-export for callers that need the canonical prompt string. */
export { V4_CANDIDATE_SELECTION_PROMPT };

export function presentOrderBalance(output: Record<string, unknown>): string {
  const label = String(output.number ?? output.orderId ?? '');
  const balance = Number(output.balance) || 0;
  const clientName = String(output.clientName ?? '').trim();
  return formatWhatsappMessage({
    title: `Pedido #${label}`,
    lines: [
      ...(clientName ? [`Cliente: ${clientName}`] : []),
      `Saldo: ${waBold(`$${money(balance)}`)}`,
    ],
  });
}

export function presentStock(output: Record<string, unknown>): string {
  const name = String(output.name ?? 'Producto');
  const stock = Number(output.stock) || 0;
  return formatWhatsappMessage({
    title: name,
    lines: [`Stock actual: ${waBold(String(stock))}`],
  });
}
