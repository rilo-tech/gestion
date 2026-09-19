import { db } from '../firebase.ts';
import { findProductAlias } from './product-aliases.ts';
import { findClientAlias, findSupplierAlias } from './operator-memory.ts';
import { pickClientsWithAi, pickProductsWithAi } from './catalog-ai.ts';
import {
  formatLocalPhone,
  looksLikePhoneQuery,
  nameTokensWithoutPhone,
  parsePersonNameAndPhone,
  phoneMatchKey,
} from './client-identity.ts';
import { entityLookupCandidates, extractPartyRawFromUtterance, findSpokenPartySpan } from './entity-name.ts';
import { formatOrderFinanceLines, formatOrderExtraCostLines, formatSpokenMoney, planRelatedOrderFinance } from './order-finance.ts';
import { decideCatalogMatch, decideClientMatch, signalsFromItem } from './catalog-rank.ts';
import {
  formatChoiceMessage,
  formatWhatsappMessage,
  waBold,
  waAskSiNo,
  waAskConfirmo,
  waCard,
} from '../../shared/whatsapp-format.ts';
import { isNonProductUtterance, isPlaceholderProductLabel } from './conversation-speech.ts';

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Frases de comando, no un detalle real del pedido. */
export function isGenericWhatsappNotes(value: string): boolean {
  const text = normalizeName(value);
  if (!text) return true;
  if (text === 'mensaje de audio de whatsapp' || text === 'mensaje con foto de whatsapp') return true;
  if (
    /^(hola|holaa+|buenas|hey)?\s*(quiero|queria|necesito|necesito que|podes|podrias)?\s*(hacer|anotar|cargar|tomar|registrar)?\s*(un|una)?\s*(pedido|orden|venta|compra)\s*(por whatsapp)?$/.test(
      text
    )
  ) {
    return true;
  }
  if (/^(un\s+)?(pedido|orden)$/.test(text)) return true;
  if (/\bfecha de entrega\b/.test(text)) return true;
  if (/\bregistr[aeo]\b.*\bcosto/.test(text) || /\bcosto extra\b/.test(text)) return true;
  return false;
}

