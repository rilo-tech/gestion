import { db } from '../firebase.ts';
import {
  normalizeCollaboratorExtraTipos,
  type CollaboratorExtraTipoConfig,
} from '../../shared/collaborators-config.ts';

export type { CollaboratorExtraTipoConfig };

export async function loadCollaboratorExtraTipos(
  businessId: string
): Promise<CollaboratorExtraTipoConfig[]> {
  const appDoc = await db.doc(`negocios/${businessId}/config/app`).get();
  const data = appDoc.exists ? (appDoc.data() as Record<string, unknown>) : {};
  const colaboradores = (data.colaboradores as Record<string, unknown>) ?? {};
  return normalizeCollaboratorExtraTipos(colaboradores.tiposExtra);
}
