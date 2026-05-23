import { db } from '../firebase.ts';
import { resolveOrderLabel } from './order-number.ts';
import { resolveSaleLabel } from './sale-number.ts';

type OrderPayment = {
  id: string;
  tipo: 'seña' | 'cuota' | 'pago' | 'extra';
  monto: number;
  fecha: string;
  movimientoCajaId?: string;
  notas?: string;
};

type OrderRecord = {
  clienteId?: string;
  estado?: string;
  total?: number;
  saldo?: number;
  totalPagado?: number;
  pagos?: OrderPayment[];
  senia?: number;
  seniaBloqueada?: boolean;
  movimientoSeniaId?: string;
  numeroPedido?: number;
  numeroPedidoLabel?: string;
  fechaEntrega?: string;
  createdAt?: string;
};

export type ClientAccountPago = {
  id: string;
  tipo: string;
  monto: number;
  fecha: string;
  notas?: string;
  movimientoCajaId?: string | null;
};

export type ClientAccountVentaCobro = {
  id: string;
  monto: number;
  fecha: string;
  medioPago?: string;
  notas?: string;
  movimientoCajaId?: string | null;
};

export type ClientHistorialPago = {
  id: string;
  fecha: string;
  monto: number;
  concepto: string;
  origenTipo: string;
  pedidoId?: string | null;
  ventaId?: string | null;
  ventaLabel?: string | null;
  numeroPedidoLabel?: string | null;
  medio?: string;
};

type PendingDebt =
  | {
      kind: 'pedido';
      id: string;
      saldo: number;
      fecha: string;
      label: string;
    }
  | {
      kind: 'venta';
      id: string;
      saldo: number;
      fecha: string;
      label: string;
    };

export type ClientCollectionAllocation = {
  kind: 'pedido' | 'venta';
  id: string;
  label: string;
  monto: number;
  movimientoCajaId: string;
};

function isCancelledStatus(estado?: string) {
  const value = String(estado ?? '').toLowerCase().trim();
  return value === 'cancelado' || value.includes('cancelad');
}

function normalizePagos(order: OrderRecord): OrderPayment[] {
  const pagos = [...(order.pagos ?? [])];
  if (pagos.length === 0 && order.movimientoSeniaId && Number(order.senia) > 0) {
    pagos.push({
      id: `pago_senia_${order.movimientoSeniaId}`,
      tipo: 'seña',
      monto: Number(order.senia),
      fecha: order.createdAt ?? new Date().toISOString(),
      movimientoCajaId: order.movimientoSeniaId,
    });
  }
  return pagos;
}

export function normalizePedidoPagosFromData(data: {
  pagos?: OrderPayment[];
  movimientoSeniaId?: string;
  senia?: number;
  createdAt?: string;
}): ClientAccountPago[] {
  return normalizePagos({
    pagos: data.pagos,
    movimientoSeniaId: data.movimientoSeniaId,
    senia: data.senia,
    createdAt: data.createdAt,
  }).map((pago) => ({
    id: pago.id,
    tipo: pago.tipo,
    monto: pago.monto,
    fecha: pago.fecha,
    notas: pago.notas,
    movimientoCajaId: pago.movimientoCajaId ?? null,
  }));
}

function pagoConcepto(tipo: string, numeroPedidoLabel: string): string {
  if (tipo === 'seña') return `Seña pedido #${numeroPedidoLabel}`;
  if (tipo === 'cuota') return `Cuota pedido #${numeroPedidoLabel}`;
  return `Pago pedido #${numeroPedidoLabel}`;
}

function pagoOrigenTipo(tipo: string): string {
  if (tipo === 'seña') return 'pedido_senia';
  if (tipo === 'cuota') return 'pedido_cuota';
  return 'pedido_pago';
}

