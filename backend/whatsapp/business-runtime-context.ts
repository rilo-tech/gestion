/**
 * Contexto runtime del negocio para RiloBot (y validaciones backend).
 * El LLM recibe labels; el backend resuelve a IDs canónicos.
 */
import { db } from '../firebase.ts';
import {
  normalizeOrderPedidosConfig,
  type OrderEstadoConfig,
} from '../utils/order-config.ts';
import { loadFinanzasConfig, type MedioPagoConfig } from '../utils/finance-config.ts';
import { resolveBusinessProfile, type BusinessProfile } from '../../shared/business-profile.ts';
import { listAvailableAutomationActions } from '../automation/automation-availability.ts';
import { emptyModulesMap, type SubscriptionModulesMap } from '../../shared/subscription-modules.ts';
import type { TrialProductId } from '../../shared/platform-access.ts';

export const CANONICAL_ORDER_STATUS_IDS = [
  'borrador',
  'pendiente',
  'en_produccion',
  'listo',
  'entregado',
  'cancelado',
] as const;

export type CanonicalOrderStatusId = (typeof CANONICAL_ORDER_STATUS_IDS)[number];

export type BusinessRuntimeContext = {
  businessId: string;
  profile: BusinessProfile;
  orderStates: Array<{ id: CanonicalOrderStatusId; label: string }>;
  terminology: {
    orderSingular: string;
    orderPlural: string;
  };
  paymentMethods: Array<{ id: string; label: string; activo: boolean }>;
  defaultPaymentMethod: string | null;
  cashAccounts: Array<{ id: string; label: string }>;
  defaultCashAccountId: string | null;
  stock: {
    enabled: boolean;
  };
  automationActionIds: string[];
  productId: TrialProductId | null;
};

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

const STATUS_ALIASES: Record<string, CanonicalOrderStatusId> = {
  borrador: 'borrador',
  draft: 'borrador',
  pendiente: 'pendiente',
  pending: 'pendiente',
  'en proceso': 'en_produccion',
  'en produccion': 'en_produccion',
  en_produccion: 'en_produccion',
  produccion: 'en_produccion',
  preparando: 'en_produccion',
  'en taller': 'en_produccion',
  elaboracion: 'en_produccion',
  listo: 'listo',
  ready: 'listo',
  pronto: 'listo',
  entregado: 'entregado',
  delivered: 'entregado',
  cancelado: 'cancelado',
  cancelled: 'cancelado',
};

/** Resuelve label/alias → ID canónico. Determinista; no depende del LLM. */
export function resolveOrderStatusFromText(
  raw: string,
  states: Array<{ id: string; label: string }>
): CanonicalOrderStatusId | null {
  const key = normalizeText(raw);
  if (!key) return null;

  for (const state of states) {
    if (normalizeText(state.id) === key) return state.id as CanonicalOrderStatusId;
    if (normalizeText(state.label) === key) return state.id as CanonicalOrderStatusId;
    if (normalizeText(state.label).includes(key) || key.includes(normalizeText(state.label))) {
      return state.id as CanonicalOrderStatusId;
    }
  }

  if (STATUS_ALIASES[key]) return STATUS_ALIASES[key];
  for (const [alias, id] of Object.entries(STATUS_ALIASES)) {
    if (key.includes(alias) || alias.includes(key)) return id;
  }
  return null;
}

export async function buildBusinessRuntimeContext(params: {
  businessId: string;
  productId?: TrialProductId | null;
  entitlements?: SubscriptionModulesMap;
  businessProfileRaw?: unknown;
}): Promise<BusinessRuntimeContext> {
  const businessId = params.businessId;
  const appSnap = await db.doc(`negocios/${businessId}/config/app`).get();
  const app = (appSnap.data() ?? {}) as Record<string, unknown>;
  const pedidos = normalizeOrderPedidosConfig(app.pedidos);
  const states = (pedidos.estados as OrderEstadoConfig[]).map((row) => ({
    id: row.value as CanonicalOrderStatusId,
    label: row.label,
  }));

  const bizSnap = await db.doc(`negocios/${businessId}`).get();
  const biz = (bizSnap.data() ?? {}) as Record<string, unknown>;
  const profile = resolveBusinessProfile(
    params.businessProfileRaw ?? biz.businessProfile
  );

  const finanzas = await loadFinanzasConfig(businessId);
  const medios = finanzas.mediosPago
    .filter((m: MedioPagoConfig) => m.activo !== false)
    .map((m) => ({ id: m.id, label: m.label, activo: true }));

  const caja = (app.caja as Record<string, unknown>) ?? {};
  const ambitosRaw = Array.isArray(caja.ambitos) ? caja.ambitos : [];
  const cashAccounts = ambitosRaw
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const id = String(r.id ?? '').trim();
      const label = String(r.label ?? r.nombre ?? id).trim();
      if (!id) return null;
      return { id, label };
    })
    .filter(Boolean) as Array<{ id: string; label: string }>;

  const defaultPaymentMethod =
    profile.defaults?.defaultPaymentMethod ||
    profile.defaults?.sales?.defaultPaymentMethod ||
    medios.find((m) => m.id === 'efectivo')?.id ||
    medios[0]?.id ||
    null;

  const defaultCashAccountId =
    profile.defaults?.defaultCashAccountId || cashAccounts[0]?.id || null;

  const productId = params.productId ?? null;
  const entitlements = params.entitlements ?? emptyModulesMap(true);
  const automationActionIds = listAvailableAutomationActions({
    productId: productId ?? 'completo',
    entitlements,
    profile,
    permission: true,
  }).map((a) => a.id);

  return {
    businessId,
    profile,
    orderStates: states.length
      ? states
      : CANONICAL_ORDER_STATUS_IDS.map((id) => ({
          id,
          label:
            id === 'en_produccion'
              ? 'En proceso'
              : id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, ' '),
        })),
    terminology: {
      orderSingular: profile.terminology?.orderSingular || 'Pedido',
      orderPlural: profile.terminology?.orderPlural || 'Pedidos',
    },
    paymentMethods: medios,
    defaultPaymentMethod,
    cashAccounts,
    defaultCashAccountId,
    stock: {
      enabled: profile.enabledFeatures.stock !== false,
    },
    automationActionIds,
    productId,
  };
}

export function formatRuntimeContextForAgent(ctx: BusinessRuntimeContext): string {
  const states = ctx.orderStates.map((s) => `${s.id}=${s.label}`).join(', ');
  const medios = ctx.paymentMethods.map((m) => `${m.id}(${m.label})`).join(', ');
  return [
    `Estados pedido (id=label): ${states}`,
    `Terminología: ${ctx.terminology.orderSingular}/${ctx.terminology.orderPlural}`,
    `Medios pago activos: ${medios || 'ninguno'}`,
    `Medio default: ${ctx.defaultPaymentMethod || '—'}`,
    `Cajas: ${ctx.cashAccounts.map((c) => c.label).join(', ') || '—'}`,
    `Stock habilitado: ${ctx.stock.enabled ? 'sí' : 'no'}`,
  ].join('\n');
}