/** Quita fecha/costo/comandos y deja solo un posible detalle de descripción. */
export function stripOperationalPhrases(text: string): string {
  return clipForeignOrderFields(String(text ?? ''))
    .replace(/\bfecha de entrega\b[^.,;]*/gi, ' ')
    .replace(/\bregistr[aeá]\s+(el\s+)?costo extra\b[^.,;]*/gi, ' ')
    .replace(/\bcosto extra\b[^.,;]*/gi, ' ')
    .replace(/\b(entrega(?:r)?(?:lo)?|para el(?: d[ií]a)?)\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 /.-]{1,40}/gi, ' ')
    .replace(
      /\b(hoy|ma[nñ]ana|pasado\s+ma[nñ]ana|(el\s+)?(pr[oó]ximo\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(\s+que viene)?)\b/gi,
      ' '
    )
    .replace(/[.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pago, importe, estado y fecha no pertenecen a la descripción. Familias semánticas, no frases fijas. */
function clipForeignOrderFields(text: string): string {
  return String(text ?? '')
    .replace(
      /(?<![\p{L}])(?:ya\s+)?(?:est[aá]|qued[oó]|sali[oó])\s+(?:todo\s+)?(?:pag[oa]|pagad[oa]|cobrad[oa]|saldad[oa]|abonad[oa]).*$/giu,
      ' '
    )
    .replace(/(?<![\p{L}])(?:me\s+)?(?:pag[oó]|cobr[oó]|sald[oó]|abon[oó])\b.*$/giu, ' ')
    .replace(
      /(?<![\p{L}])(?:pon(?:e[eé])?lo|pasalo|dejalo|marcalo)\s+(?:el\s+pedido\s+)?(?:en\s+|a\s+|como\s+)?(?:estado\s+)?(?:listo|pendiente|entregad[oa]|pronto).*$/giu,
      ' '
    )
    .replace(/\$\s*[\d.][\d.,]*.*$/g, ' ');
}

export function looksLikeOperationalFollowUp(text: string): boolean {
  const leftover = stripOperationalPhrases(text);
  return leftover.length < 3;
}

export function sanitizeOrderNotes(value: string | undefined | null): string | undefined {
  const text = String(value ?? '').trim();
  if (!text || isGenericWhatsappNotes(text)) return undefined;
  let leftover = stripOperationalPhrases(text);
  const design = leftover.match(/^(?:con\s+)?dise[nñ]o(?:\s+(?:que\s+(?:diga|dice)|de|es))?\s*:?\s*(.+)$/i);
  if (design?.[1]) leftover = design[1].trim();
  leftover = leftover.replace(/^(?:con\s+)?dise[nñ]o(?:\s+de)?\s+/i, '').trim();
  leftover = leftover.replace(/^[a-záéíóúüñ]/, (ch) => ch.toUpperCase());
  if (!leftover || leftover.length < 2 || isGenericWhatsappNotes(leftover)) return undefined;
  return leftover.slice(0, 240);
}

export type MatchResolveOptions = {
  preferChoices?: boolean;
  /** Frase de ESE ítem, no el mensaje entero con varios productos. */
  utterance?: string;
  /** Mensaje completo, solo como contexto secundario. */
  messageContext?: string;
  attributes?: { type?: string | null; fabric?: string | null; color?: string | null; size?: string | null };
};

export type MatchedClient = { id: string; nombre: string; score: number };
export type MatchedStockItem = {
  id: string;
  nombre: string;
  label: string;
  precioVenta: number;
  costo: number;
  score: number;
};

/** Sinónimos frecuentes en boletas vs catálogo (indumentaria Latam). */
const TOKEN_SYNONYMS: Record<string, string[]> = {
  terry: ['felpa', 'frisa', 'frizado'],
  felpa: ['terry', 'frisa', 'frizado'],
  frisa: ['felpa', 'terry', 'frizado'],
  frizado: ['felpa', 'terry', 'frisa'],
  hoodie: ['canguro', 'canguros', 'buzo'],
  canguro: ['hoodie', 'canguros', 'buzo'],
  canguros: ['hoodie', 'canguro', 'buzo'],
  buzo: ['canguro', 'hoodie', 'canguros'],
  remera: ['playera', 'camiseta'],
  remeras: ['playeras', 'camisetas'],
  playera: ['remera', 'camiseta'],
  camiseta: ['remera', 'playera'],
  camisetas: ['remeras', 'playeras'],
  sublimatica: ['sublimacion', 'sublimado'],
  sublimacion: ['sublimatica', 'sublimado'],
  sublimado: ['sublimatica', 'sublimacion'],
  jarro: ['taza', 'mug', 'taza aa'],
  taza: ['jarro', 'mug', 'jarro sublimable'],
  mug: ['taza', 'jarro'],
  jarra: ['chopp', 'vaso'],
  chopp: ['jarra'],
};

const COLOR_STEM: Record<string, string> = {
  negro: 'negro',
  negra: 'negro',
  negros: 'negro',
  negras: 'negro',
  black: 'negro',
  blanco: 'blanco',
  blanca: 'blanco',
  blancos: 'blanco',
  blancas: 'blanco',
  white: 'blanco',
  rojo: 'rojo',
  roja: 'rojo',
  rojos: 'rojo',
  rojas: 'rojo',
  red: 'rojo',
  gris: 'gris',
  grises: 'gris',
  gray: 'gris',
  grey: 'gris',
  azul: 'azul',
  azules: 'azul',
  blue: 'azul',
  navy: 'azul',
  marino: 'azul',
  verde: 'verde',
  verdes: 'verde',
  green: 'verde',
  rosa: 'rosa',
  rosado: 'rosa',
  rosada: 'rosa',
  pink: 'rosa',
  beige: 'beige',
  marron: 'marron',
  brown: 'marron',
  naranja: 'naranja',
  orange: 'naranja',
  violeta: 'violeta',
  lila: 'violeta',
  purple: 'violeta',
  celeste: 'celeste',
  turquesa: 'turquesa',
  fucsia: 'fucsia',
  magenta: 'fucsia',
  bordo: 'bordo',
  bordeaux: 'bordo',
  borgona: 'bordo',
  vino: 'bordo',
  crema: 'crema',
  mostaza: 'mostaza',
  coral: 'coral',
  salmon: 'salmon',
  dorado: 'dorado',
  dorada: 'dorado',
  plateado: 'plateado',
  plateada: 'plateado',
  nude: 'nude',
  camel: 'camel',
  khaki: 'khaki',
  amarillo: 'amarillo',
  amarilla: 'amarillo',
  amarillos: 'amarillo',
  amarillas: 'amarillo',
  yellow: 'amarillo',
  natural: 'natural',
  crudo: 'crudo',
  arena: 'arena',
};

const SIZE_TOKENS = new Set([
  'xxxs',
  'xxs',
  'xs',
  's',
  'm',
  'l',
  'xl',
  'xxl',
  'xxxl',
  'xxxxl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
]);

/** Códigos de proveedor/tela (SW, SL) que no son talle ni color. */
function isProductNoiseToken(token: string): boolean {
  if (SIZE_TOKENS.has(token) || COLOR_STEM[token]) return false;
  return token.length <= 2;
}

const NAME_WORD_STOP = new Set([
  'de',
  'del',
  'la',
  'el',
  'en',
  'con',
  'para',
  'por',
  'pack',
  'un',
  'una',
  'the',
  'and',
  'talle',
  'talla',
  'color',
  'modelo',
]);

function tokensRelated(a: string, b: string): boolean {
  if (a === b) return true;
  if (COLOR_STEM[a] && COLOR_STEM[a] === COLOR_STEM[b]) return true;
  const synA = TOKEN_SYNONYMS[a] ?? [];
  const synB = TOKEN_SYNONYMS[b] ?? [];
  return synA.includes(b) || synB.includes(a);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

export function personNamesLookRelated(hint: string, name: string): boolean {
  const query = normalizeName(hint);
  const nombre = normalizeName(name);
  if (!query || !nombre) return false;
  if (nombre === query || nombre.includes(query) || query.includes(nombre)) return true;
  const queryToken = query.split(/\s+/)[0] ?? '';
  const nameToken = nombre.split(/\s+/)[0] ?? '';
  return personTokenRelated(queryToken, nameToken) || scorePersonNameMatch(query, nombre) >= 45;
}

function personTokenRelated(queryToken: string, nameToken: string): boolean {
  if (queryToken === nameToken) return true;
  if (queryToken.length >= 3 && nameToken.length >= 3) {
    if (nameToken.startsWith(queryToken) || queryToken.startsWith(nameToken)) return true;
  }
  if (queryToken.length >= 5 && nameToken.length >= 5) {
    const dist = levenshtein(queryToken, nameToken);
    const maxLen = Math.max(queryToken.length, nameToken.length);
    if (dist <= 2 && dist / maxLen <= 0.4) return true;
    if (queryToken.slice(0, 3) === nameToken.slice(0, 3) && dist <= 3) return true;
  }
  return false;
}

function productTokens(normalized: string): string[] {
  return String(normalized ?? '')
    .split(/[\s/,._-]+/)
    .filter(Boolean);
}

function sizeTokensOf(tokens: string[]): string[] {
  return tokens.filter((token) => SIZE_TOKENS.has(token));
}

function colorStemsOf(tokens: string[]): string[] {
  return [...new Set(tokens.map((token) => COLOR_STEM[token]).filter((stem): stem is string => Boolean(stem)))];
}

/** Si la boleta trae color, el ítem tiene que compartir ese color. */
function sharesQueryColor(queryNormalized: string, itemNormalized: string): boolean {
  const queryColors = colorStemsOf(productTokens(queryNormalized));
  if (!queryColors.length) return true;
  const itemColors = colorStemsOf(productTokens(itemNormalized));
  return queryColors.some((color) => itemColors.includes(color));
}

function isNameWordToken(token: string): boolean {
  if (!token || NAME_WORD_STOP.has(token)) return false;
  if (SIZE_TOKENS.has(token) || COLOR_STEM[token]) return false;
  if (isProductNoiseToken(token)) return false;
  return token.length >= 3;
}

function tokenFits(queryToken: string, nameToken: string): boolean {
  if (tokensRelated(queryToken, nameToken)) return true;
  if (
    queryToken.length >= 6 &&
    nameToken.length >= 6 &&
    queryToken.slice(0, 6) === nameToken.slice(0, 6)
  ) {
    return true;
  }
  if (queryToken.length <= 3 || nameToken.length <= 3) return false;
  return (
    nameToken.startsWith(queryToken) ||
    queryToken.startsWith(nameToken) ||
    nameToken.includes(queryToken) ||
    queryToken.includes(nameToken)
  );
}

function tokenKey(token: string): string {
  return COLOR_STEM[token] || token;
}

function coreProductPhrase(tokens: string[]): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (NAME_WORD_STOP.has(token) || isProductNoiseToken(token)) continue;
    const key = tokenKey(token);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }
  return unique.join(' ');
}

function namePhraseBonus(queryNameWords: string[], nameTokens: string[]): number {
  if (queryNameWords.length < 2) return 0;
  for (let i = 0; i < queryNameWords.length - 1; i++) {
    const first = queryNameWords[i]!;
    const second = queryNameWords[i + 1]!;
    for (let j = 0; j < nameTokens.length - 1; j++) {
      if (tokenFits(first, nameTokens[j]!) && tokenFits(second, nameTokens[j + 1]!)) return 2;
    }
  }
  return 0;
}

function catalogCloseness(params: {
  queryNameWords: string[];
  nameOverlap: number;
  extraNameTokens: number;
  extraColors: number;
}): number {
  const needed = Math.max(params.queryNameWords.length, 1);
  let closeness = Math.round((params.nameOverlap / needed) * 10);
  if (params.queryNameWords.length && params.nameOverlap === params.queryNameWords.length) closeness += 4;
  closeness -= params.extraNameTokens * 2;
  closeness -= params.extraColors * 3;
  return Math.max(0, Math.min(19, closeness));
}

/**
 * Ranking de catálogo (boleta → stock):
 * 80–100 color + talle + alguna palabra del nombre (el más limpio arriba)
 * 55–74  mismo color + palabra, otro talle
 * 30–49  el resto (nombre / talle si la boleta no trajo color)
 */
function scoreProductCatalogMatch(query: string, itemNormalized: string): number {
  if (!query || !itemNormalized) return 0;
  if (!sharesQueryColor(query, itemNormalized)) return 0;

  const queryTokens = productTokens(query);
  const nameTokens = productTokens(itemNormalized);
  const queryCore = coreProductPhrase(queryTokens);
  const nameCore = coreProductPhrase(nameTokens);
  if (queryCore && queryCore === nameCore) return 100;

  const querySizes = sizeTokensOf(queryTokens);
  const nameSizes = sizeTokensOf(nameTokens);
  const queryColors = colorStemsOf(queryTokens);
  const nameColors = colorStemsOf(nameTokens);
  const queryNameWords = queryTokens.filter(isNameWordToken);
  const nameOverlap = queryNameWords.filter((token) =>
    nameTokens.some((nameToken) => tokenFits(token, nameToken))
  ).length;
  const sizeMatch =
    querySizes.length > 0 && nameSizes.length > 0 && querySizes.some((size) => nameSizes.includes(size));
  const colorMatch =
    queryColors.length > 0 && nameColors.length > 0 && queryColors.some((color) => nameColors.includes(color));

  if (queryNameWords.length && nameOverlap === 0) return 0;
  if (!queryNameWords.length && !sizeMatch && !colorMatch) return 0;

  const extraNameTokens = nameTokens.filter(
    (token) =>
      isNameWordToken(token) && !queryNameWords.some((queryToken) => tokenFits(queryToken, token))
  ).length;
  const extraColors = nameColors.filter((color) => !queryColors.includes(color)).length;
  const closeness =
    catalogCloseness({ queryNameWords, nameOverlap, extraNameTokens, extraColors }) +
    namePhraseBonus(queryNameWords, nameTokens);

  if (colorMatch && sizeMatch && (nameOverlap > 0 || !queryNameWords.length)) {
    return Math.min(99, 80 + Math.min(19, closeness));
  }
  if (colorMatch && (nameOverlap > 0 || !queryNameWords.length)) {
    return Math.min(74, 55 + Math.min(19, closeness));
  }
  if (sizeMatch && nameOverlap > 0 && !queryColors.length) {
    return Math.min(74, 55 + Math.min(19, closeness));
  }
  return Math.min(49, 30 + Math.min(19, closeness));
}

function scoreNameMatch(query: string, nombreNormalized: string): number {
  if (!query || !nombreNormalized) return 0;
  if (nombreNormalized === query) return 100;

  const queryTokens = productTokens(query);
  const nameTokens = productTokens(nombreNormalized);
  const querySizes = sizeTokensOf(queryTokens);
  const nameSizes = sizeTokensOf(nameTokens);
  const queryColors = colorStemsOf(queryTokens);
  const nameColors = colorStemsOf(nameTokens);
  if (!sharesQueryColor(query, nombreNormalized)) return 0;

  const queryNameWords = queryTokens.filter(isNameWordToken);
  const nameOverlap = queryNameWords.filter((token) =>
    nameTokens.some((nameToken) => tokenFits(token, nameToken))
  ).length;
  const sizeMatch =
    querySizes.length > 0 && nameSizes.length > 0 && querySizes.some((size) => nameSizes.includes(size));
  const colorMatch =
    queryColors.length > 0 && nameColors.length > 0 && queryColors.some((color) => nameColors.includes(color));

  if (queryNameWords.length && nameOverlap === 0) return 0;
  if (!queryNameWords.length && !sizeMatch && !colorMatch) return 0;

  let score = 40 + nameOverlap * 14;
  if (sizeMatch) score += 18;
  if (colorMatch) score += 18;
  if (
    (nombreNormalized.startsWith(query) || query.startsWith(nombreNormalized)) &&
    Math.abs(queryTokens.length - nameTokens.length) <= 2
  ) {
    score = Math.max(score, 80);
  }
  return Math.min(96, score);
}

/** Nombres de persona: ignora el celular colgado al nombre. No asume Silva vs Silveira. */
function scorePersonNameMatch(query: string, nombreNormalized: string): number {
  if (!query || !nombreNormalized) return 0;
  const queryTokens = nameTokensWithoutPhone(query);
  const nameTokens = nameTokensWithoutPhone(nombreNormalized);
  if (!queryTokens.length || !nameTokens.length) return 0;
  if (queryTokens.join(' ') === nameTokens.join(' ')) return 100;

  const exactHits = queryTokens.filter((token) => nameTokens.includes(token)).length;
  if (exactHits === queryTokens.length && queryTokens.length === nameTokens.length) {
    return 95;
  }
  if (exactHits === queryTokens.length && queryTokens.length >= 2) {
    return 90;
  }
  if (exactHits === queryTokens.length && queryTokens.length === 1) {
    return 70;
  }
  if (exactHits > 0) {
    return 50 + exactHits * 5;
  }
  const fuzzyHits = queryTokens.filter((token) =>
    nameTokens.some((nameToken) => personTokenRelated(token, nameToken))
  ).length;
  if (fuzzyHits === queryTokens.length && queryTokens.length === 1) return 68;
  if (fuzzyHits > 0) return 50 + fuzzyHits * 5;
  if (queryTokens.length === 1 && nameTokens[0]) {
    const a = queryTokens[0]!;
    const b = nameTokens[0]!;
    if (a.length >= 4 && b.length >= 4 && a.slice(0, 3) === b.slice(0, 3)) return 45;
  }
  return 0;
}

function productLabel(data: { nombre?: string; color?: string; talle?: string }): string {
  const nombre = String(data.nombre ?? '').trim();
  const extra = [data.color, data.talle]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return extra.length ? `${nombre} (${extra.join(', ')})` : nombre;
}

function productSearchHaystack(data: { nombre?: string; color?: string; talle?: string }): string {
  return [data.nombre, data.color, data.talle]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

function isExactCatalogName(query: string, nombre: string): boolean {
  const q = normalizeName(query);
  const n = normalizeName(nombre);
  if (!q || !n) return false;
  if (q === n) return true;
  return nameTokensWithoutPhone(q).join(' ') === nameTokensWithoutPhone(n).join(' ');
}

/** Case/accent/space fold only. Not a synonym list. */
export function catalogNameEquals(query: string, storedName: string): boolean {
  return isExactCatalogName(query, storedName);
}

async function findExactClientMatches(businessId: string, name: string): Promise<MatchedClient[]> {
  const snap = await db.collection(`negocios/${businessId}/clientes`).get();
  const queries = entityLookupCandidates(name);
  const rows: Array<{ id: string; nombre: string }> = [];
  for (const doc of snap.docs) {
    const data = doc.data() as { nombre?: string; activo?: boolean };
    if (data.activo === false) continue;
    const nombre = String(data.nombre ?? '').trim();
    if (!nombre) continue;
    rows.push({ id: doc.id, nombre });
  }
  for (const query of queries) {
    const matches: MatchedClient[] = [];
    for (const row of rows) {
      if (isExactCatalogName(query, row.nombre)) {
        matches.push({ id: row.id, nombre: row.nombre, score: 100 });
      }
    }
    if (matches.length) return matches;
  }
  return [];
}

async function findExactProductMatches(businessId: string, name: string): Promise<MatchedStockItem[]> {
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  const matches: MatchedStockItem[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as {
      nombre?: string;
      color?: string;
      talle?: string;
      precioVenta?: number;
      precio?: number;
      costo?: number;
      activo?: boolean;
    };
    if (data.activo === false) continue;
    const nombre = String(data.nombre ?? '').trim();
    if (!nombre) continue;
    const label = productLabel(data);
    const haystack = productSearchHaystack(data);
    if (
      isExactCatalogName(name, nombre) ||
      isExactCatalogName(name, label) ||
      isExactCatalogName(name, haystack)
    ) {
      matches.push({
        id: doc.id,
        nombre,
        label,
        precioVenta: Number(data.precioVenta ?? data.precio) || 0,
        costo: Number(data.costo) || 0,
        score: 100,
      });
    }
  }
  return matches;
}

/** Devuelve candidatos similares ordenados por score (máx. 8). */
export async function findClientsByName(
  businessId: string,
  name: string,
  options?: { minScore?: number; limit?: number }
): Promise<MatchedClient[]> {
  if (!String(name ?? '').trim()) return [];
  const minScore = options?.minScore ?? 50;
  const limit = options?.limit ?? 8;
  const snap = await db.collection(`negocios/${businessId}/clientes`).get();
  const rows: Array<{ id: string; nombre: string; telefono: string; parsedNombre: string }> = [];
  for (const doc of snap.docs) {
    const data = doc.data() as { nombre?: string; telefono?: string; activo?: boolean };
    if (data.activo === false) continue;
    const nombre = String(data.nombre ?? '').trim();
    if (!nombre && !data.telefono) continue;
    const parsed = parsePersonNameAndPhone(nombre);
    const telefono = formatLocalPhone(String(data.telefono ?? parsed.telefono ?? ''));
    rows.push({ id: doc.id, nombre: nombre || parsed.nombre, telefono, parsedNombre: parsed.nombre });
  }

  const scoreAgainst = (queryRaw: string): MatchedClient[] => {
    const matches: MatchedClient[] = [];
    const queryParsed = parsePersonNameAndPhone(queryRaw);
    for (const row of rows) {
      let score = 0;
      const queryPhone = phoneMatchKey(queryParsed.telefono || (looksLikePhoneQuery(queryRaw) ? queryRaw : ''));
      const clientPhone = phoneMatchKey(row.telefono || row.parsedNombre || row.nombre);
      if (queryPhone.length >= 8 && queryPhone === clientPhone) {
        score = 100;
      }
      const nameScore = scorePersonNameMatch(
        normalizeName(queryParsed.nombre || queryRaw),
        normalizeName(row.parsedNombre || row.nombre)
      );
      if (nameScore > score) score = nameScore;
      if (score < minScore) continue;
      matches.push({ id: row.id, nombre: row.nombre, score });
    }
    return matches.sort((a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre, 'es'));
  };

  for (const candidate of entityLookupCandidates(name)) {
    const matches = scoreAgainst(candidate);
    if (matches.length) return matches.slice(0, limit);
  }
  return [];
}

/**
 * Resuelve cliente:
 * - nombre textual exacto y sin empate → unique
 * - cualquier parecido → lista para que elija
 * - ninguno → none (ofrecer registrar)
 */
export async function resolveClientMatch(
  businessId: string,
  name: string,
  options?: MatchResolveOptions
): Promise<
  | { status: 'unique'; client: MatchedClient }
  | { status: 'ambiguous'; candidates: MatchedClient[]; rest?: MatchedClient[]; query: string }
  | { status: 'none'; query: string }
> {
  const query = String(name ?? '').trim();
  if (!query) return { status: 'none', query: '' };

  const exactHits = await findExactClientMatches(businessId, query);
  if (exactHits.length === 1) {
    return { status: 'unique', client: exactHits[0]! };
  }
  if (exactHits.length > 1) {
    const decision = decideClientMatch(exactHits);
    if (decision.status === 'unique') return { status: 'unique', client: decision.item };
    if (decision.status === 'none') return { status: 'none', query };
    return { status: 'ambiguous', candidates: decision.options, rest: decision.rest, query };
  }

  const aiHits = await pickClientsWithAi(businessId, query, options?.utterance);
  if (aiHits) {
    if (!aiHits.length) return { status: 'none', query };
    const candidates = aiHits.map((hit, index) => ({
      id: hit.id,
      nombre: hit.nombre,
      score: 90 - index,
    }));
    const decision = decideClientMatch(candidates);
    if (decision.status === 'unique') return { status: 'unique', client: decision.item };
    if (decision.status === 'none') return { status: 'none', query };
    return { status: 'ambiguous', candidates: decision.options, rest: decision.rest, query };
  }

  const aliased = await findClientAlias(businessId, query);
  if (aliased && !options?.preferChoices) {
    return {
      status: 'unique',
      client: { id: aliased.clientId, nombre: aliased.clientName, score: 100 },
    };
  }

  const candidates = await findClientsByName(businessId, query, {
    minScore: options?.preferChoices ? 40 : 50,
  });
  if (aliased && !candidates.some((c) => c.id === aliased.clientId)) {
    candidates.unshift({
      id: aliased.clientId,
      nombre: aliased.clientName,
      score: isExactCatalogName(query, aliased.clientName) ? 100 : 90,
    });
  }
  if (!candidates.length) return { status: 'none', query };

  const top = candidates[0]!;
  const exact = candidates.filter((c) => isExactCatalogName(query, c.nombre));
  const close = candidates.filter((c) => c.score >= Math.max(40, top.score - 25));
  const listed = close.length ? close : candidates;

  if (options?.preferChoices) {
    const decision = decideClientMatch(listed);
    if (decision.status === 'unique') return { status: 'unique', client: decision.item };
    if (decision.status === 'none') return { status: 'none', query };
    return { status: 'ambiguous', candidates: decision.options, rest: decision.rest, query };
  }

  if (exact.length === 1) {
    return { status: 'unique', client: exact[0]! };
  }
  if (close.length === 1 && top.score >= 70) {
    return { status: 'unique', client: top };
  }
  if (listed.length === 1) {
    return { status: 'unique', client: listed[0]! };
  }

  return {
    status: 'ambiguous',
    candidates: listed,
    query,
  };
}

export async function findClientByName(
  businessId: string,
  name: string
): Promise<Omit<MatchedClient, 'score'> | null> {
  const resolved = await resolveClientMatch(businessId, name);
  if (resolved.status !== 'unique') return null;
  return { id: resolved.client.id, nombre: resolved.client.nombre };
}

export type MatchedSupplier = { id: string; nombre: string; score: number };

export async function findSuppliersByName(
  businessId: string,
  name: string,
  options?: { minScore?: number; limit?: number }
): Promise<MatchedSupplier[]> {
  const query = normalizeName(name);
  if (!query || query.length < 2) return [];

  const minScore = options?.minScore ?? 50;
  const limit = options?.limit ?? 8;
  const snap = await db.collection(`negocios/${businessId}/proveedores`).get();
  const matches: MatchedSupplier[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as { nombre?: string; activo?: boolean };
    if (data.activo === false) continue;
    const nombre = String(data.nombre ?? '').trim();
    if (!nombre) continue;
    const score = scoreNameMatch(query, normalizeName(nombre));
    if (score < minScore) continue;
    matches.push({ id: doc.id, nombre, score });
  }

  return matches.sort((a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre, 'es')).slice(0, limit);
}

export async function resolveSupplierMatch(
  businessId: string,
  name: string
): Promise<
  | { status: 'unique'; supplier: MatchedSupplier }
  | { status: 'ambiguous'; candidates: MatchedSupplier[]; query: string }
  | { status: 'none'; query: string }
> {
  const query = String(name ?? '').trim();
  if (!query) return { status: 'none', query: '' };

  const aliased = await findSupplierAlias(businessId, query);
  if (aliased) {
    return {
      status: 'unique',
      supplier: { id: aliased.supplierId, nombre: aliased.supplierName, score: 100 },
    };
  }

  const candidates = await findSuppliersByName(businessId, query);
  if (!candidates.length) return { status: 'none', query };

  if (candidates.length === 1) {
    return { status: 'unique', supplier: candidates[0]! };
  }

  const top = candidates[0]!;
  const close = candidates.filter((c) => c.score >= Math.max(50, top.score - 20));
  const pool = close.length ? close : candidates;

  if (pool.length === 1) {
    return { status: 'unique', supplier: pool[0]! };
  }

  return {
    status: 'ambiguous',
    candidates: pool,
    query,
  };
}

export async function findStockItemsByName(
  businessId: string,
  name: string,
  options?: { minScore?: number; limit?: number }
): Promise<MatchedStockItem[]> {
  const query = normalizeName(name);
  if (!query || query.length < 2) return [];

  const minScore = options?.minScore ?? 50;
  const limit = options?.limit ?? 8;
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  const matches: MatchedStockItem[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as {
      nombre?: string;
      talle?: string;
      color?: string;
      precioVenta?: number;
      precio?: number;
      costo?: number;
      activo?: boolean;
    };
    if (data.activo === false) continue;
    const nombre = String(data.nombre ?? '').trim();
    if (!nombre) continue;
    const haystack = normalizeName(productSearchHaystack(data));
    if (!sharesQueryColor(query, haystack)) continue;
    const score = scoreProductCatalogMatch(query, haystack);
    if (score < minScore) continue;
    matches.push({
      id: doc.id,
      nombre,
      label: productLabel(data),
      precioVenta: Number(data.precioVenta ?? data.precio) || 0,
      costo: Number(data.costo) || 0,
      score,
    });
  }

  return matches
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.nombre.length - b.nombre.length ||
        a.nombre.localeCompare(b.nombre, 'es')
    )
    .slice(0, limit);
}

export async function resolveProductMatch(
  businessId: string,
  name: string,
  options?: MatchResolveOptions
): Promise<
  | { status: 'unique'; product: MatchedStockItem }
  | {
      status: 'ambiguous';
      candidates: MatchedStockItem[];
      rest?: MatchedStockItem[];
      query: string;
      matchKind?: 'AMBIGUOUS' | 'FAMILY_MATCH_VARIANT_MISSING';
      missingVariant?: string;
      familyLabel?: string;
    }
  | { status: 'none'; query: string }
> {
  const query = String(name ?? '').trim();
  if (!query) return { status: 'none', query: '' };

  const signals = signalsFromItem({
    rawText: options?.utterance || query,
    productHint: query,
    attributes: options?.attributes,
  });

  const exactHits = await findExactProductMatches(businessId, query);
  if (exactHits.length) {
    const decision = decideCatalogMatch(exactHits, signals, query);
    if (decision.status === 'unique') return { status: 'unique', product: decision.item as MatchedStockItem };
    if (decision.status === 'ambiguous') {
      return {
        status: 'ambiguous',
        candidates: decision.options as MatchedStockItem[],
        rest: decision.rest as MatchedStockItem[],
        query,
        matchKind: decision.kind,
        missingVariant: decision.missingVariant,
        familyLabel: decision.familyLabel,
      };
    }
  }

  const aliased = await findProductAlias(businessId, query);
  if (aliased?.kind === 'product') {
    const snap = await db.doc(`negocios/${businessId}/stock/${aliased.productId}`).get();
    if (snap.exists && snap.data()?.activo !== false) {
      const data = snap.data() as {
        nombre?: string;
        color?: string;
        talle?: string;
        precioVenta?: number;
        precio?: number;
        costo?: number;
      };
      return {
        status: 'unique',
        product: {
          id: snap.id,
          nombre: String(data.nombre ?? aliased.productName).trim(),
          label: productLabel(data),
          precioVenta: Number(data.precioVenta ?? data.precio) || 0,
          costo: Number(data.costo) || 0,
          score: 100,
        },
      };
    }
  }

  let aiHits = await pickProductsWithAi(businessId, query, options?.utterance, options?.messageContext);
  if (aiHits === null && options?.preferChoices) {
    aiHits = await pickProductsWithAi(businessId, query, options?.utterance, options?.messageContext);
  }

  const fuzzy = await findStockItemsByName(businessId, query, {
    minScore: options?.preferChoices ? 30 : 50,
    limit: options?.preferChoices ? 20 : 8,
  });
  const merged: MatchedStockItem[] = [];
  const seen = new Set<string>();
  const push = (item: MatchedStockItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    merged.push(item);
  };
  (aiHits ?? []).forEach((hit, index) => {
    push({
      id: hit.id,
      nombre: hit.nombre,
      label: hit.label,
      precioVenta: hit.precioVenta,
      costo: hit.costo,
      score: 90 - index,
    });
  });
  for (const item of fuzzy) push(item);

  const ranked = merged
    .map((item) => ({
      ...item,
      score: scoreProductCatalogMatch(
        normalizeName(query),
        normalizeName([item.nombre, item.label].filter(Boolean).join(' '))
      ),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.nombre.length - b.nombre.length ||
        a.nombre.localeCompare(b.nombre, 'es')
    );
  if (!ranked.length) return { status: 'none', query };

  const decision = decideCatalogMatch(ranked, signals, query);
  if (decision.status === 'unique') {
    return { status: 'unique', product: decision.item as MatchedStockItem };
  }
  if (decision.status === 'none') return { status: 'none', query };

  const exact = ranked.filter(
    (c) => isExactCatalogName(query, c.nombre) || isExactCatalogName(query, c.label)
  );
  if (exact.length === 1 && decision.kind !== 'FAMILY_MATCH_VARIANT_MISSING') {
    return { status: 'unique', product: exact[0]! };
  }

  const pool = decision.options as MatchedStockItem[];
  if (pool.length === 1 && decision.kind !== 'FAMILY_MATCH_VARIANT_MISSING') {
    return { status: 'unique', product: pool[0]! };
  }

  return {
    status: 'ambiguous',
    candidates: pool,
    rest: decision.rest as MatchedStockItem[],
    query,
    matchKind: decision.kind,
    missingVariant: decision.missingVariant,
    familyLabel: decision.familyLabel,
  };
}

export async function findStockItemByName(
  businessId: string,
  name: string
): Promise<Omit<MatchedStockItem, 'score'> | null> {
  const resolved = await resolveProductMatch(businessId, name);
  if (resolved.status !== 'unique') return null;
  const { score: _score, ...product } = resolved.product;
  return product;
}

// «ó» y «ñ» no cuentan como \w en JS, así que el corte de palabra va con \p{L}.
const SENIA_BEFORE_AMOUNT =
  /\b(se[ñn]a|se[ñn][oó]|adelanto|adelant[oó]|anticipo|anticip[oó]|a\s+cuenta)(?![\p{L}])[^\d$]{0,15}\$?\s*([\d.]+(?:,\d{2})?)/iu;
// El conector es obligatorio: si no, «costo $100 seña 200» tomaría el 100.
const SENIA_AFTER_AMOUNT =
  /\$?\s*([\d.]+(?:,\d{2})?)\s*(?:pesos\s*)?(?:de|como|en|a)\s+(se[ñn]a|adelanto|anticipo|cuenta)(?![\p{L}])/iu;

function parseLooseAmount(value: string | undefined): number | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (!digits || digits.length >= 8) return null;
  const amount = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Seña / adelanto dicho en el mismo mensaje: «señó $500», «dejó 200 de seña». */
export function extractSeniaFromText(text: string): number | null {
  const raw = String(text ?? '');
  return (
    parseLooseAmount(raw.match(SENIA_AFTER_AMOUNT)?.[1]) ??
    parseLooseAmount(raw.match(SENIA_BEFORE_AMOUNT)?.[2])
  );
}

export function extractAmountFromText(text: string): number | null {
  const stripped = String(text ?? '')
    .replace(/\bcostos?\s+(?:extra\s+)?\$?\s*[\d.]+(?:,\d+)?/gi, ' ')
    .replace(SENIA_BEFORE_AMOUNT, ' ')
    .replace(SENIA_AFTER_AMOUNT, ' ')
    // «del pedido 223» es una referencia, no un monto.
    .replace(/\b(pedidos?|[oó]rdenes?|orden|ventas?|nro\.?|n[uú]m(?:ero)?s?)\s*#?\s*\d+/gi, ' ');
  const match =
    stripped.match(/\$\s*([\d.]+(?:,\d{2})?)/) ||
    stripped.match(/\b([\d.]+(?:,\d{2})?)\s*(?:pesos|\$)?\b/i);
  if (!match) return null;
  const digits = match[1]!.replace(/\D/g, '');
  if (digits.length >= 8) return null;
  const raw = match[1]!.replace(/\./g, '').replace(',', '.');
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** «el costo de Taza AA es 147», «cambiá el costo de Canguro felpa Rojo L a 600». */
export function extractCatalogCostUpdate(text: string): { productName: string; amount: number } | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const patterns = [
    /\b(?:cambi[áaeo]|actualiz[áae]|pon[eé]|dej[áa])\s+(?:el\s+)?costo\s+(?:configurado\s+)?(?:de|del)\s+(.+?)\s+(?:a|es|en|=)\s*\$?\s*([\d.]+(?:,\d{1,2})?)\b/iu,
    /\bel\s+costo\s+(?:configurado\s+)?(?:de|del)\s+(.+?)\s+(?:es|queda(?:\s+en)?|pasa\s+a|a)\s*\$?\s*([\d.]+(?:,\d{1,2})?)\b/iu,
    /\bcosto\s+(?:de\s+cat[aá]logo|configurado)\s+(?:de\s+)?(.+?)\s*\$?\s*([\d.]+(?:,\d{1,2})?)\b/iu,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const productName = String(match[1] ?? '')
      .replace(/\b(configurado|cat[aá]logo|producto)\b/gi, ' ')
      .replace(/[.,;:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const amount = parseInvoiceMoney(match[2]);
    if (productName.length >= 2 && amount > 0) return { productName, amount };
  }
  return null;
}

/** Montos de factura UY/AR: 490,98 · 1.472,95 · 8.706,00 · 1472.95 */
export function parseInvoiceMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const raw = String(value ?? '')
    .trim()
    .replace(/\$/g, '')
    .replace(/\s/g, '');
  if (!raw) return 0;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(raw)
      ? raw.replace(/\./g, '')
      : raw;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/**
 * Si las líneas suman el neto y el total declarado incluye IVA (típico e-Ticket UY),
 * escala el costo unitario para que quede CON IVA (costo de reposición real).
 * Conserva unitCostNet (neto de boleta) para mostrarlo al preguntar.
 */
export function grossUpPurchaseLinesIfVatSeparated<
  T extends { quantity: number; unitCost: number; unitCostNet?: number },
>(lines: T[], declaredTotal?: number): T[] {
  if (!lines.length) return lines;
  const netFromTicket = lines.reduce((acc, line) => {
    const qty = Math.max(1, Number(line.quantity) || 1);
    const unit =
      Number(line.unitCostNet) > 0 ? Number(line.unitCostNet) : Number(line.unitCost) || 0;
    return acc + qty * unit;
  }, 0);
  const total = Number(declaredTotal) || 0;
  if (!(netFromTicket > 0) || !(total > 0)) {
    return lines.map((line) => ({
      ...line,
      unitCostNet:
        Number(line.unitCostNet) > 0
          ? Math.round(Number(line.unitCostNet) * 100) / 100
          : Number(line.unitCost) > 0
            ? Math.round(Number(line.unitCost) * 100) / 100
            : line.unitCostNet,
    }));
  }
  const ratio = total / netFromTicket;
  if (ratio < 1.08 || ratio > 1.28) return lines;
  return lines.map((line) => {
    const net =
      Number(line.unitCostNet) > 0 ? Number(line.unitCostNet) : Number(line.unitCost) || 0;
    return {
      ...line,
      unitCostNet: Math.round(net * 100) / 100,
      unitCost: Math.round(net * ratio * 100) / 100,
    };
  });
}

/** «x2 $99 c/u» / pack en la descripción de la boleta. */
export function inferPurchasePackUnits(name: string): number {
  const text = String(name ?? '');
  const each = /c\/u|c\.u\.|cada\s+u/i.test(text);
  const xMatch = text.match(/\bx\s*(\d{1,2})\b/i);
  const n = xMatch ? Number(xMatch[1]) : 0;
  if (n >= 2 && n <= 12 && (each || /\bpack\b/i.test(text))) return n;
  return 1;
}

export type PurchaseLineDisposition = 'skip' | 'insumo' | null;

/** Saltar el renglón o cargarlo como insumo/herramienta (sin stock). */
export function parsePurchaseLineDisposition(text: string): PurchaseLineDisposition {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  if (
    /^(saltar|omitir|descartar|pasar|saltear)(\s+(este|esta|el|la|ítem|item|rengl[oó]n|linea|línea))?s?\.?$/i.test(
      raw
    ) ||
    /^(no lo (cargues|anotes|registres)|sacalo|sacálo|sin este|no este|no éste)$/i.test(raw)
  ) {
    return 'skip';
  }
  if (
    /^(insumo|insumos|herramienta|herramientas|sin stock|no stock|gasto)s?\.?$/i.test(raw) ||
    /\b(es un insumo|como insumo|como herramienta|no (mueve|controla|cuenta|suma) stock|no lo subas al stock)\b/i.test(
      raw
    )
  ) {
    return 'insumo';
  }
  return null;
}

/** Índices 0-based de CREAR / INSUMO / SALTAR en la lista de productos de una compra. */
export function purchaseDispositionChoiceIndexes(
  candidateCount: number,
  allowCreate: boolean,
  query?: string
): { create?: number; insumo: number; skip: number; max: number } {
  const createOffset = allowCreate && String(query ?? '').trim() ? 1 : 0;
  const create = createOffset ? candidateCount : undefined;
  const insumo = candidateCount + createOffset;
  const skip = insumo + 1;
  return { create, insumo, skip, max: skip };
}

export type PurchaseUnknownsReply =
  | { action: 'insumo_all' }
  | { action: 'skip_all' }
  | { action: 'insumo'; indexes: number[] }
  | { action: 'skip'; indexes: number[] }
  | { action: 'pick'; index: number };

function parseDisplayedIndexes(raw: string, max: number): number[] {
  const parts = String(raw ?? '')
    .split(/[\s,y]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const indexes: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (Number.isInteger(n) && n >= 1 && n <= max) indexes.push(n - 1);
  }
  return [...new Set(indexes)];
}

export function parsePurchaseUnknownsReply(
  text: string,
  unknownCount: number
): PurchaseUnknownsReply | null {
  const raw = String(text ?? '').trim();
  if (!raw || unknownCount < 1) return null;
  if (
    /^(insumo|insumos|herramienta|herramientas|sin stock|gasto)s?\.?$/i.test(raw) ||
    /^(todos|todas|el resto|los que quedan)(\s+(estos|estas))?(\s+(a|como|de))?\s+(insumo|herramienta|sin stock)s?\.?$/i.test(
      raw
    )
  ) {
    return { action: 'insumo_all' };
  }
  if (
    /^(saltar|omitir|descartar|pasar)s?\.?$/i.test(raw) ||
    /^(todos|todas|el resto)(\s+(estos|estas))?\s+(saltar|omitir|descartar)s?\.?$/i.test(raw)
  ) {
    return { action: 'skip_all' };
  }
  const withAction = raw.match(
    /^([\d,\.\sye]+)\s+(insumo|insumos|herramienta|herramientas|saltar|omitir|descartar)s?\.?$/i
  );
  if (withAction) {
    const indexes = parseDisplayedIndexes(withAction[1] ?? '', unknownCount);
    if (!indexes.length) return null;
    const action = /insumo|herramienta/i.test(withAction[2] ?? '') ? 'insumo' : 'skip';
    return { action, indexes };
  }
  if (/^\d{1,2}$/.test(raw)) {
    const index = Number(raw) - 1;
    if (index >= 0 && index < unknownCount) return { action: 'pick', index };
  }
  return null;
}

export function unresolvedPurchaseLineIndexes(
  lines: Array<{ productId?: string; skipped?: boolean; tipoLinea?: string }> | undefined
): number[] {
  const result: number[] = [];
  (lines ?? []).forEach((line, index) => {
    if (line.skipped || line.productId || line.tipoLinea === 'insumo') return;
    result.push(index);
  });
  return result;
}

export function applyPurchasePackChoice<
  T extends {
    quantity: number;
    unitCost: number;
    unitCostNet?: number;
    packUnits?: number;
    packResolved?: boolean;
  },
>(line: T, expand: boolean): T {
  const pack = Math.max(2, Number(line.packUnits) || inferPurchasePackUnits(String((line as { productName?: string }).productName ?? '')) || 2);
  if (!expand) {
    return { ...line, packResolved: true };
  }
  const qty = Math.max(1, Number(line.quantity) || 1);
  const gross = Number(line.unitCost) || 0;
  const net = Number(line.unitCostNet) > 0 ? Number(line.unitCostNet) : gross;
  return {
    ...line,
    quantity: qty * pack,
    unitCost: Math.round((gross / pack) * 100) / 100,
    unitCostNet: Math.round((net / pack) * 100) / 100,
    packResolved: true,
  };
}

export function formatTicketMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  const rounded = Math.round(value * 100) / 100;
  const [int, dec] = rounded.toFixed(2).split('.');
  const withDots = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec === '00' ? `$${withDots}` : `$${withDots},${dec}`;
}

function purchaseLineInvoiceName(line: {
  productName?: string;
  invoiceName?: string;
}): string {
  return String(line.invoiceName ?? line.productName ?? '').trim() || 'Ítem';
}

export function formatPurchaseLinePrices(line: {
  quantity?: number;
  unitCost?: number;
  unitCostNet?: number;
}): string {
  const qty = Math.max(1, Number(line.quantity) || 1);
  const gross = Number(line.unitCost) || 0;
  const net = Number(line.unitCostNet) > 0 ? Number(line.unitCostNet) : 0;
  if (net > 0 && gross > 0 && Math.abs(gross - net) > 0.02) {
    return `${qty} × neto ${formatTicketMoney(net)} → ${formatTicketMoney(gross)} c/u con IVA`;
  }
  if (gross > 0) return `${qty} × ${formatTicketMoney(gross)}`;
  if (net > 0) return `${qty} × neto ${formatTicketMoney(net)}`;
  return `${qty} × (sin costo)`;
}

const PURCHASE_CONFIRM_PAGE_SIZE = 8;

type PurchaseConfirmLine = {
  productName?: string;
  invoiceName?: string;
  quantity?: number;
  unitCost?: number;
  skipped?: boolean;
  tipoLinea?: 'stock' | 'insumo';
};

function formatPurchaseConfirmItem(line: PurchaseConfirmLine): string {
  const qty = Math.max(1, Number(line.quantity) || 1);
  const gross = Number(line.unitCost) || 0;
  const catalog =
    String(line.productName ?? '').trim() ||
    String(line.invoiceName ?? '').trim() ||
    'Ítem';
  const tag = line.tipoLinea === 'insumo' ? ' · insumo' : '';
  const price = gross > 0 ? formatTicketMoney(gross) : '(sin costo)';
  return `• ${catalog}${tag} — ${qty} × ${price}`;
}

function purchaseConfirmItemsTotal(lines: PurchaseConfirmLine[]): number {
  return lines
    .filter((line) => !line.skipped)
    .reduce(
      (acc, line) => acc + Math.max(1, Number(line.quantity) || 1) * (Number(line.unitCost) || 0),
      0
    );
}

/** Resumen corto, paginado: catálogo + cantidad + precio. Sin el texto de la boleta. */
export function formatPurchaseConfirmationMessages(entities: {
  supplierName?: string;
  invoiceNumber?: string;
  amount?: number;
  purchaseLines?: PurchaseConfirmLine[];
  productName?: string;
  imageSummary?: string;
  saveAsDraft?: boolean;
}): string[] {
  const isDraft = entities.saveAsDraft === true;
  const header: string[] = [waBold(isDraft ? 'Borrador de compra' : 'Para anotar la compra')];
  const supplier = String(entities.supplierName ?? '').trim();
  const invoice = String(entities.invoiceNumber ?? '').trim();
  if (supplier && invoice) header.push(`${supplier} · ${invoice}`);
  else if (supplier) header.push(supplier);
  else if (invoice) header.push(`Comprobante ${invoice}`);

  const purchaseLines = entities.purchaseLines ?? [];
  const visible = purchaseLines.filter((line) => !line.skipped);
  const itemLines = visible.length
    ? visible.map(formatPurchaseConfirmItem)
    : [
        `• ${String(entities.productName ?? entities.imageSummary ?? '').trim() || '(sin detalle)'}`,
      ];

  const itemsTotal = purchaseConfirmItemsTotal(visible);
  const ticketTotal = Number(entities.amount) || 0;
  const total = itemsTotal > 0 ? itemsTotal : ticketTotal;
  const footer: string[] = [];
  if (total > 0) footer.push(`Total ${waBold(formatTicketMoney(total))}`);
  if (isDraft) {
    footer.push('Al confirmar se guarda el borrador. Completás el pago en Compras.');
  } else {
    footer.push('El pago lo cargás en Compras. No muevo caja ni cambio el costo del catálogo.');
    footer.push('Egreso o costo de producto: otro mensaje (Consultame).');
  }
  footer.push('');
  footer.push(`¿Lo guardo? ${waBold('SÍ')} / ${waBold('NO')}`);

  if (itemLines.length <= PURCHASE_CONFIRM_PAGE_SIZE) {
    return [[...header, '', ...itemLines, '', ...footer].join('\n')];
  }

  const pages: string[] = [];
  const pageCount = Math.ceil(itemLines.length / PURCHASE_CONFIRM_PAGE_SIZE);
  for (let page = 0; page < pageCount; page++) {
    const from = page * PURCHASE_CONFIRM_PAGE_SIZE;
    const slice = itemLines.slice(from, from + PURCHASE_CONFIRM_PAGE_SIZE);
    const parts: string[] = [];
    if (page === 0) {
      const titled = [...header];
      if (pageCount > 1 && titled[0]) {
        titled[0] = waBold(`${isDraft ? 'Borrador de compra' : 'Compra'} — 1/${pageCount}`);
      }
      parts.push(...titled, '');
    } else {
      parts.push(waBold(`Compra — ${page + 1}/${pageCount}`), '');
    }
    parts.push(...slice);
    if (page < pageCount - 1) {
      parts.push('');
    } else {
      parts.push('');
      parts.push(...footer);
    }
    pages.push(parts.join('\n'));
  }
  return pages;
}

/** Una ficha corta de la boleta, con viñetas. */
export function formatPurchaseBoletaHeader(entities: {
  supplierName?: string;
  invoiceNumber?: string;
  amount?: number;
  purchaseLines?: unknown[];
}): string {
  const lines = [waBold('Leí la boleta')];
  const supplier = String(entities.supplierName ?? '').trim();
  if (supplier) lines.push(`• Proveedor: ${waBold(supplier)}`);
  const invoice = String(entities.invoiceNumber ?? '').trim();
  if (invoice) lines.push(`• Comprobante: ${waBold(`N° ${invoice}`)}`);
  const total = Number(entities.amount) || 0;
  if (total > 0) lines.push(`• Total: ${waBold(formatTicketMoney(total))}`);
  const count = Array.isArray(entities.purchaseLines) ? entities.purchaseLines.length : 0;
  if (count) lines.push(`• Ítems: ${waBold(String(count))}`);
  return lines.join('\n');
}

export function formatPurchaseTicketDigest(entities: {
  supplierName?: string;
  invoiceNumber?: string;
  amount?: number;
  purchaseLines?: unknown[];
}): string {
  return formatPurchaseBoletaHeader(entities);
}

export function formatPurchaseUnknownsPrompt(
  entities: {
    supplierName?: string;
    invoiceNumber?: string;
    amount?: number;
    purchaseUnknownsAsked?: boolean;
    purchaseLines?: Array<{
      productName?: string;
      invoiceName?: string;
      productId?: string;
      quantity?: number;
      unitCost?: number;
      skipped?: boolean;
      tipoLinea?: string;
    }>;
  },
  options?: { followUp?: boolean }
): string {
  const all = entities.purchaseLines ?? [];
  const bound = all.filter((line) => line.productId && !line.skipped);
  const unknowns = unresolvedPurchaseLineIndexes(all);
  const followUp = options?.followUp === true;
  const lines: string[] = [];

  if (!followUp) {
    lines.push(formatPurchaseBoletaHeader(entities));
    if (bound.length) {
      lines.push('');
      lines.push(waBold(`Ya vinculados (${bound.length})`));
      for (const line of bound.slice(0, 8)) {
        const invoice = purchaseLineInvoiceName(line);
        const catalog = String(line.productName ?? '').trim() || invoice;
        const mapped = invoice && invoice !== catalog ? ` ← ${invoice}` : '';
        lines.push(`• ${waBold(catalog)}${mapped}`);
      }
      if (bound.length > 8) lines.push(`• … y ${bound.length - 8} más`);
    }
  }

  if (!unknowns.length) return lines.join('\n').trim();

  lines.push('');
  if (followUp) {
    lines.push(
      waBold(unknowns.length === 1 ? 'Queda este' : `Quedan ${unknowns.length}`)
    );
  } else {
    lines.push(
      waBold(unknowns.length === 1 ? 'Este no lo reconozco' : `No reconozco estos ${unknowns.length}`)
    );
  }
  const maxShow = 24;
  unknowns.slice(0, maxShow).forEach((lineIdx, index) => {
    const line = all[lineIdx];
    if (!line) return;
    const qty = Math.max(1, Number(line.quantity) || 1);
    const cost = Number(line.unitCost) || 0;
    const price = cost > 0 ? ` — ${qty} × ${formatTicketMoney(cost)}` : ` — ×${qty}`;
    lines.push(`${index + 1}) ${purchaseLineInvoiceName(line)}${price}`);
  });
  if (unknowns.length > maxShow) {
    lines.push(`• … y ${unknowns.length - maxShow} más`);
  }
  lines.push('');
  lines.push(
    unknowns.length === 1
      ? `Respondé ${waBold('1')} para vincularlo o descartarlo.`
      : `Respondé un ${waBold('número')} para vincularlo o descartarlo.`
  );
  return lines.join('\n').replace(/^\n+/, '');
}

/** Envío, flete, IVA suelto, recargos: no son mercadería de catálogo. */
export function looksLikeNonCatalogPurchaseLine(name: string): boolean {
  const text = String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!text.trim()) return false;
  if (/\b(taza|jarro|canguro|camiseta|remera|buzo|talle|hoodie)\b/.test(text)) return false;
  return (
    /\b(envio|flete|shipping|porte)\b/.test(text) ||
    /\benvio interior\b/.test(text) ||
    (/\bdomicilio\b/.test(text) && /\b(envio|entrega|costo|cargo|interior)\b/.test(text)) ||
    /\b(recargo|redondeo|percepcion|sello)\b/.test(text)
  );
}

export function formatPurchaseNonCatalogChoices(
  line: {
    productName?: string;
    invoiceName?: string;
    quantity?: number;
    unitCost?: number;
    unitCostNet?: number;
  }
): string {
  return formatWhatsappMessage({
    title: 'Esto no parece un producto',
    lines: [
      `En la boleta: ${purchaseLineInvoiceName(line)}`,
      `• ${formatPurchaseLinePrices(line)}`,
      '1) Descartar (no lo cargo)',
      '2) Gasto / insumo (entra en la compra, no mueve stock)',
    ],
    ask: '¿Cuál querés?',
  });
}

export function formatPurchasePackChoices(
  line: {
    productName?: string;
    invoiceName?: string;
    quantity?: number;
    unitCost?: number;
    unitCostNet?: number;
    packUnits?: number;
  },
  options?: { lineIndex?: number; lineCount?: number }
): string {
  const pack = Math.max(2, Number(line.packUnits) || 2);
  const qty = Math.max(1, Number(line.quantity) || 1);
  const gross = Number(line.unitCost) || 0;
  const eachGross = gross > 0 ? Math.round((gross / pack) * 100) / 100 : 0;
  const progress =
    options?.lineIndex != null && Number(options.lineCount) > 1
      ? `Ítem ${options.lineIndex + 1} de ${options.lineCount}`
      : '';
  return formatWhatsappMessage({
    title: progress || 'Dice pack',
    lines: [
      `En la boleta: ${purchaseLineInvoiceName(line)}`,
      `• ${formatPurchaseLinePrices(line)}`,
      `1) ${qty * pack} unidades a ${formatTicketMoney(eachGross)} (pack x${pack})`,
      `2) ${qty} unidades a ${formatTicketMoney(gross)} (como el renglón)`,
      '3) Insumo / herramienta (sin stock)',
      '4) Saltar (no lo cargo)',
    ],
    ask: '¿Cómo lo cargo?',
  });
}

export type ExtraCostItem = { nombre: string; costo: number };

const COST_NAME_STOP = /^(extra|de|del|al|el|la|un|una|item|ítem|pedido|orden|venta|cliente|tambien|también|fecha|entrega|hoy|mañana|manana)$/i;

function parseLooseMoney(raw: string): number {
  const trimmed = String(raw ?? '').trim().replace(/[.,]+$/, '');
  if (!trimmed) return 0;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 8) return 0;
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed.replace(/\.(?=\d{3}\b)/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function cleanCostConcept(raw: string): string {
  const name = String(raw ?? '')
    .replace(/\b(al|del|de|el|la|un|una)\s+(pedido|orden|venta)\b/gi, '')
    .replace(/\b(pedido|orden|venta|producto)\b/gi, '')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name || COST_NAME_STOP.test(name)) return 'Costo extra';
  if (/\b(sin descripci[oó]n|estampado a|producto)\b/i.test(name)) return 'Costo extra';
  return name.slice(0, 60);
}

const COST_MONEY = String.raw`(\d{1,7}(?:[.,]\d{1,2})?)`;
const EXTRA_COST_CONCEPT =
  String.raw`(?:estampado|bordado|vinilo|serigraf[ií]a|bolsa|personalizaci[oó]n|dtf|sublimad[oa]|packing|envoltorio|transfer|sticker|logo)`;

/** «costo estampado 200», «estampado 200 de costo», «agregá costo vinilo 150». */
export function extractExtraCostsFromText(text: string): ExtraCostItem[] {
  const items: ExtraCostItem[] = [];
  const seen = new Set<string>();
  const push = (nombre: string, costoRaw: string) => {
    const costo = parseLooseMoney(costoRaw);
    if (!(costo > 0)) return;
    const label = cleanCostConcept(nombre);
    const key = `${label.toLowerCase()}|${costo}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ nombre: label, costo });
  };

  const newOrder = looksLikeNewOrder(text);
  const patterns = [
    new RegExp(
      String.raw`\bcostos?\s+(?:extra\s+)?(?:de\s+|del\s+|al\s+)?([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{0,40}?)\s*(?:a|de|por)?\s*\$?\s*` +
        COST_MONEY,
      'gi'
    ),
    ...(newOrder
      ? []
      : [
          new RegExp(
            String.raw`\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{1,40}?)\s+\$?\s*` +
              COST_MONEY +
              String.raw`\s*(?:de\s+)?costos?\b`,
            'gi'
          ),
        ]),
    new RegExp(
      String.raw`\b(?:agreg[áa]|sum[áa]|anot[áa]|registr[áa]|cargar|poner|sumale|sumále|agregale|agregále|pon[eé]le)\s+(?:un\s+)?(?:(?:í|i)tem\s+de\s+)?(?:al\s+)?costos?\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{0,40}?)\s*\$?\s*` +
        COST_MONEY,
      'gi'
    ),
    new RegExp(
      String.raw`\bcostos?\s+\$?\s*` + COST_MONEY + String.raw`\s+(?:de\s+)?([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{1,40})`,
      'gi'
    ),
    new RegExp(
      String.raw`\b(?:sumale|sumále|agregale|agregále|sum[áa]|agreg[áa]|pon[eé]le)\s+(?:al\s+)?costos?\s*\$?\s*` + COST_MONEY,
      'gi'
    ),
    new RegExp(
      String.raw`\b(?:sumale|sumále|agregale|agregále|sum[áa]|agreg[áa])\s+\$?\s*` +
        COST_MONEY +
        String.raw`\s+(?:al\s+)?costos?`,
      'gi'
    ),
    new RegExp(String.raw`\bal\s+costos?\s*\$?\s*` + COST_MONEY, 'gi'),
  ];

  const addSpoken = [
    ...text.matchAll(
      new RegExp(
        String.raw`\b(?:sumale|sumále|agregale|agregále|sum[áa]|agreg[áa]|pon[eé]le)\s+\$?\s*` +
          COST_MONEY +
          String.raw`\s+(?:de\s+|en\s+|por\s+)?([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{1,40})`,
        'gi'
      )
    ),
  ];
  for (const match of addSpoken) {
    const rawName = String(match[2] ?? '').split(/\s+y\s+|\s+ya\s+/i)[0] ?? '';
    if (/\b(pedido|orden|venta|pago|saldo|total)\b/i.test(rawName)) continue;
    push(rawName, match[1] ?? '');
  }

  for (const match of text.matchAll(
    new RegExp(
      String.raw`\b(` + EXTRA_COST_CONCEPT + String.raw`)\s+(?:me\s+)?cuesta\s+\$?\s*` + COST_MONEY,
      'gi'
    )
  )) {
    push(match[1] ?? '', match[2] ?? '');
  }
  for (const match of text.matchAll(
    new RegExp(
      String.raw`\b(?:me\s+)?cuesta\s+(?:el\s+|la\s+|de\s+)?(` +
        EXTRA_COST_CONCEPT +
        String.raw`)\s+\$?\s*` +
        COST_MONEY,
      'gi'
    )
  )) {
    push(match[1] ?? '', match[2] ?? '');
  }

  for (const [index, pattern] of patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      const concept = String(match[1] ?? '');
      const namedBeforeMoney = !newOrder && index === 1;
      const moneyThenName = newOrder ? index === 2 : index === 3;
      const verbOrBare = newOrder ? index >= 3 : index >= 4;
      if (!namedBeforeMoney && !moneyThenName && index < (newOrder ? 2 : 4) && /\b(producto|pedido|orden|venta|sin descripci|descripci[oó]n)\b/i.test(concept)) {
        continue;
      }
      if (moneyThenName) {
        const name = String(match[2] ?? '');
        if (/\b(sin descripci|descripci[oó]n|producto|pedido)\b/i.test(name)) {
          push('Costo extra', match[1] ?? '');
          continue;
        }
        push(name, match[1] ?? '');
      } else if (verbOrBare) push('Costo extra', match[1] ?? '');
      else push(match[1] ?? '', match[2] ?? '');
    }
  }

  if (!items.length) {
    const bare = text.match(new RegExp(String.raw`\bcostos?\s+(?:extra\s+)?\$?\s*` + COST_MONEY + String.raw`\b`, 'i'));
    if (bare?.[1]) push('Costo extra', bare[1]);
  }

  if (!items.length) {
    const named = text.match(
      /\bcostos?\s+(?:extra\s+)?(?:de\s+|del\s+|al\s+)?(?!pedido\b|orden\b|venta\b|extra\b)([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{1,40}?)(?:\s+(?:al|del|de)\s+(?:pedido|orden)|$|,|\.|!)/i
    );
    if (named?.[1]) {
      const label = cleanCostConcept(named[1]);
      if (label !== 'Costo extra' && !COST_NAME_STOP.test(label)) {
        items.push({ nombre: label, costo: 0 });
      }
    }
  }
  return items;
}

export function mergeExtraCostItems(
  known?: ExtraCostItem[] | null,
  incoming?: ExtraCostItem[] | null
): ExtraCostItem[] {
  const useful = (list?: ExtraCostItem[] | null) =>
    (list ?? []).filter((item) => String(item.nombre ?? '').trim() && Number(item.costo) > 0);
  const incomingUseful = useful(incoming);
  const knownUseful = useful(known);
  if (!incomingUseful.length) return knownUseful;
  const byName = new Map<string, ExtraCostItem>();
  for (const item of [...knownUseful, ...incomingUseful]) {
    const key = String(item.nombre).trim().toLowerCase();
    byName.set(key, { nombre: item.nombre.trim(), costo: Number(item.costo) });
  }
  return [...byName.values()];
}

/** Respuesta al slot de costo extra: «estampado 150», «$150 estampado», «estampado 150 y bolsa 30». */
export function parseSpokenExtraCostAnswer(text: string): ExtraCostItem[] {
  const raw = String(text ?? '').trim();
  if (!raw || /^(no+|n[oó]|nop|n|si|sí|ok|dale)$/i.test(raw)) return [];
  const seen = new Set<string>();
  const out: ExtraCostItem[] = [];
  const push = (nombre: string, costo: number) => {
    if (!(costo > 0)) return;
    const label = cleanCostConcept(nombre);
    const key = `${label.toLowerCase()}|${costo}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ nombre: label, costo });
  };
  for (const item of extractExtraCostsFromText(raw)) {
    push(item.nombre, item.costo);
  }
  const chunks = raw
    .split(/\s+y\s+|,\s+(?=[A-Za-zÁÉÍÓÚÜÑáéíóúüñ$]|\d)/i)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  for (const chunk of chunks.length ? chunks : [raw]) {
    const moneyFirst = chunk.match(
      /^\$?\s*(\d{1,7}(?:[.,]\d{1,2})?)\s+(?:de\s+|en\s+|por\s+)?([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{1,40})$/i
    );
    if (moneyFirst) {
      push(moneyFirst[2] ?? '', parseLooseMoney(moneyFirst[1] ?? ''));
      continue;
    }
    const nameFirst = chunk.match(
      /^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{1,40}?)\s+\$?\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*$/i
    );
    if (nameFirst && !/^(si|sí|no|ok|dale)$/i.test(nameFirst[1] ?? '')) {
      push(nameFirst[1] ?? '', parseLooseMoney(nameFirst[2] ?? ''));
    }
  }
  return out;
}

function foldExtraCostLabel(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function extraCostItemLabels(entities: {
  items?: Array<{ productName?: string; productHint?: string; rawText?: string; skipped?: boolean }>;
  productName?: string;
}): string[] {
  const items = (entities.items ?? []).filter((item) => !item.skipped);
  const labels = items
    .map((item) => String(item.productName || item.productHint || item.rawText || '').trim())
    .filter(Boolean);
  if (labels.length) return labels;
  const single = String(entities.productName ?? '').trim();
  return single ? [single] : [];
}

/** «al canguro agregale 150 de estampado» → canguro. */
export function extractExtraCostProductHint(text: string): string | undefined {
  const match = String(text ?? '').match(
    /(?<![\p{L}])(?:al|a\s+la|a\s+el|del|de\s+la|para\s+el|para\s+la|en\s+el|en\s+la)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9/-]{1,40})(?![\p{L}])/iu
  );
  const hint = String(match?.[1] ?? '').trim();
  if (!hint) return undefined;
  if (
    /^(pedido|orden|venta|costo|extra|estampado|bordado|vinilo|bolsa|cliente|pago|saldo)$/i.test(hint)
  ) {
    return undefined;
  }
  return hint;
}

export function resolveExtraCostTargetIndex(
  entities: {
    items?: Array<{ productName?: string; productHint?: string; rawText?: string; skipped?: boolean }>;
    productName?: string;
    extraCostsProductHint?: string;
    extraCostsTargetItemIndex?: number;
  },
  spokenHint?: string
): number | null {
  const labels = extraCostItemLabels(entities);
  if (labels.length <= 1) return 0;
  const locked = entities.extraCostsTargetItemIndex;
  if (Number.isInteger(locked) && Number(locked) >= 0 && Number(locked) < labels.length) {
    return Number(locked);
  }
  const hint = foldExtraCostLabel(spokenHint || entities.extraCostsProductHint || '').replace(
    /^(el|la|los|las|al|del|un|una|a)\s+/,
    ''
  );
  if (!hint) return null;
  const hits = labels
    .map((label, index) => ({ index, label: foldExtraCostLabel(label) }))
    .filter(({ label }) => label.includes(hint) || hint.includes(label));
  return hits.length === 1 ? hits[0]!.index : null;
}

export function needsExtraCostItemAsk(entities: {
  extraCosts?: ExtraCostItem[];
  items?: Array<{ productName?: string; productHint?: string; rawText?: string; skipped?: boolean }>;
  productName?: string;
  extraCostsProductHint?: string;
  extraCostsTargetItemIndex?: number;
}): boolean {
  const extras = (entities.extraCosts ?? []).filter((item) => Number(item.costo) > 0);
  if (!extras.length) return false;
  return resolveExtraCostTargetIndex(entities) == null;
}

export function formatExtraCostItemAsk(
  extras: ExtraCostItem[],
  entities: {
    items?: Array<{ productName?: string; productHint?: string; rawText?: string; skipped?: boolean }>;
    productName?: string;
  }
): string {
  const extra = extras.find((item) => Number(item.costo) > 0) ?? extras[0];
  const name = String(extra?.nombre ?? 'costo extra').trim() || 'costo extra';
  const amount = formatSpokenMoney(Number(extra?.costo) || 0);
  const labels = extraCostItemLabels(entities);
  const lines = labels.map((label, index) => `${index + 1}) ${label}`);
  return [`¿A cuál producto corresponde el ${name.toLowerCase()} de ${amount}?`, ...lines]
    .filter(Boolean)
    .join('\n');
}

export function looksLikeClearExtraCosts(text: string): boolean {
  return /(?<![\p{L}])(?:sacale|quita(?:le)?|sin|borra(?:le)?)\s+(el\s+|los\s+)?costos?\s+extra/iu.test(
    String(text ?? '')
  );
}

export function looksLikePayEverythingNow(text: string): boolean {
  return /(?<![\p{L}])(?:todo\s+(?:pago|pagado|cobrado|saldado)|est[aá]\s+todo\s+pago|pag[oó]\s+todo|completo)(?![\p{L}])/iu.test(
    String(text ?? '')
  );
}

export function formatExtraCostsHint(entities: { extraCosts?: ExtraCostItem[] }): string {
  const extras = mergeExtraCostItems(entities.extraCosts, null);
  if (!extras.length) return '';
  return extras.map((item) => `${item.nombre} $${item.costo}`).join(', ');
}

const PERSON_NAME_STOP = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'al',
  'en',
  'con',
  'por',
  'hoy',
  'manana',
  'manan',
  'pasado',
  'dia',
  'fecha',
  'entrega',
  'pedido',
  'orden',
  'venta',
  'compra',
  'este',
  'esta',
  'esto',
  'ese',
  'esa',
  'eso',
  'estado',
  'entregado',
  'entregada',
  'listo',
  'pendiente',
  'proceso',
  'produccion',
  'move',
  'movelo',
  'pone',
  'poné',
  'ponelo',
  'pasalo',
  'marcalo',
  'dejalo',
  'cambiale',
  'cambialo',
  'ahora',
  'estos',
  'estas',
  'esos',
  'esas',
  'cuanto',
  'saldo',
  'cero',
  'busca',
  'buscar',
  'buscame',
  'mostra',
  'mostrame',
  'lista',
  'listame',
  'ingresa',
  'ingresar',
  'ingresa',
  'registra',
  'registrar',
  'registra',
  'carga',
  'cargar',
  'anota',
  'anotar',
  'agrega',
  'agregar',
  'crear',
  'nuevo',
  'nueva',
  'descripcion',
  'costo',
  'costos',
  'producto',
  'productos',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'setiembre',
  'octubre',
  'noviembre',
  'diciembre',
]);

/** «jueves», «el viernes», «para el lunes» no son nombres de persona. */
export function isUnlikelyPersonName(value: string): boolean {
  const tokens = normalizeName(value)
    .split(' ')
    .filter(Boolean)
    .filter((token) => !['el', 'la', 'los', 'las', 'de', 'del', 'al', 'a', 'en', 'como', 'un', 'una'].includes(token));
  if (!tokens.length) return true;
  if (tokens.every((token) => PERSON_NAME_STOP.has(token) || /^\d+$/.test(token))) return true;
  if (tokens.length === 1 && PERSON_NAME_STOP.has(tokens[0]!)) return true;
  if (
    tokens[0] &&
    /^(ingresa|ingresar|registra|registrar|carga|cargar|anota|anotar|agrega|agregar|crear)$/.test(tokens[0])
  ) {
    return true;
  }
  if (tokens.length === 1 && PRODUCTISH_TOKEN.test(tokens[0]!)) return true;
  return false;
}

const PERSON_NAME_CHUNK =
  '[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\'-]*(?:\\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\'-]*){0,2}';

const PRODUCTISH_TOKEN =
  /^(camiseta|remera|remeras|pantal[oó]n|pantalones|jean|jeans|buzo|short|shorts|talle|taza|hoodie|campera|vestido|pollera|algod[oó]n|polo|chomba|body|enterito|conjunto|oversize)$/i;

function dropProductishClientTokens(value: string): string {
  const tokens = value.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && PRODUCTISH_TOKEN.test(tokens[tokens.length - 1] ?? '')) {
    tokens.pop();
  }
  return tokens.join(' ');
}

