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
  label: string;
  precioVenta: number;
  costo: number;
  score: number;
};

function scoreNameMatch(query: string, nombreNormalized: string): number {
  if (!query || !nombreNormalized) return 0;
  if (nombreNormalized === query) return 100;

  const queryTokens = query.split(' ').filter(Boolean);
  const nameTokens = nombreNormalized.split(' ').filter(Boolean);

  if (
    (nombreNormalized.startsWith(query) || query.startsWith(nombreNormalized)) &&
    Math.abs(queryTokens.length - nameTokens.length) <= 1
  ) {
    return 85;
  }

  const tokenFits = (queryToken: string, nameToken: string): boolean => {
    if (queryToken === nameToken) return true;
    // Talles cortos (L vs XL) no pueden matchear por substring.
    if (queryToken.length <= 3 || nameToken.length <= 3) return false;
    return (
      nameToken.startsWith(queryToken) ||
      queryToken.startsWith(nameToken) ||
      nameToken.includes(queryToken) ||
      queryToken.includes(nameToken)
    );
  };

  if (queryTokens.length && queryTokens.every((token) => nameTokens.some((n) => tokenFits(token, n)))) {
    return 75;
  }

  if (
    Math.abs(queryTokens.length - nameTokens.length) <= 2 &&
    (nombreNormalized.includes(query) || query.includes(nombreNormalized))
  ) {
    return 60;
  }

  const overlap = queryTokens.filter((token) => nameTokens.some((n) => tokenFits(token, n))).length;
  if (overlap > 0) return 50 + overlap * 5;

  return 0;
}

/** Nombres de persona: no asume Silva vs Silveira ni un nombre de pila solo. */
function scorePersonNameMatch(query: string, nombreNormalized: string): number {
  if (!query || !nombreNormalized) return 0;
  if (nombreNormalized === query) return 100;

  const queryTokens = query.split(' ').filter(Boolean);
  const nameTokens = nombreNormalized.split(' ').filter(Boolean);
  if (!queryTokens.length || !nameTokens.length) return 0;

  const exactHits = queryTokens.filter((token) => nameTokens.includes(token)).length;
  if (exactHits === queryTokens.length && queryTokens.length === nameTokens.length) {
    return 95;
  }
  if (exactHits === queryTokens.length && queryTokens.length >= 2) {
    return 80;
  }
  if (exactHits === queryTokens.length && queryTokens.length === 1) {
    return 70;
  }
  if (exactHits > 0) {
    return 50 + exactHits * 5;
  }
  return 0;
}

function productLabel(data: { nombre?: string; color?: string; talle?: string }): string {
  const nombre = String(data.nombre ?? '').trim();
  const extra = [data.color, data.talle]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return extra.length ? `${nombre} (${extra.join(', ')})` : nombre;
}

function productSearchHaystack(data: { nombre?: string; color?: string; talle?: string }): string {
  return [data.nombre, data.color, data.talle]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ');
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
    const score = scorePersonNameMatch(query, normalizeName(nombre));
    if (score < minScore) continue;
    matches.push({ id: doc.id, nombre, score });
  }

  return matches.sort((a, b) => b.score - a.score || a.nombre.localeCompare(b.nombre, 'es')).slice(0, limit);
}

