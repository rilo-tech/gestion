import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_COMMERCIAL_CATALOG,
  clampCommercialCatalog,
} from './commercial-catalog.ts';
import {
  ADDON_BILLING_EFFECTIVE_AT,
  billableWhatsappCount,
  buildCommercialPriceSnapshot,
  canConfirmCommercialBilling,
  extraSeatCount,
  quoteAddErpUser,
  quoteAddWhatsappNumber,
  quoteCommercialMonthly,
  quoteReleaseWhatsappNumber,
  quoteRemoveErpUser,
  resolveCommercialRates,
  sharedActionUsage,
} from './commercial-pricing.ts';

const catalog = clampCommercialCatalog(DEFAULT_COMMERCIAL_CATALOG);
const bot = 'whatsapp' as const;

describe('A. segundo usuario ERP entra al total', () => {
  it('plan incluye 1 usuario; agregar el segundo suma extraErpUserPrice', () => {
    const before = quoteCommercialMonthly({
      catalog,
      productId: 'erp',
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 0,
    });
    const quote = quoteAddErpUser({
      catalog,
      productId: 'erp',
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 0,
    });
    const unit = catalog.products.erp.extraErpUserPriceUY ?? catalog.extraUserMonthlyUY;
    assert.equal(before.extraErpUsers, 0);
    assert.equal(quote.delta, unit);
    assert.equal(quote.newTotal, before.total + unit);
    assert.equal(quote.extraQuantityAfter, 1);
  });
});

describe('B. baja de usuario adicional deja de facturarse', () => {
  it('al pasar de 2 activos a 1, extraUserPrice sale del total', () => {
    const withExtra = quoteCommercialMonthly({
      catalog,
      productId: 'erp',
      country: 'UY',
      activeErpUsers: 2,
      billableWhatsappNumbers: 0,
    });
    const after = quoteRemoveErpUser({
      catalog,
      productId: 'erp',
      country: 'UY',
      activeErpUsers: 2,
      billableWhatsappNumbers: 0,
    });
    assert.ok(withExtra.extraErpCost > 0);
    assert.equal(after.extraErpUsers, 0);
    assert.equal(after.extraErpCost, 0);
    assert.equal(after.total, withExtra.total - withExtra.extraErpCost);
  });
});

describe('C. segundo número WhatsApp entra al total', () => {
  it('plan Bot incluye 1 número; el segundo suma extraWhatsappNumberPrice', () => {
    const before = quoteCommercialMonthly({
      catalog,
      productId: bot,
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 1,
    });
    const quote = quoteAddWhatsappNumber({
      catalog,
      productId: bot,
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 1,
    });
    const unit =
      catalog.products.whatsapp.extraWhatsappNumberPriceUY ??
      catalog.extraWhatsappNumberMonthlyUY;
    assert.equal(before.extraWhatsappNumbers, 0);
    assert.equal(quote.delta, unit);
    assert.equal(quote.newTotal, before.total + unit);
  });
});

describe('D. dos números de la misma empresa', () => {
  it('comparten businessId', () => {
    const businessId = 'comercio-x';
    const lines = [
      { businessId, enabled: true, phone: '+59899111111', status: 'active' },
      { businessId, enabled: true, phone: '+59899222222', status: 'active' },
    ];
    assert.equal(lines[0].businessId, lines[1].businessId);
    assert.equal(billableWhatsappCount(lines), 2);
  });
});

describe('E–F. cupo de acciones compartido, no por número', () => {
  it('A+B+C suman sobre las mismas 200', () => {
    const usage = sharedActionUsage({ A: 80, B: 50, C: 30 }, 200);
    assert.equal(usage.used, 160);
    assert.equal(usage.max, 200);
    assert.equal(usage.remaining, 40);
  });

  it('el segundo número no recibe otras 200 acciones', () => {
    const rates = resolveCommercialRates({ catalog, productId: bot, country: 'UY' });
    assert.equal(rates.monthlyActionLimit, 200);
    const one = sharedActionUsage({ A: 80 }, rates.monthlyActionLimit);
    const two = sharedActionUsage({ A: 80, B: 50 }, rates.monthlyActionLimit);
    assert.equal(one.max, two.max);
    assert.equal(two.max, 200);
  });
});

