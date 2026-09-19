/**
 * Contrato de capacidades del producto RILO.
 * Landing, Bot, Gestión y Completo deben validarse contra esta fuente.
 */
import type { TrialProductId } from './platform-access.ts';

export type CapabilityOperationalStatus =
  | 'operational'
  | 'partial'
  | 'planned'
  | 'legacy_only';

export type WebExperienceId = 'none' | 'summary' | 'full' | 'cash_only';

export interface ProductCapabilityContract {
  id: string;
  name: string;
  commercialDescription: string;
  /** Disponible en RILO Bot (WhatsApp). */
  bot: boolean;
  /** Disponible en RILO Gestión (panel full). */
  gestion: boolean;
  /** Disponible en RILO Completo. */
  completo: boolean;
  /** Visible en landing como promesa. */
  visibleLanding: boolean;
  /** Visible en ayuda Bot. */
  visibleBotHelp: boolean;
  /** Mini-panel Resumen RILO (Bot). */
  botSummaryPanel?: boolean;
  erpSurface?: string;
  botCapability?: string;
  automationActionId?: string;
  status: CapabilityOperationalStatus;
}

export const RILO_STANDARD_CONFIG_VERSION = 'standard_v1' as const;

export const PRODUCT_CAPABILITY_CONTRACT: ProductCapabilityContract[] = [
  {
    id: 'sales.create',
    name: 'Registrar ventas',
    commercialDescription: 'Registrá ventas hablando por WhatsApp o desde el panel.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/sales',
    botCapability: 'create_sale',
    status: 'operational',
  },
  {
    id: 'sales.query',
    name: 'Consultar ventas',
    commercialDescription: '¿Cuánto vendí hoy?',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/sales',
    botCapability: 'query_sales',
    status: 'operational',
  },
  {
    id: 'orders.create',
    name: 'Crear pedidos',
    commercialDescription: 'Pedidos por WhatsApp o panel.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/orders',
    botCapability: 'create_order',
    status: 'operational',
  },
  {
    id: 'orders.status',
    name: 'Actualizar estado de pedido',
    commercialDescription: 'Marcá listo / entregado.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/orders',
    botCapability: 'update_order_status',
    status: 'operational',
  },
  {
    id: 'collections.register',
    name: 'Registrar cobros',
    commercialDescription: 'Cobros y señas.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/clients',
    botCapability: 'register_payment',
    status: 'operational',
  },
  {
    id: 'cash.register',
    name: 'Caja',
    commercialDescription: 'Ingresos, egresos y saldo.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/cash',
    botCapability: 'register_cash_movement',
    status: 'operational',
  },
  {
    id: 'cash.query',
    name: 'Consultar caja',
    commercialDescription: 'Saldo y movimientos.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/cash',
    botCapability: 'query_cash',
    status: 'operational',
  },
  {
    id: 'purchases.create',
    name: 'Compras',
    commercialDescription: 'Compras a proveedores.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/purchases',
    botCapability: 'create_purchase',
    status: 'operational',
  },
  {
    id: 'clients.balance',
    name: 'Saldos de clientes',
    commercialDescription: '¿Quién me debe?',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/clients',
    botCapability: 'query_client_balance',
    status: 'operational',
  },
  {
    id: 'stock.query',
    name: 'Stock',
    commercialDescription: 'Consultá existencias.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: false,
    erpSurface: '/stock',
    botCapability: 'query_stock',
    status: 'operational',
  },
  {
    id: 'payables.create',
    name: 'Cuentas a pagar',
    commercialDescription: 'UTE, alquiler, vencimientos.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/payables',
    botCapability: 'create_payable',
    status: 'operational',
  },
  {
    id: 'payables.query',
    name: 'Consultar vencimientos',
    commercialDescription: '¿Qué vence esta semana?',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/payables',
    botCapability: 'query_payables',
    status: 'operational',
  },
  {
    id: 'payables.pay',
    name: 'Pagar cuenta',
    commercialDescription: 'Marcá un vencimiento como pagado.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/payables',
    botCapability: 'pay_payable',
    status: 'operational',
  },
  {
    id: 'automations.daily_digest',
    name: 'Qué tengo para hoy',
    commercialDescription: 'Resumen matutino operativo (entregas, vencimientos, compromisos).',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    automationActionId: 'daily_attention_digest',
    status: 'operational',
  },
  {
    id: 'automations.orders_due',
    name: 'Pedidos de hoy',
    commercialDescription: 'Avisos de entregas del día.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    automationActionId: 'orders_due_today',
    status: 'operational',
  },
  {
    id: 'notifications.center',
    name: 'Centro de avisos',
    commercialDescription: 'Un solo lugar para ver qué necesita tu atención.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/avisos',
    status: 'operational',
  },
  {
    id: 'notifications.panel',
    name: 'Avisos en el panel',
    commercialDescription: 'Campanita y avisos dentro de RILO Gestión / Resumen.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    erpSurface: '/avisos',
    status: 'operational',
  },
  {
    id: 'notifications.whatsapp',
    name: 'Avisos por WhatsApp',
    commercialDescription: 'RILO te escribe cuando algo importa (según plan con Bot).',
    bot: true,
    gestion: false,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    status: 'operational',
  },
  {
    id: 'notifications.settings',
    name: 'Configurar avisos',
    commercialDescription: 'Elegí qué avisos querés y a qué hora.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    erpSurface: '/settings',
    status: 'operational',
  },
  {
    id: 'web.summary_panel',
    name: 'Resumen RILO',
    commercialDescription: 'Mini panel web para revisar lo anotado por WhatsApp.',
    bot: true,
    gestion: false,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/inicio',
    status: 'operational',
  },
  {
    id: 'orders.finalize',
    name: 'Finalizar / entregar pedido',
    commercialDescription: 'Cerrar pedido con entrega, venta y stock alineados.',
    bot: true,
    gestion: true,
    completo: true,
    visibleLanding: true,
    visibleBotHelp: true,
    botSummaryPanel: true,
    erpSurface: '/orders',
    botCapability: 'update_order_status',
    status: 'operational',
  },
  {
    id: 'barcode.scanner',
    name: 'Lector de códigos de barras',
    commercialDescription: 'Escaneo en ERP web.',
    bot: false,
    gestion: true,
    completo: true,
    visibleLanding: false,
    visibleBotHelp: false,
    erpSurface: '/stock',
    status: 'partial',
  },
];

