export type InterpreterFailureKind =
  | 'INTERPRETER_TIMEOUT'
  | 'INTERPRETER_UNAVAILABLE'
  | 'INTERPRETER_RATE_LIMITED'
  | 'INTERPRETER_INVALID_RESPONSE'
  | 'INTERPRETER_MISSING_KEY';

export type InterpreterCallLog = {
  metric?:
    | 'interpreter.success'
    | 'interpreter.timeout'
    | 'interpreter.rate_limit'
    | 'interpreter.invalid_response'
    | 'interpreter.fallback_used'
    | 'interpreter.unavailable';
  provider: string;
  model: string | null;
  attempt: number;
  startTime: string;
  durationMs: number;
  success: boolean;
  timeout: boolean;
  errorType: string | null;
  errorName?: string | null;
  errorCode?: string | null;
  httpStatus: number | null;
  retry: boolean;
  fallbackUsed: boolean;
  structuredOutputValid: boolean;
  circuitOpen?: boolean;
  abortReason?: string | null;
};

export type InterpreterFailure = {
  kind: InterpreterFailureKind;
  provider: string;
  model: string | null;
  durationMs: number;
  retry: boolean;
  fallbackUsed: boolean;
  errorType: string | null;
  httpStatus: number | null;
  errorName?: string | null;
  errorCode?: string | null;
  abortReason?: string | null;
};

/** Intent sintético: fallo de proveedor, no mensaje ambiguo. No va al schema de Gemini. */
export const INTERPRETER_UNAVAILABLE_INTENT = 'interpreter_unavailable' as const;

export const INTERPRETER_UNAVAILABLE_REPLY =
  'No pude procesar ese mensaje en este momento.\nProbá nuevamente en unos segundos.';

export function isInterpreterTechnicalFailure(failure?: InterpreterFailure | null): boolean {
  return Boolean(failure?.kind);
}

export function interpreterTimeoutMs(attempt: 'primary' | 'retry'): number {
  const primary = Number(process.env.GEMINI_INTERPRETER_TIMEOUT_MS);
  const retry = Number(process.env.GEMINI_INTERPRETER_RETRY_TIMEOUT_MS);
  if (attempt === 'retry') return Number.isFinite(retry) && retry > 0 ? retry : 15_000;
  return Number.isFinite(primary) && primary > 0 ? primary : 20_000;
}

export function interpreterMaxAttempts(): number {
  const n = Number(process.env.GEMINI_INTERPRETER_MAX_ATTEMPTS);
  if (Number.isFinite(n) && n >= 1) return Math.min(2, Math.floor(n));
  return 2;
}

export function interpreterRetryBackoffMs(): number {
  const base = Number(process.env.GEMINI_INTERPRETER_RETRY_BACKOFF_MS);
  const floor = Number.isFinite(base) && base >= 0 ? base : 250;
  return floor + Math.floor(Math.random() * 250);
}

export function interpreterCircuitWindowMs(): number {
  const n = Number(process.env.GEMINI_INTERPRETER_CIRCUIT_MS);
  return Number.isFinite(n) && n > 0 ? n : 45_000;
}

