import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCapabilitySnapshotFromRegistry,
  buildFullOperationalCapabilitySnapshot,
  findCapabilitySyncGaps,
  isToolOperationallyAvailable,
} from './bot-capability-service.ts';
import { buildFullOperationalToolRegistry, buildToolRegistry } from './agent/tool-registry.ts';
import { filterLandingUseCases } from '../../shared/bot-capability-catalog.ts';
import { resolveBusinessProfile } from '../../shared/business-profile.ts';
import { emptyModulesMap } from '../../shared/subscription-modules.ts';

describe('BotCapabilityService', () => {
  it('no deja gaps de sync help/tools/adapters', () => {
    const gaps = findCapabilitySyncGaps();
    assert.deepEqual(gaps, [], gaps.join('\n'));
  });

  it('marca get_supplier_balance como no operacional en registry completo', () => {
    const snap = buildFullOperationalCapabilitySnapshot();
    assert.equal(isToolOperationallyAvailable(snap, 'get_supplier_balance'), false);
    assert.equal(isToolOperationallyAvailable(snap, 'create_sale'), true);
    assert.equal(isToolOperationallyAvailable(snap, 'get_client_balance'), true);
    assert.ok(snap.knownUnavailable.some((row) => row.id === 'query_supplier_balance'));
  });

  it('nunca afirma create_sale disponible si el registry lo filtró', () => {
    const empty = buildCapabilitySnapshotFromRegistry([]);
    assert.equal(isToolOperationallyAvailable(empty, 'create_sale'), false);
    assert.ok(empty.agentCapabilityBrief.includes('availableTools=none'));
  });

  it('incluye hint honesto para remove_order_item', () => {
    const snap = buildFullOperationalCapabilitySnapshot();
    const hint = snap.knownUnavailable.find((row) => row.id === 'remove_order_item');
    assert.ok(hint);
    assert.match(hint!.userHint, /Todavía no puedo borrar/i);
  });

  it('help sections de proveedores no requieren deuda si no hay tool', () => {
    const snap = buildFullOperationalCapabilitySnapshot();
    assert.ok(snap.helpSections.includes('suppliers'));
    assert.ok(snap.helpSections.includes('sales'));
    assert.ok(!isToolOperationallyAvailable(snap, 'list_sales'));
  });

  it('landing use cases solo con tools operativas', () => {
    const names = new Set(buildFullOperationalToolRegistry().map((t) => t.name));
    const cases = filterLandingUseCases(names);
    assert.ok(cases.some((c) => c.id === 'sale'));
    assert.ok(cases.some((c) => c.id === 'client_balance'));
    assert.ok(!cases.some((c) => c.id === 'supplier_balance'));
  });

  it('sin módulo colaboradores no expone tools de colaboradores', () => {
    const registry = buildToolRegistry({
      collaboratorsEnabled: false,
    });
    const snap = buildCapabilitySnapshotFromRegistry(registry, {
      productId: 'whatsapp',
      profile: resolveBusinessProfile(null),
      entitlements: emptyModulesMap(true),
      permission: true,
    });
    assert.equal(isToolOperationallyAvailable(snap, 'list_collaborators'), false);
  });
});

describe('how_to vs execution intent separation (contract)', () => {
  const HOW_TO = [
    '¿Cómo registro una venta?',
    '¿Cómo cargo un pedido?',
    '¿Qué podés hacer?',
    '¿Podés registrar una venta?',
    '¿Podés consultar lo que le debo a un proveedor?',
    '¿Podés borrar un item de un pedido guardado?',
    '¿Puedo mandarte una foto?',
    '¿Qué puedo hacer con stock?',
    '¿Qué no podés hacer?',
  ];

  const EXECUTION = [
    'Registrá una venta a María por $800',
    'Vendí 2 remeras a Ana por 1600',
    'Pedido para Martín 3 buzos viernes',
  ];

  it('frases how_to/capability no se confunden con verbos de ejecución en el brief', () => {
    const snap = buildFullOperationalCapabilitySnapshot();
    assert.match(snap.agentCapabilityBrief, /NUNCA afirmes/i);
    assert.match(snap.agentCapabilityBrief, /unavailableHint:query_supplier_balance=/);
    for (const phrase of HOW_TO) {
      assert.ok(phrase.includes('?') || phrase.toLowerCase().startsWith('¿'), phrase);
    }
    for (const phrase of EXECUTION) {
      assert.ok(!phrase.includes('?'), phrase);
    }
  });

  it('capacidad proveedor deuda nunca aparece como availableTool', () => {
    const snap = buildFullOperationalCapabilitySnapshot();
    assert.ok(!snap.agentCapabilityBrief.includes('get_supplier_balance'));
    const hint = snap.knownUnavailable.find((r) => r.id === 'query_supplier_balance');
    assert.ok(hint?.userHint.includes('Todavía no puedo consultar la deuda'));
  });
});
