import {
  collaboratorsCollection,
  getCollaborator,
  parseCollaboratorInput,
  type CollaboratorModalidad,
  type CollaboratorPeriodoReferencia,
} from '../../utils/collaborators.ts';

export type CreateCollaboratorInput = {
  businessId: string;
  name: string;
  telefono?: string;
  email?: string;
  notas?: string;
  modalidad?: CollaboratorModalidad;
  valorHora?: number;
  montoFijoPeriodo?: number;
  periodoReferencia?: CollaboratorPeriodoReferencia;
  source?: 'web' | 'whatsapp';
};

export type UpdateCollaboratorInput = {
  businessId: string;
  colaboradorId: string;
  name?: string;
  telefono?: string | null;
  email?: string | null;
  notas?: string | null;
  modalidad?: CollaboratorModalidad;
  valorHora?: number | null;
  montoFijoPeriodo?: number | null;
  periodoReferencia?: CollaboratorPeriodoReferencia;
  activo?: boolean;
};

function whatsappNotas(source?: 'web' | 'whatsapp', notas?: string): string | null {
  const clean = String(notas ?? '').trim();
  if (clean) return clean;
  return source === 'whatsapp' ? 'Alta vía WhatsApp RILO Bot' : null;
}

export async function createCollaborator(
  input: CreateCollaboratorInput
): Promise<{ id: string; name: string; modalidad: CollaboratorModalidad; activo: boolean }> {
  const parsed = parseCollaboratorInput({
    nombre: input.name,
    telefono: input.telefono,
    email: input.email,
    notas: whatsappNotas(input.source, input.notas),
    modalidad: input.modalidad,
    valorHora: input.valorHora,
    montoFijoPeriodo: input.montoFijoPeriodo,
    periodoReferencia: input.periodoReferencia,
    activo: true,
  });
  if (!parsed) throw new Error('Indicá el nombre del colaborador.');

  const now = new Date().toISOString();
  const docRef = await collaboratorsCollection(input.businessId).add({
    ...parsed,
    createdAt: now,
    updatedAt: now,
  });

  console.info(
    '[v4:collaborator:execute]',
    JSON.stringify({ action: 'create', businessId: input.businessId, colaboradorId: docRef.id })
  );

  return {
    id: docRef.id,
    name: parsed.nombre,
    modalidad: parsed.modalidad,
    activo: parsed.activo,
  };
}

export async function updateCollaborator(
  input: UpdateCollaboratorInput
): Promise<{ id: string; name: string; activo: boolean }> {
  const colaboradorId = String(input.colaboradorId ?? '').trim();
  if (!colaboradorId) throw new Error('Indicá el colaborador.');

  const existing = await getCollaborator(input.businessId, colaboradorId);
  if (!existing) throw new Error('No encontré ese colaborador.');

  const body: Record<string, unknown> = {
    nombre: input.name ?? existing.nombre,
    telefono: input.telefono !== undefined ? input.telefono : existing.telefono,
    email: input.email !== undefined ? input.email : existing.email,
    notas: input.notas !== undefined ? input.notas : existing.notas,
    modalidad: input.modalidad ?? existing.modalidad,
    valorHora: input.valorHora !== undefined ? input.valorHora : existing.valorHora,
    montoFijoPeriodo:
      input.montoFijoPeriodo !== undefined ? input.montoFijoPeriodo : existing.montoFijoPeriodo,
    periodoReferencia: input.periodoReferencia ?? existing.periodoReferencia,
    activo: input.activo !== undefined ? input.activo : existing.activo,
  };

  const parsed = parseCollaboratorInput(body);
  if (!parsed) throw new Error('Indicá el nombre del colaborador.');

  const updatedAt = new Date().toISOString();
  await collaboratorsCollection(input.businessId).doc(colaboradorId).update({
    ...parsed,
    updatedAt,
  });

  console.info(
    '[v4:collaborator:execute]',
    JSON.stringify({
      action: input.activo === false ? 'disable' : 'update',
      businessId: input.businessId,
      colaboradorId,
    })
  );

  return { id: colaboradorId, name: parsed.nombre, activo: parsed.activo };
}
