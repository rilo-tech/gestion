export type MedioPagoComportamiento = 'caja_inmediata' | 'cuotas' | 'proveedor';

export type PurchaseLineTipo = 'stock' | 'insumo' | 'servicio' | 'personal';

export type PayableOrigenTipo = 'manual' | 'compra' | 'tarjeta' | 'prestamo';

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

export interface ConceptoIngresoConfig {
  id: string;
  label: string;
}

export const DEFAULT_CONCEPTOS_INGRESO: ConceptoIngresoConfig[] = [];

export function normalizeConceptosIngreso(raw: unknown): ConceptoIngresoConfig[] {
  if (!Array.isArray(raw)) return [];

  const byId = new Map<string, ConceptoIngresoConfig>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const label = String(obj.label ?? '').trim();
    if (!label) continue;
    const id = String(obj.id ?? label)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    if (!id) continue;
    byId.set(id, { id, label });
  }

  return [...byId.values()].sort((a, b) => a.label.localeCompare(b, 'es'));
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

const MEDIO_PAGO_ID_ALIASES: Record<string, string> = {
  tarjeta_de_credito: 'tarjeta_credito',
};

export function normalizeMedioPagoLookupId(id: string | undefined | null): string {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key) return '';
  return MEDIO_PAGO_ID_ALIASES[key] ?? key;
}

export function findTarjetaInConfig(
  tarjetas: TarjetaConfig[] | undefined,
  tarjetaId: string | undefined | null
): TarjetaConfig | undefined {
  const key = String(tarjetaId ?? '').trim().toLowerCase();
  if (!key) return undefined;
  return (tarjetas ?? []).find((tarjeta) => String(tarjeta.id ?? '').trim().toLowerCase() === key);
}

export function findMedioPagoInConfig(
  medios: MedioPagoConfig[] | undefined,
  medioPagoId: string | undefined | null
): MedioPagoConfig | undefined {
  const key = normalizeMedioPagoLookupId(medioPagoId);
  if (!key) return undefined;
  const list = medios ?? DEFAULT_MEDIOS_PAGO;
  return list.find((medio) => String(medio.id ?? '').trim().toLowerCase() === key);
}

export type PurchasePagoShape = {
  medioPagoId?: string;
  tarjetaId?: string;
  tarjetaLabel?: string;
  medioPagoLabel?: string;
  displayLabel?: string;
  cuotas?: number;
  fechaPrimerVencimiento?: string;
};

export function enrichPurchasePago(
  pago: PurchasePagoShape | undefined | null,
  finanzas: { mediosPago?: MedioPagoConfig[]; tarjetas?: TarjetaConfig[] }
): (PurchasePagoShape & { displayLabel: string }) | undefined {
  if (!pago) return undefined;

  const tarjeta = findTarjetaInConfig(finanzas.tarjetas, pago.tarjetaId);
  const medio = findMedioPagoInConfig(finanzas.mediosPago, pago.medioPagoId ?? 'efectivo');
  const syncedMedio = medio ? syncMedioPagoFlags(medio) : undefined;

  const tarjetaLabel = String(pago.tarjetaLabel ?? '').trim() || tarjeta?.label?.trim() || '';
  const medioPagoLabel =
    String(pago.medioPagoLabel ?? '').trim() || syncedMedio?.label?.trim() || '';

  const displayLabel = tarjetaLabel || medioPagoLabel || 'Efectivo';

  return {
    ...pago,
    tarjetaLabel: tarjetaLabel || undefined,
    medioPagoLabel: medioPagoLabel || undefined,
    displayLabel,
  };
}

export function resolvePurchasePagoDisplayLabel(
  pago: PurchasePagoShape | undefined | null,
  finanzas: { mediosPago?: MedioPagoConfig[]; tarjetas?: TarjetaConfig[] }
): string {
  return enrichPurchasePago(pago, finanzas)?.displayLabel ?? 'Efectivo';
}
