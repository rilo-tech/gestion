export type AgentErrorCode =
  | 'MODEL_UNAVAILABLE'
  | 'TOOL_VALIDATION_ERROR'
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_AMBIGUOUS'
  | 'PERMISSION_DENIED'
  | 'CAPABILITY_NOT_ENABLED'
  | 'DOMAIN_VALIDATION_ERROR'
  | 'ERP_WRITE_FAILED'
  | 'FILTER_PRESERVATION'
  | 'TOOL_LOOP_LIMIT';

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: AgentErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.details = details;
  }
}

export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError;
}

const GENERIC_WRITE_FAIL = 'No pude completar ese cambio. No modifiqué nada.';

/** Errores de runtime / internals que NUNCA deben llegar a WhatsApp. */
export function isInternalErrorLeak(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name || '';
  if (name === 'ReferenceError' || name === 'TypeError' || name === 'SyntaxError' || name === 'RangeError') {
    return true;
  }
  const message = String(error.message ?? '');
  return (
    /\bis not defined\b/i.test(message) ||
    /\bis not a function\b/i.test(message) ||
    /Cannot read propert/i.test(message) ||
    /Cannot access .+ before initialization/i.test(message) ||
    /ReferenceError|TypeError|SyntaxError/i.test(message) ||
    /\bplanAllowsAutoCommit\b/i.test(message) ||
    /\bstack trace\b/i.test(message) ||
    / at [A-Za-z0-9_$.]+\s*\(/i.test(message)
  );
}

/** Filtra mensajes técnicos (nombres de tools, codes internos) del texto al usuario. */
export function sanitizeUserFacingErrorMessage(message: string): string {
  const raw = String(message ?? '').trim();
  if (!raw) return GENERIC_WRITE_FAIL;
  if (
    /\bis not defined\b/i.test(raw) ||
    /ReferenceError|TypeError|SyntaxError/i.test(raw) ||
    /\bplanAllowsAutoCommit\b/i.test(raw) ||
    /^WRITE_NOT_PERSISTED/i.test(raw) ||
    /\b(tool|handler|capability)\b/i.test(raw)
  ) {
    return GENERIC_WRITE_FAIL;
  }
  return raw;
}

export function agentErrorReply(error: unknown): string {
  if (isInternalErrorLeak(error)) {
    return GENERIC_WRITE_FAIL;
  }
  if (isAgentError(error)) {
    switch (error.code) {
      case 'MODEL_UNAVAILABLE':
        return 'No pude procesar ese mensaje ahora. Probá nuevamente en unos segundos.';
      case 'PERMISSION_DENIED':
        return 'No tenés permiso para esa acción en WhatsApp.';
      case 'CAPABILITY_NOT_ENABLED':
        return 'Esa acción todavía no está disponible por WhatsApp.';
      default:
        return sanitizeUserFacingErrorMessage(error.message || GENERIC_WRITE_FAIL);
    }
  }
  if (error instanceof Error && error.message) {
    return sanitizeUserFacingErrorMessage(error.message);
  }
  return 'No pude completar esa operación.';
}

export const MODEL_UNAVAILABLE_REPLY =
  'No pude procesar ese mensaje ahora. Probá nuevamente en unos segundos.';

export const GENERIC_WRITE_FAIL_REPLY = GENERIC_WRITE_FAIL;





