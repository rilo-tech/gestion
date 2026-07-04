import type { Response } from 'express';
import { createCompanyRouter } from './create-company-router.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { requirePermission, requireBusinessModule } from '../auth/middleware.ts';
import { logActivityFromRequest } from '../utils/activity-log.ts';
import {
  buildCollaboratorsPeriodSummary,
  deleteCashForCollaboratorPayment,
  getCollaborator,
  listCollaboratorMovements,
  listCollaborators,
  movementsCollection,
  parseCollaboratorInput,
  movementToFirestore,
  parseMovementInput,
  syncCollaboratorPaymentCash,
  collaboratorsCollection,
} from '../utils/collaborators.ts';
import {
  assertCanManageCollaboratorTeam,
  assertCollaboratorInScope,
  CollaboratorScopeError,
  resolveCollaboratorAccessScope,
  resolveScopedCollaboratorId,
} from '../utils/collaborator-scope.ts';

const router = createCompanyRouter();
router.use(requireBusinessModule('collaborators'));
router.use('/:businessId', requirePermission('collaborators.access'));

function handleCollaboratorRouteError(res: Response, error: unknown, fallback: string) {
  if (error instanceof CollaboratorScopeError) {
    return res.status(403).json({ error: error.message });
  }
  console.error(fallback, error);
  return res.status(500).json({ error: fallback });
}

router.get('/:businessId/resumen', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { businessId } = req.params;
    const scope = await resolveCollaboratorAccessScope(businessId, authReq);
    const from = String(req.query.from ?? '').slice(0, 10);
    const to = String(req.query.to ?? '').slice(0, 10);
    const summary = await buildCollaboratorsPeriodSummary(
      businessId,
      from,
      to,
      scope.mode === 'own' ? scope.colaboradorId : undefined
    );
    res.json(summary);
  } catch (error) {
    handleCollaboratorRouteError(res, error, 'No se pudo generar el resumen de colaboradores.');
  }
});

router.get('/:businessId/movimientos', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { businessId } = req.params;
    const scope = await resolveCollaboratorAccessScope(businessId, authReq);
    const requestedId = String(req.query.colaboradorId ?? '').trim() || undefined;
    const colaboradorId = resolveScopedCollaboratorId(scope, requestedId);
    if (scope.mode === 'own' && requestedId && requestedId !== scope.colaboradorId) {
      return res.status(403).json({ error: 'No tenés permiso para ver datos de otro colaborador.' });
    }

    const movements = await listCollaboratorMovements(businessId, {
      from: String(req.query.from ?? '').slice(0, 10) || undefined,
      to: String(req.query.to ?? '').slice(0, 10) || undefined,
      colaboradorId,
    });
    res.json(movements);
  } catch (error) {
    handleCollaboratorRouteError(res, error, 'No se pudieron cargar los movimientos.');
  }
});

router.get('/:businessId', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { businessId } = req.params;
    const scope = await resolveCollaboratorAccessScope(businessId, authReq);
    const collaborators = await listCollaborators(businessId);
    if (scope.mode === 'own') {
      return res.json(collaborators.filter((item) => item.id === scope.colaboradorId));
    }
    res.json(collaborators);
  } catch (error) {
    handleCollaboratorRouteError(res, error, 'No se pudieron cargar los colaboradores.');
  }
});

router.get('/:businessId/:colaboradorId', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { businessId, colaboradorId } = req.params;
    const scope = await resolveCollaboratorAccessScope(businessId, authReq);
    assertCollaboratorInScope(scope, colaboradorId);

    const collaborator = await getCollaborator(businessId, colaboradorId);
    if (!collaborator) return res.status(404).json({ error: 'Colaborador no encontrado.' });
    res.json(collaborator);
  } catch (error) {
    handleCollaboratorRouteError(res, error, 'No se pudo cargar el colaborador.');
  }
});

