import express from 'express';
import { db } from '../firebase.ts';
import { resolveOrderLabel } from '../utils/order-number.ts';
import { createCompromisoPago, parseCompromisoInput } from '../utils/payment-commitments.ts';

const router = express.Router();

type OrderPayment = {
  id: string;
  tipo: 'seña' | 'cuota' | 'pago' | 'extra';
  monto: number;
  fecha: string;
  movimientoCajaId?: string;
  notas?: string;
};

type OrderLine = {
  stockItemId?: string;
  cantidad?: number;
  nombre?: string;
  precioVenta?: number;
  costoUnitario?: number;
};

type OrderRecord = {
  clienteId?: string;
  estado?: string;
  total?: number;
  saldo?: number;
  totalPagado?: number;
  pagos?: OrderPayment[];
  items?: OrderLine[];
  senia?: number;
  seniaBloqueada?: boolean;
  movimientoSeniaId?: string;
  stockDescontado?: boolean;
  ventaId?: string;
  numeroPedido?: number;
  numeroPedidoLabel?: string;
  descripcion?: string;
};

type SaleLine = {
  stockItemId: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
};

function formatVentaLabel(ventaId: string): string {
  return ventaId.slice(-6).toUpperCase();
}

function normalizeEstado(estado?: string) {
  return String(estado ?? '').toLowerCase().trim();
}

function isDraftStatus(estado?: string) {
  const value = normalizeEstado(estado);
  return value === 'borrador' || value.includes('borrador');
}

function isCancelledStatus(estado?: string) {
  const value = normalizeEstado(estado);
  return value === 'cancelado' || value.includes('cancelad');
}

function isDeliveredStatus(estado?: string) {
  const value = normalizeEstado(estado);
  return value === 'entregado' || value.includes('entregad');
}

function normalizePagos(order: OrderRecord): OrderPayment[] {
  const pagos = [...(order.pagos ?? [])];
  if (pagos.length === 0 && order.movimientoSeniaId && Number(order.senia) > 0) {
    pagos.push({
      id: `pago_senia_${order.movimientoSeniaId}`,
      tipo: 'seña',
      monto: Number(order.senia),
      fecha: new Date().toISOString(),
      movimientoCajaId: order.movimientoSeniaId,
    });
  }
  return pagos;
}

function sumPagosHaciaTotal(pagos: OrderPayment[] = []) {
  return pagos
    .filter((pago) => pago.tipo !== 'extra')
    .reduce((acc, pago) => acc + (Number(pago.monto) || 0), 0);
}

function getPagadoHaciaPedido(order: OrderRecord): number {
  const pagos = normalizePagos(order);
  if (pagos.length > 0) return sumPagosHaciaTotal(pagos);
  return Number(order.totalPagado) || 0;
}

function orderIsConfirmed(order: OrderRecord): boolean {
  return !!(
    order.stockDescontado ||
    order.seniaBloqueada ||
    order.movimientoSeniaId ||
    (order.pagos?.length ?? 0) > 0
  );
}

function orderEligibleForSale(order: OrderRecord): boolean {
  if (isCancelledStatus(order.estado)) return false;
  if (isDraftStatus(order.estado)) return false;
  if (order.ventaId) return false;
  if (isDeliveredStatus(order.estado)) return false;
  if (!orderIsConfirmed(order)) return false;

  const estado = normalizeEstado(order.estado);
  return (
    estado === 'listo' ||
    estado.includes('listo') ||
    estado === 'en_produccion' ||
    estado.includes('produccion') ||
    estado === 'pendiente' ||
    estado.includes('pendiente')
  );
}

function sanitizePagoForFirestore(pago: OrderPayment): Record<string, unknown> {
  const clean: Record<string, unknown> = {
    id: pago.id,
    tipo: pago.tipo,
    monto: pago.monto,
    fecha: pago.fecha,
  };
  if (pago.movimientoCajaId) clean.movimientoCajaId = pago.movimientoCajaId;
  if (pago.notas) clean.notas = pago.notas;
  return clean;
}

function productControlsStock(data: Record<string, unknown> | undefined): boolean {
  return data?.controlaStock !== false;
}

