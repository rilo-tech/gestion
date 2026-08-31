import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_LIST_LIMIT,
  presentListFooter,
  resolveListPolicy,
  resolveQueryDateRange,
  wantsEntityList,
} from './query-policy.ts';
import { presentCountQuery, presentEntityList, presentOrderListItem } from './conversation-query.ts';
import { normalizeTurnInterpretation, turnInterpretationToParsed } from './turn-interpretation.ts';
import { resolveSemanticTurn, semanticCommandToLegacyEntities } from './semantic-command.ts';
import { nextListPage } from './query-follow.ts';
import { personNamesLookRelated } from './lookups.ts';

function fromJson(raw: Record<string, unknown>, message: string) {
  const interpretation = normalizeTurnInterpretation(raw, message);
  const resolved = resolveSemanticTurn(interpretation, {
    lastQuery: {
      intent: 'query_status',
      slots: { clientName: 'Acapella', metric: 'list', entity: 'orders', offset: 0 },
    },
  });
  const entities = semanticCommandToLegacyEntities(resolved.command);
  const policy = resolveListPolicy({
    metric: resolved.command.operations[0]?.query?.metric,
    limit: resolved.command.operations[0]?.query?.limit,
    requestAll: resolved.command.operations[0]?.query?.requestAll,
    page: resolved.command.operations[0]?.query?.page,
    offset: 0,
    sortDirection: resolved.command.operations[0]?.query?.sortDirection,
  });
  return { interpretation, resolved, entities, policy };
}

