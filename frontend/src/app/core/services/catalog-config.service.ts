import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, tap } from 'rxjs';
import { TenantService } from './tenant.service';

import {
  CajaOrigen,
  DEFAULT_CAJA_ORIGENES,
  getCashOrigenes,
  getCashOrigenNombre,
  slugifyOrigenGrupo,
  CashOrigenGrupo,
} from '../constants/cash-origenes';
import {
  DEFAULT_STOCK_ORIGENES,
  DEFAULT_STOCK_TIPOS,
  StockOrigenMovimiento,
  StockTipoMovimiento,
} from '../constants/stock-movimientos';
import {
  DEFAULT_ORDER_ESTADOS,
  normalizeOrderPedidosConfig,
  orderEstadoMatchesStockTrigger,
  orderUsesReservedStock,
  getOrderStockTriggerOptions,
  getOrderWorkflowStatusOptions,
  getOrderStatusLabelFromConfig,
  validateOrderEstadoTransition,
  type OrderEstadoConfig,
  type OrderExtraCostPreset,
  type OrderPedidosConfigShape,
  type OrderStockMode,
} from '../constants/order-config';
import {
  DEFAULT_CATEGORIAS_GASTO,
  DEFAULT_MEDIOS_PAGO,
  type CategoriaGastoConfig,
  type MedioPagoComportamiento,
  type MedioPagoConfig,
  type PurchaseLineTipo,
  type TarjetaConfig,
  medioPagoGeneratesImmediateCash,
  medioPagoGeneratesPayables,
  medioPagoRequiereCuentaHija,
  syncMedioPagoFlags,
} from '../../../../../shared/finance-config.ts';
import {
  DEFAULT_COLLABORATOR_EXTRA_TIPOS,
  normalizeCollaboratorExtraTipos,
  resolveCollaboratorExtraTipoLabel,
  slugifyCollaboratorExtraTipoId,
  type CollaboratorExtraTipoConfig,
} from '../../../../../shared/collaborators-config.ts';
import {
  DEFAULT_PRODUCTOS_CODIGO_CONFIG,
  getPrefijoForCategoria,
  findCategoriaByPrefijo,
  findPrefijoOwnerForCodigo,
  validateUniquePrefijos,
  shouldAutoAssignProductCode,
  normalizeProductosCodigo,
  type ProductosCodigoConfig,
} from '../../../../../shared/product-code-config.ts';
import {
  DEFAULT_COMPROBANTES_CONFIG,
  getComprobantesDisponibles,
  hasComprobantesExtra,
  normalizeComprobanteTipo,
  type ComprobanteModulo,
  type ComprobanteTipoId,
  type ComprobanteTipoOption,
  type ComprobantesConfig,
} from '../../../../../shared/comprobantes-config.ts';

export type { OrderEstadoConfig, OrderExtraCostPreset, OrderPedidosConfigShape, OrderStockMode };
export {
  DEFAULT_ORDER_ESTADOS,
  normalizeOrderPedidosConfig,
  orderEstadoMatchesStockTrigger,
  orderUsesReservedStock,
  getOrderStockTriggerOptions,
  getOrderWorkflowStatusOptions,
  getOrderStatusLabelFromConfig,
  validateOrderEstadoTransition,
};

export type { ProductosCodigoConfig };
export {
  DEFAULT_PRODUCTOS_CODIGO_CONFIG,
  getPrefijoForCategoria,
  findCategoriaByPrefijo,
  findPrefijoOwnerForCodigo,
  validateUniquePrefijos,
  shouldAutoAssignProductCode,
  normalizeProductosCodigo,
};
export { DEFAULT_CAJA_ORIGENES, getCashOrigenes, getCashOrigenNombre, slugifyOrigenGrupo };
export type { StockOrigenMovimiento, StockTipoMovimiento };
export { DEFAULT_STOCK_ORIGENES, DEFAULT_STOCK_TIPOS };

export type {
  CategoriaGastoConfig,
  MedioPagoComportamiento,
  MedioPagoConfig,
  PurchaseLineTipo,
  TarjetaConfig,
};
export {
  DEFAULT_CATEGORIAS_GASTO,
  DEFAULT_MEDIOS_PAGO,
  medioPagoGeneratesImmediateCash,
  medioPagoGeneratesPayables,
  medioPagoRequiereCuentaHija,
  syncMedioPagoFlags,
};

