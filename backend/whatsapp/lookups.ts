import { db } from '../firebase.ts';

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export type MatchedClient = { id: string; nombre: string; score: number };
export type MatchedStockItem = {
  id: string;
  nombre: string;
  precioVenta: number;
  costo: number;
  score: number;
};

function scoreNameMatch(query: string, nombreNormalized: string): number {
  if (!query || !nombreNormalized) return 0;
  if (nombreNormalized === query) return 100;
  if (nombreNormalized.startsWith(query) || query.startsWith(nombreNormalized)) return 85;

  const queryTokens = query.split(' ').filter(Boolean);
  const nameTokens = nombreNormalized.split(' ').filter(Boolean);
  if (queryTokens.length && queryTokens.every((token) => nameTokens.some((n) => n.startsWith(token) || token.startsWith(n)))) {
    return 75;
  }

  if (nombreNormalized.includes(query) || query.includes(nombreNormalized)) return 60;

  const overlap = queryTokens.filter((token) =>
    nameTokens.some((n) => n.includes(token) || token.includes(n))
  ).length;
  if (overlap > 0) return 50 + overlap * 5;

  return 0;
}

/** Devuelve candidatos similares ordenados por score (máx. 8). */
export async function findClientsByName(
  businessId: string,
  name: string,
  options?: { minScore?: number; limit?: number }
): Promise<MatchedClient[]> {
  const query = normalizeName(name);
  if (!query || query.length < 2) return [];

  const minScore = options?.minScore ?? 50;
  const limit = options?.limit ?? 8;
  const snap = await db.collection(`negocios/${businessId}/clientes`).get();
  const matches: MatchedClient[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as { nombre?: string; activo?: boolean };
    if (data.activo === false) continue;
    const nombre = String(data.nombre ?? '').trim();
    if (!nombre) continue;
    const score = scoreNameMatch(query, normalizeName(nombre));
    if (score < minScore) continue;
    matches.push({ id: doc.id, nombre, score });
  }

  return matches.sort((a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre, 'es')).slice(0, limit);
}

/**
 * Resuelve cliente:
 * - exacto/único claro → unique
 * - varios similares → ambiguous (para que el usuario elija)
 * - ninguno → none
 */
export async function resolveClientMatch(
  businessId: string,
  name: string
): Promise<
  | { status: 'unique'; client: MatchedClient }
  | { status: 'ambiguous'; candidates: MatchedClient[]; query: string }
  | { status: 'none'; query: string }
> {
  const query = String(name ?? '').trim();
  if (!query) return { status: 'none', query: '' };

  const candidates = await findClientsByName(businessId, query);
  if (!candidates.length) return { status: 'none', query };

  const top = candidates[0]!;
  const close = candidates.filter((c) => c.score >= Math.max(50, top.score - 20));

  // Match exacto o casi exacto y sin empate cercano
  if (top.score >= 95 && close.length === 1) {
    return { status: 'unique', client: top };
  }

  // Un solo candidato razonable
  if (candidates.length === 1 && top.score >= 60) {
    return { status: 'unique', client: top };
  }

  // Varios parecidos o un match flojo → preguntar
  if (close.length > 1 || top.score < 85) {
    return { status: 'ambiguous', candidates: close.length ? close : candidates, query };
  }

  return { status: 'unique', client: top };
}

export async function findClientByName(
  businessId: string,
  name: string
): Promise<Omit<MatchedClient, 'score'> | null> {
  const resolved = await resolveClientMatch(businessId, name);
  if (resolved.status !== 'unique') return null;
  return { id: resolved.client.id, nombre: resolved.client.nombre };
}

export async function findStockItemsByName(
  businessId: string,
  name: string,
  options?: { minScore?: number; limit?: number }
): Promise<MatchedStockItem[]> {
  const query = normalizeName(name);
  if (!query || query.length < 2) return [];

  const minScore = options?.minScore ?? 50;
  const limit = options?.limit ?? 8;
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  const matches: MatchedStockItem[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as {
      nombre?: string;
      precioVenta?: number;
      precio?: number;
      costo?: number;
      activo?: boolean;
    };
    if (data.activo === false) continue;
    const nombre = String(data.nombre ?? '').trim();
    if (!nombre) continue;
    const score = scoreNameMatch(query, normalizeName(nombre));
    if (score < minScore) continue;
    matches.push({
      id: doc.id,
      nombre,
      precioVenta: Number(data.precioVenta ?? data.precio) || 0,
      costo: Number(data.costo) || 0,
      score,
    });
  }

  return matches.sort((a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre, 'es')).slice(0, limit);
}

export async function resolveProductMatch(
  businessId: string,
  name: string
): Promise<
  | { status: 'unique'; product: MatchedStockItem }
  | { status: 'ambiguous'; candidates: MatchedStockItem[]; query: string }
  | { status: 'none'; query: string }
> {
  const query = String(name ?? '').trim();
  if (!query) return { status: 'none', query: '' };

  const candidates = await findStockItemsByName(businessId, query);
  if (!candidates.length) return { status: 'none', query };

  const top = candidates[0]!;
  const close = candidates.filter((c) => c.score >= Math.max(50, top.score - 20));

  if (top.score >= 95 && close.length === 1) {
    return { status: 'unique', product: top };
  }
  // Cualquier parecido (aunque sea uno) se confirma para evitar duplicados por typos
  return {
    status: 'ambiguous',
    candidates: close.length ? close : candidates,
    query,
  };
}

