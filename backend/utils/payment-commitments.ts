import { db } from '../firebase.ts';

export type CuotaCompromiso = {
  numero: number;
  monto: number;
  fechaVencimiento: string;
  estado: 'pendiente' | 'pagada';
  notas?: string;
};

export type CompromisoPagoInput = {
  cantidadCuotas: number;
  fechaPrimerVencimiento: string;
  notas?: string;
};

export function parseCompromisoInput(raw: unknown): CompromisoPagoInput | null {
  if (!raw || typeof raw !== 'object') return null;

  const data = raw as Record<string, unknown>;
  const cantidadCuotas = Number(data.cantidadCuotas) || 0;
  const fechaPrimerVencimiento = String(data.fechaPrimerVencimiento ?? '').trim();
  const notas = String(data.notas ?? '').trim();

  if (cantidadCuotas < 1 || !fechaPrimerVencimiento) return null;

  const parsed = new Date(`${fechaPrimerVencimiento}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;

  return {
    cantidadCuotas: Math.min(Math.round(cantidadCuotas), 24),
    fechaPrimerVencimiento: fechaPrimerVencimiento.slice(0, 10),
    notas: notas || undefined,
  };
}

export function buildCuotasPlan(montoTotal: number, input: CompromisoPagoInput): CuotaCompromiso[] {
  const total = Math.round(montoTotal * 100) / 100;
  const count = input.cantidadCuotas;
  const base = Math.floor((total / count) * 100) / 100;
  let remaining = total;
  const firstDate = new Date(`${input.fechaPrimerVencimiento}T12:00:00`);
  const cuotas: CuotaCompromiso[] = [];

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const monto = isLast ? Math.round(remaining * 100) / 100 : base;
    remaining = Math.round((remaining - monto) * 100) / 100;

    const fecha = new Date(firstDate);
    fecha.setMonth(fecha.getMonth() + i);

    cuotas.push({
      numero: i + 1,
      monto,
      fechaVencimiento: fecha.toISOString().slice(0, 10),
      estado: 'pendiente',
    });
  }

  return cuotas;
}

export async function createCompromisoPago(
  businessId: string,
  params: {
    clienteId: string;
    origenTipo: 'pedido' | 'venta';
    origenId: string;
    referenciaLabel: string;
    montoTotal: number;
    compromiso: CompromisoPagoInput;
    pedidoId?: string | null;
    ventaId?: string | null;
  }
): Promise<string> {
  const cuotas = buildCuotasPlan(params.montoTotal, params.compromiso);
  const saldoRestante = cuotas
    .filter((cuota) => cuota.estado === 'pendiente')
    .reduce((acc, cuota) => acc + cuota.monto, 0);

  const docRef = await db.collection(`negocios/${businessId}/compromisos_pago`).add({
    clienteId: params.clienteId,
    origenTipo: params.origenTipo,
    origenId: params.origenId,
    referenciaLabel: params.referenciaLabel,
    pedidoId: params.pedidoId ?? null,
    ventaId: params.ventaId ?? null,
    montoTotal: params.montoTotal,
    saldoRestante,
    cantidadCuotas: params.compromiso.cantidadCuotas,
    cuotas,
    notas: params.compromiso.notas ?? '',
    fecha: new Date().toISOString(),
    negocioId: businessId,
  });

  return docRef.id;
}
