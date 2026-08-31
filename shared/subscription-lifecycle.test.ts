import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPreapprovalAutoRenewing,
  lifecycleToErpStatus,
  resolveSubscriptionLifecycle,
  webhookIdempotencyKey,
} from './subscription-lifecycle.ts';

describe('resolveSubscriptionLifecycle', () => {
  const trial = {
    enPrueba: true,
    trialStatus: 'active',
    trialStartDate: '2026-08-01',
    trialEndDate: '2026-08-21',
  };

  it('trial vigente → trial', () => {
    assert.equal(
      resolveSubscriptionLifecycle({
        ...trial,
        at: new Date('2026-08-10T15:00:00Z'),
      }),
      'trial'
    );
  });

  it('trial + renovación autorizada, todavía en prueba → trial', () => {
    assert.equal(
      resolveSubscriptionLifecycle({
        ...trial,
        autoRenew: true,
        mpPreapprovalStatus: 'authorized',
        at: new Date('2026-08-10T15:00:00Z'),
      }),
      'trial'
    );
  });

  it('terminó trial + renovación autorizada → active', () => {
    assert.equal(
      resolveSubscriptionLifecycle({
        enPrueba: true,
        trialStatus: 'expired',
        trialEndDate: '2026-08-01',
        autoRenew: true,
        mpPreapprovalStatus: 'authorized',
        at: new Date('2026-08-29T15:00:00Z'),
      }),
      'active'
    );
  });

  it('pago aprobado con cobertura → active', () => {
    assert.equal(
      resolveSubscriptionLifecycle({
        paidUntil: '2026-09-29T12:00:00.000Z',
        at: new Date('2026-08-29T15:00:00Z'),
      }),
      'active'
    );
  });

  it('pago rechazado → past_due', () => {
    assert.equal(
      resolveSubscriptionLifecycle({
        autoRenew: true,
        mpPreapprovalStatus: 'authorized',
        lastPaymentStatus: 'rejected',
        at: new Date('2026-08-29T15:00:00Z'),
      }),
      'past_due'
    );
  });

  it('terminó trial sin renovación → inactive', () => {
    assert.equal(
      resolveSubscriptionLifecycle({
        enPrueba: true,
        trialStatus: 'expired',
        trialEndDate: '2026-08-01',
        autoRenew: false,
        at: new Date('2026-08-29T15:00:00Z'),
      }),
      'inactive'
    );
  });

  it('inactive no es delete: mapea a suspendida', () => {
    assert.equal(lifecycleToErpStatus('inactive'), 'suspendida');
    assert.equal(lifecycleToErpStatus('past_due'), 'vencida');
    assert.equal(lifecycleToErpStatus('active'), 'activa');
    assert.equal(lifecycleToErpStatus('trial'), 'activa');
  });

  it('authorized cuenta como auto-renew', () => {
    assert.equal(isPreapprovalAutoRenewing('authorized'), true);
    assert.equal(isPreapprovalAutoRenewing('paused'), false);
  });

  it('idempotency key es estable', () => {
    assert.equal(
      webhookIdempotencyKey('payment', '123'),
      webhookIdempotencyKey('payment', '123')
    );
    assert.notEqual(
      webhookIdempotencyKey('payment', '123'),
      webhookIdempotencyKey('payment', '124')
    );
  });
});
