import { db } from '../firebase.ts';
import {
  buildCollaboratorsPeriodSummary,
  type CollaboratorsPeriodSummary,
} from './collaborators.ts';

export type ReportGroupBy = 'product' | 'category' | 'type' | 'size' | 'color' | 'client';

export type ReportFilters = {
  from: string;
  to: string;
  clienteId?: string;
  productoId?: string;
  categoria?: string;
  tipo?: string;
  talle?: string;
  color?: string;
  groupBy: ReportGroupBy;
};

type SaleLineExtra = { nombre?: string; costo?: number };

type SaleLine = {
  stockItemId?: string;
  nombre?: string;
  cantidad?: number;
  precioUnitario?: number;
  subtotal?: number;
  costoUnitario?: number;
  costoPersonalizacion?: number;
  costosExtra?: SaleLineExtra[];
};

type SaleRecord = {
  id: string;
  clienteId?: string | null;
  clienteNombre?: string;
  items?: SaleLine[];
  total?: number;
  costoReal?: number;
  gananciaEstimada?: number;
  montoCobrado?: number;
  fecha?: string;
  ventaLabel?: string;
  numeroVenta?: number;
};

type StockRecord = {
  id: string;
  nombre?: string;
  nombreBase?: string;
  tipo?: string;
  categoria?: string;
  talle?: string;
  color?: string;
  stockActual?: number;
};

type ClientRecord = {
  id: string;
  nombre?: string;
};

export type ReportGroupRow = {
  key: string;
  label: string;
  cantidad: number;
  facturado: number;
  costo: number;
  ganancia: number;
  ventasCount: number;
  stockActual?: number;
  ventaDiariaPromedio?: number;
  stockSugeridoMes?: number;
  faltanteMes?: number;
};

export type ReportMonthlyRow = {
  periodo: string;
  label: string;
  cantidad: number;
  facturado: number;
  costo: number;
  ganancia: number;
  ventasCount: number;
};

export type ReportClientProductRow = {
  productoId: string;
  nombre: string;
  cantidad: number;
  facturado: number;
};

export type ReportClientSaleRow = {
  id: string;
  fecha: string;
  ventaLabel: string;
  total: number;
  cantidadItems: number;
};

export type ReportInactiveClientRow = {
  clienteId: string;
  nombre: string;
  ultimaCompra: string | null;
  diasSinComprar: number | null;
  totalHistorico: number;
  ventasCount: number;
};

export type ReportSummary = {
  ventasCount: number;
  unidadesVendidas: number;
  facturado: number;
  cobrado: number;
  costo: number;
  ganancia: number;
  ticketPromedio: number;
};

