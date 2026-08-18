import { db } from '../firebase.ts';
import {
  clampCommercialCatalog,
  DEFAULT_COMMERCIAL_CATALOG,
  type CommercialCatalog,
} from '../../shared/commercial-catalog.ts';

const DOC_PATH = 'plataforma/comercial';
const CACHE_MS = 30_000;

let cache: { at: number; value: CommercialCatalog } | null = null;

function ref() {
  return db.doc(DOC_PATH);
}

export async function getCommercialCatalog(): Promise<CommercialCatalog> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const snap = await ref().get();
  const value = clampCommercialCatalog(
    snap.exists ? (snap.data() as Partial<CommercialCatalog>) : DEFAULT_COMMERCIAL_CATALOG
  );
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
    updatedAt: new Date().toISOString(),
  });
  await ref().set(next, { merge: false });
  cache = { at: Date.now(), value: next };
  return next;
}

export function clearCommercialCatalogCache(): void {
  cache = null;
}