/**
 * Resuelve cliente:
 * - nombre completo exacto y sin empate → unique
 * - cualquier parecido (María / María Silva / Silveira) → ambiguous, para que elija
 * - ninguno → none (ofrecer registrar)
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

  if (top.score >= 95 && close.length === 1) {
    return { status: 'unique', client: top };
  }

  return {
    status: 'ambiguous',
    candidates: close.length ? close : candidates,
    query,
  };
}

export async function findClientByName(
  businessId: string,
  name: string
): Promise<Omit<MatchedClient, 'score'> | null> {
  const resolved = await resolveClientMatch(businessId, name);
  if (resolved.status !== 'unique') return null;
  return { id: resolved.client.id, nombre: resolved.client.nombre };
}

export type MatchedSupplier = { id: string; nombre: string; score: number };

export async function findSuppliersByName(
  businessId: string,
  name: string,
  options?: { minScore?: number; limit?: number }
): Promise<MatchedSupplier[]> {
  const query = normalizeName(name);
  if (!query || query.length < 2) return [];

  const minScore = options?.minScore ?? 50;
  const limit = options?.limit ?? 8;
  const snap = await db.collection(`negocios/${businessId}/proveedores`).get();
  const matches: MatchedSupplier[] = [];

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

export async function resolveSupplierMatch(
  businessId: string,
  name: string
): Promise<
  | { status: 'unique'; supplier: MatchedSupplier }
  | { status: 'ambiguous'; candidates: MatchedSupplier[]; query: string }
  | { status: 'none'; query: string }
> {
  const query = String(name ?? '').trim();
  if (!query) return { status: 'none', query: '' };

  const candidates = await findSuppliersByName(businessId, query);
  if (!candidates.length) return { status: 'none', query };

  const top = candidates[0]!;
  const close = candidates.filter((c) => c.score >= Math.max(50, top.score - 20));

  if (top.score >= 95 && close.length === 1) {
    return { status: 'unique', supplier: top };
  }

  return {
    status: 'ambiguous',
    candidates: close.length ? close : candidates,
    query,
  };
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
      talle?: string;
      color?: string;
      precioVenta?: number;
      precio?: number;
      costo?: number;
      activo?: boolean;
    };
    if (data.activo === false) continue;
    const nombre = String(data.nombre ?? '').trim();
    if (!nombre) continue;
    const score = scoreNameMatch(query, normalizeName(productSearchHaystack(data)));
    if (score < minScore) continue;
    matches.push({
      id: doc.id,
      nombre,
      label: productLabel(data),
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
  const name = '([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\'-]*)(?:\\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\'-]*){0,2}';
  const match =
    text.match(new RegExp(`\\b(?:para|a|de|cliente)\\s+(${name})`, 'i')) ||
    text.match(new RegExp(`\\bsaldo\\s+(?:de\\s+)?(${name})`, 'i'));
  if (!match) return null;
  return match[1]!.trim().replace(/[.,;:!?]+$/, '');
}

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayLocal(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function nextWeekday(from: Date, weekday: number): Date {
  const delta = (weekday - from.getDay() + 7) % 7;
  return addDays(from, delta);
}

function normalizeDateText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parseLooseDate(text: string): string | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const normalized = normalizeDateText(raw);
  const today = todayLocal();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10))) return raw.slice(0, 10);
  if (/\bhoy\b/.test(normalized)) return toDateOnly(today);
  if (/\bpasado\s+manana\b/.test(normalized)) return toDateOnly(addDays(today, 2));
  if (/\bmanana\b/.test(normalized)) return toDateOnly(addDays(today, 1));

  for (const [name, weekday] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(normalized)) {
      return toDateOnly(nextWeekday(today, weekday));
    }
  }

  const dmy = normalized.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = dmy[3] ? Number(dmy[3]) : today.getFullYear();
    if (year < 100) year += 2000;
    const date = new Date(year, month - 1, day);
    if (date.getMonth() === month - 1 && date.getDate() === day) return toDateOnly(date);
  }

  const named = normalized.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2]!] ?? 0;
    if (month) {
      const date = new Date(today.getFullYear(), month - 1, day);
      if (date.getDate() === day) return toDateOnly(date);
    }
  }

  return null;
}

/** Fecha de entrega si el texto habla de entrega; si no, cualquier fecha suelta. */
export function extractDeliveryDateFromText(text: string): string | null {
  const raw = String(text ?? '');
  const deliveryChunk = raw.match(
    /\b(?:entrega(?:r)?|entregarlo|para el|para el d[ií]a)[:\s]+([^.,;]+)/i
  );
  if (deliveryChunk) {
    const parsed = parseLooseDate(deliveryChunk[1] ?? '');
    if (parsed) return parsed;
  }
  return parseLooseDate(raw);
}

export function extractOrderDateFromText(text: string): string | null {
  const raw = String(text ?? '');
  const chunk = raw.match(/\b(?:carg[oa]do|fecha de carga|registr(?:o|ado)|hoy lo cargo)[:\s]+([^.,;]+)/i);
  if (chunk) return parseLooseDate(chunk[1] ?? '');
  if (/\bhoy\b/i.test(raw) && /\b(cargo|cargarlo|pedido|venta)\b/i.test(raw)) {
    return toDateOnly(todayLocal());
  }
  return null;
}