function takePersonNameBeforeProduct(value: string): string {
  const tokens = String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const kept: string[] = [];
  for (const token of tokens) {
    const plain = normalizeName(token);
    if (PRODUCTISH_TOKEN.test(token)) break;
    if (SIZE_TOKENS.has(plain)) break;
    if (/^\d+$/.test(token) || token.startsWith('$')) break;
    if (/^(descripci[oó]n|costos?|productos?|pedido|orden|venta)$/i.test(token)) break;
    if (/^(que|no|con|sin|en|estado|entregad[oa]s?|abiertos?|pendientes?|cerrad[oa]s?)$/i.test(token)) {
      break;
    }
    kept.push(token);
  }
  return dropProductishClientTokens(kept.join(' '));
}

function stripOrderClientPrefix(text: string): string {
  const span = findSpokenPartySpan(text);
  if (span) {
    return `${text.slice(0, span.cueStart)} ${text.slice(span.nameEnd)}`;
  }
  const re = new RegExp(`\\b(pedido|orden|venta)\\s+(para|a|de)\\s+(${PERSON_NAME_CHUNK})`, 'i');
  return text.replace(re, (_all, _kind: string, _prep: string, name: string) => {
    const kept = takePersonNameBeforeProduct(name);
    const extra = name.slice(kept.length).trim();
    return extra ? ` ${extra} ` : ' ';
  });
}

