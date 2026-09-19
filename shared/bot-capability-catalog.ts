/**
 * Catálogo de sincronización help ↔ tools operacionales.
 * NO decide disponibilidad: solo declara qué tools respaldan cada sección de ayuda
 * y qué capacidades conocidas NO están operativas por WhatsApp.
 */
import type { BotHelpSectionId } from './bot-help-catalog.ts';

/** Tools operacionales que respaldan cada sección de help (al menos una debe existir). */
export const HELP_SECTION_OPERATIONAL_TOOLS: Record<BotHelpSectionId, readonly string[]> = {
  cash: [
    'get_cash_balance',
    'list_cash_movements',
    'get_cash_income_summary',
    'get_cash_wallet_summary',
    'register_cash_movement',
  ],
  cash_income: ['register_cash_movement'],
  cash_expense: ['register_cash_movement'],
  cash_balance: ['get_cash_balance', 'get_cash_income_summary', 'get_cash_wallet_summary'],
  cash_movements: ['list_cash_movements'],
  sales: ['create_sale'],
  orders: [
    'create_order',
    'find_order',
    'get_order',
    'list_orders',
    'get_order_balance',
    'update_order_status',
    'register_order_payment',
    'register_order_deposit',
    'collect_order_full_balance',
    'add_order_extra_cost',
  ],
  catalog_stock: [
    'find_product',
    'get_product',
    'list_products',
    'get_stock',
    'create_product',
    'update_product_price',
    'update_product_cost',
    'rename_products',
    'adjust_stock',
    'set_stock',
    'preview_rename_product',
  ],
  services: ['find_product', 'get_product', 'list_products', 'create_product', 'update_product_price'],
  purchases: [
    'create_purchase',
    'ingest_visual_document',
    'patch_visual_draft',
    'prepare_visual_draft_write',
  ],
  clients: [
    'find_client',
    'get_client',
    'list_clients',
    'get_client_balance',
    'create_client',
    'update_client',
  ],
  suppliers: [
    'find_supplier',
    'get_supplier',
    'list_suppliers',
    'create_supplier',
    'update_supplier',
  ],
  collaborators: [
    'find_collaborator',
    'get_collaborator',
    'list_collaborators',
    'list_collaborator_hours',
    'get_collaborator_hours_summary',
    'get_collaborator_balance',
    'list_collaborator_payments',
    'get_collaborator_account_summary',
    'create_collaborator',
    'update_collaborator',
    'register_collaborator_hours',
    'register_collaborator_extra',
    'register_collaborator_payment',
    'update_collaborator_movement',
  ],
  payables: ['create_recurring_payable'],
  automations: [
    'list_available_automation_actions',
    'list_automations',
    'get_automation',
    'prepare_create_automation',
    'prepare_update_automation',
    'prepare_pause_automation',
    'prepare_resume_automation',
    'prepare_cancel_automation',
  ],
};

/**
 * Capacidades conocidas que NO deben publicitarse como ejecutables por WhatsApp
 * mientras no tengan tool operacional (sin requiresDomainAdapter).
 */
export type KnownUnavailableCapability = {
  id: string;
  /** Tool name if defined but adapter-gated, else null. */
  toolName: string | null;
  reason: 'requires_adapter' | 'not_implemented';
  /** Frase corta para el agente (español rioplatense, sin tecnicismos). */
  userHint: string;
};

