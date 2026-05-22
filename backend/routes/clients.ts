import express from 'express';
import { db } from '../firebase.ts';
import { resolveOrderLabel } from '../utils/order-number.ts';
import { computeClientBalanceMap } from '../utils/client-balance.ts';

const router = express.Router();

function isCancelledStatus(estado?: string) {
  const value = String(estado ?? '').toLowerCase().trim();
  return value === 'cancelado' || value.includes('cancelad');
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

        return {
          id: doc.id,
          numeroPedidoLabel:
            data.numeroPedidoLabel ?? resolveOrderLabel(data, doc.id),
          descripcion: data.descripcion ?? '',
          estado: data.estado ?? '',
          total,
          totalPagado,
          saldo,
          ventaId: data.ventaId ?? null,
          fechaEntrega: data.fechaEntrega ?? null,
          cancelado: isCancelledStatus(data.estado),
        };
      })
      .filter((order) => !order.cancelado)
      .sort((a, b) => String(b.fechaEntrega ?? '').localeCompare(String(a.fechaEntrega ?? '')));

    const ventas = salesSnap.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ventaLabel: data.ventaLabel ?? doc.id.slice(-6).toUpperCase(),
          origen: data.origen ?? 'mostrador',
          pedidoId: data.pedidoId ?? null,
          numeroPedidoLabel: data.numeroPedidoLabel ?? null,
          total: Number(data.total) || 0,
          montoCobrado: Number(data.montoCobrado) || 0,
          saldoPendiente: Math.max(0, Number(data.saldoPendiente) || 0),
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

    res.json({
      cliente: { id: clientSnap.id, ...clientSnap.data() },
      saldoTotal,
      debe: saldoTotal > 0,
      saldoPedidos,
      saldoVentasMostrador,
      pedidos,
      ventas,
      compromisos,
      proximosCobros,
    });
  } catch (error) {
    console.error('Error fetching client account:', error);
    res.status(500).json({ error: 'Error fetching client account' });
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
    res.json({ id: clientId });
  } catch (error) {
    res.status(500).json({ error: 'Error updating client' });
  }
});

router.delete('/:businessId/:clientId', async (req, res) => {
  try {
    const { businessId, clientId } = req.params;
    await db.collection(`negocios/${businessId}/clientes`).doc(clientId).delete();
    res.json({ id: clientId });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting client' });
  }
});

export default router;