export function extractClientHintFromText(text: string): string | null {
  const fromSpan = extractPartyRawFromUtterance(text);
  if (fromSpan && !isUnlikelyPersonName(fromSpan)) {
    if (/^(este|esta|esto|ese|esa|eso|pedido|orden|venta|compra|precio|monto|talle|producto)\b/i.test(fromSpan)) {
      return null;
    }
    return fromSpan;
  }
  const raw = String(text ?? '');
  const orderMatch = raw.match(
    new RegExp(
      `\\b(?:(?:ingres[aeá]|registr[aeá]|carg[aeá]|anot[aeá]|agreg[aeá]|crear)\\s+(?:el\\s+|un\\s+|la\\s+|una\\s+)?)?(?:pedido|orden|venta)\\s+(?:para|a|de)\\s+(${PERSON_NAME_CHUNK})`,
      'i'
    )
  );
  const clienteMatch = raw.match(new RegExp(`\\bcliente\\s+(${PERSON_NAME_CHUNK})`, 'i'));
  const saldoMatch = raw.match(new RegExp(`\\bsaldo\\s+(?:de\\s+)?(${PERSON_NAME_CHUNK})`, 'i'));
  const paraMatch = raw.match(new RegExp(`\\b(?:para)\\s+(${PERSON_NAME_CHUNK})`, 'i'));
  const captured = orderMatch?.[1] || clienteMatch?.[1] || saldoMatch?.[1] || paraMatch?.[1];
  if (!captured) return null;
  const hint = takePersonNameBeforeProduct(captured.trim().replace(/[.,;:!?]+$/, ''));
  if (!hint || isUnlikelyPersonName(hint)) return null;
  if (/^(este|esta|esto|ese|esa|eso|pedido|orden|venta|compra|precio|monto|talle|producto)\b/i.test(hint)) {
    return null;
  }
  return hint;
}

