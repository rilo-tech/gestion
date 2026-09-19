import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveHomeRoute } from './auth-home-route.ts';

describe('resolveHomeRoute', () => {
  it('A: ERP=true WhatsApp=false → /dashboard', () => {
    assert.equal(
      resolveHomeRoute({ isPlatformAdmin: false, canAccessErpWeb: true, canAccessWhatsapp: false }),
      '/dashboard'
    );
  });

  it('B: ERP=true WhatsApp=true → /dashboard', () => {
    assert.equal(
      resolveHomeRoute({ isPlatformAdmin: false, canAccessErpWeb: true, canAccessWhatsapp: true }),
      '/dashboard'
    );
  });

  it('C2: ERP summary (Bot Resumen) → /inicio', () => {
    assert.equal(
      resolveHomeRoute({
        isPlatformAdmin: false,
        canAccessErpWeb: true,
        canAccessWhatsapp: true,
        summaryWebHome: true,
      }),
      '/inicio'
    );
  });

  it('D: platform admin → /platform', () => {
    assert.equal(
      resolveHomeRoute({ isPlatformAdmin: true, canAccessErpWeb: true, canAccessWhatsapp: true }),
      '/platform'
    );
  });

  it('E: tenant caja-only → /cash', () => {
    assert.equal(
      resolveHomeRoute({
        isPlatformAdmin: false,
        canAccessErpWeb: true,
        canAccessWhatsapp: true,
        cashOnlyHome: true,
      }),
      '/cash'
    );
  });

  it('sin canales operativos → /activar-suscripcion', () => {
    assert.equal(
      resolveHomeRoute({ isPlatformAdmin: false, canAccessErpWeb: false, canAccessWhatsapp: false }),
      '/activar-suscripcion'
    );
    assert.equal(
      resolveHomeRoute({
        isPlatformAdmin: false,
        canAccessErpWeb: false,
        canAccessWhatsapp: false,
        billingMode: 'blocked',
      }),
      '/activar-suscripcion'
    );
  });
});
