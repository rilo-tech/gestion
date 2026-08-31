/**
 * Nombres de entidades (cliente, proveedor) como los dijo el dueño.
 * No se cortan por puntuación, @, números ni apodos: el texto original se conserva
 * y las variantes simplificadas son solo fallback de búsqueda.
 */

const PARTY_CUES: RegExp[] = [
  /\b(?:del|al)\s+cliente\s+/i,
  /\bcliente\s+/i,
  /\b(?:pedido|orden|venta)\s+(?:para|a|de)\s+/i,
];

const PRODUCT_BOUNDARY =
  /^(camiseta|remera|remeras|pantal[oó]n|pantalones|jean|jeans|buzo|short|shorts|talle|taza|hoodie|campera|vestido|pollera|algod[oó]n|polo|chomba|body|enterito|conjunto|oversize|producto|productos)$/i;

const SIZE_BOUNDARY = /^(xxxs|xxs|xs|s|m|l|xl|xxl|xxxl|xxxxl|2xl|3xl|4xl|5xl)$/i;

const NAME_PARTICLE = /^(de|del|la|las|los|el|y|e)$/i;

const ITEM_ARTICLE = /^(un|una|unos|unas)$/i;

const HARD_STOP =
  /^(descripci[oó]n|costos?|pedido|orden|venta|entregad[oa]s?|abiertos?|pendientes?)$/i;

export type SpokenPartySpan = {
  raw: string;
  cueStart: number;
  nameStart: number;
  nameEnd: number;
};

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isPunctuationToken(token: string): boolean {
  return /^[-–—/.,;:()]+$/.test(token);
}

function isHandleToken(token: string): boolean {
  return /^@[\p{L}\p{N}._-]+$/u.test(token);
}

function isParentheticalToken(token: string): boolean {
  return /^\([^)]*\)$/.test(token);
}

function isMoneyToken(token: string): boolean {
  return /^\$/.test(token);
}

function isQuantityBeforeProduct(token: string, next: string | undefined): boolean {
  if (!/^\d+(?:[.,]\d+)?$/.test(token) || !next) return false;
  return PRODUCT_BOUNDARY.test(next) || SIZE_BOUNDARY.test(fold(next));
}

/** Sufijo decorativo (apodo corto, handle, número, paréntesis), no el núcleo del nombre. */
export function isDecorativeEntitySuffix(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return true;
  if (isPunctuationToken(trimmed) || isHandleToken(trimmed) || isParentheticalToken(trimmed)) {
    return true;
  }
  const core = trimmed.replace(/^[(@]+|[).]+$/g, '');
  if (!core) return true;
  if (/^\d+$/.test(core)) return true;
  if (core.length <= 3 && !NAME_PARTICLE.test(core) && !PRODUCT_BOUNDARY.test(core)) return true;
  return false;
}

function looksLikeItemStart(token: string, next: string | undefined, alreadyHaveName: boolean): boolean {
  if (!alreadyHaveName) return false;
  if (ITEM_ARTICLE.test(token)) return true;
  if (PRODUCT_BOUNDARY.test(token)) return true;
  if (HARD_STOP.test(token)) return true;
  if (SIZE_BOUNDARY.test(fold(token)) && !NAME_PARTICLE.test(token)) return true;
  if (/^(con|sin)$/i.test(token) && next && /^(dise[nñ]o|descripci[oó]n|estampado)/i.test(next)) {
    return true;
  }
  if (isMoneyToken(token)) return true;
  if (isQuantityBeforeProduct(token, next)) return true;
  return false;
}

