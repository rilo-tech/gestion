/** Formato WhatsApp: títulos en negrita, viñetas, burbujas cortas (sin «Leer más»). */

export const WA_BUBBLE_MAX = 520;

export function waBold(value: string): string {
  const clean = String(value ?? '').replace(/\*/g, '').trim();
  return clean ? `*${clean}*` : '';
}

export function waCard(input: {
  title: string;
  lines?: string[];
  ask?: string;
}): string {
  const parts: string[] = [];
  const title = waBold(input.title);
  if (title) parts.push(title, '');
  if (input.lines?.length) parts.push(...input.lines.filter((line) => line != null));
  if (input.ask) {
    if (input.lines?.length) parts.push('');
    parts.push(input.ask);
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function waAskSiNo(hint?: string): string {
  const save = `¿Lo guardo? ${waBold('SÍ')} / ${waBold('NO')}`;
  return hint ? `${hint}\n${save}` : save;
}

export function waHowToRespond(items: string[]): string {
  return [waBold('Cómo responder'), ...items.map((item) => `• ${item}`)].join('\n');
}

export function splitWaBubbles(text: string, max = WA_BUBBLE_MAX): string[] {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  if (raw.length <= max) return [raw];

  const blocks = raw.split(/\n{2,}/);
  const pages: string[] = [];
  let current = '';

  const pushCurrent = () => {
    const piece = current.trim();
    if (piece) pages.push(piece);
    current = '';
  };

  const append = (chunk: string) => {
    const next = current ? `${current}\n\n${chunk}` : chunk;
    if (next.length <= max) {
      current = next;
      return;
    }
    pushCurrent();
    if (chunk.length <= max) {
      current = chunk;
      return;
    }
    for (const line of chunk.split('\n')) {
      const lined = current ? `${current}\n${line}` : line;
      if (lined.length <= max) {
        current = lined;
      } else {
        pushCurrent();
        current = line.slice(0, max);
      }
    }
  };

  for (const block of blocks) append(block);
  pushCurrent();
  return pages.length ? pages : [raw.slice(0, max)];
}
