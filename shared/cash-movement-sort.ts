export type CashMovementSortable = {
  fecha?: unknown;
  createdAt?: unknown;
  id?: unknown;
};

export function resolveCashMovementSortTime(movement: CashMovementSortable): number {
  const created = Date.parse(String(movement.createdAt ?? ''));
  if (!Number.isNaN(created)) return created;

  const fecha = Date.parse(String(movement.fecha ?? ''));
  if (!Number.isNaN(fecha)) return fecha;

  return 0;
}

/** Más reciente primero (para grillas de caja). */
export function sortCashMovementsByRecency<T extends CashMovementSortable>(
  movements: T[]
): T[] {
  return [...movements].sort((a, b) => {
    const timeA = resolveCashMovementSortTime(a);
    const timeB = resolveCashMovementSortTime(b);
    if (timeB !== timeA) return timeB - timeA;
    return String(b.id ?? '').localeCompare(String(a.id ?? ''));
  });
}
