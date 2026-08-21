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
  const raw = clampCommercialCatalog(
    snap.exists ? (snap.data() as Partial<CommercialCatalog>) : DEFAULT_COMMERCIAL_CATALOG
  );
  const value = applyEfMvpSeedIfUnchanged(raw);
  if (value !== raw) {
    await ref().set(value, { merge: false });
  }
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

/** Si el doc de Firestore sigue el seed anterior (1490/2490/3490 + 70% off), aplica el MVP de la EF. */
function applyEfMvpSeedIfUnchanged(catalog: CommercialCatalog): CommercialCatalog {
  const oldPrices =
    catalog.products.whatsapp.amountMonthlyUY === 1490 &&
    catalog.products.erp.amountMonthlyUY === 2490 &&
    catalog.products.completo.amountMonthlyUY === 3490;
  const oldIntro = catalog.introDiscountMonths === 6 && catalog.introDiscountPercent === 70;
  if (!oldPrices && !oldIntro) return catalog;
  return clampCommercialCatalog({
    ...catalog,
    introDiscountMonths: 0,
    introDiscountPercent: 0,
    extraUserMonthlyUY: catalog.extraUserMonthlyUY === 490 ? 190 : catalog.extraUserMonthlyUY,
    products: oldPrices ? DEFAULT_COMMERCIAL_CATALOG.products : catalog.products,
  });
}
