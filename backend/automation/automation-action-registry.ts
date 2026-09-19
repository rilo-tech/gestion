import type {
  AutomationActionDefinition,
  AutomationActionId,
  AutomationConditionState,
  AutomationComparator,
} from '../../shared/automation-types.ts';
import { executeAutomationAction } from './action-handlers.ts';
import { getProduct } from '../domain/stock/index.ts';
import { db } from '../firebase.ts';

const boolParam = { type: 'boolean' };
const numParam = { type: 'number' };
const strParam = { type: 'string' };

function recurringAndOnce() {
  return ['scheduled_once', 'recurring'] as const;
}

function conditionOnly() {
  return ['condition_watch'] as const;
}

function allThree() {
  return ['scheduled_once', 'recurring', 'condition_watch'] as const;
}

async function productLabel(businessId: string, productId: string): Promise<string> {
  const product = await getProduct(businessId, productId);
  return product?.name ?? productId;
}

function buildRegistryEntry(
  partial: Omit<AutomationActionDefinition, 'execute'> & {
    execute?: AutomationActionDefinition['execute'];
  }
): AutomationActionDefinition {
  return {
    ...partial,
    execute:
      partial.execute ??
      (async (ctx) => {
        if (partial.status !== 'implemented') {
          return {
            title: partial.label,
            lines: ['Acción pendiente de implementación en el ERP.'],
            shouldDeliver: false,
            empty: true,
          };
        }
        return executeAutomationAction(partial.id, ctx);
      }),
  };
}