export type ConfigRemovalKind =
  | 'clientes.etiquetas'
  | 'proveedores.etiquetas'
  | 'productos.categorias'
  | 'productos.talles'
  | 'productos.colores'
  | 'caja.conceptos'
  | 'caja.ambitos'
  | 'caja.origenes'
  | 'stock.origenes'
  | 'finanzas.categoriasGasto'
  | 'finanzas.mediosPago'
  | 'finanzas.tarjetas'
  | 'colaboradores.tiposExtra';

export interface ConfigUsageHit {
  module: string;
  label: string;
  count: number;
}

export interface ConfigUsageCheckResponse {
  usage: ConfigUsageHit[];
  inUse: boolean;
}

export type ConfigFieldKey =
  | 'productos.categorias'
  | 'productos.talles'
  | 'productos.colores'
  | 'clientes.etiquetas'
  | 'proveedores.etiquetas';

export type FieldInputMode = 'lista' | 'texto';

export type CajaConceptoTipo = 'ingreso' | 'egreso' | 'ambos';

export interface CajaConcepto {
  nombre: string;
  tipo: CajaConceptoTipo;
}

export interface AppConfig {
  productos: {
    tipos: string[];
    categorias: string[];
    talles: string[];
    colores: string[];
    modo: {
      tipos: FieldInputMode;
      categorias: FieldInputMode;
      talles: FieldInputMode;
      colores: FieldInputMode;
    };
    codigo: ProductosCodigoConfig;
  };
  clientes: {
    etiquetas: string[];
    modo: {
      etiquetas: FieldInputMode;
    };
  };
  proveedores: {
    etiquetas: string[];
    modo: {
      etiquetas: FieldInputMode;
    };
  };
  caja: {
    conceptos: CajaConcepto[];
    origenes: CajaOrigen[];
    ambitos: CajaAmbitoConfig[];
    modo: {
      conceptos: FieldInputMode;
    };
  };
  pedidos: {
    costosPersonalizacionDetallados: boolean;
    impresionDosVias: boolean;
    impresionDosViasHorizontal: boolean;
    impresionCasillasProductos: boolean;
    estados: OrderEstadoConfig[];
    modoStock: OrderStockMode;
    estadoDescuentaStock: string;
    descuentoFisicoPorEstado?: Partial<Record<string, import('../constants/order-config').OrderPhysicalStockScope>>;
    permitirElegirAlcanceDescuento?: boolean;
    estadosExigenStockCompleto?: string[];
    costosExtraPredeterminados: OrderExtraCostPreset[];
    /** Si es true (default), pedidos y descuentos pueden dejar stock negativo. */
    permitirStockNegativo: boolean;
  };
  stock: {
    tipos: StockTipoMovimiento[];
    origenes: StockOrigenMovimiento[];
  };
  finanzas: {
    mediosPago: MedioPagoConfig[];
    tarjetas: TarjetaConfig[];
    categoriasGasto: CategoriaGastoConfig[];
  };
  colaboradores: {
    tiposExtra: CollaboratorExtraTipoConfig[];
  };
  comprobantes: ComprobantesConfig;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  productos: {
    tipos: [],
    categorias: [],
    talles: [],
    colores: [],
    modo: {
      tipos: 'texto',
      categorias: 'texto',
      talles: 'texto',
      colores: 'texto',
    },
    codigo: { ...DEFAULT_PRODUCTOS_CODIGO_CONFIG },
  },
  clientes: {
    etiquetas: [],
    modo: { etiquetas: 'texto' },
  },
  proveedores: {
    etiquetas: [],
    modo: { etiquetas: 'texto' },
  },
  caja: {
    conceptos: [],
    origenes: [...DEFAULT_CAJA_ORIGENES],
    ambitos: [
      {
        id: 'negocio',
        label: 'Negocio',
        sistema: true,
      },
    ],
    modo: {
      conceptos: 'texto',
    },
  },
  pedidos: {
    costosPersonalizacionDetallados: true,
    impresionDosVias: false,
    impresionDosViasHorizontal: false,
    impresionCasillasProductos: false,
    estados: [...DEFAULT_ORDER_ESTADOS],
    modoStock: 'reservado',
    estadoDescuentaStock: 'en_produccion',
    costosExtraPredeterminados: [],
    permitirStockNegativo: true,
  },
  stock: {
    tipos: [...DEFAULT_STOCK_TIPOS],
    origenes: [...DEFAULT_STOCK_ORIGENES],
  },
  finanzas: {
    mediosPago: [...DEFAULT_MEDIOS_PAGO],
    tarjetas: [],
    categoriasGasto: [...DEFAULT_CATEGORIAS_GASTO],
  },
  colaboradores: {
    tiposExtra: DEFAULT_COLLABORATOR_EXTRA_TIPOS.map((item) => ({ ...item })),
  },
  comprobantes: { ...DEFAULT_COMPROBANTES_CONFIG },
};

