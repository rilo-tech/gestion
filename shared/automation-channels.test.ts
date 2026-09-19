import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allowedAutomationChannels,
  defaultAutomationChannels,
  resolveAutomationChannels,
} from './automation-channels.ts';
import type { ClientPlatformAccess } from './platform-access.ts';
import { AUTOMATION_PRESETS } from './automation-presets.ts';

function access(partial: Partial<ClientPlatformAccess>): ClientPlatformAccess {
  return {
    erpCoreEnabled: true,
    erpWebEnabled: false,
    erpWebPaused: false,
    whatsappEnabled: false,
    whatsappPaused: false,
    aiEnabled: false,
    trialProduct: null,
    ...partial,
  };
}

describe('automation channels by plan', () => {
  it('Bot → solo WhatsApp', () => {
    const a = access({ whatsappEnabled: true, trialProduct: 'whatsapp' });
    assert.deepEqual(allowedAutomationChannels(a), ['whatsapp']);
    assert.deepEqual(defaultAutomationChannels(a), ['whatsapp']);
  });

  it('Gestión → solo ERP', () => {
    const a = access({ erpWebEnabled: true, trialProduct: 'erp' });
    assert.deepEqual(allowedAutomationChannels(a), ['erp']);
    assert.deepEqual(defaultAutomationChannels(a), ['erp']);
  });

  it('Completo → ambos; respeta pedido filtrado', () => {
    const a = access({
      whatsappEnabled: true,
      erpWebEnabled: true,
      trialProduct: 'completo',
    });
    assert.deepEqual(allowedAutomationChannels(a), ['whatsapp', 'erp']);
    assert.deepEqual(resolveAutomationChannels(a, ['whatsapp']), ['whatsapp']);
    assert.deepEqual(resolveAutomationChannels(a, ['erp']), ['erp']);
    assert.deepEqual(resolveAutomationChannels(a, ['whatsapp', 'erp']), ['whatsapp', 'erp']);
  });

  it('WhatsApp pausado no entrega WA', () => {
    const a = access({
      whatsappEnabled: true,
      whatsappPaused: true,
      erpWebEnabled: true,
    });
    assert.deepEqual(allowedAutomationChannels(a), ['erp']);
  });

  it('presets cubren los avisos principales', () => {
    const ids = AUTOMATION_PRESETS.map((p) => p.id);
    assert.ok(ids.includes('daily_summary'));
    assert.ok(ids.includes('daily_attention'));
    assert.ok(ids.includes('orders_due_today'));
    assert.ok(ids.includes('payables_due'));
    assert.ok(ids.includes('low_stock'));
    assert.ok(ids.includes('pending_balances'));
  });
});