function cleanQueryClientHint(value: string): string | null {
  let hint = dropProductishClientTokens(String(value ?? '').trim().replace(/[.,;:!?¿]+$/, ''));
  hint = hint
    .replace(
      /\s+(?:tiene|pidi[oó]|compr[oó]|qu[eé]|el|la|los|las|n(?:ro\.?|[uú]mero)|pedido|venta|compra|ponelo|pasalo|movelo|marcalo|dejalo|cambialo|move|listo|estado|entregad[oa]).*$/i,
      ''
    )
    .trim();
  if (!hint || isUnlikelyPersonName(hint)) return null;
  if (/^(pedido|orden|venta|compra|n(?:ro|úmero)|cliente|talle)\b/i.test(hint)) return null;
  if (PRODUCTISH_TOKEN.test(hint.split(/\s+/)[0] ?? '')) return null;
  return hint;
}

/** Cliente en una consulta: «qué pidió Lizzy», «número de pedido de María». */
export function extractQueryClientFromText(text: string): string | null {
  const raw = String(text ?? '').trim();
  const patterns = [
    new RegExp(`\\b(?:el|ese|este)\\s+(?:pedido\\s+)?de\\s+(${PERSON_NAME_CHUNK})`, 'i'),
    new RegExp(
      `\\b(?:mostr(?:ame|[áa])|list(?:ame|[áa])|busc(?:ame|[áa]|ar))\\s+(?:el\\s+|los\\s+|la\\s+|un\\s+)?(?:pedido|pedidos)\\s+de\\s+(${PERSON_NAME_CHUNK})`,
      'i'
    ),
    new RegExp(
      `\\b(?:pedido|pedidos)\\s+de\\s+(${PERSON_NAME_CHUNK})(?:\\s+que\\b|\\s+con\\b|\\s+no\\b)`,
      'i'
    ),
    new RegExp(
      `\\b(?:pedido|pedidos|venta|ventas|n(?:ro\\.?|[uú]mero))\\s+(?:de\\s+|del\\s+cliente\\s+)?(${PERSON_NAME_CHUNK})\\s*[?¿.]?$`,
      'i'
    ),
    new RegExp(`\\b(?:al|del)\\s+pedido\\s+de\\s+(${PERSON_NAME_CHUNK})`, 'i'),
    new RegExp(
      `\\b(?:pidi[oó]|compr[oó]|tiene|anotamos|registramos|cargamos|busc(?:[aá]|ar))\\s+(?:el\\s+pedido\\s+de\\s+)?(${PERSON_NAME_CHUNK})\\s*[?¿.]?$`,
      'i'
    ),
    new RegExp(
      `\\b(?:el\\s+)?cliente\\s+(${PERSON_NAME_CHUNK})(?:\\s+(?:tiene|pid|compr|qu[eé]|el|la|n(?:ro|[uú]mero))|\\s*[?¿.]|$)`,
      'i'
    ),
    new RegExp(
      `\\b(?:qu[eé]\\s+(?:pidi[oó]|compr[oó]|tiene)|n(?:ro\\.?|[uú]m(?:ero)?)(?:\\s+de)?\\s+pedido\\s+(?:de|tiene)|tiene\\s+(?:el\\s+)?(?:n(?:ro\\.?|[uú]m(?:ero)?)\\s+de\\s+)?pedido)\\s+(${PERSON_NAME_CHUNK})`,
      'i'
    ),
    new RegExp(
      `^(${PERSON_NAME_CHUNK})\\s+(?:qu[eé]\\s+(?:pid|compr|tiene)|tiene\\s+(?:el\\s+)?(?:pedido|n(?:ro|[uú]mero))|el\\s+pedido)`,
      'i'
    ),
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const hint = cleanQueryClientHint(String(match?.[1] ?? ''));
    if (hint) return hint;
  }
  if (/\b(?:el|ese|este)\s+(?:pedido\s+)?de\b/i.test(raw) || /\bcliente\s+/i.test(raw) || /\bpedido\s+de\b/i.test(raw)) {
    return extractClientHintFromText(raw);
  }
  return null;
}