export type {
  CollaboratorExtraTipoConfig,
  ComprobanteModulo,
  ComprobanteTipoId,
  ComprobanteTipoOption,
  ComprobantesConfig,
};
export { normalizeComprobanteTipo };
export {
  DEFAULT_COLLABORATOR_EXTRA_TIPOS,
  normalizeCollaboratorExtraTipos,
  resolveCollaboratorExtraTipoLabel,
  slugifyCollaboratorExtraTipoId,
};

export function getCollaboratorExtraTipos(config: AppConfig): CollaboratorExtraTipoConfig[] {
  return normalizeCollaboratorExtraTipos(config.colaboradores?.tiposExtra);
}

export function getCollaboratorExtraTipoLabel(config: AppConfig, id?: string): string {
  return resolveCollaboratorExtraTipoLabel(getCollaboratorExtraTipos(config), id);
}

export { buildProductDisplayName, inferNombreBase } from '../../../../../shared/product-display-name.ts';

export function getFieldValues(config: AppConfig, key: ConfigFieldKey): string[] {
  const [module, field] = key.split('.') as [keyof AppConfig, string];
  return [...((config[module] as Record<string, string[]>)[field] ?? [])];
}

export function getFieldMode(config: AppConfig, key: ConfigFieldKey): FieldInputMode {
  const [module, field] = key.split('.') as [keyof AppConfig, string];
  const values = getFieldValues(config, key);
  const stored = (config[module] as { modo?: Record<string, FieldInputMode> })?.modo?.[field];
  if (stored === 'lista' && values.length > 0) return 'lista';
  if (stored === 'texto') return 'texto';
  return values.length > 0 ? 'lista' : 'texto';
}

export function getFieldOptions(config: AppConfig, key: ConfigFieldKey): string[] {
  return getFieldMode(config, key) === 'lista' ? getFieldValues(config, key) : [];
}

export function usesConfigurableList(config: AppConfig, key: ConfigFieldKey): boolean {
  return getFieldMode(config, key) === 'lista';
}

export function usesDetailedOrderExtraCosts(config: AppConfig): boolean {
  return config.pedidos?.costosPersonalizacionDetallados !== false;
}

export function usesOrderPrintDualCopy(config: AppConfig): boolean {
  return config.pedidos?.impresionDosVias === true;
}

/** Una sola vía: A4 apaisado solo si está activado en configuración. */
export function usesOrderPrintSingleLandscape(config: AppConfig): boolean {
  return (
    !usesOrderPrintDualCopy(config) && config.pedidos?.impresionDosViasHorizontal === true
  );
}

/** Hoja apaisada al imprimir (solo una vía con la opción activada). */
export function usesOrderPrintLandscapeSheet(config: AppConfig): boolean {
  return usesOrderPrintSingleLandscape(config);
}

export function usesOrderPrintLineCheckboxes(config: AppConfig): boolean {
  return config.pedidos?.impresionCasillasProductos === true;
}

export function getOrderPedidosSettings(config: AppConfig) {
  return normalizeOrderPedidosConfig(config.pedidos);
}

export function orderConfigUsesReservedStock(config: AppConfig = DEFAULT_APP_CONFIG): boolean {
  return orderUsesReservedStock(config.pedidos);
}

export function usesCashConceptList(config: AppConfig): boolean {
  return config.caja?.modo?.conceptos === 'lista' && (config.caja?.conceptos?.length ?? 0) > 0;
}

/** Opciones de egreso definidas solo en Caja (legacy), sin depender del modo lista. */
function getLegacyCajaEgresoConceptNames(config: AppConfig): string[] {
  return (config.caja?.conceptos ?? [])
    .filter(
      (concepto) => concepto.tipo === 'egreso' || concepto.tipo === 'ambos'
    )
    .map((concepto) => concepto.nombre.trim())
    .filter((nombre) => nombre.length > 0);
}

export function findCategoriaGastoByLabel(
  config: AppConfig,
  label: string
): CategoriaGastoConfig | undefined {
  const key = label.trim().toLowerCase();
  if (!key) return undefined;
  return getCategoriasGasto(config).find((c) => c.label.trim().toLowerCase() === key);
}

