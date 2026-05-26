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
  type OrderEstadoConfig,
  type OrderPedidosConfigShape,
  type OrderStockMode,
} from '../constants/order-config';

export type { OrderEstadoConfig, OrderPedidosConfigShape, OrderStockMode };
export {
  DEFAULT_ORDER_ESTADOS,
  normalizeOrderPedidosConfig,
  orderEstadoMatchesStockTrigger,
  orderUsesReservedStock,
  getOrderStockTriggerOptions,
  getOrderWorkflowStatusOptions,
  getOrderStatusLabelFromConfig,
};

export type { CajaOrigen, CashOrigenGrupo };
export { DEFAULT_CAJA_ORIGENES, getCashOrigenes, getCashOrigenNombre, slugifyOrigenGrupo };
export type { StockOrigenMovimiento, StockTipoMovimiento };
export { DEFAULT_STOCK_ORIGENES, DEFAULT_STOCK_TIPOS };

export type ConfigRemovalKind =
  | 'clientes.etiquetas'
  | 'proveedores.etiquetas'
  | 'productos.categorias'
  | 'productos.talles'
  | 'productos.colores'
  | 'caja.conceptos'
  | 'caja.ambitos'
  | 'caja.origenes'
  | 'stock.origenes';

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
    estados: OrderEstadoConfig[];
    modoStock: OrderStockMode;
    estadoDescuentaStock: string;
  };
  stock: {
    tipos: StockTipoMovimiento[];
    origenes: StockOrigenMovimiento[];
  };
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
    ambitos: [],
    modo: {
      conceptos: 'texto',
    },
  },
  pedidos: {
    costosPersonalizacionDetallados: true,
    impresionDosVias: false,
    estados: [...DEFAULT_ORDER_ESTADOS],
    modoStock: 'reservado',
    estadoDescuentaStock: 'en_produccion',
  },
  stock: {
    tipos: [...DEFAULT_STOCK_TIPOS],
    origenes: [...DEFAULT_STOCK_ORIGENES],
  },
};

export function buildProductDisplayName(
  nombreBase: string,
  color?: string,
  talle?: string
): string {
  const parts = [nombreBase.trim()];
  if (color?.trim()) parts.push(color.trim());
  if (talle?.trim()) parts.push(talle.trim());
  return parts.join(' - ');
}

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

export function getOrderPedidosSettings(config: AppConfig) {
  return normalizeOrderPedidosConfig(config.pedidos);
}

export function orderConfigUsesReservedStock(config: AppConfig = DEFAULT_APP_CONFIG): boolean {
  return orderUsesReservedStock(config.pedidos);
}

export function usesCashConceptList(config: AppConfig): boolean {
  return config.caja?.modo?.conceptos === 'lista' && (config.caja?.conceptos?.length ?? 0) > 0;
}

export type CashAmbito = string;

export interface CajaAmbitoConfig {
  id: string;
  label: string;
}

export const DEFAULT_CASH_AMBITO_ID = 'general';

export function slugifyCajaAmbitoId(label: string): string {
  return slugifyOrigenGrupo(label);
}

export function normalizeCajaAmbitos(caja: { ambitos?: unknown } = {}): CajaAmbitoConfig[] {
  const raw = caja.ambitos;
  if (!Array.isArray(raw)) return [];

  const parsed: CajaAmbitoConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = String(obj.id ?? '').trim().toLowerCase();
    const label = String(obj.label ?? '').trim();
    if (!id || !label || parsed.some((entry) => entry.id === id)) continue;
    parsed.push({ id, label });
  }

  return parsed.sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

export function getCajaAmbitos(config: AppConfig): CajaAmbitoConfig[] {
  return normalizeCajaAmbitos(config.caja ?? {});
}

export function getDefaultCashAmbitoId(config: AppConfig = DEFAULT_APP_CONFIG): string {
  const ambitos = getCajaAmbitos(config);
  return ambitos[0]?.id ?? DEFAULT_CASH_AMBITO_ID;
}

export function usesCashAmbitoSeparation(config: AppConfig): boolean {
  return getCajaAmbitos(config).length >= 2;
}

export function resolveCashAmbito(
  movement: { ambito?: string } | undefined,
  config: AppConfig = DEFAULT_APP_CONFIG
): string {
  const raw = String(movement?.ambito ?? '').trim().toLowerCase();
  const ambitos = getCajaAmbitos(config);
  const defaultId = getDefaultCashAmbitoId(config);
  if (raw && ambitos.some((entry) => entry.id === raw)) return raw;
  return defaultId;
}

export function getCashAmbitoLabel(
  ambito: string,
  config: AppConfig = DEFAULT_APP_CONFIG
): string {
  const match = getCajaAmbitos(config).find((entry) => entry.id === ambito);
  return match?.label ?? ambito;
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
    options?: { confirmConfigRemovals?: boolean }
  ): Observable<AppConfig> {
    const body = {
      ...config,
      confirmConfigRemovals: options?.confirmConfigRemovals ?? false,
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