describe('Query policy: listados ERP', () => {
  it('A listado de cliente: default limit 10, sort desc, no asume estado', () => {
    const { resolved, entities, policy } = fromJson(
      {
        intent: 'query_orders',
        conversationAction: 'new_task',
        client: { raw: 'Acapella' },
        query: { entity: 'orders', metric: 'list' },
      },
      'mostrame los pedidos de Acapella'
    );
    assert.equal(resolved.command.operations[0]?.intent, 'query_status');
    assert.equal(resolved.command.operations[0]?.client?.raw, 'Acapella');
    assert.equal(resolved.command.operations[0]?.filters?.listOrders, true);
    assert.equal(entities.listOrders, true);
    assert.equal(entities.queryStatusFilter, undefined);
    assert.equal(policy.limit, DEFAULT_LIST_LIMIT);
    assert.equal(policy.sortDirection, 'desc');
    assert.equal(policy.mode, 'list');
    assert.equal(wantsEntityList({ listOrders: true, entity: 'orders', metric: 'list' }), true);
  });

  it('B cantidad explícita', () => {
    const { policy } = fromJson(
      {
        intent: 'query_status',
        conversationAction: 'new_task',
        client: { raw: 'Acapella' },
        query: { entity: 'orders', metric: 'list', limit: 3 },
      },
      'últimos 3 pedidos de Acapella'
    );
    assert.equal(policy.limit, 3);
  });

  it('C filtro de estado estructurado, default 10', () => {
    const { resolved, policy } = fromJson(
      {
        intent: 'query_status',
        conversationAction: 'new_task',
        client: { raw: 'Acapella' },
        query: { entity: 'orders', metric: 'list' },
        filters: { status: 'pendiente' },
      },
      'pedidos pendientes de Acapella'
    );
    assert.equal(resolved.command.operations[0]?.filters?.status, 'pendiente');
    assert.equal(policy.limit, 10);
  });

  it('D dateToken agosto → rango, default 10', () => {
    const { resolved, policy } = fromJson(
      {
        intent: 'query_status',
        conversationAction: 'new_task',
        client: { raw: 'Acapella' },
        query: { entity: 'orders', metric: 'list' },
        filters: { dateToken: 'agosto' },
      },
      'pedidos de Acapella de agosto'
    );
    const range = resolveQueryDateRange('agosto', '2026-08-30');
    assert.equal(resolved.command.operations[0]?.filters?.dateFrom, range?.from);
    assert.equal(resolved.command.operations[0]?.filters?.dateTo, range?.to);
    assert.equal(policy.limit, 10);
  });

  it('E requestAll: pagina, no trunca en silencio', () => {
    const { policy } = fromJson(
      {
        intent: 'query_status',
        conversationAction: 'new_task',
        client: { raw: 'Acapella' },
        query: { entity: 'orders', metric: 'list', requestAll: true },
      },
      'todos los pedidos de Acapella'
    );
    assert.equal(policy.requestAll, true);
    assert.equal(policy.limit, DEFAULT_LIST_LIMIT);
    const footer = presentListFooter({ shown: 10, total: 84, hasMore: true, requestAll: true });
    assert.match(String(footer), /10 de 84/);
  });

  it('F count: no es listado', () => {
    const { policy, resolved } = fromJson(
      {
        intent: 'query_status',
        conversationAction: 'new_task',
        client: { raw: 'Acapella' },
        query: { entity: 'orders', metric: 'count' },
      },
      'cuántos pedidos tiene Acapella?'
    );
    assert.equal(policy.mode, 'count');
    assert.equal(resolved.command.operations[0]?.query?.metric, 'count');
    assert.match(presentCountQuery({ subject: 'Acapella', total: 84 }), /84 pedidos/);
  });

  it('G último: limit 1', () => {
    const { policy } = fromJson(
      {
        intent: 'query_status',
        conversationAction: 'new_task',
        client: { raw: 'Acapella' },
        query: { entity: 'orders', metric: 'list', limit: 1 },
      },
      'cuál fue el último pedido de Acapella?'
    );
    assert.equal(policy.mode, 'single');
    assert.equal(policy.limit, 1);
  });

  it('H page=next reusa cliente del lastQuery', () => {
    const { resolved, policy } = fromJson(
      {
        intent: 'query_status',
        conversationAction: 'continue_current',
        query: { entity: 'orders', metric: 'list', page: 'next' },
      },
      'mostrame más'
    );
    assert.equal(resolved.command.operations[0]?.client?.raw, 'Acapella');
    assert.equal(resolved.command.operations[0]?.query?.page, 'next');
    const next = nextListPage({
      type: 'orders',
      items: [],
      currentPage: 1,
      pageSize: 10,
      totalResults: 84,
    });
    assert.equal(next.currentPage, 2);
    assert.equal(policy.offset, 10);
  });

  it('unknown + query.entity orders se salva a query_status', () => {
    const { resolved } = fromJson(
      {
        intent: 'unknown',
        conversationAction: 'new_task',
        client: { raw: 'María' },
        query: { entity: 'orders', metric: 'list' },
      },
      'qué órdenes tiene María?'
    );
    assert.equal(resolved.command.operations[0]?.intent, 'query_status');
    assert.equal(resolved.command.operations[0]?.filters?.listOrders, true);
  });

  it('presenter compacto de listado', () => {
    const line = presentOrderListItem({
      label: '245',
      date: '29/08',
      statusLabel: 'Pendiente',
      total: 1250,
    });
    assert.equal(line, '• #245 · 29/08 · Pendiente · $1.250');
    const body = presentEntityList({
      title: 'Últimos pedidos de Acapella',
      lines: [line],
      shown: 1,
      total: 84,
      hasMore: true,
      emptyText: 'No encontré pedidos de Acapella.',
      footer: presentListFooter({ shown: 10, total: 84, hasMore: true }),
    });
    assert.match(body, /\*Últimos pedidos de Acapella\*/);
    assert.doesNotMatch(body, /pedido nuevo/);
  });
});

