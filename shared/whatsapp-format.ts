/** Formato WhatsApp: títulos en negrita, viñetas, burbujas cortas (sin «Leer más»). */

import { numberedOptionLines, WA_INSTRUCTION } from './whatsapp-visual.ts';

export const WA_BUBBLE_MAX = 1040;

export const WA_PRESENT = {
  maxChars: 1400,
  maxLines: 24,
  explorePageSize: 6,
  transactionItemsPerPage: 8,
  transactionAutoPages: 2,
  compactItemPreview: 6,
} as const;

export const WA_FORBIDDEN_PAGER_PHRASES = ['leer más'] as const;

export const WA_CHOICE_PAGE_SIZE = 3;

export function waBold(value: string): string {
  // WhatsApp bold cannot span newlines; collapse so asterisks never render literally.
  const clean = String(value ?? '')
    .replace(/\*/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
  return clean ? `*${clean}*` : '';
}

/**
 * Normaliza cualquier texto saliente de RiloBot antes de enviarlo a Meta.
 * Convierte variantes markdown/HTML a *negrita* nativa de WhatsApp y deshace
 * escapes accidentales (\\*). Idempotente sobre texto ya formateado.
 */
export function formatWhatsappOutbound(text: string): string {
  let out = sanitizeWhatsappUtf8(String(text ?? ''));
  if (!out.trim()) return '';

  out = out.replace(/\\\*/g, '*');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/&nbsp;/gi, ' ');

  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');
    out = out.replace(/__([^_\n]+?)__/g, '*$1*');
  }

  out = out.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '*$2*');
  out = out.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '$2');
  out = out.replace(/<[^>\n]+>/g, '');

  return compactWhatsappText(out);
}

/**
 * Limpia basura de encoding típica antes de Meta:
 * - replacement chars
 * - zero-width / BOM
 * - mojibake UTF-8 leído como Latin-1 (Ã¡, Â¿, etc.)
 */
export function sanitizeWhatsappUtf8(text: string): string {
  let out = String(text ?? '');
  if (!out) return '';
  out = out.replace(/\uFFFD/g, '');
  out = out.replace(/[\u200B-\u200D\uFEFF]/g, '');
  if (/Ã.|Â[¿¡]/.test(out)) {
    try {
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i) & 0xff;
      const repaired = new TextDecoder('utf-8').decode(bytes);
      if (repaired && !repaired.includes('\uFFFD') && repaired !== out) {
        out = repaired;
      }
    } catch {
      /* keep original */
    }
  }
  return out;
}

/** @deprecated Alias histórico — preferir formatWhatsappOutbound en salida a Meta. */
export function presentWhatsappMessage(text: string): string {
  return formatWhatsappOutbound(text);
}

/** Quita espacios de cola y líneas vacías extra: nunca dos seguidas, nunca entre opciones/viñetas. */
export function compactWhatsappText(text: string): string {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim();
}

