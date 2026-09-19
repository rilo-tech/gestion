import { db } from '../firebase.ts';
import type { TrialProductId } from '../../shared/platform-access.ts';
import type { BotHelpSectionId } from '../../shared/bot-help-catalog.ts';

export type WhatsAppOnboardingStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'skipped';

export type WhatsAppOnboardingState = {
  version: 1;
  status: WhatsAppOnboardingStatus;
  currentSection?: BotHelpSectionId | null;
  viewedSections?: BotHelpSectionId[];
  startedAt?: string | null;
  completedAt?: string | null;
  skippedAt?: string | null;
  shownTips?: string[];
  firstSuccessfulActionAt?: string | null;
  lastKnownProductId?: TrialProductId | null;
  knownSectionIds?: BotHelpSectionId[];
  metrics?: {
    onboardingStarted?: boolean;
    onboardingCompleted?: boolean;
    onboardingSkipped?: boolean;
    sectionsViewed?: BotHelpSectionId[];
  };
};

export function defaultWhatsAppOnboardingState(): WhatsAppOnboardingState {
  return {
    version: 1,
    status: 'not_started',
    viewedSections: [],
    shownTips: [],
    knownSectionIds: [],
    metrics: {},
  };
}

function normalizeSectionIds(raw: unknown): BotHelpSectionId[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row): row is BotHelpSectionId => typeof row === 'string');
}

export function normalizeWhatsAppOnboardingState(raw: unknown): WhatsAppOnboardingState {
  const base = defaultWhatsAppOnboardingState();
  if (!raw || typeof raw !== 'object') return base;
  const row = raw as Partial<WhatsAppOnboardingState>;
  const status =
    row.status === 'in_progress' ||
    row.status === 'completed' ||
    row.status === 'skipped' ||
    row.status === 'not_started'
      ? row.status
      : base.status;
  return {
    version: 1,
    status,
    currentSection: (row.currentSection as BotHelpSectionId | null | undefined) ?? null,
    viewedSections: normalizeSectionIds(row.viewedSections),
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    skippedAt: row.skippedAt ?? null,
    shownTips: Array.isArray(row.shownTips)
      ? row.shownTips.filter((tip): tip is string => typeof tip === 'string')
      : [],
    firstSuccessfulActionAt: row.firstSuccessfulActionAt ?? null,
    lastKnownProductId: row.lastKnownProductId ?? null,
    knownSectionIds: normalizeSectionIds(row.knownSectionIds),
    metrics: row.metrics && typeof row.metrics === 'object' ? row.metrics : {},
  };
}

function onboardingRef(businessId: string) {
  return db.doc(`negocios/${businessId}/private/whatsapp_onboarding`);
}

export async function loadWhatsAppOnboardingState(
  businessId: string
): Promise<WhatsAppOnboardingState> {
  const key = String(businessId ?? '').trim();
  if (!key) return defaultWhatsAppOnboardingState();
  const snap = await onboardingRef(key).get();
  if (!snap.exists) return defaultWhatsAppOnboardingState();
  return normalizeWhatsAppOnboardingState(snap.data());
}

export async function saveWhatsAppOnboardingState(
  businessId: string,
  patch: Partial<WhatsAppOnboardingState>
): Promise<WhatsAppOnboardingState> {
  const key = String(businessId ?? '').trim();
  const current = await loadWhatsAppOnboardingState(key);
  const next = normalizeWhatsAppOnboardingState({ ...current, ...patch, version: 1 });
  await onboardingRef(key).set(next, { merge: true });
  return next;
}

export function onboardingFinished(state: WhatsAppOnboardingState): boolean {
  return state.status === 'completed' || state.status === 'skipped';
}

export function markSectionViewed(
  state: WhatsAppOnboardingState,
  sectionId: BotHelpSectionId
): WhatsAppOnboardingState {
  const viewed = new Set(state.viewedSections ?? []);
  viewed.add(sectionId);
  const metricsSections = new Set(state.metrics?.sectionsViewed ?? []);
  metricsSections.add(sectionId);
  return {
    ...state,
    viewedSections: [...viewed],
    currentSection: sectionId,
    metrics: {
      ...state.metrics,
      sectionsViewed: [...metricsSections],
    },
  };
}