export function buildClientHistorialPagos(params: {
  pedidos: Array<{
    id: string;
    numeroPedidoLabel?: string;
    ventaId?: string | null;
    pagos?: ClientAccountPago[];
  }>;
  ventas: Array<{
    id: string;
    ventaLabel?: string;
    origen?: string;
    montoCobrado?: number;
    medioPago?: string;
    fecha?: string | null;
    movimientoCajaId?: string | null;
    cobros?: ClientAccountVentaCobro[];
  }>;
  cajaIngresos: Array<{
    id: string;
    fecha: string;
    monto: number;
    concepto: string;
    origenTipo: string;
    pedidoId?: string | null;
    ventaId?: string | null;
    ventaLabel?: string | null;
    numeroPedidoLabel?: string | null;
    medio?: string;
  }>;
}): ClientHistorialPago[] {
  const seen = new Set<string>();
  const entries: ClientHistorialPago[] = [];

  const add = (entry: ClientHistorialPago, dedupeKey: string) => {
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    entries.push(entry);
  };

  for (const movement of params.cajaIngresos) {
    add(
      {
        id: movement.id,
        fecha: movement.fecha,
        monto: movement.monto,
        concepto: movement.concepto,
        origenTipo: movement.origenTipo,
        pedidoId: movement.pedidoId ?? null,
        ventaId: movement.ventaId ?? null,
        ventaLabel: movement.ventaLabel ?? null,
        numeroPedidoLabel: movement.numeroPedidoLabel ?? null,
        medio: movement.medio ?? 'efectivo',
      },
      movement.id
    );
  }

  for (const pedido of params.pedidos) {
    const label = pedido.numeroPedidoLabel ?? resolveOrderLabel(pedido);
    for (const pago of pedido.pagos ?? []) {
      if (pago.tipo === 'extra' || !(Number(pago.monto) > 0)) continue;

      const dedupeKey = pago.movimientoCajaId || `pedido_${pedido.id}_${pago.id}`;
      if (seen.has(dedupeKey)) continue;

      add(
        {
          id: pago.id,
          fecha: pago.fecha,
          monto: Number(pago.monto) || 0,
          concepto: pagoConcepto(pago.tipo, label),
          origenTipo: pagoOrigenTipo(pago.tipo),
          pedidoId: pedido.id,
          ventaId: pedido.ventaId ?? null,
          ventaLabel: null,
          numeroPedidoLabel: label,
          medio: 'efectivo',
        },
        dedupeKey
      );
    }
  }

  for (const venta of params.ventas) {
    if (venta.origen === 'pedido') continue;

    const ventaLabel = resolveSaleLabel(venta);
    const cobros = venta.cobros ?? [];
    const cobrosSum = cobros.reduce((acc, cobro) => acc + (Number(cobro.monto) || 0), 0);
    const montoInicial = Math.max(0, (Number(venta.montoCobrado) || 0) - cobrosSum);

    if (montoInicial > 0) {
      const dedupeKey = venta.movimientoCajaId || `venta_inicial_${venta.id}`;
      if (!seen.has(dedupeKey)) {
        add(
          {
            id: dedupeKey,
            fecha: venta.fecha ?? '',
            monto: montoInicial,
            concepto: `Venta mostrador #${ventaLabel}`,
            origenTipo: 'venta_mostrador',
            pedidoId: null,
            ventaId: venta.id,
            ventaLabel,
            numeroPedidoLabel: null,
            medio: venta.medioPago ?? 'efectivo',
          },
          dedupeKey
        );
      }
    }

    for (const cobro of cobros) {
      if (!(Number(cobro.monto) > 0)) continue;
      const dedupeKey = cobro.movimientoCajaId || `venta_cobro_${venta.id}_${cobro.id}`;
      if (seen.has(dedupeKey)) continue;

      add(
        {
          id: cobro.id,
          fecha: cobro.fecha,
          monto: Number(cobro.monto) || 0,
          concepto: `Cobro saldo venta #${ventaLabel}`,
          origenTipo: 'venta_mostrador_cobro',
          pedidoId: null,
          ventaId: venta.id,
          ventaLabel,
          numeroPedidoLabel: null,
          medio: cobro.medioPago ?? 'efectivo',
        },
        dedupeKey
      );
    }
  }

  entries.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return entries;
}

