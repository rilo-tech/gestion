import type { WhatsappIntent } from './ai-command-parser.ts';

export type CapabilityErpStatus = 'wired' | 'partial' | 'requires_adapter' | 'not_in_erp';

export type LinguisticCapability = {
  id: string;
  /** Intent canónico del parser, o el más cercano si aún no hay intent propio. */
  mapsTo: WhatsappIntent;
  erp: CapabilityErpStatus;
  notes: string;
};

/**
 * Capacidades lingüísticas (legacy Gemini + menú help).
 * El Agent V4 NO usa esto para exponer tools: la fuente de verdad es
 * WRITE_TOOLS / READ_TOOLS + handlers (`agent/tool-registry.ts`).
 * Mantener alineado para no marcar como unwired acciones ya implementadas.
 */
export const LINGUISTIC_CAPABILITIES: LinguisticCapability[] = [
  { id: 'create_order', mapsTo: 'create_order', erp: 'wired', notes: 'erp-writes createOrderFromWhatsapp' },
  { id: 'query_orders', mapsTo: 'query_status', erp: 'wired', notes: 'query.entity=orders metric=list|count' },
  { id: 'query_order', mapsTo: 'query_status', erp: 'wired', notes: 'un pedido: #, foco, metric details|status|balance' },
  { id: 'update_order_status', mapsTo: 'update_order_status', erp: 'wired', notes: 'estados del negocio' },
  { id: 'add_order_item', mapsTo: 'create_order', erp: 'partial', notes: 'corrections/items sobre pedido en curso; no PATCH de pedido guardado' },
  { id: 'update_order_item', mapsTo: 'create_order', erp: 'partial', notes: 'correct_current itemKey' },
  { id: 'remove_order_item', mapsTo: 'unknown', erp: 'requires_adapter', notes: 'no hay Domain Service WhatsApp' },
  { id: 'register_order_deposit', mapsTo: 'register_payment', erp: 'wired', notes: 'payment.kind=senia' },
  { id: 'register_order_payment', mapsTo: 'register_payment', erp: 'wired', notes: 'amount parcial' },
  { id: 'collect_order_full_balance', mapsTo: 'register_payment', erp: 'wired', notes: 'payment.fullBalance; ERP calcula saldo' },
  { id: 'query_order_balance', mapsTo: 'query_status', erp: 'wired', notes: 'query.metric=balance' },
  { id: 'query_client_balance', mapsTo: 'query_balance', erp: 'wired', notes: '' },
  { id: 'create_client', mapsTo: 'create_client', erp: 'wired', notes: 'nombre + teléfono opcional' },
  { id: 'query_client', mapsTo: 'unknown', erp: 'wired', notes: 'find/list/get client V4' },
  { id: 'update_client', mapsTo: 'unknown', erp: 'wired', notes: 'update_client write tool' },
  { id: 'create_product', mapsTo: 'unknown', erp: 'wired', notes: 'create_product write tool' },
  { id: 'query_product', mapsTo: 'unknown', erp: 'wired', notes: 'find/list product V4' },
  { id: 'rename_products', mapsTo: 'unknown', erp: 'wired', notes: 'rename_products + preview_rename_product' },
  { id: 'update_product_cost', mapsTo: 'update_product_cost', erp: 'wired', notes: '' },
  { id: 'update_product_price', mapsTo: 'unknown', erp: 'wired', notes: 'update_product_price write tool' },
  { id: 'query_stock', mapsTo: 'query_stock', erp: 'wired', notes: '' },
  { id: 'adjust_stock', mapsTo: 'unknown', erp: 'wired', notes: 'adjust_stock write tool' },
  { id: 'set_stock', mapsTo: 'unknown', erp: 'wired', notes: 'set_stock write tool' },
  { id: 'register_cash', mapsTo: 'register_cash', erp: 'wired', notes: 'ingreso|egreso domain/cash' },
  { id: 'query_cash', mapsTo: 'query_cash', erp: 'wired', notes: 'saldo / día / movimientos / ingresos mensuales + promedio' },
  { id: 'create_sale', mapsTo: 'create_sale', erp: 'wired', notes: '' },
  { id: 'query_sales', mapsTo: 'query_status', erp: 'partial', notes: 'entity=sales; listado pedidos/ventas mixto' },
  { id: 'aggregate_sales', mapsTo: 'query_status', erp: 'partial', notes: 'promedio/ingresos mensuales vía get_cash_income_summary' },
  { id: 'create_purchase', mapsTo: 'create_purchase', erp: 'wired', notes: 'stock in, sin caja' },
  { id: 'query_purchases', mapsTo: 'unknown', erp: 'requires_adapter', notes: 'list_purchases aún requiresDomainAdapter' },
  { id: 'create_supplier', mapsTo: 'unknown', erp: 'wired', notes: 'create_supplier write tool' },
  { id: 'update_supplier', mapsTo: 'unknown', erp: 'wired', notes: 'update_supplier write tool' },
  { id: 'query_supplier', mapsTo: 'unknown', erp: 'wired', notes: 'find/list/get supplier V4' },
  { id: 'query_supplier_balance', mapsTo: 'unknown', erp: 'requires_adapter', notes: '' },
  { id: 'register_supplier_payment', mapsTo: 'unknown', erp: 'requires_adapter', notes: '' },
  { id: 'create_payable', mapsTo: 'unknown', erp: 'wired', notes: 'create_recurring_payable + create_one_time_payable → createPayable' },
  { id: 'query_payables', mapsTo: 'unknown', erp: 'wired', notes: 'query_payables read tool' },
  { id: 'pay_payable', mapsTo: 'unknown', erp: 'wired', notes: 'pay_payable → payPayable / setPayableInstallmentPaid' },
  { id: 'create_visual_document', mapsTo: 'create_purchase', erp: 'partial', notes: 'prepare_visual_draft_write' },
  { id: 'add_order_extra_cost', mapsTo: 'register_cost', erp: 'wired', notes: '' },
  { id: 'query_collaborators', mapsTo: 'unknown', erp: 'wired', notes: 'list/find/get colaboradores ERP' },
  { id: 'query_collaborator_hours', mapsTo: 'unknown', erp: 'wired', notes: 'horas por período / resumen' },
  { id: 'query_collaborator_balance', mapsTo: 'unknown', erp: 'wired', notes: 'saldo acumulado ERP' },
  { id: 'query_collaborator_account', mapsTo: 'unknown', erp: 'wired', notes: 'cuenta + movimientos ERP' },
  { id: 'register_collaborator_hours', mapsTo: 'unknown', erp: 'wired', notes: 'movimiento tipo horas' },
  { id: 'register_collaborator_extra', mapsTo: 'unknown', erp: 'wired', notes: 'movimiento tipo extra' },
  { id: 'register_collaborator_payment', mapsTo: 'unknown', erp: 'wired', notes: 'movimiento tipo pago + caja ERP' },
  { id: 'update_collaborator_movement', mapsTo: 'unknown', erp: 'wired', notes: 'PATCH movimiento colaborador' },
  { id: 'create_collaborator', mapsTo: 'unknown', erp: 'wired', notes: 'alta colaborador; requiere módulo + permiso' },
  { id: 'update_collaborator', mapsTo: 'unknown', erp: 'wired', notes: 'PATCH colaborador; activo=false desactiva' },
  { id: 'automations', mapsTo: 'unknown', erp: 'wired', notes: 'módulo automations' },
  { id: 'recent_operation', mapsTo: 'unknown', erp: 'wired', notes: 'get_recent_operation_records' },
  { id: 'show_guide', mapsTo: 'help', erp: 'wired', notes: '' },
  { id: 'how_to', mapsTo: 'how_to', erp: 'wired', notes: '' },
  { id: 'capability_question', mapsTo: 'capability_question', erp: 'wired', notes: '' },
];

