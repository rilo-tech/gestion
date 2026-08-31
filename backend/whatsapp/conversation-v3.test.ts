import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTurnInterpretation } from './turn-interpretation.ts';
import {
  assertQueryResultScope,
  buildQueryPlanDraft,
  explicitOverFocus,
  toQueryServiceInput,
  writeTargetFromTurn,
} from './conversation-query-plan.ts';
import { planV3Query } from './conversation-orchestrator-v3.ts';
import { isV3Engine } from './engine-version.ts';
import type { ClientResolution } from './conversation-v3-resolver.ts';

function interp(raw: Record<string, unknown>) {
  return normalizeTurnInterpretation(raw, 'consulta');
}

const focusA = {
  focusOrder: { id: 'ord-a', label: '00111', clientName: 'Cliente A' },
  lastQuery: {
    intent: 'query_status',
    slots: { clientName: 'Cliente A', metric: 'list', entity: 'orders' },
  },
};

async function resolveMap(map: Record<string, ClientResolution>) {
  return async (_businessId: string, hint: string): Promise<ClientResolution> => {
    return map[hint] ?? { status: 'NOT_FOUND', hint };
  };
}

describe('RILO Bot v3 query core', () => {
  it('1 focusedClient=A, turn clientHint=B → query B', async () => {
    const interpretation = interp({
      intent: 'query_status',
      conversationAction: 'new_task',
      client: { raw: 'Cliente B' },
      query: { entity: 'orders', metric: 'list' },
    });
    const seen: string[] = [];
    const plan = await planV3Query(interpretation, focusA, 'biz', async (_id, hint) => {
      seen.push(hint);
      return { status: 'RESOLVED', id: 'id-b', displayName: 'Cliente B' };
    });
    assert.deepEqual(seen, ['Cliente B']);
    assert.equal(plan.filters.clientId, 'id-b');
    assert.notEqual(plan.filters.clientHint, 'Cliente A');
    assert.equal(plan.invalid, undefined);
  });

  it('2 focusedClient=A, turn sin clientHint → puede heredar A', async () => {
    const interpretation = interp({
      intent: 'query_status',
      conversationAction: 'continue_current',
      query: { entity: 'orders', metric: 'list' },
      filters: { status: 'pendiente' },
    });
    const plan = await planV3Query(
      interpretation,
      focusA,
      'biz',
      await resolveMap({
        'Cliente A': { status: 'RESOLVED', id: 'id-a', displayName: 'Cliente A' },
      })
    );
    assert.equal(plan.filters.clientId, 'id-a');
    assert.equal(plan.filters.status, 'pendiente');
    assert.equal(plan.invalid, undefined);
  });

  it('3 clientHint=B resolver NOT_FOUND → no query global', async () => {
    const interpretation = interp({
      intent: 'query_status',
      conversationAction: 'new_task',
      client: { raw: 'Cliente B' },
      query: { entity: 'orders', metric: 'list' },
    });
    const plan = await planV3Query(interpretation, focusA, 'biz', async () => ({
      status: 'NOT_FOUND',
      hint: 'Cliente B',
    }));
    assert.equal(plan.invalid, 'ENTITY_NOT_FOUND');
    assert.equal(plan.filters.clientId, undefined);
    const svc = toQueryServiceInput('biz', plan);
    assert.equal(svc.filters.clientId, undefined);
  });

  it('4 clientHint=B resolver AMBIGUOUS → no query global', async () => {
    const interpretation = interp({
      intent: 'query_status',
      conversationAction: 'new_task',
      client: { raw: 'Cliente B' },
      query: { entity: 'orders', metric: 'list' },
    });
    const plan = await planV3Query(interpretation, null, 'biz', async () => ({
      status: 'AMBIGUOUS',
      candidates: [
        { id: '1', displayName: 'Cliente B1' },
        { id: '2', displayName: 'Cliente B2' },
      ],
    }));
    assert.equal(plan.invalid, 'AMBIGUOUS_ENTITY');
    assert.equal(plan.filters.clientId, undefined);
  });

  it('5 QueryPlan clientId=B → QueryService recibe B', async () => {
    const interpretation = interp({
      intent: 'query_status',
      conversationAction: 'new_task',
      client: { raw: 'Cliente B' },
      query: { entity: 'orders', metric: 'list' },
    });
    const plan = await planV3Query(interpretation, focusA, 'biz', async () => ({
      status: 'RESOLVED',
      id: 'id-b',
      displayName: 'Cliente B',
    }));
    const svc = toQueryServiceInput('biz', plan);
    assert.equal(svc.filters.clientId, 'id-b');
    assert.equal(svc.limit, 10);
    assert.equal(svc.sort.direction, 'desc');
  });

  it('6 resultado con clientId distinto → QUERY_RESULT_SCOPE_MISMATCH', () => {
    const scoped = assertQueryResultScope(
      {
        entity: 'orders',
        metric: 'list',
        filters: { clientId: 'id-b' },
        requestedFilters: { client: true },
        limit: 10,
        offset: 0,
        sort: { field: 'createdAt', direction: 'desc' },
      },
      [
        { id: 'ok', data: { clienteId: 'id-b' } },
        { id: 'leak', data: { clienteId: 'id-a' } },
      ]
    );
    assert.equal(scoped.mismatch, true);
    assert.equal(scoped.items.length, 1);
    assert.equal(scoped.items[0]?.id, 'ok');
  });

  it('7 query_orders no se convierte en query_order por stale focus', () => {
    const interpretation = interp({
      intent: 'query_status',
      conversationAction: 'new_task',
      client: { raw: 'Cliente B' },
      query: { entity: 'orders', metric: 'list' },
    });
    const draft = buildQueryPlanDraft(interpretation, {
      focusOrder: { id: 'ord-a', label: '00111', clientName: 'Cliente A' },
    });
    assert.equal(draft.entity, 'orders');
    assert.equal(draft.metric, 'list');
    assert.equal(draft.filters.orderId, undefined);
    assert.equal(draft.filters.orderNumber, undefined);
  });

  it('8 current explicit product > focusedProduct', () => {
    assert.equal(explicitOverFocus('Producto B', 'Producto A'), 'Producto B');
  });

  it('9 current explicit order > focusedOrder; si no resuelve no usa el foco', () => {
    assert.equal(explicitOverFocus('350', 'Pedido A'), '350');
    const blocked = writeTargetFromTurn({
      explicitHint: '350',
      focusedId: 'ord-a',
      resolution: 'NOT_FOUND',
    });
    assert.equal(blocked.blocked, 'ENTITY_NOT_FOUND');
    assert.equal(blocked.id, undefined);
  });

  it('10 current explicit supplier > focusedSupplier', () => {
    assert.equal(explicitOverFocus('Proveedor B', 'Proveedor A'), 'Proveedor B');
  });

  it('listado fresco sin cliente no abre query global', async () => {
    const interpretation = interp({
      intent: 'query_status',
      conversationAction: 'new_task',
      query: { entity: 'orders', metric: 'list' },
    });
    const plan = await planV3Query(interpretation, focusA, 'biz', async () => {
      throw new Error('resolver no debe correr sin hint');
    });
    assert.equal(plan.invalid, 'QUERY_PLAN_INVALID');
    assert.equal(plan.filters.clientId, undefined);
  });

  it('isV3Engine respeta tenants', () => {
    const prev = process.env.RILOBOT_V3_TENANTS;
    process.env.RILOBOT_V3_TENANTS = 'rilo';
    try {
      assert.equal(isV3Engine('rilo'), true);
      assert.equal(isV3Engine('prueba'), false);
    } finally {
      if (prev == null) delete process.env.RILOBOT_V3_TENANTS;
      else process.env.RILOBOT_V3_TENANTS = prev;
    }
  });
});
