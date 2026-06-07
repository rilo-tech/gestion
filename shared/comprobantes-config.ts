/**
 * Tipos de comprobante para Compras y Ventas (Factura, Nota de Crédito, Nota de Débito).
 *
 * Modelo de negocio (según especificación funcional):
 *
 *  Comprobante      | Stock Compra | Stock Venta | Signo financiero
 *  -----------------|--------------|-------------|------------------
 *  Factura          | +1 (entrada) | -1 (salida) | +1 (aumenta saldo)
 *  Nota de Crédito  | -1 (salida)  | +1 (entrada)| -1 (disminuye saldo)
 *  Nota de Débito   | +1 (entrada) | -1 (salida) | +1 (aumenta saldo)
 *
 * La Factura está siempre activa; las Notas de Crédito/Débito son opcionales
 * y se activan por configuración (inactivas por defecto para no recargar la UI).
 */

export type ComprobanteModulo = 'compras' | 'ventas';

export type ComprobanteTipoId = 'factura' | 'nota_credito' | 'nota_debito';

export type StockDireccion = 'entrada' | 'salida';

export interface ComprobantesConfig {
  /** Habilita la Nota de Crédito en los formularios de compras y ventas. */
  notaCreditoActiva: boolean;
  /** Habilita la Nota de Débito en los formularios de compras y ventas. */
  notaDebitoActiva: boolean;
}

export interface ComprobanteTipoOption {
  id: ComprobanteTipoId;
  label: string;
}

export const DEFAULT_COMPROBANTES_CONFIG: ComprobantesConfig = {
  notaCreditoActiva: false,
  notaDebitoActiva: false,
};

const COMPROBANTE_LABELS: Record<ComprobanteTipoId, string> = {
  factura: 'Factura',
  nota_credito: 'Nota de crédito',
  nota_debito: 'Nota de débito',
};

export function comprobanteLabel(tipo: ComprobanteTipoId): string {
  return COMPROBANTE_LABELS[tipo] ?? COMPROBANTE_LABELS.factura;
}

export function normalizeComprobanteTipo(value: unknown): ComprobanteTipoId {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'nota_credito' || raw === 'notacredito' || raw === 'nc') return 'nota_credito';
  if (raw === 'nota_debito' || raw === 'notadebito' || raw === 'nd') return 'nota_debito';
  return 'factura';
}

export function normalizeComprobantesConfig(raw: unknown): ComprobantesConfig {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    notaCreditoActiva: data.notaCreditoActiva === true,
    notaDebitoActiva: data.notaDebitoActiva === true,
  };
}

/** True si hay al menos un comprobante adicional a la factura habilitado. */
export function hasComprobantesExtra(config: ComprobantesConfig): boolean {
  return config.notaCreditoActiva || config.notaDebitoActiva;
}

/** Tipos de comprobante disponibles para un módulo según la configuración. */
export function getComprobantesDisponibles(
  config: ComprobantesConfig,
  _modulo: ComprobanteModulo
): ComprobanteTipoOption[] {
  const options: ComprobanteTipoOption[] = [
    { id: 'factura', label: COMPROBANTE_LABELS.factura },
  ];
  if (config.notaCreditoActiva) {
    options.push({ id: 'nota_credito', label: COMPROBANTE_LABELS.nota_credito });
  }
  if (config.notaDebitoActiva) {
    options.push({ id: 'nota_debito', label: COMPROBANTE_LABELS.nota_debito });
  }
  return options;
}

export function isComprobanteTipoActivo(
  config: ComprobantesConfig,
  tipo: ComprobanteTipoId
): boolean {
  if (tipo === 'nota_credito') return config.notaCreditoActiva;
  if (tipo === 'nota_debito') return config.notaDebitoActiva;
  return true;
}

/** Dirección del movimiento de stock para el comprobante y módulo. */
export function comprobanteStockDireccion(
  tipo: ComprobanteTipoId,
  modulo: ComprobanteModulo
): StockDireccion {
  if (modulo === 'compras') {
    // Compra: factura/ND ingresan mercadería; NC la devuelve al proveedor.
    return tipo === 'nota_credito' ? 'salida' : 'entrada';
  }
  // Venta: factura/ND descuentan stock; NC reingresa por devolución del cliente.
  return tipo === 'nota_credito' ? 'entrada' : 'salida';
}

/**
 * Signo financiero del comprobante:
 *  +1 aumenta el saldo (factura / nota de débito)
 *  -1 lo disminuye (nota de crédito)
 */
export function comprobanteSignoFinanciero(tipo: ComprobanteTipoId): 1 | -1 {
  return tipo === 'nota_credito' ? -1 : 1;
}

export function esNotaCredito(tipo: ComprobanteTipoId): boolean {
  return tipo === 'nota_credito';
}
