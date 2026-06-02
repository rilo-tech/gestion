export interface ProductosCodigoConfig {
  /** Si true: asignación automática por categoría. Si false: ingreso manual. */
  automatico: boolean;
  /** Prefijo numérico por nombre de categoría (ej. "10", "20"). */
  prefijosPorCategoria: Record<string, string>;
  /** Dígitos de secuencia tras el prefijo (default 2 → 1001, 1002). */
  digitosSecuencia: number;
}

export const DEFAULT_PRODUCTOS_CODIGO_CONFIG: ProductosCodigoConfig = {
  automatico: false,
  prefijosPorCategoria: {},
  digitosSecuencia: 2,
};

function normalizePrefijo(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.slice(0, 4);
}

function findCategoriaKey(
  map: Record<string, string>,
  categoria: string
): string | undefined {
  const target = categoria.trim().toLowerCase();
  if (!target) return undefined;
  return Object.keys(map).find((key) => key.trim().toLowerCase() === target);
}

export function normalizeProductosCodigo(raw: unknown): ProductosCodigoConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_PRODUCTOS_CODIGO_CONFIG };
  }

  const entry = raw as Record<string, unknown>;
  const prefijosRaw = entry.prefijosPorCategoria;
  const prefijosPorCategoria: Record<string, string> = {};

  if (prefijosRaw && typeof prefijosRaw === 'object' && !Array.isArray(prefijosRaw)) {
    for (const [key, value] of Object.entries(prefijosRaw as Record<string, unknown>)) {
      const categoria = key.trim();
      const prefijo = normalizePrefijo(value);
      if (!categoria || !prefijo) continue;
      prefijosPorCategoria[categoria] = prefijo;
    }
  }

  const digitos = Number(entry.digitosSecuencia);
  const digitosSecuencia =
    Number.isFinite(digitos) && digitos >= 1 && digitos <= 6
      ? Math.trunc(digitos)
      : DEFAULT_PRODUCTOS_CODIGO_CONFIG.digitosSecuencia;

  return {
    automatico: entry.automatico === true,
    prefijosPorCategoria,
    digitosSecuencia,
  };
}

export function getPrefijoForCategoria(
  config: ProductosCodigoConfig,
  categoria: string | undefined
): string | null {
  const cat = String(categoria ?? '').trim();
  if (!cat) return null;
  const key = findCategoriaKey(config.prefijosPorCategoria, cat);
  if (!key) return null;
  return config.prefijosPorCategoria[key] ?? null;
}

/** Categoría que ya usa este prefijo (excluyendo una categoría dada). */
export function findCategoriaByPrefijo(
  config: ProductosCodigoConfig,
  prefijo: string,
  excludeCategoria?: string
): string | null {
  const normalized = normalizePrefijo(prefijo);
  if (!normalized) return null;
  const exclude = excludeCategoria?.trim().toLowerCase() ?? '';
  for (const [categoria, value] of Object.entries(config.prefijosPorCategoria)) {
    if (categoria.trim().toLowerCase() === exclude) continue;
    if (normalizePrefijo(value) === normalized) return categoria;
  }
  return null;
}

export function validateUniquePrefijos(
  prefijosPorCategoria: Record<string, string>
): string | null {
  const seen = new Map<string, string>();
  for (const [categoria, prefijoRaw] of Object.entries(prefijosPorCategoria)) {
    const prefijo = normalizePrefijo(prefijoRaw);
    if (!prefijo) continue;
    const existing = seen.get(prefijo);
    if (existing) {
      return `El prefijo «${prefijo}» está repetido en «${existing}» y «${categoria}».`;
    }
    seen.set(prefijo, categoria);
  }
  return null;
}

/** Categoría cuyo prefijo coincide con el inicio del código (prefijo más largo primero). */
export function findPrefijoOwnerForCodigo(
  config: ProductosCodigoConfig,
  codigo: string,
  excludeCategoria?: string
): { categoria: string; prefijo: string } | null {
  const normalized = String(codigo ?? '').trim();
  if (!normalized) return null;

  const exclude = excludeCategoria?.trim().toLowerCase() ?? '';
  const matches = Object.entries(config.prefijosPorCategoria)
    .map(([categoria, prefijoRaw]) => ({
      categoria,
      prefijo: normalizePrefijo(prefijoRaw),
    }))
    .filter((entry) => entry.prefijo && normalized.startsWith(entry.prefijo))
    .sort((a, b) => b.prefijo.length - a.prefijo.length);

  for (const entry of matches) {
    if (entry.categoria.trim().toLowerCase() === exclude) continue;
    return entry;
  }
  return null;
}

export function shouldAutoAssignProductCode(
  config: ProductosCodigoConfig,
  categoria: string | undefined,
  manualCodigo?: string
): boolean {
  if (String(manualCodigo ?? '').trim()) return false;
  const cat = String(categoria ?? '').trim();
  if (!cat) return false;
  return Boolean(getPrefijoForCategoria(config, cat));
}

export function formatProductCode(
  prefijo: string,
  secuencia: number,
  digitosSecuencia: number
): string {
  const prefix = normalizePrefijo(prefijo);
  const seq = Math.max(1, Math.trunc(secuencia));
  const digits = Math.max(1, Math.min(6, Math.trunc(digitosSecuencia)));
  return `${prefix}${String(seq).padStart(digits, '0')}`;
}

/** Extrae el número de secuencia si el código coincide con prefijo + N dígitos. */
export function parseSequenceFromCode(
  codigo: string,
  prefijo: string,
  digitosSecuencia: number
): number | null {
  const normalized = String(codigo ?? '').trim();
  const prefix = normalizePrefijo(prefijo);
  if (!normalized || !prefix || !normalized.startsWith(prefix)) return null;
  const suffix = normalized.slice(prefix.length);
  const digits = Math.max(1, Math.min(6, Math.trunc(digitosSecuencia)));
  if (!new RegExp(`^\\d{${digits}}$`).test(suffix)) return null;
  const seq = Number(suffix);
  return Number.isFinite(seq) && seq > 0 ? seq : null;
}
