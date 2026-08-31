import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildToolRegistry, getToolByName, isWriteTool, listRegistryToolNames } from './agent/tool-registry.ts';
import { executeReadToolCall } from './agent/tool-executor.ts';
import { buildAgentOperationPlan, parseAgentOperationPlan } from './agent/tools/write-tools.ts';
import { READ_TOOL_HANDLERS } from './agent/tools/read-tools.ts';
import { isV4Engine } from './engine-version.ts';
import type { ToolExecutionContext } from './agent/tool-types.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';

const tenant: WhatsappTenantContext = {
  businessId: 'biz-test',
  phone: '+59899123456',
  platformAccess: {
    whatsappEnabled: true,
    aiEnabled: true,
    erpWebEnabled: true,
    whatsappOperationalStatus: 'active',
  } as WhatsappTenantContext['platformAccess'],
};

const ctx: ToolExecutionContext = {
  tenant,
  state: {
    businessId: 'biz-test',
    phone: '+59899123456',
    updatedAt: new Date().toISOString(),
    focusEntities: {
      client: { id: 'client-a', name: 'Cliente A', locked: true },
    },
    lastQuery: {
      intent: 'query_orders',
      slots: { clientName: 'Cliente A', entity: 'orders', metric: 'list' },
    },
  },
  rawUserMessage: 'mostrame los pedidos de Cliente B',
};

describe('RILO Bot v4 tool registry', () => {
  it('includes core read tools wired', () => {
    const names = listRegistryToolNames();
    assert.ok(names.includes('find_client'));
    assert.ok(names.includes('list_orders'));
    assert.ok(names.includes('get_cash_balance'));
    assert.ok(isWriteTool('register_cash_movement'));
    assert.equal(getToolByName('find_client')?.mode, 'read');
  });

  it('excludes requires_domain_adapter reads by default', () => {
    const names = listRegistryToolNames();
    assert.ok(!names.includes('aggregate_sales'));
    assert.ok(buildToolRegistry({ includeRequiresAdapter: true }).some((row) => row.name === 'aggregate_sales'));
  });
});

describe('RILO Bot v4 filter preservation', () => {
  it('list_orders with unresolved clientQuery blocks open query', async () => {
    const original = READ_TOOL_HANDLERS.list_orders;
    READ_TOOL_HANDLERS.list_orders = async () => ({
      status: 'filter_blocked',
      errorCode: 'ENTITY_NOT_FOUND',
      message: 'No encontré un cliente llamado Cliente B.',
      filter: { clientQuery: 'Cliente B' },
    });
    try {
      const result = await executeReadToolCall(
        { id: '1', name: 'list_orders', arguments: { clientQuery: 'Cliente B' } },
        ctx,
        buildToolRegistry()
      );
      assert.equal(result.ok, true);
      assert.equal(result.output.status, 'filter_blocked');
      assert.match(String(result.output.message), /Cliente B/);
    } finally {
      READ_TOOL_HANDLERS.list_orders = original;
    }
  });

  it('explicit clientQuery ignores stale focus client', async () => {
    let seenClientQuery = '';
    const originalFind = READ_TOOL_HANDLERS.find_client;
    const originalList = READ_TOOL_HANDLERS.list_orders;
    READ_TOOL_HANDLERS.find_client = async (_args, callCtx) => {
      seenClientQuery = String(_args.query ?? '');
      assert.notEqual(seenClientQuery, 'Cliente A');
      return { status: 'resolved', entity: { id: 'client-b', name: 'Cliente B' } };
    };
    READ_TOOL_HANDLERS.list_orders = async (args) => ({
      items: [{ id: 'ord-1', number: '00010', clientId: args.clientId, clientName: 'Cliente B', status: 'pendiente', total: 100, balance: 50 }],
      total: 1,
      hasMore: false,
      filter: { clientId: 'client-b', clientName: 'Cliente B' },
    });
    try {
      const find = await executeReadToolCall(
        { id: '1', name: 'find_client', arguments: { query: 'Cliente B' } },
        ctx,
        buildToolRegistry()
      );
      assert.equal(find.output.entity?.id, 'client-b');
      const list = await executeReadToolCall(
        { id: '2', name: 'list_orders', arguments: { clientId: 'client-b', clientQuery: 'Cliente B' } },
        ctx,
        buildToolRegistry()
      );
      assert.equal(list.output.filter?.clientId, 'client-b');
      assert.equal(seenClientQuery, 'Cliente B');
    } finally {
      READ_TOOL_HANDLERS.find_client = originalFind;
      READ_TOOL_HANDLERS.list_orders = originalList;
    }
  });
});

describe('RILO Bot v4 writes confirmation', () => {
  it('stages register_cash_movement as frozen plan', async () => {
    const plan = buildAgentOperationPlan(
      [
        {
          tool: 'register_cash_movement',
          label: 'Egreso $450 · UTE',
          args: { type: 'egreso', amount: 450, concept: 'UTE' },
        },
      ],
      'anotá 450 de UTE',
      'wa:msg1:register_cash_movement'
    );
    assert.equal(plan.version, 'v4');
    assert.equal(plan.writes.length, 1);
    assert.match(plan.summary.lines.join('\n'), /450/);
    const parsed = parseAgentOperationPlan(plan);
    assert.ok(parsed);
  });

  it('buildAgentOperationPlan keeps idempotency key', () => {
    const plan = buildAgentOperationPlan(
      [{ tool: 'create_client', label: 'Crear cliente X', args: { name: 'X' } }],
      'creame cliente X',
      'wa:msg1:create_client'
    );
    assert.equal(plan.idempotencyKey, 'wa:msg1:create_client');
  });
});

describe('RILO Bot v4 engine flags', () => {
  it('v4 tenant flag scopes engine', () => {
    const prevEngine = process.env.RILOBOT_CONVERSATION_ENGINE;
    const prevV4 = process.env.RILOBOT_V4_TENANTS;
    process.env.RILOBOT_CONVERSATION_ENGINE = 'llm_first';
    process.env.RILOBOT_V4_TENANTS = 'rilo';
    assert.equal(isV4Engine('rilo'), true);
    assert.equal(isV4Engine('other'), false);
    process.env.RILOBOT_CONVERSATION_ENGINE = 'v4';
    assert.equal(isV4Engine('other'), true);
    process.env.RILOBOT_CONVERSATION_ENGINE = prevEngine;
    process.env.RILOBOT_V4_TENANTS = prevV4;
  });
});
