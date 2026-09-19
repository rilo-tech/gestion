import {
  isErpWebOperational,
  isWhatsappOperational,
  productIdFromAccess,
  type ClientPlatformAccess,
  type TrialProductId,
} from './platform-access.ts';

/** Canales de entrega de una automatización. */
export const AUTOMATION_CHANNELS = ['whatsapp', 'erp'] as const;
export type AutomationChannel = (typeof AUTOMATION_CHANNELS)[number];

export function parseAutomationChannels(value: unknown): AutomationChannel[] {
  if (!Array.isArray(value)) return [];
  const out: AutomationChannel[] = [];
  for (const item of value) {
    if (item === 'whatsapp' || item === 'erp') {
      if (!out.includes(item)) out.push(item);
    }
  }
  return out;
}

/** Canales permitidos según el plan operativo actual (no solo el UI). */
export function allowedAutomationChannels(access: ClientPlatformAccess): AutomationChannel[] {
  const allowed: AutomationChannel[] = [];
  if (isWhatsappOperational(access)) allowed.push('whatsapp');
  if (isErpWebOperational(access)) allowed.push('erp');
  return allowed;
}

/** Default al crear: Bot→WA, Gestión→ERP, Completo→ambos. */
export function defaultAutomationChannels(access: ClientPlatformAccess): AutomationChannel[] {
  const product = productIdFromAccess(access);
  const allowed = allowedAutomationChannels(access);
  if (!allowed.length) return [];
  if (product === 'erp') return allowed.filter((c) => c === 'erp');
  if (product === 'whatsapp' || product === 'cash') return allowed.filter((c) => c === 'whatsapp');
  return allowed;
}

/**
 * Intersecta lo pedido con lo permitido por el plan.
 * Si lo pedido queda vacío, usa el default del plan.
 */
export function resolveAutomationChannels(
  access: ClientPlatformAccess,
  requested?: AutomationChannel[] | null
): AutomationChannel[] {
  const allowed = allowedAutomationChannels(access);
  if (!allowed.length) return [];
  const asked = parseAutomationChannels(requested);
  const filtered = asked.filter((c) => allowed.includes(c));
  if (filtered.length) return filtered;
  return defaultAutomationChannels(access);
}

export function channelLabel(channel: AutomationChannel): string {
  return channel === 'whatsapp' ? 'WhatsApp' : 'RILO Gestión';
}

export function describeChannelsForProduct(productId: TrialProductId | null | undefined): string {
  if (productId === 'erp') return 'Avisos en RILO Gestión';
  if (productId === 'whatsapp' || productId === 'cash') return 'Avisos por WhatsApp';
  return 'WhatsApp y avisos en el panel';
}
