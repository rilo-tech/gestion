import type { ConversationState } from './conversation-state.ts';
import { V4_CANDIDATE_SELECTION_PROMPT } from './v4-ui-copy.ts';

/** Protocolo de UI conversacional — no interpreta negocio, solo resuelve opciones numeradas. */
export type CandidateSelectionEntityType = 'client' | 'product' | 'supplier' | 'order';

export type CandidateSelectionOption = {
  index: number;
  entityId: string;
  label: string;
  meta?: Record<string, unknown>;
};

export type CandidateSelectionResume = {
  /** Texto original del usuario cuando se bloqueó la operación. */
  originalUserText: string;
  /** Tool que quedó pendiente de ejecutar tras resolver la entidad. */
  blockedTool?: string;
  blockedArgs?: Record<string, unknown>;
  sourceTool?: string;
};

export type CandidateSelectionAwaiting = {
  type: 'candidate_selection';
  entityType: CandidateSelectionEntityType;
  options: CandidateSelectionOption[];
  resume: CandidateSelectionResume;
};


export const CANDIDATE_SELECTION_PROMPT = V4_CANDIDATE_SELECTION_PROMPT;

export const V4_CANDIDATE_SELECTION_INTENT = 'awaiting:candidate_selection';

export function isExactNumericOnly(text: string): boolean {
  return /^\d{1,2}$/.test(String(text ?? '').trim());
}

/** Número exacto opcionalmente seguido de semántica adicional ("2, solo los pendientes"). */
export function parseNumericSelectionTurn(text: string): { index?: number; remainder?: string } {
  const raw = String(text ?? '').trim();
  if (!raw) return {};

  const commaMatch = raw.match(/^(\d{1,2})\s*[,;]\s*(.+)$/);
  if (commaMatch) {
    return { index: Number(commaMatch[1]), remainder: commaMatch[2]!.trim() };
  }

  const spaceMatch = raw.match(/^(\d{1,2})\s+(.+)$/);
  if (spaceMatch) {
    return { index: Number(spaceMatch[1]), remainder: spaceMatch[2]!.trim() };
  }

  if (/^\d{1,2}$/.test(raw)) {
    return { index: Number(raw) };
  }

  return {};
}

export function getCandidateSelectionAwaiting(
  state: ConversationState | null | undefined
): CandidateSelectionAwaiting | null {
  if (state?.pendingIntent !== V4_CANDIDATE_SELECTION_INTENT) return null;
  const payload = state.pendingPayload?.candidateSelection;
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as CandidateSelectionAwaiting;
  if (row.type !== 'candidate_selection' || !Array.isArray(row.options) || !row.options.length) {
    return null;
  }
  return row;
}

export function normalizeCandidateRows(
  entityType: CandidateSelectionEntityType,
  rows: unknown[],
  max = 5
): CandidateSelectionOption[] {
  const options: CandidateSelectionOption[] = [];
  for (const [idx, row] of rows.slice(0, max).entries()) {
    const item = row as Record<string, unknown>;
    const entityId = String(item.id ?? item.entityId ?? item.clientId ?? item.productId ?? '').trim();
    if (!entityId) continue;
    const label = formatCandidateLabel(entityType, item);
    options.push({ index: idx + 1, entityId, label, meta: item });
  }
  return options;
}

function formatCandidateLabel(entityType: CandidateSelectionEntityType, item: Record<string, unknown>): string {
  if (entityType === 'order') {
    const bits = [
      `#${String(item.number ?? item.label ?? item.id ?? '')}`,
      String(item.deliveryDate ?? item.createdAt ?? '').slice(0, 10) || undefined,
      String(item.statusLabel ?? item.status ?? '').trim() || undefined,
      item.total != null ? `$${Number(item.total).toLocaleString('es-AR')}` : undefined,
    ].filter(Boolean);
    return bits.join(' · ');
  }
  if (entityType === 'product') {
    const bits = [
      String(item.name ?? item.nombre ?? 'Producto'),
      String(item.color ?? item.variant ?? '').trim() || undefined,
      String(item.size ?? item.talle ?? '').trim() || undefined,
    ].filter(Boolean);
    return bits.join(' · ');
  }
  const name = String(item.name ?? item.nombre ?? 'Opción').trim();
  const phone = String(item.telefono ?? item.phone ?? '').trim();
  const hint = String(item.local ?? item.ciudad ?? item.empresa ?? item.rubro ?? '').trim();
  const extras = [phone, hint].filter(Boolean);
  return extras.length ? `${name} · ${extras.join(' · ')}` : name;
}

