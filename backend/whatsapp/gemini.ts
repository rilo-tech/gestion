import { recordGeminiUsage } from '../auth/usage-meter.ts';
import type { UsageToolId } from '../../shared/usage-cost.ts';

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

const FALLBACK_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash',
  'gemini-flash-latest',
];

/** Modelos sin cuota: se saltean un rato para no gastar tiempo en cada mensaje. */
const COOLDOWN_MS = 10 * 60 * 1000;
const unavailableUntil = new Map<string, number>();

export function geminiModelChain(): string[] {
  const preferred = process.env.GEMINI_WHATSAPP_MODEL?.trim();
  const chain = preferred ? [preferred, ...FALLBACK_MODELS] : [...FALLBACK_MODELS];
  return [...new Set(chain)];
}

function isRetryableModelError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error ?? '');
  const status = Number((error as { status?: number })?.status ?? 0);
  if (status === 429 || status === 404 || status === 503 || status === 500) return true;
  return /RESOURCE_EXHAUSTED|quota|NOT_FOUND|UNAVAILABLE|overloaded|INTERNAL|429|503/i.test(message);
}

function isQuotaError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error ?? '');
  return /RESOURCE_EXHAUSTED|quota|429/i.test(message);
}

function estimateInputTokens(parts: GeminiPart[]): number {
  let chars = 0;
  for (const part of parts) {
    if ('text' in part) chars += String(part.text ?? '').length;
    else chars += 800;
  }
  return Math.max(1, Math.round(chars / 4));
}

function readTokenCounts(response: unknown, parts: GeminiPart[], outputText: string): {
  inputTokens: number;
  outputTokens: number;
} {
  const meta = (response as {
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  }).usageMetadata;
  const inputTokens = Number(meta?.promptTokenCount) || estimateInputTokens(parts);
  const outputTokens = Number(meta?.candidatesTokenCount) || Math.max(1, Math.round(outputText.length / 4));
  return { inputTokens, outputTokens };
}

/**
 * Llama a Gemini recorriendo modelos hasta que uno responda.
 * Devuelve null solo si ninguno pudo contestar.
 */
export async function generateGeminiText(input: {
  parts: GeminiPart[];
  json?: boolean;
  timeoutMs?: number;
  label: string;
  businessId?: string;
  tool?: UsageToolId;
}): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.warn(`[whatsapp] ${input.label}: falta GEMINI_API_KEY`);
    return null;
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const timeoutMs = input.timeoutMs ?? 15000;
  const now = Date.now();
  const chain = geminiModelChain();
  const usable = chain.filter((model) => (unavailableUntil.get(model) ?? 0) <= now);
  const models = usable.length ? usable : chain;

  for (const model of models) {
    try {
      const generated = ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: input.parts }],
        ...(input.json ? { config: { responseMimeType: 'application/json' } } : {}),
      });
      const response = await Promise.race([
        generated,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`${input.label} timeout`)), timeoutMs);
        }),
      ]);
      const text = String(response.text ?? '').trim();
      if (text) {
        if (input.businessId && input.tool) {
          const tokens = readTokenCounts(response, input.parts, text);
          void recordGeminiUsage({
            businessId: input.businessId,
            tool: input.tool,
            model,
            inputTokens: tokens.inputTokens,
            outputTokens: tokens.outputTokens,
          }).catch((error) => console.warn('[whatsapp] usage meter:', error));
        }
        return text;
      }
      console.warn(`[whatsapp] ${input.label}: ${model} respondió vacío`);
    } catch (error) {
      if (isQuotaError(error)) {
        unavailableUntil.set(model, Date.now() + COOLDOWN_MS);
        console.warn(`[whatsapp] ${input.label}: ${model} sin cuota, pruebo el siguiente`);
      } else if (isRetryableModelError(error)) {
        console.warn(`[whatsapp] ${input.label}: ${model} no disponible, pruebo el siguiente`);
      } else {
        console.warn(`[whatsapp] ${input.label}: ${model} falló:`, error);
      }
    }
  }
  return null;
}

export async function generateGeminiJson(input: {
  parts: GeminiPart[];
  timeoutMs?: number;
  label: string;
  businessId?: string;
  tool?: UsageToolId;
}): Promise<Record<string, unknown> | null> {
  const text = await generateGeminiText({ ...input, json: true });
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const salvaged = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    try {
      return JSON.parse(salvaged) as Record<string, unknown>;
    } catch {
      console.warn(`[whatsapp] ${input.label}: JSON inválido`);
      return null;
    }
  }
}
