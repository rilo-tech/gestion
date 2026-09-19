import type { LineItemAttributes, LineItemIntent } from './conversation-contract.ts';
import { WA_CHOICE_PAGE_SIZE } from '../../shared/whatsapp-format.ts';
import { inferNombreBase } from '../../shared/product-display-name.ts';

/** Tipos de prenda (mutuamente excluyentes salvo alias explícitos canguro/buzo/hoodie). */
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
  'body',
  'enterito',
  'conjunto',
] as const;

/** Materiales / telas — mutuamente excluyentes entre grupos. */
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

/** Modelos / atributos de línea (no son tipo). */
const MODEL_FEATURE_TOKENS = [
  'polo',
  'cool',
  'dama',
  'oversize',
  'termica',
  'nino',
  'nina',
  'unisex',
  'slim',
  'wide',
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

const SIZE_RE = /\b(?:talle\s+)?(xxxxl|xxxl|xxl|xl|xs|s|m|l|2xl|3xl|4xl|5xl|\d{1,2})\b/i;
const INCIDENTAL_PHRASE =
  /\b(?:comb(?:inado)?|con)?\s*(?:manga|cuello|detalle|vivo|cordon|cordón|interior)\s+[a-zñ]+/gi;

/** dry ≠ dry cool: si el candidato tiene un modelo extra no pedido, penalizar. */
const MUTUALLY_EXCLUSIVE_FABRICS: string[][] = [
  ['dry', 'algodon'],
  ['felpa', 'jersey'],
  ['felpa', 'pique'],
  ['frisa', 'terry'],
];

export type CatalogSignals = {
  type?: string | null;
  fabric?: string | null;
  color?: string | null;
  size?: string | null;
  /** Tokens de modelo explícitos (polo, cool, dama…). */
  models?: string[];
};

export type RankedCatalogItem = {
  id: string;
  nombre: string;
  label?: string;
  score: number;
  precioVenta?: number;
  nombreBase?: string;
  color?: string;
  talle?: string;
};

export type CatalogMatchKind =
  | 'EXACT'
  | 'HIGH_CONFIDENCE'
  | 'FAMILY_MATCH_VARIANT_MISSING'
  | 'AMBIGUOUS'
  | 'NO_MATCH';

export type CatalogMatchDecision =
  | { status: 'unique'; item: RankedCatalogItem; kind: 'EXACT' | 'HIGH_CONFIDENCE' }
  | {
      status: 'ambiguous';
      options: RankedCatalogItem[];
      rest: RankedCatalogItem[];
      kind: 'AMBIGUOUS' | 'FAMILY_MATCH_VARIANT_MISSING';
      missingVariant?: string;
      familyLabel?: string;
      queryLabel?: string;
    }
  | { status: 'none'; kind: 'NO_MATCH' };

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

function hasWholeToken(haystack: string, token: string): boolean {
  const t = fold(token);
  if (!t) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(t)}(?![\\p{L}\\p{N}])`, 'iu').test(fold(haystack));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractSpokenProductType(text: string): string | null {
  const haystack = fold(text);
  for (const type of PRODUCT_TYPE_TOKENS) {
    if (hasWholeToken(haystack, type)) return type;
  }
  // polo solo no es tipo; chomba≈polo como tipo si aparece sin remesa/camiseta
  if (hasWholeToken(haystack, 'polo') && !hasWholeToken(haystack, 'remera') && !hasWholeToken(haystack, 'camiseta')) {
    return 'chomba';
  }
  return null;
}

export function extractSpokenFabric(text: string): string | null {
  const haystack = fold(text);
  for (const fabric of FABRIC_TOKENS) {
    if (hasWholeToken(haystack, fabric)) return fabric;
  }
  // typo común dri → dry
  if (/\bdri\b/.test(haystack)) return 'dry';
  return null;
}

export function extractSpokenModels(text: string): string[] {
  const haystack = fold(text);
  const found: string[] = [];
  for (const model of MODEL_FEATURE_TOKENS) {
    if (hasWholeToken(haystack, model)) found.push(model);
  }
  return found;
}

export function signalsFromItem(item: Pick<LineItemIntent, 'rawText' | 'productHint' | 'attributes'>): CatalogSignals {
  const attrs = item.attributes ?? {};
  const spoken = [item.productHint, item.rawText].filter(Boolean).join(' ');
  const spokenSize = spoken.match(SIZE_RE)?.[1];
  const models = extractSpokenModels(spoken);
  // "polo" en Remera Polo es modelo, no tipo chomba
  const type =
    asTrimmed(attrs.type) ||
    extractSpokenProductType(spoken) ||
    (models.includes('polo') && hasWholeToken(spoken, 'remera')
      ? 'remera'
      : models.includes('polo') && hasWholeToken(spoken, 'camiseta')
        ? 'camiseta'
        : null);
  let fabric = asTrimmed(attrs.fabric) || extractSpokenFabric(spoken) || null;
  // Remitos «gris melange»: melange no es tela del catálogo.
  if (fabric && fold(fabric) === 'melange') fabric = null;
  const colorRaw = asTrimmed(attrs.color) || firstColorIn(spoken) || '';
  return {
    type: type || null,
    fabric,
    color: stemColor(colorRaw),
    size: asTrimmed(attrs.size).toUpperCase() || (spokenSize ? spokenSize.toUpperCase() : null),
    models,
  };
}

/** Query limpia: tipo + modelos + tela + color + talle. */
export function cleanCatalogQuery(item: LineItemIntent): string {
  const signals = signalsFromItem(item);
  const hint = asTrimmed(item.productHint);
  const raw = asTrimmed(item.rawText);
  const head = signals.type || firstDistinctiveToken(hint || raw);
  const parts = [head, ...(signals.models ?? []), signals.fabric, signals.color, signals.size]
    .map(asTrimmed)
    .filter(Boolean);
  const unique: string[] = [];
  for (const part of parts) {
    const folded = fold(part);
    if (!folded) continue;
    if (unique.some((existing) => fold(existing) === folded)) continue;
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
  return fold([item.nombre, item.label, item.nombreBase].filter(Boolean).join(' '));
}

function sizeOf(item: RankedCatalogItem): string | null {
  if (item.talle) return String(item.talle).trim().toUpperCase() || null;
  const match = `${item.label ?? ''} ${item.nombre}`.match(SIZE_RE);
  return match?.[1] ? match[1].toUpperCase() : null;
}

function stemColor(raw: string): string {
  const folded = fold(raw);
  if (!folded) return '';
  if (folded.startsWith('blanc')) return 'blanco';
  if (folded.startsWith('roj')) return 'rojo';
  if (folded.startsWith('negr')) return 'negro';
  if (folded.startsWith('amarill')) return 'amarillo';
  // Remitos: «gris melange», «azul marino», etc. → color canónico.
  if (/\bmelange\b/.test(folded) || /\bgris\b/.test(folded)) return 'gris';
  for (const color of COLOR_TOKENS) {
    const pattern = color.endsWith('o') ? `${color.slice(0, -1)}[oa]` : color;
    if (new RegExp(`(?<![\\p{L}])${pattern}(?![\\p{L}])`, 'iu').test(folded)) return color;
  }
  return folded;
}

function firstColorIn(text: string): string | null {
  const folded = fold(text);
  if (/\bmelange\b/.test(folded)) return 'gris';
  for (const color of COLOR_TOKENS) {
    const pattern = color.endsWith('o') ? `${color.slice(0, -1)}[oa]` : color;
    if (new RegExp(`(?<![\\p{L}])${pattern}(?![\\p{L}])`, 'iu').test(folded)) return color;
  }
  return null;
}

function primaryColorOf(item: RankedCatalogItem): string | null {
  if (item.color) {
    const c = stemColor(item.color);
    if (c) return c;
  }
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

/** Remera ≠ Camiseta. Solo canguro/buzo/hoodie son aliases. */
function hasType(item: RankedCatalogItem, type: string): boolean {
  const haystack = haystackOf(item);
  const folded = fold(type);
  if (hasWholeToken(haystack, folded)) return true;
  if (folded === 'canguro' && (hasWholeToken(haystack, 'hoodie') || hasWholeToken(haystack, 'buzo'))) return true;
  if (folded === 'buzo' && (hasWholeToken(haystack, 'hoodie') || hasWholeToken(haystack, 'canguro'))) return true;
  if (folded === 'hoodie' && (hasWholeToken(haystack, 'canguro') || hasWholeToken(haystack, 'buzo'))) return true;
  if (folded === 'chomba' && hasWholeToken(haystack, 'polo') && !hasWholeToken(haystack, 'remera')) return true;
  return false;
}

function hasFabric(item: RankedCatalogItem, fabric: string): boolean {
  return hasWholeToken(haystackOf(item), fabric);
}

function itemModelTokens(item: RankedCatalogItem): string[] {
  return extractSpokenModels(haystackOf(item));
}

function fabricConflicts(queryFabric: string, item: RankedCatalogItem): boolean {
  const q = fold(queryFabric);
  if (!q) return false;
  const hay = haystackOf(item);
  for (const group of MUTUALLY_EXCLUSIVE_FABRICS) {
    if (!group.includes(q)) continue;
    for (const other of group) {
      if (other === q) continue;
      if (hasWholeToken(hay, other)) return true;
    }
  }
  return false;
}

/**
 * Clave de familia: nombreBase + color (sin talle).
 * Preferí campos estructurados; si faltan, inferí del display name.
 */
export function catalogFamilyKey(item: RankedCatalogItem): string {
  const color = primaryColorOf(item) || '';
  const size = sizeOf(item);
  const base =
    asTrimmed(item.nombreBase) ||
    inferNombreBase(item.nombre || item.label || '', item.color || color, item.talle || size || '') ||
    String(item.nombre || '')
      .replace(SIZE_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return fold([base, color].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
}

export function queryFamilyKey(signals: CatalogSignals, queryText = ''): string {
  const parts = [
    signals.type,
    ...(signals.models ?? []),
    signals.fabric,
    signals.color,
  ]
    .map(asTrimmed)
    .filter(Boolean);
  if (parts.length) return fold(parts.join(' ')).replace(/\s+/g, ' ').trim();
  return fold(String(queryText ?? '').replace(SIZE_RE, ' ')).replace(/\s+/g, ' ').trim();
}

export function familyLabelFromSignals(signals: CatalogSignals, fallback = ''): string {
  const parts = [
    signals.type ? capitalize(signals.type) : null,
    ...(signals.models ?? []).map(capitalize),
    signals.fabric ? capitalize(signals.fabric) : null,
    signals.color ? capitalize(signals.color) : null,
  ].filter(Boolean);
  return parts.join(' ') || fallback;
}

function capitalize(value: string): string {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (/^(xl|xxl|xxxl|xs|s|m|l)$/i.test(v)) return v.toUpperCase();
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

/**
 * Soft filter: NO vaciar el pool si falta el talle (eso empuja a fuzzy lejano).
 * Conservá familia y dejá que decideCatalogMatch marque FAMILY_MATCH_VARIANT_MISSING.
 */
export function filterCatalogCandidates<T extends RankedCatalogItem>(
  candidates: T[],
  signals: CatalogSignals,
  opts?: { requireSize?: boolean }
): T[] {
  let next = [...candidates];
  const type = asTrimmed(signals.type);
  const size = asTrimmed(signals.size).toUpperCase();
  const color = stemColor(asTrimmed(signals.color));
  const fabric = fold(asTrimmed(signals.fabric));
  const models = signals.models ?? [];

  if (type) {
    const typed = next.filter((item) => hasType(item, type));
    if (typed.length) next = typed;
  }
  if (models.length) {
    const modeled = next.filter((item) => models.every((m) => hasWholeToken(haystackOf(item), m)));
    if (modeled.length) next = modeled;
  }
  if (fabric) {
    const fab = next.filter((item) => hasFabric(item, fabric) && !fabricConflicts(fabric, item));
    if (fab.length) next = fab;
  }
  if (color) {
    const primary = next.filter((item) => primaryColorOf(item) === color);
    if (primary.length) next = primary;
  }
  if (size && opts?.requireSize !== false) {
    const sized = next.filter((item) => sizeOf(item) === size);
    if (sized.length) next = sized;
    // Si no hay talle exacto: NO vaciar; el caller decide family_missing.
  }
  return next;
}

/**
 * Score jerárquico: tipo/modelo/tela/color son hard; talle pesa pero no borra familia.
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
  const models = signals.models ?? [];

  if (type) {
    if (hasType(item, type)) score += 40;
    else score -= 80; // remesa ≠ camiseta
  }

  for (const model of models) {
    if (hasWholeToken(haystackOf(item), model)) score += 18;
    else score -= 55;
  }
  // Modelos extras en el candidato no pedidos (cool, dama…)
  for (const extra of itemModelTokens(item)) {
    if (!models.includes(extra) && MODEL_FEATURE_TOKENS.includes(extra as (typeof MODEL_FEATURE_TOKENS)[number])) {
      score -= 22;
    }
  }

  if (fabric) {
    if (fabricConflicts(fabric, item)) score -= 70;
    else if (hasFabric(item, fabric)) score += 16;
    else score -= 45;
  }

  const itemSize = sizeOf(item);
  if (size) {
    if (itemSize === size) score += 25;
    else if (itemSize) score -= 8; // misma familia, otra variante: leve
  }

  const primary = primaryColorOf(item);
  if (color) {
    if (primary === color) score += 20;
    else if (primary) score -= 50;
    else if (haystackOf(item).includes(color)) score += 2;
  }

  return score;
}

export function rankCatalogCandidates<T extends RankedCatalogItem>(
  candidates: T[],
  signals: CatalogSignals
): T[] {
  return [...candidates]
    .map((item) => ({ ...item, score: attributeMatchScore(item, signals, item.score) }))
    .filter((item) => item.score > -40)
    .sort((a, b) => b.score - a.score || (a.label || a.nombre).localeCompare(b.label || b.nombre, 'es'));
}

function isDominant(top: RankedCatalogItem, second?: RankedCatalogItem): boolean {
  if (!second) return true;
  if (top.score - second.score >= DOMINANT_GAP) return true;
  if (top.score >= 70 && second.score < 55) return true;
  return false;
}

function isExactNameMatch(query: string, item: RankedCatalogItem): boolean {
  const q = fold(query).replace(/\s+/g, ' ').trim();
  const names = [item.nombre, item.label].map((n) => fold(String(n ?? '')).replace(/\s+/g, ' ').trim());
  return names.some((n) => n === q);
}

/**
 * Matching jerárquico:
 * 1) exact / high confidence con talle
 * 2) familia correcta sin talle → FAMILY_MATCH_VARIANT_MISSING
 * 3) ambiguous dentro del grupo semántico
 * 4) none (no listas fuzzy infinitas)
 */
export function decideCatalogMatch<T extends RankedCatalogItem>(
  candidates: T[],
  signals: CatalogSignals,
  queryText = ''
): CatalogMatchDecision {
  if (!candidates.length) return { status: 'none', kind: 'NO_MATCH' };

  const size = asTrimmed(signals.size).toUpperCase();
  const withSize = filterCatalogCandidates(candidates, signals, { requireSize: true });
  const sizedOnly = size
    ? withSize.filter((item) => sizeOf(item) === size)
    : withSize;

  // Pool con constraints duros EXCEPTO talle.
  const familyPool = filterCatalogCandidates(candidates, { ...signals, size: null }, { requireSize: false });
  const rankedFamily = rankCatalogCandidates(familyPool, { ...signals, size: null });
  const rankedSized = rankCatalogCandidates(
    sizedOnly.length ? sizedOnly : withSize.filter((item) => !size || sizeOf(item) === size),
    signals
  );

  // Exact name
  if (queryText) {
    const exact = candidates.filter((item) => isExactNameMatch(queryText, item));
    if (exact.length === 1) {
      return { status: 'unique', item: { ...exact[0]!, score: 100 }, kind: 'EXACT' };
    }
  }

  if (rankedSized.length) {
    const top = rankedSized[0]!;
    if (top.score < 20) {
      // demasiado bajo → no forzar unique
    } else if (isDominant(top, rankedSized[1]) && top.score >= 45) {
      const kind = isExactNameMatch(queryText, top) || top.score >= 90 ? 'EXACT' : 'HIGH_CONFIDENCE';
      return { status: 'unique', item: top, kind };
    } else if (rankedSized.length >= 2 && rankedSized[0]!.score >= 35) {
      return {
        status: 'ambiguous',
        options: rankedSized.slice(0, WA_CHOICE_PAGE_SIZE),
        rest: rankedSized.slice(WA_CHOICE_PAGE_SIZE),
        kind: 'AMBIGUOUS',
        queryLabel: queryText || familyLabelFromSignals(signals),
      };
    }
  }

  // Familia correcta, falta variante
  if (size && rankedFamily.length) {
    const qFamily = queryFamilyKey(signals, queryText);
    const aligned = rankedFamily.filter((item) => {
      const key = catalogFamilyKey(item);
      if (!qFamily) return item.score >= 40;
      return key === qFamily || key.includes(qFamily) || qFamily.includes(key) || item.score >= 50;
    });
    const pool = (aligned.length ? aligned : rankedFamily.filter((item) => item.score >= 40)).filter(
      (item) => sizeOf(item) !== size
    );
    if (pool.length) {
      const sorted = [...pool].sort(
        (a, b) => b.score - a.score || (a.label || a.nombre).localeCompare(b.label || b.nombre, 'es')
      );
      // Preferir misma familyKey dominante
      const topKey = catalogFamilyKey(sorted[0]!);
      const sameFamily = sorted.filter((item) => catalogFamilyKey(item) === topKey);
      const use = sameFamily.length ? sameFamily : sorted;
      return {
        status: 'ambiguous',
        options: use.slice(0, WA_CHOICE_PAGE_SIZE),
        rest: use.slice(WA_CHOICE_PAGE_SIZE),
        kind: 'FAMILY_MATCH_VARIANT_MISSING',
        missingVariant: size,
        familyLabel: familyLabelFromSignals(signals, topKey),
        queryLabel: queryText || `${familyLabelFromSignals(signals)} ${size}`.trim(),
      };
    }
  }

  // Fuzzy/semántico: umbral alto para no listar irrelevantes (Case D → not_found).
  const rankedAll = rankCatalogCandidates(candidates, signals).filter((item) => item.score >= 45);
  if (!rankedAll.length) return { status: 'none', kind: 'NO_MATCH' };
  const top = rankedAll[0]!;
  if (isDominant(top, rankedAll[1]) && top.score >= 55) {
    return { status: 'unique', item: top, kind: 'HIGH_CONFIDENCE' };
  }
  return {
    status: 'ambiguous',
    options: rankedAll.slice(0, WA_CHOICE_PAGE_SIZE),
    rest: rankedAll.slice(WA_CHOICE_PAGE_SIZE),
    kind: 'AMBIGUOUS',
    queryLabel: queryText || familyLabelFromSignals(signals),
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

/** Presentación FAMILY_MATCH_VARIANT_MISSING. */
export function presentFamilyVariantMissing(input: {
  queryLabel: string;
  familyLabel: string;
  missingVariant: string;
  options: Array<{ name: string }>;
  hasMore?: boolean;
  /** Si false, el caller agrega acciones + nota de talle después. */
  includeTalleNote?: boolean;
}): string {
  const lines = input.options.map((row, i) => `${i + 1}. ${row.name}`);
  if (input.hasMore) lines.push(`${lines.length + 1}. 🔎 Ver más opciones`);
  const parts = [
    `📦 No encontré exactamente ${input.queryLabel}.`,
    '',
    `Encontré esta misma línea:`,
    ...lines,
  ];
  if (input.includeTalleNote !== false) {
    parts.push('', `El talle ${input.missingVariant} no está creado.`);
  }
  return parts.join('\n');
}
