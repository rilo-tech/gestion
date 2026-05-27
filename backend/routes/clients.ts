import express from 'express';
import { db } from '../firebase.ts';
import { resolveOrderLabel } from '../utils/order-number.ts';
import { resolveSaleLabel } from '../utils/sale-number.ts';
import { computeClientBalanceMap } from '../utils/client-balance.ts';
import { collectClientBalance, buildClientHistorialPagos, normalizePedidoPagosFromData } from '../utils/client-collections.ts';
import { createCompanyRouter } from './create-company-router.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { logActivityFromRequest } from '../utils/activity-log.ts';

const router = createCompanyRouter();

function isCancelledStatus(estado?: string) {
  const value = String(estado ?? '').toLowerCase().trim();
  return value === 'cancelado' || value.includes('cancelad');
}

function sumPagosHaciaTotal(
  pagos: Array<{ tipo?: string; monto?: number }> = []
): number {
  return pagos
    .filter((pago) => pago.tipo !== 'extra')
    .reduce((acc, pago) => acc + (Number(pago.monto) || 0), 0);
}

function computeTotalFacturado(ventas: Array<{ total?: number }>): number {
  return ventas.reduce((acc, sale) => acc + (Number(sale.total) || 0), 0);
}

function computeTotalCobrado(
  ventas: Array<{ origen?: string; montoCobrado?: number }>,
  pedidos: Array<{ pagos?: Array<{ tipo?: string; monto?: number }>; cancelado?: boolean }>
): number {
  const cobradoPedidos = pedidos
    .filter((pedido) => !pedido.cancelado)
    .reduce((acc, pedido) => acc + sumPagosHaciaTotal(pedido.pagos), 0);

  const cobradoMostrador = ventas
    .filter((sale) => sale.origen !== 'pedido')
    .reduce((acc, sale) => acc + (Number(sale.montoCobrado) || 0), 0);

  return cobradoPedidos + cobradoMostrador;
}

router.get('/:businessId/cobros-proximos', async (req, res) => {
  try {
    const { businessId } = req.params;
    const snapshot = await db.collection(`negocios/${businessId}/compromisos_pago`).get();

    const clientIds = new Set<string>();
    const rows: Record<string, unknown>[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const clienteId = String(data.clienteId ?? '').trim();
      if (clienteId) clientIds.add(clienteId);

      for (const cuota of data.cuotas ?? []) {
        if (cuota.estado !== 'pendiente') continue;
        rows.push({
          compromisoId: doc.id,
          clienteId,
          referenciaLabel: data.referenciaLabel,
          origenTipo: data.origenTipo,
          origenId: data.origenId,
          pedidoId: data.pedidoId ?? null,
          ventaId: data.ventaId ?? null,
          cuotaNumero: cuota.numero,
          monto: cuota.monto,
          fechaVencimiento: cuota.fechaVencimiento,
        });
      }
    }

    const clientMap = new Map<string, string>();
    await Promise.all(
      [...clientIds].map(async (clientId) => {
        const snap = await db.collection(`negocios/${businessId}/clientes`).doc(clientId).get();
        if (!snap.exists) return;
        clientMap.set(clientId, String(snap.data()?.nombre ?? ''));
      })
    );

    rows.sort((a, b) =>
      String(a.fechaVencimiento ?? '').localeCompare(String(b.fechaVencimiento ?? ''))
    );

    res.json(
      rows.map((row) => ({
        ...row,
        clienteNombre: clientMap.get(String(row.clienteId)) ?? '',
      }))
    );
  } catch (error) {
    console.error('Error fetching upcoming collections:', error);
    res.status(500).json({ error: 'Error fetching upcoming collections' });
  }
});

router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const paged = String(req.query.paged ?? '') === '1';
    if (paged) {
      const requestedLimit = Number(req.query.limit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(300, Math.max(20, Math.trunc(requestedLimit)))
        : 120;
      const cursor = String(req.query.cursor ?? '').trim();

      let query = db
        .collection(`negocios/${businessId}/clientes`)
        .orderBy('nombre')
        .limit(limit + 1);

      if (cursor) {
        const cursorSnap = await db
          .collection(`negocios/${businessId}/clientes`)
          .doc(cursor)
          .get();
        if (cursorSnap.exists) {
          query = query.startAfter(cursorSnap);
        }
      }

      const snapshot = await query.get();
      const hasMore = snapshot.docs.length > limit;
      const docs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;

      const balanceMap = await computeClientBalanceMap(businessId);
      const items = docs.map((doc) => {
        const saldoPendiente = balanceMap.get(doc.id) ?? 0;
        return {
          id: doc.id,
          ...doc.data(),
          saldoPendiente,
          debe: saldoPendiente > 0,
        };
      });

      const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : null;
      return res.json({ items, nextCursor, hasMore });
    }

    const snapshot = await db.collection(`negocios/${businessId}/clientes`).get();
    const balanceMap = await computeClientBalanceMap(businessId);

    const clients = snapshot.docs.map((doc) => {
      const saldoPendiente = balanceMap.get(doc.id) ?? 0;
      return {
        id: doc.id,
        ...doc.data(),
        saldoPendiente,
        debe: saldoPendiente > 0,
      };
    });

    res.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Error fetching clients' });
  }
});

