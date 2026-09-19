import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildToolRegistry, getToolByName } from './agent/tool-registry.ts';
import { prepareWriteToolCalls } from './agent/tool-executor.ts';
import type { ToolExecutionContext } from './agent/tool-types.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import { featureForAgentCapability } from '../../shared/tool-feature-map.ts';

const tenant: WhatsappTenantContext = {
  businessId: 'biz-payables',
  phone: '+59899123456',
  role: 'admin',
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
    businessId: 'biz-payables',
    phone: '+59899123456',
    updatedAt: new Date().toISOString(),
  },
  rawUserMessage: 'Registrá un gasto fijo de UTE $7500 que vence el día 7',
};

describe('RILO Bot v4 recurring payable', () => {
  it('maps create_payable capability to payables feature', () => {
    assert.equal(featureForAgentCapability('create_payable'), 'payables');
  });

  it('includes create_recurring_payable in registry', () => {
    const registry = buildToolRegistry({ includeRequiresAdapter: true });
    assert.ok(getToolByName('create_recurring_payable', registry));
  });

  it('create_recurring_payable prepares confirmation without cash movement', async () => {
    const registry = buildToolRegistry({ includeRequiresAdapter: true });
    const stubPrepare = async () => ({
      tool: 'create_recurring_payable',
      label: 'Gasto fijo · UTE · $7.500',
      args: {
        name: 'UTE',
        amount: 7500,
        dueDay: 7,
        firstDueDate: '2026-09-07',
        tipo: 'mensual',
        ambitoId: 'negocio',
      },
      summaryTitle: 'Registrar gasto fijo mensual',
      summaryLines: [
        '• Beneficiario: UTE',
        '• Monto: $7.500',
        '• Vence cada mes el día 07',
        '• Primer vencimiento: 07/09/2026',
        '• No registra caja ahora: el egreso se carga al pagar el vencimiento',
      ],
    });
    const stubRegistry = registry.map((row) =>
      row.name === 'create_recurring_payable' ? { ...row, prepare: stubPrepare } : row
    );
    const plan = await prepareWriteToolCalls(
      [
        {
          id: 'w-recurring',
          name: 'create_recurring_payable',
          arguments: {
            name: 'UTE',
            amount: 7500,
            dueDay: 7,
            firstDueDate: null,
            notes: null,
            cashAccountHint: null,
            ambitoId: null,
          },
        },
      ],
      ctx,
      stubRegistry
    );
    assert.equal(plan.summary.title, 'Registrar gasto fijo mensual');
    assert.match(plan.summary.lines.join('\n'), /UTE/);
    assert.match(plan.summary.lines.join('\n'), /No registra caja ahora/);
    assert.doesNotMatch(plan.summary.lines.join('\n'), /egreso de caja.*ahora/i);
  });
});
