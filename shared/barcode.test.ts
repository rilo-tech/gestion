import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  barcodeFieldsForWrite,
  looksLikeBarcodeQuery,
  normalizeBarcodeKey,
  sanitizeScannedBarcode,
} from './barcode.ts';

describe('barcode normalization', () => {
  it('normaliza EAN y espacios', () => {
    assert.equal(normalizeBarcodeKey('7791234567890'), '7791234567890');
    assert.equal(normalizeBarcodeKey(' 779 123 456 7890 '), '7791234567890');
    assert.equal(normalizeBarcodeKey(''), '');
  });

  it('acepta Code39/128 alfanumérico', () => {
    assert.equal(normalizeBarcodeKey('ABC-12345'), 'ABC-12345');
    assert.equal(sanitizeScannedBarcode('ABC-12345'), 'ABC-12345');
    assert.equal(looksLikeBarcodeQuery('ABC-12345'), true);
  });

  it('limpia envoltorio Code39 *code*', () => {
    assert.equal(sanitizeScannedBarcode('*779123*'), '779123');
  });

  it('rechaza vacío / inválidos', () => {
    assert.equal(sanitizeScannedBarcode(''), null);
    assert.equal(sanitizeScannedBarcode('!!'), null);
    assert.equal(sanitizeScannedBarcode('ab'), null);
  });

  it('barcodeFieldsForWrite escribe key', () => {
    assert.deepEqual(barcodeFieldsForWrite(' 12 34 '), {
      codigoBarras: '1234',
      codigoBarrasKey: '1234',
    });
    assert.deepEqual(barcodeFieldsForWrite(''), {});
  });
});
