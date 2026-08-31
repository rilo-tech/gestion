import { classifyConfirmReply } from './turn-interpreter.ts';

export const V4_CONFIRM_INTENT = 'confirm:v4_write';

export function isDeterministicYes(text: string): boolean {
  return classifyConfirmReply(text) === 'confirm';
}

export function isDeterministicNo(text: string): boolean {
  return classifyConfirmReply(text) === 'cancel';
}

export function isConfirmCorrection(text: string): boolean {
  return classifyConfirmReply(text) === 'correct';
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
  return pendingIntent === V4_CONFIRM_INTENT && isDeterministicNo(text);
}

export function shouldReinterpretPendingConfirm(
  pendingIntent: string | null | undefined,
  text: string
): boolean {
  return pendingIntent === V4_CONFIRM_INTENT && isConfirmCorrection(text);
}

export function mapFrozenWriteError(error: unknown): { code: string; reply: string } {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  if (lower.includes('no encontré ese pedido') || lower.includes('no encontré el pedido')) {
    return { code: 'ORDER_NOT_FOUND', reply: message };
  }
  if (lower.includes('no puedo hacer ese cambio') || lower.includes('transición')) {
    return { code: 'INVALID_STATUS_TRANSITION', reply: message };
  }
  if (lower.includes('permiso')) {
    return { code: 'PERMISSION_DENIED', reply: 'No tenés permiso para esa acción en WhatsApp.' };
  }
  if (message) {
    return { code: 'DOMAIN_VALIDATION_ERROR', reply: message };
  }
  return {
    code: 'ERP_WRITE_FAILED',
    reply: 'No pude completar esa operación. Escribime de nuevo en un momento.',
  };
}
