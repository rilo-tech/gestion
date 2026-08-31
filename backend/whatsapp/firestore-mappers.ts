/**
 * Documentos de Firestore para pedidos/cobros/caja de RiloBot.
 * Nunca persiste `undefined`. El modelo de ítem del ERP usa `costosExtra: []`.
 */

export type FirestoreOrderPayment = {
  id: string;
  tipo: 'seña' | 'cuota' | 'pago';
  monto: number;
  fecha: string;
  movimientoCajaId?: string;
  notas?: string;
};

export type FirestoreOrderItem = {
  stockItemId: string;
  nombre: string;
  cantidad: number;
  precioVenta: number;
  costoUnitario: number;
  precioUnitario?: number;
  subtotal?: number;
  tipoLinea?: 'producto' | 'concepto';
  mueveStock?: boolean;
  controlaStock?: boolean;
  costosExtra: Array<{ nombre: string; costo: number }>;
  costoPersonalizacion: number;
};

export type FirestoreCashMovement = {
  tipo: 'ingreso' | 'egreso';
  monto: number;
  medio: string;
  concepto: string;
  ambito: string | null;
  fecha: string;
  origenId: string;
  origenTipo: string;
  origenGrupo: string;
  pedidoId: string | null;
  ventaId: string | null;
  ventaLabel: string | null;
  numeroPedido: number | null;
  numeroPedidoLabel: string | null;
  clienteId: string | null;
  negocioId: string;
};

export function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) return value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === undefined) continue;
    out[key] = stripUndefinedDeep(nested);
  }
  return out as T;
}

