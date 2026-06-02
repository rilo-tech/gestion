import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';

const businessId = process.argv[2] ?? 'rilo';
const mes = Number(process.argv[3] ?? 6);
const anio = Number(process.argv[4] ?? 2026);

const monthStart = `${anio}-${String(mes).padStart(2, '0')}-01`;
const lastDay = new Date(anio, mes, 0).getDate();
const monthEnd = `${anio}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

type SaleLine = {
  nombre?: string;
  cantidad?: number;
  precioUnitario?: number;
  costoUnitario?: number;
  costoPersonalizacion?: number;
  costosExtra?: Array<{ costo?: number }>;
};

function sumLinePers(line: SaleLine): number {
  const qty = Math.max(0, Number(line.cantidad) || 0);
  const extras = Array.isArray(line.costosExtra) ? line.costosExtra : [];
  const fromList = extras.reduce((acc, extra) => acc + (Number(extra?.costo) || 0), 0);
  if (fromList > 0) return qty * fromList;
  return Number(line.costoPersonalizacion) || 0;
}

function lineCost(line: SaleLine): number {
  const qty = Number(line.cantidad) || 0;
  return qty * (Number(line.costoUnitario) || 0) + sumLinePers(line);
}

function lineFacturado(line: SaleLine): number {
  const qty = Number(line.cantidad) || 0;
  return qty * (Number(line.precioUnitario) || 0);
}

const snap = await db
  .collection(`negocios/${businessId}/ventas`)
  .where('fecha', '>=', `${monthStart}T00:00:00.000Z`)
  .where('fecha', '<=', `${monthEnd}T23:59:59.999Z`)
  .get();

const rows: Array<Record<string, string | number>> = [];
let totalFacturado = 0;
let totalCosto = 0;

const sortedDocs = snap.docs.sort((a, b) =>
  String(a.data().fecha ?? '').localeCompare(String(b.data().fecha ?? ''))
);

for (const doc of sortedDocs) {
  const data = doc.data();
  if (String(data.estado ?? '') === 'borrador') continue;

  const saleLabel =
    data.ventaLabel ||
    (data.numeroVenta ? String(data.numeroVenta).padStart(5, '0') : doc.id.slice(0, 8));
  const orderLabel =
    data.origen === 'pedido'
      ? data.numeroPedidoLabel ||
        (data.numeroPedido ? String(data.numeroPedido).padStart(5, '0') : 'Pedido')
      : 'Mostrador';

  const items = (Array.isArray(data.items) ? data.items : []) as SaleLine[];
  const saleTotal = Number(data.total) || 0;
  const storedCost = Number(data.costoReal) || 0;
  const calculatedCost = items.reduce((acc, line) => acc + lineCost(line), 0);
  const saleCost = Math.max(storedCost, calculatedCost);
  const saleProfit = Math.round((saleTotal - saleCost) * 100) / 100;
  const storedProfit = Number(data.gananciaEstimada) || 0;

  totalFacturado += saleTotal;
  totalCosto += saleCost;

  const totalPagadoAnterior = Number(data.totalPagadoAnterior) || 0;
  const montoCobrado = Number(data.montoCobrado) || 0;
  const saldoPendiente = Math.max(0, Number(data.saldoPendiente) ?? saleTotal - totalPagadoAnterior - montoCobrado);
  const totalPagado = totalPagadoAnterior + montoCobrado;

  if (items.length === 0) {
    rows.push({
      venta: saleLabel,
      pedido: orderLabel,
      producto: '(sin ítems)',
      cantidad: 0,
      totalLinea: saleTotal,
      costoLinea: saleCost,
      gananciaLinea: saleProfit,
      totalVenta: saleTotal,
      costoVenta: saleCost,
      gananciaVenta: saleProfit,
      gananciaGuardada: storedProfit,
      totalPagadoAnterior,
      montoCobrado,
      totalPagado,
      saldoPendiente,
    });
    continue;
  }

  for (const line of items) {
    const facturado = lineFacturado(line);
    const costo = lineCost(line);
    rows.push({
      venta: saleLabel,
      pedido: orderLabel,
      producto: String(line.nombre ?? 'Producto'),
      cantidad: Number(line.cantidad) || 0,
      totalLinea: facturado,
      costoLinea: costo,
      gananciaLinea: Math.round((facturado - costo) * 100) / 100,
      totalVenta: saleTotal,
      costoVenta: saleCost,
      gananciaVenta: saleProfit,
      gananciaGuardada: storedProfit,
      totalPagadoAnterior,
      montoCobrado,
      totalPagado,
      saldoPendiente,
    });
  }
}

const totalGanancia = Math.round((totalFacturado - totalCosto) * 100) / 100;

const gananciaPorVenta = new Map<string, { ganancia: number; saldo: number }>();
for (const row of rows) {
  const key = String(row.venta);
  if (!gananciaPorVenta.has(key)) {
    gananciaPorVenta.set(key, {
      ganancia: Number(row.gananciaVenta) || 0,
      saldo: Number(row.saldoPendiente) || 0,
    });
  }
}
let gananciaSoloCobrada = 0;
for (const [, v] of gananciaPorVenta) {
  if (v.saldo <= 0) gananciaSoloCobrada += v.ganancia;
}

console.log(
  JSON.stringify(
    {
      mes,
      anio,
      ventas: sortedDocs.filter((d) => String(d.data().estado ?? '') !== 'borrador').length,
      totalFacturado: Math.round(totalFacturado),
      totalCosto: Math.round(totalCosto),
      totalGanancia: Math.round(totalGanancia),
      totalGananciaCobrada: Math.round(gananciaSoloCobrada),
      sumGananciaGuardada: Math.round(
        sortedDocs
          .filter((d) => String(d.data().estado ?? '') !== 'borrador')
          .reduce((acc, d) => acc + (Number(d.data().gananciaEstimada) || 0), 0)
      ),
      rows,
    },
    null,
    2
  )
);
