import { db } from '../../firebase.ts';
import {
  getCollaborator,
  listCollaboratorMovements,
  movementToFirestore,
  movementsCollection,
  parseMovementInput,
  syncCollaboratorPaymentCash,
  type CollaboratorMovementRecord,
} from '../../utils/collaborators.ts';
import {
  assertCanManageCollaboratorTeam,
  assertCollaboratorInScope,
  type CollaboratorAccessScope,
} from '../../utils/collaborator-scope.ts';

export type PreviewCollaboratorMovementResult = Omit<
  CollaboratorMovementRecord,
  'id' | 'createdAt' | 'colaboradorNombre'
>;

export class CollaboratorMovementValidationError extends Error {
  readonly code: 'MISSING_HOURLY_RATE' | 'INVALID_INPUT' | 'PERMISSION_DENIED';

  constructor(code: CollaboratorMovementValidationError['code'], message: string) {
    super(message);
    this.name = 'CollaboratorMovementValidationError';
    this.code = code;
  }
}

async function findMovementByWhatsappIdempotency(
  businessId: string,
  idempotencyKey: string
): Promise<{ id: string; movement: CollaboratorMovementRecord } | null> {
  const key = String(idempotencyKey ?? '').trim();
  if (!key) return null;
  const snap = await movementsCollection(businessId).where('whatsappIdempotencyKey', '==', key).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  return {
    id: doc.id,
    movement: { id: doc.id, ...(doc.data() as Omit<CollaboratorMovementRecord, 'id'>) },
  };
}

export async function previewCollaboratorMovement(
  businessId: string,
  body: Record<string, unknown>
): Promise<PreviewCollaboratorMovementResult> {
  const parsed = await parseMovementInput(businessId, body);
  if (!parsed) {
    throw new CollaboratorMovementValidationError('INVALID_INPUT', 'Datos del movimiento inválidos.');
  }
  return parsed;
}

function assertMovementWriteScope(
  scope: CollaboratorAccessScope | undefined,
  parsed: PreviewCollaboratorMovementResult
): void {
  if (!scope) return;
  assertCollaboratorInScope(scope, parsed.colaboradorId);
  if (scope.mode === 'own' && (parsed.tipo === 'pago' || parsed.tipo === 'extra')) {
    throw new CollaboratorMovementValidationError(
      'PERMISSION_DENIED',
      'No tenés permiso para registrar pagos ni extras.'
    );
  }
}

export async function registerCollaboratorMovement(input: {
  businessId: string;
  body: Record<string, unknown>;
  scope?: CollaboratorAccessScope;
  idempotencyKey?: string;
  source?: 'web' | 'whatsapp';
}): Promise<{
  id: string;
  movement: CollaboratorMovementRecord;
  movimientoCajaId?: string | null;
  duplicate?: boolean;
}> {
  const existing = input.idempotencyKey
    ? await findMovementByWhatsappIdempotency(input.businessId, input.idempotencyKey)
    : null;
  if (existing) {
    return {
      id: existing.id,
      movement: existing.movement,
      movimientoCajaId: existing.movement.movimientoCajaId ?? null,
      duplicate: true,
    };
  }

  const parsed = await previewCollaboratorMovement(input.businessId, input.body);
  assertMovementWriteScope(input.scope, parsed);
  if (parsed.tipo === 'pago' && input.scope) {
    assertCanManageCollaboratorTeam(input.scope);
  }

  const collaborator = await getCollaborator(input.businessId, parsed.colaboradorId);
  const createdAt = new Date().toISOString();
  const docRef = await movementsCollection(input.businessId).add({
    ...movementToFirestore(parsed),
    colaboradorNombre: collaborator?.nombre ?? '',
    movimientoCajaId: null,
    whatsappIdempotencyKey: input.idempotencyKey ? String(input.idempotencyKey) : null,
    origenWhatsapp: input.source === 'whatsapp' ? true : null,
    createdAt,
  });

  let movimientoCajaId: string | null = null;
  if (parsed.tipo === 'pago') {
    movimientoCajaId = await syncCollaboratorPaymentCash(
      input.businessId,
      docRef.id,
      { ...parsed, colaboradorNombre: collaborator?.nombre ?? '' }
    );
    if (movimientoCajaId) {
      await docRef.update({ movimientoCajaId });
    }
  }

  console.info(
    '[v4:collaborator:execute]',
    JSON.stringify({
      action: parsed.tipo === 'pago' ? 'payment' : parsed.tipo === 'horas' ? 'hours' : 'extra',
      businessId: input.businessId,
      colaboradorId: parsed.colaboradorId,
      movementId: docRef.id,
      movimientoCajaId,
    })
  );

  return {
    id: docRef.id,
    movement: {
      id: docRef.id,
      ...parsed,
      colaboradorNombre: collaborator?.nombre,
      movimientoCajaId: movimientoCajaId ?? undefined,
      createdAt,
    },
    movimientoCajaId,
  };
}

