import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { isPrivilegedRole } from '../auth/constants.ts';
import { getStoredUser } from '../auth/users.ts';

export type CollaboratorAccessScope =
  | { mode: 'all' }
  | { mode: 'own'; colaboradorId: string };

export class CollaboratorScopeError extends Error {
  constructor(message = 'No tenés permiso para ver datos de otro colaborador.') {
    super(message);
    this.name = 'CollaboratorScopeError';
  }
}

export async function resolveCollaboratorAccessScope(
  businessId: string,
  req: AuthenticatedRequest
): Promise<CollaboratorAccessScope> {
  const auth = req.auth;
  if (!auth || auth.scope !== 'company') return { mode: 'all' };

  const user = await getStoredUser(businessId, auth.userId);
  if (!user || isPrivilegedRole(user.rol)) return { mode: 'all' };

  const colaboradorId = String(user.colaboradorId ?? '').trim();
  if (colaboradorId) return { mode: 'own', colaboradorId };
  return { mode: 'all' };
}

export function resolveScopedCollaboratorId(
  scope: CollaboratorAccessScope,
  requestedId?: string
): string | undefined {
  if (scope.mode === 'own') return scope.colaboradorId;
  const id = String(requestedId ?? '').trim();
  return id || undefined;
}

export function assertCollaboratorInScope(
  scope: CollaboratorAccessScope,
  colaboradorId: string
): void {
  if (scope.mode === 'all') return;
  if (scope.colaboradorId !== String(colaboradorId ?? '').trim()) {
    throw new CollaboratorScopeError();
  }
}

export function assertCanManageCollaboratorTeam(scope: CollaboratorAccessScope): void {
  if (scope.mode === 'own') {
    throw new CollaboratorScopeError('No tenés permiso para gestionar el equipo.');
  }
}