router.get('/:businessId/:clientId/cuenta', async (req, res) => {
  try {
    const { businessId, clientId } = req.params;
    const clientSnap = await db.collection(`negocios/${businessId}/clientes`).doc(clientId).get();
    if (!clientSnap.exists) return res.status(404).json({ error: 'Client not found' });

    const [ordersSnap, salesSnap, compromisosSnap] = await Promise.all([
      db.collection(`negocios/${businessId}/pedidos`).where('clienteId', '==', clientId).get(),
      db.collection(`negocios/${businessId}/ventas`).where('clienteId', '==', clientId).get(),
      db
        .collection(`negocios/${businessId}/compromisos_pago`)
        .where('clienteId', '==', clientId)
        .get(),
    ]);

    const pedidos = ordersSnap.docs
      .map((doc) => {
        const data = doc.data();
        const total = Number(data.total) || 0;
        const saldo = Math.max(0, Number(data.saldo) || 0);
        const totalPagado = Number(data.totalPagado) || Math.max(0, total - saldo);
        const pagos = normalizePedidoPagosFromData({
          pagos: data.pagos as Array<{ id: string; tipo: 'seña' | 'cuota' | 'pago' | 'extra'; monto: number; fecha: string; movimientoCajaId?: string; notas?: string }>,
          movimientoSeniaId: data.movimientoSeniaId ? String(data.movimientoSeniaId) : undefined,
          senia: Number(data.senia) || 0,
          createdAt: data.createdAt ? String(data.createdAt) : undefined,
        });

        return {
          id: doc.id,
          numeroPedidoLabel:
            data.numeroPedidoLabel ?? resolveOrderLabel(data),
          descripcion: data.descripcion ?? '',
          estado: data.estado ?? '',
          total,
          totalPagado,
          saldo,
          ventaId: data.ventaId ?? null,
          fechaEntrega: data.fechaEntrega ?? null,
          cancelado: isCancelledStatus(data.estado),
          pagos,
        };
      })
      .filter((order) => !order.cancelado)
      .sort((a, b) => String(b.fechaEntrega ?? '').localeCompare(String(a.fechaEntrega ?? '')));

    const ventas = salesSnap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ventaLabel: resolveSaleLabel(data),
          origen: data.origen ?? 'mostrador',
          pedidoId: data.pedidoId ?? null,
          numeroPedidoLabel: data.numeroPedidoLabel ?? null,
          total: Number(data.total) || 0,
          montoCobrado: Number(data.montoCobrado) || 0,
          saldoPendiente: Math.max(0, Number(data.saldoPendiente) || 0),
          medioPago: String(data.medioPago ?? 'efectivo'),
          movimientoCajaId: data.movimientoCajaId ? String(data.movimientoCajaId) : null,
          cobros: (Array.isArray(data.cobros) ? data.cobros : []).map(
            (cobro: Record<string, unknown>) => ({
              id: String(cobro.id ?? ''),
              monto: Number(cobro.monto) || 0,
              fecha: String(cobro.fecha ?? ''),
              medioPago: cobro.medioPago ? String(cobro.medioPago) : undefined,
              notas: cobro.notas ? String(cobro.notas) : undefined,
              movimientoCajaId: cobro.movimientoCajaId ? String(cobro.movimientoCajaId) : null,
            })
          ),
          fecha: data.fecha ?? null,
        };
      })
      .sort((a, b) => String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')));

    const compromisos = compromisosSnap.docs
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      .sort((a, b) => String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')));

    const saldoPedidos = pedidos.reduce((acc, order) => acc + order.saldo, 0);
    const saldoVentasMostrador = ventas
      .filter((sale) => sale.origen !== 'pedido')
      .reduce((acc, sale) => acc + sale.saldoPendiente, 0);
    const saldoTotal = saldoPedidos + saldoVentasMostrador;

    const proximosCobros = compromisos.flatMap((compromiso) =>
      (compromiso.cuotas ?? [])
        .filter((cuota: { estado?: string }) => cuota.estado === 'pendiente')
        .map((cuota: { numero: number; monto: number; fechaVencimiento: string }) => ({
          compromisoId: compromiso.id,
          referenciaLabel: compromiso.referenciaLabel,
          cuotaNumero: cuota.numero,
          monto: cuota.monto,
          fechaVencimiento: cuota.fechaVencimiento,
        }))
    );
    proximosCobros.sort((a, b) =>
      String(a.fechaVencimiento).localeCompare(String(b.fechaVencimiento))
    );

    const cashSnap = await db
      .collection(`negocios/${businessId}/movimientos_caja`)
      .where('clienteId', '==', clientId)
      .get();

    const movimientosCaja = cashSnap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          tipo: data.tipo === 'egreso' ? 'egreso' : 'ingreso',
          monto: Number(data.monto) || 0,
          fecha: String(data.fecha ?? ''),
          concepto: String(data.concepto ?? ''),
          origenTipo: String(data.origenTipo ?? ''),
          origenGrupo: String(data.origenGrupo ?? ''),
          pedidoId: data.pedidoId ? String(data.pedidoId) : null,
          ventaId: data.ventaId ? String(data.ventaId) : null,
          ventaLabel: data.ventaLabel ? String(data.ventaLabel) : null,
          numeroPedidoLabel: data.numeroPedidoLabel ? String(data.numeroPedidoLabel) : null,
          medio: String(data.medio ?? 'efectivo'),
        };
      })
      .filter((movement) => movement.monto > 0)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

    const totalFacturado = computeTotalFacturado(ventas);
    const totalCobrado = computeTotalCobrado(ventas, pedidos);

    const historialPagos = buildClientHistorialPagos({
      pedidos,
      ventas,
      cajaIngresos: movimientosCaja.filter((movement) => movement.tipo === 'ingreso'),
    });

    res.json({
      cliente: { id: clientSnap.id, ...clientSnap.data() },
      saldoTotal,
      debe: saldoTotal > 0,
      saldoPedidos,
      saldoVentasMostrador,
      totalFacturado,
      totalCobrado,
      pedidos,
      ventas,
      compromisos,
      proximosCobros,
      movimientosCaja,
      historialPagos,
    });
  } catch (error) {
    console.error('Error fetching client account:', error);
    res.status(500).json({ error: 'Error fetching client account' });
  }
});

