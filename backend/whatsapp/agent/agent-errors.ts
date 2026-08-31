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

export function agentErrorReply(error: unknown): string {
  if (isAgentError(error)) {
    switch (error.code) {
      case 'MODEL_UNAVAILABLE':
        return 'No pude procesar ese mensaje ahora. Probá nuevamente en unos segundos.';
      case 'PERMISSION_DENIED':
        return 'No tenés permiso para esa acción en WhatsApp.';
      case 'CAPABILITY_NOT_ENABLED':
        return String(error.message || 'Esa acción todavía no está disponible en WhatsApp.');
      default:
        return String(error.message || 'No pude completar esa operación.');
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return 'No pude completar esa operación.';
}

export const MODEL_UNAVAILABLE_REPLY =
  'No pude procesar ese mensaje ahora. Probá nuevamente en unos segundos.';
