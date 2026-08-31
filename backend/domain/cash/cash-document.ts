import {
  normalizeMovementAmbito,
  parseCashAmbitoOrNull,
  usesCashAmbitoSeparationFromCaja,
} from '../../utils/caja-ambitos.ts';
import { normalizeTransactionDateTimeToIso } from '../../utils/transaction-date.ts';
import { CashDomainError } from './cash-errors.ts';
import {
  CASH_ERP_BUSINESS_FIELDS,
  type CashMovementDocument,
  type CashMovementType,
  type RegisterCashMovementCommand,
} from './cash-types.ts';

export type ValidatedCashMovement = {
  businessId: string;
  type: CashMovementType;
  amount: number;
  concept: string;
  ambito: string;
  fecha: string;
  medio: string;
  categoriaId: string | null;
  descripcion: string | null;
  source?: RegisterCashMovementCommand['source'];
  actor?: RegisterCashMovementCommand['actor'];
};

export function pickCashErpBusinessFields(
  doc: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of CASH_ERP_BUSINESS_FIELDS) {
    out[key] = doc[key] ?? null;
  }
  return out;
}

function normalizeDescripcion(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  return value || null;
}

function parseCashDate(value: unknown, now: Date): string {
  if (value == null || value === '') return now.toISOString();
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new CashDomainError('INVALID_CASH_DATE', 'La fecha no es válida.', 'date');
    }
    return normalizeTransactionDateTimeToIso(value.toISOString(), now);
  }
  const raw = String(value).trim();
  if (!raw) return now.toISOString();
  const parsed = Date.parse(raw);
  const dateOnly = raw.slice(0, 10);
  if (Number.isNaN(parsed) && !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    throw new CashDomainError('INVALID_CASH_DATE', 'La fecha no es válida.', 'date');
  }
  return normalizeTransactionDateTimeToIso(raw, now);
}

/**
 * Extrae las validaciones del POST /api/cash. Ámbito: mismas reglas que
 * `normalizeMovementAmbito` (fallback al ámbito de negocio). Si el tenant
 * tiene más de un ámbito y el command manda un scope que no matchea, error.
 */
export function validateRegisterCashMovement(
  command: RegisterCashMovementCommand,
  caja: Record<string, unknown>,
  now: Date = new Date()
): ValidatedCashMovement {
  const businessId = String(command.businessId ?? '').trim();
  if (!businessId) {
    throw new CashDomainError('INVALID_BUSINESS', 'Falta el negocio.', 'businessId');
  }

  const type = command.type;
  if (type !== 'ingreso' && type !== 'egreso') {
    throw new CashDomainError(
      'INVALID_CASH_TYPE',
      'El tipo debe ser ingreso o egreso.',
      'type'
    );
  }

  const amount = Number(command.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CashDomainError(
      'INVALID_CASH_AMOUNT',
      'El monto debe ser mayor a cero.',
      'amount'
    );
  }

  const concept = String(command.concept ?? '').trim();
  if (!concept) {
    throw new CashDomainError('MISSING_CASH_CONCEPT', 'Ingresá un concepto.', 'concept');
  }

  const scopeRaw = command.scope == null ? '' : String(command.scope).trim();
  if (scopeRaw && usesCashAmbitoSeparationFromCaja(caja) && !parseCashAmbitoOrNull(scopeRaw, caja)) {
    throw new CashDomainError(
      'INVALID_CASH_SCOPE',
      'Esa caja no existe en este negocio.',
      'scope'
    );
  }

  const ambito = normalizeMovementAmbito(scopeRaw || command.scope, caja);
  const medio = String(command.medio ?? 'efectivo').trim() || 'efectivo';
  const categoriaId = String(command.categoriaId ?? '').trim() || null;
  const descripcion = normalizeDescripcion(command.descripcion);
  const fecha = parseCashDate(command.date, now);

  return {
    businessId,
    type,
    amount,
    concept: concept.slice(0, 200),
    ambito,
    fecha,
    medio,
    categoriaId,
    descripcion,
    source: command.source,
    actor: command.actor,
  };
}

export function buildManualCashMovementDocument(
  validated: ValidatedCashMovement,
  createdAt: string
): CashMovementDocument {
  const doc: CashMovementDocument = {
    tipo: validated.type,
    monto: validated.amount,
    medio: validated.medio,
    concepto: validated.concept,
    categoriaId: validated.categoriaId,
    descripcion: validated.descripcion,
    ambito: validated.ambito,
    fecha: validated.fecha,
    createdAt,
    origenTipo: validated.type === 'egreso' ? 'caja_manual_egreso' : 'caja_manual_ingreso',
    origenGrupo: 'manual',
    origenId: null,
    pedidoId: null,
    numeroPedido: null,
    numeroPedidoLabel: null,
    clienteId: null,
    negocioId: validated.businessId,
  };

  if (validated.source) {
    doc.source = validated.source;
  }

  if (validated.source === 'whatsapp') {
    doc.origenWhatsapp = true;
    const phone = String(validated.actor?.phone ?? '').trim();
    if (phone) doc.whatsappPhone = phone;
  }

  return doc;
}
