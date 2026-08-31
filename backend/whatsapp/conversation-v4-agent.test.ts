import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MockConversationAgent } from './agent/conversation-agent.ts';
import { presentOrderListFromToolOutput } from './agent/agent-presenter.ts';
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

describe('RILO Bot v4 mock agent', () => {
  it('Acapella acceptance path uses find_client B then list_orders filtered', async () => {
    const agent = new MockConversationAgent([
      () => [
        { id: '1', name: 'find_client', arguments: { query: 'Acapella' } },
        { id: '2', name: 'list_orders', arguments: { clientQuery: 'Acapella', clientId: 'capella-id', limit: 10, sort: 'recent_desc' } },
      ],
    ]);

    const originalFind = (await import('./agent/tools/read-tools.ts')).READ_TOOL_HANDLERS.find_client;
    const originalList = (await import('./agent/tools/read-tools.ts')).READ_TOOL_HANDLERS.list_orders;
    const { READ_TOOL_HANDLERS } = await import('./agent/tools/read-tools.ts');
    READ_TOOL_HANDLERS.find_client = async () => ({
      status: 'resolved',
      entity: { id: 'capella-id', name: 'Acapella' },
      query: 'Acapella',
    });
    READ_TOOL_HANDLERS.list_orders = async (args) => ({
      items: Array.from({ length: 10 }, (_, index) => ({
        id: `ord-${index + 1}`,
        number: String(index + 1).padStart(5, '0'),
        clientId: 'capella-id',
        clientName: 'Acapella',
        status: 'pendiente',
        statusLabel: 'Pendiente',
        total: 1000,
        balance: 200,
      })),
      total: 20,
      hasMore: true,
      filter: { clientId: 'capella-id', clientName: 'Acapella' },
      footer: 'Mostrando 10 de 20.',
    });

    try {
      const result = await agent.runTurn({
        tenant,
        state: {
          businessId: 'biz-test',
          phone: '+59899123456',
          updatedAt: new Date().toISOString(),
          focusEntities: { client: { id: 'other-id', name: 'Laissmachado', locked: true } },
        },
        text: 'mostrame los pedidos de Acapella',
      });
      assert.equal(result.toolCalls?.[0]?.name, 'find_client');
      assert.equal(result.toolCalls?.[1]?.name, 'list_orders');
      assert.match(result.reply, /Acapella/);
      assert.doesNotMatch(result.reply, /238/);
      const listOutput = result.toolResults?.find((row) => row.name === 'list_orders')?.output;
      assert.equal(listOutput?.filter?.clientId, 'capella-id');
      assert.equal(listOutput?.total, 20);
    } finally {
      READ_TOOL_HANDLERS.find_client = originalFind;
      READ_TOOL_HANDLERS.list_orders = originalList;
    }
  });

  it('presenter uses filtered total not global business total', () => {
    const reply = presentOrderListFromToolOutput({
      items: [{ number: '00001', clientName: 'Acapella', statusLabel: 'Pendiente', total: 100 }],
      total: 20,
      hasMore: true,
      filter: { clientName: 'Acapella' },
      footer: 'Mostrando 1 de 20.',
    });
    assert.match(reply, /Acapella/);
    assert.match(reply, /20/);
    assert.doesNotMatch(reply, /238/);
  });
});