export function findUndefinedPaths(value: unknown, prefix = ''): string[] {
  if (value === undefined) return [prefix || '(root)'];
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findUndefinedPaths(item, `${prefix}[${index}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    findUndefinedPaths(nested, prefix ? `${prefix}.${key}` : key)
  );
}

export function assertNoUndefinedDeep(value: unknown, label = 'document'): void {
  const paths = findUndefinedPaths(value);
  if (paths.length) {
    throw new Error(`${label} contains undefined at ${paths.join(', ')}`);
  }
}

export function toFirestoreOrderItem(line: {
  stockItemId?: string | null;
  nombre?: string | null;
  cantidad?: number | null;
  precioVenta?: number | null;
  costoUnitario?: number | null;
  precioUnitario?: number | null;
  subtotal?: number | null;
  tipoLinea?: 'producto' | 'concepto' | null;
  mueveStock?: boolean | null;
  controlaStock?: boolean | null;
  costosExtra?: Array<{ nombre?: string; costo?: number }> | null;
  costoPersonalizacion?: number | null;
}): FirestoreOrderItem {
  const qty = Math.max(1, Number(line.cantidad) || 1);
  const extras = Array.isArray(line.costosExtra)
    ? line.costosExtra
        .map((extra) => ({
          nombre: String(extra?.nombre ?? '').trim() || 'Costo extra',
          costo: Number(extra?.costo) || 0,
        }))
        .filter((extra) => extra.costo > 0 || extra.nombre)
    : [];
  const mapped: FirestoreOrderItem = {
    stockItemId: String(line.stockItemId ?? '').trim(),
    nombre: String(line.nombre ?? '').trim() || 'Concepto',
    cantidad: qty,
    precioVenta: Number(line.precioVenta) || 0,
    costoUnitario: Number(line.costoUnitario) || 0,
    costosExtra: extras,
    costoPersonalizacion: Number(line.costoPersonalizacion) || extras.reduce((sum, extra) => sum + extra.costo, 0) * qty,
  };
  if (line.precioUnitario != null) mapped.precioUnitario = Number(line.precioUnitario) || 0;
  if (line.subtotal != null) mapped.subtotal = Number(line.subtotal) || 0;
  if (line.tipoLinea === 'producto' || line.tipoLinea === 'concepto') mapped.tipoLinea = line.tipoLinea;
  if (typeof line.mueveStock === 'boolean') mapped.mueveStock = line.mueveStock;
  if (typeof line.controlaStock === 'boolean') mapped.controlaStock = line.controlaStock;
  return mapped;
}

export function toFirestorePayment(pago: FirestoreOrderPayment): Record<string, unknown> {
  const clean: Record<string, unknown> = {
    id: pago.id,
    tipo: pago.tipo,
    monto: Number(pago.monto) || 0,
    fecha: String(pago.fecha ?? ''),
  };
  if (pago.movimientoCajaId) clean.movimientoCajaId = pago.movimientoCajaId;
  if (pago.notas) clean.notas = pago.notas;
  return clean;
}

export function toFirestoreCashMovement(input: FirestoreCashMovement): FirestoreCashMovement {
  return {
    tipo: input.tipo,
    monto: Number(input.monto) || 0,
    medio: String(input.medio ?? 'efectivo').trim() || 'efectivo',
    concepto: String(input.concepto ?? '').trim() || 'Movimiento',
    ambito: input.ambito ?? null,
    fecha: String(input.fecha ?? new Date().toISOString()),
    origenId: String(input.origenId ?? ''),
    origenTipo: String(input.origenTipo ?? ''),
    origenGrupo: String(input.origenGrupo ?? 'pedido'),
    pedidoId: input.pedidoId ?? null,
    ventaId: input.ventaId ?? null,
    ventaLabel: input.ventaLabel ?? null,
    numeroPedido: input.numeroPedido ?? null,
    numeroPedidoLabel: input.numeroPedidoLabel ?? null,
    clienteId: input.clienteId ?? null,
    negocioId: String(input.negocioId ?? ''),
  };
}

export function toFirestoreOrder(input: {
  clienteId: string;
  clienteNombre: string;
  descripcion: string;
  estado: string;
  fechaEntrega: string;
  items: FirestoreOrderItem[];
  total: number;
  costoReal: number;
  gananciaEstimada: number;
  numeroPedido: number;
  numeroPedidoLabel: string;
  esDonacion: boolean;
  senia: number;
  totalPagado: number;
  saldo: number;
  pagos: Record<string, unknown>[];
  seniaBloqueada: boolean;
  stockDescontado: boolean;
  stockPreparado: boolean;
  estadoStock: string;
  fotos: unknown[];
  origenWhatsapp: boolean;
  whatsappPhone: string;
  negocioId: string;
  createdAt: string;
}): Record<string, unknown> {
  const doc = {
    clienteId: input.clienteId,
    clienteNombre: input.clienteNombre,
    descripcion: input.descripcion,
    estado: input.estado,
    fechaEntrega: input.fechaEntrega,
    items: input.items.map(toFirestoreOrderItem),
    total: Number(input.total) || 0,
    costoReal: Number(input.costoReal) || 0,
    gananciaEstimada: Number(input.gananciaEstimada) || 0,
    numeroPedido: input.numeroPedido,
    numeroPedidoLabel: input.numeroPedidoLabel,
    esDonacion: Boolean(input.esDonacion),
    senia: Number(input.senia) || 0,
    totalPagado: Number(input.totalPagado) || 0,
    saldo: Number(input.saldo) || 0,
    pagos: input.pagos.map((pago) => stripUndefinedDeep(pago)),
    seniaBloqueada: Boolean(input.seniaBloqueada),
    stockDescontado: Boolean(input.stockDescontado),
    stockPreparado: Boolean(input.stockPreparado),
    estadoStock: input.estadoStock,
    fotos: Array.isArray(input.fotos) ? input.fotos : [],
    origenWhatsapp: Boolean(input.origenWhatsapp),
    whatsappPhone: input.whatsappPhone,
    negocioId: input.negocioId,
    createdAt: input.createdAt,
  };
  const clean = stripUndefinedDeep(doc);
  assertNoUndefinedDeep(clean, 'pedido');
  return clean as Record<string, unknown>;
}
