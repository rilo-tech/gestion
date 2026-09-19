import { formatWhatsappMessage } from '../../shared/whatsapp-format.ts';
import type { AgentOperationPlan } from './agent/tool-types.ts';
import type { ConversationState } from './conversation-state.ts';

/**
 * Presentación post auto-commit.
 * La decisión execute vs confirm vive en `v4-write-disposition.ts` — reexportamos
 * para compat de imports antiguos, sin duplicar lógica.
 */
export {
  AUTO_COMMIT_WRITE_TOOLS,
  classifyPreparedPlan,
  decidePreparedWriteExecution,
  planAllowsAutoCommit,
  writeToolAllowsAutoCommit,
} from './v4-write-disposition.ts';

export const V4_AUTO_COMMIT_MODIFY_PROMPT = 'Si querés hacer algún otro cambio, decime.';

function autoCommitTitle(plan: AgentOperationPlan): string {
  const tools = new Set(plan.writes.map((row) => row.tool));
  if (tools.size === 1 && tools.has('register_collaborator_hours')) return 'Horas registradas';
  if (tools.size === 1 && tools.has('register_collaborator_extra')) return 'Extra registrado';
  if (tools.size === 1 && tools.has('update_collaborator_movement')) return 'Registro actualizado';
  if (tools.size === 1 && tools.has('rename_products')) return 'Productos renombrados';
  if (tools.size === 1 && tools.has('create_client')) return 'Cliente creado';
  if (tools.size === 1 && tools.has('update_client')) return 'Cliente actualizado';
  if (tools.size === 1 && tools.has('create_product')) return 'Producto creado';
  if (tools.size === 1 && tools.has('create_supplier')) return 'Proveedor creado';
  if (tools.size === 1 && tools.has('update_supplier')) return 'Proveedor actualizado';
  if (tools.size === 1 && tools.has('create_collaborator')) return 'Colaborador creado';
  if (tools.size === 1 && tools.has('update_collaborator')) return 'Colaborador actualizado';
  const title = plan.summary.title?.trim() || 'Listo';
  return title.replace(/^(✏️\s*)?cambiar\b/i, 'Cambié').replace(/^renombrar\b/i, 'Renombré');
}

/** Resumen post-ejecución cuando no hay reply del executor: pasado + oferta de modificar. */
export function presentAutoCommittedPlan(plan: AgentOperationPlan): string {
  return formatWhatsappMessage({
    title: autoCommitTitle(plan),
    lines: plan.summary.lines ?? [],
    ask: V4_AUTO_COMMIT_MODIFY_PROMPT,
  });
}

/**
 * Preferí el reply del executor (ya verificado contra BD).
 * NUNCA inventar éxito desde el resumen del plan (preview).
 */
export function presentDirectExecuteReply(
  executorReply: string | null | undefined,
  plan: AgentOperationPlan
): string {
  const base = String(executorReply ?? '').trim();
  if (!base) {
    return `No pude confirmar que el cambio quedó guardado. Probá de nuevo o pedime que lo verifique.\n\n${V4_AUTO_COMMIT_MODIFY_PROMPT}`;
  }
  if (base.includes(V4_AUTO_COMMIT_MODIFY_PROMPT)) return base;
  // Evitar anexar oferta si el texto ya es un error de persistencia.
  if (/no pude|no se pudo|WRITE_NOT_PERSISTED|quedó guardado/i.test(base)) return base;
  void plan;
  return `${base}\n\n${V4_AUTO_COMMIT_MODIFY_PROMPT}`;
}

export function autoCommitFocusPatch(
  plan: AgentOperationPlan,
  data: Record<string, unknown> | undefined,
  existing?: ConversationState['focusEntities']
): ConversationState['focusEntities'] | undefined {
  const write = plan.writes[0];
  if (!write) return existing;
  const collaboratorId = String(
    write.args.colaboradorId ?? data?.collaboratorId ?? ''
  ).trim();
  const collaboratorName = String(write.args.collaboratorName ?? data?.collaboratorName ?? '').trim();
  if (!collaboratorId) return existing;
  return {
    ...(existing ?? {}),
    collaborator: {
      id: collaboratorId,
      name: collaboratorName || collaboratorId,
      locked: true,
    },
  };
}
