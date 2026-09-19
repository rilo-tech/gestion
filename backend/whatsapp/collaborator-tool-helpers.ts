import type { ToolExecutionContext } from './agent/tool-types.ts';
import { findCollaborator } from '../domain/collaborator/index.ts';
import { resolveCollaboratorTargetFromContext } from './v4-conversation-context.ts';
import type { WhatsappCollaboratorGate } from './collaborator-access.ts';
import { resolveQueryDateRange } from './query-policy.ts';

export async function resolveCollaboratorIdFromArgs(
  ctx: ToolExecutionContext,
  args: Record<string, unknown>,
  gate?: WhatsappCollaboratorGate
): Promise<{ colaboradorId: string; name: string }> {
  const direct = String(args.collaboratorId ?? args.colaboradorId ?? '').trim();
  if (direct) {
    return {
      colaboradorId: direct,
      name: String(args.name ?? ctx.state?.focusEntities?.collaborator?.name ?? ''),
    };
  }
  const targetReference = String(args.targetReference ?? '').trim();
  if (targetReference) {
    const resolved = await resolveCollaboratorTargetFromContext(ctx, { targetReference });
    return { colaboradorId: resolved.colaboradorId, name: resolved.name };
  }
  const query = String(args.query ?? ctx.state?.focusEntities?.collaborator?.name ?? '').trim();
  if (!query) throw new Error('Indicá el colaborador.');
  const resolved = await findCollaborator(ctx.tenant.businessId, query, { scope: gate?.scope });
  if (resolved.status === 'not_found') throw new Error(`No encontré un colaborador llamado ${query}.`);
  if (resolved.status === 'ambiguous') throw new Error(`Encontré más de un colaborador parecido a ${query}.`);
  return { colaboradorId: resolved.entity!.id, name: resolved.entity!.name };
}

export function collaboratorDateRange(args: Record<string, unknown>, today: string): { from: string; to: string } {
  const token = String(args.dateRange ?? args.month ?? args.date ?? '').trim();
  const range = resolveQueryDateRange(token, today);
  const from = String(args.from ?? range?.from ?? today).slice(0, 10);
  const to = String(args.to ?? range?.to ?? today).slice(0, 10);
  return { from, to };
}
