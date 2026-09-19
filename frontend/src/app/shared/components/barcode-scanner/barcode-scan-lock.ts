/**
 * Deduplicación de lecturas continuas de cámara.
 * Un código bloqueado solo se libera tras ausentarse LOCK_ABSENCE_MS.
 * No usar solo un timeout de "ignorar 500ms" — un código quieto no debe recontarse.
 */
export const BARCODE_LOCK_ABSENCE_MS = 900;

export type ContinuousScanLockState = {
  lockedCode: string | null;
  lockedLastSeenAt: number;
};

export function createContinuousScanLock(): ContinuousScanLockState {
  return { lockedCode: null, lockedLastSeenAt: 0 };
}

/**
 * @returns true si esta detección debe emitir un nuevo escaneo
 */
export function observeContinuousScan(
  state: ContinuousScanLockState,
  code: string,
  now: number,
  absenceMs = BARCODE_LOCK_ABSENCE_MS
): boolean {
  if (!code) return false;

  if (state.lockedCode === code) {
    state.lockedLastSeenAt = now;
    return false;
  }

  if (state.lockedCode && state.lockedCode !== code) {
    if (now - state.lockedLastSeenAt < absenceMs) {
      return false;
    }
  }

  state.lockedCode = code;
  state.lockedLastSeenAt = now;
  return true;
}

/** Liberar lock si el código dejó de verse. */
export function releaseContinuousScanIfAbsent(
  state: ContinuousScanLockState,
  now: number,
  absenceMs = BARCODE_LOCK_ABSENCE_MS
): boolean {
  if (!state.lockedCode) return false;
  if (now - state.lockedLastSeenAt >= absenceMs) {
    state.lockedCode = null;
    return true;
  }
  return false;
}
