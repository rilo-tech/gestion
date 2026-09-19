/**
 * Lógica pura de milestones de analytics (idempotente).
 * Usada por AnalyticsEventService y por tests sin Firestore.
 */
export type AnalyticsMilestonesState = {
  firstBotMessageAt?: string | null;
  firstOperationCompletedAt?: string | null;
  thirdOperationCompletedAt?: string | null;
  botWriteOperationCount?: number;
};

export function applyFirstBotMessageMilestone(
  current: AnalyticsMilestonesState,
  at: string
): { next: AnalyticsMilestonesState; emitted: boolean } {
  if (current.firstBotMessageAt) {
    return { next: { ...current }, emitted: false };
  }
  return {
    next: { ...current, firstBotMessageAt: at },
    emitted: true,
  };
}

export function applyBusinessOperationMilestone(
  current: AnalyticsMilestonesState,
  at: string
): {
  next: AnalyticsMilestonesState;
  counted: boolean;
  firstOperationEmitted: boolean;
  thirdOperationEmitted: boolean;
  operationCount: number;
} {
  const prevCount = Number(current.botWriteOperationCount) || 0;
  const operationCount = prevCount + 1;
  const next: AnalyticsMilestonesState = {
    ...current,
    botWriteOperationCount: operationCount,
  };
  let firstOperationEmitted = false;
  let thirdOperationEmitted = false;

  if (operationCount === 1 && !current.firstOperationCompletedAt) {
    next.firstOperationCompletedAt = at;
    firstOperationEmitted = true;
  } else if (current.firstOperationCompletedAt) {
    next.firstOperationCompletedAt = current.firstOperationCompletedAt;
  }

  if (operationCount === 3 && !current.thirdOperationCompletedAt) {
    next.thirdOperationCompletedAt = at;
    thirdOperationEmitted = true;
  } else if (current.thirdOperationCompletedAt) {
    next.thirdOperationCompletedAt = current.thirdOperationCompletedAt;
  }

  return {
    next,
    counted: true,
    firstOperationEmitted,
    thirdOperationEmitted,
    operationCount,
  };
}
