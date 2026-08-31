import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_COMMERCIAL_CATALOG, clampCommercialCatalog } from './commercial-catalog.ts';
import {
  applyIncludedAi200Migration,
  isLegacyListPriceCatalog,
  needsIncludedAi200Migration,
} from './commercial-migrations.ts';

describe('migraciones de catálogo', () => {
  it('no marca precios 690/590/990 como legado', () => {
    assert.equal(isLegacyListPriceCatalog(DEFAULT_COMMERCIAL_CATALOG), false);
  });

  it('no reescribe un catálogo Superadmin ya en 200', () => {
    const catalog = clampCommercialCatalog(DEFAULT_COMMERCIAL_CATALOG);
    assert.equal(needsIncludedAi200Migration(catalog), false);
    const result = applyIncludedAi200Migration(catalog);
    assert.equal(result.changed, false);
    assert.equal(result.catalog.products.whatsapp.amountMonthlyUY, catalog.products.whatsapp.amountMonthlyUY);
  });

  it('1000/2000 → 200 una sola vez y deja bandera', () => {
    const catalog = clampCommercialCatalog({
      ...DEFAULT_COMMERCIAL_CATALOG,
      products: {
        ...DEFAULT_COMMERCIAL_CATALOG.products,
        whatsapp: { ...DEFAULT_COMMERCIAL_CATALOG.products.whatsapp, includedAi: 1000 },
        completo: { ...DEFAULT_COMMERCIAL_CATALOG.products.completo, includedAi: 2000 },
      },
      migrations: { includedAi200AppliedAt: null },
    });
    const first = applyIncludedAi200Migration(catalog, new Date('2026-08-29T12:00:00Z'));
    assert.equal(first.changed, true);
    assert.equal(first.catalog.products.whatsapp.includedAi, 200);
    assert.equal(first.catalog.products.completo.includedAi, 200);
    assert.equal(first.catalog.products.whatsapp.amountMonthlyUY, 690);
    assert.ok(first.catalog.migrations?.includedAi200AppliedAt);
    const second = applyIncludedAi200Migration(first.catalog);
    assert.equal(second.changed, false);
  });

  it('clamp conserva un precio publicado distinto al default', () => {
    const catalog = clampCommercialCatalog({
      ...DEFAULT_COMMERCIAL_CATALOG,
      products: {
        ...DEFAULT_COMMERCIAL_CATALOG.products,
        whatsapp: { ...DEFAULT_COMMERCIAL_CATALOG.products.whatsapp, amountMonthlyUY: 800 },
      },
    });
    assert.equal(catalog.products.whatsapp.amountMonthlyUY, 800);
  });
});
