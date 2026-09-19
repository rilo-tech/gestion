import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RILO_PRODUCTION_PROJECT_ID,
  RILO_STAGING_PROJECT_ID,
  allowDevOtpExposure,
  assertStagingProjectOrThrow,
  isStagingWhatsappRecipientAllowed,
  resolveRiloEnvironment,
  shouldUseMercadoPagoSandbox,
  allowExternalAnalytics,
} from './rilo-environment.ts';

describe('rilo-environment guards', () => {
  it('detecta staging por RILO_ENV y por project id', () => {
    assert.equal(resolveRiloEnvironment({ RILO_ENV: 'staging' }), 'staging');
    assert.equal(
      resolveRiloEnvironment({ FIREBASE_PROJECT_ID: RILO_STAGING_PROJECT_ID }),
      'staging'
    );
    assert.equal(
      resolveRiloEnvironment({ FIREBASE_PROJECT_ID: RILO_PRODUCTION_PROJECT_ID }),
      'production'
    );
  });

  it('assertStagingProjectOrThrow aborta en producción', () => {
    assert.throws(
      () =>
        assertStagingProjectOrThrow('test', {
          FIREBASE_PROJECT_ID: RILO_PRODUCTION_PROJECT_ID,
        }),
      /ABORT|producción|prohibido/i
    );
  });

  it('assertStagingProjectOrThrow acepta solo rilo-staging', () => {
    assert.equal(
      assertStagingProjectOrThrow('test', {
        FIREBASE_PROJECT_ID: RILO_STAGING_PROJECT_ID,
        USE_FIRESTORE_EMULATOR: 'false',
      }),
      RILO_STAGING_PROJECT_ID
    );
    assert.throws(
      () =>
        assertStagingProjectOrThrow('test', {
          FIREBASE_PROJECT_ID: 'otro-proyecto',
        }),
      /esperado/
    );
  });

  it('OTP dev permitido en staging, no en production project', () => {
    assert.equal(
      allowDevOtpExposure({
        RILO_ENV: 'staging',
        FIREBASE_PROJECT_ID: RILO_STAGING_PROJECT_ID,
        NODE_ENV: 'production',
      }),
      true
    );
    assert.equal(
      allowDevOtpExposure({
        FIREBASE_PROJECT_ID: RILO_PRODUCTION_PROJECT_ID,
        NODE_ENV: 'production',
        TRIAL_OTP_DEV_MODE: 'true',
      }),
      false
    );
  });

  it('WhatsApp staging allowlist bloquea sin lista y permite listados', () => {
    assert.equal(
      isStagingWhatsappRecipientAllowed('+59899111222', {
        RILO_ENV: 'staging',
        WHATSAPP_STAGING_ALLOWLIST: '',
      }),
      false
    );
    assert.equal(
      isStagingWhatsappRecipientAllowed('+59899111222', {
        RILO_ENV: 'staging',
        WHATSAPP_STAGING_ALLOWLIST: '+59899111222,+15550001111',
      }),
      true
    );
    assert.equal(
      isStagingWhatsappRecipientAllowed('+59899999999', {
        RILO_ENV: 'staging',
        WHATSAPP_STAGING_ALLOWLIST: '+59899111222',
      }),
      false
    );
    // fuera de staging: no restringe
    assert.equal(
      isStagingWhatsappRecipientAllowed('+59899999999', {
        RILO_ENV: 'production',
      }),
      true
    );
  });

  it('MP sandbox forzado en staging', () => {
    assert.equal(shouldUseMercadoPagoSandbox({ RILO_ENV: 'staging' }), true);
    assert.equal(shouldUseMercadoPagoSandbox({ MERCADOPAGO_USE_SANDBOX: 'true' }), true);
    assert.equal(shouldUseMercadoPagoSandbox({}), false);
  });

  it('analytics externo off por default en staging', () => {
    assert.equal(allowExternalAnalytics({ VITE_RILO_ENV: 'staging' }), false);
    assert.equal(
      allowExternalAnalytics({ VITE_RILO_ENV: 'staging', VITE_ANALYTICS_EXTERNAL: 'true' }),
      true
    );
  });
});
