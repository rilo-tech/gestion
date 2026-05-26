import { createCompanyRouter } from './create-company-router.ts';
import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { requirePermission } from '../auth/middleware.ts';
import { logActivityFromRequest } from '../utils/activity-log.ts';
import {
  buildCollaboratorsPeriodSummary,
  getCollaborator,
  listCollaboratorMovements,
  listCollaborators,
  movementsCollection,
  parseCollaboratorInput,
  parseMovementInput,
  collaboratorsCollection,
} from '../utils/collaborators.ts';

const router = createCompanyRouter();
router.use('/:businessId', requirePermission('collaborators.access'));

router.get('/:businessId/resumen', async (req, res) => {
  try {
    const from = String(req.query.from ?? '').slice(0, 10);
    const to = String(req.query.to ?? '').slice(0, 10);
    const summary = await buildCollaboratorsPeriodSummary(req.params.businessId, from, to);
    res.json(summary);
  } catch (error) {
    console.error('Error building collaborators summary:', error);
    res.status(500).json({ error: 'No se pudo generar el resumen de colaboradores.' });
  }
});

router.get('/:businessId/movimientos', async (req, res) => {
  try {
    const movements = await listCollaboratorMovements(req.params.businessId, {
      from: String(req.query.from ?? '').slice(0, 10) || undefined,
      to: String(req.query.to ?? '').slice(0, 10) || undefined,
      colaboradorId: String(req.query.colaboradorId ?? '').trim() || undefined,
    });
    res.json(movements);
  } catch (error) {
    console.error('Error listing collaborator movements:', error);
    res.status(500).json({ error: 'No se pudieron cargar los movimientos.' });
  }
});

router.get('/:businessId', async (req, res) => {
  try {
    const collaborators = await listCollaborators(req.params.businessId);
    res.json(collaborators);
  } catch (error) {
    console.error('Error listing collaborators:', error);
    res.status(500).json({ error: 'No se pudieron cargar los colaboradores.' });
  }
});

router.get('/:businessId/:colaboradorId', async (req, res) => {
  try {
    const collaborator = await getCollaborator(req.params.businessId, req.params.colaboradorId);
    if (!collaborator) return res.status(404).json({ error: 'Colaborador no encontrado.' });
    res.json(collaborator);
  } catch (error) {
    console.error('Error fetching collaborator:', error);
    res.status(500).json({ error: 'No se pudo cargar el colaborador.' });
  }
});

router.post('/:businessId', async (req, res) => {
  try {
    const input = parseCollaboratorInput(req.body ?? {});
    if (!input) return res.status(400).json({ error: 'El nombre es obligatorio.' });

    const now = new Date().toISOString();
    const docRef = await collaboratorsCollection(req.params.businessId).add({
      ...input,
      createdAt: now,
      updatedAt: now,
    });

    await logActivityFromRequest(req as AuthenticatedRequest, req.params.businessId, {
      module: 'collaborators',
      action: 'create',
      entityType: 'colaborador',
      entityId: docRef.id,
      entityLabel: input.nombre,
      summary: `Agregó colaborador: ${input.nombre}`,
    });

    res.status(201).json({ id: docRef.id, ...input, createdAt: now, updatedAt: now });
  } catch (error) {
    console.error('Error creating collaborator:', error);
    res.status(500).json({ error: 'No se pudo crear el colaborador.' });
  }
});

router.patch('/:businessId/:colaboradorId', async (req, res) => {
  try {
    const input = parseCollaboratorInput(req.body ?? {});
    if (!input) return res.status(400).json({ error: 'El nombre es obligatorio.' });

    const ref = collaboratorsCollection(req.params.businessId).doc(req.params.colaboradorId);
    const existing = await ref.get();
    if (!existing.exists) return res.status(404).json({ error: 'Colaborador no encontrado.' });

    const updatedAt = new Date().toISOString();
    await ref.update({ ...input, updatedAt });

    await logActivityFromRequest(req as AuthenticatedRequest, req.params.businessId, {
      module: 'collaborators',
      action: 'update',
      entityType: 'colaborador',
      entityId: req.params.colaboradorId,
      entityLabel: input.nombre,
      summary: `Actualizó colaborador: ${input.nombre}`,
    });

    res.json({ id: req.params.colaboradorId, ...input, updatedAt });
  } catch (error) {
    console.error('Error updating collaborator:', error);
    res.status(500).json({ error: 'No se pudo actualizar el colaborador.' });
  }
});