describe('G. Superadmin cambia precio por número', () => {
  it('nuevos cálculos usan la config vigente', () => {
    const updated = clampCommercialCatalog({
      ...catalog,
      products: {
        ...catalog.products,
        whatsapp: {
          ...catalog.products.whatsapp,
          extraWhatsappNumberPriceUY: 400,
        },
      },
    });
    const quote = quoteAddWhatsappNumber({
      catalog: updated,
      productId: bot,
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 1,
    });
    assert.equal(quote.extraUnit, 400);
    assert.equal(quote.delta, 400);
  });
});

describe('H. cliente ve precio antes de agregar número', () => {
  it('la cotización muestra unit, total anterior y nuevo', () => {
    const quote = quoteAddWhatsappNumber({
      catalog,
      productId: bot,
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 1,
    });
    assert.ok(quote.extraUnit > 0);
    assert.ok(quote.newTotal > quote.oldTotal);
    assert.equal(quote.effectiveAt, ADDON_BILLING_EFFECTIVE_AT);
  });
});

describe('I. cliente ve precio antes de agregar usuario', () => {
  it('la cotización muestra unit, total anterior y nuevo', () => {
    const quote = quoteAddErpUser({
      catalog,
      productId: 'erp',
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 0,
    });
    assert.ok(quote.extraUnit > 0);
    assert.ok(quote.newTotal > quote.oldTotal);
    assert.equal(quote.effectiveAt, ADDON_BILLING_EFFECTIVE_AT);
  });
});

describe('J–K. permisos de autogestión', () => {
  it('operador sin permiso no confirma facturación', () => {
    assert.equal(canConfirmCommercialBilling('staff'), false);
    assert.equal(canConfirmCommercialBilling('operador'), false);
  });

  it('admin de empresa y superadmin sí', () => {
    assert.equal(canConfirmCommercialBilling('supervisor'), true);
    assert.equal(canConfirmCommercialBilling('admin'), true);
    assert.equal(canConfirmCommercialBilling('platform'), true);
  });
});

describe('L. número liberado conserva historial de empresa', () => {
  it('deja de ser facturable y no crea otra empresa', () => {
    const businessId = 'comercio-x';
    const lines = [
      { businessId, enabled: true, phone: '+59899111111', status: 'active' },
      { businessId, enabled: false, phone: '', status: 'disconnected', previousPhone: '+59899222222' },
    ];
    assert.equal(billableWhatsappCount(lines), 1);
    assert.equal(lines[1].businessId, businessId);
  });
});

describe('M. cambio de add-on tiene impacto comercial medible', () => {
  it('delta e historial de totales quedan definidos', () => {
    const add = quoteAddErpUser({
      catalog,
      productId: 'completo',
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 1,
    });
    assert.equal(typeof add.oldTotal, 'number');
    assert.equal(typeof add.newTotal, 'number');
    assert.ok(add.delta > 0);
  });
});

describe('extras en los tres planes', () => {
  it('Bot no cobra usuario ERP adicional; sí cobra número WA', () => {
    const userQuote = quoteAddErpUser({
      catalog,
      productId: bot,
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 1,
    });
    assert.equal(userQuote.delta, 0);

    const waQuote = quoteAddWhatsappNumber({
      catalog,
      productId: bot,
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 1,
    });
    const unit =
      catalog.products.whatsapp.extraWhatsappNumberPriceUY ??
      catalog.extraWhatsappNumberMonthlyUY;
    assert.equal(waQuote.delta, unit);
  });

  it('Gestión no cobra número WhatsApp si no hay líneas billable', () => {
    const quote = quoteCommercialMonthly({
      catalog,
      productId: 'erp',
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 0,
    });
    assert.equal(quote.extraWhatsappCost, 0);
    assert.equal(quote.total, catalog.products.erp.amountMonthlyUY);
  });
});