export async function findStockItemByName(
  businessId: string,
  name: string
): Promise<Omit<MatchedStockItem, 'score'> | null> {
  const resolved = await resolveProductMatch(businessId, name);
  if (resolved.status !== 'unique') return null;
  const { score: _score, ...product } = resolved.product;
  return product;
}

export function extractAmountFromText(text: string): number | null {
  const match =
    text.match(/\$\s*([\d.]+(?:,\d{2})?)/) ||
    text.match(/\b([\d.]+(?:,\d{2})?)\s*(?:pesos|\$)?\b/i);
  if (!match) return null;
  const raw = match[1]!.replace(/\./g, '').replace(',', '.');
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function extractClientHintFromText(text: string): string | null {
  const match =
    text.match(/\b(?:para|a|de|cliente)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][\wÁÉÍÓÚÜÑáéíóúüñ .'-]{1,40})/i) ||
    text.match(/\bsaldo\s+(?:de\s+)?([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][\wÁÉÍÓÚÜÑáéíóúüñ .'-]{1,40})/i);
  if (!match) return null;
  return match[1]!.trim().replace(/[.,;:!?]+$/, '');
}

export function formatClientChoices(candidates: Array<{ nombre: string }>, query?: string): string {
  const lines = candidates.map((c, index) => `${index + 1}) ${c.nombre}`);
  const header = query
    ? `Encontré varios clientes parecidos a "${query}":`
    : 'Encontré varios clientes parecidos:';
  return `${header}\n${lines.join('\n')}\nRespondé el número (ej. 1) o NO para cancelar.`;
}

export function formatProductChoices(
  candidates: Array<{ nombre: string; precioVenta?: number }>,
  query?: string,
  options?: { allowCreate?: boolean }
): string {
  const lines = candidates.map((c, index) => {
    const price = Number(c.precioVenta) || 0;
    return price > 0 ? `${index + 1}) ${c.nombre} ($${price})` : `${index + 1}) ${c.nombre}`;
  });
  if (options?.allowCreate !== false && query?.trim()) {
    lines.push(`${candidates.length + 1}) Crear nuevo: "${query.trim()}"`);
  }
  const header = query
    ? `Encontré productos parecidos a "${query}". ¿Usamos uno guardado?`
    : 'Encontré productos parecidos:';
  return `${header}\n${lines.join('\n')}\nRespondé el número (ej. 1) o NO para cancelar.`;
}

export function formatOperationSummary(
  intent: string,
  entities: {
    clientName?: string;
    productName?: string;
    quantity?: number;
    amount?: number;
    notes?: string;
    paid?: boolean;
    mediaId?: string;
    imageSummary?: string;
    cashType?: 'ingreso' | 'egreso';
    cashConcept?: string;
  }
): string {
  const actionLabel: Record<string, string> = {
    create_order: 'Registrar PEDIDO',
    create_sale: 'Registrar VENTA',
    register_payment: 'Registrar COBRO',
    query_balance: 'Consultar SALDO',
    query_cash: 'Consultar CAJA',
    register_cash: 'Registrar MOVIMIENTO DE CAJA',
  };

  const lines = [`Resumen — ${actionLabel[intent] ?? intent}`];

  if (intent === 'query_cash') {
    lines.push('• Período: hoy');
    lines.push('¿Confirmás? Respondé SÍ o NO.');
    return lines.join('\n');
  }

  if (intent === 'register_cash') {
    const tipo = entities.cashType === 'egreso' ? 'Egreso / gasto' : 'Ingreso';
    lines.push(`• Tipo: ${tipo}`);
    lines.push(`• Concepto: ${entities.cashConcept?.trim() || entities.notes?.trim() || '(sin detalle)'}`);
    lines.push(`• Monto: ${entities.amount != null ? `$${entities.amount}` : '(sin definir)'}`);
    lines.push('¿Confirmás? Respondé SÍ o NO.');
    return lines.join('\n');
  }

  lines.push(`• Cliente: ${entities.clientName?.trim() || '(sin definir)'}`);

  if (intent === 'create_order' || intent === 'create_sale') {
    lines.push(
      `• Producto/concepto: ${entities.productName?.trim() || entities.imageSummary?.trim() || entities.notes?.trim() || '(sin detalle)'}`
    );
    if (entities.quantity != null) lines.push(`• Cantidad: ${entities.quantity}`);
  }

  if (intent !== 'query_balance') {
    lines.push(
      `• Monto: ${entities.amount != null ? `$${entities.amount}` : '(sin definir)'}`
    );
  }

  if (intent === 'create_sale' && entities.paid != null) {
    lines.push(`• Cobrado ahora: ${entities.paid ? 'Sí' : 'No (queda saldo)'}`);
  }

  if (entities.mediaId) {
    lines.push(`• Foto: sí${entities.imageSummary ? ` (${entities.imageSummary})` : ''}`);
  }

  if (entities.notes?.trim() && entities.notes.trim() !== entities.productName?.trim()) {
    lines.push(`• Notas: ${entities.notes.trim().slice(0, 120)}`);
  }

  lines.push('¿Confirmás? Respondé SÍ o NO.');
  return lines.join('\n');
}