const REGISTRY_ENTRIES: AutomationActionDefinition[] = [
  buildRegistryEntry({
    id: 'daily_business_summary',
    category: 'business',
    label: 'Resumen diario del negocio',
    icon: '📊',
    description: 'Ventas, cobros y actividad operativa del día (no requiere módulo reports premium).',
    requiredFeature: 'sales',
    requiredModules: [],
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: {
      includeRevenue: boolParam,
      includeProfit: boolParam,
      includeSalesCount: boolParam,
    },
    summarizeParameters: async (params) => {
      const lines: string[] = [];
      if (params.includeRevenue !== false) lines.push('• Facturación');
      if (params.includeProfit !== false) lines.push('• Ganancia');
      if (params.includeSalesCount !== false) lines.push('• Cantidad de ventas');
      return lines.length ? lines : ['• Resumen del día'];
    },
  }),
  buildRegistryEntry({
    id: 'daily_attention_digest',
    category: 'business',
    label: 'Para hoy',
    icon: '📌',
    description: 'Resumen matutino: entregas, atrasados, compromisos de cobro y vencimientos próximos.',
    requiredFeature: 'orders',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: {},
  }),
  buildRegistryEntry({
    id: 'cash_daily_summary',
    category: 'cash',
    label: 'Resumen diario de caja',
    icon: '💰',
    description: 'Ingresos, egresos y neto del día.',
    requiredFeature: 'cash',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: { ambitoId: strParam },
    summarizeParameters: async (params) => {
      const ambito = String(params.ambitoId ?? '').trim();
      return ambito ? [`• Caja: ${ambito}`] : ['• Caja predeterminada'];
    },
  }),
  buildRegistryEntry({
    id: 'cash_balance_watch',
    category: 'cash',
    label: 'Alerta de saldo de caja',
    icon: '⚠️',
    description: 'Avisar cuando el saldo cruce un umbral.',
    requiredFeature: 'cash',
    automationTypesSupported: [...conditionOnly()],
    status: 'implemented',
    parameterSchema: {
      threshold: numParam,
      comparator: { type: 'string', enum: ['lt', 'lte', 'gt', 'gte'] },
      ambitoId: strParam,
    },
    summarizeParameters: async (params) => [
      `• Umbral: $${Number(params.threshold) || 0}`,
    ],
  }),
  buildRegistryEntry({
    id: 'cash_expenses_summary',
    category: 'cash',
    label: 'Resumen de egresos',
    icon: '💸',
    description: 'Total de egresos del día.',
    requiredFeature: 'cash',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: { ambitoId: strParam },
  }),
  buildRegistryEntry({
    id: 'cash_wallet_period_summary',
    category: 'cash',
    label: 'Resumen por categorías',
    icon: '📒',
    description: 'Ingresos y egresos agrupados por categoría (semana/mes). Sin IA.',
    requiredFeature: 'cash',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: {
      period: { type: 'string', enum: ['today', 'week', 'month', 'previous_month'] },
      ambitoId: strParam,
    },
    summarizeParameters: async (params) => {
      const period = String(params.period ?? 'month');
      return [`• Período: ${period}`];
    },
  }),
  buildRegistryEntry({
    id: 'cash_no_movements_soft',
    category: 'cash',
    label: 'Aviso suave sin movimientos',
    icon: '🌤️',
    description:
      'Si ese día no hubo movimientos, recuerda suavemente que puede anotarlos. No afirma olvidos.',
    requiredFeature: 'cash',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: { ambitoId: strParam },
  }),
  buildRegistryEntry({
    id: 'pending_orders_summary',
    category: 'orders',
    label: 'Resumen de pedidos pendientes',
    icon: '📋',
    description: 'Lista de pedidos abiertos.',
    requiredFeature: 'orders',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: {},
  }),
  buildRegistryEntry({
    id: 'orders_due_today',
    category: 'orders',
    label: 'Pedidos para entregar hoy',
    icon: '📅',
    description: 'Pedidos con fecha de entrega hoy.',
    requiredFeature: 'orders',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: {},
  }),
  buildRegistryEntry({
    id: 'orders_status_review',
    category: 'orders',
    label: 'Revisión de pedidos',
    icon: '👀',
    description: 'Pedidos en producción o listos con entrega hoy/mañana. No cambia estados.',
    requiredFeature: 'orders',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: {},
  }),
  buildRegistryEntry({
    id: 'overdue_orders_watch',
    category: 'orders',
    label: 'Alerta de pedidos atrasados',
    icon: '⚠️',
    description: 'Avisar si hay pedidos abiertos más allá de N días.',
    requiredFeature: 'orders',
    automationTypesSupported: [...conditionOnly()],
    status: 'implemented',
    parameterSchema: { thresholdDays: numParam },
    summarizeParameters: async (params) => [
      `• Atraso: ${Math.max(1, Number(params.thresholdDays) || 5)} días`,
    ],
  }),
  buildRegistryEntry({
    id: 'customer_balances_summary',
    category: 'clients',
    label: 'Resumen de saldos de clientes',
    icon: '💵',
    description: 'Clientes que deben saldo.',
    requiredFeature: 'clients',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: {},
  }),
  buildRegistryEntry({
    id: 'customer_balance_watch',
    category: 'clients',
    label: 'Alerta de saldo de cliente',
    icon: '🔔',
    description: 'Avisar si algún cliente supera un monto.',
    requiredFeature: 'clients',
    automationTypesSupported: [...conditionOnly()],
    status: 'implemented',
    parameterSchema: {
      threshold: numParam,
      comparator: { type: 'string', enum: ['gt', 'gte'] },
    },
    summarizeParameters: async (params) => [
      `• Monto: $${Number(params.threshold) || 0}`,
    ],
  }),
  buildRegistryEntry({
    id: 'customer_payment_promises_due',
    category: 'clients',
    label: 'Compromisos de cobro del día',
    icon: '💰',
    description: 'Cuotas de compromisos de pago de clientes que vencen hoy.',
    requiredFeature: 'clients',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: {},
  }),
  buildRegistryEntry({
    id: 'low_stock_summary',
    category: 'stock',
    label: 'Resumen de stock bajo',
    icon: '📉',
    description: 'Productos en o bajo el mínimo.',
    requiredFeature: 'stock',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: {},
  }),
  buildRegistryEntry({
    id: 'product_stock_threshold_watch',
    category: 'stock',
    label: 'Alerta de stock por producto',
    icon: '🔔',
    description: 'Avisar cuando un producto quede bajo cierta cantidad.',
    requiredFeature: 'stock',
    automationTypesSupported: [...conditionOnly()],
    status: 'implemented',
    parameterSchema: {
      productId: strParam,
      threshold: numParam,
      comparator: { type: 'string', enum: ['lt', 'lte'] },
    },
    summarizeParameters: async (params, businessId) => {
      const productId = String(params.productId ?? '');
      const name = businessId ? await productLabel(businessId, productId) : productId;
      return [
        `• Producto: ${name}`,
        `• Menos de ${Number(params.threshold) || 0}`,
      ];
    },
  }),
  buildRegistryEntry({
    id: 'supplier_balance_summary',
    category: 'suppliers',
    label: 'Resumen de saldo con proveedores',
    icon: '🏭',
    description: 'Saldos pendientes con proveedores.',
    requiredFeature: 'suppliers',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'pending',
    parameterSchema: {},
  }),
  buildRegistryEntry({
    id: 'purchase_payment_reminder',
    category: 'purchases',
    label: 'Recordatorio de pago de compra',
    icon: '🧾',
    description: 'Avisar compras con vencimiento próximo.',
    requiredFeature: 'purchases',
    automationTypesSupported: [...allThree()],
    status: 'pending',
    parameterSchema: { leadDays: numParam },
  }),
  buildRegistryEntry({
    id: 'payables_due_reminder',
    category: 'purchases',
    label: 'Recordatorio de cuentas a pagar',
    icon: '🧾',
    description: 'Avisar cuotas pendientes que vencen en N días.',
    requiredFeature: 'payables',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: { daysBefore: numParam },
    summarizeParameters: async (params) => [
      `• Días antes: ${Math.max(0, Number(params.daysBefore) || 3)}`,
    ],
  }),
  buildRegistryEntry({
    id: 'card_payment_reminder',
    category: 'cards',
    label: 'Recordatorio de pago de tarjeta',
    icon: '💳',
    description: 'Avisar días antes del vencimiento de tarjeta.',
    requiredFeature: 'payables',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'pending',
    parameterSchema: { cardId: strParam, leadDays: numParam },
  }),
  buildRegistryEntry({
    id: 'upcoming_card_installments_summary',
    category: 'cards',
    label: 'Cuotas de tarjeta próximas',
    icon: '💳',
    description: 'Resumen de cuotas a vencer.',
    requiredFeature: 'payables',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'pending',
    parameterSchema: { cardId: strParam, leadDays: numParam },
  }),
  buildRegistryEntry({
    id: 'collaborator_balance_summary',
    category: 'collaborators',
    label: 'Resumen de saldos de colaboradores',
    icon: '👷',
    description: 'Cuánto se debe a colaboradores.',
    requiredFeature: 'collaborators',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: {},
  }),
  buildRegistryEntry({
    id: 'collaborator_payment_reminder',
    category: 'collaborators',
    label: 'Recordatorio de pago a colaborador',
    icon: '👷',
    description: 'Avisar pagos pendientes a colaboradores.',
    requiredFeature: 'collaborators',
    automationTypesSupported: [...allThree()],
    status: 'pending',
    parameterSchema: { collaboratorId: strParam, leadDays: numParam },
  }),
  buildRegistryEntry({
    id: 'collaborator_hours_summary',
    category: 'collaborators',
    label: 'Resumen de horas de colaboradores',
    icon: '⏱️',
    description: 'Horas registradas en la semana.',
    requiredFeature: 'collaborators',
    automationTypesSupported: [...recurringAndOnce()],
    status: 'implemented',
    parameterSchema: {},
  }),
];

