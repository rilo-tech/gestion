/**
 * Lógica pura de ajuste de stock (validación) — usada por tests y documentada
 * como el núcleo de la transacción Firestore en adjustStock.
 */
export function assertCanApplyStockDelta(params: {
  exists: boolean;
  controlsStock: boolean;
  currentStock: number;
  quantity: number;
  permitsNegative: boolean;
}): number {
  const quantity = Number(params.quantity) || 0;
  if (!params.exists) throw new Error('No encontré ese producto.');
  if (!quantity) throw new Error('Indicá producto y cantidad.');
  if (!params.controlsStock) throw new Error('Este producto no controla stock físico.');
  const next = (Number(params.currentStock) || 0) + quantity;
  if (quantity < 0 && !params.permitsNegative && next < 0) {
    throw new Error('No hay stock disponible para descontar.');
  }
  return next;
}

/** Simula idempotencia + aplicación secuencial (como la transaction). */
export function applyStockOpsInMemory(
  initialStock: number,
  ops: Array<{ quantity: number; scanOperationId?: string }>,
  opts?: { controlsStock?: boolean; permitsNegative?: boolean }
): { stock: number; appliedCount: number } {
  const seen = new Set<string>();
  let stock = initialStock;
  let appliedCount = 0;
  for (const op of ops) {
    if (op.scanOperationId && seen.has(op.scanOperationId)) continue;
    stock = assertCanApplyStockDelta({
      exists: true,
      controlsStock: opts?.controlsStock !== false,
      currentStock: stock,
      quantity: op.quantity,
      permitsNegative: opts?.permitsNegative === true,
    });
    if (op.scanOperationId) seen.add(op.scanOperationId);
    appliedCount += 1;
  }
  return { stock, appliedCount };
}