async function createCashIncome(
  businessId: string,
  params: {
    monto: number;
    concepto: string;
    origenId: string;
    origenTipo: string;
    medio?: string;
    clienteId?: string;
    pedidoId?: string | null;
    ventaId?: string | null;
    numeroPedido?: number | null;
    numeroPedidoLabel?: string | null;
    ventaLabel?: string | null;
  }
) {
  const docRef = await db.collection(`negocios/${businessId}/movimientos_caja`).add({
    tipo: 'ingreso',
    monto: params.monto,
    medio: params.medio ?? 'efectivo',
    concepto: params.concepto,
    fecha: new Date().toISOString(),
    origenId: params.origenId,
    origenTipo: params.origenTipo,
    origenGrupo: 'venta',
    pedidoId: params.pedidoId ?? null,
    ventaId: params.ventaId ?? null,
    ventaLabel: params.ventaLabel ?? null,
    numeroPedido: params.numeroPedido ?? null,
    numeroPedidoLabel: params.numeroPedidoLabel ?? null,
    clienteId: params.clienteId ?? null,
    negocioId: businessId,
  });
  return docRef.id;
}

async function enrichSales(businessId: string, sales: Record<string, unknown>[]) {
  const clientIds = new Set<string>();
  const orderIds = new Set<string>();

  for (const sale of sales) {
    if (sale.clienteId) clientIds.add(String(sale.clienteId));
    if (sale.pedidoId) orderIds.add(String(sale.pedidoId));
  }

  const clientMap = new Map<string, string>();
  await Promise.all(
    [...clientIds].map(async (clientId) => {
      const snap = await db.collection(`negocios/${businessId}/clientes`).doc(clientId).get();
      if (!snap.exists) return;
      clientMap.set(clientId, String(snap.data()?.nombre ?? ''));
    })
  );

  const orderMap = new Map<string, { numeroPedidoLabel?: string; descripcion?: string }>();
  await Promise.all(
    [...orderIds].map(async (orderId) => {
      const snap = await db.collection(`negocios/${businessId}/pedidos`).doc(orderId).get();
      if (!snap.exists) return;
      const data = snap.data() ?? {};
      orderMap.set(orderId, {
        numeroPedidoLabel: data.numeroPedidoLabel ?? resolveOrderLabel(data as OrderRecord, orderId),
        descripcion: data.descripcion,
      });
    })
  );

  return sales.map((sale) => {
    const clienteId = sale.clienteId ? String(sale.clienteId) : '';
    const pedidoId = sale.pedidoId ? String(sale.pedidoId) : '';
    const orderData = pedidoId ? orderMap.get(pedidoId) : undefined;

    return {
      ...sale,
      ventaLabel: sale.ventaLabel ?? (sale.id ? formatVentaLabel(String(sale.id)) : null),
      clienteNombre: clientMap.get(clienteId) ?? '',
      numeroPedidoLabel: sale.numeroPedidoLabel ?? orderData?.numeroPedidoLabel ?? null,
      pedidoDescripcion: orderData?.descripcion ?? null,
    };
  });
}