const ALIAS_TO_INTENT: Record<string, WhatsappIntent> = {
  query_status: 'query_status',
  query_orders: 'query_status',
  query_order_list: 'query_status',
  list_orders: 'query_status',
  query_order: 'query_status',
  query_order_detail: 'query_status',
  query_order_status: 'query_status',
  query_order_balance: 'query_status',
  query_sales: 'query_status',
  query_cash_movements: 'query_cash',
  register_collection: 'register_payment',
  register_order_payment: 'register_payment',
  register_order_deposit: 'register_payment',
  collect_order_full_balance: 'register_payment',
  set_order_status: 'update_order_status',
  add_order_extra_cost: 'register_cost',
  query_client_balance: 'query_balance',
  rename_products: 'unknown',
  update_supplier: 'unknown',
};

const KNOWN_UNWIRED = new Set(
  LINGUISTIC_CAPABILITIES.filter((row) => row.erp === 'requires_adapter' || (row.erp === 'partial' && row.mapsTo === 'unknown')).map(
    (row) => row.id
  )
);

export function mapLinguisticIntent(raw: string): {
  intent: WhatsappIntent;
  requestedCapability: string;
  unwired: boolean;
} {
  const id = String(raw ?? '').trim();
  if (!id) return { intent: 'unknown', requestedCapability: '', unwired: false };
  const alias = ALIAS_TO_INTENT[id];
  if (alias) return { intent: alias, requestedCapability: id, unwired: false };
  const cap = LINGUISTIC_CAPABILITIES.find((row) => row.id === id);
  if (cap) {
    return {
      intent: cap.mapsTo,
      requestedCapability: id,
      unwired: cap.mapsTo === 'unknown' && cap.erp !== 'wired',
    };
  }
  return { intent: 'unknown', requestedCapability: id, unwired: KNOWN_UNWIRED.has(id) };
}

export function isUnwiredCapability(id: string | undefined): boolean {
  const raw = String(id ?? '').trim();
  if (!raw) return false;
  const cap = LINGUISTIC_CAPABILITIES.find((row) => row.id === raw);
  if (!cap) return KNOWN_UNWIRED.has(raw);
  return cap.mapsTo === 'unknown' && cap.erp !== 'wired';
}

export function capabilityNotEnabledReply(capabilityId: string): string {
  void capabilityId;
  return 'Entendí lo que pedís, pero esa acción todavía no está disponible por WhatsApp.';
}

/** Resumen para el intérprete: ids, no ejemplos de usuarios. */
export function formatAvailableCapabilitiesPrompt(): string {
  const wired = LINGUISTIC_CAPABILITIES.filter((row) => row.erp === 'wired' || row.erp === 'partial')
    .map((row) => row.id)
    .join(', ');
  return [
    'CAPABILITIES (ids de operación; mapeá el significado a estos ids o a intent equivalente).',
    `available: ${wired}`,
    'Si el usuario pide algo que no está en available, igual identificá requestedCapability / intent; no lo bajes a unknown.',
    'Consultar vs crear: query_* no es create_*. Pago no es estado. How_to no ejecuta.',
    'Listados: query.entity + query.metric=list|count|sum. Filtros en query.filters o filters. No inventes ids.',
  ].join('\n');
}