describe('Prioridad: turno explícito > foco', () => {
  it('A/B listado con cliente B no usa pedido ni cliente A del foco', () => {
    const interpretation = normalizeTurnInterpretation(
      {
        intent: 'query_orders',
        conversationAction: 'new_task',
        client: { raw: 'Cliente B' },
        query: { entity: 'orders', metric: 'list' },
      },
      'consulta'
    );
    const parsed = turnInterpretationToParsed(interpretation, {
      focusOrder: {
        id: 'ord-aaa',
        label: '00111',
        clientName: 'Cliente A',
        status: 'entregado',
      },
    });
    assert.equal(parsed.intent, 'query_status');
    assert.equal('entities' in parsed && parsed.entities?.clientName, 'Cliente B');
    assert.equal('entities' in parsed && parsed.entities?.listOrders, true);
    assert.equal('entities' in parsed && parsed.entities?.targetOrderId, undefined);
  });

  it('D resolver no trata nombres no relacionados como el mismo cliente', () => {
    assert.equal(personNamesLookRelated('Norte Sur', 'Este Oeste'), false);
    assert.equal(personNamesLookRelated('Alpha Textil', 'Beta Confecciones'), false);
  });

  it('C query list no degrada a detalle aunque haya targetOrderId de foco', () => {
    assert.equal(
      wantsEntityList({
        listOrders: true,
        entity: 'orders',
        metric: 'list',
        targetOrderId: 'ord-aaa',
      }),
      true
    );
  });

  it('E QueryPlan conserva el cliente resuelto del JSON', () => {
    const { resolved, entities } = fromJson(
      {
        intent: 'query_status',
        conversationAction: 'new_task',
        client: { raw: 'Cliente B' },
        query: { entity: 'orders', metric: 'list' },
      },
      'consulta'
    );
    assert.equal(resolved.command.operations[0]?.client?.raw, 'Cliente B');
    assert.equal(entities.clientName, 'Cliente B');
    assert.equal(entities.listOrders, true);
  });

  it('H follow-up sin cliente hereda lastQuery', () => {
    const interpretation = normalizeTurnInterpretation(
      {
        intent: 'query_status',
        conversationAction: 'continue_current',
        query: { entity: 'orders', metric: 'list' },
        filters: { status: 'pendiente' },
      },
      'solo los pendientes'
    );
    const resolved = resolveSemanticTurn(interpretation, {
      lastQuery: {
        intent: 'query_status',
        slots: { clientName: 'Cliente A', metric: 'list', entity: 'orders' },
      },
    });
    assert.equal(resolved.command.operations[0]?.client?.raw, 'Cliente A');
    assert.equal(resolved.command.operations[0]?.filters?.status, 'pendiente');
  });

  it('I cliente explícito nuevo reemplaza lastQuery', () => {
    const interpretation = normalizeTurnInterpretation(
      {
        intent: 'query_orders',
        conversationAction: 'continue_current',
        client: { raw: 'Norte Sur' },
        query: { entity: 'orders', metric: 'list' },
      },
      'consulta'
    );
    const resolved = resolveSemanticTurn(interpretation, {
      lastQuery: {
        intent: 'query_status',
        slots: { clientName: 'Este Oeste', metric: 'list', entity: 'orders' },
      },
      focusOrder: { id: 'ord-aaa', label: '00111', clientName: 'Este Oeste' },
    });
    assert.equal(resolved.command.conversationAction, 'new_task');
    assert.equal(resolved.command.operations[0]?.client?.raw, 'Norte Sur');
    assert.notEqual(resolved.command.operations[0]?.client?.raw, 'Este Oeste');
  });

  it('listado fresco sin cliente no hereda lastQuery ni foco', () => {
    const interpretation = normalizeTurnInterpretation(
      {
        intent: 'query_orders',
        conversationAction: 'continue_current',
        query: { entity: 'orders', metric: 'list' },
      },
      'consulta'
    );
    const resolved = resolveSemanticTurn(interpretation, {
      lastQuery: {
        intent: 'query_status',
        slots: { clientName: 'Cliente A', metric: 'list', entity: 'orders' },
      },
      focusOrder: { id: 'ord-aaa', label: '00111', clientName: 'Cliente A' },
    });
    const parsed = turnInterpretationToParsed(resolved.llm, {
      focusOrder: { id: 'ord-aaa', label: '00111', clientName: 'Cliente A' },
    });
    assert.notEqual(resolved.command.operations[0]?.client?.raw, 'Cliente A');
    assert.notEqual('entities' in parsed && parsed.entities?.clientName, 'Cliente A');
  });

  it('nested query.filters.clientHint llega al cliente', () => {
    const interpretation = normalizeTurnInterpretation(
      {
        intent: 'query_orders',
        conversationAction: 'new_task',
        query: { entity: 'orders', metric: 'list', filters: { clientHint: 'Cliente B' } },
      },
      'consulta'
    );
    assert.equal(interpretation.client?.raw, 'Cliente B');
    const parsed = turnInterpretationToParsed(interpretation, {
      focusOrder: { id: 'ord-aaa', label: '00111', clientName: 'Cliente A' },
    });
    assert.equal('entities' in parsed && parsed.entities?.clientName, 'Cliente B');
    assert.equal('entities' in parsed && parsed.entities?.targetOrderId, undefined);
  });
});
