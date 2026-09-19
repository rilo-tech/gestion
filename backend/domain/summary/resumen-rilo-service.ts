/**
 * Datos read-only para Resumen RILO (webExperience=summary).
 * Compone desde colecciones reales — no segunda base de actividad.
 */
import { db } from '../../firebase.ts';
import { getCashBalance, getCashDayTotals } from '../cash/index.ts';
import { computeClientBalanceMap } from '../../utils/client-balance.ts';
import { listPayableInstallments } from '../../utils/payables.ts';
import { resolveOrderLabel } from '../../utils/order-number.ts';
import { getOrderEstadoLabel, normalizeOrderPedidosConfig } from '../../utils/order-config.ts';
import {
  isCancelledStatus,
  isDeliveredEstado,
  resolveOrderEstado,
} from '../../routes/orders.ts';
import { resolveOrderBalance } from '../../../shared/order-balance.ts';
import { listModuleActivity, type ActivityModule } from '../../utils/activity-log.ts';

const DEFAULT_TZ = 'America/Argentina/Buenos_Aires';

function localDayKey(date = new Date(), timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function moneyRound(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type ResumenHoyDto = {
  ventasHoy: number;
  cobradoHoy: number;
  cajaSaldo: number;
  pedidosAbiertos: number;
  paraHoy: number;
  porCobrar: number;
  pagosProximosCount: number;
  pagosProximosMonto: number;
};

export type ResumenActivityItem = {
  at: string;
  kind: string;
  label: string;
  amount?: number;
  entityId?: string;
};

export type ResumenOrderItem = {
  id: string;
  label: string;
  clientName: string;
  fechaEntrega: string | null;
  estadoId: string;
  estadoLabel: string;
  total: number;
  saldo: number;
  whatsappPrefill: string;
};

export type ResumenClientBalance = {
  id: string;
  name: string;
  balance: number;
};

export type ResumenCashDto = {
  ingresosHoy: number;
  egresosHoy: number;
  saldo: number;
};

export type ResumenPayableItem = {
  id: string;
  beneficiario: string;
  fechaVencimiento: string;
  monto: number;
  displayEstado: string;
};

export async function buildResumenHoy(businessId: string): Promise<ResumenHoyDto> {
  const day = localDayKey();
  const [cashDay, cashBal, salesSnap, ordersSnap, clientsMap, payables] = await Promise.all([
    getCashDayTotals(businessId, { day }),
    getCashBalance(businessId),
    db.collection(`negocios/${businessId}/ventas`).limit(300).get(),
    db.collection(`negocios/${businessId}/pedidos`).get(),
    computeClientBalanceMap(businessId),
    listPayableInstallments(businessId, { scope: 'all' }),
  ]);

  let ventasHoy = 0;
  let cobradoHoy = 0;
  for (const doc of salesSnap.docs) {
    const data = doc.data();
    if (!String(data.fecha ?? '').startsWith(day)) continue;
    if (String(data.estado ?? '') === 'anulada') continue;
    ventasHoy += Number(data.total) || 0;
    cobradoHoy += Number(data.montoCobrado ?? data.totalPagado) || 0;
  }

  let pedidosAbiertos = 0;
  let paraHoy = 0;
  for (const doc of ordersSnap.docs) {
    const data = doc.data();
    const estado = String(data.estado ?? '');
    if (isCancelledStatus(estado)) continue;
    if (isDeliveredEstado(resolveOrderEstado(estado))) continue;
    pedidosAbiertos += 1;
    const entrega = String(data.fechaEntrega ?? '').slice(0, 10);
    if (entrega === day) paraHoy += 1;
  }

  let porCobrar = 0;
  for (const bal of clientsMap.values()) {
    if (bal > 0) porCobrar += bal;
  }

  const pendingPay = payables.items.filter((row) => row.estado !== 'pagada');
  const end = new Date();
  end.setDate(end.getDate() + 14);
  const endKey = end.toISOString().slice(0, 10);
  const proximos = pendingPay.filter((row) => {
    const due = String(row.fechaVencimiento).slice(0, 10);
    return due >= day && due <= endKey;
  });

  return {
    ventasHoy: moneyRound(ventasHoy),
    cobradoHoy: moneyRound(cobradoHoy || cashDay.ingresos || 0),
    cajaSaldo: moneyRound(cashBal.saldo ?? 0),
    pedidosAbiertos,
    paraHoy,
    porCobrar: moneyRound(porCobrar),
    pagosProximosCount: proximos.length,
    pagosProximosMonto: moneyRound(proximos.reduce((s, r) => s + (Number(r.monto) || 0), 0)),
  };
}

export async function buildResumenActivity(
  businessId: string,
  auth: { userId: string; rol: string },
  limit = 20
): Promise<ResumenActivityItem[]> {
  const modules: ActivityModule[] = ['sales', 'orders', 'cash', 'purchases', 'clients'];
  const batches = await Promise.all(
    modules.map((module) =>
      listModuleActivity(
        businessId,
        module,
        { userId: auth.userId, rol: auth.rol as never },
        { limit: 10 }
      ).catch(() => [])
    )
  );

  const items: ResumenActivityItem[] = [];
  for (const batch of batches) {
    for (const row of batch) {
      items.push({
        at: String(row.createdAt ?? ''),
        kind: String(row.module ?? ''),
        label: String(row.summary ?? row.entityLabel ?? ''),
        amount:
          typeof row.metadata?.amount === 'number' ? (row.metadata.amount as number) : undefined,
        entityId: row.entityId,
      });
    }
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  return items.slice(0, limit);
}

export async function buildResumenOrders(businessId: string): Promise<ResumenOrderItem[]> {
  const [snap, appSnap] = await Promise.all([
    db.collection(`negocios/${businessId}/pedidos`).get(),
    db.doc(`negocios/${businessId}/config/app`).get(),
  ]);
  const pedidosCfg = normalizeOrderPedidosConfig(
    ((appSnap.data() ?? {}) as Record<string, unknown>).pedidos as Record<string, unknown>
  );

  const open: ResumenOrderItem[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const estado = String(data.estado ?? '');
    if (isCancelledStatus(estado)) continue;
    if (isDeliveredEstado(resolveOrderEstado(estado))) continue;
    const balance = resolveOrderBalance(data as never);
    const label = resolveOrderLabel({
      numeroPedido: Number(data.numeroPedido) || undefined,
      numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
    });
    open.push({
      id: doc.id,
      label,
      clientName: String(data.clienteNombre ?? ''),
      fechaEntrega: data.fechaEntrega ? String(data.fechaEntrega).slice(0, 10) : null,
      estadoId: resolveOrderEstado(estado),
      estadoLabel: getOrderEstadoLabel(estado, pedidosCfg.estados),
      total: balance.total,
      saldo: balance.saldo,
      whatsappPrefill: `Quiero gestionar el pedido #${label}`,
    });
  }

  open.sort((a, b) => String(a.fechaEntrega ?? '').localeCompare(String(b.fechaEntrega ?? '')));
  return open.slice(0, 50);
}

export async function buildResumenClientBalances(
  businessId: string
): Promise<ResumenClientBalance[]> {
  const map = await computeClientBalanceMap(businessId);
  const clientsSnap = await db.collection(`negocios/${businessId}/clientes`).get();
  const nameById = new Map(
    clientsSnap.docs.map((d) => [d.id, String(d.data().nombre ?? d.id)])
  );
  return [...map.entries()]
    .filter(([, bal]) => bal > 0.009)
    .map(([id, balance]) => ({
      id,
      name: nameById.get(id) ?? id,
      balance: moneyRound(balance),
    }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 50);
}

export async function buildResumenCash(businessId: string): Promise<ResumenCashDto> {
  const day = localDayKey();
  const [dayTotals, bal] = await Promise.all([
    getCashDayTotals(businessId, { day }),
    getCashBalance(businessId),
  ]);
  return {
    ingresosHoy: moneyRound(dayTotals.ingresos ?? 0),
    egresosHoy: moneyRound(dayTotals.egresos ?? 0),
    saldo: moneyRound(bal.saldo ?? 0),
  };
}

export async function buildResumenPayables(
  businessId: string
): Promise<ResumenPayableItem[]> {
  const day = localDayKey();
  const end = new Date();
  end.setDate(end.getDate() + 30);
  const endKey = end.toISOString().slice(0, 10);
  const { items } = await listPayableInstallments(businessId, { scope: 'all' });
  return items
    .filter((row) => row.estado !== 'pagada')
    .filter((row) => {
      const due = String(row.fechaVencimiento).slice(0, 10);
      return due <= endKey;
    })
    .sort((a, b) =>
      String(a.fechaVencimiento).localeCompare(String(b.fechaVencimiento))
    )
    .slice(0, 30)
    .map((row) => ({
      id: row.id,
      beneficiario: String(row.beneficiario ?? ''),
      fechaVencimiento: String(row.fechaVencimiento).slice(0, 10),
      monto: moneyRound(row.monto),
      displayEstado: row.displayEstado,
    }));
}