function takeEntityNameSpan(rest: string): { raw: string; consumed: number } | null {
  const tokens: Array<{ value: string; start: number; end: number }> = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rest))) {
    tokens.push({ value: match[0], start: match.index, end: match.index + match[0].length });
  }
  if (!tokens.length) return null;

  const kept: typeof tokens = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const next = tokens[i + 1]?.value;
    const already = kept.some((row) => !isPunctuationToken(row.value));
    if (looksLikeItemStart(token.value, next, already)) break;
    if (already && /^(ya|est[aá]|pagad[oa]|cobrad[oa]|saldad[oa]|abonad[oa])$/i.test(token.value)) {
      break;
    }
    kept.push(token);
  }

  while (kept.length && isPunctuationToken(kept[kept.length - 1]!.value.replace(/,$/, ''))) {
    kept.pop();
  }
  if (!kept.length) return null;

  const raw = rest
    .slice(kept[0]!.start, kept[kept.length - 1]!.end)
    .replace(/[.,;:]+$/, '')
    .trim();
  if (!raw) return null;
  return { raw, consumed: kept[kept.length - 1]!.end };
}

export function findSpokenPartySpan(text: string): SpokenPartySpan | null {
  const raw = String(text ?? '');
  if (!raw.trim()) return null;
  for (const cue of PARTY_CUES) {
    const match = raw.match(cue);
    if (!match || match.index == null) continue;
    const nameStart = match.index + match[0].length;
    const taken = takeEntityNameSpan(raw.slice(nameStart));
    if (!taken) continue;
    return {
      raw: taken.raw,
      cueStart: match.index,
      nameStart,
      nameEnd: nameStart + taken.consumed,
    };
  }
  return null;
}

export function extractPartyRawFromUtterance(text: string): string | null {
  return findSpokenPartySpan(text)?.raw ?? null;
}

/**
 * Candidatos de búsqueda: el texto original primero; recién después, formas
 * simplificadas (sin puntuación, paréntesis, @ o sufijos cortos).
 */
export function entityLookupCandidates(raw: string): string[] {
  const original = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!original) return [];
  const out: string[] = [];
  const add = (value: string) => {
    const next = value.replace(/\s+/g, ' ').trim();
    if (!next) return;
    if (out.some((existing) => existing.toLowerCase() === next.toLowerCase())) return;
    out.push(next);
  };

  add(original);
  add(original.replace(/\([^)]*\)/g, ' '));
  add(original.replace(/@/g, ''));
  add(original.replace(/\s*[-–—/]\s*/g, ' '));
  add(original.replace(/[@_\-–—/.,;:()]+/g, ' '));

  const tokens = original.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && isDecorativeEntitySuffix(tokens[tokens.length - 1]!)) {
    tokens.pop();
    add(tokens.join(' '));
  }
  return out;
}

export function isExtensionOfEntityName(longer: string, shorter: string): boolean {
  const a = longer.trim().toLowerCase();
  const b = shorter.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (!a.startsWith(b)) return false;
  const next = a[b.length];
  return next == null || /[\s\-–—/(@]/.test(next);
}

/** Conserva el candidato más completo; no pisa un nombre largo con uno truncado. */
export function preferCompleteEntityName(
  primary?: string | null,
  fallback?: string | null
): string {
  const a = String(primary ?? '').trim();
  const b = String(fallback ?? '').trim();
  if (!a) return b;
  if (!b) return a;
  if (isExtensionOfEntityName(a, b)) return a;
  if (isExtensionOfEntityName(b, a)) return b;
  return a;
}

export function clientLookupQuery(entities: {
  clientName?: string;
  spokenClientName?: string;
}): string {
  return preferCompleteEntityName(entities.spokenClientName, entities.clientName);
}

export function applyCompletePartyFromUtterance(
  text: string,
  entities: { clientName?: string; spokenClientName?: string }
): void {
  const extracted = extractPartyRawFromUtterance(text);
  if (!extracted) return;
  const complete = preferCompleteEntityName(
    preferCompleteEntityName(entities.spokenClientName, entities.clientName),
    extracted
  );
  if (!complete) return;
  entities.spokenClientName = preferCompleteEntityName(entities.spokenClientName, complete) || complete;
  entities.clientName = preferCompleteEntityName(complete, entities.clientName) || complete;
}
