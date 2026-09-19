import type { CategoriaGastoConfig, ConceptoIngresoConfig, MedioPagoConfig } from './finance-config.ts';

/** Categorías de egreso orientadas a RILO Caja (billetera). */
export const CASH_DEFAULT_CATEGORIAS_GASTO: CategoriaGastoConfig[] = [
  { id: 'mercaderia', label: 'Mercadería / Compras', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'insumos', label: 'Insumos', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'servicios', label: 'Servicios', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'transporte', label: 'Transporte / Envíos', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'alquiler', label: 'Alquiler', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'impuestos', label: 'Impuestos / Comisiones', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'sueldos', label: 'Sueldos / Pagos a terceros', ambitoDefault: 'negocio', afectaReporteNegocio: true },
  { id: 'personal', label: 'Gastos personales / Retiros', ambitoDefault: 'personal', afectaReporteNegocio: false },
  { id: 'otros_egresos', label: 'Otros gastos', ambitoDefault: 'negocio', afectaReporteNegocio: true },
];

/** Conceptos / categorías de ingreso para RILO Caja. */
export const CASH_DEFAULT_CONCEPTOS_INGRESO: ConceptoIngresoConfig[] = [
  { id: 'ventas_cobros', label: 'Ventas / Cobros' },
  { id: 'servicios_trabajos', label: 'Servicios / Trabajos' },
  { id: 'sueldo_honorarios', label: 'Sueldo / Honorarios' },
  { id: 'transferencias_recibidas', label: 'Transferencias recibidas' },
  { id: 'reintegros', label: 'Reintegros / Devoluciones' },
  { id: 'otros_ingresos', label: 'Otros ingresos' },
];

/** Medios de pago simples para RILO Caja (sin cuotas/proveedor). */
export const CASH_DEFAULT_MEDIOS_PAGO: MedioPagoConfig[] = [
  {
    id: 'efectivo',
    label: 'Efectivo',
    comportamiento: 'caja_inmediata',
    generaEgresoCaja: true,
    generaCuentasPagar: false,
    activo: true,
    sistema: true,
  },
  {
    id: 'transferencia',
    label: 'Transferencia',
    comportamiento: 'caja_inmediata',
    generaEgresoCaja: true,
    generaCuentasPagar: false,
    activo: true,
    sistema: true,
  },
  {
    id: 'mercadopago',
    label: 'Mercado Pago',
    comportamiento: 'caja_inmediata',
    generaEgresoCaja: true,
    generaCuentasPagar: false,
    activo: true,
    sistema: true,
  },
  {
    id: 'tarjeta',
    label: 'Tarjeta',
    comportamiento: 'caja_inmediata',
    generaEgresoCaja: true,
    generaCuentasPagar: false,
    activo: true,
    sistema: true,
  },
];

/** Heurística simple para sugerir categoría desde texto libre (sin IA). */
export function suggestCashCategoryFromText(
  tipo: 'ingreso' | 'egreso',
  text: string
): { id: string; label: string } | null {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (tipo === 'egreso') {
    if (/nafta|combustible|uber|envio|flete|transporte|taxi/.test(t)) {
      return { id: 'transporte', label: 'Transporte / Envíos' };
    }
    if (/luz|agua|gas|internet|telefono|servicio/.test(t)) {
      return { id: 'servicios', label: 'Servicios' };
    }
    if (/alquiler|renta/.test(t)) return { id: 'alquiler', label: 'Alquiler' };
    if (/impuesto|comision|iva|bps/.test(t)) {
      return { id: 'impuestos', label: 'Impuestos / Comisiones' };
    }
    if (/sueldo|salario|pago a|honorario/.test(t)) {
      return { id: 'sueldos', label: 'Sueldos / Pagos a terceros' };
    }
    if (/personal|retiro|casa|supermercado/.test(t)) {
      return { id: 'personal', label: 'Gastos personales / Retiros' };
    }
    if (/compra|mercader|stock|insumo/.test(t)) {
      return { id: 'mercaderia', label: 'Mercadería / Compras' };
    }
    return { id: 'otros_egresos', label: 'Otros gastos' };
  }
  if (/venta|cobr|cliente/.test(t)) return { id: 'ventas_cobros', label: 'Ventas / Cobros' };
  if (/trabajo|servicio|cliente|proyecto/.test(t)) {
    return { id: 'servicios_trabajos', label: 'Servicios / Trabajos' };
  }
  if (/sueldo|honorario|salario/.test(t)) {
    return { id: 'sueldo_honorarios', label: 'Sueldo / Honorarios' };
  }
  if (/transfer|deposito|recib/.test(t)) {
    return { id: 'transferencias_recibidas', label: 'Transferencias recibidas' };
  }
  if (/reintegro|devoluc/.test(t)) return { id: 'reintegros', label: 'Reintegros / Devoluciones' };
  return { id: 'otros_ingresos', label: 'Otros ingresos' };
}