export function resolveCategoriaIdForCashConcept(
  config: AppConfig,
  movementTipo: 'ingreso' | 'egreso',
  concepto: string
): string | undefined {
  if (movementTipo !== 'egreso') return undefined;
  return findCategoriaGastoByLabel(config, concepto)?.id;
}

/**
 * Conceptos del popup de Caja: ingresos desde lista de Caja; egresos desde categorías de Finanzas
 * más conceptos de egreso legacy en Caja.
 */
export function getCashMovementConceptOptions(
  config: AppConfig,
  movementTipo: 'ingreso' | 'egreso'
): string[] {
  if (movementTipo === 'egreso') {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const cat of getCategoriasGasto(config)) {
      const label = cat.label.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(label);
    }
    for (const nombre of getLegacyCajaEgresoConceptNames(config)) {
      const key = nombre.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(nombre);
    }
    return merged.sort((a, b) => a.localeCompare(b, 'es'));
  }
  return getCashConceptOptions(config, 'ingreso');
}

export function usesCashMovementConceptPicker(
  config: AppConfig,
  movementTipo: 'ingreso' | 'egreso'
): boolean {
  return getCashMovementConceptOptions(config, movementTipo).length > 0;
}

export type CashAmbito = string;

export type { CajaAmbitoConfig } from '../constants/caja-ambitos';

import {
  normalizeCajaAmbitos,
  type CajaAmbitoConfig,
} from '../constants/caja-ambitos';

export {
  BUSINESS_CASH_AMBITO_ID,
  DEFAULT_BUSINESS_CASH_AMBITO_LABEL,
  DEFAULT_CASH_AMBITO_ID,
  isSystemCashAmbito,
  normalizeCajaAmbitos,
  getBusinessCashAmbitoId,
  getDefaultCashAmbitoId,
  usesCashAmbitoSeparation,
  resolveCashAmbito,
  getCashAmbitoLabel,
} from '../constants/caja-ambitos';

export function slugifyCajaAmbitoId(label: string): string {
  return slugifyOrigenGrupo(label);
}

export function getCajaAmbitos(config: AppConfig): CajaAmbitoConfig[] {
  return normalizeCajaAmbitos(config.caja ?? {});
}

export function getMediosPagoActivos(config: AppConfig): MedioPagoConfig[] {
  return (config.finanzas?.mediosPago ?? DEFAULT_MEDIOS_PAGO).filter((m) => m.activo !== false);
}

export function getTarjetasActivas(config: AppConfig): TarjetaConfig[] {
  return (config.finanzas?.tarjetas ?? []).filter((t) => t.activa !== false);
}

export function getComprobantesActivos(
  config: AppConfig,
  modulo: ComprobanteModulo
): ComprobanteTipoOption[] {
  return getComprobantesDisponibles(config.comprobantes, modulo);
}

export function usesComprobantesExtra(config: AppConfig): boolean {
  return hasComprobantesExtra(config.comprobantes);
}

export function getCategoriasGasto(config: AppConfig): CategoriaGastoConfig[] {
  return config.finanzas?.categoriasGasto ?? DEFAULT_CATEGORIAS_GASTO;
}

export function getMedioPagoConfig(
  config: AppConfig,
  medioPagoId: string
): MedioPagoConfig | undefined {
  const raw = getMediosPagoActivos(config).find((m) => m.id === medioPagoId);
  return raw ? syncMedioPagoFlags(raw) : undefined;
}

export function getMediosPagoConCuentaHija(config: AppConfig): MedioPagoConfig[] {
  return getMediosPagoActivos(config).filter((medio) => medioPagoRequiereCuentaHija(medio));
}

export function getTarjetasForMedio(config: AppConfig, medioPagoId: string): TarjetaConfig[] {
  const key = medioPagoId.trim().toLowerCase();
  if (!key) return [];
  return getTarjetasActivas(config).filter(
    (tarjeta) => String(tarjeta.medioPagoId ?? '').trim().toLowerCase() === key
  );
}

export function getCashConceptOptions(
  config: AppConfig,
  movementTipo: 'ingreso' | 'egreso'
): string[] {
  if (!usesCashConceptList(config)) return [];

  return (config.caja.conceptos ?? [])
    .filter(
      (concepto) =>
        concepto.tipo === 'ambos' ||
        (movementTipo === 'ingreso' && concepto.tipo === 'ingreso') ||
        (movementTipo === 'egreso' && concepto.tipo === 'egreso')
    )
    .map((concepto) => concepto.nombre)
    .sort((a, b) => a.localeCompare(b, 'es'));
}