describe('N. checkout usa CommercialPricingService', () => {
  it('el total consolidado es plan + extras, no solo amountMonthly', () => {
    const quote = quoteCommercialMonthly({
      catalog,
      productId: 'completo',
      country: 'UY',
      activeErpUsers: 3,
      billableWhatsappNumbers: 2,
    });
    const base = catalog.products.completo.amountMonthlyUY;
    assert.equal(quote.extraErpUsers, extraSeatCount(3, catalog.products.completo.includedErpUsers ?? 1));
    assert.equal(quote.extraWhatsappNumbers, 1);
    assert.equal(quote.total, base + quote.extraErpCost + quote.extraWhatsappCost);
    assert.ok(quote.total > base);
  });
});

describe('RILO Caja', () => {
  it('cotiza base 390 sin extras', () => {
    const quote = quoteCommercialMonthly({
      catalog,
      productId: 'cash',
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 1,
    });
    assert.equal(quote.total, 390);
    assert.equal(quote.rates.monthlyActionLimit, 100);
  });
});

describe('priceSnapshot / grandfathering', () => {
  it('precio congelado en snapshot ignora subida de catálogo', () => {
    const raised = clampCommercialCatalog({
      ...catalog,
      products: {
        ...catalog.products,
        completo: {
          ...catalog.products.completo,
          amountMonthlyUY: 990,
        },
      },
    });
    const atCatalog = quoteCommercialMonthly({
      catalog: raised,
      productId: 'completo',
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 1,
    });
    assert.equal(atCatalog.total, 990);

    const frozen = quoteCommercialMonthly({
      catalog: raised,
      productId: 'completo',
      country: 'UY',
      overrides: { precioFinal: 690 },
      activeErpUsers: 1,
      billableWhatsappNumbers: 1,
    });
    assert.equal(frozen.customTotal, true);
    assert.equal(frozen.total, 690);

    const snapshot = buildCommercialPriceSnapshot({
      catalog,
      productId: 'completo',
      quote: quoteCommercialMonthly({
        catalog,
        productId: 'completo',
        country: 'UY',
        activeErpUsers: 1,
        billableWhatsappNumbers: 1,
      }),
      capturedAt: '2026-08-31T00:00:00.000Z',
    });
    assert.equal(snapshot.monthlyTotal, catalog.products.completo.amountMonthlyUY);
    assert.equal(snapshot.catalogVersion, catalog.priceVersion);
  });
});

describe('overrides por empresa', () => {
  it('marca DEFAULT vs OVERRIDE', () => {
    const rates = resolveCommercialRates({
      catalog,
      productId: bot,
      country: 'UY',
      overrides: { includedErpUsers: 3, extraWhatsappNumberPrice: 500 },
    });
    assert.equal(rates.includedErpUsers, 3);
    assert.equal(rates.sources.includedErpUsers, 'override');
    assert.equal(rates.sources.includedWhatsappNumbers, 'default');
    assert.equal(rates.extraWhatsappNumberPrice, 500);
    assert.equal(rates.sources.extraWhatsappNumberPrice, 'override');
  });

  it('precio final personalizado reemplaza el total', () => {
    const quote = quoteCommercialMonthly({
      catalog,
      productId: bot,
      country: 'UY',
      overrides: { precioFinal: 1500 },
      activeErpUsers: 4,
      billableWhatsappNumbers: 3,
    });
    assert.equal(quote.customTotal, true);
    assert.equal(quote.total, 1500);
  });
});

describe('pendiente no es facturable', () => {
  it('número sin verificar no entra al extra', () => {
    const count = billableWhatsappCount([
      { businessId: 'a', enabled: true, phone: '+59899111111', status: 'active' },
      { businessId: 'a', enabled: false, phone: '', status: 'pending' },
    ]);
    assert.equal(count, 1);
    const quote = quoteCommercialMonthly({
      catalog,
      productId: bot,
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: count,
    });
    assert.equal(quote.extraWhatsappNumbers, 0);
  });
});

describe('liberar número actualiza el total futuro', () => {
  it('quoteRelease baja el extra', () => {
    const after = quoteReleaseWhatsappNumber({
      catalog,
      productId: bot,
      country: 'UY',
      activeErpUsers: 1,
      billableWhatsappNumbers: 2,
    });
    assert.equal(after.extraWhatsappNumbers, 0);
  });
});
