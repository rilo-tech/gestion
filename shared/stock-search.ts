export interface StockSearchEntry {
  id?: string;
  nombre: string;
  nombreBase?: string;
  categoria?: string;
  talle?: string;
  color?: string;
  codigo?: string;
  costo?: number;
  stockActual?: number;
  stockReservado?: number;
  controlaStock?: boolean;
  tipo?: string;
}

function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function compactCodigo(value: unknown): string {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function haystackWords(haystack: string): string[] {
  return haystack.split(/\s+/).filter(Boolean);
}

/**
 * Un token coincide si alguna palabra del haystack empieza con él.
 * Así `xxl` matchea la palabra `xxl` pero no `xxxl`, y `xl` no matchea `xxl`.
 */
function tokenMatchesWords(words: string[], token: string): boolean {
  return words.some((word) => word.startsWith(token));
}

export function buildStockSearchHaystack(item: StockSearchEntry): string {
  return [
    item.nombre,
    item.nombreBase,
    item.categoria,
    item.talle,
    item.color,
    item.codigo,
  ]
    .map((value) => normalizeSearchText(value))
    .filter(Boolean)
    .join(' ');
}

export function scoreStockSearchMatch(
  item: StockSearchEntry,
  query: string
): number | null {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return null;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const codigoQuery = compactCodigo(query);
  const codigo = compactCodigo(item.codigo);
  const haystack = buildStockSearchHaystack(item);
  const words = haystackWords(haystack);
  const name = normalizeSearchText(item.nombre);

  if (codigo && codigoQuery && codigo.startsWith(codigoQuery)) {
    return 120 + (codigo === codigoQuery ? 40 : Math.max(0, 20 - codigo.length));
  }

  if (codigo && codigoQuery && codigo.includes(codigoQuery)) {
    return 90;
  }

  if (!tokens.every((token) => tokenMatchesWords(words, token))) {
    return null;
  }

  let score = 40;
  if (name.startsWith(tokens[0] ?? '')) score += 25;
  if (tokens.length > 1 && name.includes(normalizedQuery)) score += 10;
  if (codigo && codigoQuery && codigo.includes(codigoQuery)) score += 15;
  return score;
}

function buildStockListSearchHaystack(item: StockSearchEntry): string {
  return [item.nombre, item.nombreBase]
    .map((value) => normalizeSearchText(value))
    .filter(Boolean)
    .join(' ');
}

/** Listado de stock: solo nombre y código (no categoría, talle ni color). */
export function scoreStockListSearchMatch(
  item: StockSearchEntry,
  query: string
): number | null {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return null;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const codigoQuery = compactCodigo(query);
  const codigo = compactCodigo(item.codigo);
  const nameHaystack = buildStockListSearchHaystack(item);
  const words = haystackWords(nameHaystack);
  const name = normalizeSearchText(item.nombre);

  if (codigo && codigoQuery && codigo.startsWith(codigoQuery)) {
    return 120 + (codigo === codigoQuery ? 40 : Math.max(0, 20 - codigo.length));
  }

  if (codigo && codigoQuery && codigo.includes(codigoQuery)) {
    return 90;
  }

  if (!tokens.every((token) => tokenMatchesWords(words, token))) {
    return null;
  }

  let score = 40;
  if (name.startsWith(tokens[0] ?? '')) score += 25;
  if (tokens.length > 1 && name.includes(normalizedQuery)) score += 10;
  return score;
}

export function filterStockListSearchEntries<T extends StockSearchEntry>(
  items: T[],
  query: string,
  limit?: number
): T[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return [];

  const ranked = items
    .map((item) => {
      const score = scoreStockListSearchMatch(item, query);
      return score === null ? null : { item, score };
    })
    .filter((entry): entry is { item: T; score: number } => entry !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.item.nombre).localeCompare(String(b.item.nombre), 'es');
    });

  if (limit === undefined || limit <= 0) {
    return ranked.map((entry) => entry.item);
  }

  return ranked.slice(0, limit).map((entry) => entry.item);
}

export function filterStockSearchEntries<T extends StockSearchEntry>(
  items: T[],
  query: string,
  limit = 20
): T[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return [];

  return items
    .map((item) => {
      const score = scoreStockSearchMatch(item, query);
      return score === null ? null : { item, score };
    })
    .filter((entry): entry is { item: T; score: number } => entry !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.item.nombre).localeCompare(String(b.item.nombre), 'es');
    })
    .slice(0, limit)
    .map((entry) => entry.item);
}