function stripProductWrappers(value: string): string {
  let rest = value.trim();
  rest = rest.replace(/^(el\s+)?producto(\s+es)?\s*[:.\-]?\s*/i, '');
  rest = rest.replace(/^es\s+/i, '');
  rest = rest.replace(/\b(?:entrega(?:r)?(?:lo)?|para el(?: d[ií]a)?)\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 /.-]{1,40}/gi, ' ');
  rest = rest.replace(
    /\b(hoy|ma[nñ]ana|pasado\s+ma[nñ]ana|(el\s+)?(pr[oó]ximo\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(\s+que viene)?)\b/gi,
    ' '
  );
  rest = rest.replace(/\b(es la fecha(?: de entrega)?|fecha de entrega|que viene|pr[oó]ximo)\b/gi, ' ');
  rest = rest.replace(/[,.;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  return rest;
}

/** Producto en una frase coloquial, sin cliente, precio, fecha ni «descripción». */
export function extractProductHintFromText(text: string): string | null {
  const raw = String(text ?? '');
  if (isNonProductUtterance(raw)) return null;
  const labeled = raw.match(
    /\bproducto\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ./-]{0,60}?)(?:\s+(?:a|@|por)\s*\$)/i
  );
  const labeledName = labeled?.[1]?.trim().replace(/[.,;:]+$/, '');
  if (labeledName && labeledName.length >= 2 && !/^(es|el|la|un|una)\b/i.test(labeledName)) {
    return labeledName.slice(0, 80);
  }

  let rest = stripOrderClientPrefix(raw);
  rest = rest.replace(new RegExp(`\\bcliente\\s+${PERSON_NAME_CHUNK}`, 'i'), ' ');
  rest = rest.replace(
    /\b(ingres[aeoá]|resgistr[aeoá]|registr[aeoá]|anot[aeoá]|carg[aeoá])\s+(un|una|el|la)?\s*/gi,
    ' '
  );
  rest = rest.replace(/\bsin\s+(descripci[oó]n|detalle|notas?|observaciones)\b/gi, ' ');
  rest = rest.replace(/\bcostos?\s*(?:extra\s+)?\$?\s*[\d.]+(?:,\d+)?/gi, ' ');
  rest = rest.replace(/\$\s*[\d.]+(?:,\d{2})?/g, ' ');
  rest = rest.replace(/\bdescripci[oó]n\b[:\s]+.+$/i, ' ');
  rest = rest.replace(/\b(?:con\s+)?dise[nñ]o\b.+$/gi, ' ');
  rest = rest.replace(
    /\b(?:ya\s+)?(?:est[aá]|qued[oó])\s+(?:todo\s+)?(?:pagad[oa]|pago|cobrad[oa]|saldad[oa]|abonad[oa]).+$/gi,
    ' '
  );
  rest = stripProductWrappers(rest);
  if (rest.length < 3 || rest.length > 120) return null;
  if (isPlaceholderProductLabel(rest)) return null;
  if (isUnlikelyPersonName(rest)) return null;
  if (
    /\b(soy el|principe|príncipe|nombre del beb[eé]|observaciones?)\b/i.test(rest) &&
    !/\b(camiseta|remera|buzo|jean|pantal|taza|campera|producto)\b/i.test(rest)
  ) {
    return null;
  }
  return rest;
}

export function extractNotesHintFromText(text: string): string | null {
  const raw = String(text ?? '');
  const labeled = raw.match(/\bdescripci[oó]n\b[:\s]+(.+)$/i);
  const fromLabel = labeled?.[1]?.trim().replace(/[.,;]+$/, '');
  if (fromLabel && fromLabel.length >= 2) {
    return sanitizeOrderNotes(fromLabel) ?? fromLabel.slice(0, 240);
  }

  const correction = raw.match(
    /\b(?:(?:cambi(?:ale|[áa]|ar)|el|con|y\s+el)\s+)?dise[nñ]o\s+(?:en\s+realidad\s+)?(?:que\s+)?(?:diga|dice|es|pasa\s+a|por|de)\s+(.+?)(?:\.|$)/i
  );
  if (correction?.[1]?.trim()) {
    return sanitizeOrderNotes(correction[1].trim()) ?? `diseño ${correction[1].trim()}`.slice(0, 240);
  }

  const design = raw.match(
    /\b((?:con\s+)?dise[nñ]o(?:\s+(?:adelante|atr[aá]s|espalda|pecho|frente|de))?\s+.+?)(?=\s+ya\s+est|\s+pagad|\s+\$|$)/i
  );
  const fromDesign = design?.[1]?.trim().replace(/^(con\s+)/i, '').replace(/[.,;]+$/, '');
  if (fromDesign && fromDesign.length >= 2) {
    return sanitizeOrderNotes(fromDesign) ?? fromDesign.slice(0, 240);
  }
  return null;
}

export type SpokenCorrections = {
  clientName?: string;
  productName?: string;
  amount?: number;
  deliveryDate?: string;
  notes?: string;
  clearNotes?: boolean;
};

function patchTalleInProduct(current: string | undefined, text: string): string | null {
  const talle = text.match(/\btalle\s+([a-z0-9]+)\b/i);
  if (!talle?.[1]) return null;
  const known = String(current ?? '').trim();
  if (!known) return null;
  if (!/\btalle\b/i.test(text) || /\b(cliente|precio|monto|fecha|descripci[oó]n)\b/i.test(text)) {
    if (!/^(el\s+)?talle\s+[a-z0-9]+$/i.test(text.trim()) && !/\bcambi/.test(text)) return null;
  }
  if (/\btalle\s+[a-z0-9]+\b/i.test(known)) {
    return known.replace(/\btalle\s+[a-z0-9]+\b/i, `talle ${talle[1]}`);
  }
  return `${known} talle ${talle[1]}`.trim();
}

/** Correcciones en lenguaje natural: «el cliente es X», «precio 600», «talle M». */
export function extractSpokenCorrections(
  text: string,
  known?: { productName?: string }
): SpokenCorrections {
  const raw = String(text ?? '').trim();
  if (!raw) return {};
  const out: SpokenCorrections = {};

  const client =
    raw.match(
      /\b(?:el\s+)?cliente(?:\s+es|\s*:\s*|\s+est[aá]\s+mal[,.]?\s*(?:es)?|\s+camb(?:i[aá]|iar)\s+(?:a|por)?)\s+(.+)$/i
    ) || raw.match(/\bcambi(?:[aá]|ar)\s+(?:el\s+)?cliente\s+(?:a|por)\s+(.+)$/i);
  if (client?.[1]) {
    const name = dropProductishClientTokens(client[1].trim().replace(/[.,;:!?]+$/, ''));
    const cleaned = name.replace(/\b(el\s+)?(producto|precio|monto|fecha|descripci[oó]n)\b.*$/i, '').trim();
    if (cleaned && !isUnlikelyPersonName(cleaned)) out.clientName = cleaned;
  }

  const product =
    raw.match(
      /\b(?:el\s+)?producto(?:\s+es|\s*:\s*|\s+est[aá]\s+mal[,.]?\s*(?:es)?|\s+camb(?:i[aá]|iar)\s+(?:a|por)?)\s+(.+)$/i
    ) || raw.match(/\bcambi(?:[aá]|ar)\s+(?:el\s+)?producto\s+(?:a|por)\s+(.+)$/i);
  if (product?.[1]) {
    const name = extractProductHintFromText(product[1]) || stripProductWrappers(product[1]);
    if (name) out.productName = name;
  }

  const tallePatched = patchTalleInProduct(known?.productName, raw);
  if (tallePatched) out.productName = tallePatched;

  const notes =
    raw.match(/\b(?:la\s+)?descripci[oó]n(?:\s+es|\s*:\s*)\s*(.+)$/i) ||
    raw.match(/\b(?:las\s+)?notas?(?:\s+son|\s*:\s*)\s*(.+)$/i);
  if (notes?.[1]) {
    const value = notes[1].trim().replace(/[.,;]+$/, '');
    if (value.length >= 2) out.notes = value.slice(0, 240);
  }
  const designNotes = extractNotesHintFromText(raw);
  if (designNotes && /\bdise[nñ]o\b/i.test(raw)) out.notes = designNotes;
  if (/^(sin descripci[oó]n|sin notas?|listo|nada)$/i.test(raw)) out.clearNotes = true;

  const amountMatch =
    raw.match(
      /\b(?:el\s+)?(?:precio|monto|importe|total)(?:\s+es|\s*:\s*|\s+camb(?:i[aá]|iar)\s+(?:a|por))?\s*\$?\s*([\d.]+(?:,\d{2})?)/i
    ) ||
    raw.match(/\bcambi(?:[aá]|ar)\s+(?:el\s+)?(?:precio|monto)\s+(?:a|por)\s*\$?\s*([\d.]+(?:,\d{2})?)/i);
  if (amountMatch?.[1]) {
    const amount = Number(String(amountMatch[1]).replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(amount) && amount > 0) out.amount = amount;
  } else if (/(\$|\bprecio\b|\bmonto\b|\bvale\b)/i.test(raw)) {
    const amount = extractAmountFromText(raw);
    if (amount) out.amount = amount;
  }

  if (
    /\b(fecha|entrega|hoy|ma[nñ]ana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/i.test(
      raw
    )
  ) {
    const delivery = extractDeliveryDateFromText(raw);
    if (delivery) out.deliveryDate = delivery;
  }

  return out;
}

export function looksLikeClientCorrection(text: string): boolean {
  return /\b((?:el\s+)?cliente\s+(?:es|est[aá]\s+mal|no\s+era)|otro\s+cliente|no[,.]?\s+(?:es\s+)?(?:ese|este)\s+cliente|cambi(?:[aá]|ar)\s+(?:el\s+)?cliente)\b/i.test(
    String(text ?? '')
  );
}

export function looksLikeProductCorrection(text: string): boolean {
  return /\b((?:el\s+)?producto\s+(?:es|est[aá]\s+mal|no\s+era)|no[,.]?\s+(?:es\s+)?(?:ese|este)\s+producto|el\s+\w+\s+mejor|cambi(?:[aá]|ar)\s+(?:el\s+)?(?:producto|color|talle|tela))\b/i.test(
    String(text ?? '')
  );
}

export function looksLikeIterativeCorrection(text: string): boolean {
  const raw = String(text ?? '').trim();
  if (!raw || /^\d{1,2}$/.test(raw)) return false;
  if (
    /\b(corrijo|en realidad|camb(?:i[aá]|iar)|no es|est[aá] mal|el cliente|el producto|el precio|el monto|la fecha|la descripci|talle)\b/i.test(
      raw
    )
  ) {
    return true;
  }
  const spoken = extractSpokenCorrections(raw);
  return Boolean(
    spoken.clientName ||
      spoken.productName ||
      spoken.amount ||
      spoken.deliveryDate ||
      spoken.notes ||
      spoken.clearNotes
  );
}

/** «registrar cliente María Pérez 099123456» → nombre + teléfono opcional. */
export function extractRegisterClientFromText(
  text: string
): { name?: string; phone?: string } | null {
  const match =
    text.match(
      /\b(?:registr(?:ar|[áa])|nuevo|alta|cargar|anotar|agregar|crear)\s+(?:el\s+|un\s+|los\s+)?clientes?(?:\s+nuevos?)?\s+(.+)$/i
    ) || text.match(/\bclientes?\s+nuevos?\s+(.+)$/i);
  if (!match?.[1]) return null;
  const rest = match[1].trim().replace(/[.,;:!?]+$/, '');
  if (!rest) return {};
  const phoneMatch = rest.match(/^(.*?)\s+(?:\+|00)?(\d[\d\s\-.]{6,})$/);
  if (phoneMatch?.[1]?.trim()) {
    return {
      name: phoneMatch[1].trim().replace(/[.,;:!?]+$/, ''),
      phone: phoneMatch[2]!.replace(/[\s\-.]/g, ''),
    };
  }
  return { name: rest };
}

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function nextWeekday(from: Date, weekday: number): Date {
  const delta = (weekday - from.getDay() + 7) % 7;
  return addDays(from, delta);
}

function normalizeDateText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function dateTokenClose(word: string, target: string, maxDist = 2): boolean {
  if (!word || !target) return false;
  if (word === target) return true;
  if (word.length < 3 || target.length < 3) return false;
  if (Math.abs(word.length - target.length) > maxDist) return false;
  return levenshtein(word, target) <= maxDist;
}

function parseLooseDate(text: string): string | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const normalized = normalizeDateText(raw);
  const today = todayLocal();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10))) return raw.slice(0, 10);
  if (/\bhoy\b/.test(normalized)) return toDateOnly(today);
  if (/\bpasado\s+manana\b/.test(normalized)) return toDateOnly(addDays(today, 2));
  if (/\bmanana\b/.test(normalized)) return toDateOnly(addDays(today, 1));

  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(normalized)) {
      return toDateOnly(nextWeekday(today, weekday));
    }
  }

  const words = normalized.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length && words.length <= 6) {
    const hasPasado = words.some((word) => dateTokenClose(word, 'pasado', 2));
    const hasManana = words.some((word) => dateTokenClose(word, 'manana', 2));
    if (hasPasado && hasManana) return toDateOnly(addDays(today, 2));
    if (hasManana) return toDateOnly(addDays(today, 1));
    if (words.some((word) => dateTokenClose(word, 'hoy', 1))) return toDateOnly(today);
    for (const [name, weekday] of Object.entries(WEEKDAYS)) {
      const maxDist = name.length <= 5 ? 1 : 2;
      if (words.some((word) => dateTokenClose(word, name, maxDist))) {
        return toDateOnly(nextWeekday(today, weekday));
      }
    }
  }

  const dmy = normalized.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = dmy[3] ? Number(dmy[3]) : today.getFullYear();
    if (year < 100) year += 2000;
    const date = new Date(year, month - 1, day);
    if (date.getMonth() === month - 1 && date.getDate() === day) return toDateOnly(date);
  }

  const named = normalized.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2]!] ?? 0;
    if (month) {
      const date = new Date(today.getFullYear(), month - 1, day);
      if (date.getDate() === day) return toDateOnly(date);
    }
  }

  return null;
}

