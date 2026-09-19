import { updateBusiness, getBusiness, resolveForBusiness } from '../auth/business.ts';
import { db } from '../firebase.ts';
import {
  buildHelpMenuPage,
  formatHelpMenuMessage,
  formatMoreMenuMessage,
  formatNewFeatureNotice,
  formatSectionDetail,
  formatTryNowPrompt,
  formatUpgradeWelcome,
  formatWelcomeMessage,
  listEnabledHelpSections,
  productWelcomeTitle,
  resolveSectionCopy,
  type BotHelpMenuContext,
  type BotHelpMenuOption,
  type BotHelpSectionId,
} from '../../shared/bot-help-catalog.ts';
import {
  normalizeBusinessProfile,
  resolveBusinessProfile,
  type BusinessProfile,
} from '../../shared/business-profile.ts';
import { productIdFromAccess } from '../../shared/platform-access.ts';
import { emptyModulesMap } from '../../shared/subscription-modules.ts';
import { formatWhatsappOutbound } from '../../shared/whatsapp-format.ts';
import type { ConversationState } from './conversation-state.ts';
import { parseNumericSelectionTurn } from './v4-candidate-selection.ts';
import { loadWhatsappCajaAmbitos } from './cash-ambito.ts';
import {
  effectiveDefaultCashAccountId,
  invalidateBusinessDefaultsCache,
  loadBusinessOperationalDefaults,
} from './business-defaults.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import {
  detectOnboardingDelta,
  loadWhatsAppOnboardingState,
  markSectionViewed,
  onboardingFinished,
  recordOnboardingCompleted,
  recordOnboardingSkipped,
  recordOnboardingStarted,
  saveWhatsAppOnboardingState,
  type WhatsAppOnboardingState,
} from './v4-onboarding-state.ts';

export const V4_ONBOARDING_INTENT = 'awaiting:v4_onboarding';

export type V4OnboardingScreen =
  | 'welcome'
  | 'main'
  | 'more'
  | 'section'
  | 'cash_setup_name'
  | 'cash_setup_pick'
  | 'upgrade'
  | 'new_feature';

export type V4OnboardingAwaiting = {
  type: 'v4_onboarding';
  screen: V4OnboardingScreen;
  options: BotHelpMenuOption[];
  sectionId?: BotHelpSectionId;
  page?: number;
  deltaSectionIds?: BotHelpSectionId[];
  cashCandidates?: Array<{ id: string; label: string }>;
};

export type V4OnboardingTurnResult =
  | { kind: 'handled'; reply: string; intent: string; statePatch: Partial<ConversationState> }
  | { kind: 'escape'; statePatch?: Partial<ConversationState> }
  | { kind: 'skip' };

export function getV4OnboardingAwaiting(
  state: ConversationState | null | undefined
): V4OnboardingAwaiting | null {
  if (state?.pendingIntent !== V4_ONBOARDING_INTENT) return null;
  const payload = state.pendingPayload?.v4Onboarding;
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as V4OnboardingAwaiting;
  if (row.type !== 'v4_onboarding' || !Array.isArray(row.options)) return null;
  return row;
}

function onboardingPayload(awaiting: V4OnboardingAwaiting): Partial<ConversationState> {
  return {
    pendingIntent: V4_ONBOARDING_INTENT,
    pendingPayload: { v4Onboarding: awaiting },
    pendingPrompt: null,
    activeTask: {
      intent: V4_ONBOARDING_INTENT,
      awaiting: { type: 'v4_onboarding', reason: awaiting.screen },
    },
  };
}

function clearOnboardingPayload(): Partial<ConversationState> {
  return {
    pendingIntent: null,
    pendingPayload: null,
    pendingPrompt: null,
    activeTask: null,
  };
}

export function shouldBypassWelcomeOnFirstMessage(text: string): boolean {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return false;
  if (/^\d{1,2}$/.test(trimmed)) return false;
  return /\$\s*\d|\d{3,}/.test(trimmed);
}

