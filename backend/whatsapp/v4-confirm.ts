import { classifyConfirmReply } from './turn-interpreter.ts';
import { sanitizeUserFacingErrorMessage } from './agent/agent-errors.ts';

export const V4_CONFIRM_INTENT = 'confirm:v4_write';

export function isDeterministicYes(text: string): boolean {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '1') return true;
  return classifyConfirmReply(text) === 'confirm';
}

/** «No» corto: no cancela el plan; invita a corregir. */
export function isSoftConfirmReject(text: string): boolean {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ');
  return /^(no+|n[oó]|nop|n|nah)\s*[.!]*$/i.test(t);
}

/** Cancelación explícita (cancelá / dejalo / 0 / no lo guardes…). */
export function isHardConfirmCancel(text: string): boolean {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '0') return true;
  if (isSoftConfirmReject(trimmed)) return false;
  return classifyConfirmReply(text) === 'cancel';
}

export function isDeterministicNo(text: string): boolean {
  return isHardConfirmCancel(text) || isSoftConfirmReject(text);
}

export function isConfirmCorrection(text: string): boolean {
  return classifyConfirmReply(text) === 'correct';
}

/** Sí / ok / dale + texto extra (ej. «sí y saldalo todo»): confirmar y enmendar en el mismo turno. */
export function isConfirmAmendment(text: string): boolean {
  return classifyConfirmReply(text) === 'confirm_amend';
}

export function shouldExecuteFrozenPlan(
  pendingIntent: string | null | undefined,
  text: string
): boolean {
  return pendingIntent === V4_CONFIRM_INTENT && isDeterministicYes(text);
}

export function shouldCancelFrozenPlan(
  pendingIntent: string | null | undefined,
  text: string
): boolean {
  return pendingIntent === V4_CONFIRM_INTENT && isHardConfirmCancel(text);
}

/** «No» sin cancelar: mantiene el plan y pide qué cambiar. */
export function shouldInviteConfirmEdit(
  pendingIntent: string | null | undefined,
  text: string
): boolean {
  return pendingIntent === V4_CONFIRM_INTENT && isSoftConfirmReject(text);
}

export function shouldReinterpretPendingConfirm(
  pendingIntent: string | null | undefined,
  text: string
): boolean {
  return (
    pendingIntent === V4_CONFIRM_INTENT &&
    (isConfirmCorrection(text) || isConfirmAmendment(text))
  );
}

export function shouldAutoExecuteAmendedConfirm(
  pendingIntent: string | null | undefined,
  text: string
): boolean {
  return pendingIntent === V4_CONFIRM_INTENT && isConfirmAmendment(text);
}

export function mapFrozenWriteError(error: unknown): { code: string; reply: string } {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  if (
    error instanceof ReferenceError ||
    error instanceof TypeError ||
    /\bis not defined\b/i.test(message) ||
    /referenceerror|typeerror/i.test(message)
  ) {
    console.error('[v4:write] internal runtime error', error);
    return {
      code: 'ERP_WRITE_FAILED',
      reply: 'No pude completar ese cambio. No modifiqué nada.',
    };
  }
  if (lower.includes('write_not_persisted') || lower.includes('no se pudo persistir') || lower.includes('sigue como')) {
    return {
      code: 'ERP_WRITE_FAILED',
      reply: sanitizeUserFacingErrorMessage(
        message.replace(/^WRITE_NOT_PERSISTED:\s*/i, '').trim() ||
          'No pude guardar ese cambio. No modifiqué nada en el sistema. Probá de nuevo.'
      ),
    };
  }
  if (lower.includes('no encontré ese pedido') || lower.includes('no encontré el pedido')) {
    return { code: 'ORDER_NOT_FOUND', reply: sanitizeUserFacingErrorMessage(message) };
  }
  if (lower.includes('no puedo hacer ese cambio') || lower.includes('transición')) {
    return { code: 'INVALID_STATUS_TRANSITION', reply: sanitizeUserFacingErrorMessage(message) };
  }
  if (lower.includes('permiso')) {
    return { code: 'PERMISSION_DENIED', reply: 'No tenés permiso para esa acción en WhatsApp.' };
  }
  if (message) {
    return { code: 'DOMAIN_VALIDATION_ERROR', reply: sanitizeUserFacingErrorMessage(message) };
  }
  return {
    code: 'ERP_WRITE_FAILED',
    reply: 'No pude completar esa operación. Escribime de nuevo en un momento.',
  };
}