/** Fecha de entrega si el texto habla de entrega; si no, cualquier fecha suelta. */
export function extractDeliveryDateFromText(text: string): string | null {
  const raw = String(text ?? '');
  const deliveryChunk = raw.match(
    /\b(?:entrega(?:r)?|entregarlo|para el|para el d[ií]a)[:\s]+([^.,;]+)/i
  );
  if (deliveryChunk) {
    const parsed = parseLooseDate(deliveryChunk[1] ?? '');
    if (parsed) return parsed;
  }
  return parseLooseDate(raw);
}

export function extractOrderDateFromText(text: string): string | null {
  const raw = String(text ?? '');
  const chunk = raw.match(/\b(?:carg[oa]do|fecha de carga|registr(?:o|ado)|hoy lo cargo)[:\s]+([^.,;]+)/i);
  if (chunk) return parseLooseDate(chunk[1] ?? '');
  if (/\bhoy\b/i.test(raw) && /\b(cargo|cargarlo|pedido|venta)\b/i.test(raw)) {
    return toDateOnly(todayLocal());
  }
  return null;
}

export function extractOrderNumberFromText(text: string): string | null {
  const hash = String(text ?? '').match(/#\s*0*(\d{1,8})/);
  if (hash?.[1]) return hash[1];
  const pedidoNro = String(text ?? '').match(
    /\bpedidos?\s*(?:nro\.?|n[uú]m(?:ero)?|#)\s*0*(\d{1,8})\b/i
  );
  if (pedidoNro?.[1]) return pedidoNro[1];
  const pedido = String(text ?? '').match(/\bpedidos?\s*#?\s*0*(\d{1,8})\b/i);
  if (pedido?.[1]) return pedido[1];
  const nro = String(text ?? '').match(
    /\b(?:nro\.?|n[uú]m(?:ero)?)\s*(?:de\s+pedido\s*)?#?\s*0*(\d{1,8})\b/i
  );
  if (nro?.[1]) return nro[1];
  return null;
}

export function looksLikeNewOrder(text: string): boolean {
  const raw = String(text ?? '').trim();
  if (!raw) return false;
  if (
    /\b((ingres[aeá]|registr[aeá]|carg[aeá]|anot[aeá]|agreg[aeá]|crear)\s+(el\s+|un\s+|la\s+|una\s+)?(pedido|orden)|nuevo\s+(pedido|orden))\b/i.test(
      raw
    )
  ) {
    return true;
  }
  if (
    /\b(sumale|sumále|agregale|agregále|pon[eé]le)\b/i.test(raw) ||
    /\b(pedido|orden)\s*#\s*\d/i.test(raw) ||
    /\b(nro\.?|n[uú]m(?:ero)?)\s*(de\s+)?pedido/i.test(raw)
  ) {
    return false;
  }
  const hasOrderWord = /\b(pedido|orden)\b/i.test(raw);
  if (!hasOrderWord) return false;
  const hasPrice = /\$\s*\d/.test(raw);
  const hasProduct =
    /\b(camiseta|remera|buzo|jean|pantal|taza|campera|vestido|talle|producto|algod[oó]n)\b/i.test(raw);
  const hasDesc = /\bdescripci[oó]n\b/i.test(raw);
  const hasClientPrep = /\b(pedido|orden)\s+(para|de|a(?!\s+estado))\b/i.test(raw);
  if (hasClientPrep && (hasPrice || hasProduct || hasDesc)) return true;
  if (hasPrice && (hasProduct || hasDesc)) return true;
  return false;
}

/**
 * Dijo que cobra / salda TODO el saldo, sin un monto puntual.
 * Cubre «cobra todo el saldo», «cobra el saldo», «saldalo», «ya pagó».
 */
export function looksLikeCollectFullBalance(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  return /(?<![\p{L}])(sald(?:alo|ar)(?!\s+de)|qued[oó]\s+saldado|saldo\s+(?:en\s+)?cero|deja(?:lo)?\s+(?:el\s+)?saldo|pago\s+(?:del\s+)?total(?:\s+del\s+saldo)?|total\s+del\s+saldo|registr[aeá]\s+(?:el\s+)?pago(?:\s+del\s+(?:total|saldo)|(?:\s+total))?|cobra(?:r|me|le|lo)?\s+(?:todo\s+)?(?:el\s+)?(?:saldo|total|resto)|cobra(?:r|me|le|lo)?\s+todo(?!\s*\$?\s*\d)|todo\s+el\s+saldo|todo\s+lo\s+que\s+falta(?:ba)?|el\s+saldo\s+(?:entero|completo)|pag[oó]\s+(todo|el\s+resto|lo\s+que\s+faltaba|completo)|(ya|me)\s+pag[oó](?!\s*\$?\s*\d)|abon[oó]\s+(todo|el\s+resto)|est[aá]\s+(todo\s+)?pago)(?![\p{L}])/iu.test(
    t
  );
}

/** Pregunta por un pedido que ya está en el chat: saldo, estado, «este/ese pedido». */
export function looksLikeExistingOrderQuery(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t || looksLikeNewOrder(t)) return false;
  if (looksLikeStatusQuery(t)) return true;
  return /(?<![\p{L}])((?:el\s+|y\s+el\s+)?saldo\s+(?:de\s+)?(?:este|ese|el)\s+pedido|(?:este|ese)\s+pedido|cu[aá]nto\s+(?:es\s+|queda\s+)?(?:el\s+)?saldo|el\s+saldo\s+(?:de\s+este|de\s+ese|del\s+pedido)|cu[aá]nto\s+(?:es\s+el\s+)?(?:este|ese)\s+pedido)(?![\p{L}])/iu.test(
    t
  );
}

export function looksLikeStatusQuery(text: string): boolean {
  const raw = String(text ?? '').trim();
  if (!raw) return false;
  if (looksLikeNewOrder(raw)) return false;
  if (
    /\b(sumale|sumále|agregale|agregále|pon[eé]le|al\s+costos?|costos?\s+extra)\b/i.test(raw) ||
    /\b(agreg[áa]|sum[áa]|anot[áa])\s+(?:un\s+)?(?:(?:í|i)tem\s+de\s+)?(?:al\s+)?costos?/i.test(raw)
  ) {
    return false;
  }
  if (/\b(pedido|orden)\s+(para|a|de)\b/i.test(raw) && /\$|entrega|\btalle\b/.test(raw)) {
    return false;
  }
  if (/\b(pedido|orden)\s+(para|a|de)\b/i.test(raw) && Number(extractAmountFromText(raw) ?? 0) > 0) {
    return false;
  }
  if (
    /\bpedidos?\s+de\b/i.test(raw) &&
    /\b(camiseta|remera|buzo|jean|pantal|taza|campera|vestido|talle)\b/i.test(raw)
  ) {
    return false;
  }
  return (
    /\b(en\s+qu[eé]\s+estado|qu[eé]\s+estado|c[oó]mo\s+qued[oó]|c[oó]mo\s+lo\s+(registraste|anotaste|dejaste|pusiste|cargaste)|c[oó]mo\s+est[aá]\s+(el|la|ese|esa|esto|eso)|busc(?:[aá]|ar)\s+(el\s+|un\s+)?(pedido|venta|compra)|resumen\s+(del|de\s+(el|la|ese|esa|esto|eso)|pedido)|el\s+[uú]ltimo\s+(pedido|venta)|pedido\s*#\s*\d+|qu[eé]\s+(le\s+)?(pusiste|anotaste|registraste|pidi[oó]|compr[oó])|d[oó]nde\s+lo\s+(dejaste|pusiste|anotaste)|n(?:ro\.?|[uú]m(?:ero)?)(?:\s+de)?\s+pedido|qu[eé]\s+n(?:ro\.?|[uú]mero)|tiene\s+(el\s+)?pedido|cu[aá]l\s+es\s+el\s+pedido|el\s+pedido\s+de|pedidos?\s+de\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]|qu[eé]\s+pidi[oó]|qu[eé]\s+compr[oó]|qu[eé]\s+le\s+(anotamos|cargamos|pusimos))/i.test(
      raw
    ) ||
    (/\b(estado|resumen|n(?:ro\.?|[uú]mero)|pidi[oó]|compr[oó])/i.test(raw) &&
      /\b(lo|eso|ese|esa|este|esta|pedido|venta|cliente)\b/i.test(raw)) ||
    /\b(?:el\s+)?saldo\s+(?:de\s+)?(?:este|ese|el)\s+pedido\b/i.test(raw) ||
    /\bcu[aá]nto\s+(?:es\s+|queda\s+)?(?:el\s+)?saldo\b/i.test(raw) ||
    /\b(?:este|ese)\s+pedido\b/i.test(raw)
  );
}

export function formatDateOnlyEs(value?: string | null): string {
  if (!value) return '';
  const iso = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return value;
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

export function todayDateOnly(): string {
  return toDateOnly(todayLocal());
}

export function coerceDateOnly(value?: string | null): string | undefined {
  const parsed = parseLooseDate(String(value ?? ''));
  return parsed ?? undefined;
}

export function formatClientChoices(
  candidates: Array<{ nombre: string; score?: number }>,
  query?: string,
  options?: { allowCreate?: boolean; hasMore?: boolean }
): string {
  const labels = candidates.map((c) => c.nombre);
  const hasGoodMatch = candidates.some((c) => (Number(c.score) || 0) >= 70);
  const allowCreate = options?.allowCreate !== false && query?.trim() && !hasGoodMatch && !candidates.length;
  const extra = allowCreate && query?.trim() ? [`Registrar nuevo: ${query.trim()}`] : [];
  const title = candidates.length === 1 ? 'Encontré este cliente' : `Encontré ${candidates.length} clientes`;
  return formatChoiceMessage({
    title,
    options: [...labels, ...extra],
    ask: '¿Cuál es?',
  });
}

export function formatSupplierChoices(
  candidates: Array<{ nombre: string }>,
  query?: string,
  options?: { allowCreate?: boolean }
): string {
  const labels = candidates.map((c) => c.nombre);
  const allowCreate = options?.allowCreate !== false && Boolean(query?.trim()) && !labels.length;
  const extra = allowCreate && query?.trim() ? [`Registrar nuevo: ${query.trim()}`] : [];
  return formatChoiceMessage({
    title: 'Encontré proveedores',
    options: [...labels, ...extra],
    ask: '¿Cuál es?',
  });
}

export function formatProductChoices(
  candidates: Array<{ nombre: string; label?: string; precioVenta?: number; score?: number }>,
  query?: string,
  options?: {
    allowCreate?: boolean;
    lineIndex?: number;
    lineCount?: number;
    unitCost?: number;
    unitCostNet?: number;
    quantity?: number;
    packUnits?: number;
    context?: 'order' | 'purchase';
    hasMore?: boolean;
    morePage?: boolean;
  }
): string {
  const isPurchase = options?.context === 'purchase';
  const names = candidates.map((c) => {
    const name = c.label?.trim() || c.nombre;
    const price = Number(c.precioVenta) || 0;
    return isPurchase && price > 0 ? `${name} ($${price})` : name;
  });
  const hasGoodMatch = candidates.length > 0;
  const cost = Number(options?.unitCost) || 0;
  const allowCreate = options?.allowCreate !== false && query?.trim() && (isPurchase || !hasGoodMatch);
  if (allowCreate && query?.trim()) {
    names.push(
      cost > 0
        ? `Crear nuevo: ${query.trim()} (costo ${formatTicketMoney(cost)})`
        : `Crear nuevo: ${query.trim()}`
    );
  }
  if (isPurchase) {
    names.push('Insumo / herramienta (sin stock)');
    names.push('Descartar');
    return formatWhatsappMessage({
      title: candidates.length ? '¿Con cuál lo vinculo?' : 'No hay un producto con ese nombre',
      lines: [
        query?.trim() ? `En la boleta: ${query.trim()}` : '',
        ...names.map((name, index) => `${index + 1}. ${name}`),
      ].filter(Boolean),
      ask: '¿Cuál querés?',
    });
  }
  const multi = Number(options?.lineCount) > 1 && options?.lineIndex != null && !options?.morePage;
  const title = options?.morePage
    ? 'Otras opciones'
    : candidates.length
      ? 'Encontré estas opciones'
      : 'No lo encontré en el catálogo';
  return formatChoiceMessage({
    title: multi ? `Ítem ${(options!.lineIndex ?? 0) + 1} de ${options!.lineCount}` : title,
    options: names,
    noneLabel: candidates.length && (options?.hasMore || candidates.length >= 2) ? 'Ninguno de estos' : undefined,
    ask: candidates.length ? '¿Cuál querés?' : '¿Lo creo o lo escribís de otra forma?',
  });
}

function moneyLine(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatOperationSummary(
  intent: string,
  entities: {
    clientName?: string;
    clientPhone?: string;
    productName?: string;
    quantity?: number;
    amount?: number;
    notes?: string;
    paid?: boolean;
    mediaId?: string;
    imageSummary?: string;
    cashType?: 'ingreso' | 'egreso';
    cashConcept?: string;
    orderDate?: string;
    deliveryDate?: string;
    deliveryDefaulted?: boolean;
    supplierName?: string;
    invoiceNumber?: string;
    purchaseLines?: Array<{
      productName?: string;
      invoiceName?: string;
      quantity?: number;
      unitCost?: number;
      unitCostNet?: number;
      packUnits?: number;
      skipped?: boolean;
      tipoLinea?: 'stock' | 'insumo';
    }>;
    items?: Array<{
      quantity?: number;
      rawText?: string;
      productHint?: string;
      productName?: string;
      skipped?: boolean;
      attributes?: { color?: string | null; size?: string | null };
    }>;
    extraCosts?: Array<{ nombre?: string; costo?: number }>;
    collectionAmount?: number;
    requestedStatus?: string;
    extraCostsEnabled?: boolean;
    extraCostsAsked?: boolean;
    targetOrderLabel?: string;
    orderNumber?: string;
    referToLast?: boolean;
    paymentKind?: 'senia' | 'pago';
    seniaAmount?: number;
    payFullBalance?: boolean;
    orderStatus?: string;
    orderStatusLabel?: string;
    orderStockWillDrop?: boolean;
    orderStockAlreadyDropped?: boolean;
    orderHasStockLines?: boolean;
    orderStatusUnchanged?: boolean;
    targetOrderSaldo?: number;
    targetOrderEstadoLabel?: string;
    paymentHint?: string;
    paymentMedioId?: string;
    paymentMedioLabel?: string;
    paymentTarjetaLabel?: string;
    paymentCuotas?: number;
    saveAsDraft?: boolean;
    paymentIncompleteReason?: string;
    cashAmbitoLabel?: string;
    sourceText?: string;
  }
): string {
  const titles: Record<string, string> = {
    create_order: 'Pedido',
    create_sale: 'Venta',
    create_purchase: 'Compra',
    register_payment: entities.paymentKind === 'senia' ? 'Seña' : 'Cobro',
    update_order_status:
      entities.paid === true || entities.payFullBalance || Number(entities.amount) > 0
        ? 'Resumen'
        : 'Estado del pedido',
    query_balance: 'Saldo',
    query_cash: 'Caja de hoy',
    register_cash: entities.cashType === 'ingreso' ? 'Ingreso a caja' : 'Egreso de caja',
    update_product_cost: 'Costo de catálogo',
    create_client: 'Cliente nuevo',
    register_cost: 'Costo extra',
  };
  const ask = intent === 'create_order' ? waAskConfirmo() : waAskSiNo();
  const lines = [waBold(titles[intent] ?? 'Resumen'), ''];

  if (intent === 'query_cash') {
    lines.push('• Período: hoy');
    lines.push('', ask);
    return lines.join('\n');
  }

  if (intent === 'create_client') {
    lines.push(`• Nombre: ${entities.clientName?.trim() || '(sin definir)'}`);
    if (entities.clientPhone?.trim()) {
      lines.push(`• Teléfono: ${entities.clientPhone.trim()}`);
    }
    lines.push('', ask);
    return lines.join('\n');
  }

  if (intent === 'register_cash') {
    const egreso = entities.cashType !== 'ingreso';
    const caja = entities.cashAmbitoLabel?.trim() || '';
    const motivo = entities.cashConcept?.trim() || entities.notes?.trim() || '';
    const monto =
      entities.amount != null
        ? `$${Number(entities.amount).toLocaleString('es-AR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          })}`
        : '';
    const lines = [
      caja ? `• Caja: ${caja}` : '',
      monto ? `• ${egreso ? 'Sale' : 'Entra'}: ${monto}` : '• Importe: (faltó el monto)',
      motivo ? `• Motivo: ${motivo}` : '',
    ].filter(Boolean);
    const what = egreso ? 'este egreso' : 'este ingreso';
    const from = caja ? (egreso ? ` de *${caja}*` : ` en *${caja}*`) : '';
    return waCard({
      title: egreso ? 'Egreso de caja' : 'Ingreso a caja',
      lines,
      ask: `¿Anoto ${what}${monto ? ` de ${monto}` : ''}${from}?\n${waBold('SÍ')} / ${waBold('NO')}`,
    });
  }

  if (intent === 'update_product_cost') {
    lines.push(`• Producto: ${entities.productName?.trim() || '(sin definir)'}`);
    lines.push(`• Nuevo costo: ${entities.amount != null ? `$${entities.amount}` : '(sin definir)'}`);
    lines.push('Solo cambia el costo configurado. No mueve stock ni caja.');
    lines.push('', ask);
    return lines.join('\n');
  }

  if (intent === 'register_cost') {
    const orderRef =
      entities.targetOrderLabel ||
      (entities.orderNumber ? String(entities.orderNumber).padStart(5, '0') : '');
    lines.push(`• Pedido: ${orderRef ? `#${orderRef}` : '(el que indiques / el último)'}`);
    if (entities.clientName?.trim()) {
      lines.push(`• Cliente: ${entities.clientName.trim()}`);
    }
    const extras = entities.extraCosts ?? [];
    if (extras.length) {
      for (const extra of extras.slice(0, 6)) {
        lines.push(`• ${extra.nombre}: $${extra.costo}`);
      }
    } else {
      lines.push('• Costo extra: (sin definir)');
    }
    lines.push('Se suma al costo del pedido (personalización / ganancia). El precio de venta no cambia.');
    lines.push('', ask);
    return lines.join('\n');
  }

  if (intent === 'create_purchase') {
    return formatPurchaseConfirmationMessages(entities).join('\n\n');
  }

  if (intent === 'update_order_status') {
    const orderRef = entities.targetOrderLabel || entities.orderNumber || '';
    const quien = entities.clientName?.trim();
    const saldo = Number(entities.targetOrderSaldo) || 0;
    const cobraTodo =
      entities.paid === true ||
      entities.payFullBalance === true ||
      (!entities.semanticCommand && looksLikeCollectFullBalance(String(entities.sourceText ?? '')));
    const cobraMonto = Number(entities.amount) > 0 ? Number(entities.amount) : 0;
    const cobraAhora = (cobraTodo && saldo > 0) || cobraMonto > 0;
    const cobro = cobraTodo && saldo > 0 ? saldo : cobraMonto;
    const sameEstado =
      entities.orderStatusUnchanged === true ||
      String(entities.targetOrderEstadoLabel ?? '').toLowerCase() ===
        String(entities.orderStatusLabel ?? '').toLowerCase();
    const estadoLine = sameEstado
      ? `• Estado: se queda en ${entities.orderStatusLabel || entities.orderStatus || 'Listo'}`
      : `• Estado: ${entities.targetOrderEstadoLabel || 'actual'} → ${entities.orderStatusLabel || entities.orderStatus || 'Listo'}`;
    const cobroLines = cobraAhora
      ? [
          `• Voy a cobrar: $${moneyLine(cobro)} (entra a caja)`,
          `• Saldo del pedido: queda $${moneyLine(Math.max(0, saldo - cobro))}`,
        ]
      : saldo > 0
        ? [`• No cobro nada ahora`, `• El pedido sigue con saldo $${moneyLine(saldo)}`]
        : ['• No hay saldo para cobrar'];
    const stockLine = entities.orderStockWillDrop
      ? '• Stock: descuento los productos con control'
      : entities.orderStockAlreadyDropped
        ? '• Stock: ya estaba descontado'
        : entities.orderHasStockLines
          ? '• Stock: en este estado todavía no se descuenta'
          : '';
    const ask = cobraAhora
      ? `¿Hago el cambio y cobro los $${moneyLine(cobro)}?\n${waBold('SÍ')} / ${waBold('NO')}`
      : `¿Cambio el estado? El saldo no se cobra.\n${waBold('SÍ')} / ${waBold('NO')}`;
    return waCard({
      title: cobraAhora ? 'Estado y cobro' : 'Estado del pedido',
      lines: [
        `• Pedido: ${orderRef ? `#${orderRef}` : '(el último)'}${quien ? ` · ${quien}` : ''}`,
        estadoLine,
        ...cobroLines,
        stockLine,
      ].filter(Boolean),
      ask,
    });
  }

  if (intent === 'register_payment') {
    const orderRef =
      entities.targetOrderLabel ||
      (entities.orderNumber ? String(entities.orderNumber).padStart(5, '0') : '');
    const cobro =
      Number(entities.amount) > 0
        ? `$${moneyLine(Number(entities.amount))}`
        : entities.payFullBalance
          ? 'todo el saldo'
          : '(sin monto)';
    const pedidoLine = orderRef
      ? `• Pedido: #${orderRef}`
      : entities.referToLast
        ? '• Pedido: el último que cargamos'
        : '• Pedido: el que tenga saldo';
    const medio = entities.paymentMedioLabel || entities.paymentHint;
    return waCard({
      title: entities.paymentKind === 'senia' ? 'Seña' : 'Cobro',
      lines: [
        `• Cliente: ${entities.clientName?.trim() || '(sin definir)'}`,
        pedidoLine,
        `• Voy a cobrar: ${cobro} (entra a caja)`,
        `• Cómo pagó: ${medio?.trim() || 'efectivo'}`,
        '• Eso se descuenta del saldo del pedido',
      ],
      ask: `¿Registro este cobro?\n${waBold('SÍ')} / ${waBold('NO')}`,
    });
  }

  if (intent === 'create_order') {
    const who = entities.clientName?.trim() || '';
    const compact: string[] = [];
    const items = Array.isArray(entities.items) ? entities.items.filter((item) => !item.skipped) : [];
    if (items.length) {
      for (const item of items) {
        const label = item.productName || item.productHint || item.rawText || '(sin detalle)';
        const qty = Number(item.quantity) || 1;
        compact.push(qty > 1 ? `• ${qty} ${label}` : `• ${label}`);
      }
    } else if (entities.productName?.trim()) {
      compact.push(`• ${entities.productName.trim()}`);
    }
    const notes = sanitizeOrderNotes(entities.notes);
    if (notes) {
      const design = notes.match(/dise[nñ]o(?:\s+de)?\s+(.+)/i);
      compact.push(design?.[1] ? `• Diseño: ${design[1].trim().replace(/^[a-z]/, (ch) => ch.toUpperCase())}` : `• ${notes}`);
    }
    const entrega = formatDateOnlyEs(entities.deliveryDate).replace(/\/\d{4}$/, '');
    if (entrega) compact.push(`• Entrega: ${entrega}`);
    const extraCosts = (entities.extraCosts ?? []).filter(
      (item) => item.nombre?.trim() && Number(item.costo) > 0
    );
    const requested = String((entities as { requestedStatus?: string }).requestedStatus ?? '').trim();
    if (requested) {
      const labels: Record<string, string> = {
        listo: 'Listo',
        pendiente: 'Pendiente',
        entregado: 'Entregado',
        en_produccion: 'En proceso',
      };
      compact.push(`• Estado: ${labels[requested] || requested}`);
    }
    const finance = planRelatedOrderFinance({
      amount: entities.amount,
      extraCosts: entities.extraCosts,
      collectionAmount: (entities as { collectionAmount?: number }).collectionAmount,
      seniaAmount: entities.seniaAmount,
      paid: entities.paid,
      payFullBalance: entities.payFullBalance,
      sourceText: entities.sourceText,
    });
    for (const line of formatOrderFinanceLines(finance)) {
      compact.push(`• ${line}`);
    }
    for (const line of formatOrderExtraCostLines(extraCosts)) {
      compact.push(`• ${line}`);
    }
    return waCard({
      title: who ? `Pedido a ${who}` : 'Pedido',
      lines: compact,
      ask: waAskConfirmo(),
    });
  }

  lines.push(`• Cliente: ${entities.clientName?.trim() || '(sin definir)'}`);

  if (intent === 'create_order' || intent === 'create_sale') {
    const items = Array.isArray(entities.items) ? entities.items.filter((item) => !item.skipped) : [];
    if (items.length) {
      for (const item of items) {
        const label = item.productName || item.productHint || item.rawText || '(sin detalle)';
        const qty = Number(item.quantity) || 1;
        lines.push(qty > 1 ? `• ${qty} ${label}` : `• ${label}`);
      }
    } else {
      lines.push(
        `• ${entities.productName?.trim() || entities.imageSummary?.trim() || entities.notes?.trim() || '(sin detalle)'}`
      );
    }
  }

  const extraCosts = (entities.extraCosts ?? []).filter(
    (item) => item.nombre?.trim() && Number(item.costo) > 0
  );

  if (intent === 'create_order' || intent === 'create_sale') {
    const finance = planRelatedOrderFinance({
      amount: entities.amount,
      extraCosts: entities.extraCosts,
      collectionAmount: entities.collectionAmount,
      seniaAmount: entities.seniaAmount,
      paid: entities.paid,
      payFullBalance: entities.payFullBalance,
      sourceText: entities.sourceText,
    });
    for (const line of formatOrderFinanceLines(finance)) {
      lines.push(`• ${line}`);
    }
    if (extraCosts.length && (intent === 'create_order' || intent === 'create_sale')) {
      for (const line of formatOrderExtraCostLines(extraCosts)) {
        lines.push(`• ${line}`);
      }
    }
  } else if (intent !== 'query_balance') {
    lines.push(
      `• Monto: ${entities.amount != null ? `$${entities.amount}` : '(sin definir)'}`
    );
    if (extraCosts.length && (intent === 'create_order' || intent === 'create_sale')) {
      for (const line of formatOrderExtraCostLines(extraCosts)) {
        lines.push(`• ${line}`);
      }
    }
  }

  const senia = Number(entities.seniaAmount) || 0;
  if (senia > 0 && (intent === 'create_order' || intent === 'create_sale')) {
    const finance = planRelatedOrderFinance({
      amount: entities.amount,
      extraCosts: entities.extraCosts,
      collectionAmount: entities.collectionAmount,
      seniaAmount: entities.seniaAmount,
      paid: entities.paid,
      payFullBalance: entities.payFullBalance,
      sourceText: entities.sourceText,
    });
    if (finance.kind === 'none') {
      const saldo = (Number(entities.amount) || 0) - senia;
      lines.push(`• Seña: $${senia}${saldo > 0 ? ` (queda $${saldo})` : ' (queda saldado)'}`);
    }
  }

  if (intent === 'create_sale' && entities.paid != null) {
    lines.push(`• Cobrado ahora: ${entities.paid ? 'Sí' : 'No (queda saldo)'}`);
  }

  if (entities.mediaId) {
    lines.push(`• Foto: sí${entities.imageSummary ? ` (${entities.imageSummary})` : ''}`);
  }

  if (intent !== 'create_order' && entities.notes?.trim() && entities.notes.trim() !== entities.productName?.trim()) {
    const notes = sanitizeOrderNotes(entities.notes);
    if (notes) lines.push(`• ${notes.slice(0, 120)}`);
  }

  lines.push('', ask);
  return lines.join('\n');
}