export function buildCandidateSelectionState(input: {
  entityType: CandidateSelectionEntityType;
  options: CandidateSelectionOption[];
  resume: CandidateSelectionResume;
}): Partial<ConversationState> {
  const awaiting: CandidateSelectionAwaiting = {
    type: 'candidate_selection',
    entityType: input.entityType,
    options: input.options,
    resume: input.resume,
  };
  return {
    pendingIntent: V4_CANDIDATE_SELECTION_INTENT,
    pendingPayload: { candidateSelection: awaiting },
    pendingPrompt: V4_CANDIDATE_SELECTION_PROMPT,
    activeTask: {
      intent: V4_CANDIDATE_SELECTION_INTENT,
      awaiting: { field: 'selection', type: 'candidate_selection', reason: input.entityType },
    },
  };
}

export type CandidateSelectionResolution =
  | { kind: 'selected'; option: CandidateSelectionOption; remainder?: string }
  | { kind: 'invalid'; max: number }
  | { kind: 'not_applicable' };

export function resolveCandidateSelectionTurn(
  text: string,
  awaiting: CandidateSelectionAwaiting
): CandidateSelectionResolution {
  const parsed = parseNumericSelectionTurn(text);
  if (parsed.index == null) return { kind: 'not_applicable' };

  const option = awaiting.options.find((row) => row.index === parsed.index);
  if (!option) {
    return { kind: 'invalid', max: awaiting.options.length };
  }

  return { kind: 'selected', option, remainder: parsed.remainder };
}

export function focusPatchFromCandidate(
  entityType: CandidateSelectionEntityType,
  option: CandidateSelectionOption,
  previous?: ConversationState['focusEntities']
): ConversationState['focusEntities'] {
  const base = { ...(previous ?? {}) };
  if (entityType === 'client') {
    base.client = { id: option.entityId, name: option.label.split(' · ')[0], locked: true };
  } else if (entityType === 'product') {
    base.product = { id: option.entityId, name: option.label.split(' · ')[0], locked: true };
  } else if (entityType === 'supplier') {
    base.supplier = { id: option.entityId, name: option.label.split(' · ')[0], locked: true };
  } else if (entityType === 'order') {
    const meta = option.meta ?? {};
    base.order = {
      id: option.entityId,
      label: String(meta.number ?? option.label.replace(/^#/, '').split(' · ')[0] ?? ''),
      clientName: String(meta.clientName ?? ''),
      status: String(meta.status ?? ''),
      locked: true,
    };
  }
  return base;
}

export function inferEntityTypeFromTool(toolName: string): CandidateSelectionEntityType {
  if (toolName.includes('client')) return 'client';
  if (toolName.includes('product') || toolName.includes('stock')) return 'product';
  if (toolName.includes('supplier')) return 'supplier';
  if (toolName.includes('order')) return 'order';
  return 'client';
}

export function ambiguousPayloadFromToolOutput(
  toolName: string,
  output: Record<string, unknown>,
  ctx: { originalUserText: string; blockedArgs?: Record<string, unknown> }
): CandidateSelectionAwaiting | null {
  const candidates = Array.isArray(output.candidates) ? output.candidates : [];
  if (!candidates.length) return null;

  const entityType = inferEntityTypeFromToolOutput(toolName, output);
  const options = normalizeCandidateRows(entityType, candidates);
  if (!options.length) return null;

  return {
    type: 'candidate_selection',
    entityType,
    options,
    resume: {
      originalUserText: ctx.originalUserText,
      blockedTool: toolName,
      blockedArgs: ctx.blockedArgs,
      sourceTool: toolName,
    },
  };
}

function inferEntityTypeFromToolOutput(
  toolName: string,
  output: Record<string, unknown>
): CandidateSelectionEntityType {
  const filter = (output.filter ?? {}) as Record<string, unknown>;
  if (filter.clientQuery || toolName.includes('client')) return 'client';
  if (filter.productQuery || toolName.includes('product')) return 'product';
  if (filter.supplierQuery || toolName.includes('supplier')) return 'supplier';
  if (toolName.includes('order')) return 'order';
  return inferEntityTypeFromTool(toolName);
}