export function getCajaConceptoTipoLabel(tipo: CajaConceptoTipo): string {
  if (tipo === 'ingreso') return 'Ingreso';
  if (tipo === 'egreso') return 'Egreso';
  return 'Ambos';
}

@Injectable({
  providedIn: 'root',
})
export class CatalogConfigService {
  private http = inject(HttpClient);
  private tenant = inject(TenantService);
  private appConfigSubject = new BehaviorSubject<AppConfig>(
    structuredClone(DEFAULT_APP_CONFIG)
  );

  private get businessId(): string {
    return this.tenant.businessId;
  }

  readonly appConfig$ = this.appConfigSubject.asObservable();

  get appConfig(): AppConfig {
    return this.appConfigSubject.value;
  }

  getAppConfig(): Observable<AppConfig> {
    return this.http
      .get<AppConfig>(`/api/config/${this.businessId}`)
      .pipe(tap((config) => this.appConfigSubject.next(config)));
  }

  updateAppConfig(
    config: AppConfig,
    options?: {
      confirmConfigRemovals?: boolean;
      renameCategoria?: { from: string; to: string };
      renameTalle?: { from: string; to: string };
      renameColor?: { from: string; to: string };
      regenerateCodigosCategoria?: string;
    }
  ): Observable<AppConfig> {
    const body = {
      ...config,
      confirmConfigRemovals: options?.confirmConfigRemovals ?? false,
      ...(options?.renameCategoria ? { renameCategoria: options.renameCategoria } : {}),
      ...(options?.renameTalle ? { renameTalle: options.renameTalle } : {}),
      ...(options?.renameColor ? { renameColor: options.renameColor } : {}),
      ...(options?.regenerateCodigosCategoria
        ? { regenerateCodigosCategoria: options.regenerateCodigosCategoria }
        : {}),
    };
    return this.http
      .patch<AppConfig>(`/api/config/${this.businessId}`, body)
      .pipe(tap((config) => this.appConfigSubject.next(config)));
  }

  checkConfigUsage(
    kind: ConfigRemovalKind,
    value: string
  ): Observable<ConfigUsageCheckResponse> {
    return this.http.post<ConfigUsageCheckResponse>(
      `/api/config/${this.businessId}/usage-check`,
      { kind, value }
    );
  }

  getFieldOptions(config: AppConfig, key: ConfigFieldKey): string[] {
    return getFieldOptions(config, key);
  }

  usesConfigurableList(config: AppConfig, key: ConfigFieldKey): boolean {
    return usesConfigurableList(config, key);
  }

  usesDetailedOrderExtraCosts(config: AppConfig = this.appConfigSubject.value): boolean {
    return usesDetailedOrderExtraCosts(config);
  }

  usesOrderPrintDualCopy(config: AppConfig = this.appConfigSubject.value): boolean {
    return usesOrderPrintDualCopy(config);
  }

  usesOrderPrintSingleLandscape(config: AppConfig = this.appConfigSubject.value): boolean {
    return usesOrderPrintSingleLandscape(config);
  }

  usesOrderPrintLandscapeSheet(config: AppConfig = this.appConfigSubject.value): boolean {
    return usesOrderPrintLandscapeSheet(config);
  }

  usesOrderPrintLineCheckboxes(config: AppConfig = this.appConfigSubject.value): boolean {
    return usesOrderPrintLineCheckboxes(config);
  }

  orderUsesReservedStock(config: AppConfig = this.appConfigSubject.value): boolean {
    return orderConfigUsesReservedStock(config);
  }

  getOrderPedidosSettings(config: AppConfig = this.appConfigSubject.value) {
    return getOrderPedidosSettings(config);
  }

  ensureFieldOptions(key: ConfigFieldKey, values: string[]): Observable<AppConfig> {
    const current = this.appConfigSubject.value;
    const existing = getFieldValues(current, key);
    const existingLower = new Set(existing.map((value) => value.toLowerCase()));
    const toAdd = values
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => !existingLower.has(value.toLowerCase()));

    if (toAdd.length === 0) {
      return of(current);
    }

    const merged = [...existing, ...toAdd].sort((a, b) => a.localeCompare(b, 'es'));
    const updated = structuredClone(current);
    const [module, field] = key.split('.') as [keyof AppConfig, string];
    (updated[module] as Record<string, string[]>)[field] = merged;
    (updated[module] as { modo: Record<string, FieldInputMode> }).modo[field] = 'lista';

    return this.updateAppConfig(updated);
  }
}
