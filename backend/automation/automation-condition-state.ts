import type { AutomationComparator, AutomationConditionState } from '../../shared/automation-types.ts';

export type ConditionEvaluationInput = {
  conditionMet: boolean;
  conditionValue?: number;
  threshold?: number;
  comparator?: AutomationComparator;
  state: AutomationConditionState;
  now?: Date;
};

export type ConditionEvaluationResult = {
  shouldNotify: boolean;
  nextState: AutomationConditionState;
};

/**
 * Anti-spam para condition_watch:
 * - Dispara solo si armed && conditionMet
 * - Rearma cuando la condición deja de cumplirse
 */
export function evaluateConditionWatchState(input: ConditionEvaluationInput): ConditionEvaluationResult {
  const now = (input.now ?? new Date()).toISOString();
  const state = { ...input.state };
  const armed = state.armed !== false;

  if (input.conditionMet) {
    if (armed) {
      return {
        shouldNotify: true,
        nextState: {
          armed: false,
          lastTriggeredAt: now,
          lastConditionValue: input.conditionValue,
        },
      };
    }
    return {
      shouldNotify: false,
      nextState: {
        ...state,
        lastConditionValue: input.conditionValue,
      },
    };
  }

  // Condición no cumplida → rearmar
  return {
    shouldNotify: false,
    nextState: {
      armed: true,
      lastTriggeredAt: state.lastTriggeredAt ?? null,
      lastConditionValue: input.conditionValue,
    },
  };
}

export function isConditionMetByComparator(
  current: number,
  threshold: number,
  comparator: AutomationComparator
): boolean {
  switch (comparator) {
    case 'lt':
      return current < threshold;
    case 'lte':
      return current <= threshold;
    case 'gt':
      return current > threshold;
    case 'gte':
      return current >= threshold;
    case 'eq':
      return current === threshold;
    default:
      return false;
  }
}
