import { db } from '../firebase.ts';
import {
  DEFAULT_PRODUCTOS_CODIGO_CONFIG,
  formatProductCode,
  getPrefijoForCategoria,
  normalizeProductosCodigo,
  parseSequenceFromCode,
  shouldAutoAssignProductCode,
  type ProductosCodigoConfig,
} from '../../shared/product-code-config.ts';

export type { ProductosCodigoConfig };
export {
  DEFAULT_PRODUCTOS_CODIGO_CONFIG,
  formatProductCode,
  getPrefijoForCategoria,
  normalizeProductosCodigo,
};

function normalizeCodigoKey(codigo: unknown): string {
  return String(codigo ?? '').trim();
}

export async function loadProductosCodigoConfig(
  businessId: string
): Promise<ProductosCodigoConfig> {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  if (!appDoc.exists) return { ...DEFAULT_PRODUCTOS_CODIGO_CONFIG };
  const productos = (appDoc.data()?.productos as Record<string, unknown>) ?? {};
  return normalizeProductosCodigo(productos.codigo);
}

export async function findStockItemByCodigo(
  businessId: string,
  codigo: string,
  excludeId?: string
): Promise<{ id: string; codigo?: string } | null> {
  const key = normalizeCodigoKey(codigo);
  if (!key) return null;

  const snapshot = await db.collection(`negocios/${businessId}/stock`).get();
  for (const doc of snapshot.docs) {
    if (excludeId && doc.id === excludeId) continue;
    const existing = normalizeCodigoKey(doc.data().codigo);
    if (existing && existing === key) {
      return { id: doc.id, codigo: existing };
    }
  }
  return null;
}

async function bootstrapCategoryCounter(
  businessId: string,
  categoria: string,
  prefijo: string,
  digitosSecuencia: number
): Promise<number> {
  const snapshot = await db.collection(`negocios/${businessId}/stock`).get();
  let maxSeq = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const cat = String(data.categoria ?? '').trim();
    if (cat.toLowerCase() !== categoria.trim().toLowerCase()) continue;
    const seq = parseSequenceFromCode(
      String(data.codigo ?? ''),
      prefijo,
      digitosSecuencia
    );
    if (seq && seq > maxSeq) maxSeq = seq;
  }

  return maxSeq;
}

