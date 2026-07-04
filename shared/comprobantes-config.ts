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

export function comprobanteNuevoTitulo(tipo: ComprobanteTipoId, modulo: ComprobanteModulo): string {
  if (tipo === 'factura') {
    return modulo === 'ventas' ? 'Nueva venta' : 'Nueva compra';
  }
  return comprobanteLabel(tipo);
}

export function comprobanteBorradorTitulo(tipo: ComprobanteTipoId, modulo: ComprobanteModulo): string {
  if (tipo === 'factura') {
    return modulo === 'ventas' ? 'Borrador de venta' : 'Borrador de compra';
  }
  return `Borrador de ${comprobanteLabel(tipo).toLowerCase()}`;
}

export function comprobanteRegistrarLabel(tipo: ComprobanteTipoId, modulo: ComprobanteModulo): string {
  if (tipo === 'factura') {
    return modulo === 'ventas' ? 'Registrar venta' : 'Registrar compra';
  }
  return `Registrar ${comprobanteLabel(tipo).toLowerCase()}`;
}

export function comprobanteConfirmarLabel(tipo: ComprobanteTipoId, modulo: ComprobanteModulo): string {
  if (tipo === 'factura') {
    return modulo === 'ventas' ? 'Confirmar venta' : 'Confirmar compra';
  }
  return `Confirmar ${comprobanteLabel(tipo).toLowerCase()}`;
}

export function comprobanteTipoHint(tipo: ComprobanteTipoId, modulo: ComprobanteModulo): string | null {
  if (tipo === 'nota_credito') {
    return modulo === 'ventas'
      ? 'Nota de crédito: reduce la deuda del cliente. Si devolvés dinero ahora, registrá el monto abajo. El stock se reingresa solo en líneas con producto.'
      : 'Nota de crédito: la mercadería sale del stock (devolución al proveedor).';
  }
  if (tipo === 'nota_debito') {
    return modulo === 'ventas'
      ? 'Nota de débito: aumenta la deuda del cliente. Si cobrás ahora, registrá el monto abajo.'
      : 'Nota de débito: aumenta la deuda con el proveedor.';
  }
  return null;
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

export function esNotaDebito(tipo: ComprobanteTipoId): boolean {
  return tipo === 'nota_debito';
}

export function esNotaComprobante(tipo: ComprobanteTipoId): boolean {
  return esNotaCredito(tipo) || esNotaDebito(tipo);
}

export type NotaMotivoId = 'devolucion' | 'descuento' | 'ajuste' | 'otro';

export const NOTA_MOTIVO_OPTIONS: Array<{ id: NotaMotivoId; label: string }> = [
  { id: 'devolucion', label: 'Devolución de producto' },
  { id: 'descuento', label: 'Descuento o bonificación' },
  { id: 'ajuste', label: 'Ajuste de saldo o precio' },
  { id: 'otro', label: 'Otro' },
];

const LEGACY_NOTA_MOTIVO_MAP: Record<string, NotaMotivoId> = {
  bonificacion: 'descuento',
  error_precio: 'ajuste',
  diferencia_cobro: 'ajuste',
  ajuste_saldo: 'ajuste',
  envio: 'ajuste',
};

export function normalizeNotaMotivo(value: unknown): NotaMotivoId | '' {
  const raw = String(value ?? '').trim().toLowerCase();
  if (LEGACY_NOTA_MOTIVO_MAP[raw]) return LEGACY_NOTA_MOTIVO_MAP[raw];
  if (NOTA_MOTIVO_OPTIONS.some((option) => option.id === raw)) {
    return raw as NotaMotivoId;
  }
  return '';
}

/** True cuando la nota debe cargar líneas de producto (movimiento de stock). */
export function notaMotivoRequiresProductLines(motivo: NotaMotivoId | ''): boolean {
  return motivo === 'devolucion';
}

export function notaMotivoLabel(motivo: unknown, descripcion?: unknown): string {
  const id = normalizeNotaMotivo(motivo);
  if (!id) return String(descripcion ?? '').trim();
  if (id === 'otro') return String(descripcion ?? '').trim() || 'Otro';
  return NOTA_MOTIVO_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

/** Saldo pendiente almacenado (siempre >= 0): total − cobrado/devuelto ahora. */
export function computeComprobanteSaldoPendiente(total: number, montoCobrado: number): number {
  return Math.max(0, (Number(total) || 0) - Math.max(0, Number(montoCobrado) || 0));
}

/** Impacto en cuenta corriente del cliente/proveedor (+ deuda, − saldo a favor). */
export function comprobanteSaldoCuentaCorrienteImpact(
  tipo: ComprobanteTipoId,
  saldoPendiente: number
): number {
  const pendiente = Math.max(0, Number(saldoPendiente) || 0);
  if (pendiente <= 0) return 0;
  return comprobanteSignoFinanciero(tipo) * pendiente;
}

export function ventaSaldoClienteImpact(data: {
  tipoComprobante?: unknown;
  saldoPendiente?: unknown;
}): number {
  const tipo = normalizeComprobanteTipo(data.tipoComprobante);
  return comprobanteSaldoCuentaCorrienteImpact(tipo, Number(data.saldoPendiente) || 0);
}

export type SaleLineTipo = 'producto' | 'concepto';

export function saleLineMovesStock(line: {
  tipoLinea?: unknown;
  stockItemId?: unknown;
  mueveStock?: unknown;
}): boolean {
  const tipo = String(line.tipoLinea ?? 'producto').trim().toLowerCase();
  if (tipo === 'concepto') return false;
  if (line.mueveStock === false) return false;
  return Boolean(String(line.stockItemId ?? '').trim());
}
