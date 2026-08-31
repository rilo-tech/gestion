import { db } from '../../firebase.ts';
import { assertCanCreateProduct } from '../../auth/usage-gates.ts';
import { productControlsStock } from '../../utils/stock-product.ts';
import { syncPendingOrdersAfterStockChange } from '../../utils/order-stock-reservations.ts';
import { recomputeStockMetrics } from '../../utils/stock-metrics.ts';

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

export async function adjustStock(input: AdjustStockInput): Promise<{ productId: string; stock: number }> {
  const productId = String(input.productId ?? '').trim();
  const quantity = Number(input.quantity) || 0;
  if (!productId || !quantity) throw new Error('Indicá producto y cantidad.');
  const ref = db.doc(`negocios/${input.businessId}/stock/${productId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('No encontré ese producto.');
  const data = snap.data() as Record<string, unknown>;
  if (!productControlsStock(data)) throw new Error('Ese producto no controla stock.');
  const current = Number(data.stockActual) || 0;
  const next = current + quantity;
  await ref.update({ stockActual: next, updatedAt: new Date().toISOString() });
  await db.collection(`negocios/${input.businessId}/movimientos_stock`).add({
    productoId: productId,
    tipo: quantity > 0 ? 'entrada' : 'salida',
    cantidad: Math.abs(quantity),
    fecha: new Date().toISOString(),
    motivo: String(input.reason ?? 'Ajuste').trim() || 'Ajuste',
    origenGrupo: 'ajuste',
    origenTipo: 'ajuste_manual',
    usuarioId: input.actorId ?? 'whatsapp',
    negocioId: input.businessId,
  });
  if (quantity > 0) await syncPendingOrdersAfterStockChange(input.businessId, [productId]);
  await recomputeStockMetrics(input.businessId);
  return { productId, stock: next };
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
  });
}
