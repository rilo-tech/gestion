import {
  normalizeMovementAmbito,
  parseCashAmbitoOrNull,
  usesCashAmbitoSeparationFromCaja,
} from '../../utils/caja-ambitos.ts';
import { normalizeTransactionDateTimeToIso } from '../../utils/transaction-date.ts';
import { CashDomainError } from './cash-errors.ts';
import type { CashMovementType } from './cash-types.ts';

export type CashMovementUpdateInput = {
  tipo?: unknown;
  monto?: unknown;
  concepto?: unknown;
  medio?: unknown;
  ambito?: unknown;
  categoriaId?: unknown;
  descripcion?: unknown;
  fecha?: unknown;
};

function isLinkedSystemMovement(movement: Record<string, unknown>): boolean {
  const tipo = String(movement.origenTipo ?? '');
  const grupo = String(movement.origenGrupo ?? '');
  if (movement.compraId || movement.pedidoId || movement.ventaId) return true;
  if (grupo === 'compra' || grupo === 'pedido' || grupo === 'venta') return true;
  return (
    tipo === 'colaborador_pago' ||
    tipo === 'cuenta_pagar' ||
    tipo === 'tarjeta_resumen' ||
    tipo === 'compra' ||
    tipo.startsWith('compra') ||
    tipo.startsWith('pedido') ||
    tipo === 'venta' ||
    tipo.startsWith('venta')
  );
}

export function isManualCashMovement(movement: Record<string, unknown>): boolean {
  if (isLinkedSystemMovement(movement)) return false;
  if (movement.origenGrupo === 'manual') return true;

  const tipo = String(movement.origenTipo ?? '');
  if (tipo.startsWith('caja_manual')) return true;
  if (tipo.startsWith('pedido') || tipo === 'venta' || tipo.startsWith('venta')) return false;
  if (movement.origenGrupo === 'pedido' || movement.origenGrupo === 'venta') return false;

  return true;
}

function normalizeDescripcion(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  return value || null;
}

function toSafeDate(value: unknown, now: Date): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      const converted = (value as { toDate: () => Date }).toDate();
      if (!Number.isNaN(converted.getTime())) return converted;
    } catch {
      // Firestore timestamp inválido
    }
  }
  const parsed = Date.parse(String(value ?? ''));
  if (!Number.isNaN(parsed)) return new Date(parsed);
  return now;
}

export function resolveCashUpdateAmbito(
  requested: unknown,
  existingAmbito: unknown,
  caja: Record<string, unknown>
): string {
  const hasRequest = requested != null && String(requested).trim() !== '';
  if (!hasRequest) {
    return normalizeMovementAmbito(existingAmbito, caja);
  }

  if (usesCashAmbitoSeparationFromCaja(caja) && !parseCashAmbitoOrNull(requested, caja)) {
    throw new CashDomainError(
      'INVALID_CASH_SCOPE',
      'Esa caja no existe en este negocio.',
      'ambito'
    );
  }

  return normalizeMovementAmbito(requested, caja);
}

/**
 * Arma el patch de edición de caja.
 * Movimientos automáticos (compra, venta, pedido): solo se puede cambiar la caja.
 * Manuales: el resto de campos también.
 */
export function buildCashMovementUpdate(
  existing: Record<string, unknown>,
  input: CashMovementUpdateInput,
  caja: Record<string, unknown>,
  now: Date = new Date()
): Record<string, unknown> {
  const ambito = resolveCashUpdateAmbito(input.ambito, existing.ambito, caja);
  const updatedAt = now.toISOString();

  if (!isManualCashMovement(existing)) {
    return { ambito, updatedAt };
  }

  const tipo: CashMovementType = input.tipo === 'egreso' ? 'egreso' : 'ingreso';
  const monto = Number(input.monto) || 0;
  if (monto <= 0) {
    throw new CashDomainError(
      'INVALID_CASH_AMOUNT',
      'El monto debe ser mayor a cero.',
      'monto'
    );
  }

  const concepto = String(input.concepto ?? '').trim();
  if (!concepto) {
    throw new CashDomainError('MISSING_CASH_CONCEPT', 'Ingresá un concepto.', 'concepto');
  }

  const fecha = normalizeTransactionDateTimeToIso(
    input.fecha,
    toSafeDate(existing.fecha, now)
  );

  return {
    tipo,
    monto,
    medio: String(input.medio ?? 'efectivo').trim() || 'efectivo',
    concepto,
    categoriaId: String(input.categoriaId ?? '').trim() || null,
    descripcion: normalizeDescripcion(input.descripcion),
    ambito,
    fecha,
    origenTipo: tipo === 'egreso' ? 'caja_manual_egreso' : 'caja_manual_ingreso',
    origenGrupo: 'manual',
    updatedAt,
  };
}
