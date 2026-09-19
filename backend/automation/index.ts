export {
  getAutomationAction,
  listAutomationActions,
  summarizeAutomation,
  resolveBusinessTimezone,
  defaultConditionState,
  defaultComparatorForAction,
} from './automation-action-registry.ts';
export {
  isAutomationActionAvailable,
  listAvailableAutomationActions,
  buildAutomationCategoryMenus,
  formatAvailableActionsMenu,
  formatCategoryActionsMenu,
  assertActionAvailable,
  isAutomationsEntitlementEnabled,
} from './automation-availability.ts';
export {
  createAutomation,
  listAutomations,
  getAutomation,
  updateAutomation,
  setAutomationStatus,
  markAutomationRun,
  getAutomationUsageMetrics,
  listDueAutomations,
  computeNextRunAt,
} from './automation-service.ts';
export { executeAutomationRecord, runAutomationTick } from './automation-executor.ts';
export { evaluateConditionWatchState } from './automation-condition-state.ts';
export { formatAutomationMessage, formatAutomationConfirmation } from './automation-presenters.ts';
export {
  listErpNotices,
  createErpNotice,
  updateErpNoticeStatus,
} from './erp-notices.ts';
export {
  loadAutomationUserPrefs,
  saveAutomationUserPrefs,
  recordAutomationOfferChoice,
} from './automation-prefs.ts';
export {
  listPresetViews,
  setPresetEnabled,
  listProgressiveOffers,
  respondProgressiveOffer,
  enableStandardRecommendedAlerts,
  STANDARD_V1_RECOMMENDED_PRESET_IDS,
} from './automation-presets-service.ts';