router.post('/:businessId', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { businessId } = req.params;
    const scope = await resolveCollaboratorAccessScope(businessId, authReq);
    assertCanManageCollaboratorTeam(scope);

    const input = parseCollaboratorInput(req.body ?? {});
    if (!input) return res.status(400).json({ error: 'El nombre es obligatorio.' });

    const now = new Date().toISOString();
    const docRef = await collaboratorsCollection(businessId).add({
      ...input,
      createdAt: now,
      updatedAt: now,
    });

    await logActivityFromRequest(authReq, businessId, {
      module: 'collaborators',
      action: 'create',
      entityType: 'colaborador',
      entityId: docRef.id,
      entityLabel: input.nombre,
      summary: `Agregó colaborador: ${input.nombre}`,
    });

    res.status(201).json({ id: docRef.id, ...input, createdAt: now, updatedAt: now });
  } catch (error) {
    handleCollaboratorRouteError(res, error, 'No se pudo crear el colaborador.');
  }
});

router.patch('/:businessId/:colaboradorId', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { businessId, colaboradorId } = req.params;
    const scope = await resolveCollaboratorAccessScope(businessId, authReq);
    assertCanManageCollaboratorTeam(scope);
    assertCollaboratorInScope(scope, colaboradorId);

    const input = parseCollaboratorInput(req.body ?? {});
    if (!input) return res.status(400).json({ error: 'El nombre es obligatorio.' });

    const ref = collaboratorsCollection(businessId).doc(colaboradorId);
    const existing = await ref.get();
    if (!existing.exists) return res.status(404).json({ error: 'Colaborador no encontrado.' });

    const updatedAt = new Date().toISOString();
    await ref.update({ ...input, updatedAt });

    await logActivityFromRequest(authReq, businessId, {
      module: 'collaborators',
      action: 'update',
      entityType: 'colaborador',
      entityId: colaboradorId,
      entityLabel: input.nombre,
      summary: `Actualizó colaborador: ${input.nombre}`,
    });

    res.json({ id: colaboradorId, ...input, updatedAt });
  } catch (error) {
    handleCollaboratorRouteError(res, error, 'No se pudo actualizar el colaborador.');
  }
});

router.delete('/:businessId/:colaboradorId', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { businessId, colaboradorId } = req.params;
    const scope = await resolveCollaboratorAccessScope(businessId, authReq);
    assertCanManageCollaboratorTeam(scope);
    assertCollaboratorInScope(scope, colaboradorId);

    const ref = collaboratorsCollection(businessId).doc(colaboradorId);
    const existing = await ref.get();
    if (!existing.exists) return res.status(404).json({ error: 'Colaborador no encontrado.' });
    const data = existing.data() ?? {};

    await ref.delete();

    await logActivityFromRequest(authReq, businessId, {
      module: 'collaborators',
      action: 'delete',
      entityType: 'colaborador',
      entityId: colaboradorId,
      entityLabel: String(data.nombre ?? ''),
      summary: `Eliminó colaborador: ${String(data.nombre ?? colaboradorId)}`,
    });

    res.json({ ok: true });
  } catch (error) {
    handleCollaboratorRouteError(res, error, 'No se pudo eliminar el colaborador.');
  }
});

router.post('/:businessId/movimientos', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { businessId } = req.params;
    const scope = await resolveCollaboratorAccessScope(businessId, authReq);

    const input = await parseMovementInput(businessId, req.body ?? {});
    if (!input) {
      return res.status(400).json({ error: 'Completá colaborador, tipo, fecha y datos del movimiento.' });
    }

    assertCollaboratorInScope(scope, input.colaboradorId);
    if (scope.mode === 'own' && (input.tipo === 'pago' || input.tipo === 'extra')) {
      return res.status(403).json({ error: 'No tenés permiso para registrar pagos ni extras de otros colaboradores.' });
    }

    const collaborator = await getCollaborator(businessId, input.colaboradorId);
    const createdAt = new Date().toISOString();
    const docRef = await movementsCollection(businessId).add({
      ...movementToFirestore(input),
      colaboradorNombre: collaborator?.nombre ?? '',
      movimientoCajaId: null,
      createdAt,
    });

    let movimientoCajaId: string | null = null;
    if (input.tipo === 'pago') {
      movimientoCajaId = await syncCollaboratorPaymentCash(
        businessId,
        docRef.id,
        { ...input, colaboradorNombre: collaborator?.nombre ?? '' }
      );
      if (movimientoCajaId) {
        await docRef.update({ movimientoCajaId });
      }
    }

    const tipoLabel =
      input.tipo === 'horas' ? `${input.horas} h` : input.tipo === 'extra' ? 'extra' : 'pago';

    await logActivityFromRequest(authReq, businessId, {
      module: 'collaborators',
      action: input.tipo === 'pago' ? 'payment' : 'create',
      entityType: 'movimiento',
      entityId: docRef.id,
      entityLabel: collaborator?.nombre,
      summary: `Registró ${tipoLabel} · ${collaborator?.nombre ?? ''} · $${input.monto}`,
    });

    res.status(201).json({
      id: docRef.id,
      ...input,
      colaboradorNombre: collaborator?.nombre,
      movimientoCajaId,
      createdAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'MEDIO_PAGO_INVALID') {
      return res.status(400).json({ error: 'Medio de pago inválido para registrar el egreso en caja.' });
    }
    handleCollaboratorRouteError(res, error, 'No se pudo registrar el movimiento.');
  }
});