export function formatWhatsappMessage(input: {
  title?: string;
  lines?: string[];
  ask?: string;
}): string {
  const parts: string[] = [];
  const titleSegments = String(input.title ?? '')
    .replace(/^\*|\*$/g, '')
    .split(/\n+/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (titleSegments.length) {
    parts.push(waBold(titleSegments[0]!));
    for (const extra of titleSegments.slice(1)) parts.push(extra);
  }
  for (const line of input.lines ?? []) {
    for (const segment of String(line ?? '').split(/\n+/)) {
      const clean = segment.trim();
      if (clean) parts.push(clean);
    }
  }
  const body = compactWhatsappText(parts.join('\n'));
  const ask = String(input.ask ?? '').trim();
  if (!ask) return body;
  return body ? `${body}\n\n${ask}` : ask;
}

export function formatChoiceMessage(input: {
  title: string;
  options: string[];
  noneLabel?: string | false;
  ask?: string;
}): string {
  const options = (input.options ?? []).map((option) => String(option ?? '').trim()).filter(Boolean);
  const lines = numberedOptionLines(options);
  if (input.noneLabel) {
    lines.push(`${options.length + 1}. ${input.noneLabel}`);
  }
  return formatWhatsappMessage({
    title: input.title,
    lines,
    ask: input.ask ?? WA_INSTRUCTION,
  });
}

export function formatTransactionSummary(input: {
  title: string;
  lines: string[];
  ask?: string;
}): string {
  return formatWhatsappMessage(input);
}

export function waCard(input: {
  title: string;
  lines?: string[];
  ask?: string;
}): string {
  return formatWhatsappMessage(input);
}

export const WA_CONFIRM_ASK = `¿Confirmo? ${waBold('SÍ')} / ${waBold('NO')}`;

export function waAskConfirmo(): string {
  return WA_CONFIRM_ASK;
}

export function waAskSiNo(hint?: string): string {
  const save = `¿Lo guardo? ${waBold('SÍ')} / ${waBold('NO')}`;
  return hint ? `${hint}\n${save}` : save;
}

export function waHowToRespond(items: string[]): string {
  return [waBold('Cómo responder'), ...items.map((item) => `• ${item}`)].join('\n');
}

export type WhatsappViewKind = 'simple' | 'transaction' | 'explore';

export type WhatsappView = {
  kind: WhatsappViewKind;
  title?: string;
  items?: string[];
  preamble?: string[];
  footer?: string[];
  question?: string;
  wantAll?: boolean;
  numbered?: boolean;
};

export type WhatsappPresentResult = {
  pages: string[];
  listContext?: {
    items: string[];
    currentPage: number;
    pageSize: number;
    totalResults: number;
    sentAll: boolean;
    compact?: boolean;
  };
};

function containsForbiddenPager(text: string): boolean {
  const lower = String(text ?? '').toLowerCase();
  return WA_FORBIDDEN_PAGER_PHRASES.some((phrase) => lower.includes(phrase));
}

function pageTitle(title: string | undefined, page: number, total: number): string {
  const base = String(title ?? '').replace(/\*/g, '').trim();
  if (!base) return '';
  if (total <= 1) return waBold(base);
  return waBold(`${base} — ${page}/${total}`);
}

function joinPage(parts: Array<string | undefined>): string {
  return compactWhatsappText(
    parts
      .filter((part): part is string => Boolean(part && String(part).trim()))
      .join('\n')
  );
}

function chunkItems(items: string[], pageSize: number): string[][] {
  const size = Math.max(1, pageSize);
  const pages: string[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages.length ? pages : [[]];
}

function renderItemPage(input: {
  title?: string;
  page: number;
  totalPages: number;
  items: string[];
  preamble?: string[];
  footer?: string[];
  question?: string;
  last: boolean;
}): string {
  const title = pageTitle(input.title, input.page, input.totalPages);
  const preamble = input.page === 1 ? input.preamble : undefined;
  const footer = input.last ? input.footer : undefined;
  const question = input.last ? input.question : undefined;
  return joinPage([title, ...(preamble ?? []), ...input.items, ...(footer ?? []), question]);
}

export function formatWhatsappResponse(view: WhatsappView): WhatsappPresentResult {
  const items = (view.items ?? []).map((item) => String(item).trim()).filter(Boolean);
  const question = view.question?.trim() || undefined;
  const preamble = view.preamble?.filter(Boolean);
  const footer = view.footer?.filter(Boolean);

  if (view.kind === 'simple' || (!items.length && !view.title)) {
    const body = joinPage([
      view.title ? waBold(view.title) : '',
      ...(preamble ?? []),
      ...items,
      ...(footer ?? []),
      question,
    ]);
    return { pages: body ? [body] : [] };
  }

  if (view.kind === 'explore') {
    const pageSize = WA_PRESENT.explorePageSize;
    if (view.wantAll) {
      const chunks = chunkItems(items, pageSize);
      const pages = chunks.map((slice, index) =>
        renderItemPage({
          title: view.title,
          page: index + 1,
          totalPages: chunks.length,
          items: slice,
          preamble,
          footer,
          question,
          last: index === chunks.length - 1,
        })
      );
      return {
        pages,
        listContext: {
          items,
          currentPage: chunks.length,
          pageSize,
          totalResults: items.length,
          sentAll: true,
        },
      };
    }
    const first = items.slice(0, pageSize);
    const page = renderItemPage({
      title: view.title,
      page: 1,
      totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
      items: first,
      preamble,
      footer: items.length > pageSize ? undefined : footer,
      question: items.length > pageSize ? undefined : question,
      last: items.length <= pageSize,
    });
    return {
      pages: [page],
      listContext: {
        items,
        currentPage: 1,
        pageSize,
        totalResults: items.length,
        sentAll: items.length <= pageSize,
      },
    };
  }

  const pageSize = WA_PRESENT.transactionItemsPerPage;
  const rawChunks = chunkItems(items, pageSize);
  if (rawChunks.length > WA_PRESENT.transactionAutoPages && !view.wantAll) {
    const preview = items.slice(0, WA_PRESENT.compactItemPreview);
    const compact = renderItemPage({
      title: view.title,
      page: 1,
      totalPages: 1,
      items: preview,
      preamble,
      footer: [
        ...(footer ?? []),
        `*Total de ítems:* ${items.length}`,
        'Escribí *todo* para el detalle.',
      ],
      question,
      last: true,
    });
    return {
      pages: [compact],
      listContext: {
        items,
        currentPage: 1,
        pageSize,
        totalResults: items.length,
        sentAll: false,
        compact: true,
      },
    };
  }

  const pages = rawChunks.map((slice, index) =>
    renderItemPage({
      title: view.title,
      page: index + 1,
      totalPages: rawChunks.length,
      items: slice,
      preamble,
      footer,
      question,
      last: index === rawChunks.length - 1,
    })
  );
  return {
    pages,
    listContext: {
      items,
      currentPage: rawChunks.length,
      pageSize,
      totalResults: items.length,
      sentAll: true,
    },
  };
}

export function renderListPage(
  context: {
    title?: string;
    items: string[];
    currentPage: number;
    pageSize: number;
    wantAll?: boolean;
    question?: string;
  }
): string[] {
  const view: WhatsappView = {
    kind: 'explore',
    title: context.title,
    items: context.items,
    question: context.question,
    wantAll: context.wantAll,
  };
  const rendered = formatWhatsappResponse(view);
  if (context.wantAll) return rendered.pages;
  const size = Math.max(1, context.pageSize || WA_PRESENT.explorePageSize);
  const totalPages = Math.max(1, Math.ceil(context.items.length / size));
  const page = Math.min(Math.max(1, context.currentPage), totalPages);
  const slice = context.items.slice((page - 1) * size, page * size);
  return [
    renderItemPage({
      title: context.title,
      page,
      totalPages,
      items: slice,
      last: page === totalPages,
      question: page === totalPages ? context.question : undefined,
    }),
  ];
}

/** Divide por unidades semánticas. Nunca corta una viñeta o renglón a la mitad. */
export function splitWhatsappMessages(text: string, max = WA_PRESENT.maxChars): string[] {
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

  const appendUnit = (unit: string) => {
    const next = current ? `${current}\n\n${unit}` : unit;
    const lineCount = next.split('\n').length;
    if (next.length <= max && lineCount <= WA_PRESENT.maxLines) {
      current = next;
      return;
    }
    pushCurrent();
    if (unit.length <= max) {
      current = unit;
      return;
    }
    const lines = unit.split('\n');
    for (const line of lines) {
      const lined = current ? `${current}\n${line}` : line;
      if (lined.length <= max) {
        current = lined;
      } else {
        pushCurrent();
        current = line;
      }
    }
  };

  for (const block of blocks) {
    const lines = block.split('\n');
    let unit = '';
    const flushUnit = () => {
      if (unit.trim()) appendUnit(unit.trimEnd());
      unit = '';
    };
    for (const line of lines) {
      const isItem = /^\s*(?:[•\-*]|\d+[.)])\s+/.test(line);
      if (isItem && unit) {
        flushUnit();
        unit = line;
      } else {
        unit = unit ? `${unit}\n${line}` : line;
      }
    }
    flushUnit();
  }
  pushCurrent();
  return pages.length ? pages : [raw];
}

export function splitWaBubbles(text: string, max = WA_BUBBLE_MAX): string[] {
  return splitWhatsappMessages(text, max);
}

export function assertNoPagerPhrases(pages: string[]): void {
  for (const page of pages) {
    if (containsForbiddenPager(page)) {
      throw new Error(`WhatsApp page contains forbidden pager phrase: ${page.slice(0, 80)}`);
    }
  }
}