router.post('/:businessId/:clientId/cobros', async (req, res) => {
  try {
    const { businessId, clientId } = req.params;
    const clientSnap = await db.collection(`negocios/${businessId}/clientes`).doc(clientId).get();
    if (!clientSnap.exists) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const result = await collectClientBalance(businessId, clientId, {
      monto: Number(req.body.monto) || 0,
      medioPago: req.body.medioPago,
      notas: req.body.notas,
    });

    const clientName = String(clientSnap.data()?.nombre ?? 'Cliente');
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'clients',
      action: 'payment',
      entityType: 'cliente',
      entityId: clientId,
      entityLabel: clientName,
      summary: `Registró cobro de $${Number(req.body.monto) || 0} a ${clientName}`,
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error collecting client balance:', error);
    const message = error instanceof Error ? error.message : 'Error collecting client balance';
    res.status(400).json({ error: message });
  }
});

router.get('/:businessId/:clientId', async (req, res) => {
  try {
    const { businessId, clientId } = req.params;
    const doc = await db.collection(`negocios/${businessId}/clientes`).doc(clientId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Client not found' });

    const balanceMap = await computeClientBalanceMap(businessId);
    const saldoPendiente = balanceMap.get(clientId) ?? 0;

    res.json({
      id: doc.id,
      ...doc.data(),
      saldoPendiente,
      debe: saldoPendiente > 0,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching client' });
  }
});

router.post('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const clientData = req.body;
    const docRef = await db.collection(`negocios/${businessId}/clientes`).add({
      ...clientData,
      createdAt: new Date().toISOString(),
    });
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'clients',
      action: 'create',
      entityType: 'cliente',
      entityId: docRef.id,
      entityLabel: String(clientData.nombre ?? ''),
      summary: `Creó el cliente ${String(clientData.nombre ?? docRef.id)}`,
    });
    res.status(201).json({ id: docRef.id });
  } catch (error) {
    res.status(500).json({ error: 'Error creating client' });
  }
});

router.patch('/:businessId/:clientId', async (req, res) => {
  try {
    const { businessId, clientId } = req.params;
    const { id, createdAt, saldoPendiente, debe, ...clientData } = req.body;
    await db.collection(`negocios/${businessId}/clientes`).doc(clientId).update({
      ...clientData,
      updatedAt: new Date().toISOString(),
    });
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'clients',
      action: 'update',
      entityType: 'cliente',
      entityId: clientId,
      entityLabel: String(clientData.nombre ?? ''),
      summary: `Editó el cliente ${String(clientData.nombre ?? clientId)}`,
    });
    res.json({ id: clientId });
  } catch (error) {
    res.status(500).json({ error: 'Error updating client' });
  }
});

router.delete('/:businessId/:clientId', async (req, res) => {
  try {
    const { businessId, clientId } = req.params;
    const clientSnap = await db.collection(`negocios/${businessId}/clientes`).doc(clientId).get();
    const clientName = String(clientSnap.data()?.nombre ?? clientId);
    await db.collection(`negocios/${businessId}/clientes`).doc(clientId).delete();
    await logActivityFromRequest(req as AuthenticatedRequest, businessId, {
      module: 'clients',
      action: 'delete',
      entityType: 'cliente',
      entityId: clientId,
      entityLabel: clientName,
      summary: `Eliminó el cliente ${clientName}`,
    });
    res.json({ id: clientId });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting client' });
  }
});

export default router;
