/**
 * Tools WRITE que cuentan como "operación de negocio" completada vía RILO Bot.
 * Una ejecución exitosa de plan (executeFrozenV4Plan) = 1 operación si incluye
 * al menos una de estas tools.
 */
export const BOT_BUSINESS_WRITE_TOOLS = new Set<string>([
  'create_client',
  'update_client',
  'create_product',
  'update_product_price',
  'update_product_cost',
  'rename_products',
  'adjust_stock',
  'set_stock',
  'register_order_payment',
  'register_order_deposit',
  'collect_order_full_balance',
  'update_order_status',
  'register_cash_movement',
  'create_recurring_payable',
  'create_supplier',
  'update_supplier',
  'create_collaborator',
  'update_collaborator',
  'register_collaborator_hours',
  'register_collaborator_extra',
  'register_collaborator_payment',
  'update_collaborator_movement',
  'create_order',
  'create_sale',
  'create_purchase',
  'add_order_extra_cost',
  'prepare_visual_draft_write',
  'prepare_create_automation',
  'prepare_update_automation',
  'prepare_pause_automation',
  'prepare_resume_automation',
  'prepare_cancel_automation',
]);

export function planCountsAsBusinessOperation(tools: readonly string[]): boolean {
  return tools.some((name) => BOT_BUSINESS_WRITE_TOOLS.has(String(name ?? '').trim()));
}