export type ReportResult = {
  period: { from: string; to: string; days: number };
  filters: ReportFilters;
  summary: ReportSummary;
  groups: ReportGroupRow[];
  monthlyTrend: ReportMonthlyRow[];
  promedioMensual: {
    cantidad: number;
    facturado: number;
    costo: number;
    ganancia: number;
    mesesConDatos: number;
  };
  clientDetail?: {
    clienteId: string;
    clienteNombre: string;
    ventas: ReportClientSaleRow[];
    productos: ReportClientProductRow[];
  };
  inactiveClients: ReportInactiveClientRow[];
  collaboratorsSummary?: CollaboratorsPeriodSummary;
};

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function parseDateOnly(value: string, endOfDay = false): Date | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const date = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00` : trimmed);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && trimmed.length === 10) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

function defaultFromDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return date.toISOString().slice(0, 10);
}

function defaultToDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function lineCost(line: SaleLine): number {
  const qty = Number(line.cantidad ?? 0);
  const unit = Number(line.costoUnitario ?? 0);
  const personalization = Number(line.costoPersonalizacion ?? 0);
  const extras = (line.costosExtra ?? []).reduce(
    (sum, extra) => sum + Number(extra.costo ?? 0),
    0
  );
  return unit * qty + personalization + extras;
}

function lineFacturado(line: SaleLine): number {
  const subtotal = Number(line.subtotal ?? 0);
  if (subtotal > 0) return subtotal;
  return Number(line.precioUnitario ?? 0) * Number(line.cantidad ?? 0);
}

function monthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' });
}

function daysBetweenInclusive(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

function resolveGroupKey(
  groupBy: ReportGroupBy,
  sale: SaleRecord,
  line: SaleLine,
  stock: StockRecord | undefined
): { key: string; label: string; stockActual?: number; productoId?: string } {
  if (groupBy === 'client') {
    const id = sale.clienteId?.trim() || '__sin_cliente__';
    const label = sale.clienteNombre?.trim() || (id === '__sin_cliente__' ? 'Mostrador / sin cliente' : 'Cliente');
    return { key: id, label };
  }

  if (groupBy === 'category') {
    const label = stock?.categoria?.trim() || 'Sin categoría';
    return { key: normalize(label), label };
  }

  if (groupBy === 'type') {
    const label = stock?.tipo?.trim() || stock?.nombreBase?.trim() || line.nombre?.trim() || 'Sin tipo';
    return { key: normalize(label), label };
  }

  if (groupBy === 'size') {
    const label = stock?.talle?.trim() || 'Sin talle';
    return { key: normalize(label), label };
  }

  if (groupBy === 'color') {
    const label = stock?.color?.trim() || 'Sin color';
    return { key: normalize(label), label };
  }

  const productoId = line.stockItemId?.trim() || normalize(line.nombre);
  const label = line.nombre?.trim() || stock?.nombre?.trim() || 'Producto sin nombre';
  return {
    key: productoId || normalize(label),
    label,
    stockActual: Number(stock?.stockActual ?? 0),
    productoId: line.stockItemId?.trim() || undefined,
  };
}

function itemMatchesFilters(
  sale: SaleRecord,
  line: SaleLine,
  stock: StockRecord | undefined,
  filters: ReportFilters
): boolean {
  if (filters.clienteId && sale.clienteId !== filters.clienteId) return false;
  if (filters.productoId && line.stockItemId !== filters.productoId) return false;
  if (filters.categoria && normalize(stock?.categoria) !== normalize(filters.categoria)) return false;
  if (filters.tipo) {
    const tipo = stock?.tipo?.trim() || stock?.nombreBase?.trim() || '';
    if (normalize(tipo) !== normalize(filters.tipo)) return false;
  }
  if (filters.talle && normalize(stock?.talle) !== normalize(filters.talle)) return false;
  if (filters.color && normalize(stock?.color) !== normalize(filters.color)) return false;
  return true;
}

function saleInPeriod(sale: SaleRecord, from: Date, to: Date): boolean {
  if (!sale.fecha) return false;
  const date = new Date(sale.fecha);
  if (Number.isNaN(date.getTime())) return false;
  return date >= from && date <= to;
}

export function parseReportFilters(query: Record<string, unknown>): ReportFilters {
  const groupByRaw = String(query.groupBy ?? 'product');
  const groupBy: ReportGroupBy =
    groupByRaw === 'category' ||
    groupByRaw === 'type' ||
    groupByRaw === 'size' ||
    groupByRaw === 'color' ||
    groupByRaw === 'client'
      ? groupByRaw
      : 'product';

  return {
    from: String(query.from ?? defaultFromDate()).slice(0, 10),
    to: String(query.to ?? defaultToDate()).slice(0, 10),
    clienteId: String(query.clienteId ?? '').trim() || undefined,
    productoId: String(query.productoId ?? '').trim() || undefined,
    categoria: String(query.categoria ?? '').trim() || undefined,
    tipo: String(query.tipo ?? '').trim() || undefined,
    talle: String(query.talle ?? '').trim() || undefined,
    color: String(query.color ?? '').trim() || undefined,
    groupBy,
  };
}

export async function buildBusinessReport(
  businessId: string,
  filters: ReportFilters,
  options: { includeEconomics: boolean; includeCollaborators?: boolean }
): Promise<ReportResult> {
  const fromDate = parseDateOnly(filters.from) ?? parseDateOnly(defaultFromDate())!;
  const toDate = parseDateOnly(filters.to, true) ?? parseDateOnly(defaultToDate(), true)!;

  const [salesSnap, stockSnap, clientsSnap] = await Promise.all([
    db.collection(`negocios/${businessId}/ventas`).orderBy('fecha', 'desc').get(),
    db.collection(`negocios/${businessId}/stock`).get(),
    db.collection(`negocios/${businessId}/clientes`).get(),
  ]);

  const stockById = new Map<string, StockRecord>();
  stockSnap.docs.forEach((doc) => {
    stockById.set(doc.id, { id: doc.id, ...(doc.data() as Omit<StockRecord, 'id'>) });
  });

  const clientsById = new Map<string, ClientRecord>();
  clientsSnap.docs.forEach((doc) => {
    clientsById.set(doc.id, { id: doc.id, ...(doc.data() as Omit<ClientRecord, 'id'>) });
  });

  const sales: SaleRecord[] = salesSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<SaleRecord, 'id'>),
  }));

  const periodDays = daysBetweenInclusive(fromDate, toDate);
  const groupsMap = new Map<string, ReportGroupRow>();
  const monthlyMap = new Map<string, ReportMonthlyRow>();
  const clientProductsMap = new Map<string, ReportClientProductRow>();
  const clientSales: ReportClientSaleRow[] = [];
  const saleIdsInPeriod = new Set<string>();

  let unidadesVendidas = 0;
  let facturado = 0;
  let cobrado = 0;
  let costo = 0;
  let ganancia = 0;

  for (const sale of sales) {
    if (!saleInPeriod(sale, fromDate, toDate)) continue;

    const items = sale.items ?? [];
    const matchingItems = items.filter((line) =>
      itemMatchesFilters(sale, line, stockById.get(line.stockItemId ?? ''), filters)
    );
    if (matchingItems.length === 0) continue;

    saleIdsInPeriod.add(sale.id);

    const saleFacturadoItems = matchingItems.reduce((sum, line) => sum + lineFacturado(line), 0);
    const saleCostoItems = matchingItems.reduce((sum, line) => sum + lineCost(line), 0);
    const saleQtyItems = matchingItems.reduce((sum, line) => sum + Number(line.cantidad ?? 0), 0);

    const saleTotal = Number(sale.total ?? 0);
    const saleCostoReal = Number(sale.costoReal ?? 0);
    const saleGanancia = Number(sale.gananciaEstimada ?? 0);
    const ratio = saleTotal > 0 ? saleFacturadoItems / saleTotal : 1;

    unidadesVendidas += saleQtyItems;
    facturado += saleFacturadoItems;
    cobrado += Number(sale.montoCobrado ?? 0) * ratio;
    costo += saleCostoReal > 0 ? saleCostoReal * ratio : saleCostoItems;
    ganancia += saleGanancia !== 0 ? saleGanancia * ratio : saleFacturadoItems - saleCostoItems;

    if (filters.clienteId) {
      clientSales.push({
        id: sale.id,
        fecha: sale.fecha ?? '',
        ventaLabel: sale.ventaLabel ?? String(sale.numeroVenta ?? '').padStart(5, '0'),
        total: saleFacturadoItems,
        cantidadItems: saleQtyItems,
      });
    }

    const saleDate = sale.fecha ? new Date(sale.fecha) : null;
    const month = saleDate ? monthKey(saleDate) : 'unknown';

    for (const line of matchingItems) {
      const stock = stockById.get(line.stockItemId ?? '');
      const qty = Number(line.cantidad ?? 0);
      const lineFact = lineFacturado(line);
      const lineCosto = lineCost(line);
      const lineGan = lineFact - lineCosto;

      if (filters.clienteId) {
        const productoId = line.stockItemId?.trim() || normalize(line.nombre);
        const existing = clientProductsMap.get(productoId);
        if (existing) {
          existing.cantidad += qty;
          existing.facturado += lineFact;
        } else {
          clientProductsMap.set(productoId, {
            productoId,
            nombre: line.nombre?.trim() || stock?.nombre?.trim() || 'Producto',
            cantidad: qty,
            facturado: lineFact,
          });
        }
      }

      const groupInfo = resolveGroupKey(filters.groupBy, sale, line, stock);
      const group = groupsMap.get(groupInfo.key) ?? {
        key: groupInfo.key,
        label: groupInfo.label,
        cantidad: 0,
        facturado: 0,
        costo: 0,
        ganancia: 0,
        ventasCount: 0,
        stockActual: groupInfo.stockActual,
      };

      group.cantidad += qty;
      group.facturado += lineFact;
      group.costo += lineCosto;
      group.ganancia += lineGan;
      if (groupInfo.stockActual !== undefined) {
        group.stockActual = groupInfo.stockActual;
      }
      groupsMap.set(groupInfo.key, group);

      const monthRow = monthlyMap.get(month) ?? {
        periodo: month,
        label: monthLabel(month),
        cantidad: 0,
        facturado: 0,
        costo: 0,
        ganancia: 0,
        ventasCount: 0,
      };
      monthRow.cantidad += qty;
      monthRow.facturado += lineFact;
      monthRow.costo += lineCosto;
      monthRow.ganancia += lineGan;
      monthlyMap.set(month, monthRow);
    }
  }

  for (const sale of sales) {
    if (!saleInPeriod(sale, fromDate, toDate)) continue;
    const items = sale.items ?? [];
    const matchingItems = items.filter((line) =>
      itemMatchesFilters(sale, line, stockById.get(line.stockItemId ?? ''), filters)
    );
    if (matchingItems.length === 0) continue;

    const touchedGroups = new Set<string>();
    for (const line of matchingItems) {
      const stock = stockById.get(line.stockItemId ?? '');
      const groupInfo = resolveGroupKey(filters.groupBy, sale, line, stock);
      touchedGroups.add(groupInfo.key);
    }
    for (const key of touchedGroups) {
      const group = groupsMap.get(key);
      if (group) group.ventasCount += 1;
    }

    const saleDate = sale.fecha ? new Date(sale.fecha) : null;
    const month = saleDate ? monthKey(saleDate) : 'unknown';
    const monthRow = monthlyMap.get(month);
    if (monthRow) monthRow.ventasCount += 1;
  }

  const groups = [...groupsMap.values()]
    .map((group) => {
      const ventaDiariaPromedio = group.cantidad / periodDays;
      const stockSugeridoMes = ventaDiariaPromedio * 30;
      const stockActual = group.stockActual ?? 0;
      return {
        ...group,
        ventaDiariaPromedio,
        stockSugeridoMes,
        faltanteMes: Math.max(0, stockSugeridoMes - stockActual),
      };
    })
    .sort((a, b) => b.cantidad - a.cantidad || b.facturado - a.facturado);

  const monthlyTrend = [...monthlyMap.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));

  const trendMonths = monthlyTrend.length;
  const promedioMensual = {
    cantidad: trendMonths ? monthlyTrend.reduce((s, row) => s + row.cantidad, 0) / trendMonths : 0,
    facturado: trendMonths ? monthlyTrend.reduce((s, row) => s + row.facturado, 0) / trendMonths : 0,
    costo: trendMonths ? monthlyTrend.reduce((s, row) => s + row.costo, 0) / trendMonths : 0,
    ganancia: trendMonths ? monthlyTrend.reduce((s, row) => s + row.ganancia, 0) / trendMonths : 0,
    mesesConDatos: trendMonths,
  };

  const inactiveMap = new Map<string, ReportInactiveClientRow>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const sale of sales) {
    const clienteId = sale.clienteId?.trim();
    if (!clienteId) continue;
    const fecha = sale.fecha ? new Date(sale.fecha) : null;
    if (!fecha || Number.isNaN(fecha.getTime())) continue;

    const nombre =
      sale.clienteNombre?.trim() ||
      clientsById.get(clienteId)?.nombre?.trim() ||
      'Cliente';

    const existing = inactiveMap.get(clienteId);
    const total = Number(sale.total ?? 0);
    if (!existing) {
      inactiveMap.set(clienteId, {
        clienteId,
        nombre,
        ultimaCompra: sale.fecha ?? null,
        diasSinComprar: null,
        totalHistorico: total,
        ventasCount: 1,
      });
      continue;
    }

    existing.totalHistorico += total;
    existing.ventasCount += 1;
    if (!existing.ultimaCompra || fecha > new Date(existing.ultimaCompra)) {
      existing.ultimaCompra = sale.fecha ?? existing.ultimaCompra;
      existing.nombre = nombre;
    }
  }

  const inactiveClients = [...inactiveMap.values()]
    .map((row) => {
      const last = row.ultimaCompra ? new Date(row.ultimaCompra) : null;
      const diasSinComprar =
        last && !Number.isNaN(last.getTime())
          ? Math.floor((today.getTime() - last.getTime()) / 86_400_000)
          : null;
      return { ...row, diasSinComprar };
    })
    .sort((a, b) => (b.diasSinComprar ?? -1) - (a.diasSinComprar ?? -1));

  const ventasCount = saleIdsInPeriod.size;
  const summary: ReportSummary = {
    ventasCount,
    unidadesVendidas,
    facturado,
    cobrado,
    costo,
    ganancia,
    ticketPromedio: ventasCount ? facturado / ventasCount : 0,
  };

  if (!options.includeEconomics) {
    summary.costo = 0;
    summary.ganancia = 0;
    for (const group of groups) {
      group.costo = 0;
      group.ganancia = 0;
    }
    for (const row of monthlyTrend) {
      row.costo = 0;
      row.ganancia = 0;
    }
    promedioMensual.costo = 0;
    promedioMensual.ganancia = 0;
  }

  const result: ReportResult = {
    period: { from: filters.from, to: filters.to, days: periodDays },
    filters,
    summary,
    groups,
    monthlyTrend,
    promedioMensual,
    inactiveClients,
  };

  if (filters.clienteId) {
    const client = clientsById.get(filters.clienteId);
    const saleWithName = sales.find((s) => s.clienteId === filters.clienteId && s.clienteNombre?.trim());
    result.clientDetail = {
      clienteId: filters.clienteId,
      clienteNombre:
        client?.nombre?.trim() ||
        saleWithName?.clienteNombre?.trim() ||
        'Cliente',
      ventas: clientSales.sort((a, b) => b.fecha.localeCompare(a.fecha)),
      productos: [...clientProductsMap.values()].sort((a, b) => b.cantidad - a.cantidad),
    };
  }

  if (options.includeCollaborators) {
    result.collaboratorsSummary = await buildCollaboratorsPeriodSummary(
      businessId,
      filters.from,
      filters.to
    );
  }

  return result;
}
