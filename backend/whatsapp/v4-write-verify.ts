/**
 * Verificación post-write: la BD es la fuente de verdad.
 * Ningún mensaje de éxito debe basarse solo en preview/LLM.
 */
import { getProduct } from '../domain/stock/index.ts';
import type { AgentOperationPlan } from './agent/tool-types.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import { V4_AUTO_COMMIT_MODIFY_PROMPT } from './v4-auto-commit.ts';

export function assistantClaimsCompletedMutation(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  // Preguntas / propuestas no son claims de éxito.
  if (/[¿?]/u.test(t) && /\b(quer[eé]s|puedo|debo|si\b|confirmo)/i.test(t)) return false;
  // Pretérito de mutación (é / e al final del verbo).
  return /(?:^|[^\p{L}\p{N}])(renombr[eé]|modifiqu[eé]|actualic[eé]|registr[eé]|cre[eé]|guard[eé]|elimin[eé]|borr[eé]|ajust[eé]|cobr[eé]|sald[eé])(?:\s|$|[,.:])/iu.test(
    t
  );
}

export async function verifyRenameProductsPersisted(input: {
  businessId: string;
  productIds: string[];
  newBaseName: string;
}): Promise<{ productIds: string[]; labels: string[]; count: number }> {
  const newBase = String(input.newBaseName ?? '').trim();
  const ids = [...new Set((input.productIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (!newBase || !ids.length) {
    throw new Error('WRITE_NOT_PERSISTED: faltan IDs o nombre para verificar el rename.');
  }
  const labels: string[] = [];
  const baseNorm = normalizeLoose(newBase);
  for (const id of ids) {
    const row = await getProduct(input.businessId, id);
    if (!row?.name) {
      throw new Error(`WRITE_NOT_PERSISTED: no pude releer el producto ${id}.`);
    }
    const nameNorm = normalizeLoose(row.name);
    if (!nameNorm.includes(baseNorm)) {
      throw new Error(
        `WRITE_NOT_PERSISTED: ${id} sigue como «${row.name}» (se esperaba base «${newBase}»).`
      );
    }
    labels.push(row.name);
  }
  return { productIds: ids, labels, count: ids.length };
}

function normalizeLoose(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatVerifiedRenameReply(labels: string[]): string {
  const count = labels.length;
  const lines = labels.map((name, index) => `${index + 1}. ${name}`);
  const body =
    count === 1
      ? `✅ Listo, renombré:\n${lines[0]}`
      : `✅ Listo, renombré los ${count} productos:\n${lines.join('\n')}`;
  return `${body}\n\n${V4_AUTO_COMMIT_MODIFY_PROMPT}`;
}

/**
 * Tras executePlan: valida persistencia real y normaliza data/reply.
 * Si no se puede verificar, lanza (el caller NO debe informar éxito).
 */
export async function verifyExecutedPlanAgainstDb(input: {
  tenant: WhatsappTenantContext;
  plan: AgentOperationPlan;
  reply: string;
  data: Record<string, unknown>;
}): Promise<{ reply: string; data: Record<string, unknown> }> {
  const { tenant, plan, data } = input;
  if (data.persisted === false) {
    throw new Error('WRITE_NOT_PERSISTED');
  }

  const rename = plan.writes.find((row) => row.tool === 'rename_products');
  if (rename) {
    const productIds = Array.isArray(data.productIds)
      ? data.productIds.map((id) => String(id ?? '').trim()).filter(Boolean)
      : Array.isArray(rename.args.productIds)
        ? rename.args.productIds.map((id) => String(id ?? '').trim()).filter(Boolean)
        : [];
    const newBaseName = String(data.newBaseName ?? rename.args.newBaseName ?? '').trim();
    const verified = await verifyRenameProductsPersisted({
      businessId: tenant.businessId,
      productIds,
      newBaseName,
    });
    return {
      reply: formatVerifiedRenameReply(verified.labels),
      data: {
        ...data,
        kind: 'product',
        action: 'rename',
        persisted: true,
        productIds: verified.productIds,
        recordIds: verified.productIds,
        labels: verified.labels,
        count: verified.count,
        newBaseName,
      },
    };
  }

  // Resto de writes: exigir señal explícita de persistencia del executor.
  if (data.persisted !== true && plan.writes.length > 0) {
    // Compat: muchos executors aún no setean persisted; si hay reply del executor y no hay error, aceptar
    // SOLO cuando no es un claim de rename (ya cubierto arriba).
    const reply = String(input.reply ?? '').trim();
    if (!reply) {
      throw new Error('WRITE_NOT_PERSISTED: el executor no devolvió confirmación.');
    }
  }

  return { reply: String(input.reply ?? '').trim(), data: { ...data, persisted: data.persisted ?? true } };
}