export async function updateCollaboratorMovement(input: {
  businessId: string;
  movimientoId: string;
  body: Record<string, unknown>;
  scope?: CollaboratorAccessScope;
}): Promise<{ id: string; movement: CollaboratorMovementRecord; movimientoCajaId?: string | null }> {
  const movimientoId = String(input.movimientoId ?? '').trim();
  if (!movimientoId) throw new CollaboratorMovementValidationError('INVALID_INPUT', 'Indicá el movimiento.');

  const ref = movementsCollection(input.businessId).doc(movimientoId);
  const existing = await ref.get();
  if (!existing.exists) throw new CollaboratorMovementValidationError('INVALID_INPUT', 'No encontré ese movimiento.');
  const existingData = existing.data() as Record<string, unknown>;
  assertCollaboratorInScope(input.scope ?? { mode: 'all' }, String(existingData.colaboradorId ?? ''));

  const parsed = await previewCollaboratorMovement(input.businessId, {
    ...input.body,
    colaboradorId: String(input.body.colaboradorId ?? existingData.colaboradorId ?? ''),
    tipo: String(input.body.tipo ?? existingData.tipo ?? ''),
  });
  assertMovementWriteScope(input.scope, parsed);
  if (parsed.tipo === 'pago' && input.scope) {
    assertCanManageCollaboratorTeam(input.scope);
  }

  const collaborator = await getCollaborator(input.businessId, parsed.colaboradorId);
  const colaboradorNombre = collaborator?.nombre ?? '';

  const movimientoCajaId = await syncCollaboratorPaymentCash(
    input.businessId,
    movimientoId,
    { ...parsed, colaboradorNombre },
    existingData.movimientoCajaId ? String(existingData.movimientoCajaId) : undefined
  );

  const patch: Record<string, unknown> = {
    ...movementToFirestore(parsed),
    colaboradorNombre,
    movimientoCajaId: movimientoCajaId ?? null,
  };
  if (parsed.tipo === 'pago') {
    patch.medioPagoId = parsed.medioPagoId ?? 'efectivo';
  } else {
    patch.medioPagoId = null;
  }
  await ref.update(patch);

  return {
    id: movimientoId,
    movement: {
      id: movimientoId,
      ...parsed,
      colaboradorNombre,
      movimientoCajaId: movimientoCajaId ?? undefined,
      createdAt: String(existingData.createdAt ?? new Date().toISOString()),
    },
    movimientoCajaId,
  };
}

export async function deleteCollaboratorMovement(input: {
  businessId: string;
  movimientoId: string;
  scope?: CollaboratorAccessScope;
}): Promise<void> {
  const movimientoId = String(input.movimientoId ?? '').trim();
  const ref = movementsCollection(input.businessId).doc(movimientoId);
  const existing = await ref.get();
  if (!existing.exists) return;
  const data = existing.data() ?? {};
  assertCollaboratorInScope(input.scope ?? { mode: 'all' }, String(data.colaboradorId ?? ''));

  if (data.movimientoCajaId) {
    const { deleteCashForCollaboratorPayment } = await import('../../utils/collaborators.ts');
    await deleteCashForCollaboratorPayment(input.businessId, String(data.movimientoCajaId));
  }
  await ref.delete();
}
