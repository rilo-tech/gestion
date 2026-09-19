import { db } from '../../firebase.ts';
import { assertCanCreateProduct } from '../../auth/usage-gates.ts';
import {
  productControlsStock,
  productPermitsNegativeStock,
} from '../../utils/stock-product.ts';
import { syncPendingOrdersAfterStockChange } from '../../utils/order-stock-reservations.ts';
import { recomputeStockMetrics } from '../../utils/stock-metrics.ts';
import { assertCanApplyStockDelta } from './stock-adjust-logic.ts';

export type CreateProductInput = {
  businessId: string;
  name: string;
  salePrice?: number;
  cost?: number;
  controlsStock?: boolean;
  initialStock?: number;
  source?: 'web' | 'whatsapp';
};

export type UpdateProductInput = {
  businessId: string;
  productId: string;
  name?: string;
  salePrice?: number;
  cost?: number;
};

export type AdjustStockInput = {
  businessId: string;
  productId: string;
  quantity: number;
  reason?: string;
  actorId?: string;
  /** Idempotencia técnica por escaneo (UUID). Escaneos reales distintos = IDs distintos. */
  scanOperationId?: string;
};

export type AdjustStockResult = {
  productId: string;
  stock: number;
  applied: boolean;
  duplicate?: boolean;
};

export type SetStockInput = {
  businessId: string;
  productId: string;
  stock: number;
  reason?: string;
  actorId?: string;
};

export async function createProduct(input: CreateProductInput): Promise<{ id: string; name: string; salePrice: number }> {
  const nombre = String(input.name ?? '').trim();
  if (!nombre) throw new Error('Indicá el nombre del producto.');
  await assertCanCreateProduct(input.businessId);
  const controlsStock = input.controlsStock === true;
  const stockActual = controlsStock ? Math.max(0, Number(input.initialStock) || 0) : 0;
  const precioVenta = Number(input.salePrice) || 0;
  const costo = Number(input.cost) || 0;
  const docRef = await db.collection(`negocios/${input.businessId}/stock`).add({
    nombre,
    precioVenta,
    precio: precioVenta,
    costo,
    precioSugerido: precioVenta,
    stockActual,
    stockMinimo: 0,
    stockReservado: 0,
    controlaStock: controlsStock,
    permitirStockNegativo: false,
    activo: true,
    negocioId: input.businessId,
    origenWhatsapp: input.source === 'whatsapp',
    createdAt: new Date().toISOString(),
  });
  if (controlsStock && stockActual > 0) {
    await db.collection(`negocios/${input.businessId}/movimientos_stock`).add({
      productoId: docRef.id,
      tipo: 'entrada',
      cantidad: stockActual,
      fecha: new Date().toISOString(),
      motivo: 'Carga inicial',
      origenGrupo: 'carga_inicial',
      origenTipo: 'carga_inicial',
      usuarioId: input.source === 'whatsapp' ? 'whatsapp' : 'admin',
      negocioId: input.businessId,
    });
    await syncPendingOrdersAfterStockChange(input.businessId, [docRef.id]);
  }
  await recomputeStockMetrics(input.businessId);
  return { id: docRef.id, name: nombre, salePrice: precioVenta };
}

export async function updateProduct(input: UpdateProductInput): Promise<{ id: string; name: string }> {
  const productId = String(input.productId ?? '').trim();
  if (!productId) throw new Error('Indicá el producto.');
  const ref = db.doc(`negocios/${input.businessId}/stock/${productId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('No encontré ese producto.');
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (input.name != null) patch.nombre = String(input.name).trim();
  if (input.salePrice != null) {
    const price = Number(input.salePrice) || 0;
    patch.precioVenta = price;
    patch.precio = price;
    patch.precioSugerido = price;
  }
  if (input.cost != null) patch.costo = Number(input.cost) || 0;
  await ref.update(patch);
  const next = await ref.get();
  return { id: productId, name: String(next.data()?.nombre ?? input.name ?? '') };
}

export async function adjustStock(input: AdjustStockInput): Promise<AdjustStockResult> {
  const productId = String(input.productId ?? '').trim();
  const quantity = Number(input.quantity) || 0;
  if (!productId || !quantity) throw new Error('Indicá producto y cantidad.');
  const actorId = String(input.actorId ?? '').trim() || 'system';
  const reason = String(input.reason ?? 'Ajuste').trim() || 'Ajuste';
  const scanOperationId = String(input.scanOperationId ?? '').trim();

  const productRef = db.doc(`negocios/${input.businessId}/stock/${productId}`);
  const idemRef = scanOperationId
    ? db.doc(`negocios/${input.businessId}/scan_ops/${scanOperationId}`)
    : null;

  const result = await db.runTransaction(async (tx) => {
    if (idemRef) {
      const idemSnap = await tx.get(idemRef);
      if (idemSnap.exists) {
        const prevStock = Number(idemSnap.data()?.newStock);
        return {
          productId,
          stock: Number.isFinite(prevStock) ? prevStock : 0,
          applied: false,
          duplicate: true,
        };
      }
    }

    const snap = await tx.get(productRef);
    if (!snap.exists) throw new Error('No encontré ese producto.');
    const data = snap.data() as Record<string, unknown>;
    const current = Number(data.stockActual) || 0;
    const next = assertCanApplyStockDelta({
      exists: true,
      controlsStock: productControlsStock(data),
      currentStock: current,
      quantity,
      permitsNegative: productPermitsNegativeStock(data),
    });

    const now = new Date().toISOString();
    tx.update(productRef, { stockActual: next, updatedAt: now });

    const movRef = db.collection(`negocios/${input.businessId}/movimientos_stock`).doc();
    tx.set(movRef, {
      productoId: productId,
      tipo: quantity > 0 ? 'entrada' : 'salida',
      cantidad: Math.abs(quantity),
      fecha: now,
      motivo: reason,
      origenGrupo: 'ajuste',
      origenTipo: 'ajuste_manual',
      usuarioId: actorId,
      negocioId: input.businessId,
      ...(scanOperationId ? { scanOperationId } : {}),
    });

    if (idemRef) {
      tx.set(idemRef, {
        productId,
        quantity,
        newStock: next,
        movementId: movRef.id,
        createdAt: now,
      });
    }

    return { productId, stock: next, applied: true, duplicate: false };
  });

  if (result.applied && quantity > 0) {
    await syncPendingOrdersAfterStockChange(input.businessId, [productId]);
  }
  if (result.applied) {
    await recomputeStockMetrics(input.businessId);
  }
  return result;
}

export async function setStock(input: SetStockInput): Promise<{ productId: string; stock: number }> {
  const productId = String(input.productId ?? '').trim();
  if (!productId) throw new Error('Indicá el producto.');
  const ref = db.doc(`negocios/${input.businessId}/stock/${productId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('No encontré ese producto.');
  const data = snap.data() as Record<string, unknown>;
  if (!productControlsStock(data)) throw new Error('Ese producto no controla stock.');
  const current = Number(data.stockActual) || 0;
  const target = Math.max(0, Number(input.stock) || 0);
  const delta = target - current;
  if (delta === 0) return { productId, stock: current };
  return adjustStock({
    businessId: input.businessId,
    productId,
    quantity: delta,
    reason: input.reason ?? 'Ajuste de stock',
    actorId: input.actorId,
  }).then((row) => ({ productId: row.productId, stock: row.stock }));
}
