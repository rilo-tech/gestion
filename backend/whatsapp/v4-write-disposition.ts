import type { AgentOperationPlan } from './agent/tool-types.ts';

/**
 * Decisión centralizada de ejecución de writes V4 — ANTES de mutar el ERP.
 *
 * Única fuente de verdad para auto-commit vs confirmación.
 * Presentación post-ejecución: `v4-auto-commit.ts` (no redefinir la decisión allí).
 *
 * - EXECUTE_DIRECTLY: instrucción clara + bajo riesgo → ejecutar ya.
 * - NEEDS_CLARIFICATION: falta dato / ambigüedad → preguntar (prepare/read, no plan listo).
 * - NEEDS_CONFIRMATION: acción sensible → congelar plan, ¿Confirmo?.
 *
 * Permisos/plan/capabilities se validan aparte (tool-registry + executor), no aquí.
 */
export type WriteDisposition = 'EXECUTE_DIRECTLY' | 'NEEDS_CLARIFICATION' | 'NEEDS_CONFIRMATION';

export type PreparedWriteDisposition = Exclude<WriteDisposition, 'NEEDS_CLARIFICATION'>;

/**
 * Writes de bajo riesgo / fácilmente corregibles: con IDs y args resueltos se ejecutan al instante.
 */
export const EXECUTE_DIRECTLY_WRITE_TOOLS = new Set([
  'rename_products',
  'create_client',
  'update_client',
  'create_product',
  'create_supplier',
  'update_supplier',
  'create_collaborator',
  'update_collaborator',
  'register_collaborator_hours',
  'register_collaborator_extra',
  'update_collaborator_movement',
  'prepare_create_automation',
  'prepare_update_automation',
  'prepare_resume_automation',
]);

/**
 * Writes sensibles o difíciles de revertir: requieren confirmación explícita.
 */
export const NEEDS_CONFIRMATION_WRITE_TOOLS = new Set([
  'update_product_price',
  'update_product_cost',
  'adjust_stock',
  'set_stock',
  'register_order_payment',
  'register_order_deposit',
  'collect_order_full_balance',
  'update_order_status',
  'register_cash_movement',
  'create_recurring_payable',
  'register_collaborator_payment',
  'create_order',
  'create_sale',
  'create_purchase',
  'add_order_extra_cost',
  'prepare_visual_draft_write',
  'prepare_pause_automation',
  'prepare_cancel_automation',
]);

/** @deprecated Prefer EXECUTE_DIRECTLY_WRITE_TOOLS — alias de compatibilidad. */
export const AUTO_COMMIT_WRITE_TOOLS = EXECUTE_DIRECTLY_WRITE_TOOLS;

export function writeToolDisposition(tool: string): PreparedWriteDisposition {
  const name = String(tool ?? '').trim();
  if (EXECUTE_DIRECTLY_WRITE_TOOLS.has(name)) return 'EXECUTE_DIRECTLY';
  if (NEEDS_CONFIRMATION_WRITE_TOOLS.has(name)) return 'NEEDS_CONFIRMATION';
  // Desconocido → confirmar (seguro por defecto).
  return 'NEEDS_CONFIRMATION';
}

export function writeToolAllowsAutoCommit(tool: string): boolean {
  return writeToolDisposition(tool) === 'EXECUTE_DIRECTLY';
}

/**
 * Clasifica un OperationPlan ya preparado (args resueltos, listo para ERP).
 * Si mezcla tools, cualquier write sensible fuerza NEEDS_CONFIRMATION.
 */
export function classifyPreparedPlan(
  plan: AgentOperationPlan | null | undefined
): PreparedWriteDisposition | null {
  if (!plan?.writes?.length) return null;
  const anySensitive = plan.writes.some(
    (row) => writeToolDisposition(row.tool) === 'NEEDS_CONFIRMATION'
  );
  return anySensitive ? 'NEEDS_CONFIRMATION' : 'EXECUTE_DIRECTLY';
}

/** API canónica: ¿el plan preparado se puede ejecutar sin ¿Confirmo?? */
export function planAllowsAutoCommit(plan: AgentOperationPlan | null | undefined): boolean {
  return classifyPreparedPlan(plan) === 'EXECUTE_DIRECTLY';
}

export function planNeedsConfirmation(plan: AgentOperationPlan | null | undefined): boolean {
  return classifyPreparedPlan(plan) === 'NEEDS_CONFIRMATION';
}

/** Alias explícito de la puerta de auto-commit (misma lógica que planAllowsAutoCommit). */
export function decidePreparedWriteExecution(
  plan: AgentOperationPlan | null | undefined
): PreparedWriteDisposition | null {
  return classifyPreparedPlan(plan);
}
