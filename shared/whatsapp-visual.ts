/**
 * Catálogo visual central para RiloBot WhatsApp — solo presentación UX.
 * No usar para interpretación semántica de mensajes.
 */

export const WA_ICON = {
  welcome: '👋',
  cash: '💰',
  income: '➕',
  expense: '➖',
  sales: '💵',
  products: '📦',
  stock: '📊',
  orders: '📋',
  purchases: '🛒',
  clients: '👥',
  suppliers: '🚚',
  collaborators: '👷',
  person: '👤',
  payment: '💳',
  cashPay: '💵',
  transfer: '🏦',
  credit: '🧾',
  card: '💳',
  billing: '🧾',
  config: '⚙️',
  reports: '📈',
  services: '✂️',
  supplies: '🧰',
  amounts: '💰',
  cancel: '❌',
  back: '↩️',
  confirm: '✅',
  clock: '🕒',
  productItem: '☕',
} as const;

export type WaIconKey = keyof typeof WA_ICON;

export type WaListAskEntity = 'product' | 'client' | 'supplier' | 'generic';

export const WA_LIST_ASK_PRODUCT =
  'Si no es ninguno, indicame el nombre con el que está guardado y te muestro similares.';
export const WA_LIST_ASK_CLIENT =
  'Indicame qué cliente querés usar, escribime el nombre, o qué querés hacer.';
export const WA_LIST_ASK_SUPPLIER =
  'Indicame qué proveedor querés usar, escribime el nombre, o qué querés hacer.';
export const WA_LIST_ASK_GENERIC =
  'Indicame qué ítem querés usar, escribime el nombre, o qué querés hacer.';

/** @deprecated Prefer waListActionAsk('generic') — mantenido por compat. */
export const WA_INSTRUCTION = WA_LIST_ASK_GENERIC;
export const WA_INSTRUCTION_SHORT = 'Decime cuál o qué querés hacer.';

const ANY_LIST_ASK_RE =
  /(?:Indicame qué (?:producto|cliente|proveedor|ítem|item) querés usar|Si no es ninguno, indicame el nombre)[^\n]*/gi;

export function waListActionAsk(entity: WaListAskEntity = 'generic'): string {
  switch (entity) {
    case 'product':
      return WA_LIST_ASK_PRODUCT;
    case 'client':
      return WA_LIST_ASK_CLIENT;
    case 'supplier':
      return WA_LIST_ASK_SUPPLIER;
    default:
      return WA_LIST_ASK_GENERIC;
  }
}

export function detectListAskEntity(text: string): WaListAskEntity {
  const raw = String(text ?? '');
  if (/📦|producto/i.test(raw)) return 'product';
  if (/👥|cliente/i.test(raw)) return 'client';
  if (/🚚|proveedor/i.test(raw)) return 'supplier';
  return 'generic';
}

/** Quita cualquier variante de «Indicame…» y deja UNA sola frase final. */
export function ensureSingleListAsk(text: string, entity?: WaListAskEntity): string {
  const raw = String(text ?? '').trim();
  const detected = entity ?? detectListAskEntity(raw);
  const ask = waListActionAsk(detected);
  if (!raw) return ask;
  // Confirmaciones explícitas (plan congelado o match único de producto): no pisar el ask.
  if (/¿Confirmo\?/i.test(raw) || /¿Es\b.+\?\s*Respond[eé]/i.test(raw)) {
    return raw.replace(ANY_LIST_ASK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (/^✅|^❌/i.test(raw) && !ANY_LIST_ASK_RE.test(raw)) return raw;
  // Idempotente: ya termina con la frase correcta.
  if (raw.endsWith(ask)) {
    const without = raw.slice(0, -ask.length).replace(/\n+$/g, '').trimEnd();
    return without ? `${without}\n\n${ask}` : ask;
  }
  const without = raw.replace(ANY_LIST_ASK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!without) return ask;
  if (/^✅|^❌|¿Confirmo\?/i.test(without) || /¿Es\b.+\?\s*Respond[eé]/i.test(without)) {
    return without;
  }
  return `${without}\n\n${ask}`;
}

export function waInstruction(variant: 'default' | 'short' = 'default'): string {
  return variant === 'short' ? WA_INSTRUCTION_SHORT : WA_LIST_ASK_GENERIC;
}

export function waIcon(key: WaIconKey): string {
  return WA_ICON[key];
}

/** Título con emoji opcional: *💰 Caja* */
export function waTitle(text: string, icon?: WaIconKey | string): string {
  const clean = String(text ?? '').replace(/^\*|\*$/g, '').trim();
  if (!clean) return '';
  const prefix = icon
    ? `${typeof icon === 'string' && icon in WA_ICON ? WA_ICON[icon as WaIconKey] : icon} `
    : '';
  return `*${prefix}${clean}*`;
}

export function waBullet(line: string): string {
  const clean = String(line ?? '').trim();
  return clean ? `• ${clean}` : '';
}

export function waBulletList(lines: string[]): string[] {
  return (lines ?? []).map(waBullet).filter(Boolean);
}

/** Líneas numeradas para decisiones del usuario (1-based index). */
export function numberedOptionLines(options: string[], startIndex = 1): string[] {
  return (options ?? [])
    .map((option) => String(option ?? '').trim())
    .filter(Boolean)
    .map((option, offset) => `${startIndex + offset}. ${option}`);
}

export function formatNumberedMenu(input: {
  title: string;
  icon?: WaIconKey | string;
  options: string[];
  exitOption?: { index: number; label: string; icon?: WaIconKey | string };
  ask?: string;
}): string {
  const lines: string[] = [];
  lines.push(waTitle(input.title, input.icon));
  lines.push('');
  lines.push(...numberedOptionLines(input.options));
  if (input.exitOption) {
    const icon =
      input.exitOption.icon != null
        ? `${typeof input.exitOption.icon === 'string' && input.exitOption.icon in WA_ICON ? WA_ICON[input.exitOption.icon as WaIconKey] : input.exitOption.icon} `
        : '';
    lines.push(`${input.exitOption.index}. ${icon}${input.exitOption.label}`.trim());
  }
  const body = lines.join('\n');
  const ask = String(input.ask ?? WA_LIST_ASK_GENERIC).trim();
  return ask ? ensureSingleListAsk(`${body}\n\n${ask}`, detectListAskEntity(body)) : body;
}

export function formatInfoBlock(input: {
  title: string;
  icon?: WaIconKey | string;
  bullets: string[];
  ask?: string;
}): string {
  const lines: string[] = [waTitle(input.title, input.icon), '', ...waBulletList(input.bullets)];
  const body = lines.join('\n');
  const ask = String(input.ask ?? '').trim();
  return ask ? `${body}\n\n${ask}` : body;
}

/** Etiqueta de valor hora para UI: null/undefined → Sin valorar, 0 → $0 */
export function formatHourlyRateLabel(rate: number | null | undefined, formatMoney: (n: number) => string): string {
  if (rate == null) return 'Sin valorar';
  if (Number(rate) === 0) return '$0';
  return `${formatMoney(Number(rate))}/h`;
}

export function formatGeneratedAmountLabel(amount: number | null | undefined, formatMoney: (n: number) => string): string {
  if (amount == null) return 'Sin valorar';
  return formatMoney(Number(amount));
}
