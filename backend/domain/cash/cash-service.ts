import { buildManualCashMovementDocument, validateRegisterCashMovement } from './cash-document.ts';
import { createFirestoreCashRepository } from './cash-firestore.ts';
import type { CashRepository } from './cash-repository.ts';
import type { RegisterCashMovementCommand, RegisteredCashMovement } from './cash-types.ts';

export type RegisterCashMovementDeps = {
  repo?: CashRepository;
  now?: Date;
};

function defaultRepo(): CashRepository {
  return createFirestoreCashRepository();
}

/**
 * Alta de movimiento manual de caja. Misma lógica para RILO Gestión (POST /api/cash)
 * y RILO Bot. Colección: negocios/{businessId}/movimientos_caja.
 *
 * Deuda (no cambiar en esta etapa): estos movimientos NO entran al reporte de
 * ganancia. buildBusinessReport lee ventas + stock + clientes.
 */
export async function registerCashMovement(
  command: RegisterCashMovementCommand,
  deps: RegisterCashMovementDeps = {}
): Promise<RegisteredCashMovement> {
  const repo = deps.repo ?? defaultRepo();
  const now = deps.now ?? new Date();
  const caja = await repo.loadCajaConfig(command.businessId);
  const validated = validateRegisterCashMovement(command, caja, now);
  const createdAt = now.toISOString();
  const document = buildManualCashMovementDocument(validated, createdAt);
  const payload = { ...document } as Record<string, unknown>;

  const key = String(command.idempotencyKey ?? '').trim();
  const written = key
    ? await repo.insertMovementIdempotent(validated.businessId, key, payload)
    : { movementId: await repo.insertMovement(validated.businessId, payload), reused: false };

  if (written.reused) {
    const existing = await repo.getMovement(validated.businessId, written.movementId);
    const tipo = existing?.tipo === 'egreso' ? 'egreso' : validated.type;
    const amount = Number(existing?.monto);
    return {
      movementId: written.movementId,
      amount: Number.isFinite(amount) && amount > 0 ? amount : validated.amount,
      type: tipo,
      scope: String(existing?.ambito ?? validated.ambito),
      concept: String(existing?.concepto ?? validated.concept),
      date: String(existing?.fecha ?? validated.fecha),
      reused: true,
    };
  }

  return {
    movementId: written.movementId,
    amount: validated.amount,
    type: validated.type,
    scope: validated.ambito,
    concept: validated.concept,
    date: validated.fecha,
    reused: false,
  };
}

export async function loadCajaConfig(
  businessId: string,
  repo: CashRepository = defaultRepo()
): Promise<Record<string, unknown>> {
  return repo.loadCajaConfig(businessId);
}