router.get('/:businessId/eligible-orders', async (req, res) => {
  try {
    const { businessId } = req.params;
    const clienteIdFilter = String(req.query.clienteId ?? '').trim();
    const searchQuery = String(req.query.q ?? '').trim().toLowerCase();

    const [ordersSnap, clientsSnap] = await Promise.all([
      db.collection(`negocios/${businessId}/pedidos`).get(),
      db.collection(`negocios/${businessId}/clientes`).get(),
    ]);

    const clientMap = new Map<string, string>();
    for (const doc of clientsSnap.docs) {
      clientMap.set(doc.id, String(doc.data()?.nombre ?? ''));
    }

    const orders = ordersSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as OrderRecord) }))
      .filter((order) => orderEligibleForSale(order))
      .filter((order) => !clienteIdFilter || order.clienteId === clienteIdFilter)
      .map((order) => {
        const total = Number(order.total) || 0;
        const totalPagadoAnterior = getPagadoHaciaPedido(order);
        const saldoPedido = Math.max(0, total - totalPagadoAnterior);
        const numeroPedidoLabel =
          order.numeroPedidoLabel ?? resolveOrderLabel(order, order.id);
        const clienteNombre = order.clienteId ? clientMap.get(order.clienteId) ?? '' : '';

        return {
          id: order.id,
          clienteId: order.clienteId,
          clienteNombre,
          estado: order.estado,
          descripcion: order.descripcion,
          total,
          totalPagadoAnterior,
          saldoPedido,
          numeroPedido: order.numeroPedido,
          numeroPedidoLabel,
          items: order.items ?? [],
        };
      })
      .filter((order) => {
        if (!searchQuery) return true;

        const haystack = [
          order.numeroPedidoLabel,
          order.clienteNombre,
          order.descripcion,
          String(order.total),
          String(order.saldoPedido),
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(searchQuery);
      })
      .sort((a, b) => {
        const labelA = String(a.numeroPedidoLabel ?? '');
        const labelB = String(b.numeroPedidoLabel ?? '');
        return labelB.localeCompare(labelA);
      });

    res.json(orders);
  } catch (error) {
    console.error('Error fetching eligible orders for sale:', error);
    res.status(500).json({ error: 'Error fetching eligible orders' });
  }
});

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const snapshot = await db
      .collection(`negocios/${businessId}/ventas`)
      .orderBy('fecha', 'desc')
      .get();

    const sales = snapshot.docs.map((doc) => ({
      id: doc.id,
      ventaLabel: formatVentaLabel(doc.id),
      ...doc.data(),
    }));

    const enriched = await enrichSales(businessId, sales);
    res.json(enriched);
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ error: 'Error fetching sales' });
  }
});