const REGISTRY_MAP = new Map<AutomationActionId, AutomationActionDefinition>(
  REGISTRY_ENTRIES.map((entry) => [entry.id, entry])
);

export function getAutomationAction(id: string): AutomationActionDefinition | undefined {
  return REGISTRY_MAP.get(id as AutomationActionId);
}

export function listAutomationActions(): AutomationActionDefinition[] {
  return [...REGISTRY_ENTRIES];
}

export function defaultConditionState(): AutomationConditionState {
  return { armed: true, lastTriggeredAt: null };
}

export function defaultComparatorForAction(actionId: AutomationActionId): AutomationComparator {
  if (actionId === 'customer_balance_watch') return 'gt';
  return 'lt';
}

export async function summarizeAutomation(
  automation: {
    actionId: AutomationActionId;
    type: string;
    parameters: Record<string, unknown>;
    schedule?: { time?: string; daysOfWeek?: number[]; runAt?: string };
  },
  businessId?: string
): Promise<string[]> {
  const action = getAutomationAction(automation.actionId);
  if (!action) return [`• ${automation.actionId}`];
  const lines = [`• ${action.icon} ${action.label}`];
  if (action.summarizeParameters) {
    lines.push(...(await action.summarizeParameters(automation.parameters, businessId)));
  }
  if (automation.type === 'recurring' && automation.schedule?.time) {
    const days = automation.schedule.daysOfWeek?.length
      ? ` · días ${automation.schedule.daysOfWeek.join(',')}`
      : ' · Todos los días';
    lines.push(`• ${automation.schedule.time}${days}`);
  }
  if (automation.type === 'scheduled_once' && automation.schedule?.runAt) {
    lines.push(`• ${automation.schedule.runAt}`);
  }
  if (automation.type === 'condition_watch') {
    lines.push('• Alerta por condición');
  }
  return lines;
}

export async function resolveBusinessTimezone(businessId: string): Promise<string> {
  try {
    const snap = await db.doc(`negocios/${businessId}/config/app`).get();
    const tz = String(snap.data()?.timezone ?? '').trim();
    return tz || 'America/Argentina/Buenos_Aires';
  } catch {
    return 'America/Argentina/Buenos_Aires';
  }
}