export function interpreterCircuitThreshold(): number {
  const n = Number(process.env.GEMINI_INTERPRETER_CIRCUIT_FAILURES);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

export function resetInterpreterCircuitForTests(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

export function interpreterCircuitIsOpen(now = Date.now()): boolean {
  return circuitOpenUntil > now;
}

export function noteInterpreterSuccess(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

export function noteInterpreterFailure(now = Date.now()): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= interpreterCircuitThreshold()) {
    circuitOpenUntil = now + interpreterCircuitWindowMs();
  }
}

export function inspectInterpreterError(error: unknown): {
  name: string;
  message: string;
  code: string | null;
  httpStatus: number | null;
} {
  const row = (error ?? {}) as {
    name?: string;
    message?: string;
    status?: number;
    code?: number | string;
    error?: { code?: number; status?: string; message?: string };
  };
  const nested = row.error;
  const status =
    Number(row.status ?? 0) ||
    Number(typeof row.code === 'number' ? row.code : 0) ||
    Number(nested?.code ?? 0) ||
    null;
  const code =
    nested?.status != null
      ? String(nested.status)
      : row.code != null && typeof row.code !== 'number'
        ? String(row.code)
        : status
          ? String(status)
          : null;
  return {
    name: String(row.name || (error instanceof Error ? error.name : 'Error')),
    message: String(row.message ?? nested?.message ?? error ?? ''),
    code,
    httpStatus: status && status >= 100 ? status : null,
  };
}

export function classifyInterpreterError(error: unknown): {
  kind: InterpreterFailureKind;
  errorType: string;
  httpStatus: number | null;
  timeout: boolean;
  errorName: string;
  errorCode: string | null;
} {
  const inspected = inspectInterpreterError(error);
  const timeout = /timeout|aborted|AbortError|ETIMEDOUT|UND_ERR/i.test(
    `${inspected.name} ${inspected.message}`
  );
  if (timeout) {
    return {
      kind: 'INTERPRETER_TIMEOUT',
      errorType: 'timeout',
      httpStatus: inspected.httpStatus,
      timeout: true,
      errorName: inspected.name,
      errorCode: inspected.code,
    };
  }
  if (
    inspected.httpStatus === 429 ||
    /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(inspected.message)
  ) {
    return {
      kind: 'INTERPRETER_RATE_LIMITED',
      errorType: 'rate_limit',
      httpStatus: inspected.httpStatus ?? 429,
      timeout: false,
      errorName: inspected.name,
      errorCode: inspected.code,
    };
  }
  if (
    (inspected.httpStatus && inspected.httpStatus >= 500) ||
    /ECONNRESET|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|UNAVAILABLE|overloaded/i.test(
      inspected.message
    )
  ) {
    return {
      kind: 'INTERPRETER_UNAVAILABLE',
      errorType: inspected.httpStatus && inspected.httpStatus >= 500 ? 'http_5xx' : 'network',
      httpStatus: inspected.httpStatus,
      timeout: false,
      errorName: inspected.name,
      errorCode: inspected.code,
    };
  }
  if (inspected.httpStatus && inspected.httpStatus >= 400) {
    return {
      kind: 'INTERPRETER_UNAVAILABLE',
      errorType: 'http_4xx',
      httpStatus: inspected.httpStatus,
      timeout: false,
      errorName: inspected.name,
      errorCode: inspected.code,
    };
  }
  return {
    kind: 'INTERPRETER_UNAVAILABLE',
    errorType: 'error',
    httpStatus: inspected.httpStatus,
    timeout: false,
    errorName: inspected.name,
    errorCode: inspected.code,
  };
}

export function isRetryableInterpreterFailure(failure: InterpreterFailure | null): boolean {
  if (!failure) return false;
  if (failure.kind === 'INTERPRETER_MISSING_KEY') return false;
  if (failure.kind === 'INTERPRETER_INVALID_RESPONSE') return false;
  if (failure.errorType === 'http_4xx' && failure.httpStatus !== 429) return false;
  return (
    failure.kind === 'INTERPRETER_TIMEOUT' ||
    failure.kind === 'INTERPRETER_RATE_LIMITED' ||
    failure.kind === 'INTERPRETER_UNAVAILABLE'
  );
}

export function metricForInterpreterLog(input: {
  success: boolean;
  timeout: boolean;
  errorType: string | null;
  fallbackUsed: boolean;
}): InterpreterCallLog['metric'] {
  if (input.success && input.fallbackUsed) return 'interpreter.fallback_used';
  if (input.success) return 'interpreter.success';
  if (input.timeout) return 'interpreter.timeout';
  if (input.errorType === 'rate_limit') return 'interpreter.rate_limit';
  if (input.errorType === 'empty' || input.errorType === 'invalid_json' || input.errorType === 'schema_invalid') {
    return 'interpreter.invalid_response';
  }
  return 'interpreter.unavailable';
}

export function logInterpreterCall(event: Omit<InterpreterCallLog, 'metric'> & { metric?: InterpreterCallLog['metric'] }): void {
  const metric =
    event.metric ??
    metricForInterpreterLog({
      success: event.success,
      timeout: event.timeout,
      errorType: event.errorType,
      fallbackUsed: event.fallbackUsed,
    });
  console.info('[whatsapp:interpreter]', JSON.stringify({ ...event, metric }));
}

export function interpreterModelChain(): { primary: string; fallback: string | null } {
  const primary =
    process.env.GEMINI_INTERPRETER_MODEL?.trim() ||
    process.env.GEMINI_WHATSAPP_MODEL?.trim() ||
    'gemini-3.5-flash-lite';
  const fallback =
    process.env.GEMINI_INTERPRETER_FALLBACK_MODEL?.trim() ||
    process.env.GEMINI_WHATSAPP_FALLBACK_MODEL?.trim() ||
    '';
  return { primary, fallback: fallback && fallback !== primary ? fallback : null };
}