function sumPagosHaciaTotal(pagos: OrderPayment[] = []) {
  return pagos
    .filter((pago) => pago.tipo !== 'extra')
    .reduce((acc, pago) => acc + (Number(pago.monto) || 0), 0);
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

async function createCashIncome(
  businessId: string,
  params: {
    monto: number;
    concepto: string;
    origenId: string;
    origenTipo: string;
    origenGrupo?: string;
    medio?: string;
    clienteId?: string;
    pedidoId?: string | null;
    ventaId?: string | null;
    ventaLabel?: string | null;
    numeroPedido?: number | null;
    numeroPedidoLabel?: string | null;
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
    origenGrupo: params.origenGrupo ?? 'venta',
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

export async function getClientPendingDebts(
  businessId: string,
  clientId: string
): Promise<PendingDebt[]> {
  const [ordersSnap, salesSnap] = await Promise.all([
    db.collection(`negocios/${businessId}/pedidos`).where('clienteId', '==', clientId).get(),
    db.collection(`negocios/${businessId}/ventas`).where('clienteId', '==', clientId).get(),
  ]);

  const debts: PendingDebt[] = [];

  for (const doc of ordersSnap.docs) {
    const data = doc.data() as OrderRecord;
    if (isCancelledStatus(data.estado)) continue;

    const saldo = Math.max(0, Number(data.saldo) || 0);
    if (saldo <= 0) continue;

    const label = data.numeroPedidoLabel ?? resolveOrderLabel(data);
    debts.push({
      kind: 'pedido',
      id: doc.id,
      saldo,
      fecha: String(data.fechaEntrega ?? data.createdAt ?? ''),
      label: `Pedido #${label}`,
    });
  }

  for (const doc of salesSnap.docs) {
    const data = doc.data();
    if (data.origen === 'pedido') continue;

    const saldo = Math.max(0, Number(data.saldoPendiente) || 0);
    if (saldo <= 0) continue;

    const ventaLabel = resolveSaleLabel(data);
    debts.push({
      kind: 'venta',
      id: doc.id,
      saldo,
      fecha: String(data.fecha ?? ''),
      label: `Venta #${ventaLabel}`,
    });
  }

  debts.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  return debts;
}

export function planClientCollection(
  debts: PendingDebt[],
  monto: number
): Array<{ debt: PendingDebt; monto: number }> {
  let remaining = monto;
  const plan: Array<{ debt: PendingDebt; monto: number }> = [];

  for (const debt of debts) {
    if (remaining <= 0) break;
    const apply = Math.min(remaining, debt.saldo);
    if (apply <= 0) continue;
    plan.push({ debt, monto: apply });
    remaining -= apply;
  }

  return plan;
}

async function applyPedidoPayment(
  businessId: string,
  clientId: string,
  orderId: string,
  monto: number,
  medioPago: string,
  notas: string
): Promise<{ movimientoCajaId: string; label: string }> {
  const orderRef = db.collection(`negocios/${businessId}/pedidos`).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new Error('Pedido no encontrado.');
  }

  const order = orderSnap.data() as OrderRecord;
  if (isCancelledStatus(order.estado)) {
    throw new Error('No se pueden registrar pagos en un pedido cancelado.');
  }

  const total = Number(order.total) || 0;
  const pagosBase = normalizePagos(order);
  const pagadoActual = sumPagosHaciaTotal(pagosBase);
  const saldoPedido = Math.max(0, total - pagadoActual);

  if (monto > saldoPedido) {
    throw new Error(`El monto supera el saldo del pedido ($${saldoPedido}).`);
  }

  const orderLabel = resolveOrderLabel(order);
  const timestamp = Date.now();
  const movimientoCajaId = await createCashIncome(businessId, {
    monto,
    concepto: `Pago pedido #${orderLabel}`,
    origenId: orderId,
    origenTipo: 'pedido_pago',
    origenGrupo: 'pedido',
    medio: medioPago,
    clienteId,
    pedidoId: orderId,
    numeroPedido: order.numeroPedido ?? null,
    numeroPedidoLabel: order.numeroPedidoLabel ?? orderLabel,
  });

  const nuevosPagos: OrderPayment[] = [
    {
      id: `pago_${timestamp}`,
      tipo: 'pago',
      monto,
      fecha: new Date().toISOString(),
      movimientoCajaId,
      notas: notas || undefined,
    },
  ];

  const pagos = [...pagosBase, ...nuevosPagos].map(sanitizePagoForFirestore);
  const totalPagado = sumPagosHaciaTotal([...pagosBase, ...nuevosPagos]);
  const saldo = Math.max(0, total - totalPagado);

  await orderRef.update({
    pagos,
    totalPagado,
    saldo,
    seniaBloqueada: true,
    updatedAt: new Date().toISOString(),
  });

  return { movimientoCajaId, label: `Pedido #${orderLabel}` };
}

async function applyVentaCobro(
  businessId: string,
  clientId: string,
  ventaId: string,
  monto: number,
  medioPago: string,
  notas: string
): Promise<{ movimientoCajaId: string; label: string }> {
  const ventaRef = db.collection(`negocios/${businessId}/ventas`).doc(ventaId);
  const ventaSnap = await ventaRef.get();
  if (!ventaSnap.exists) {
    throw new Error('Venta no encontrada.');
  }

  const venta = ventaSnap.data() ?? {};
  if (venta.origen === 'pedido') {
    throw new Error('Los cobros de ventas por pedido se registran desde el pedido.');
  }

  const saldoPendiente = Math.max(0, Number(venta.saldoPendiente) || 0);
  if (monto > saldoPendiente) {
    throw new Error(`El monto supera el saldo de la venta ($${saldoPendiente}).`);
  }

  const ventaLabel = resolveSaleLabel(venta);
  const timestamp = new Date().toISOString();
  const movimientoCajaId = await createCashIncome(businessId, {
    monto,
    concepto: `Cobro saldo venta #${ventaLabel}`,
    origenId: ventaId,
    origenTipo: 'venta_mostrador_cobro',
    origenGrupo: 'venta',
    medio: medioPago,
    clienteId,
    ventaId,
    ventaLabel,
    pedidoId: null,
  });

  const montoCobrado = (Number(venta.montoCobrado) || 0) + monto;
  const nuevoSaldo = Math.max(0, (Number(venta.total) || 0) - montoCobrado);
  const cobrosExtra = Array.isArray(venta.cobros) ? [...venta.cobros] : [];
  cobrosExtra.push({
    id: `cobro_${Date.now()}`,
    monto,
    fecha: timestamp,
    medioPago,
    notas: notas || undefined,
    movimientoCajaId,
  });

  await ventaRef.update({
    montoCobrado,
    saldoPendiente: nuevoSaldo,
    cobros: cobrosExtra,
  });

  return { movimientoCajaId, label: `Venta #${ventaLabel}` };
}

export async function collectClientBalance(
  businessId: string,
  clientId: string,
  params: { monto: number; medioPago?: string; notas?: string }
): Promise<{
  monto: number;
  saldoAnterior: number;
  saldoRestante: number;
  allocations: ClientCollectionAllocation[];
}> {
  const monto = Number(params.monto) || 0;
  if (monto <= 0) {
    throw new Error('El monto debe ser mayor a cero.');
  }

  const debts = await getClientPendingDebts(businessId, clientId);
  const saldoAnterior = debts.reduce((acc, debt) => acc + debt.saldo, 0);

  if (monto > saldoAnterior) {
    throw new Error(`El monto supera el saldo pendiente del cliente ($${saldoAnterior}).`);
  }

  const medioPago = String(params.medioPago ?? 'efectivo').trim() || 'efectivo';
  const notas = String(params.notas ?? '').trim();
  const plan = planClientCollection(debts, monto);
  const allocations: ClientCollectionAllocation[] = [];

  for (const entry of plan) {
    if (entry.debt.kind === 'pedido') {
      const result = await applyPedidoPayment(
        businessId,
        clientId,
        entry.debt.id,
        entry.monto,
        medioPago,
        notas
      );
      allocations.push({
        kind: 'pedido',
        id: entry.debt.id,
        label: result.label,
        monto: entry.monto,
        movimientoCajaId: result.movimientoCajaId,
      });
      continue;
    }

    const result = await applyVentaCobro(
      businessId,
      clientId,
      entry.debt.id,
      entry.monto,
      medioPago,
      notas
    );
    allocations.push({
      kind: 'venta',
      id: entry.debt.id,
      label: result.label,
      monto: entry.monto,
      movimientoCajaId: result.movimientoCajaId,
    });
  }

  return {
    monto,
    saldoAnterior,
    saldoRestante: saldoAnterior - monto,
    allocations,
  };
}
