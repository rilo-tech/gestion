import { recordGeminiUsage } from '../auth/usage-meter.ts';
import type { UsageToolId } from '../../shared/usage-cost.ts';
import {
  classifyInterpreterError,
  interpreterCircuitIsOpen,
  interpreterMaxAttempts,
  interpreterModelChain,
  interpreterRetryBackoffMs,
  interpreterTimeoutMs,
  isRetryableInterpreterFailure,
  logInterpreterCall,
  noteInterpreterFailure,
  noteInterpreterSuccess,
  type InterpreterFailure,
} from './interpreter-availability.ts';

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

const FALLBACK_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash',
  'gemini-flash-latest',
];

/** Modelos sin cuota: se saltean un rato para no gastar tiempo en cada mensaje. */
const COOLDOWN_MS = 10 * 60 * 1000;
/** Un modelo que timeout-ea o está caído cuesta el timeout completo en CADA mensaje. */
const SLOW_COOLDOWN_MS = 3 * 60 * 1000;
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

function isTimeoutError(error: unknown): boolean {
  return /timeout/i.test(String((error as { message?: string })?.message ?? error ?? ''));
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
  responseSchema?: Record<string, unknown>;
  systemInstruction?: string;
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
  const available = chain.filter((model) => (unavailableUntil.get(model) ?? 0) <= now);
  const cooled = chain.filter((model) => (unavailableUntil.get(model) ?? 0) > now);
  const models = available.length ? [...available, ...cooled] : chain;

  for (const model of models) {
    try {
      const generated = ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: input.parts }],
        config: {
          ...(input.systemInstruction ? { systemInstruction: input.systemInstruction } : {}),
          ...(input.json
            ? {
                responseMimeType: 'application/json',
                ...(input.responseSchema ? { responseSchema: input.responseSchema } : {}),
              }
            : {}),
        },
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
      } else if (isTimeoutError(error)) {
        unavailableUntil.set(model, Date.now() + SLOW_COOLDOWN_MS);
        console.warn(`[whatsapp] ${input.label}: ${model} tardó demasiado, lo salteo un rato`);
      } else if (isRetryableModelError(error)) {
        unavailableUntil.set(model, Date.now() + SLOW_COOLDOWN_MS);
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
  responseSchema?: Record<string, unknown>;
  systemInstruction?: string;
  validate?: (value: Record<string, unknown>) => boolean;
}): Promise<Record<string, unknown> | null> {
  const attempt = async (schema?: Record<string, unknown>) => {
    const text = await generateGeminiText({ ...input, json: true, responseSchema: schema });
    if (!text) return null;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (input.validate && !input.validate(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const first = await attempt(input.responseSchema);
  if (first) return first;
  if (input.responseSchema) {
    const withoutSchema = await attempt(undefined);
    if (withoutSchema) return withoutSchema;
  }
  console.warn(`[whatsapp] ${input.label}: JSON inválido`);
  return null;
}

export type InterpreterJsonResult = {
  json: Record<string, unknown> | null;
  failure: InterpreterFailure | null;
  model: string | null;
  fallbackUsed: boolean;
};

/**
 * Intérprete: 1 intento al primario + 1 retry si el error es recuperable.
 * Fallback de modelo solo si está configurado. No recorre la cadena de 4 modelos.
 */
export async function generateInterpreterJson(input: {
  parts: GeminiPart[];
  label: string;
  businessId?: string;
  tool?: UsageToolId;
  responseSchema?: Record<string, unknown>;
  systemInstruction?: string;
  validate?: (value: Record<string, unknown>) => boolean;
}): Promise<InterpreterJsonResult> {
  const started = Date.now();
  const startIso = new Date(started).toISOString();
  const { primary, fallback } = interpreterModelChain();

  if (interpreterCircuitIsOpen()) {
    const durationMs = Date.now() - started;
    logInterpreterCall({
      provider: 'gemini',
      model: null,
      attempt: 0,
      startTime: startIso,
      durationMs,
      success: false,
      timeout: false,
      errorType: 'circuit_open',
      httpStatus: null,
      retry: false,
      fallbackUsed: false,
      structuredOutputValid: false,
      circuitOpen: true,
      abortReason: 'circuit_open',
    });
    return {
      json: null,
      failure: {
        kind: 'INTERPRETER_UNAVAILABLE',
        provider: 'gemini',
        model: null,
        durationMs,
        retry: false,
        fallbackUsed: false,
        errorType: 'circuit_open',
        httpStatus: null,
        abortReason: 'circuit_open',
      },
      model: null,
      fallbackUsed: false,
    };
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    logInterpreterCall({
      provider: 'gemini',
      model: null,
      attempt: 0,
      startTime: startIso,
      durationMs: Date.now() - started,
      success: false,
      timeout: false,
      errorType: 'missing_key',
      httpStatus: null,
      retry: false,
      fallbackUsed: false,
      structuredOutputValid: false,
    });
    return {
      json: null,
      failure: {
        kind: 'INTERPRETER_MISSING_KEY',
        provider: 'gemini',
        model: null,
        durationMs: Date.now() - started,
        retry: false,
        fallbackUsed: false,
        errorType: 'missing_key',
        httpStatus: null,
      },
      model: null,
      fallbackUsed: false,
    };
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const tryModel = async (
    model: string,
    timeoutMs: number,
    attempt: number,
    fallbackUsed: boolean
  ): Promise<{ json: Record<string, unknown> | null; failure: InterpreterFailure | null }> => {
    const attemptStart = Date.now();
    const abort = new AbortController();
    let abortReason: string | null = null;
    const timer = setTimeout(() => {
      abortReason = 'internal_timeout';
      abort.abort();
    }, timeoutMs);
    try {
      const generated = ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: input.parts }],
        config: {
          abortSignal: abort.signal,
          ...(input.systemInstruction ? { systemInstruction: input.systemInstruction } : {}),
          ...(input.responseSchema
            ? {
                responseMimeType: 'application/json',
                responseSchema: input.responseSchema,
              }
            : { responseMimeType: 'application/json' }),
        },
      });
      const response = await Promise.race([
        generated,
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            abortReason = abortReason || 'internal_timeout';
            reject(new Error(`${input.label} timeout`));
          }, timeoutMs);
        }),
      ]);
      const text = String(response.text ?? '').trim();
      const durationMs = Date.now() - attemptStart;
      if (!text) {
        const failure: InterpreterFailure = {
          kind: 'INTERPRETER_INVALID_RESPONSE',
          provider: 'gemini',
          model,
          durationMs,
          retry: attempt > 1,
          fallbackUsed,
          errorType: 'empty',
          httpStatus: null,
        };
        logInterpreterCall({
          provider: 'gemini',
          model,
          attempt,
          startTime: startIso,
          durationMs,
          success: false,
          timeout: false,
          errorType: 'empty',
          httpStatus: null,
          retry: attempt > 1,
          fallbackUsed,
          structuredOutputValid: false,
        });
        return { json: null, failure };
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        const failure: InterpreterFailure = {
          kind: 'INTERPRETER_INVALID_RESPONSE',
          provider: 'gemini',
          model,
          durationMs,
          retry: attempt > 1,
          fallbackUsed,
          errorType: 'invalid_json',
          httpStatus: null,
        };
        logInterpreterCall({
          provider: 'gemini',
          model,
          attempt,
          startTime: startIso,
          durationMs,
          success: false,
          timeout: false,
          errorType: 'invalid_json',
          httpStatus: null,
          retry: attempt > 1,
          fallbackUsed,
          structuredOutputValid: false,
        });
        return { json: null, failure };
      }
      const valid = input.validate ? input.validate(parsed) : true;
      logInterpreterCall({
        provider: 'gemini',
        model,
        attempt,
        startTime: startIso,
        durationMs,
        success: valid,
        timeout: false,
        errorType: valid ? null : 'schema_invalid',
        httpStatus: null,
        retry: attempt > 1,
        fallbackUsed,
        structuredOutputValid: valid,
      });
      if (!valid) {
        return {
          json: null,
          failure: {
            kind: 'INTERPRETER_INVALID_RESPONSE',
            provider: 'gemini',
            model,
            durationMs,
            retry: attempt > 1,
            fallbackUsed,
            errorType: 'schema_invalid',
            httpStatus: null,
          },
        };
      }
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
      return { json: parsed, failure: null };
    } catch (error) {
      const classified = classifyInterpreterError(error);
      const durationMs = Date.now() - attemptStart;
      logInterpreterCall({
        provider: 'gemini',
        model,
        attempt,
        startTime: startIso,
        durationMs,
        success: false,
        timeout: classified.timeout,
        errorType: classified.errorType,
        errorName: classified.errorName,
        errorCode: classified.errorCode,
        httpStatus: classified.httpStatus,
        retry: attempt > 1,
        fallbackUsed,
        structuredOutputValid: false,
        abortReason,
      });
      return {
        json: null,
        failure: {
          kind: classified.kind,
          provider: 'gemini',
          model,
          durationMs,
          retry: attempt > 1,
          fallbackUsed,
          errorType: classified.errorType,
          httpStatus: classified.httpStatus,
          errorName: classified.errorName,
          errorCode: classified.errorCode,
          abortReason,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await tryModel(primary, interpreterTimeoutMs('primary'), 1, false);
  if (first.json) {
    noteInterpreterSuccess();
    return { json: first.json, failure: null, model: primary, fallbackUsed: false };
  }

  const canRetry =
    interpreterMaxAttempts() > 1 && isRetryableInterpreterFailure(first.failure);
  if (!canRetry) {
    noteInterpreterFailure();
    return { json: null, failure: first.failure, model: primary, fallbackUsed: false };
  }

  await new Promise((resolve) => setTimeout(resolve, interpreterRetryBackoffMs()));
  const retryModel = fallback || primary;
  const fallbackUsed = Boolean(fallback);
  const second = await tryModel(retryModel, interpreterTimeoutMs('retry'), 2, fallbackUsed);
  if (second.json) {
    noteInterpreterSuccess();
    return { json: second.json, failure: null, model: retryModel, fallbackUsed };
  }

  noteInterpreterFailure();
  return {
    json: null,
    failure: second.failure ?? first.failure,
    model: retryModel,
    fallbackUsed,
  };
}