export function webExperienceForProduct(product: TrialProductId | null | undefined): WebExperienceId {
  switch (product) {
    case 'cash':
      return 'cash_only';
    case 'whatsapp':
      return 'summary';
    case 'erp':
    case 'completo':
      return 'full';
    default:
      return 'none';
  }
}

export function landingVisibleCapabilities(): ProductCapabilityContract[] {
  return PRODUCT_CAPABILITY_CONTRACT.filter((c) => c.visibleLanding);
}

export function assertLandingCapabilitiesOperational(
  claims: Array<{ id: string; text: string }>
): Array<{ id: string; text: string; reason: string }> {
  const byId = new Map(PRODUCT_CAPABILITY_CONTRACT.map((c) => [c.id, c]));
  const failures: Array<{ id: string; text: string; reason: string }> = [];
  for (const claim of claims) {
    const cap = byId.get(claim.id);
    if (!cap) {
      failures.push({ ...claim, reason: 'capability_missing_in_contract' });
      continue;
    }
    if (!cap.visibleLanding) {
      failures.push({ ...claim, reason: 'not_visible_on_landing' });
      continue;
    }
    if (cap.status !== 'operational') {
      failures.push({ ...claim, reason: `status_${cap.status}` });
    }
  }
  return failures;
}

export function capabilityEnabledForProduct(
  capabilityId: string,
  product: TrialProductId
): boolean {
  const cap = PRODUCT_CAPABILITY_CONTRACT.find((c) => c.id === capabilityId);
  if (!cap) return false;
  if (product === 'whatsapp') return cap.bot;
  if (product === 'erp') return cap.gestion;
  if (product === 'completo') return cap.completo;
  if (product === 'cash') return capabilityId.startsWith('cash.');
  return false;
}

/** Filas de “funciones efectivas” para Platform / health (sin inventar flags). */
export const EFFECTIVE_FEATURE_ROWS = [
  { id: 'sales', label: 'Ventas', capabilityIds: ['sales.create', 'sales.query'] },
  { id: 'orders', label: 'Pedidos', capabilityIds: ['orders.create', 'orders.status', 'orders.finalize'] },
  { id: 'collections', label: 'Cobros', capabilityIds: ['collections.register', 'clients.balance'] },
  { id: 'cash', label: 'Caja', capabilityIds: ['cash.register', 'cash.query'] },
  { id: 'purchases', label: 'Compras', capabilityIds: ['purchases.create'] },
  { id: 'stock', label: 'Stock', capabilityIds: ['stock.query'] },
  { id: 'payables', label: 'Cuentas a pagar', capabilityIds: ['payables.create', 'payables.query', 'payables.pay'] },
  { id: 'automations', label: 'Automatizaciones', capabilityIds: ['automations.daily_digest', 'automations.orders_due', 'notifications.center', 'notifications.panel', 'notifications.whatsapp', 'notifications.settings'] },
] as const;

export type EffectiveFeatureRowId = (typeof EFFECTIVE_FEATURE_ROWS)[number]['id'];