export async function buildBotHelpMenuContext(
  tenant: WhatsappTenantContext
): Promise<BotHelpMenuContext> {
  const business = await getBusiness(tenant.businessId);
  const { resolved } = business
    ? await resolveForBusiness(business)
    : { resolved: { entitlements: emptyModulesMap(true) } };
  const profile = resolveBusinessProfile(business?.businessProfile);
  return {
    productId: productIdFromAccess(tenant.platformAccess),
    profile,
    entitlements: resolved.entitlements ?? emptyModulesMap(true),
    permission: true,
  };
}

function whatsappOperational(tenant: WhatsappTenantContext): boolean {
  const access = tenant.platformAccess;
  if (!access.whatsappEnabled || access.whatsappPaused) return false;
  if (tenant.accessRevoked) return false;
  const productId = productIdFromAccess(access);
  return productId === 'cash' || productId === 'whatsapp' || productId === 'completo';
}

type CashSetupGate =
  | { kind: 'ready' }
  | { kind: 'pick'; candidates: { id: string; label: string }[] }
  | { kind: 'name' };

async function resolveCashSetupGate(
  ctx: BotHelpMenuContext,
  businessId: string
): Promise<CashSetupGate> {
  const cashOn = listEnabledHelpSections(ctx).some((id) => id.startsWith('cash'));
  if (!cashOn) return { kind: 'ready' };

  const defaults = await loadBusinessOperationalDefaults(businessId);
  if (effectiveDefaultCashAccountId(defaults)) return { kind: 'ready' };

  const { caja, ambitos } = await loadWhatsappCajaAmbitos(businessId);
  if (ambitos.length > 1) {
    return {
      kind: 'pick',
      candidates: ambitos.map((row) => ({ id: row.id, label: row.label })),
    };
  }

  const rawAmbitos = caja.ambitos;
  const hasCustomLabel =
    Array.isArray(rawAmbitos) &&
    rawAmbitos.some((row) => {
      if (!row || typeof row !== 'object') return false;
      const label = String((row as { label?: unknown }).label ?? '').trim();
      return label.length > 0 && label.toLowerCase() !== 'negocio';
    });
  if (hasCustomLabel || ctx.profile.onboarding.completed) return { kind: 'ready' };
  return { kind: 'name' };
}

async function saveDefaultCashAccountId(businessId: string, accountId: string): Promise<void> {
  const snap = await db.doc(`negocios/${businessId}`).get();
  const profile = resolveBusinessProfile(
    snap.data()?.businessProfile as Partial<BusinessProfile> | undefined
  );
  const next = normalizeBusinessProfile({
    ...profile,
    defaults: { ...profile.defaults, defaultCashAccountId: accountId.trim().toLowerCase() },
  });
  await updateBusiness(businessId, { businessProfile: next });
  invalidateBusinessDefaultsCache(businessId);
}