export const KNOWN_UNAVAILABLE_CAPABILITIES: readonly KnownUnavailableCapability[] = [
  {
    id: 'query_supplier_balance',
    toolName: 'get_supplier_balance',
    reason: 'requires_adapter',
    userHint:
      'Todavía no puedo consultar la deuda con proveedores por WhatsApp. Sí puedo buscar proveedores y registrar compras. Esa consulta está en RILO Gestión.',
  },
  {
    id: 'register_supplier_payment',
    toolName: null,
    reason: 'not_implemented',
    userHint:
      'Todavía no puedo registrar pagos a proveedores por WhatsApp. Podés hacerlo desde RILO Gestión.',
  },
  {
    id: 'query_sales_list',
    toolName: 'list_sales',
    reason: 'requires_adapter',
    userHint:
      'Todavía no listo el historial de ventas por WhatsApp. Sí puedo registrar una venta nueva. El historial lo ves en RILO Gestión.',
  },
  {
    id: 'aggregate_sales',
    toolName: 'aggregate_sales',
    reason: 'requires_adapter',
    userHint:
      'Todavía no armo totales de ventas por período por WhatsApp. Sí puedo decirte ingresos de caja (por ejemplo cuánto entró hoy o este mes).',
  },
  {
    id: 'query_purchases_list',
    toolName: 'list_purchases',
    reason: 'requires_adapter',
    userHint:
      'Todavía no listo compras históricas por WhatsApp. Sí puedo registrar una compra o leer una foto de remito/factura.',
  },
  {
    id: 'remove_order_item',
    toolName: null,
    reason: 'not_implemented',
    userHint:
      'Todavía no puedo borrar un ítem de un pedido ya guardado por WhatsApp. Podés editarlo desde RILO Gestión.',
  },
  {
    id: 'add_order_item_saved',
    toolName: null,
    reason: 'not_implemented',
    userHint:
      'Todavía no agrego ítems a un pedido ya guardado por WhatsApp. Sí puedo crear un pedido nuevo o editarlo en RILO Gestión.',
  },
];

/** Ejemplos de landing/carrusel que requieren tools operativas (todas o cualquiera). */
export const LANDING_USE_CASE_REQUIRED_TOOLS: Record<
  string,
  { anyOf: readonly string[]; label: string; example: string; category: string }
> = {
  sale: {
    anyOf: ['create_sale'],
    label: 'VENTA',
    example: 'Vendí 2 remeras a Ana por $1.600.',
    category: 'sales',
  },
  order: {
    anyOf: ['create_order'],
    label: 'PEDIDO',
    example: 'Pedido para Martín: 3 buzos para el viernes.',
    category: 'orders',
  },
  collect: {
    anyOf: ['register_order_payment', 'collect_order_full_balance'],
    label: 'COBRO',
    example: 'Lucía pagó $1.000.',
    category: 'orders',
  },
  client_balance: {
    anyOf: ['get_client_balance'],
    label: 'CLIENTE',
    example: '¿Cuánto debe Pedro?',
    category: 'clients',
  },
  cash_today: {
    anyOf: ['get_cash_income_summary', 'get_cash_balance', 'list_cash_movements'],
    label: 'CAJA',
    example: '¿Cuánto vendí hoy?',
    category: 'cash',
  },
  stock: {
    anyOf: ['get_stock'],
    label: 'STOCK',
    example: '¿Cuántas camisetas negras M quedan?',
    category: 'catalog_stock',
  },
};

export function helpSectionHasOperationalTool(
  sectionId: BotHelpSectionId,
  availableToolNames: ReadonlySet<string> | readonly string[]
): boolean {
  const set =
    availableToolNames instanceof Set
      ? availableToolNames
      : new Set(availableToolNames);
  const required = HELP_SECTION_OPERATIONAL_TOOLS[sectionId] ?? [];
  return required.some((name) => set.has(name));
}

export function filterLandingUseCases(
  availableToolNames: ReadonlySet<string> | readonly string[]
): Array<{ id: string; label: string; example: string; category: string }> {
  const set =
    availableToolNames instanceof Set
      ? availableToolNames
      : new Set(availableToolNames);
  return Object.entries(LANDING_USE_CASE_REQUIRED_TOOLS)
    .filter(([, spec]) => spec.anyOf.some((t) => set.has(t)))
    .map(([id, spec]) => ({
      id,
      label: spec.label,
      example: spec.example,
      category: spec.category,
    }));
}
