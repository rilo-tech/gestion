import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMercadoPagoWebhook } from '../backend/billing/mp-webhook-parse.ts';
import { buildPreapprovalPayload } from '../backend/billing/preapproval.ts';
import { quoteCommercialMonthly } from './commercial-pricing.ts';
import { DEFAULT_COMMERCIAL_CATALOG } from './commercial-catalog.ts';
import { buildProfitability } from './profitability.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

describe('Mercado Pago webhook parse', () => {
  it('lee payment de query IPN', () => {
    const parsed = parseMercadoPagoWebhook({
      query: { topic: 'payment', 'data.id': '999' },
      body: {},
    });
    assert.equal(parsed.topic, 'payment');
    assert.equal(parsed.dataId, '999');
  });

  it('normaliza subscription_preapproval', () => {
    const parsed = parseMercadoPagoWebhook({
      query: {},
      body: { type: 'subscription_preapproval', data: { id: 'pre-1' } },
    });
    assert.equal(parsed.topic, 'subscription_preapproval');
    assert.equal(parsed.dataId, 'pre-1');
  });

  it('normaliza authorized payment', () => {
    const parsed = parseMercadoPagoWebhook({
      query: { type: 'subscription_authorized_payment' },
      body: { data: { id: 'ap-8' } },
    });
    assert.equal(parsed.topic, 'subscription_authorized_payment');
    assert.equal(parsed.dataId, 'ap-8');
  });
});

describe('Preapproval amount from CommercialPricingService', () => {
  it('el monto recurrente es el total cotizado, no el precio base', () => {
    const quote = quoteCommercialMonthly({
      catalog: DEFAULT_COMMERCIAL_CATALOG,
      productId: 'completo',
      country: 'UY',
      activeErpUsers: 3,
      billableWhatsappNumbers: 2,
    });
    assert.ok(quote.total > quote.rates.baseAmount);
    const payload = buildPreapprovalPayload({
      reason: 'RILO',
      payerEmail: 'a@b.com',
      externalReference: 'biz|completo|UY|preapproval',
      amount: quote.total,
      currency: 'UYU',
      backUrl: 'https://example.com',
      remainingTrialDays: 12,
    });
    const recurring = payload.auto_recurring as { transaction_amount: number; free_trial?: { frequency: number } };
    assert.equal(recurring.transaction_amount, quote.total);
    assert.equal(recurring.free_trial?.frequency, 12);
  });
});

describe('rentabilidad REAL vs ESTIMADO', () => {
  it('etiqueta Gemini como real y Firebase como estimado', () => {
    const row = buildProfitability({
      currency: 'UYU',
      incomeLines: [{ code: 'plan', label: 'Plan base', amount: 990 }],
      incomeTotal: 990,
      geminiUsd: 1.2,
      whatsappMetaUsd: 0.5,
      mercadoPagoUsd: 0.3,
      mercadoPagoSource: 'estimated',
      firebaseUsd: 2,
      otherUsd: 0,
      fx: { uyuPerUsd: 40, arsPerUsd: 1400 },
    });
    const gemini = row.costs.find((c) => c.code === 'gemini');
    const firebase = row.costs.find((c) => c.code === 'firebase_gcp');
    assert.equal(gemini?.source, 'real');
    assert.equal(firebase?.source, 'estimated');
    assert.ok(row.result.incomeUsdEstimated > 0);
  });
});

describe('rutas add-ons', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  it('declara GET, POST y DELETE en addons.ts', () => {
    const source = readFileSync(join(here, '../backend/routes/addons.ts'), 'utf8');
    assert.match(source, /router\.get\('\/:businessId\/addons'/);
    assert.match(source, /router\.post\(\s*'\/:businessId\/addons\/whatsapp'/);
    assert.match(source, /router\.delete\(\s*'\/:businessId\/addons\/whatsapp\/:lineId'/);
  });

  it('create-app monta addonsRoutes antes de businessRoutes', () => {
    const source = readFileSync(join(here, '../backend/create-app.ts'), 'utf8');
    const addonsAt = source.indexOf("api.use('/business', addonsRoutes)");
    const businessAt = source.indexOf("api.use('/business', businessRoutes)");
    assert.ok(addonsAt >= 0 && businessAt >= 0);
    assert.ok(addonsAt < businessAt);
    assert.equal(source.split("api.use('/business', addonsRoutes)").length - 1, 1);
  });
});
