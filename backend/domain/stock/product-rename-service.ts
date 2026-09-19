import { db } from '../../firebase.ts';
import { buildProductDisplayName, inferNombreBase } from '../../../shared/product-display-name.ts';

export type ProductVariantRow = {
  id: string;
  name: string;
  nombreBase: string;
  color: string;
  talle: string;
  stock: number;
  price: number;
  cost: number;
};

export type ProductRenameScope = 'single' | 'matching_variants';

export type ProductRenamePreview = {
  status: 'ready' | 'needs_scope' | 'not_found' | 'empty';
  scope: ProductRenameScope;
  oldBaseName: string;
  newBaseName: string;
  variants: ProductVariantRow[];
  selectedIds: string[];
  previewNames: Array<{ id: string; from: string; to: string }>;
  message?: string;
};

function asTrimmed(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeBaseKey(value: string): string {
  return asTrimmed(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function mapVariantDoc(id: string, data: Record<string, unknown>): ProductVariantRow {
  const name = asTrimmed(data.nombre);
  const color = asTrimmed(data.color);
  const talle = asTrimmed(data.talle);
  const storedBase = asTrimmed(data.nombreBase);
  const nombreBase = storedBase || inferNombreBase(name, color, talle) || name;
  return {
    id,
    name,
    nombreBase,
    color,
    talle,
    stock: Number(data.stockActual) || 0,
    price: Number(data.precioVenta ?? data.precio) || 0,
    cost: Number(data.costo) || 0,
  };
}

/** Familia estructural: mismo nombreBase (campo o inferido). Sin fuzzy. */
export async function listProductVariantsByBaseName(
  businessId: string,
  baseName: string
): Promise<ProductVariantRow[]> {
  const key = normalizeBaseKey(baseName);
  if (!key) return [];
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  const rows: ProductVariantRow[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (data.activo === false) continue;
    const row = mapVariantDoc(doc.id, data);
    if (normalizeBaseKey(row.nombreBase) === key) rows.push(row);
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function getProductVariant(
  businessId: string,
  productId: string
): Promise<ProductVariantRow | null> {
  const id = asTrimmed(productId);
  if (!id) return null;
  const snap = await db.doc(`negocios/${businessId}/stock/${id}`).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  if (data.activo === false) return null;
  return mapVariantDoc(snap.id, data);
}

export function filterVariantsByConstraints(
  variants: ProductVariantRow[],
  constraints?: { colors?: string[]; sizes?: string[]; excludeIds?: string[] }
): ProductVariantRow[] {
  const exclude = new Set((constraints?.excludeIds ?? []).map((id) => asTrimmed(id)).filter(Boolean));
  const colors = (constraints?.colors ?? []).map(normalizeBaseKey).filter(Boolean);
  const sizes = (constraints?.sizes ?? []).map(normalizeBaseKey).filter(Boolean);
  return variants.filter((row) => {
    if (exclude.has(row.id)) return false;
    if (colors.length && !colors.includes(normalizeBaseKey(row.color))) return false;
    if (sizes.length && !sizes.includes(normalizeBaseKey(row.talle))) return false;
    return true;
  });
}

export function buildRenamePreview(input: {
  variants: ProductVariantRow[];
  selected: ProductVariantRow[];
  oldBaseName: string;
  newBaseName: string;
  scope: ProductRenameScope;
  needsScopeAsk?: boolean;
}): ProductRenamePreview {
  const newBase = asTrimmed(input.newBaseName);
  const oldBase = asTrimmed(input.oldBaseName);
  if (!input.selected.length) {
    return {
      status: 'empty',
      scope: input.scope,
      oldBaseName: oldBase,
      newBaseName: newBase,
      variants: input.variants,
      selectedIds: [],
      previewNames: [],
      message: 'No hay productos para renombrar con ese alcance.',
    };
  }
  if (input.needsScopeAsk) {
    return {
      status: 'needs_scope',
      scope: input.scope,
      oldBaseName: oldBase,
      newBaseName: newBase,
      variants: input.variants,
      selectedIds: input.selected.map((row) => row.id),
      previewNames: [],
      message: 'Hay varias variantes. Indicá si querés cambiar solo un producto o todas las variantes.',
    };
  }
  return {
    status: 'ready',
    scope: input.scope,
    oldBaseName: oldBase,
    newBaseName: newBase,
    variants: input.variants,
    selectedIds: input.selected.map((row) => row.id),
    previewNames: input.selected.map((row) => ({
      id: row.id,
      from: row.name,
      to: buildProductDisplayName(newBase, row.color, row.talle),
    })),
  };
}

export async function previewProductRename(input: {
  businessId: string;
  productId?: string;
  productIds?: string[];
  baseNameHint?: string;
  newBaseName: string;
  scope?: ProductRenameScope | 'auto';
  constraints?: { colors?: string[]; sizes?: string[]; excludeIds?: string[] };
}): Promise<ProductRenamePreview> {
  const newBaseName = asTrimmed(input.newBaseName);
  if (!newBaseName) {
    return {
      status: 'not_found',
      scope: 'single',
      oldBaseName: '',
      newBaseName: '',
      variants: [],
      selectedIds: [],
      previewNames: [],
      message: 'Indicá el nuevo nombre.',
    };
  }

  const explicitIds = (input.productIds ?? []).map(asTrimmed).filter(Boolean);
  if (explicitIds.length) {
    const selected: ProductVariantRow[] = [];
    for (const id of explicitIds) {
      const row = await getProductVariant(input.businessId, id);
      if (row) selected.push(row);
    }
    if (!selected.length) {
      return {
        status: 'not_found',
        scope: 'single',
        oldBaseName: '',
        newBaseName,
        variants: [],
        selectedIds: [],
        previewNames: [],
        message: 'No encontré esos productos.',
      };
    }
    const oldBase = selected[0]!.nombreBase;
    const variants = await listProductVariantsByBaseName(input.businessId, oldBase);
    return buildRenamePreview({
      variants,
      selected: filterVariantsByConstraints(selected, input.constraints),
      oldBaseName: oldBase,
      newBaseName,
      scope: selected.length > 1 ? 'matching_variants' : 'single',
    });
  }

  let seed: ProductVariantRow | null = null;
  if (input.productId) {
    seed = await getProductVariant(input.businessId, input.productId);
  }
  const baseHint = asTrimmed(input.baseNameHint) || seed?.nombreBase || '';
  if (!seed && baseHint) {
    const byBase = await listProductVariantsByBaseName(input.businessId, baseHint);
    seed = byBase[0] ?? null;
  }
  if (!seed) {
    return {
      status: 'not_found',
      scope: 'single',
      oldBaseName: baseHint,
      newBaseName,
      variants: [],
      selectedIds: [],
      previewNames: [],
      message: 'No encontré ese producto.',
    };
  }

  const variants = await listProductVariantsByBaseName(input.businessId, seed.nombreBase);
  const scopeRaw = input.scope ?? 'auto';
  if (scopeRaw === 'auto' && variants.length > 1) {
    return buildRenamePreview({
      variants,
      selected: variants,
      oldBaseName: seed.nombreBase,
      newBaseName,
      scope: 'matching_variants',
      needsScopeAsk: true,
    });
  }

  const scope: ProductRenameScope =
    scopeRaw === 'matching_variants' || (scopeRaw === 'auto' && variants.length > 1)
      ? 'matching_variants'
      : 'single';

  const selected =
    scope === 'matching_variants'
      ? filterVariantsByConstraints(variants, input.constraints)
      : filterVariantsByConstraints(
          variants.filter((row) => row.id === seed!.id),
          input.constraints
        );

  return buildRenamePreview({
    variants,
    selected,
    oldBaseName: seed.nombreBase,
    newBaseName,
    scope,
  });
}

export async function renameProduct(input: {
  businessId: string;
  productId: string;
  newName: string;
}): Promise<{ id: string; name: string }> {
  const productId = asTrimmed(input.productId);
  const newName = asTrimmed(input.newName);
  if (!productId || !newName) throw new Error('Indicá producto y nombre.');
  const ref = db.doc(`negocios/${input.businessId}/stock/${productId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('No encontré ese producto.');
  const data = snap.data() as Record<string, unknown>;
  const color = asTrimmed(data.color);
  const talle = asTrimmed(data.talle);
  const nombreBase = inferNombreBase(newName, color, talle) || newName;
  await ref.update({
    nombre: newName,
    nombreBase,
    updatedAt: new Date().toISOString(),
  });
  return { id: productId, name: newName };
}

export async function bulkRenameProductFamily(input: {
  businessId: string;
  productIds: string[];
  newBaseName: string;
}): Promise<{ updated: Array<{ id: string; name: string }> }> {
  const newBase = asTrimmed(input.newBaseName);
  const ids = [...new Set((input.productIds ?? []).map(asTrimmed).filter(Boolean))];
  if (!newBase) throw new Error('Indicá el nuevo nombre base.');
  if (!ids.length) throw new Error('Indicá los productos a renombrar.');

  /** Cargar todo antes de escribir: si falta uno, no afirmar éxito parcial. */
  const rows: ProductVariantRow[] = [];
  for (const productId of ids) {
    const row = await getProductVariant(input.businessId, productId);
    if (!row) {
      throw new Error(`No encontré el producto a renombrar (${productId}).`);
    }
    rows.push(row);
  }

  const updated: Array<{ id: string; name: string }> = [];
  for (const row of rows) {
    const nextName = buildProductDisplayName(newBase, row.color, row.talle);
    const ref = db.doc(`negocios/${input.businessId}/stock/${row.id}`);
    await ref.update({
      nombre: nextName,
      nombreBase: newBase,
      updatedAt: new Date().toISOString(),
    });
    const verify = await ref.get();
    const persisted = asTrimmed((verify.data() as Record<string, unknown> | undefined)?.nombre);
    if (!verify.exists || persisted !== nextName) {
      throw new Error(`No se pudo persistir el rename de ${row.id}.`);
    }
    updated.push({ id: row.id, name: nextName });
  }
  if (updated.length !== ids.length) {
    throw new Error('El rename no se completó para todos los productos.');
  }
  return { updated };
}

/** Alias de dominio alineado al ERP web. */
export async function bulkUpdateProductsRename(input: {
  businessId: string;
  productIds: string[];
  newBaseName: string;
}): Promise<{ updated: Array<{ id: string; name: string }> }> {
  return bulkRenameProductFamily(input);
}
