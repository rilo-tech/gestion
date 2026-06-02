/**
 * Configura categorías, prefijos de código y backfill para RILO.
 *
 * Categorías de abrigos:
 * - Felpa y jogging (10): canguro felpa, buzo felpa, campera jogging
 * - Camperas técnicas (11): nylon, omniheat, camperas pesadas
 *
 * Uso:
 *   npx tsx scripts/setup-rilo-product-codes.ts
 *   npx tsx scripts/setup-rilo-product-codes.ts --apply
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import {
  formatProductCode,
  normalizeProductosCodigo,
  parseSequenceFromCode,
} from '../shared/product-code-config.ts';

const APPLY = process.argv.includes('--apply');
const BUSINESS_ID = 'rilo';

const CATEGORIES = [
  'Felpa y jogging',
  'Camperas técnicas',
  'Pantalones',
  'Indumentaria liviana',
  'Cerámica y vasos',
  'Personalización',
] as const;

/** Categorías reemplazadas: se vuelve a inferir aunque el producto ya tenga categoría. */
const OBSOLETE_CATEGORIES = ['Indumentaria superior'];

const PREFIXES: Record<string, string> = {
  'Felpa y jogging': '10',
  'Camperas técnicas': '11',
  Pantalones: '20',
  'Indumentaria liviana': '30',
  'Cerámica y vasos': '40',
};

const DIGITOS_SECUENCIA = 2;

type CategoryName = (typeof CATEGORIES)[number];

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function hasCamperaJogging(base: string): boolean {
  return (
    base.includes('campera') &&
    (base.includes('jogging') || base.includes('joggin'))
  );
}

function hasFelpaCanguroBuzo(base: string): boolean {
  if (!base.includes('felpa')) return false;
  return base.includes('canguro') || base.includes('buzo');
}

function hasTechnicalKeywords(base: string): boolean {
  return (
    base.includes('nylon') ||
    base.includes('omniheat') ||
    base.includes('omni heat') ||
    base.includes('omni-heat') ||
    base.includes('omni hair') ||
    base.includes('reversible') ||
    base.includes('revers') ||
    base.includes('softshell') ||
    base.includes('impermeable') ||
    base.includes('polar') ||
    base.includes('termica') ||
    base.includes('térmica')
  );
}

function isIndumentariaLiviana(base: string): boolean {
  return (
    base.includes('manga corta') ||
    base.includes(' mc ') ||
    base.endsWith(' mc') ||
    base.startsWith('mc ') ||
    base.includes('remera') ||
    base.includes('camiseta') ||
    (base.includes('buzo') &&
      base.includes('manga corta')) ||
    (base.includes('diver') && base.includes('manga corta')) ||
    (base.includes('buzo') &&
      (base.includes('poliester') ||
        base.includes('algodon') ||
        base.includes('algodón')))
  );
}

function inferCategoria(product: Record<string, unknown>): CategoryName | null {
  const base = normalizeText(product.nombreBase || product.nombre);
  if (!base) return null;

  if (
    base.includes('estampado') ||
    base.includes('personaliz') ||
    base.includes('servicio')
  ) {
    return 'Personalización';
  }

  if (
    base.includes('taza') ||
    base.includes('jarra') ||
    base.includes('ceram') ||
    base.includes('vaso')
  ) {
    return 'Cerámica y vasos';
  }

  if (isIndumentariaLiviana(base)) {
    return 'Indumentaria liviana';
  }

  if (hasCamperaJogging(base) || hasFelpaCanguroBuzo(base)) {
    return 'Felpa y jogging';
  }

  if (
    hasTechnicalKeywords(base) ||
    (base.includes('campera') && !hasCamperaJogging(base))
  ) {
    return 'Camperas técnicas';
  }

  if (
    base.includes('pantalon') ||
    base.includes('babucha') ||
    base.includes('babbuch') ||
    (base.includes('jogging') && !base.includes('campera'))
  ) {
    return 'Pantalones';
  }

  if (
    base.includes('canguro') ||
    base.includes('buzo') ||
    base.includes('hoodie')
  ) {
    return 'Felpa y jogging';
  }

  if (base.includes('abrigo')) {
    return 'Camperas técnicas';
  }

  return null;
}

function resolveCategoria(
  data: Record<string, unknown>,
  inferred: CategoryName | null
): string {
  const existingCat = String(data.categoria ?? '').trim();
  if (inferred) return inferred;
  if (existingCat && !OBSOLETE_CATEGORIES.includes(existingCat)) return existingCat;
  return '';
}