async function ensureCategoryCounter(
  businessId: string,
  categoria: string,
  prefijo: string,
  digitosSecuencia: number
): Promise<void> {
  const counterRef = db.doc(`negocios/${businessId}/config/contadores`);
  const snap = await counterRef.get();
  const counters = (snap.data()?.codigosProducto as Record<string, number>) ?? {};
  if (Number(counters[categoria.trim()]) > 0) return;

  const maxSeq = await bootstrapCategoryCounter(
    businessId,
    categoria,
    prefijo,
    digitosSecuencia
  );
  await counterRef.set(
    {
      codigosProducto: { ...counters, [categoria.trim()]: maxSeq },
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function allocateProductCode(
  businessId: string,
  categoria: string,
  prefijo: string,
  digitosSecuencia: number
): Promise<string> {
  const cat = categoria.trim();
  const prefix = String(prefijo).replace(/\D/g, '');
  if (!cat || !prefix) {
    throw new Error('Categoría o prefijo inválido para asignar código.');
  }

  const digits = Math.max(1, Math.min(6, Math.trunc(digitosSecuencia)));
  await ensureCategoryCounter(businessId, cat, prefix, digits);

  const counterRef = db.doc(`negocios/${businessId}/config/contadores`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const counters = (snap.data()?.codigosProducto as Record<string, number>) ?? {};
    const current = Number(counters[cat]) || 0;
    const next = current + 1;
    const codigo = formatProductCode(prefix, next, digits);

    tx.set(
      counterRef,
      {
        codigosProducto: { ...counters, [cat]: next },
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return codigo;
  });
}

export async function previewNextProductCode(
  businessId: string,
  categoria: string
): Promise<{ codigo: string } | { error: string }> {
  const config = await loadProductosCodigoConfig(businessId);
  if (!config.automatico) {
    return { error: 'El código automático no está activado.' };
  }

  const prefijo = getPrefijoForCategoria(config, categoria);
  if (!prefijo) {
    return { error: 'La categoría no tiene prefijo configurado.' };
  }

  const cat = categoria.trim();
  const counterRef = db.doc(`negocios/${businessId}/config/contadores`);
  const snap = await counterRef.get();
  const counters = (snap.data()?.codigosProducto as Record<string, number>) ?? {};
  let current = Number(counters[cat]) || 0;
  if (current <= 0) {
    current = await bootstrapCategoryCounter(
      businessId,
      cat,
      prefijo,
      config.digitosSecuencia
    );
  }

  const codigo = formatProductCode(prefijo, current + 1, config.digitosSecuencia);
  return { codigo };
}

export type ResolveCodigoResult =
  | { ok: true; codigo: string; regenerateOldCategoria?: string }
  | { ok: false; status: number; error: string };

export async function resolveCodigoForCreate(
  businessId: string,
  input: {
    categoria?: string;
    codigo?: string;
  }
): Promise<ResolveCodigoResult> {
  const config = await loadProductosCodigoConfig(businessId);
  const categoria = String(input.categoria ?? '').trim();
  const manualCodigo = normalizeCodigoKey(input.codigo);

  if (
    shouldAutoAssignProductCode(config, categoria, manualCodigo)
  ) {
    const prefijo = getPrefijoForCategoria(config, categoria)!;
    const codigo = await allocateProductCode(
      businessId,
      categoria,
      prefijo,
      config.digitosSecuencia
    );
    const duplicate = await findStockItemByCodigo(businessId, codigo);
    if (duplicate) {
      return {
        ok: false,
        status: 409,
        error: `El código «${codigo}» ya está en uso.`,
      };
    }
    return { ok: true, codigo };
  }

  const codigo = manualCodigo;
  if (!codigo) {
    return { ok: true, codigo: '' };
  }

  const duplicate = await findStockItemByCodigo(businessId, codigo);
  if (duplicate) {
    return {
      ok: false,
      status: 409,
      error: `Ya existe un producto con el código «${codigo}».`,
    };
  }
  return { ok: true, codigo };
}

export async function regenerateProductCodesForCategory(
  businessId: string,
  categoria: string
): Promise<{ updated: number }> {
  const config = await loadProductosCodigoConfig(businessId);
  const prefijo = getPrefijoForCategoria(config, categoria);
  const cat = categoria.trim();
  if (!prefijo || !cat) {
    throw new Error('La categoría no tiene prefijo configurado.');
  }

  const catKey = cat.toLowerCase();
  const digits = Math.max(1, Math.min(6, Math.trunc(config.digitosSecuencia)));
  const snapshot = await db.collection(`negocios/${businessId}/stock`).get();

  const targets = snapshot.docs
    .filter((doc) => {
      const prodCat = String(doc.data().categoria ?? '')
        .trim()
        .toLowerCase();
      return prodCat === catKey;
    })
    .sort((a, b) => {
      const aDate = String(a.data().createdAt ?? '');
      const bDate = String(b.data().createdAt ?? '');
      if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
      return String(a.data().nombre ?? '').localeCompare(String(b.data().nombre ?? ''), 'es');
    });

  const usedCodes = new Set<string>();
  const targetIds = new Set(targets.map((doc) => doc.id));

  for (const doc of snapshot.docs) {
    if (targetIds.has(doc.id)) continue;
    const existing = normalizeCodigoKey(doc.data().codigo);
    if (existing) usedCodes.add(existing);
  }

  let seq = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const doc of targets) {
    seq += 1;
    let codigo = formatProductCode(prefijo, seq, digits);
    while (usedCodes.has(codigo)) {
      seq += 1;
      codigo = formatProductCode(prefijo, seq, digits);
    }
    usedCodes.add(codigo);

    await doc.ref.update({
      codigo,
      updatedAt: now,
    });
    updated += 1;
  }

  const counterRef = db.doc(`negocios/${businessId}/config/contadores`);
  const counterSnap = await counterRef.get();
  const counters = (counterSnap.data()?.codigosProducto as Record<string, number>) ?? {};

  await counterRef.set(
    {
      codigosProducto: { ...counters, [cat]: seq },
      updatedAt: now,
    },
    { merge: true }
  );

  return { updated };
}

export async function resolveCodigoForUpdate(
  businessId: string,
  itemId: string,
  input: {
    categoria?: string;
    codigo?: string;
  },
  existing: { codigo?: string; categoria?: string }
): Promise<ResolveCodigoResult> {
  const config = await loadProductosCodigoConfig(businessId);
  const existingCodigo = normalizeCodigoKey(existing.codigo);
  const oldCategoria = String(existing.categoria ?? '').trim();
  const newCategoria = String(input.categoria ?? oldCategoria).trim();
  const manualCodigo = normalizeCodigoKey(input.codigo);
  const categoryChanged =
    oldCategoria.toLowerCase() !== newCategoria.toLowerCase();

  if (categoryChanged) {
    if (shouldAutoAssignProductCode(config, newCategoria, manualCodigo)) {
      const prefijo = getPrefijoForCategoria(config, newCategoria)!;
      const codigo = await allocateProductCode(
        businessId,
        newCategoria,
        prefijo,
        config.digitosSecuencia
      );
      const duplicate = await findStockItemByCodigo(businessId, codigo, itemId);
      if (duplicate) {
        return {
          ok: false,
          status: 409,
          error: `El código «${codigo}» ya está en uso.`,
        };
      }
      const oldPrefijo = getPrefijoForCategoria(config, oldCategoria);
      return {
        ok: true,
        codigo,
        ...(oldPrefijo ? { regenerateOldCategoria: oldCategoria } : {}),
      };
    }

    const codigo = manualCodigo || existingCodigo;
    if (!codigo) {
      return { ok: true, codigo: '' };
    }
    if (codigo !== existingCodigo) {
      const duplicate = await findStockItemByCodigo(businessId, codigo, itemId);
      if (duplicate) {
        return {
          ok: false,
          status: 409,
          error: `Ya existe otro producto con el código «${codigo}».`,
        };
      }
    }
    return { ok: true, codigo };
  }

  if (shouldAutoAssignProductCode(config, newCategoria, manualCodigo)) {
    if (existingCodigo) {
      return { ok: true, codigo: existingCodigo };
    }
    return resolveCodigoForCreate(businessId, input);
  }

  const codigo = manualCodigo;
  if (!codigo) {
    return { ok: true, codigo: existingCodigo };
  }

  if (codigo === existingCodigo) {
    return { ok: true, codigo };
  }

  const duplicate = await findStockItemByCodigo(businessId, codigo, itemId);
  if (duplicate) {
    return {
      ok: false,
      status: 409,
      error: `Ya existe otro producto con el código «${codigo}».`,
    };
  }
  return { ok: true, codigo };
}
