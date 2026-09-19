import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertResolutionDoesNotFlipUnavailable,
  classifyCapabilitySpeech,
  formatCapabilityResolutionReply,
  resolveCapabilityFromUtterance,
} from './capability-resolution.ts';
import {
  buildCapabilitySnapshotFromRegistry,
  buildFullOperationalCapabilitySnapshot,
} from './bot-capability-service.ts';
import { buildToolRegistry } from './agent/tool-registry.ts';
import { filterLandingUseCases } from '../../shared/bot-capability-catalog.ts';
import { buildFullOperationalToolRegistry } from './agent/tool-registry.ts';
import { resolveBusinessProfile } from '../../shared/business-profile.ts';
import { emptyModulesMap } from '../../shared/subscription-modules.ts';
import {
  utteranceIsCapabilityQuestion,
  utteranceIsHowTo,
} from './conversation-speech.ts';

describe('capability speech triad', () => {
  it('separa how_to / capability / execute', () => {
    assert.equal(classifyCapabilitySpeech('¿Cómo registro una venta?'), 'how_to');
    assert.equal(utteranceIsHowTo('¿Cómo registro una venta?'), true);
    assert.equal(classifyCapabilitySpeech('¿Podés registrar una venta?'), 'capability_question');
    assert.equal(utteranceIsCapabilityQuestion('¿Podés registrar una venta?'), true);
    assert.equal(classifyCapabilitySpeech('Registrá una venta a María por $800'), 'execute');
    assert.equal(utteranceIsHowTo('Registrá una venta a María por $800'), false);
    assert.equal(utteranceIsCapabilityQuestion('Registrá una venta a María por $800'), false);
  });
});

describe('capability resolution (backend decides status)', () => {
  const full = buildFullOperationalCapabilitySnapshot();

  it('¿Podés registrar una venta? → available', () => {
    const res = resolveCapabilityFromUtterance('¿Podés registrar una venta?', full);
    assert.equal(res.status, 'available');
    assert.equal(res.capability, 'create_sale');
    assert.match(res.groundedReply, /^Sí/i);
  });

  it('¿Cómo registro una venta? → how_to sin afirmar ejecución', () => {
    const res = resolveCapabilityFromUtterance('¿Cómo registro una venta?', full);
    assert.equal(res.userMessageIntent, 'how_to');
    assert.equal(res.status, 'available');
    assert.match(res.groundedReply, /venta/i);
  });

  it('proveedor saldo → requires_adapter; pago proveedor → panel/unavailable', () => {
    const balance = resolveCapabilityFromUtterance(
      '¿Podés ver cuánto le debo a un proveedor?',
      full
    );
    assert.equal(balance.capability, 'query_supplier_balance');
    assert.equal(balance.status, 'requires_adapter');
    assert.match(balance.groundedReply, /Todavía no|RILO Gestión/i);
    assert.doesNotMatch(balance.groundedReply, /^Sí/i);

    const pay = resolveCapabilityFromUtterance('¿Podés pagarle a un proveedor?', full);
    assert.equal(pay.capability, 'register_supplier_payment');
    assert.ok(pay.status === 'panel_only' || pay.status === 'unavailable');
    assert.doesNotMatch(pay.groundedReply, /^Sí/i);
  });

  it('borrar ítem de pedido → unavailable/panel_only', () => {
    const res = resolveCapabilityFromUtterance(
      '¿Podés borrar un ítem de un pedido?',
      full
    );
    assert.equal(res.capability, 'remove_order_item');
    assert.ok(res.status === 'unavailable' || res.status === 'panel_only');
    assert.match(res.groundedReply, /Todavía no|RILO Gestión/i);
  });

  it('foto → available si ingest está operacional', () => {
    const res = resolveCapabilityFromUtterance('¿Puedo mandarte una foto?', full);
    assert.equal(res.capability, 'ingest_visual_document');
    assert.equal(res.status, 'available');
    assert.match(res.groundedReply, /foto/i);
  });

  it('qué podés / qué no podés', () => {
    const overview = resolveCapabilityFromUtterance('¿Qué podés hacer?', full);
    assert.equal(overview.userMessageIntent, 'capability_overview');
    assert.match(overview.groundedReply, /Ventas|Pedidos|Caja/i);
    assert.doesNotMatch(overview.groundedReply, /create_sale|get_supplier/);

    const limits = resolveCapabilityFromUtterance('¿Qué no podés hacer?', full);
    assert.equal(limits.userMessageIntent, 'capability_limits');
    assert.match(limits.groundedReply, /RILO Gestión|WhatsApp/i);
  });

  it('unknown capability is safe', () => {
    const res = resolveCapabilityFromUtterance('¿Podés hacer teleportación cuántica?', full);
    assert.equal(res.status, 'unknown');
    assert.match(res.groundedReply, /no la tengo identificada/i);
    assert.doesNotMatch(res.groundedReply, /^Sí/i);
    assert.doesNotThrow(() => assertResolutionDoesNotFlipUnavailable(res));
  });

  it('módulo deshabilitado / registry vacío no vuelve available', () => {
    const empty = buildCapabilitySnapshotFromRegistry([]);
    const res = resolveCapabilityFromUtterance('¿Podés registrar una venta?', empty);
    assert.notEqual(res.status, 'available');
    assert.doesNotMatch(formatCapabilityResolutionReply(res), /^Sí/i);

    const noCollab = buildCapabilitySnapshotFromRegistry(
      buildToolRegistry({ collaboratorsEnabled: false }),
      {
        productId: 'whatsapp',
        profile: resolveBusinessProfile(null),
        entitlements: emptyModulesMap(true),
        permission: true,
      }
    );
    assert.ok(!noCollab.available.some((c) => c.toolName === 'list_collaborators'));
  });

  it('LLM no puede transformar unavailable en available (groundedReply gate)', () => {
    const res = resolveCapabilityFromUtterance(
      '¿Podés ver cuánto le debo a un proveedor?',
      full
    );
    const flipped = { ...res, groundedReply: 'Sí, puedo consultar la deuda del proveedor.' };
    assert.throws(() => assertResolutionDoesNotFlipUnavailable(flipped));
  });

  it('landing say-it solo tools operativas', () => {
    const names = new Set(buildFullOperationalToolRegistry().map((t) => t.name));
    const cases = filterLandingUseCases(names);
    assert.ok(cases.every((c) => c.id !== 'supplier_balance'));
    for (const row of cases) {
      const tools = (
        {
          sale: ['create_sale'],
          order: ['create_order'],
          collect: ['register_order_payment', 'collect_order_full_balance'],
          client_balance: ['get_client_balance'],
          cash_today: ['get_cash_income_summary', 'get_cash_balance', 'list_cash_movements'],
          stock: ['get_stock'],
        } as Record<string, string[]>
      )[row.id];
      assert.ok(tools?.some((t) => names.has(t)), row.id);
    }
  });
});
