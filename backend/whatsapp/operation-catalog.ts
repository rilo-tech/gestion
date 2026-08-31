import type { WhatsappIntent } from './ai-command-parser.ts';

export type OperationMutates = 'write' | 'read' | 'none';

export type OperationSpec = {
  intent: WhatsappIntent;
  action: string;
  handler: string;
  required: string[];
  optional: string[];
  resolve: string[];
  mutates: OperationMutates;
  confirmation: boolean;
  multiItem: boolean;
  pendingStates: string[];
  payload: string;
  requiresDb: boolean;
};

/**
 * Inventario de intents que RiloBot ya ejecuta.
 * El intérprete emite SOLO el payload de este intent (unión discriminada).
 * No hay create_expense / create_income / create_supplier / query_stock legado:
 * caja = register_cash; alta de proveedor = confirm_create_supplier en compra.
 * query_stock se agrega como familia de consulta (antes no existía).
 */
export const OPERATION_CATALOG: Record<WhatsappIntent, OperationSpec> = {
  help: {
    intent: 'help',
    action: 'Menú / cómo usar el bot',
    handler: 'erp-integration.ts → helpReply / message-handler handleHelpTurn',
    required: [],
    optional: [],
    resolve: [],
    mutates: 'none',
    confirmation: false,
    multiItem: false,
    pendingStates: ['help_topic'],
    payload: 'HelpPayload',
    requiresDb: false,
  },
  how_to: {
    intent: 'how_to',
    action: 'Explicar cómo usar una acción, sin ejecutarla',
    handler: 'message-handler.ts → answerHowTo',
    required: [],
    optional: ['helpTopic', 'expectedItemCount'],
    resolve: [],
    mutates: 'none',
    confirmation: false,
    multiItem: false,
    pendingStates: [],
    payload: 'HowToPayload',
    requiresDb: false,
  },
  capability_question: {
    intent: 'capability_question',
    action: 'Responder si una función existe, sin ejecutarla',
    handler: 'message-handler.ts → answerCapability',
    required: [],
    optional: ['helpTopic', 'expectedItemCount'],
    resolve: [],
    mutates: 'none',
    confirmation: false,
    multiItem: false,
    pendingStates: [],
    payload: 'CapabilityPayload',
    requiresDb: false,
  },
  greeting: {
    intent: 'greeting',
    action: 'Saludo / onboarding',
    handler: 'erp-integration.ts + onboarding.ts',
    required: [],
    optional: [],
    resolve: [],
    mutates: 'none',
    confirmation: false,
    multiItem: false,
    pendingStates: ['onboarding_*', 'resume_context'],
    payload: 'GreetingPayload',
    requiresDb: false,
  },
  create_order: {
    intent: 'create_order',
    action: 'Registrar pedido',
    handler: 'erp-writes.ts → createOrderFromWhatsapp',
    required: ['client', 'items', 'amount'],
    optional: ['notes', 'deliveryDate', 'orderDate', 'seniaAmount', 'paid', 'extraCosts', 'clientPhone'],
    resolve: ['client', 'product per item'],
    mutates: 'write',
    confirmation: true,
    multiItem: true,
    pendingStates: [
      'select_client',
      'select_product',
      'collect_order_items',
      'clarify (notes, deliveryDate, itemColor, itemSize, amount, client)',
      'confirm:create_order',
      'confirm_create_client',
      'confirm_create_product',
    ],
    payload: 'CreateOrderPayload',
    requiresDb: true,
  },
  create_sale: {
    intent: 'create_sale',
    action: 'Registrar venta',
    handler: 'erp-writes.ts → createSaleFromWhatsapp',
    required: ['client', 'items', 'amount'],
    optional: ['notes', 'orderDate', 'paid', 'seniaAmount', 'extraCosts'],
    resolve: ['client', 'product per item'],
    mutates: 'write',
    confirmation: true,
    multiItem: true,
    pendingStates: [
      'select_client',
      'select_product',
      'clarify',
      'confirm:create_sale',
      'confirm_create_client',
      'confirm_create_product',
    ],
    payload: 'CreateSalePayload',
    requiresDb: true,
  },
  create_purchase: {
    intent: 'create_purchase',
    action: 'Registrar compra (stock in; no caja ni costo de catálogo)',
    handler: 'erp-writes.ts → createPurchaseFromWhatsapp',
    required: ['supplier', 'purchaseLines'],
    optional: ['invoiceNumber', 'orderDate', 'amount', 'mediaId', 'saveAsDraft'],
    resolve: ['supplier', 'product per line'],
    mutates: 'write',
    confirmation: true,
    multiItem: true,
    pendingStates: [
      'select_supplier',
      'select_product',
      'select_purchase_unknowns',
      'select_purchase_pack',
      'select_purchase_non_catalog',
      'select_purchase_payment',
      'select_purchase_card',
      'confirm_create_supplier',
      'confirm:create_purchase',
    ],
    payload: 'CreatePurchasePayload',
    requiresDb: true,
  },
  register_payment: {
    intent: 'register_payment',
    action: 'Registrar cobro / seña',
    handler: 'erp-writes.ts → registerPaymentFromWhatsapp',
    required: ['client', 'amount|payFullBalance'],
    optional: ['orderNumber', 'targetOrderId', 'paymentKind', 'paymentMethod', 'referToLast'],
    resolve: ['client', 'order'],
    mutates: 'write',
    confirmation: true,
    multiItem: false,
    pendingStates: [
      'select_client',
      'select_payment_kind',
      'select_order',
      'order_action',
      'settle_order',
      'clarify amount',
      'confirm:register_payment',
    ],
    payload: 'RegisterPaymentPayload',
    requiresDb: true,
  },
  register_cash: {
    intent: 'register_cash',
    action: 'Ingreso o egreso de caja',
    handler: 'domain/cash → registerCashMovement',
    required: ['amount', 'cashType'],
    optional: ['cashConcept', 'cashAmbitoHint', 'cashAmbitoId'],
    resolve: ['caja ámbito'],
    mutates: 'write',
    confirmation: true,
    multiItem: false,
    pendingStates: ['select_cash_ambito', 'clarify amount', 'confirm:register_cash'],
    payload: 'RegisterCashPayload',
    requiresDb: true,
  },
  create_client: {
    intent: 'create_client',
    action: 'Alta de cliente',
    handler: 'erp-writes.ts → createClientFromWhatsapp',
    required: ['clientName'],
    optional: ['clientPhone'],
    resolve: [],
    mutates: 'write',
    confirmation: true,
    multiItem: false,
    pendingStates: ['confirm_create_client', 'confirm:create_client'],
    payload: 'CreateClientPayload',
    requiresDb: true,
  },
  register_cost: {
    intent: 'register_cost',
    action: 'Costo extra de un pedido existente',
    handler: 'erp-writes.ts → addOrderCostFromWhatsapp',
    required: ['extraCosts', 'order target'],
    optional: ['clientName', 'orderNumber', 'referToLast'],
    resolve: ['order'],
    mutates: 'write',
    confirmation: true,
    multiItem: true,
    pendingStates: ['select_order', 'clarify', 'confirm:register_cost'],
    payload: 'RegisterCostPayload',
    requiresDb: true,
  },
  update_product_cost: {
    intent: 'update_product_cost',
    action: 'Cambiar costo de catálogo',
    handler: 'erp-writes.ts → updateProductCostFromWhatsapp',
    required: ['product', 'amount'],
    optional: [],
    resolve: ['product'],
    mutates: 'write',
    confirmation: true,
    multiItem: false,
    pendingStates: ['select_product', 'confirm:update_product_cost'],
    payload: 'UpdateProductCostPayload',
    requiresDb: true,
  },
  update_order_status: {
    intent: 'update_order_status',
    action: 'Cambiar estado de pedido (stock/entrega según config ERP)',
    handler: 'order-status.ts → updateOrderStatusFromWhatsapp',
    required: ['order', 'orderStatus'],
    optional: ['paid', 'payFullBalance', 'amount'],
    resolve: ['order'],
    mutates: 'write',
    confirmation: true,
    multiItem: false,
    pendingStates: [
      'select_order',
      'order_action',
      'settle_order',
      'confirm:update_order_status',
    ],
    payload: 'UpdateOrderStatusPayload',
    requiresDb: true,
  },
  query_balance: {
    intent: 'query_balance',
    action: 'Saldo que debe un cliente',
    handler: 'erp-writes.ts → queryBalanceFromWhatsapp',
    required: ['client'],
    optional: [],
    resolve: ['client'],
    mutates: 'read',
    confirmation: false,
    multiItem: false,
    pendingStates: ['select_client'],
    payload: 'QueryBalancePayload',
    requiresDb: true,
  },
  query_cash: {
    intent: 'query_cash',
    action: 'Saldo / resumen de caja',
    handler: 'domain/cash → getCashBalance / getCashDayTotals / getCashMovements',
    required: [],
    optional: ['cashAmbitoHint'],
    resolve: ['caja ámbito opcional'],
    mutates: 'read',
    confirmation: false,
    multiItem: false,
    pendingStates: ['select_cash_ambito'],
    payload: 'QueryCashPayload',
    requiresDb: true,
  },
  query_status: {
    intent: 'query_status',
    action: 'Consultar o listar pedido/venta existente',
    handler: 'erp-queries.ts → queryStatusFromWhatsapp',
    required: [],
    optional: ['clientName', 'orderNumber', 'targetOrderId', 'listOrders', 'productName', 'referToLast'],
    resolve: ['order'],
    mutates: 'read',
    confirmation: false,
    multiItem: true,
    pendingStates: ['select_order', 'order_action'],
    payload: 'QueryStatusPayload',
    requiresDb: true,
  },
  query_stock: {
    intent: 'query_stock',
    action: 'Consultar stock por producto / color / talle',
    handler: 'erp-queries.ts → queryStockFromWhatsapp',
    required: [],
    optional: ['productHint', 'color', 'size', 'wantAll'],
    resolve: ['product attributes'],
    mutates: 'read',
    confirmation: false,
    multiItem: true,
    pendingStates: [],
    payload: 'QueryStockPayload',
    requiresDb: true,
  },
  unknown: {
    intent: 'unknown',
    action: 'No inventar: pedir aclaración',
    handler: 'clarify.ts / askUnknownIntent',
    required: [],
    optional: [],
    resolve: [],
    mutates: 'none',
    confirmation: false,
    multiItem: false,
    pendingStates: ['clarify missingField=intent'],
    payload: 'UnknownPayload',
    requiresDb: false,
  },
};

export const OPERATION_TABLE_ROWS = (Object.values(OPERATION_CATALOG) as OperationSpec[]).map(
  (spec) => ({
    Intent: spec.intent,
    Acción: spec.action,
    Payload: spec.payload,
    'Requiere DB': spec.requiresDb ? 'sí' : 'no',
    Confirmación: spec.confirmation ? 'sí' : 'no',
    'Multi-item': spec.multiItem ? 'sí' : 'no',
  })
);

export function catalogFor(intent: string): OperationSpec | undefined {
  return OPERATION_CATALOG[intent as WhatsappIntent];
}

export function writeIntents(): WhatsappIntent[] {
  return (Object.values(OPERATION_CATALOG) as OperationSpec[])
    .filter((spec) => spec.mutates === 'write')
    .map((spec) => spec.intent);
}

export function queryIntents(): WhatsappIntent[] {
  return (Object.values(OPERATION_CATALOG) as OperationSpec[])
    .filter((spec) => spec.mutates === 'read')
    .map((spec) => spec.intent);
}
