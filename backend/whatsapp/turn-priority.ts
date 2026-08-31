/**
 * Prioridad de slots: turno actual explícito > contexto > default.
 * No lee rawMessage.
 */

export function hasExplicitValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

export function preferTurn<T>(turn: T | undefined | null, context: T | undefined | null): T | null | undefined {
  return hasExplicitValue(turn) ? turn : context;
}

export function isQueryRefinement(input: {
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  dateToken?: string | null;
  page?: string | null;
  requestAll?: boolean | null;
  limit?: number | null;
}): boolean {
  return Boolean(
    input.status ||
      input.dateFrom ||
      input.dateTo ||
      input.dateToken ||
      String(input.page ?? '') === 'next' ||
      input.requestAll === true ||
      (input.limit != null && Number(input.limit) > 0)
  );
}

export function isFreshListQuery(input: {
  listOrders?: boolean | null;
  entity?: string | null;
  metric?: string | null;
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  dateToken?: string | null;
  page?: string | null;
  requestAll?: boolean | null;
}): boolean {
  const collection =
    input.listOrders === true ||
    String(input.entity ?? '') === 'orders' ||
    String(input.entity ?? '') === 'sales' ||
    String(input.metric ?? '') === 'list' ||
    String(input.metric ?? '') === 'count';
  if (!collection) return false;
  return !isQueryRefinement(input);
}
