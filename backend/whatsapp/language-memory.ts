import { db } from '../firebase.ts';

export type LanguageEntityType = 'product_term' | 'product' | 'client' | 'supplier';

export type LanguageAlias = {
  userExpression: string;
  resolvedMeaning: string;
  entityType: LanguageEntityType;
  entityId?: string;
  confidence: number;
  confirmations: number;
  lastUsedAt: string;
};

export type UserLanguageMemory = {
  aliases: LanguageAlias[];
  updatedAt?: string;
};

const MAX_ALIASES = 80;
const MIN_EXPRESSION = 3;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function phoneKey(phone: string): string {
  return phone.replace(/[^0-9+]/g, '') || 'unknown';
}

function memoryRef(businessId: string, phone: string) {
  return db.doc(`negocios/${businessId}/whatsapp_language/${phoneKey(phone)}`);
}

const CIRCUMSTANTIAL =
  /^(hoy|ma[nñ]ana|pasado|lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d+([.,]\d+)?|\$?\d+)$/i;

export function isLearnableExpression(expression: string, meaning: string): boolean {
  const from = normalize(expression);
  const to = normalize(meaning);
  if (!from || !to || from === to) return false;
  if (from.length < MIN_EXPRESSION) return false;
  if (CIRCUMSTANTIAL.test(from) || CIRCUMSTANTIAL.test(to)) return false;
  if (/^\d+$/.test(from)) return false;
  return true;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) grid[i]![0] = i;
  for (let j = 0; j < cols; j++) grid[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      grid[i]![j] = Math.min(
        grid[i - 1]![j]! + 1,
        grid[i]![j - 1]! + 1,
        grid[i - 1]![j - 1]! + cost
      );
    }
  }
  return grid[a.length]![b.length]!;
}

export function extractTermMapping(
  spoken: string,
  resolved: string
): { userExpression: string; resolvedMeaning: string } | null {
  const spokenNorm = normalize(spoken);
  const resolvedNorm = normalize(resolved);
  if (!isLearnableExpression(spokenNorm, resolvedNorm)) return null;
  const spokenTokens = spokenNorm.split(' ').filter((token) => token.length >= 3);
  const resolvedTokens = resolvedNorm.split(' ').filter((token) => token.length >= 3);
  for (const token of spokenTokens) {
    if (resolvedTokens.includes(token)) continue;
    let best: { token: string; distance: number } | null = null;
    for (const candidate of resolvedTokens) {
      const distance = levenshtein(token, candidate);
      if (distance >= 1 && distance <= 2 && token.length >= 4 && candidate.length >= 4) {
        if (!best || distance < best.distance) best = { token: candidate, distance };
      }
    }
    if (best) {
      return { userExpression: token, resolvedMeaning: best.token };
    }
  }
  if (spokenNorm !== resolvedNorm && spokenNorm.length <= 40) {
    return { userExpression: spokenNorm, resolvedMeaning: resolvedNorm };
  }
  return null;
}

function asAliasList(raw: unknown): LanguageAlias[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const userExpression = String((row as LanguageAlias)?.userExpression ?? '').trim();
      const resolvedMeaning = String((row as LanguageAlias)?.resolvedMeaning ?? '').trim();
      const rawType = String((row as LanguageAlias)?.entityType ?? 'product_term').trim();
      const entityType: LanguageEntityType =
        rawType === 'product' || rawType === 'client' || rawType === 'supplier' ? rawType : 'product_term';
      if (!userExpression || !resolvedMeaning) return null;
      const alias: LanguageAlias = {
        userExpression,
        resolvedMeaning,
        entityType,
        entityId: String((row as LanguageAlias)?.entityId ?? '').trim() || undefined,
        confidence: Math.min(1, Math.max(0, Number((row as LanguageAlias)?.confidence) || 0.9)),
        confirmations: Math.max(1, Number((row as LanguageAlias)?.confirmations) || 1),
        lastUsedAt: String((row as LanguageAlias)?.lastUsedAt ?? '') || new Date().toISOString(),
      };
      return alias;
    })
    .filter((row): row is LanguageAlias => row !== null)
    .slice(0, MAX_ALIASES);
}

