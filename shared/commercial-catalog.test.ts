import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_COMMERCIAL_CATALOG,
  clampCommercialCatalog,
  overlayProductsForCountry,
  parseUsageMode,
  usagePackTitle,
  whatsappActionsLabel,
} from './commercial-catalog.ts';
import { quotaLinesForProduct } from './ritotech-marketing.ts';

describe('whatsappActionsLabel', () => {
  it('usa el número del catálogo, no un 200 fijo', () => {
    assert.equal(whatsappActionsLabel(200), '200 acciones por WhatsApp por mes');
    assert.equal(whatsappActionsLabel(150), '150 acciones por WhatsApp por mes');
  });

  it('unlimited no muestra tope', () => {
    assert.equal(
      whatsappActionsLabel(200, 'unlimited'),
      'Uso libre por WhatsApp (se mide, sin tope mensual)'
    );
  });

  it('0 limited no arma línea vacía de cupo', () => {
    assert.equal(whatsappActionsLabel(0, 'limited'), '');
  });
});

describe('DEFAULT_COMMERCIAL_CATALOG', () => {
  it('Bot y Completo incluyen 200 acciones por WhatsApp, limited', () => {
    assert.equal(DEFAULT_COMMERCIAL_CATALOG.products.whatsapp.includedAi, 200);
    assert.equal(DEFAULT_COMMERCIAL_CATALOG.products.completo.includedAi, 200);
    assert.equal(parseUsageMode(DEFAULT_COMMERCIAL_CATALOG.products.whatsapp.usageMode), 'limited');
    assert.equal(DEFAULT_COMMERCIAL_CATALOG.products.erp.includedAi, 0);
    assert.equal(DEFAULT_COMMERCIAL_CATALOG.products.whatsapp.includedWhatsappNumbers, 1);
    assert.equal(DEFAULT_COMMERCIAL_CATALOG.products.erp.includedErpUsers, 1);
    assert.equal(DEFAULT_COMMERCIAL_CATALOG.products.erp.includedWhatsappNumbers, 0);
  });

  it('clamp conserva usageMode unlimited', () => {
    const clamped = clampCommercialCatalog({
      ...DEFAULT_COMMERCIAL_CATALOG,
      products: {
        ...DEFAULT_COMMERCIAL_CATALOG.products,
        whatsapp: {
          ...DEFAULT_COMMERCIAL_CATALOG.products.whatsapp,
          usageMode: 'unlimited',
        },
      },
    });
    assert.equal(clamped.products.whatsapp.usageMode, 'unlimited');
    assert.equal(clamped.products.whatsapp.includedAi, 200);
  });

  it('pack de acciones usa copy de WhatsApp', () => {
    assert.equal(usagePackTitle('ai', 500), '500 acciones por WhatsApp');
  });
});

describe('cuotas de los tres planes', () => {
  const catalog = clampCommercialCatalog(DEFAULT_COMMERCIAL_CATALOG);

  it('Bot incluye acciones, 1 número, extras de número y usuario', () => {
    const lines = quotaLinesForProduct(catalog, 'whatsapp', 'UY');
    assert.ok(lines.some((line) => line.includes('200 acciones')));
    assert.ok(lines.some((line) => line.includes('1 número de WhatsApp')));
    assert.ok(lines.some((line) => line.includes('Número adicional')));
    assert.ok(lines.some((line) => line.includes('1 usuario incluido')));
    assert.ok(lines.some((line) => line.includes('Usuario adicional')));
  });

  it('Gestión incluye usuario de panel y extra, sin número WhatsApp', () => {
    const lines = quotaLinesForProduct(catalog, 'erp', 'UY');
    assert.ok(lines.some((line) => line.includes('1 usuario de RILO Gestión')));
    assert.ok(lines.some((line) => line.includes('Usuario adicional')));
    assert.equal(lines.some((line) => line.toLowerCase().includes('whatsapp')), false);
    assert.equal(lines.some((line) => line.includes('acciones')), false);
  });

  it('Completo incluye Bot + Gestión: acciones, número y usuario', () => {
    const lines = quotaLinesForProduct(catalog, 'completo', 'UY');
    assert.ok(lines.some((line) => line.includes('200 acciones')));
    assert.ok(lines.some((line) => line.includes('1 número de WhatsApp')));
    assert.ok(lines.some((line) => line.includes('1 usuario de RILO Gestión')));
    assert.ok(lines.some((line) => line.includes('Número adicional')));
    assert.ok(lines.some((line) => line.includes('Usuario adicional')));
  });
});

describe('overlayProductsForCountry', () => {
  it('usa el extra de cada plan, no un precio global', () => {
    const catalog = clampCommercialCatalog({
      ...DEFAULT_COMMERCIAL_CATALOG,
      products: {
        ...DEFAULT_COMMERCIAL_CATALOG.products,
        whatsapp: { ...DEFAULT_COMMERCIAL_CATALOG.products.whatsapp, extraErpUserPriceUY: 111 },
        erp: { ...DEFAULT_COMMERCIAL_CATALOG.products.erp, extraErpUserPriceUY: 222 },
        completo: { ...DEFAULT_COMMERCIAL_CATALOG.products.completo, extraErpUserPriceUY: 333 },
      },
    });
    const rows = overlayProductsForCountry(catalog, 'UY');
    assert.equal(rows.find((row) => row.id === 'whatsapp')?.extraUserMonthly, 111);
    assert.equal(rows.find((row) => row.id === 'erp')?.extraUserMonthly, 222);
    assert.equal(rows.find((row) => row.id === 'completo')?.extraUserMonthly, 333);
  });
});
