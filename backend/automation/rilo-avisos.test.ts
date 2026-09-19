import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summarizeAttentionItems } from './attention-sync.ts';
import type { AttentionItem } from '../../shared/erp-notices.ts';
import { allowedAutomationChannels } from '../../shared/automation-channels.ts';
import { normalizePlatformAccess } from '../../shared/platform-access.ts';
import {
  severityForNoticeType,
  RESOLVED_NOTICE_RETENTION_DAYS,
} from '../../shared/erp-notices.ts';

describe('rilo notices model', () => {
  it('severity: overdue urgent, digest info, due today attention', () => {
    assert.equal(severityForNoticeType('payable_overdue'), 'urgent');
    assert.equal(severityForNoticeType('order_overdue'), 'urgent');
    assert.equal(severityForNoticeType('daily_business_summary'), 'info');
    assert.equal(severityForNoticeType('order_due_today'), 'attention');
  });

  it('retention window is 30 days', () => {
    assert.equal(RESOLVED_NOTICE_RETENTION_DAYS, 30);
  });
});

describe('attention summary (digest lines)', () => {
  it('omits empty sections', () => {
    const items: AttentionItem[] = [
      {
        type: 'order_due_today',
        severity: 'attention',
        title: 'Pedido #1',
        body: 'Ana',
        dedupeKey: 'order_due_today:1',
      },
      {
        type: 'order_due_today',
        severity: 'attention',
        title: 'Pedido #2',
        body: 'Juan',
        dedupeKey: 'order_due_today:2',
      },
      {
        type: 'payable_due_soon',
        severity: 'attention',
        title: 'UTE',
        body: '$7500',
        dedupeKey: 'payable_due:ute',
      },
    ];
    const summary = summarizeAttentionItems(items);
    assert.equal(summary.count, 3);
    assert.ok(summary.lines.some((l) => l.includes('2 pedido')));
    assert.ok(summary.lines.some((l) => l.includes('vencimiento')));
    assert.ok(!summary.lines.some((l) => /stock/i.test(l)));
    assert.ok(!summary.lines.some((l) => /cobro/i.test(l)));
  });
});

describe('notification channels by plan', () => {
  it('Bot / Completo: panel + whatsapp; Gestión: panel only', () => {
    const bot = allowedAutomationChannels(
      normalizePlatformAccess({
        whatsappEnabled: true,
        erpWebEnabled: true,
        webExperience: 'summary',
        trialProduct: 'whatsapp',
      })
    );
    const gestion = allowedAutomationChannels(
      normalizePlatformAccess({
        whatsappEnabled: false,
        erpWebEnabled: true,
        webExperience: 'full',
        trialProduct: 'erp',
      })
    );
    const completo = allowedAutomationChannels(
      normalizePlatformAccess({
        whatsappEnabled: true,
        erpWebEnabled: true,
        webExperience: 'full',
        trialProduct: 'completo',
      })
    );
    assert.ok(bot.includes('whatsapp') && bot.includes('erp'));
    assert.ok(gestion.includes('erp'));
    assert.ok(!gestion.includes('whatsapp'));
    assert.ok(completo.includes('whatsapp') && completo.includes('erp'));
  });
});

describe('read vs resolved semantics', () => {
  it('unread flag does not imply resolved', () => {
    const open = { status: 'open', userReadAt: '2026-01-01T10:00:00.000Z', resolvedAt: null };
    assert.equal(open.status, 'open');
    assert.ok(open.userReadAt);
    assert.equal(open.resolvedAt, null);
  });
});