router.delete('/:businessId/:colaboradorId', async (req, res) => {
  try {
    const ref = collaboratorsCollection(req.params.businessId).doc(req.params.colaboradorId);
    const existing = await ref.get();
    if (!existing.exists) return res.status(404).json({ error: 'Colaborador no encontrado.' });
    const data = existing.data() ?? {};

    await ref.delete();

    await logActivityFromRequest(req as AuthenticatedRequest, req.params.businessId, {
      module: 'collaborators',
      action: 'delete',
      entityType: 'colaborador',
      entityId: req.params.colaboradorId,
      entityLabel: String(data.nombre ?? ''),
      summary: `Eliminó colaborador: ${String(data.nombre ?? req.params.colaboradorId)}`,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting collaborator:', error);
    res.status(500).json({ error: 'No se pudo eliminar el colaborador.' });
  }
});

router.post('/:businessId/movimientos', async (req, res) => {
  try {
    const input = await parseMovementInput(req.params.businessId, req.body ?? {});
    if (!input) {
      return res.status(400).json({ error: 'Completá colaborador, tipo, fecha y datos del movimiento.' });
    }

    const collaborator = await getCollaborator(req.params.businessId, input.colaboradorId);
    const createdAt = new Date().toISOString();
    const docRef = await movementsCollection(req.params.businessId).add({
      ...input,
      colaboradorNombre: collaborator?.nombre ?? '',
      createdAt,
    });

    const tipoLabel =
      input.tipo === 'horas' ? `${input.horas} h` : input.tipo === 'extra' ? 'extra' : 'pago';

    await logActivityFromRequest(req as AuthenticatedRequest, req.params.businessId, {
      module: 'collaborators',
      action: input.tipo === 'pago' ? 'payment' : 'create',
      entityType: 'movimiento',
      entityId: docRef.id,
      entityLabel: collaborator?.nombre,
      summary: `Registró ${tipoLabel} · ${collaborator?.nombre ?? ''} · $${input.monto}`,
    });

    res.status(201).json({ id: docRef.id, ...input, colaboradorNombre: collaborator?.nombre, createdAt });
  } catch (error) {
    console.error('Error creating collaborator movement:', error);
    res.status(500).json({ error: 'No se pudo registrar el movimiento.' });
  }
});

router.patch('/:businessId/movimientos/:movimientoId', async (req, res) => {
  try {
    const input = await parseMovementInput(req.params.businessId, req.body ?? {});
    if (!input) {
      return res.status(400).json({ error: 'Datos del movimiento inválidos.' });
    }

    const ref = movementsCollection(req.params.businessId).doc(req.params.movimientoId);
    const existing = await ref.get();
    if (!existing.exists) return res.status(404).json({ error: 'Movimiento no encontrado.' });

    const collaborator = await getCollaborator(req.params.businessId, input.colaboradorId);
    await ref.update({
      ...input,
      colaboradorNombre: collaborator?.nombre ?? '',
    });

    await logActivityFromRequest(req as AuthenticatedRequest, req.params.businessId, {
      module: 'collaborators',
      action: 'update',
      entityType: 'movimiento',
      entityId: req.params.movimientoId,
      entityLabel: collaborator?.nombre,
      summary: `Actualizó movimiento · ${collaborator?.nombre ?? ''}`,
    });

    res.json({ id: req.params.movimientoId, ...input, colaboradorNombre: collaborator?.nombre });
  } catch (error) {
    console.error('Error updating collaborator movement:', error);
    res.status(500).json({ error: 'No se pudo actualizar el movimiento.' });
  }
});

router.delete('/:businessId/movimientos/:movimientoId', async (req, res) => {
  try {
    const ref = movementsCollection(req.params.businessId).doc(req.params.movimientoId);
    const existing = await ref.get();
    if (!existing.exists) return res.status(404).json({ error: 'Movimiento no encontrado.' });
    const data = existing.data() ?? {};

    await ref.delete();

    await logActivityFromRequest(req as AuthenticatedRequest, req.params.businessId, {
      module: 'collaborators',
      action: 'delete',
      entityType: 'movimiento',
      entityId: req.params.movimientoId,
      entityLabel: String(data.colaboradorNombre ?? ''),
      summary: `Eliminó movimiento de ${String(data.colaboradorNombre ?? 'colaborador')}`,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting collaborator movement:', error);
    res.status(500).json({ error: 'No se pudo eliminar el movimiento.' });
  }
});

export default router;
