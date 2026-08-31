import type { LineItemAttributes, LineItemIntent } from './conversation-contract.ts';
import { WA_CHOICE_PAGE_SIZE } from '../../shared/whatsapp-format.ts';

export const PRODUCT_TYPE_TOKENS = [
  'canguro',
  'hoodie',
  'buzo',
  'camiseta',
  'remera',
  'campera',
  'pantalon',
  'jean',
  'short',
  'taza',
  'vestido',
  'pollera',
  'chomba',
  'polo',
  'body',
  'enterito',
  'conjunto',
  'oversize',
] as const;

const FABRIC_TOKENS = [
  'felpa',
  'algodon',
  'frisa',
  'frizado',
  'terry',
  'dry',
  'pique',
  'rustico',
  'jersey',
  'morley',
] as const;

const COLOR_TOKENS = [
  'negro',
  'blanco',
  'rojo',
  'gris',
  'azul',
  'verde',
  'rosa',
  'beige',
  'naranja',
  'celeste',
  'bordo',
  'amarillo',
] as const;

const SIZE_RE = /\b(?:talle\s+)?(xxxxl|xxxl|xxl|xl|xs|s|m|l|2xl|3xl|4xl|5xl)\b/i;
const INCIDENTAL_PHRASE =
  /\b(?:comb(?:inado)?|con)?\s*(?:manga|cuello|detalle|vivo|cordon|cordón|interior)\s+[a-zñ]+/gi;

export type CatalogSignals = {
  type?: string | null;
  fabric?: string | null;
  color?: string | null;
  size?: string | null;
};

export type RankedCatalogItem = {
  id: string;
  nombre: string;
  label?: string;
  score: number;
  precioVenta?: number;
};

export type CatalogMatchDecision =
  | { status: 'unique'; item: RankedCatalogItem }
  | { status: 'ambiguous'; options: RankedCatalogItem[]; rest: RankedCatalogItem[] }
  | { status: 'none' };

const DOMINANT_GAP = 12;

function fold(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function asTrimmed(value: unknown): string {
  return String(value ?? '').trim();
}

export function extractSpokenProductType(text: string): string | null {
  const haystack = fold(text);
  for (const type of PRODUCT_TYPE_TOKENS) {
    if (new RegExp(`(?<![\\p{L}])${type}(?![\\p{L}])`, 'iu').test(haystack)) return type;
  }
  return null;
}

export function extractSpokenFabric(text: string): string | null {
  const haystack = fold(text);
  for (const fabric of FABRIC_TOKENS) {
    if (new RegExp(`(?<![\\p{L}])${fabric}(?![\\p{L}])`, 'iu').test(haystack)) return fabric;
  }
  return null;
}

export function signalsFromItem(item: Pick<LineItemIntent, 'rawText' | 'productHint' | 'attributes'>): CatalogSignals {
  const attrs = item.attributes ?? {};
  const spoken = [item.productHint, item.rawText].filter(Boolean).join(' ');
  const spokenSize = spoken.match(SIZE_RE)?.[1];
  return {
    type: asTrimmed(attrs.type) || extractSpokenProductType(spoken),
    fabric: asTrimmed(attrs.fabric) || extractSpokenFabric(spoken),
    color: stemColor(asTrimmed(attrs.color) || firstColorIn(spoken) || ''),
    size: asTrimmed(attrs.size).toUpperCase() || (spokenSize ? spokenSize.toUpperCase() : null),
  };
}

/** Query limpia: tipo + tela + color + talle. Sin repetir rawText ni el nombre de un candidato. */
export function cleanCatalogQuery(item: LineItemIntent): string {
  const signals = signalsFromItem(item);
  const hint = asTrimmed(item.productHint);
  const raw = asTrimmed(item.rawText);
  const head = signals.type || firstDistinctiveToken(hint || raw);
  const parts = [head, signals.fabric, signals.color, signals.size].map(asTrimmed).filter(Boolean);
  const unique: string[] = [];
  for (const part of parts) {
    const folded = fold(part);
    if (!folded) continue;
    if (unique.some((existing) => fold(existing) === folded || fold(existing).includes(folded))) continue;
    unique.push(part);
  }
  return unique.join(' ').trim() || hint || raw;
}

function firstDistinctiveToken(text: string): string {
  const tokens = String(text ?? '')
    .split(/\s+/)
    .map((token) => token.replace(/^un[oa]?$/i, '').trim())
    .filter(Boolean);
  for (const token of tokens) {
    if (/^(un|una|el|la|de|con)$/i.test(token)) continue;
    if (SIZE_RE.test(token)) continue;
    return token;
  }
  return tokens[0] ?? '';
}

function haystackOf(item: RankedCatalogItem): string {
  return fold([item.nombre, item.label].filter(Boolean).join(' '));
}

function sizeOf(item: RankedCatalogItem): string | null {
  const match = `${item.label ?? ''} ${item.nombre}`.match(SIZE_RE);
  return match?.[1] ? match[1].toUpperCase() : null;
}

function stemColor(raw: string): string {
  const folded = fold(raw);
  if (folded.startsWith('blanc')) return 'blanco';
  if (folded.startsWith('roj')) return 'rojo';
  if (folded.startsWith('negr')) return 'negro';
  if (folded.startsWith('amarill')) return 'amarillo';
  return folded;
}

function firstColorIn(text: string): string | null {
  const folded = fold(text);
  for (const color of COLOR_TOKENS) {
    const pattern = color.endsWith('o') ? `${color.slice(0, -1)}[oa]` : color;
    if (new RegExp(`(?<![\\p{L}])${pattern}(?![\\p{L}])`, 'iu').test(folded)) return color;
  }
  return null;
}

function primaryColorOf(item: RankedCatalogItem): string | null {
  const label = String(item.label ?? '');
  const paren = label.match(/\(([^)]+)\)/);
  if (paren?.[1]) {
    const color = firstColorIn(paren[1]);
    if (color) return color;
  }
  const stripped = fold([item.nombre, item.label].filter(Boolean).join(' '))
    .replace(INCIDENTAL_PHRASE, ' ')
    .replace(/\bcomb(?:inado)?\b/g, ' ');
  return firstColorIn(stripped);
}

