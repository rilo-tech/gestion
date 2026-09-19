/**
 * Score UX interno 0–100 (no verdad absoluta).
 *
 * taskSuccess 40 + pasos 15 + claridad 15 + errores 10 + responsive 10 + a11y 10
 */

export type UxScoreParts = {
  taskSuccess: number; // 0–40
  pasos: number; // 0–15 (más pasos ⇒ menos puntos)
  claridad: number; // 0–15
  errores: number; // 0–10 (menos errores ⇒ más puntos)
  responsive: number; // 0–10
  accessibility: number; // 0–10
};

export type UxSeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UX_POLISH';

export type UxFinding = {
  id: string;
  severity: UxSeverity;
  area: string;
  title: string;
  detail: string;
  autoFixed?: boolean;
  stagingRequired?: boolean;
};

export type UxScenarioResult = {
  id: string;
  flow: string;
  persona: string;
  viewport: string;
  entry: string;
  steps: string[];
  expected: string;
  taskSuccess: boolean;
  stepCount: number;
  friction: string[];
  screenshots: string[];
  observations: string[];
  env: 'LOCAL' | 'STAGING';
  status: 'PASS' | 'FAIL' | 'PARTIAL' | 'STAGING_REQUIRED' | 'SKIPPED';
  score: number;
  parts: UxScoreParts;
  findings: UxFinding[];
};

export const CRITICAL_FLOW_IDS = [
  'registro',
  'onboarding',
  'primera-venta',
  'pedido',
  'finalizar-pedido',
  'payable',
  'avisos',
  'resumen-rilo',
  'settings-avisos',
] as const;

export const CRITICAL_SCORE_TARGET = 85;

/** Pasos ideales → 15 pts; cada paso extra resta ~1.5 hasta 0. */
export function scorePasos(stepCount: number, idealMax = 6): number {
  if (stepCount <= idealMax) return 15;
  const penalty = (stepCount - idealMax) * 1.5;
  return Math.max(0, Math.round(15 - penalty));
}

export function scoreFromParts(parts: UxScoreParts): number {
  const total =
    clamp(parts.taskSuccess, 0, 40) +
    clamp(parts.pasos, 0, 15) +
    clamp(parts.claridad, 0, 15) +
    clamp(parts.errores, 0, 10) +
    clamp(parts.responsive, 0, 10) +
    clamp(parts.accessibility, 0, 10);
  return Math.round(total);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function buildScenarioScore(input: {
  taskSuccess: boolean;
  stepCount: number;
  idealSteps?: number;
  clarityNotes: string[];
  errorCount: number;
  responsiveOk: boolean;
  a11yHighCount: number;
}): { score: number; parts: UxScoreParts } {
  const parts: UxScoreParts = {
    taskSuccess: input.taskSuccess ? 40 : 0,
    pasos: scorePasos(input.stepCount, input.idealSteps ?? 6),
    claridad: Math.max(0, 15 - input.clarityNotes.length * 3),
    errores: Math.max(0, 10 - input.errorCount * 4),
    responsive: input.responsiveOk ? 10 : 3,
    accessibility: Math.max(0, 10 - input.a11yHighCount * 4),
  };
  return { score: scoreFromParts(parts), parts };
}
