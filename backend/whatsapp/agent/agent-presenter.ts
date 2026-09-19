import { compactWhatsappText, formatWhatsappMessage, waBold } from '../../../shared/whatsapp-format.ts';
import {
  orderLineItemsFromErp,
  presentEntityList,
  presentOrderListItem,
  presentOrderQuery,
  type OrderLineItemView,
} from '../conversation-query.ts';
import { formatDateOnlyEs } from '../lookups.ts';
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
  const filter = (output.filter ?? {}) as { clientName?: string; clientId?: string; status?: string };
  const detail =
    output.detail === true ||
    items.some((row) => {
      const item = row as { items?: unknown; products?: string };
      return (Array.isArray(item.items) && item.items.length > 0) || Boolean(String(item.products ?? '').trim());
    });
  const title = filter.clientName
    ? `Pedidos de ${filter.clientName}${filter.status ? ` (${filter.status})` : ''}`
    : filter.status
      ? `Pedidos ${filter.status}`
      : 'Pedidos';
  const clientBalance =
    output.clientBalance != null && Number.isFinite(Number(output.clientBalance))
      ? Number(output.clientBalance)
      : undefined;
  const header =
    filter.clientName && clientBalance != null
      ? `*${filter.clientName}* debe $${money(clientBalance)} en total.`
      : undefined;

  const lines = detail
    ? items.map((row, index) => {
        const item = row as Record<string, unknown>;
        const lineItems: OrderLineItemView[] = Array.isArray(item.items)
          ? orderLineItemsFromErp(item.items)
          : [];
        const deliveryRaw = String(item.deliveryDate ?? '').trim();
        const delivery = deliveryRaw ? formatDateOnlyEs(deliveryRaw) || deliveryRaw : undefined;
        const status = String(item.statusLabel ?? item.status ?? '').trim();
        const label = String(item.number ?? item.id ?? '');
        const blockLines = [`*${index + 1}. #${label}${status ? ` – ${status}` : ''}*`];
        if (lineItems.length) {
          for (const line of lineItems) {
            const qty = line.quantity && line.quantity > 1 ? `${line.quantity} × ` : '';
            blockLines.push(`• ${qty}${line.name}`);
          }
        } else if (String(item.products ?? '').trim()) {
          blockLines.push(`• ${String(item.products).trim()}`);
        }
        if (delivery) blockLines.push(`Entrega: ${delivery}`);
        const moneyBits: string[] = [];
        if (item.total != null && Number.isFinite(Number(item.total))) {
          moneyBits.push(`Total: $${money(Number(item.total))}`);
        }
        if (item.balance != null && Number.isFinite(Number(item.balance))) {
          moneyBits.push(`Pendiente: $${money(Number(item.balance))}`);
        }
        if (moneyBits.length) blockLines.push(moneyBits.join(' · '));
        return blockLines.join('\n');
      })
    : items.map((row) => {
        const item = row as Record<string, unknown>;
        return presentOrderListItem({
          label: String(item.number ?? item.id ?? ''),
          date: String(item.deliveryDate ?? item.createdAt ?? ''),
          statusLabel: String(item.statusLabel ?? item.status ?? ''),
          total: Number(item.total) || undefined,
        });
      });

  const total = Number(output.total) || items.length;
  const body = presentEntityList({
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
  if (header) {
    return compactWhatsappText(`${header}\n\n${body}`);
  }
  return body;
}

export function presentOrderLookupFromToolOutput(output: Record<string, unknown>): string | null {
  const ambiguous = presentToolAmbiguity(
    output.entityType === 'order' ? 'order' : 'client',
    output
  );
  if (ambiguous) return ambiguous;
  if (output.status === 'filter_blocked') {
    return String(output.message ?? 'No pude aplicar ese filtro.');
  }
  if (output.status === 'resolved' && output.entity && typeof output.entity === 'object') {
    if (output.operationOutcome === 'already_complete' || output.operationOutcome === 'partial_satisfied') {
      return null;
    }
    const entity = output.entity as Record<string, unknown>;
    return presentOrderQuery({
      metric: 'details',
      label: String(entity.number ?? entity.id ?? ''),
      clientName: String(entity.clientName ?? '').trim() || undefined,
      statusLabel: String(entity.statusLabel ?? entity.status ?? '').trim() || undefined,
      products: String(entity.products ?? '').trim() || undefined,
      items: Array.isArray(entity.items) ? orderLineItemsFromErp(entity.items) : undefined,
      notes: String(entity.notes ?? '').trim() || undefined,
      total: Number(entity.total) || undefined,
      saldo: entity.balance != null ? Number(entity.balance) : undefined,
      delivery: String(entity.deliveryDate ?? '').trim() || undefined,
    });
  }
  if (output.status === 'not_found') {
    return String(output.message ?? 'No encontré ese pedido.');
  }
  return null;
}

export function presentCashBalance(output: Record<string, unknown>): string {
  if (output.status === 'filter_blocked') {
    const ambiguous = presentToolAmbiguity('cash_account', output);
    if (ambiguous) return ambiguous;
    return String(output.message ?? 'No pude aplicar ese filtro de caja.');
  }
  const saldo = Number(output.saldo) || 0;
  const rows = Array.isArray(output.byAmbito) ? output.byAmbito : [];
  const accountName = String(output.cashAccountName ?? '').trim();
  const title = accountName ? `💰 Saldo · ${accountName}` : '💰 Saldo de caja';
  if (rows.length > 1 && !accountName) {
    const lines = rows.map((row) => {
      const item = row as { label?: string; saldo?: number };
      const amount = Number(item.saldo) || 0;
      const label = String(item.label ?? 'Caja').replace(/\*/g, '').trim();
      const formatted = `$${money(Math.abs(amount))}`;
      return `• ${label}: ${amount < 0 ? '-' : ''}${formatted}`;
    });
    lines.push(`• *Total:* $${money(saldo)}`);
    return formatWhatsappMessage({
      title,
      lines,
    });
  }
  return formatWhatsappMessage({
    title,
    lines: output.empty ? ['• Las cajas están en $0.'] : [`• Total: *$${money(saldo)}*`],
  });
}


export function presentCashIncomeSummary(output: Record<string, unknown>): string {
  if (output.status === 'filter_blocked') {
    const ambiguous = presentToolAmbiguity('cash_account', output);
    if (ambiguous) return ambiguous;
    return String(output.message ?? 'No pude aplicar ese filtro de caja.');
  }
  const accountName = String(output.cashAccountName ?? '').trim();
  const monthsRequested = Number(output.monthsRequested) || 0;
  const monthsWithIncome = Number(output.monthsWithIncome) || 0;
  const total = Number(output.totalIngresos) || 0;
  const average = Number(output.promedioMensualIngresos) || 0;
  const monthRows = Array.isArray(output.months) ? output.months : [];
  const title = accountName
    ? `💰 Ingresos de caja · ${accountName}`
    : '💰 Ingresos de caja';
  const lines: string[] = [];
  for (const row of monthRows) {
    const item = row as { label?: string; ingreso?: number };
    const label = String(item.label ?? '').trim() || 'Mes';
    lines.push(`• ${label}: $${money(Number(item.ingreso) || 0)}`);
  }
  lines.push(`• *Total (${monthsRequested} meses):* $${money(total)}`);
  lines.push(
    monthsWithIncome
      ? `• *Promedio mensual:* $${money(average)} (${monthsWithIncome} mes${monthsWithIncome === 1 ? '' : 'es'} con ingresos)`
      : '• *Promedio mensual:* sin ingresos en el período'
  );
  return formatWhatsappMessage({ title, lines });
}

function formatCashMovementWhen(fecha?: string): string {
  const raw = String(fecha ?? '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!match) return raw;
  const stamp = `${match[3]}/${match[2]}`;
  if (match[4] != null && match[5] != null) return `${stamp} ${match[4]}:${match[5]}`;
  return stamp;
}

export function presentCashMovements(output: Record<string, unknown>): string {
  if (output.status === 'filter_blocked') {
    const ambiguous = presentToolAmbiguity('cash_account', output);
    if (ambiguous) return ambiguous;
    return String(output.message ?? 'No pude aplicar ese filtro de caja.');
  }
  const items = Array.isArray(output.items) ? output.items : [];
  const accountName = String(
    output.cashAccountName ??
      (output.filter as { cashAccountName?: string } | undefined)?.cashAccountName ??
      ''
  ).trim();
  const limit = Number((output.filter as { limit?: number } | undefined)?.limit) || items.length || 10;
  const title = accountName
    ? `Últimos ${limit} movimientos · ${accountName}`
    : `Últimos ${limit} movimientos de caja`;
  const lines = items.map((row, index) => {
    const item = row as {
      type?: string;
      amount?: number;
      concept?: string;
      date?: string;
    };
    const tipo = String(item.type ?? '').toLowerCase() === 'egreso' ? 'Egreso' : 'Ingreso';
    const concept = String(item.concept ?? '').trim() || tipo;
    const when = formatCashMovementWhen(item.date);
    const head = `${index + 1}. *${tipo} $${money(Number(item.amount) || 0)}*`;
    return when ? `${head}\n${concept} · ${when}` : `${head}\n${concept}`;
  });
  return presentEntityList({
    title,
    lines,
    shown: items.length,
    total: items.length,
    hasMore: output.hasMore === true,
    emptyText: accountName
      ? `No hay movimientos en *${accountName}*.`
      : 'No hay movimientos de caja.',
    inviteAction: false,
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

function modalidadLabel(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (raw === 'fijo') return 'Fijo';
  if (raw === 'mixto') return 'Mixto';
  if (raw === 'por_hora') return 'Por hora';
  return '';
}

export function presentCollaboratorList(output: Record<string, unknown>): string {
  const items = Array.isArray(output.items) ? output.items : [];
  const lines = items.map((row, index) => {
    const item = row as { name?: string; modalidad?: string; activo?: boolean };
    const modalidad = modalidadLabel(item.modalidad);
    const suffix = modalidad ? ` · ${modalidad}` : item.activo === false ? ' · Inactivo' : '';
    return `${index + 1}. ${item.name ?? 'Colaborador'}${suffix}`;
  });
  const activeCount = Number(output.activeCount) || items.filter((row) => (row as { activo?: boolean }).activo !== false).length;
  const footer =
    activeCount > 0
      ? `${activeCount} colaborador${activeCount === 1 ? '' : 'es'} activo${activeCount === 1 ? '' : 's'}.`
      : undefined;
  return presentEntityList({
    title: 'Colaboradores',
    lines,
    shown: items.length,
    total: Number(output.total) || items.length,
    hasMore: output.hasMore === true,
    emptyText: 'No encontré colaboradores.',
    footer: footer ?? (output.footer ? String(output.footer) : undefined),
  });
}

export function presentCollaboratorDetail(output: Record<string, unknown>): string {
  const entity = (output.entity ?? {}) as Record<string, unknown>;
  const name = String(entity.name ?? 'Colaborador');
  const lines = [
    entity.telefono ? `Teléfono: ${String(entity.telefono)}` : undefined,
    entity.modalidad ? `Modalidad: ${modalidadLabel(entity.modalidad)}` : undefined,
    entity.valorHora != null ? `Valor hora: $${money(Number(entity.valorHora))}` : undefined,
    entity.email ? `Email: ${String(entity.email)}` : undefined,
    entity.activo === false ? 'Estado: inactivo' : 'Estado: activo',
  ].filter(Boolean) as string[];
  return formatWhatsappMessage({ title: name, lines });
}

export function presentCollaboratorBalance(output: Record<string, unknown>): string {
  const name = String(output.name ?? 'Colaborador');
  const lines = [
    `Importe generado: $${money(Number(output.devengadoLifetime) || 0)}`,
    `Pagos realizados: $${money(Number(output.pagadoLifetime) || 0)}`,
    `*Saldo pendiente: $${money(Number(output.saldoAcumulado) || 0)}*`,
  ];
  const valuedHours = Number(output.valuedHoursPeriodo ?? output.horasPeriodo) || 0;
  const unvaluedHours = Number(output.unvaluedHoursPeriodo ?? output.unvaluedHoursLifetime) || 0;
  if (valuedHours > 0 || unvaluedHours > 0) {
    lines.unshift(`Horas sin valorar: ${unvaluedHours} h`);
    lines.unshift(`Horas valorizadas: ${valuedHours} h`);
  }
  if (output.hasUnvaluedHours || unvaluedHours > 0) {
    lines.push(`⚠️ Hay ${Number(output.unvaluedHoursLifetime ?? unvaluedHours) || unvaluedHours} h pendientes de valoración.`);
  }
  return formatWhatsappMessage({ title: name, lines });
}

export function presentCollaboratorHoursSummary(output: Record<string, unknown>): string {
  const name = String(output.name ?? 'Colaborador');
  const period = (output.period ?? {}) as { from?: string; to?: string };
  const lines = [`Horas: ${Number(output.totalHoras) || 0} h`];
  const unvalued = Number(output.unvaluedHours) || 0;
  const valued = Number(output.valuedHours) || 0;
  if (valued > 0) lines.push(`Horas valorizadas: ${valued} h`);
  if (unvalued > 0) lines.push(`Horas sin valorar: ${unvalued} h`);
  if (Number(output.montoHoras) > 0) {
    lines.push(`Generado: $${money(Number(output.montoHoras))}`);
  } else if (unvalued > 0) {
    lines.push('Importe: Sin valorar');
  }
  const title = period.from && period.to ? `${name} · ${period.from} → ${period.to}` : name;
  return formatWhatsappMessage({ title, lines });
}

export function presentCollaboratorAccountSummary(output: Record<string, unknown>): string {
  const name = String(output.name ?? 'Colaborador');
  const period = (output.period ?? {}) as { from?: string; to?: string };
  const title = period.from ? `${name} · ${String(period.from).slice(0, 7)}` : name;
  const horasSinValorar = Number(output.horasSinValorar) || 0;
  const lines = [
    `Horas: ${Number(output.horas) || 0} h`,
    ...(horasSinValorar > 0 ? [`Horas sin valorar: ${horasSinValorar} h`] : []),
    `Generado: $${money(Number(output.devengado) || 0)}`,
    `Pagado: $${money(Number(output.pagado) || 0)}`,
    `*Saldo: $${money(Number(output.saldoAcumulado) || 0)}*`,
  ];
  if (horasSinValorar > 0) {
    lines.push(`⚠️ Hay ${horasSinValorar} h pendientes de valoración.`);
  }
  const movements = Array.isArray(output.recentMovements) ? output.recentMovements : [];
  if (movements.length) {
    lines.push('');
    lines.push('Últimos movimientos:');
    for (const row of movements.slice(0, 8)) {
      const mov = row as { fecha?: string; tipo?: string; horas?: number; monto?: number; unvalued?: boolean };
      const day = String(mov.fecha ?? '').slice(0, 10);
      if (mov.tipo === 'horas') {
        lines.push(
          mov.unvalued
            ? `• ${day} · +${mov.horas ?? 0} h (sin valorar)`
            : `• ${day} · +${mov.horas ?? 0} h`
        );
      } else if (mov.tipo === 'pago') lines.push(`• ${day} · Pago $${money(Number(mov.monto) || 0)}`);
      else lines.push(`• ${day} · $${money(Number(mov.monto) || 0)}`);
    }
  }
  return formatWhatsappMessage({ title, lines });
}

export function presentAmbiguousEntity(message: string, candidates: unknown[]): string {
  return presentNumberedCandidateSelection('client', candidates, message);
}

export function presentToolAmbiguity(
  entityType: CandidateSelectionEntityType,
  output: Record<string, unknown>
): string | null {
  const candidates = output.candidates;
  if (!Array.isArray(candidates) || candidates.length < 2) return null;
  const ambiguous =
    output.status === 'ambiguous' ||
    output.errorCode === 'ENTITY_AMBIGUOUS' ||
    (output.status === 'filter_blocked' && output.errorCode === 'ENTITY_AMBIGUOUS');
  if (!ambiguous) return null;
  const title = output.title ? String(output.title).replace(/\.$/, '') : undefined;
  return presentNumberedCandidateSelection(entityType, candidates, title);
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

/** Deuda del cliente: solo comprobantes con saldo, ítem por ítem + total. */
export function presentClientBalanceFromToolOutput(output: Record<string, unknown>): string {
  const clientName = String(output.clientName ?? '').trim();
  const balance = Number(output.balance) || 0;
  const pending = Array.isArray(output.pending) ? output.pending : [];
  const header = clientName
    ? `*${clientName}* debe $${money(balance)} en total.`
    : `*Saldo pendiente:* $${money(balance)}.`;

  if (!pending.length) {
    return compactWhatsappText(
      balance > 0
        ? `${header}\n\nNo encontré el detalle de comprobantes.`
        : `${header}\n\nNo tiene saldos pendientes.`
    );
  }

  const blocks = pending.map((row, index) => {
    const item = row as Record<string, unknown>;
    const label = String(item.label ?? '').trim() || `Comprobante ${index + 1}`;
    const dateRaw = String(item.date ?? '').trim();
    const date = dateRaw ? formatDateOnlyEs(dateRaw) || dateRaw : '';
    const title = date ? `*${index + 1}. ${label}* · ${date}` : `*${index + 1}. ${label}*`;
    const lines = [title];
    const lineItems = Array.isArray(item.items) ? item.items : [];
    if (lineItems.length) {
      for (const line of lineItems) {
        const rowLine = line as { name?: string; quantity?: number };
        const qty = Number(rowLine.quantity) || 0;
        const qtyPrefix = qty > 1 ? `${qty} × ` : '';
        lines.push(`• ${qtyPrefix}${String(rowLine.name ?? 'Ítem').trim()}`);
      }
    } else {
      const detail = String(item.detail ?? '').trim();
      if (detail) lines.push(`• ${detail}`);
    }
    lines.push(`Pendiente: $${money(Number(item.balance) || 0)}`);
    return lines.join('\n');
  });

  return compactWhatsappText(`${header}\n\n${blocks.join('\n\n')}\n\n*Total pendiente: $${money(balance)}*`);
}

export function presentStock(output: Record<string, unknown>): string {
  const name = String(output.name ?? 'Producto');
  const stock = Number(output.stock) || 0;
  return formatWhatsappMessage({
    title: name,
    lines: [`Stock actual: ${waBold(String(stock))}`],
  });
}