router.patch('/:businessId/movimientos/:movimientoId', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { businessId, movimientoId } = req.params;
    const scope = await resolveCollaboratorAccessScope(businessId, authReq);

    const ref = movementsCollection(businessId).doc(movimientoId);
    const existing = await ref.get();
    if (!existing.exists) return res.status(404).json({ error: 'Movimiento no encontrado.' });
    const existingData = existing.data() ?? {};
    assertCollaboratorInScope(scope, String(existingData.colaboradorId ?? ''));

    const input = await parseMovementInput(businessId, req.body ?? {});
    if (!input) {
      return res.status(400).json({ error: 'Datos del movimiento inválidos.' });
    }
    assertCollaboratorInScope(scope, input.colaboradorId);
    if (scope.mode === 'own' && (input.tipo === 'pago' || input.tipo === 'extra')) {
      return res.status(403).json({ error: 'No tenés permiso para registrar pagos ni extras.' });
    }

    const collaborator = await getCollaborator(businessId, input.colaboradorId);
    const colaboradorNombre = collaborator?.nombre ?? '';

    const movimientoCajaId = await syncCollaboratorPaymentCash(
      businessId,
      movimientoId,
      { ...input, colaboradorNombre },
      existingData.movimientoCajaId ? String(existingData.movimientoCajaId) : undefined
    );

    const patch = {
      ...movementToFirestore(input),
      colaboradorNombre,
      movimientoCajaId: movimientoCajaId ?? null,
    };
    if (input.tipo === 'pago') {
      patch.medioPagoId = input.medioPagoId ?? 'efectivo';
    } else {
      patch.medioPagoId = null;
    }
    await ref.update(patch);

    await logActivityFromRequest(authReq, businessId, {
      module: 'collaborators',
      action: 'update',
      entityType: 'movimiento',
      entityId: movimientoId,
      entityLabel: collaborator?.nombre,
      summary: `Actualizó movimiento · ${collaborator?.nombre ?? ''}`,
    });

    res.json({
      id: movimientoId,
      ...input,
      colaboradorNombre,
      movimientoCajaId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'MEDIO_PAGO_INVALID') {
      return res.status(400).json({ error: 'Medio de pago inválido para registrar el egreso en caja.' });
    }
    handleCollaboratorRouteError(res, error, 'No se pudo actualizar el movimiento.');
  }
});

router.delete('/:businessId/movimientos/:movimientoId', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { businessId, movimientoId } = req.params;
    const scope = await resolveCollaboratorAccessScope(businessId, authReq);

    const ref = movementsCollection(businessId).doc(movimientoId);
    const existing = await ref.get();
    if (!existing.exists) return res.status(404).json({ error: 'Movimiento no encontrado.' });
    const data = existing.data() ?? {};
    assertCollaboratorInScope(scope, String(data.colaboradorId ?? ''));

    if (data.movimientoCajaId) {
      await deleteCashForCollaboratorPayment(
        businessId,
        String(data.movimientoCajaId)
      );
    }

    await ref.delete();

    await logActivityFromRequest(authReq, businessId, {
      module: 'collaborators',
      action: 'delete',
      entityType: 'movimiento',
      entityId: movimientoId,
      entityLabel: String(data.colaboradorNombre ?? ''),
      summary: `Eliminó movimiento de ${String(data.colaboradorNombre ?? 'colaborador')}`,
    });

    res.json({ ok: true });
  } catch (error) {
    handleCollaboratorRouteError(res, error, 'No se pudo eliminar el movimiento.');
  }
});

export default router;
