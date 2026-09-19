import type { BusinessFeatureId } from './business-profile.ts';
import type { AutomationChannel } from './automation-channels.ts';

export const AUTOMATION_TYPES = ['scheduled_once', 'recurring', 'condition_watch'] as const;
export type AutomationType = (typeof AUTOMATION_TYPES)[number];

export const AUTOMATION_STATUSES = ['active', 'paused', 'cancelled'] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const AUTOMATION_ACTION_STATUSES = ['implemented', 'pending', 'not_supported'] as const;
export type AutomationActionStatus = (typeof AUTOMATION_ACTION_STATUSES)[number];

export const AUTOMATION_COMPARATORS = ['lt', 'lte', 'gt', 'gte', 'eq'] as const;
export type AutomationComparator = (typeof AUTOMATION_COMPARATORS)[number];

export const AUTOMATION_ACTION_IDS = [
  'daily_business_summary',
  'daily_attention_digest',
  'cash_daily_summary',
  'cash_balance_watch',
  'cash_expenses_summary',
  'cash_wallet_period_summary',
  'cash_no_movements_soft',
  'pending_orders_summary',
  'orders_due_today',
  'orders_status_review',
  'overdue_orders_watch',
  'customer_balances_summary',
  'customer_balance_watch',
  'customer_payment_promises_due',
  'low_stock_summary',
  'product_stock_threshold_watch',
  'supplier_balance_summary',
  'purchase_payment_reminder',
  'payables_due_reminder',
  'card_payment_reminder',
  'upcoming_card_installments_summary',
  'collaborator_balance_summary',
  'collaborator_payment_reminder',
  'collaborator_hours_summary',
] as const;

export type AutomationActionId = (typeof AUTOMATION_ACTION_IDS)[number];

export type AutomationSchedule = {
  /** HH:mm local del negocio */
  time?: string;
  timezone?: string;
  /** 0=domingo … 6=sábado; vacío = todos los días (recurring daily) */
  daysOfWeek?: number[];
  /** ISO datetime para scheduled_once */
  runAt?: string;
};

export type AutomationConditionState = {
  armed: boolean;
  lastTriggeredAt?: string | null;
  lastConditionValue?: unknown;
};

export type AutomationRecord = {
  id: string;
  businessId: string;
  type: AutomationType;
  actionId: AutomationActionId;
  parameters: Record<string, unknown>;
  schedule?: AutomationSchedule;
  status: AutomationStatus;
  label?: string;
  recipientPhone: string;
  /** Canales efectivos (filtrados por plan al ejecutar). */
  channels?: AutomationChannel[];
  /** Huella del último contenido entregado (anti-duplicado). */
  lastDeliveryFingerprint?: string | null;
  /** Último envío WhatsApp exitoso (ISO). */
  lastWhatsappSentAt?: string | null;
  conditionState?: AutomationConditionState;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  runCount?: number;
  messagesSent?: number;
};

export type AutomationExecuteContext = {
  businessId: string;
  automation: AutomationRecord;
  referenceDate?: Date;
  timezone?: string;
};

export type AutomationExecuteResult = {
  title: string;
  lines: string[];
  /** Para condition_watch: valor numérico evaluado (anti-spam) */
  conditionValue?: number;
  /** Si la condición se cumple en este tick */
  conditionMet?: boolean;
  /** Si debe enviarse mensaje WhatsApp */
  shouldDeliver: boolean;
  empty?: boolean;
};

export type AutomationActionDefinition = {
  id: AutomationActionId;
  category: import('./automation-categories.ts').AutomationCategoryId;
  label: string;
  icon: string;
  description: string;
  requiredFeature: BusinessFeatureId;
  /** economics/reports para resúmenes con ganancia */
  requiredModules?: Array<'economics' | 'reports' | 'payables'>;
  automationTypesSupported: AutomationType[];
  status: AutomationActionStatus;
  parameterSchema: Record<string, unknown>;
  execute: (ctx: AutomationExecuteContext) => Promise<AutomationExecuteResult>;
  summarizeParameters?: (params: Record<string, unknown>, businessId?: string) => Promise<string[]>;
  summarizeSchedule?: (automation: Pick<AutomationRecord, 'type' | 'schedule'>) => string[];
};

export type AutomationUsageMetrics = {
  activeAutomations: number;
  runsThisMonth: number;
  conditionChecksThisMonth: number;
  messagesSentThisMonth: number;
  errorsThisMonth: number;
  updatedAt: string;
};