async function renameBusinessCashLabel(businessId: string, label: string): Promise<void> {
  const ref = db.doc(`negocios/${businessId}/config/app`);
  const snap = await ref.get();
  const data = snap.data() ?? {};
  const caja = (data.caja as Record<string, unknown>) ?? {};
  const raw = Array.isArray(caja.ambitos) ? [...caja.ambitos] : [];
  const extras = raw.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const id = String((row as { id?: unknown }).id ?? '')
      .trim()
      .toLowerCase();
    return id && id !== 'negocio';
  });
  await ref.set(
    {
      caja: {
        ...caja,
        ambitos: [{ id: 'negocio', label: label.trim(), sistema: true }, ...extras],
      },
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

function findOption(
  awaiting: V4OnboardingAwaiting,
  index: number | undefined
): BotHelpMenuOption | null {
  if (index == null || !Number.isFinite(index)) return null;
  return awaiting.options.find((row) => row.index === index) ?? null;
}

function formatCashSetupNamePrompt(): string {
  return (
    `*💰 Primero configuremos tu caja*\n\n` +
    `¿Cómo querés llamarla?\n\n` +
    `Por ejemplo:\nNegocio`
  );
}

function formatCashSetupPickPrompt(candidates: { id: string; label: string }[]): string {
  const lines = ['*¿Cuál querés usar normalmente?*', ''];
  candidates.forEach((row, i) => {
    lines.push(`${i + 1}. ${row.label}`);
  });
  lines.push('0. No elegir ahora', '', 'Elegí una opción.');
  return lines.join('\n');
}

async function beginWelcomeOrSetup(
  tenant: WhatsappTenantContext,
  ctx: BotHelpMenuContext,
  screen: V4OnboardingScreen = 'welcome'
): Promise<V4OnboardingTurnResult> {
  const setup = await resolveCashSetupGate(ctx, tenant.businessId);
  if (setup.kind === 'name') {
    await recordOnboardingStarted(tenant.businessId);
    return {
      kind: 'handled',
      reply: formatWhatsappOutbound(formatCashSetupNamePrompt()),
      intent: 'v4_onboarding_cash_name',
      statePatch: onboardingPayload({
        type: 'v4_onboarding',
        screen: 'cash_setup_name',
        options: [],
      }),
    };
  }
  if (setup.kind === 'pick') {
    await recordOnboardingStarted(tenant.businessId);
    const options: BotHelpMenuOption[] = [{ index: 0, id: 'start', label: 'No elegir ahora' }];
    setup.candidates.forEach((row, i) => {
      options.push({ index: i + 1, id: 'cash', label: row.label });
    });
    return {
      kind: 'handled',
      reply: formatWhatsappOutbound(formatCashSetupPickPrompt(setup.candidates)),
      intent: 'v4_onboarding_cash_pick',
      statePatch: onboardingPayload({
        type: 'v4_onboarding',
        screen: 'cash_setup_pick',
        options,
        cashCandidates: setup.candidates,
      }),
    };
  }

  await recordOnboardingStarted(tenant.businessId);
  const menu = buildHelpMenuPage(ctx, 0, {
    startLabel: ctx.productId === 'cash' ? 'Listo, empezar' : 'Empezar a usar RILO',
  });
  const reply =
    screen === 'welcome'
      ? formatWelcomeMessage(ctx, menu)
      : formatHelpMenuMessage(ctx, menu);
  return {
    kind: 'handled',
    reply: formatWhatsappOutbound(reply),
    intent: screen === 'welcome' ? 'v4_onboarding_welcome' : 'v4_onboarding_menu',
    statePatch: onboardingPayload({
      type: 'v4_onboarding',
      screen: screen === 'welcome' ? 'welcome' : 'main',
      options: menu.options,
      page: menu.page,
    }),
  };
}

async function beginDeltaMenu(
  tenant: WhatsappTenantContext,
  ctx: BotHelpMenuContext,
  delta: { kind: 'upgrade' | 'new_features'; sectionIds: BotHelpSectionId[] }
): Promise<V4OnboardingTurnResult> {
  if (delta.kind === 'new_features' && delta.sectionIds.length === 1) {
    const copy = resolveSectionCopy(delta.sectionIds[0]!, ctx.profile);
    const options: BotHelpMenuOption[] = [
      { index: 1, id: delta.sectionIds[0]!, label: 'Sí, mostrame cómo funciona' },
      { index: 0, id: 'start', label: 'Ahora no' },
    ];
    return {
      kind: 'handled',
      reply: formatWhatsappOutbound(formatNewFeatureNotice(copy.label)),
      intent: 'v4_onboarding_new_feature',
      statePatch: onboardingPayload({
        type: 'v4_onboarding',
        screen: 'new_feature',
        options,
        deltaSectionIds: delta.sectionIds,
        sectionId: delta.sectionIds[0],
      }),
    };
  }

  const options: BotHelpMenuOption[] = [{ index: 0, id: 'start', label: 'Ahora no' }];
  delta.sectionIds.forEach((id, i) => {
    const copy = resolveSectionCopy(id, ctx.profile);
    options.push({ index: i + 1, id, label: copy.label });
  });
  const labels = delta.sectionIds.map((id) => resolveSectionCopy(id, ctx.profile).label);
  const title = productWelcomeTitle(ctx.productId);
  return {
    kind: 'handled',
    reply: formatWhatsappOutbound(formatUpgradeWelcome(title, labels)),
    intent: 'v4_onboarding_upgrade',
    statePatch: onboardingPayload({
      type: 'v4_onboarding',
      screen: 'upgrade',
      options,
      deltaSectionIds: delta.sectionIds,
    }),
  };
}

async function openSection(
  ctx: BotHelpMenuContext,
  sectionId: BotHelpSectionId,
  onboarding: WhatsAppOnboardingState,
  businessId: string
): Promise<V4OnboardingTurnResult> {
  const nextOnboarding = markSectionViewed(onboarding, sectionId);
  await saveWhatsAppOnboardingState(businessId, nextOnboarding);

  let replyBody: string;
  if (sectionId === 'automations') {
    const { buildAutomationCategoryMenus, formatAvailableActionsMenu } = await import(
      '../automation/index.ts'
    );
    const menus = buildAutomationCategoryMenus({
      productId: ctx.productId,
      entitlements: ctx.entitlements,
      profile: ctx.profile,
      permission: ctx.permission ?? true,
    });
    if (menus.length) {
      replyBody = formatAvailableActionsMenu(menus).body;
      replyBody += '\n\n1. Probar ahora\n2. Ver otra función\n0. Salir de la guía\n\nElegí una opción.';
    } else {
      replyBody = formatSectionDetail(resolveSectionCopy(sectionId, ctx.profile));
    }
  } else {
    replyBody = formatSectionDetail(resolveSectionCopy(sectionId, ctx.profile));
  }

  return {
    kind: 'handled',
    reply: formatWhatsappOutbound(replyBody),
    intent: 'v4_onboarding_section',
    statePatch: onboardingPayload({
      type: 'v4_onboarding',
      screen: 'section',
      sectionId,
      options: [
        { index: 1, id: sectionId, label: 'Probar ahora' },
        { index: 2, id: 'more', label: 'Ver otra función' },
        { index: 0, id: 'start', label: 'Salir de la guía' },
      ],
    }),
  };
}

async function finishOnboarding(
  tenant: WhatsappTenantContext,
  ctx: BotHelpMenuContext,
  mode: 'completed' | 'skipped'
): Promise<Partial<ConversationState>> {
  const sectionIds = listEnabledHelpSections(ctx);
  if (mode === 'completed') {
    await recordOnboardingCompleted(tenant.businessId, ctx.productId, sectionIds);
  } else {
    await recordOnboardingSkipped(tenant.businessId, ctx.productId, sectionIds);
  }
  return clearOnboardingPayload();
}

export async function beginV4BotGuide(
  tenant: WhatsappTenantContext
): Promise<V4OnboardingTurnResult> {
  if (!whatsappOperational(tenant)) {
    return {
      kind: 'handled',
      reply: 'WhatsApp todavía no está activo para tu empresa.',
      intent: 'v4_onboarding_unavailable',
      statePatch: clearOnboardingPayload(),
    };
  }
  return beginWelcomeOrSetup(tenant, await buildBotHelpMenuContext(tenant), 'main');
}

export async function tryHandleV4OnboardingTurn(input: {
  tenant: WhatsappTenantContext;
  text: string;
  state: ConversationState | null;
}): Promise<V4OnboardingTurnResult> {
  const { tenant, text, state } = input;
  if (!whatsappOperational(tenant)) return { kind: 'skip' };

  const ctx = await buildBotHelpMenuContext(tenant);
  const onboarding = await loadWhatsAppOnboardingState(tenant.businessId);
  const awaiting = getV4OnboardingAwaiting(state);
  const trimmed = String(text ?? '').trim();
  const numeric = parseNumericSelectionTurn(trimmed);

  if (awaiting) {
    if (numeric.index == null) {
      await recordOnboardingSkipped(tenant.businessId, ctx.productId, listEnabledHelpSections(ctx));
      return {
        kind: 'escape',
        statePatch: clearOnboardingPayload(),
      };
    }

    if (awaiting.screen === 'cash_setup_name') {
      const name = trimmed.replace(/^\d+\s*[,;.]?\s*/, '').trim();
      if (!name || name.length < 2) {
        return {
          kind: 'handled',
          reply: formatWhatsappOutbound('Decime cómo querés llamar a tu caja. Por ejemplo: Negocio'),
          intent: 'v4_onboarding_cash_name',
          statePatch: {},
        };
      }
      await renameBusinessCashLabel(tenant.businessId, name);
      return beginWelcomeOrSetup(tenant, ctx, 'welcome');
    }

    if (awaiting.screen === 'cash_setup_pick') {
      const picked = findOption(awaiting, numeric.index);
      if (!picked) {
        const max = awaiting.options.reduce((acc, row) => Math.max(acc, row.index), 0);
        return {
          kind: 'handled',
          reply: formatWhatsappOutbound(`Elegí un número del 0 al ${max}.`),
          intent: 'v4_onboarding_invalid',
          statePatch: {},
        };
      }
      if (picked.index === 0) {
        return {
          kind: 'handled',
          reply: formatWhatsappOutbound('Dale. Cuando quieras, elegís tu caja desde el panel.'),
          intent: 'v4_onboarding_cash_pick_skip',
          statePatch: await finishOnboarding(tenant, ctx, 'skipped'),
        };
      }
      const candidates = awaiting.cashCandidates ?? [];
      const account = candidates[numeric.index! - 1];
      if (account) await saveDefaultCashAccountId(tenant.businessId, account.id);
      return beginWelcomeOrSetup(tenant, ctx, 'welcome');
    }

    const picked = findOption(awaiting, numeric.index);
    if (!picked) {
      const max = awaiting.options.reduce((acc, row) => Math.max(acc, row.index), 0);
      return {
        kind: 'handled',
        reply: formatWhatsappOutbound(`Elegí un número del 0 al ${max}.`),
        intent: 'v4_onboarding_invalid',
        statePatch: {},
      };
    }

    if (picked.id === 'start') {
      if (awaiting.screen === 'upgrade' || awaiting.screen === 'new_feature') {
        const sectionIds = listEnabledHelpSections(ctx);
        await saveWhatsAppOnboardingState(tenant.businessId, {
          knownSectionIds: sectionIds,
          lastKnownProductId: ctx.productId,
        });
        return {
          kind: 'handled',
          reply: formatWhatsappOutbound('Dale. Avisame si querés ver cómo funciona.'),
          intent: 'v4_onboarding_delta_skip',
          statePatch: clearOnboardingPayload(),
        };
      }
      const patch = await finishOnboarding(tenant, ctx, 'skipped');
      return {
        kind: 'handled',
        reply: formatWhatsappOutbound('Dale. Escribime cuando quieras operar.'),
        intent: 'v4_onboarding_exit',
        statePatch: patch,
      };
    }

    if (picked.id === 'more' && awaiting.screen !== 'section') {
      const menu = buildHelpMenuPage(ctx, 1);
      return {
        kind: 'handled',
        reply: formatWhatsappOutbound(formatMoreMenuMessage(menu)),
        intent: 'v4_onboarding_more',
        statePatch: onboardingPayload({
          type: 'v4_onboarding',
          screen: 'more',
          options: menu.options,
          page: 1,
        }),
      };
    }

    if (picked.id === 'back') {
      const menu = buildHelpMenuPage(ctx, 0);
      return {
        kind: 'handled',
        reply: formatWhatsappOutbound(formatHelpMenuMessage(ctx, menu)),
        intent: 'v4_onboarding_menu',
        statePatch: onboardingPayload({
          type: 'v4_onboarding',
          screen: 'main',
          options: menu.options,
          page: 0,
        }),
      };
    }

    if (awaiting.screen === 'section') {
      if (picked.index === 0) {
        const patch = await finishOnboarding(tenant, ctx, 'skipped');
        return {
          kind: 'handled',
          reply: formatWhatsappOutbound('Dale. Escribime cuando quieras operar.'),
          intent: 'v4_onboarding_exit',
          statePatch: patch,
        };
      }
      if (picked.index === 2 || picked.id === 'more') {
        const menu = buildHelpMenuPage(ctx, 0);
        return {
          kind: 'handled',
          reply: formatWhatsappOutbound(formatHelpMenuMessage(ctx, menu)),
          intent: 'v4_onboarding_menu',
          statePatch: onboardingPayload({
            type: 'v4_onboarding',
            screen: 'main',
            options: menu.options,
            page: 0,
          }),
        };
      }
      if (picked.index === 1 && awaiting.sectionId) {
        const copy = resolveSectionCopy(awaiting.sectionId, ctx.profile);
        const patch = await finishOnboarding(tenant, ctx, 'completed');
        return {
          kind: 'handled',
          reply: formatWhatsappOutbound(formatTryNowPrompt(copy)),
          intent: 'v4_onboarding_try',
          statePatch: patch,
        };
      }
    }

    if (awaiting.screen === 'upgrade' || awaiting.screen === 'new_feature') {
      return openSection(ctx, picked.id as BotHelpSectionId, onboarding, tenant.businessId);
    }

    return openSection(ctx, picked.id as BotHelpSectionId, onboarding, tenant.businessId);
  }

  if (!onboardingFinished(onboarding)) {
    const turns = state?.turns ?? [];
    const isFirstTurn = turns.length === 0;
    if (isFirstTurn && shouldBypassWelcomeOnFirstMessage(trimmed)) {
      await recordOnboardingSkipped(tenant.businessId, ctx.productId, listEnabledHelpSections(ctx));
      return { kind: 'skip' };
    }
    if (isFirstTurn || onboarding.status === 'not_started') {
      return beginWelcomeOrSetup(tenant, ctx, 'welcome');
    }
  } else {
    const delta = detectOnboardingDelta(
      onboarding,
      ctx.productId,
      listEnabledHelpSections(ctx)
    );
    if (delta) {
      const turns = state?.turns ?? [];
      if (turns.length === 0) {
        return beginDeltaMenu(tenant, ctx, delta);
      }
    }
  }

  return { kind: 'skip' };
}

export function firstSuccessTipForSection(sectionId?: BotHelpSectionId | null): string | null {
  if (sectionId === 'cash_expense' || sectionId === 'cash') {
    return '💡 También podés preguntarme cuánto gastaste hoy o este mes.';
  }
  if (sectionId === 'cash_balance' || sectionId === 'cash_movements') {
    return '💡 Podés pedirme movimientos por fecha cuando lo necesites.';
  }
  return null;
}

export type WhatsAppOnboardingPublicStatus = {
  status: WhatsAppOnboardingState['status'];
  firstSuccessfulActionAt?: string | null;
  viewedSections?: BotHelpSectionId[];
};

export async function getWhatsAppOnboardingPublicStatus(
  businessId: string
): Promise<WhatsAppOnboardingPublicStatus> {
  const state = await loadWhatsAppOnboardingState(businessId);
  return {
    status: state.status,
    firstSuccessfulActionAt: state.firstSuccessfulActionAt ?? null,
    viewedSections: state.viewedSections ?? [],
  };
}