function hasType(item: RankedCatalogItem, type: string): boolean {
  const haystack = haystackOf(item);
  const folded = fold(type);
  if (haystack.includes(folded)) return true;
  if (folded === 'canguro' && /\b(hoodie|canguro|buzo)\b/.test(haystack)) return true;
  if (folded === 'buzo' && /\b(hoodie|canguro|buzo)\b/.test(haystack)) return true;
  if (folded === 'camiseta' && /\b(remera|camiseta)\b/.test(haystack)) return true;
  if (folded === 'remera' && /\b(remera|camiseta)\b/.test(haystack)) return true;
  return false;
}

function hasFabric(item: RankedCatalogItem, fabric: string): boolean {
  return haystackOf(item).includes(fold(fabric));
}

export function filterCatalogCandidates<T extends RankedCatalogItem>(
  candidates: T[],
  signals: CatalogSignals
): T[] {
  let next = [...candidates];
  const type = asTrimmed(signals.type);
  const size = asTrimmed(signals.size).toUpperCase();
  const color = stemColor(asTrimmed(signals.color));

  if (type) {
    const typed = next.filter((item) => hasType(item, type));
    if (typed.length) next = typed;
  }
  if (size) {
    const sized = next.filter((item) => {
      const itemSize = sizeOf(item);
      return itemSize === size;
    });
    if (sized.length) next = sized;
  }
  if (color) {
    const primary = next.filter((item) => primaryColorOf(item) === color);
    if (primary.length) next = primary;
  }
  return next;
}

/**
 * Prioridad: tipo → talle → color → tela/modelo → similitud textual.
 * Los atributos explícitos pesan mucho más que el texto sucio de la frase.
 */
export function attributeMatchScore(
  item: RankedCatalogItem,
  signals: CatalogSignals,
  textScore = 0
): number {
  let score = Math.min(8, Math.max(0, Number(textScore) || 0) * 0.08);
  const type = asTrimmed(signals.type);
  const size = asTrimmed(signals.size).toUpperCase();
  const color = stemColor(asTrimmed(signals.color));
  const fabric = fold(asTrimmed(signals.fabric));

  if (type) score += hasType(item, type) ? 40 : -25;
  const itemSize = sizeOf(item);
  if (size) {
    if (itemSize === size) score += 25;
    else if (itemSize) score -= 30;
  }
  const primary = primaryColorOf(item);
  if (color) {
    if (primary === color) score += 20;
    else if (primary) score -= 18;
    else if (haystackOf(item).includes(color)) score += 2;
  }
  if (fabric) score += hasFabric(item, fabric) ? 12 : 0;
  return score;
}

export function rankCatalogCandidates<T extends RankedCatalogItem>(
  candidates: T[],
  signals: CatalogSignals
): T[] {
  return filterCatalogCandidates(candidates, signals)
    .map((item) => ({ ...item, score: attributeMatchScore(item, signals, item.score) }))
    .sort((a, b) => b.score - a.score || (a.label || a.nombre).localeCompare(b.label || b.nombre, 'es'));
}

function isDominant(top: RankedCatalogItem, second?: RankedCatalogItem): boolean {
  if (!second) return true;
  if (top.score - second.score >= DOMINANT_GAP) return true;
  if (top.score >= 70 && second.score < 55) return true;
  return false;
}

export function decideCatalogMatch<T extends RankedCatalogItem>(
  candidates: T[],
  signals: CatalogSignals
): CatalogMatchDecision {
  const ranked = rankCatalogCandidates(candidates, signals);
  if (!ranked.length) return { status: 'none' };
  const top = ranked[0]!;
  if (isDominant(top, ranked[1])) return { status: 'unique', item: top };
  return {
    status: 'ambiguous',
    options: ranked.slice(0, WA_CHOICE_PAGE_SIZE),
    rest: ranked.slice(WA_CHOICE_PAGE_SIZE),
  };
}

export function decideClientMatch<T extends { nombre: string; score: number }>(
  candidates: T[]
): { status: 'unique'; item: T } | { status: 'ambiguous'; options: T[]; rest: T[] } | { status: 'none' } {
  const ranked = [...candidates].sort((a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre, 'es'));
  if (!ranked.length) return { status: 'none' };
  const top = ranked[0]!;
  const second = ranked[1];
  if (!second || (top.score >= 90 && top.score - second.score >= 15)) {
    return { status: 'unique', item: top };
  }
  return {
    status: 'ambiguous',
    options: ranked.slice(0, WA_CHOICE_PAGE_SIZE),
    rest: ranked.slice(WA_CHOICE_PAGE_SIZE),
  };
}

export function mergeAttributes(
  base?: LineItemAttributes,
  inferred?: LineItemAttributes
): LineItemAttributes | undefined {
  const next: LineItemAttributes = { ...(base ?? {}), ...(inferred ?? {}) };
  return Object.values(next).some(Boolean) ? next : undefined;
}

export function pageChoicePool<T>(pool: T[], offset = 0, size = WA_CHOICE_PAGE_SIZE): { shown: T[]; rest: T[] } {
  const start = Math.max(0, offset);
  return {
    shown: pool.slice(start, start + size),
    rest: pool.slice(start + size),
  };
}