async function maybeCreateCompromisoPago(
  businessId: string,
  params: {
    body: Record<string, unknown>;
    saldoPendiente: number;
    clienteId: string | null | undefined;
    origenTipo: 'pedido' | 'venta';
    origenId: string;
    referenciaLabel: string;
    pedidoId?: string | null;
    ventaId?: string | null;
  }
): Promise<string | null> {
  if (params.saldoPendiente <= 0 || !params.clienteId) return null;

  const compromiso = parseCompromisoInput(params.body.compromisoPago);
  if (!compromiso) return null;

  return createCompromisoPago(businessId, {
    clienteId: params.clienteId,
    origenTipo: params.origenTipo,
    origenId: params.origenId,
    referenciaLabel: params.referenciaLabel,
    montoTotal: params.saldoPendiente,
    compromiso,
    pedidoId: params.pedidoId,
    ventaId: params.ventaId,
  });
}

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const origen = req.body.origen === 'pedido' ? 'pedido' : 'mostrador';
    const pedidoId = String(req.body.pedidoId ?? '').trim() || null;
    const medioPago = String(req.body.medioPago ?? 'efectivo').trim() || 'efectivo';
    const notas = String(req.body.notas ?? '').trim();
    const montoCobradoInput = Number(req.body.montoCobrado);
    const timestamp = new Date().toISOString();

    if (origen === 'pedido') {
      if (!pedidoId) {
        return res.status(400).json({ error: 'Seleccioná un pedido para registrar la venta.' });
      }

      const orderRef = db.collection(`negocios/${businessId}/pedidos`).doc(pedidoId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) {
        return res.status(404).json({ error: 'Pedido no encontrado.' });
      }

      const order = orderSnap.data() as OrderRecord;
      if (order.ventaId) {
        return res.status(400).json({ error: 'Este pedido ya tiene una venta registrada.' });
      }
      if (!orderEligibleForSale(order)) {
        return res.status(400).json({
          error: 'El pedido no está listo para registrar la entrega como venta.',
        });
      }

      const total = Number(order.total) || 0;
      const totalPagadoAnterior = getPagadoHaciaPedido(order);
      const saldoPedido = Math.max(0, total - totalPagadoAnterior);
      const montoCobrado =
        Number.isFinite(montoCobradoInput) && montoCobradoInput >= 0
          ? montoCobradoInput
          : saldoPedido;

      if (montoCobrado > saldoPedido) {
        return res.status(400).json({
          error: `El monto a cobrar supera el saldo pendiente del pedido ($${saldoPedido}).`,
          saldoPedido,
        });
      }

      const orderLabel = resolveOrderLabel(order, pedidoId);
      const items: SaleLine[] = (order.items ?? []).map((line) => {
        const cantidad = Number(line.cantidad) || 0;
        const precioUnitario = Number(line.precioVenta) || 0;
        return {
          stockItemId: String(line.stockItemId ?? ''),
          nombre: String(line.nombre ?? 'Producto'),
          cantidad,
          precioUnitario,
          subtotal: cantidad * precioUnitario,
        };
      });

      const ventaRef = await db.collection(`negocios/${businessId}/ventas`).add({
        origen: 'pedido',
        pedidoId,
        numeroPedido: order.numeroPedido ?? null,
        numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
        clienteId: order.clienteId ?? null,
        items,
        total,
        totalPagadoAnterior,
        montoCobrado,
        saldoPendiente: Math.max(0, total - totalPagadoAnterior - montoCobrado),
        medioPago,
        notas,
        fecha: timestamp,
        negocioId: businessId,
      });

      const ventaLabel = formatVentaLabel(ventaRef.id);
      await ventaRef.update({ ventaLabel });

      let movimientoCajaId: string | null = null;
      if (montoCobrado > 0) {
        movimientoCajaId = await createCashIncome(businessId, {
          monto: montoCobrado,
          concepto: `Saldo entrega pedido #${orderLabel} · venta #${ventaLabel}`,
          origenId: ventaRef.id,
          origenTipo: 'venta_pedido',
          medio: medioPago,
          clienteId: order.clienteId,
          pedidoId,
          ventaId: ventaRef.id,
          ventaLabel,
          numeroPedido: order.numeroPedido ?? null,
          numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
        });
      }

      const pagosBase = normalizePagos(order);
      const nuevosPagos = [...pagosBase];
      if (montoCobrado > 0) {
        nuevosPagos.push({
          id: `pago_venta_${Date.now()}`,
          tipo: 'pago',
          monto: montoCobrado,
          fecha: timestamp,
          movimientoCajaId: movimientoCajaId ?? undefined,
          notas: `Cobro en entrega · venta #${ventaLabel}`,
        });
      }

      const totalPagado = totalPagadoAnterior + montoCobrado;
      const saldo = Math.max(0, total - totalPagado);

      await orderRef.update({
        ventaId: ventaRef.id,
        estado: 'entregado',
        entregadoAt: timestamp,
        pagos: nuevosPagos.map(sanitizePagoForFirestore),
        totalPagado,
        saldo,
      });

      if (movimientoCajaId) {
        await ventaRef.update({ movimientoCajaId });
      }

      const compromisoId = await maybeCreateCompromisoPago(businessId, {
        body: req.body,
        saldoPendiente: saldo,
        clienteId: order.clienteId,
        origenTipo: 'venta',
        origenId: ventaRef.id,
        referenciaLabel: `Venta #${ventaLabel} · Pedido #${orderLabel}`,
        pedidoId,
        ventaId: ventaRef.id,
      });

      if (compromisoId) {
        await ventaRef.update({ compromisoPagoId: compromisoId });
      }

      return res.status(201).json({
        id: ventaRef.id,
        ventaLabel,
        total,
        totalPagadoAnterior,
        montoCobrado,
        saldoPendiente: saldo,
        pedidoId,
        compromisoPagoId: compromisoId,
      });
    }

    const clienteId = String(req.body.clienteId ?? '').trim();
    const rawItems = Array.isArray(req.body.items) ? req.body.items : [];

    if (!clienteId) {
      return res.status(400).json({ error: 'Seleccioná un cliente para la venta.' });
    }

    const draftItems = rawItems
      .map((line: Record<string, unknown>) => ({
        stockItemId: String(line.stockItemId ?? '').trim(),
        cantidad: Number(line.cantidad) || 0,
        precioUnitario: Number(line.precioUnitario) || 0,
        nombre: String(line.nombre ?? '').trim(),
      }))
      .filter((line) => line.stockItemId && line.cantidad > 0);

    if (draftItems.length === 0) {
      return res.status(400).json({ error: 'Agregá al menos un producto con cantidad.' });
    }

    const items: SaleLine[] = [];
    let total = 0;

    for (const line of draftItems) {
      const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.stockItemId);
      const itemSnap = await itemRef.get();
      if (!itemSnap.exists) {
        return res.status(400).json({ error: 'Uno de los productos seleccionados no existe.' });
      }

      const itemData = itemSnap.data() ?? {};
      const subtotal = line.cantidad * line.precioUnitario;
      total += subtotal;

      items.push({
        stockItemId: line.stockItemId,
        nombre: line.nombre || String(itemData.nombre ?? 'Producto'),
        cantidad: line.cantidad,
        precioUnitario: line.precioUnitario,
        subtotal,
      });
    }

    const montoCobrado =
      Number.isFinite(montoCobradoInput) && montoCobradoInput >= 0 ? montoCobradoInput : total;

    if (montoCobrado > total) {
      return res.status(400).json({
        error: `El monto cobrado no puede superar el total de la venta ($${total}).`,
      });
    }

    const ventaRef = await db.collection(`negocios/${businessId}/ventas`).add({
      origen: 'mostrador',
      pedidoId: null,
      clienteId,
      items,
      total,
      totalPagadoAnterior: 0,
      montoCobrado,
      saldoPendiente: Math.max(0, total - montoCobrado),
      medioPago,
      notas,
      fecha: timestamp,
      negocioId: businessId,
    });

    const ventaLabel = formatVentaLabel(ventaRef.id);
    await ventaRef.update({ ventaLabel });

    for (const line of items) {
      const itemRef = db.collection(`negocios/${businessId}/stock`).doc(line.stockItemId);
      const itemSnap = await itemRef.get();
      if (!itemSnap.exists) continue;

      const itemData = itemSnap.data() as Record<string, unknown>;
      if (!productControlsStock(itemData)) continue;

      const currentStock = Number(itemData.stockActual) || 0;
      if (currentStock - line.cantidad < 0) {
        return res.status(400).json({
          error: `Stock insuficiente para "${line.nombre}": hay ${currentStock} u., pediste ${line.cantidad} u.`,
        });
      }

      await itemRef.update({
        stockActual: currentStock - line.cantidad,
        updatedAt: timestamp,
      });

      await db.collection(`negocios/${businessId}/movimientos_stock`).add({
        productoId: line.stockItemId,
        tipo: 'salida',
        cantidad: line.cantidad,
        fecha: timestamp,
        motivo: `Venta mostrador #${ventaLabel}`,
        origenId: ventaRef.id,
        origenTipo: 'venta',
        origenGrupo: 'venta',
        ventaId: ventaRef.id,
        usuarioId: 'admin',
        negocioId: businessId,
      });
    }

    let movimientoCajaId: string | null = null;
    if (montoCobrado > 0) {
      movimientoCajaId = await createCashIncome(businessId, {
        monto: montoCobrado,
        concepto: `Venta mostrador #${ventaLabel}`,
        origenId: ventaRef.id,
        origenTipo: 'venta_mostrador',
        medio: medioPago,
        clienteId,
        ventaId: ventaRef.id,
        ventaLabel,
        pedidoId: null,
      });
      await ventaRef.update({ movimientoCajaId });
    }

    const saldoPendiente = Math.max(0, total - montoCobrado);
    const compromisoId = await maybeCreateCompromisoPago(businessId, {
      body: req.body,
      saldoPendiente,
      clienteId,
      origenTipo: 'venta',
      origenId: ventaRef.id,
      referenciaLabel: `Venta mostrador #${ventaLabel}`,
      ventaId: ventaRef.id,
    });

    if (compromisoId) {
      await ventaRef.update({ compromisoPagoId: compromisoId });
    }

    return res.status(201).json({
      id: ventaRef.id,
      ventaLabel,
      total,
      montoCobrado,
      saldoPendiente,
      compromisoPagoId: compromisoId,
    });
  } catch (error) {
    console.error('Error creating sale:', error);
    res.status(500).json({ error: 'Error creating sale' });
  }
});

export default router;