export async function loadUserLanguageMemory(
  businessId: string,
  phone: string
): Promise<UserLanguageMemory> {
  const snap = await memoryRef(businessId, phone).get();
  const data = snap.data() ?? {};
  return {
    aliases: asAliasList(data.aliases),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
  };
}

export async function recordConfirmedLanguageMapping(input: {
  businessId: string;
  phone: string;
  userExpression: string;
  resolvedMeaning: string;
  entityType?: LanguageEntityType;
  entityId?: string;
}): Promise<LanguageAlias | null> {
  if (!isLearnableExpression(input.userExpression, input.resolvedMeaning)) return null;
  const memory = await loadUserLanguageMemory(input.businessId, input.phone);
  const key = normalize(input.userExpression);
  const meaning = normalize(input.resolvedMeaning);
  const now = new Date().toISOString();
  const existing = memory.aliases.find((alias) => normalize(alias.userExpression) === key);
  const next: LanguageAlias = existing
    ? {
        ...existing,
        resolvedMeaning: input.resolvedMeaning.trim(),
        entityId: input.entityId || existing.entityId,
        confirmations: existing.confirmations + 1,
        confidence: Math.min(0.99, existing.confidence + 0.03),
        lastUsedAt: now,
      }
    : {
        userExpression: input.userExpression.trim(),
        resolvedMeaning: input.resolvedMeaning.trim(),
        entityType: input.entityType ?? 'product_term',
        entityId: input.entityId,
        confidence: 0.92,
        confirmations: 1,
        lastUsedAt: now,
      };
  const aliases = [next, ...memory.aliases.filter((alias) => normalize(alias.userExpression) !== key)].slice(
    0,
    MAX_ALIASES
  );
  await memoryRef(input.businessId, input.phone).set(
    { aliases, updatedAt: now, phone: phoneKey(input.phone) },
    { merge: true }
  );
  void meaning;
  return next;
}

export function applyLanguageMemory(text: string, memory: UserLanguageMemory | LanguageAlias[]): string {
  const aliases = Array.isArray(memory) ? memory : memory.aliases;
  let out = String(text ?? '');
  const ranked = [...aliases]
    .filter((alias) => alias.confirmations >= 1 && alias.confidence >= 0.8)
    .sort((a, b) => b.userExpression.length - a.userExpression.length);
  for (const alias of ranked) {
    const from = alias.userExpression.trim();
    if (!from) continue;
    const already = new RegExp(`\\b${escapeRegExp(alias.resolvedMeaning)}\\b`, 'i');
    if (already.test(out)) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'gi');
    out = out.replace(pattern, alias.resolvedMeaning);
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatLanguageMemoryPrompt(memory: UserLanguageMemory): string {
  const lines = [...memory.aliases]
    .filter((alias) => alias.confirmations >= 1)
    .sort((a, b) => b.confirmations - a.confirmations)
    .slice(0, 20)
    .map((alias) => `- "${alias.userExpression}" → ${alias.resolvedMeaning} (${alias.confirmations} confirmaciones)`);
  if (!lines.length) return '';
  return [
    'Memoria de CÓMO HABLA ESTE usuario (solo expresiones que él confirmó). Es una ayuda, no una verdad absoluta.',
    'Si el mensaje actual contradice la memoria, manda el mensaje actual.',
    lines.join('\n'),
  ].join('\n');
}

export async function rememberSpokenProductTerms(input: {
  businessId: string;
  phone: string;
  spoken: string;
  resolvedName: string;
  productId?: string;
}): Promise<void> {
  const mapping = extractTermMapping(input.spoken, input.resolvedName);
  if (!mapping) return;
  await recordConfirmedLanguageMapping({
    businessId: input.businessId,
    phone: input.phone,
    userExpression: mapping.userExpression,
    resolvedMeaning: mapping.resolvedMeaning,
    entityType: 'product_term',
    entityId: input.productId,
  });
  if (normalize(input.spoken) !== normalize(mapping.userExpression)) {
    await recordConfirmedLanguageMapping({
      businessId: input.businessId,
      phone: input.phone,
      userExpression: input.spoken,
      resolvedMeaning: input.resolvedName,
      entityType: 'product',
      entityId: input.productId,
    });
  }
}
