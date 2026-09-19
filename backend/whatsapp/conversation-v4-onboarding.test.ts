import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildHelpMenuPage,
  formatWelcomeMessage,
  listEnabledHelpSections,
  resolveSectionCopy,
} from '../../shared/bot-help-catalog.ts';
import {
  defaultFeaturesForMode,
  defaultProfileForMode,
  normalizeBusinessProfile,
} from '../../shared/business-profile.ts';
import { emptyModulesMap } from '../../shared/subscription-modules.ts';
import type { BotHelpMenuContext } from '../../shared/bot-help-catalog.ts';
import {
  detectOnboardingDelta,
  normalizeWhatsAppOnboardingState,
} from './v4-onboarding-state.ts';
import {
  getV4OnboardingAwaiting,
  shouldBypassWelcomeOnFirstMessage,
  V4_ONBOARDING_INTENT,
} from './v4-onboarding.ts';
import { parseNumericSelectionTurn } from './v4-candidate-selection.ts';

function ctx(input: Partial<BotHelpMenuContext> & { productId: BotHelpMenuContext['productId'] }): BotHelpMenuContext {
  return {
    profile: input.profile ?? defaultProfileForMode('products'),
    entitlements: input.entitlements ?? emptyModulesMap(true),
    permission: true,
    ...input,
  };
}

describe('Bot help catalog — capability-aware menu', () => {
  it('RILO Caja muestra solo submenú de caja', () => {
    const menuCtx = ctx({
      productId: 'cash',
      profile: defaultProfileForMode('cash_only'),
      entitlements: { ...emptyModulesMap(false), caja: true, core: false, pedidos: false },
    });
    const sections = listEnabledHelpSections(menuCtx);
    assert.deepEqual(sections, [
      'cash_income',
      'cash_expense',
      'cash_balance',
      'cash_movements',
    ]);
    assert.equal(sections.includes('purchases' as never), false);
    assert.equal(sections.includes('orders' as never), false);
  });

  it('RILO Bot products muestra categorías habilitadas', () => {
    const profile = normalizeBusinessProfile({
      ...defaultProfileForMode('products'),
      enabledFeatures: {
        ...defaultFeaturesForMode('products'),
        cash: true,
        clients: true,
        sales: true,
        catalog: true,
        stock: true,
        orders: true,
        purchases: false,
        suppliers: false,
      },
    });
    const menuCtx = ctx({ productId: 'whatsapp', profile });
    const sections = listEnabledHelpSections(menuCtx);
    assert.ok(sections.includes('cash'));
    assert.ok(sections.includes('sales'));
    assert.ok(sections.includes('catalog_stock'));
    assert.ok(sections.includes('clients'));
    assert.equal(sections.includes('purchases'), false);
  });

  it('modo services sin stock muestra Servicios, no Productos y stock', () => {
    const profile = normalizeBusinessProfile({
      ...defaultProfileForMode('services'),
      enabledFeatures: {
        ...defaultFeaturesForMode('services'),
        orders: true,
        stock: false,
        products: false,
        catalog: false,
      },
    });
    const sections = listEnabledHelpSections(ctx({ productId: 'whatsapp', profile }));
    assert.ok(sections.includes('services'));
    assert.equal(sections.includes('catalog_stock'), false);
    assert.ok(sections.includes('orders'));
  });

  it('respeta terminology de pedidos → Trabajos', () => {
    const profile = normalizeBusinessProfile({
      ...defaultProfileForMode('services'),
      terminology: { orderPlural: 'Trabajos', orderSingular: 'Trabajo' },
    });
    const copy = resolveSectionCopy('orders', profile);
    assert.equal(copy.label, 'Trabajos');
  });

  it('incluye Alertas y recordatorios cuando automations está habilitado', () => {
    const sections = listEnabledHelpSections(
      ctx({
        productId: 'whatsapp',
        entitlements: { ...emptyModulesMap(true), automations: true },
      })
    );
    assert.ok(sections.includes('automations'));
    const copy = resolveSectionCopy('automations', defaultProfileForMode('products'));
    assert.equal(copy.label, 'Alertas y recordatorios');
  });

  it('no muestra Alertas si el módulo automations está off', () => {
    const sections = listEnabledHelpSections(
      ctx({
        productId: 'whatsapp',
        entitlements: { ...emptyModulesMap(true), automations: false },
      })
    );
    assert.equal(sections.includes('automations'), false);
  });
});

describe('V4 onboarding — first message policy', () => {
  it('bypass welcome on amount-like first message', () => {
    assert.equal(shouldBypassWelcomeOnFirstMessage('gasté 500'), true);
    assert.equal(shouldBypassWelcomeOnFirstMessage('Gasté $500'), true);
    assert.equal(shouldBypassWelcomeOnFirstMessage('hola'), false);
    assert.equal(shouldBypassWelcomeOnFirstMessage('2'), false);
  });
});

describe('V4 onboarding — numeric navigation state', () => {
  it('parsea selección numérica determinística', () => {
    assert.deepEqual(parseNumericSelectionTurn('2'), { index: 2 });
    assert.deepEqual(parseNumericSelectionTurn('¿cuánto tengo?'), {});
  });

  it('detecta awaiting onboarding en conversation state', () => {
    const awaiting = getV4OnboardingAwaiting({
      businessId: 'b1',
      phone: '+1',
      pendingIntent: V4_ONBOARDING_INTENT,
      pendingPayload: {
        v4Onboarding: {
          type: 'v4_onboarding',
          screen: 'main',
          options: [
            { index: 0, id: 'start', label: 'Empezar' },
            { index: 1, id: 'cash', label: '💰 Caja' },
          ],
        },
      },
      updatedAt: new Date().toISOString(),
    });
    assert.ok(awaiting);
    assert.equal(awaiting?.screen, 'main');
  });
});

describe('V4 onboarding — upgrade delta', () => {
  it('Caja → Bot muestra solo secciones nuevas', () => {
    const stored = normalizeWhatsAppOnboardingState({
      status: 'completed',
      lastKnownProductId: 'cash',
      knownSectionIds: ['cash_income', 'cash_expense', 'cash_balance', 'cash_movements'],
    });
    const delta = detectOnboardingDelta(stored, 'whatsapp', [
      'cash',
      'sales',
      'clients',
      'catalog_stock',
    ]);
    assert.ok(delta);
    assert.equal(delta?.kind, 'upgrade');
    if (delta?.kind === 'upgrade') {
      assert.ok(delta.sectionIds.includes('sales'));
      assert.ok(delta.sectionIds.includes('clients'));
      assert.equal(delta.sectionIds.includes('cash_income' as never), false);
    }
  });
});

describe('V4 onboarding — welcome copy', () => {
  it('RILO Caja usa intro corta', () => {
    const menuCtx = ctx({
      productId: 'cash',
      profile: defaultProfileForMode('cash_only'),
    });
    const menu = buildHelpMenuPage(menuCtx, 0);
    const text = formatWelcomeMessage(menuCtx, menu);
    assert.match(text, /RILO Caja/);
    assert.match(text, /¿Qué querés ver\?/);
    assert.match(text, /Registrar un ingreso/);
  });
});
