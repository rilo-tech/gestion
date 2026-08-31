import { db } from '../firebase.ts';
import {
  clampCommercialCatalog,
  DEFAULT_COMMERCIAL_CATALOG,
  type CommercialCatalog,
} from '../../shared/commercial-catalog.ts';
import { applyIncludedAi200Migration } from '../../shared/commercial-migrations.ts';

const DOC_PATH = 'plataforma/comercial';
const CACHE_MS = 30_000;

let cache: { at: number; value: CommercialCatalog } | null = null;

function ref() {
  return db.doc(DOC_PATH);
}

/**
 * Lee el catálogo publicado. Superadmin es la fuente de precios.
 * No reescribe importes en cada GET. La cuota 1000/2000 → 200 es one-shot.
 */
export async function getCommercialCatalog(): Promise<CommercialCatalog> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const snap = await ref().get();
  const raw = clampCommercialCatalog(
    snap.exists ? (snap.data() as Partial<CommercialCatalog>) : DEFAULT_COMMERCIAL_CATALOG
  );
  const migrated = applyIncludedAi200Migration(raw);
  if (migrated.changed) {
    await ref().set(migrated.catalog, { merge: false });
  } else if (!snap.exists) {
    await ref().set(raw, { merge: false });
  }
  const value = migrated.catalog;
  cache = { at: Date.now(), value };
  return value;
}

export async function saveCommercialCatalog(
  payload: Partial<CommercialCatalog>
): Promise<CommercialCatalog> {
  const current = await getCommercialCatalog();
  const next = clampCommercialCatalog({
    ...current,
    ...payload,
    lite: { ...current.lite, ...payload.lite },
    products: {
      whatsapp: { ...current.products.whatsapp, ...payload.products?.whatsapp },
      erp: { ...current.products.erp, ...payload.products?.erp },
      completo: { ...current.products.completo, ...payload.products?.completo },
    },
    usagePacks: {
      whatsapp: { ...current.usagePacks.whatsapp, ...payload.usagePacks?.whatsapp },
      ai: { ...current.usagePacks.ai, ...payload.usagePacks?.ai },
    },
    migrations: current.migrations,
    finops: { ...current.finops, ...payload.finops },
    updatedAt: new Date().toISOString(),
  });
  await ref().set(next, { merge: false });
  cache = { at: Date.now(), value: next };
  return next;
}

export function clearCommercialCatalogCache(): void {
  cache = null;
}
