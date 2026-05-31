export type MedioPagoComportamiento = 'caja_inmediata' | 'cuotas' | 'proveedor';

export type PurchaseLineTipo = 'stock' | 'insumo' | 'servicio' | 'personal';

export type PayableOrigenTipo = 'manual' | 'compra' | 'tarjeta';

export interface MedioPagoConfig {
  id: string;
  label: string;
  comportamiento: MedioPagoComportamiento;
  activo: boolean;
  /** Egreso inmediato en caja al registrar la compra. */
  generaEgresoCaja?: boolean;
  /** Cuotas u obligaciones en cuentas a pagar. */
  generaCuentasPagar?: boolean;
  /** Si genera cuentas a pagar, exige elegir una cuenta hija (tarjeta, crédito, etc.). */
  requiereCuentaHija?: boolean;
  /** Alias histórico de requiereCuentaHija. */
  requiereTarjeta?: boolean;
  sistema?: boolean;
}

export interface TarjetaConfig {
  id: string;
  label: string;
  emisor?: string;
  ambitoDefault: string;
  medioPagoId: string;
  diaCierre?: number;
  diaVencimiento?: number;
  activa: boolean;
}

export interface CategoriaGastoConfig {
  id: string;
  label: string;
  ambitoDefault: string;
  afectaReporteNegocio: boolean;
}

export const DEFAULT_MEDIOS_PAGO: MedioPagoConfig[] = [
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
    label: 'Transferencia / banco',
    comportamiento: 'caja_inmediata',
    generaEgresoCaja: true,
    generaCuentasPagar: false,
    activo: true,
    sistema: true,
  },
  {
    id: 'debito',
    label: 'Débito',
    comportamiento: 'caja_inmediata',
    generaEgresoCaja: true,
    generaCuentasPagar: false,
    activo: true,
    sistema: true,
  },
  {
    id: 'mercado_pago',
    label: 'Mercado Pago',
    comportamiento: 'caja_inmediata',
    generaEgresoCaja: true,
    generaCuentasPagar: false,
    activo: true,
    sistema: true,
  },
  {
    id: 'tarjeta_credito',
    label: 'Tarjeta de crédito',
    comportamiento: 'cuotas',
    generaEgresoCaja: false,
    generaCuentasPagar: true,
    requiereCuentaHija: true,
    requiereTarjeta: true,
    activo: true,
    sistema: true,
  },
  {
    id: 'credito',
    label: 'Crédito',
    comportamiento: 'cuotas',
    generaEgresoCaja: false,
    generaCuentasPagar: true,
    requiereCuentaHija: true,
    requiereTarjeta: true,
    activo: true,
    sistema: true,
  },
  {
    id: 'proveedor',
    label: 'Pendiente con proveedor',
    comportamiento: 'proveedor',
    generaEgresoCaja: false,
    generaCuentasPagar: true,
    requiereCuentaHija: false,
    requiereTarjeta: false,
    activo: true,
    sistema: true,
  },
];

export const DEFAULT_CATEGORIAS_GASTO: CategoriaGastoConfig[] = [
  {
    id: 'insumos_dtf',
    label: 'Insumos DTF',
    ambitoDefault: 'negocio',
    afectaReporteNegocio: true,
  },
  {
    id: 'sublimacion',
    label: 'Sublimación',
    ambitoDefault: 'negocio',
    afectaReporteNegocio: true,
  },
  {
    id: 'packaging',
    label: 'Packaging',
    ambitoDefault: 'negocio',
    afectaReporteNegocio: true,
  },
  {
    id: 'mantenimiento',
    label: 'Mantenimiento',
    ambitoDefault: 'negocio',
    afectaReporteNegocio: true,
  },
  {
    id: 'sueldos',
    label: 'Sueldos',
    ambitoDefault: 'negocio',
    afectaReporteNegocio: true,
  },
  {
    id: 'servicios_cloud',
    label: 'VPS / hosting / SaaS',
    ambitoDefault: 'negocio',
    afectaReporteNegocio: true,
  },
  {
    id: 'servicios_publicos',
    label: 'Luz / agua / gas',
    ambitoDefault: 'negocio',
    afectaReporteNegocio: true,
  },
  {
    id: 'alquiler',
    label: 'Alquiler',
    ambitoDefault: 'negocio',
    afectaReporteNegocio: true,
  },
  {
    id: 'gasto_personal',
    label: 'Gasto personal',
    ambitoDefault: 'personal',
    afectaReporteNegocio: false,
  },
];

export function syncMedioPagoFlags(medio: MedioPagoConfig): MedioPagoConfig {
  const generaEgresoCaja =
    medio.generaEgresoCaja ?? medio.comportamiento === 'caja_inmediata';
  const generaCuentasPagar =
    medio.generaCuentasPagar ??
    (medio.comportamiento === 'cuotas' || medio.comportamiento === 'proveedor');
  const requiereCuentaHija =
    generaCuentasPagar &&
    (medio.requiereCuentaHija === true ||
      medio.requiereTarjeta === true ||
      (medio.comportamiento === 'cuotas' && medio.requiereTarjeta !== false));

  let comportamiento = medio.comportamiento;
  if (medio.generaEgresoCaja != null || medio.generaCuentasPagar != null) {
    if (generaCuentasPagar) {
      comportamiento = requiereCuentaHija ? 'cuotas' : 'proveedor';
    } else if (generaEgresoCaja) {
      comportamiento = 'caja_inmediata';
    }
  }

  return {
    ...medio,
    generaEgresoCaja,
    generaCuentasPagar,
    requiereCuentaHija,
    requiereTarjeta: requiereCuentaHija,
    comportamiento,
  };
}

export function medioPagoGeneratesImmediateCash(medio?: MedioPagoConfig | null): boolean {
  if (!medio) return false;
  const synced = syncMedioPagoFlags(medio);
  return synced.generaEgresoCaja === true;
}

export function medioPagoGeneratesPayables(medio?: MedioPagoConfig | null): boolean {
  if (!medio) return false;
  const synced = syncMedioPagoFlags(medio);
  return synced.generaCuentasPagar === true;
}

export function medioPagoRequiereCuentaHija(medio?: MedioPagoConfig | null): boolean {
  if (!medio || !medioPagoGeneratesPayables(medio)) return false;
  const synced = syncMedioPagoFlags(medio);
  return synced.requiereCuentaHija === true;
}

export function purchaseLineAffectsStock(tipo: PurchaseLineTipo): boolean {
  return tipo === 'stock';
}
