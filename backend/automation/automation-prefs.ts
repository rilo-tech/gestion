import { db } from '../firebase.ts';
import type { AutomationChannel } from '../../shared/automation-channels.ts';
import type { AutomationPresetId } from '../../shared/automation-presets.ts';
import {
  emptyAutomationUserPrefs,
  type AutomationOfferChoice,
  type AutomationOfferId,
  type AutomationOfferState,
  type AutomationUserPrefs,
} from '../../shared/erp-notices.ts';

function prefsRef(businessId: string) {
  return db.doc(`negocios/${businessId}/private/automation_prefs`);
}

function mapPrefs(data: Record<string, unknown> | undefined): AutomationUserPrefs {
  const base = emptyAutomationUserPrefs();
  if (!data) return base;
  const muted = Array.isArray(data.mutedPresets)
    ? (data.mutedPresets.filter((x) => typeof x === 'string') as AutomationPresetId[])
    : [];
  const offersRaw =
    data.offers && typeof data.offers === 'object' ? (data.offers as Record<string, unknown>) : {};
  const offers: AutomationUserPrefs['offers'] = {};
  for (const [key, value] of Object.entries(offersRaw)) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const choice = String(row.choice ?? '') as AutomationOfferChoice;
    if (choice !== 'accepted' && choice !== 'deferred' && choice !== 'declined') continue;
    offers[key as AutomationOfferId] = {
      choice,
      at: String(row.at ?? ''),
      remindAfter: row.remindAfter != null ? String(row.remindAfter) : null,
    };
  }
  const preferred = Array.isArray(data.preferredChannels)
    ? (data.preferredChannels.filter(
        (c) => c === 'whatsapp' || c === 'erp'
      ) as AutomationChannel[])
    : null;
  const avisosRaw =
    data.avisos && typeof data.avisos === 'object'
      ? (data.avisos as Record<string, unknown>)
      : null;
  return {
    mutedPresets: muted,
    offers,
    preferredChannels: preferred,
    avisos: avisosRaw
      ? {
          payablesDaysBefore:
            typeof avisosRaw.payablesDaysBefore === 'number'
              ? avisosRaw.payablesDaysBefore
              : 3,
          preferredChannels: Array.isArray(avisosRaw.preferredChannels)
            ? (avisosRaw.preferredChannels.filter(
                (c) => c === 'whatsapp' || c === 'erp'
              ) as AutomationChannel[])
            : null,
          updatedAt: String(avisosRaw.updatedAt ?? base.updatedAt),
        }
      : base.avisos,
    updatedAt: String(data.updatedAt ?? base.updatedAt),
  };
}

export async function loadAutomationUserPrefs(businessId: string): Promise<AutomationUserPrefs> {
  const snap = await prefsRef(businessId).get();
  return mapPrefs(snap.data() as Record<string, unknown> | undefined);
}

export async function saveAutomationUserPrefs(
  businessId: string,
  patch: Partial<AutomationUserPrefs>
): Promise<AutomationUserPrefs> {
  const current = await loadAutomationUserPrefs(businessId);
  const next: AutomationUserPrefs = {
    mutedPresets: patch.mutedPresets ?? current.mutedPresets,
    offers: patch.offers ? { ...current.offers, ...patch.offers } : current.offers,
    preferredChannels:
      patch.preferredChannels !== undefined ? patch.preferredChannels : current.preferredChannels,
    avisos: patch.avisos
      ? {
          ...(current.avisos ?? emptyAutomationUserPrefs().avisos!),
          ...patch.avisos,
          updatedAt: new Date().toISOString(),
        }
      : current.avisos,
    updatedAt: new Date().toISOString(),
  };
  await prefsRef(businessId).set(next, { merge: true });
  return next;
}

export async function recordAutomationOfferChoice(
  businessId: string,
  offerId: AutomationOfferId,
  choice: AutomationOfferChoice,
  options?: { remindAfterDays?: number }
): Promise<AutomationUserPrefs> {
  const at = new Date().toISOString();
  const state: AutomationOfferState = { choice, at };
  if (choice === 'deferred') {
    const days = options?.remindAfterDays ?? 14;
    state.remindAfter = new Date(Date.now() + days * 86_400_000).toISOString();
  }
  return saveAutomationUserPrefs(businessId, {
    offers: { [offerId]: state },
  });
}

export async function muteAutomationPreset(
  businessId: string,
  presetId: AutomationPresetId
): Promise<AutomationUserPrefs> {
  const current = await loadAutomationUserPrefs(businessId);
  if (current.mutedPresets.includes(presetId)) return current;
  return saveAutomationUserPrefs(businessId, {
    mutedPresets: [...current.mutedPresets, presetId],
  });
}

export function isOfferEligible(
  prefs: AutomationUserPrefs,
  offerId: AutomationOfferId,
  now = new Date()
): boolean {
  const state = prefs.offers[offerId];
  if (!state) return true;
  if (state.choice === 'accepted' || state.choice === 'declined') return false;
  if (state.choice === 'deferred') {
    if (!state.remindAfter) return false;
    return Date.parse(state.remindAfter) <= now.getTime();
  }
  return true;
}