export function formatDateOnlyEs(value?: string | null): string {
  if (!value) return '';
  const iso = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return value;
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

export function todayDateOnly(): string {
  return toDateOnly(todayLocal());
}

export function coerceDateOnly(value?: string | null): string | undefined {
  const parsed = parseLooseDate(String(value ?? ''));
  return parsed ?? undefined;
}

export function formatClientChoices(
  candidates: Array<{ nombre: string }>,
  query?: string,
  options?: { allowCreate?: boolean }
): string {
  const lines = candidates.map((c, index) => `${index + 1}) ${c.nombre}`);
  if (options?.allowCreate !== false && query?.trim()) {
    lines.push(`${candidates.length + 1}) Registrar nuevo: "${query.trim()}"`);
  }
  const header = query
    ? `¿A qué cliente te referís con "${query}"?`
    : 'Encontré clientes parecidos:';
  return `${header}\n${lines.join('\n')}\nRespondé el número (ej. 1) o NO para cancelar.`;
}

export function formatSupplierChoices(
  candidates: Array<{ nombre: string }>,
  query?: string,
  options?: { allowCreate?: boolean }
): string {
  const lines = candidates.map((c, index) => `${index + 1}) ${c.nombre}`);
  if (options?.allowCreate !== false && query?.trim()) {
    lines.push(`${candidates.length + 1}) Registrar nuevo: "${query.trim()}"`);
  }
  const header = query
    ? `¿A qué proveedor te referís con "${query}"?`
    : 'Encontré proveedores parecidos:';
  return `${header}\n${lines.join('\n')}\nRespondé el número (ej. 1) o NO para cancelar.`;
}

export function formatProductChoices(
  candidates: Array<{ nombre: string; label?: string; precioVenta?: number }>,
  query?: string,
  options?: { allowCreate?: boolean }
): string {
  const lines = candidates.map((c, index) => {
    const name = c.label?.trim() || c.nombre;
    const price = Number(c.precioVenta) || 0;
    return price > 0 ? `${index + 1}) ${name} ($${price})` : `${index + 1}) ${name}`;
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
    orderDate?: string;
    deliveryDate?: string;
    supplierName?: string;
    invoiceNumber?: string;
    purchaseLines?: Array<{ productName?: string; quantity?: number; unitCost?: number }>;
    paymentMedioId?: string;
    paymentMedioLabel?: string;
    paymentTarjetaLabel?: string;
    paymentCuotas?: number;
    saveAsDraft?: boolean;
    paymentIncompleteReason?: string;
  }
): string {
  const actionLabel: Record<string, string> = {
    create_order: 'Registrar PEDIDO',
    create_sale: 'Registrar VENTA',
    create_purchase: 'Registrar COMPRA (suma stock)',
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

  if (intent === 'create_purchase') {
    const isDraft = entities.saveAsDraft === true;
    lines[0] = isDraft
      ? 'Resumen — Guardar BORRADOR de compra'
      : 'Resumen — Registrar COMPRA (stock + pago, igual que el panel)';
    lines.push(`• Proveedor: ${entities.supplierName?.trim() || '(sin definir)'}`);
    if (entities.invoiceNumber?.trim()) {
      lines.push(`• Comprobante: ${entities.invoiceNumber.trim()}`);
    }
    const purchaseLines = entities.purchaseLines ?? [];
    if (purchaseLines.length) {
      for (const line of purchaseLines.slice(0, 12)) {
        const qty = Math.max(1, Number(line.quantity) || 1);
        const cost = Number(line.unitCost) || 0;
        const name = String(line.productName ?? '').trim() || 'Ítem';
        lines.push(`• ${qty} × ${name}${cost > 0 ? ` @ $${cost}` : ''}`);
      }
      if (purchaseLines.length > 12) {
        lines.push(`• … y ${purchaseLines.length - 12} ítem(s) más`);
      }
    } else {
      lines.push(
        `• Producto: ${entities.productName?.trim() || entities.imageSummary?.trim() || '(sin detalle)'}`
      );
    }
    const total =
      entities.amount != null
        ? entities.amount
        : purchaseLines.reduce(
            (acc, line) =>
              acc + Math.max(1, Number(line.quantity) || 1) * (Number(line.unitCost) || 0),
            0
          );
    lines.push(`• Total: ${total > 0 ? `$${total}` : '(sin definir)'}`);
    if (entities.mediaId) {
      lines.push(`• Foto: sí${entities.imageSummary ? ` (${entities.imageSummary})` : ''}`);
    }
    if (isDraft) {
      lines.push(
        `• Pago: ${entities.paymentIncompleteReason?.trim() || 'lo completás en el panel'}`
      );
      lines.push('Al confirmar se guarda el borrador. No mueve stock ni caja hasta que lo confirmes en Compras.');
    } else {
      const pago = [entities.paymentMedioLabel || entities.paymentMedioId || '(sin definir)'];
      if (entities.paymentTarjetaLabel) pago.push(entities.paymentTarjetaLabel);
      const cuotas = Number(entities.paymentCuotas) || 1;
      if (cuotas > 1) pago.push(`${cuotas} cuotas`);
      lines.push(`• Pago: ${pago.join(' · ')}`);
      lines.push('Al confirmar se registra la compra, se suma el stock y se aplica el medio de pago (caja o cuentas a pagar).');
    }
    lines.push('¿Confirmás? Respondé SÍ o NO.');
    return lines.join('\n');
  }

  lines.push(`• Cliente: ${entities.clientName?.trim() || '(sin definir)'}`);

  if (intent === 'create_order' || intent === 'create_sale') {
    lines.push(
      `• Producto/concepto: ${entities.productName?.trim() || entities.imageSummary?.trim() || entities.notes?.trim() || '(sin detalle)'}`
    );
    if (entities.quantity != null) lines.push(`• Cantidad: ${entities.quantity}`);
    const carga = formatDateOnlyEs(entities.orderDate);
    if (carga) lines.push(`• Fecha de carga: ${carga}`);
  }

  if (intent === 'create_order') {
    const entrega = formatDateOnlyEs(entities.deliveryDate);
    lines.push(`• Fecha de entrega: ${entrega || '(sin definir)'}`);
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
