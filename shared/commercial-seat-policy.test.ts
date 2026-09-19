import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  productSellsErpUserAddons,
  productSellsWhatsappNumberAddons,
} from './commercial-seat-policy.ts';

describe('commercial seat policy', () => {
  it('Bot vende números, no usuarios de panel', () => {
    assert.equal(productSellsWhatsappNumberAddons('whatsapp'), true);
    assert.equal(productSellsErpUserAddons('whatsapp'), false);
    assert.equal(productSellsWhatsappNumberAddons('cash'), true);
    assert.equal(productSellsErpUserAddons('cash'), false);
  });

  it('Gestión vende usuarios, no números', () => {
    assert.equal(productSellsErpUserAddons('erp'), true);
    assert.equal(productSellsWhatsappNumberAddons('erp'), false);
  });

  it('Completo vende ambos', () => {
    assert.equal(productSellsErpUserAddons('completo'), true);
    assert.equal(productSellsWhatsappNumberAddons('completo'), true);
  });
});
