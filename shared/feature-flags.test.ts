import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isBarcodeScannerEnabledForBusiness,
  isBarcodeScannerGloballyDisabled,
  BARCODE_SCANNER_KILL_SWITCH,
} from './feature-flags.ts';

describe('barcode scanner feature flag', () => {
  it('habilita beta rilo siempre (si no hay kill-switch)', () => {
    if (BARCODE_SCANNER_KILL_SWITCH || isBarcodeScannerGloballyDisabled()) return;
    assert.equal(isBarcodeScannerEnabledForBusiness('rilo'), true);
    assert.equal(isBarcodeScannerEnabledForBusiness('RILO'), true);
  });

  it('requiere erpWebEnabled para no-beta', () => {
    if (BARCODE_SCANNER_KILL_SWITCH || isBarcodeScannerGloballyDisabled()) return;
    assert.equal(isBarcodeScannerEnabledForBusiness('otro'), false);
    assert.equal(
      isBarcodeScannerEnabledForBusiness('otro', { erpWebEnabled: true }),
      true
    );
    assert.equal(
      isBarcodeScannerEnabledForBusiness('otro', { erpWebEnabled: false }),
      false
    );
  });
});