export function detectNewHelpSections(
  stored: WhatsAppOnboardingState,
  currentSectionIds: BotHelpSectionId[]
): BotHelpSectionId[] {
  if (!onboardingFinished(stored)) return [];
  const known = new Set(stored.knownSectionIds ?? []);
  return currentSectionIds.filter((id) => !known.has(id));
}

export type OnboardingDelta =
  | { kind: 'upgrade'; sectionIds: BotHelpSectionId[] }
  | { kind: 'new_features'; sectionIds: BotHelpSectionId[] }
  | null;

export function detectOnboardingDelta(
  stored: WhatsAppOnboardingState,
  currentProductId: TrialProductId | null,
  currentSectionIds: BotHelpSectionId[]
): OnboardingDelta {
  if (!onboardingFinished(stored)) return null;
  const newSections = detectNewHelpSections(stored, currentSectionIds);
  if (!newSections.length) return null;
  const wasCash = stored.lastKnownProductId === 'cash';
  const nowBot = currentProductId === 'whatsapp' || currentProductId === 'completo';
  if (wasCash && nowBot) {
    return { kind: 'upgrade', sectionIds: newSections };
  }
  return { kind: 'new_features', sectionIds: newSections };
}

export async function recordOnboardingStarted(businessId: string): Promise<WhatsAppOnboardingState> {
  const current = await loadWhatsAppOnboardingState(businessId);
  if (current.metrics?.onboardingStarted) {
    return saveWhatsAppOnboardingState(businessId, {
      status: 'in_progress',
      startedAt: current.startedAt ?? new Date().toISOString(),
    });
  }
  return saveWhatsAppOnboardingState(businessId, {
    status: 'in_progress',
    startedAt: new Date().toISOString(),
    metrics: { ...current.metrics, onboardingStarted: true },
  });
}

export async function recordOnboardingCompleted(
  businessId: string,
  productId: TrialProductId | null,
  sectionIds: BotHelpSectionId[]
): Promise<WhatsAppOnboardingState> {
  const current = await loadWhatsAppOnboardingState(businessId);
  return saveWhatsAppOnboardingState(businessId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
    lastKnownProductId: productId,
    knownSectionIds: sectionIds,
    metrics: { ...current.metrics, onboardingCompleted: true },
  });
}

export async function recordOnboardingSkipped(
  businessId: string,
  productId: TrialProductId | null,
  sectionIds: BotHelpSectionId[]
): Promise<WhatsAppOnboardingState> {
  const current = await loadWhatsAppOnboardingState(businessId);
  return saveWhatsAppOnboardingState(businessId, {
    status: 'skipped',
    skippedAt: new Date().toISOString(),
    lastKnownProductId: productId,
    knownSectionIds: sectionIds,
    metrics: { ...current.metrics, onboardingSkipped: true },
  });
}

export async function recordFirstSuccessfulAction(
  businessId: string
): Promise<WhatsAppOnboardingState | null> {
  const current = await loadWhatsAppOnboardingState(businessId);
  if (current.firstSuccessfulActionAt) return null;
  return saveWhatsAppOnboardingState(businessId, {
    firstSuccessfulActionAt: new Date().toISOString(),
  });
}

export async function recordTipShown(
  businessId: string,
  tipId: string
): Promise<WhatsAppOnboardingState> {
  const current = await loadWhatsAppOnboardingState(businessId);
  const shown = new Set(current.shownTips ?? []);
  shown.add(tipId);
  return saveWhatsAppOnboardingState(businessId, { shownTips: [...shown] });
}

export function shouldShowTip(state: WhatsAppOnboardingState, tipId: string): boolean {
  return !(state.shownTips ?? []).includes(tipId);
}
