/**
 * RILO te avisa — modelo de notificaciones / avisos ERP.
 * Situación = negocio (open/resolved). Leído = por usuario.
 */
import type { AutomationActionId } from './automation-types.ts';
import type { AutomationPresetId } from './automation-presets.ts';

export const ERP_NOTICE_STATUSES = ['open', 'resolved', 'hidden', 'muted'] as const;
export type ErpNoticeStatus = (typeof ERP_NOTICE_STATUSES)[number];

export const RILO_NOTICE_SEVERITIES = ['info', 'attention', 'urgent'] as const;
export type RiloNoticeSeverity = (typeof RILO_NOTICE_SEVERITIES)[number];

export const RILO_NOTICE_TYPES = [
  'order_due_today',
  'order_overdue',
  'order_in_progress_near',
  'order_ready_pending',
  'payable_due_soon',
  'payable_overdue',
  'payment_promise_today',
  'customer_balances_summary',
  'stock_low',
  'stock_out',
  'daily_attention_digest',
  'daily_business_summary',
  'generic',
] as const;
export type RiloNoticeType = (typeof RILO_NOTICE_TYPES)[number];

export const RILO_NOTICE_ACTIONS = [
  'view_order',
  'mark_order_ready',
  'view_payable',
  'pay_payable',
  'view_client',
  'register_collection',
  'view_product',
  'adjust_stock',
  'view_balances',
  'manage_whatsapp',
  'view_route',
] as const;
export type RiloNoticeActionKind = (typeof RILO_NOTICE_ACTIONS)[number];

/** Alias de producto: RiloNotification ≈ ErpNotice extendido. */
export type ErpNotice = {
  id: string;
  businessId: string;
  automationId?: string | null;
  actionId: AutomationActionId | string;
  presetId?: AutomationPresetId | null;
  /** Tipo semántico del aviso (dominio). */
  type: RiloNoticeType;
  severity: RiloNoticeSeverity;
  title: string;
  body: string;
  /** Ruta relativa del panel */
  route?: string | null;
  /** Clave estable de deduplicación (preferida sobre fingerprint legacy). */
  dedupeKey: string;
  /** @deprecated usar dedupeKey; se mantiene por compat. */
  fingerprint: string;
  entityType?: string | null;
  entityId?: string | null;
  dueAt?: string | null;
  actionKind?: RiloNoticeActionKind | null;
  actionLabel?: string | null;
  source: 'attention_sync' | 'automation' | 'system';
  status: ErpNoticeStatus;
  createdAt: string;
  updatedAt: string;
  /** Situación resuelta por cambio de dominio o acción. */
  resolvedAt?: string | null;
  dismissedAt?: string | null;
  /** Leído a nivel negocio (legacy); preferir userReadAt en DTO. */
  readAt?: string | null;
};

export type RiloNotification = ErpNotice;

export type ErpNoticeWithUserState = ErpNotice & {
  /** Leído por el usuario autenticado. */
  userReadAt: string | null;
  unread: boolean;
};

export type AttentionItem = {
  type: RiloNoticeType;
  severity: RiloNoticeSeverity;
  title: string;
  body: string;
  dedupeKey: string;
  entityType?: string;
  entityId?: string;
  dueAt?: string | null;
  route?: string | null;
  actionKind?: RiloNoticeActionKind;
  actionLabel?: string;
  actionId?: AutomationActionId | string;
  presetId?: AutomationPresetId | null;
};

export type AutomationOfferId =
  | 'offer_daily_summary'
  | 'offer_low_stock'
  | 'offer_orders_due'
  | 'offer_pending_balances';

export type AutomationOfferChoice = 'accepted' | 'deferred' | 'declined';

export type AutomationOfferState = {
  choice: AutomationOfferChoice;
  at: string;
  remindAfter?: string | null;
};

/** Preferencias de negocio para “RILO te avisa”. */
export type RiloAvisosSettings = {
  /** Días antes para vencimientos (default 3). */
  payablesDaysBefore: number;
  /** Canales preferidos a nivel negocio (null = según plan). */
  preferredChannels?: Array<'whatsapp' | 'erp'> | null;
  updatedAt: string;
};

export type AutomationUserPrefs = {
  mutedPresets: AutomationPresetId[];
  offers: Partial<Record<AutomationOfferId, AutomationOfferState>>;
  preferredChannels?: Array<'whatsapp' | 'erp'> | null;
  /** Settings simples RILO te avisa (negocio). */
  avisos?: Partial<RiloAvisosSettings> | null;
  updatedAt: string;
};

export function emptyAutomationUserPrefs(now = new Date().toISOString()): AutomationUserPrefs {
  return {
    mutedPresets: [],
    offers: {},
    preferredChannels: null,
    avisos: {
      payablesDaysBefore: 3,
      preferredChannels: null,
      updatedAt: now,
    },
    updatedAt: now,
  };
}

/** Máximo de avisos ERP abiertos visibles (anti-spam). */
export const MAX_OPEN_ERP_NOTICES = 40;

/** Máximo de envíos WhatsApp por automatización por día (anti-spam). */
export const MAX_WA_AUTOMATION_SENDS_PER_DAY = 3;

/** Retención de resueltos en listados (días). */
export const RESOLVED_NOTICE_RETENTION_DAYS = 30;

export function severityForNoticeType(type: RiloNoticeType): RiloNoticeSeverity {
  switch (type) {
    case 'payable_overdue':
    case 'order_overdue':
    case 'stock_out':
      return 'urgent';
    case 'daily_business_summary':
    case 'daily_attention_digest':
    case 'customer_balances_summary':
      return 'info';
    default:
      return 'attention';
  }
}