async function main(): Promise<void> {
  const configRef = db.doc(`negocios/${BUSINESS_ID}/config/app`);
  const configSnap = await configRef.get();
  const config = configSnap.data() ?? {};
  const productos = (config.productos ?? {}) as Record<string, unknown>;

  const categorias = [
    ...new Set([
      ...CATEGORIES,
      ...(Array.isArray(productos.categorias)
        ? productos.categorias.map(String).filter((c) => !OBSOLETE_CATEGORIES.includes(c))
        : []),
    ]),
  ].sort((a, b) => a.localeCompare(b, 'es'));

  const codigoConfig = normalizeProductosCodigo(productos.codigo);
  codigoConfig.automatico = true;
  codigoConfig.digitosSecuencia = DIGITOS_SECUENCIA;
  codigoConfig.prefijosPorCategoria = { ...PREFIXES };

  console.log('[setup-rilo-codigos] Modo:', APPLY ? 'APLICAR' : 'simulación');
  console.log('[setup-rilo-codigos] Categorías:', categorias.join(', '));
  console.log('[setup-rilo-codigos] Prefijos:', JSON.stringify(PREFIXES));

  const stockSnap = await db.collection(`negocios/${BUSINESS_ID}/stock`).get();
  const updates: Array<{
    id: string;
    nombre: string;
    categoria: string;
    codigo: string;
    createdAt: string;
  }> = [];
  const unclassified: string[] = [];
  const counters: Record<string, number> = {};

  const pendingByCategory = new Map<string, Array<{ id: string; data: Record<string, unknown> }>>();

  for (const doc of stockSnap.docs) {
    const data = doc.data();
    const inferred = inferCategoria(data);
    const categoria = resolveCategoria(data, inferred);

    if (!categoria) {
      unclassified.push(String(data.nombre ?? doc.id));
      continue;
    }

    if (!pendingByCategory.has(categoria)) pendingByCategory.set(categoria, []);
    pendingByCategory.get(categoria)!.push({ id: doc.id, data });
  }

  for (const [categoria, docs] of pendingByCategory.entries()) {
    const prefijo = PREFIXES[categoria];
    docs.sort((a, b) => {
      const aDate = String(a.data.createdAt ?? '');
      const bDate = String(b.data.createdAt ?? '');
      if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
      return String(a.data.nombre ?? '').localeCompare(String(b.data.nombre ?? ''), 'es');
    });

    let seq = 0;
    for (const entry of docs) {
      const existingCodigo = String(entry.data.codigo ?? '').trim();
      let codigo = existingCodigo;

      if (prefijo) {
        const parsed = existingCodigo
          ? parseSequenceFromCode(existingCodigo, prefijo, DIGITOS_SECUENCIA)
          : null;
        if (parsed && parsed > seq) {
          seq = parsed;
          codigo = existingCodigo;
        } else if (!existingCodigo || !parsed) {
          seq += 1;
          codigo = formatProductCode(prefijo, seq, DIGITOS_SECUENCIA);
        }
      }

      if (prefijo && codigo) {
        const parsedFinal = parseSequenceFromCode(codigo, prefijo, DIGITOS_SECUENCIA);
        if (parsedFinal && parsedFinal > (counters[categoria] ?? 0)) {
          counters[categoria] = parsedFinal;
        }
      }

      const needsUpdate =
        String(entry.data.categoria ?? '').trim() !== categoria ||
        String(entry.data.codigo ?? '').trim() !== codigo;

      if (needsUpdate) {
        updates.push({
          id: entry.id,
          nombre: String(entry.data.nombre ?? entry.id),
          categoria,
          codigo: codigo || '',
          createdAt: String(entry.data.createdAt ?? ''),
        });
      }

      console.log(
        `  ${String(entry.data.nombre ?? entry.id)} → cat «${categoria}»${codigo ? `, código ${codigo}` : ''}`
      );
    }
  }

  if (unclassified.length > 0) {
    console.warn('[setup-rilo-codigos] Sin categoría inferida:');
    for (const name of unclassified) console.warn(`  - ${name}`);
  }

  console.log(`[setup-rilo-codigos] Productos a actualizar: ${updates.length}`);
  console.log('[setup-rilo-codigos] Contadores:', JSON.stringify(counters));

  if (!APPLY) {
    console.log('[setup-rilo-codigos] Simulación. Usá --apply para persistir.');
    return;
  }

  await configRef.set(
    {
      productos: {
        ...productos,
        categorias,
        codigo: codigoConfig,
      },
    },
    { merge: true }
  );

  const counterRef = db.doc(`negocios/${BUSINESS_ID}/config/contadores`);
  const counterSnap = await counterRef.get();
  const existingCounters =
    (counterSnap.data()?.codigosProducto as Record<string, number>) ?? {};

  await counterRef.set(
    {
      codigosProducto: { ...existingCounters, ...counters },
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  for (const update of updates) {
    await db.collection(`negocios/${BUSINESS_ID}/stock`).doc(update.id).update({
      categoria: update.categoria,
      ...(update.codigo ? { codigo: update.codigo } : {}),
      updatedAt: new Date().toISOString(),
    });
  }

  console.log('[setup-rilo-codigos] Configuración y productos actualizados.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
