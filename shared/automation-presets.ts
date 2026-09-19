import type { AutomationActionId, AutomationType } from './automation-types.ts';
import type { AutomationChannel } from './automation-channels.ts';

/**
 * Presets simples para la UI "RILO te avisa".
 * Cada preset mapea a una actionId ya implementada en el registry.
 */
export type AutomationPresetId =
  | 'daily_summary'
  | 'daily_attention'
  | 'cash_summary'
  | 'cash_weekly_categories'
  | 'cash_monthly_categories'
  | 'cash_soft_nudge'
  | 'orders_due_today'
  | 'orders_status_review'
  | 'overdue_orders'
  | 'pending_balances'
  | 'payment_promises_due'
  | 'payables_due'
  | 'low_stock';

export type AutomationPresetDefinition = {
  id: AutomationPresetId;
  actionId: AutomationActionId;
  type: AutomationType;
  label: string;
  /** Una línea: para qué sirve */
  blurb: string;
  icon: string;
  /** Horario sugerido HH:mm (si aplica) */
  defaultTime?: string;
  /** Si es condition_watch, no pide horario diario */
  scheduleRequired: boolean;
  /** Canales sugeridos; el plan filtra después */
  preferredChannels: AutomationChannel[];
  parameters?: Record<string, unknown>;
};

export const AUTOMATION_PRESETS: AutomationPresetDefinition[] = [
  {
    id: 'daily_summary',
    actionId: 'daily_business_summary',
    type: 'recurring',
    label: 'Resumen diario',
    blurb: 'Te resume ventas y facturación del día con datos reales del negocio.',
    icon: '📊',
    defaultTime: '19:00',
    scheduleRequired: true,
    preferredChannels: ['whatsapp', 'erp'],
  },
  {
    id: 'daily_attention',
    actionId: 'daily_attention_digest',
    type: 'recurring',
    label: 'Para hoy',
    blurb: 'A la mañana: entregas, atrasados, compromisos de cobro y vencimientos próximos.',
    icon: '📌',
    defaultTime: '08:30',
    scheduleRequired: true,
    preferredChannels: ['whatsapp', 'erp'],
  },
  {
    id: 'cash_summary',
    actionId: 'cash_daily_summary',
    type: 'recurring',
    label: 'Resumen de caja',
    blurb: 'Ingresos, egresos y categorías del día, con datos reales.',
    icon: '💵',
    defaultTime: '20:00',
    scheduleRequired: true,
    preferredChannels: ['whatsapp', 'erp'],
  },
  {
    id: 'cash_weekly_categories',
    actionId: 'cash_wallet_period_summary',
    type: 'recurring',
    label: 'Resumen semanal por categorías',
    blurb: 'Ingresos y egresos de la semana agrupados por categoría.',
    icon: '📅',
    defaultTime: '19:30',
    scheduleRequired: true,
    preferredChannels: ['whatsapp', 'erp'],
    parameters: { period: 'week' },
  },
  {
    id: 'cash_monthly_categories',
    actionId: 'cash_wallet_period_summary',
    type: 'recurring',
    label: 'Resumen mensual por categorías',
    blurb: 'Cierre del mes con totales e ingresos/egresos por categoría.',
    icon: '📆',
    defaultTime: '20:00',
    scheduleRequired: true,
    preferredChannels: ['whatsapp', 'erp'],
    parameters: { period: 'month' },
  },
  {
    id: 'cash_soft_nudge',
    actionId: 'cash_no_movements_soft',
    type: 'recurring',
    label: 'Recordatorio suave de caja',
    blurb: 'Si ese día no hubo movimientos, te avisa sin asumir que te olvidaste.',
    icon: '🌤️',
    defaultTime: '18:00',
    scheduleRequired: true,
    preferredChannels: ['whatsapp', 'erp'],
  },
  {
    id: 'orders_due_today',
    actionId: 'orders_due_today',
    type: 'recurring',
    label: 'Pedidos para entregar hoy',
    blurb: 'Lista de pedidos con entrega hoy que todavía no están cerrados.',
    icon: '📦',
    defaultTime: '08:30',
    scheduleRequired: true,
    preferredChannels: ['whatsapp', 'erp'],
  },
  {
    id: 'orders_status_review',
    actionId: 'orders_status_review',
    type: 'recurring',
    label: 'Revisión de pedidos',
    blurb: 'Pedidos en producción o listos con entrega hoy/mañana. No cambia estados.',
    icon: '👀',
    defaultTime: '11:00',
    scheduleRequired: true,
    preferredChannels: ['whatsapp', 'erp'],
  },
  {
    id: 'overdue_orders',
    actionId: 'overdue_orders_watch',
    type: 'condition_watch',
    label: 'Pedidos atrasados',
    blurb: 'Avisa cuando hay pedidos con entrega vencida (solo si hay atrasados).',
    icon: '⏰',
    scheduleRequired: false,
    preferredChannels: ['whatsapp', 'erp'],
    parameters: { overdueDays: 1 },
  },
  {
    id: 'pending_balances',
    actionId: 'customer_balances_summary',
    type: 'recurring',
    label: 'Saldos pendientes',
    blurb: 'Clientes con saldo a favor del negocio, para que no se te escapen cobros.',
    icon: '💳',
    defaultTime: '10:00',
    scheduleRequired: true,
    preferredChannels: ['whatsapp', 'erp'],
  },
  {
    id: 'payment_promises_due',
    actionId: 'customer_payment_promises_due',
    type: 'recurring',
    label: 'Compromisos de cobro',
    blurb: 'Cuotas de compromisos de pago que vencen hoy.',
    icon: '💰',
    defaultTime: '09:30',
    scheduleRequired: true,
    preferredChannels: ['whatsapp', 'erp'],
  },
  {
    id: 'payables_due',
    actionId: 'payables_due_reminder',
    type: 'recurring',
    label: 'Vencimientos a pagar',
    blurb: 'Cuentas a pagar que vencen en N días (por defecto 3).',
    icon: '🧾',
    defaultTime: '09:00',
    scheduleRequired: true,
    preferredChannels: ['whatsapp', 'erp'],
    parameters: { daysBefore: 3 },
  },
  {
    id: 'low_stock',
    actionId: 'low_stock_summary',
    type: 'recurring',
    label: 'Stock bajo',
    blurb: 'Productos en o bajo el mínimo configurado. No inventa stock.',
    icon: '📉',
    defaultTime: '09:00',
    scheduleRequired: true,
    preferredChannels: ['whatsapp', 'erp'],
  },
];

export function getAutomationPreset(id: string): AutomationPresetDefinition | undefined {
  return AUTOMATION_PRESETS.find((row) => row.id === id);
}

export function presetIdForAction(actionId: AutomationActionId): AutomationPresetId | null {
  return AUTOMATION_PRESETS.find((row) => row.actionId === actionId)?.id ?? null;
}
