import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildManualCashMovementDocument,
  pickCashErpBusinessFields,
  validateRegisterCashMovement,
} from './cash-document.ts';
import { CashDomainError } from './cash-errors.ts';
import type { RegisterCashMovementCommand } from './cash-types.ts';

/** Caracterización del POST Web actual: egreso $370 UTE ámbito negocio. */
const RILO_CAJA = {
  ambitos: [
    { id: 'negocio', label: 'Negocio', sistema: true },
    { id: 'personal', label: 'Personal', sistema: false },
  ],
};

const NOW = new Date('2026-08-29T18:00:00.000Z');

function webUteCommand(overrides: Partial<RegisterCashMovementCommand> = {}): RegisterCashMovementCommand {
  return {
    businessId: 'negocio-rilo',
    type: 'egreso',
    amount: 370,
    concept: 'UTE',
    scope: 'negocio',
    date: '2026-08-29',
    medio: 'efectivo',
    categoriaId: null,
    descripcion: null,
    source: 'web',
    ...overrides,
  };
}

describe('Caracterización POST caja Web (egreso UTE $370)', () => {
  it('produce el documento ERP del alta manual', () => {
    const validated = validateRegisterCashMovement(webUteCommand(), RILO_CAJA, NOW);
    const doc = buildManualCashMovementDocument(validated, NOW.toISOString());

    assert.equal(doc.tipo, 'egreso');
    assert.equal(doc.monto, 370);
    assert.equal(doc.medio, 'efectivo');
    assert.equal(doc.concepto, 'UTE');
    assert.equal(doc.categoriaId, null);
    assert.equal(doc.descripcion, null);
    assert.equal(doc.ambito, 'negocio');
    assert.equal(doc.origenTipo, 'caja_manual_egreso');
    assert.equal(doc.origenGrupo, 'manual');
    assert.equal(doc.origenId, null);
    assert.equal(doc.pedidoId, null);
    assert.equal(doc.numeroPedido, null);
    assert.equal(doc.numeroPedidoLabel, null);
    assert.equal(doc.clienteId, null);
    assert.equal(doc.negocioId, 'negocio-rilo');
    assert.equal(doc.createdAt, NOW.toISOString());
    assert.ok(String(doc.fecha).startsWith('2026-08-29') || String(doc.fecha).length > 10);
    assert.equal(doc.origenWhatsapp, undefined);
    assert.equal(doc.whatsappPhone, undefined);
    assert.equal(doc.source, 'web');
  });
});

describe('Validación CashDomainService', () => {
  it('rechaza monto 0, NaN y negativo', () => {
    for (const amount of [0, Number.NaN, -10]) {
      assert.throws(
        () => validateRegisterCashMovement(webUteCommand({ amount }), RILO_CAJA, NOW),
        (err: unknown) => err instanceof CashDomainError && err.code === 'INVALID_CASH_AMOUNT'
      );
    }
  });

  it('rechaza concepto vacío', () => {
    assert.throws(
      () => validateRegisterCashMovement(webUteCommand({ concept: '  ' }), RILO_CAJA, NOW),
      (err: unknown) => err instanceof CashDomainError && err.code === 'MISSING_CASH_CONCEPT'
    );
  });

  it('rechaza tipo inválido', () => {
    assert.throws(
      () =>
        validateRegisterCashMovement(
          webUteCommand({ type: 'income' as RegisterCashMovementCommand['type'] }),
          RILO_CAJA,
          NOW
        ),
      (err: unknown) => err instanceof CashDomainError && err.code === 'INVALID_CASH_TYPE'
    );
  });

  it('rechaza ámbito que no existe cuando el tenant tiene varios', () => {
    assert.throws(
      () => validateRegisterCashMovement(webUteCommand({ scope: 'caja-inventada' }), RILO_CAJA, NOW),
      (err: unknown) => err instanceof CashDomainError && err.code === 'INVALID_CASH_SCOPE'
    );
  });

  it('acepta ámbito personal configurado por el tenant', () => {
    const validated = validateRegisterCashMovement(
      webUteCommand({ scope: 'personal' }),
      RILO_CAJA,
      NOW
    );
    assert.equal(validated.ambito, 'personal');
  });

  it('sin scope cae al ámbito negocio (mismo fallback que el POST Web)', () => {
    const validated = validateRegisterCashMovement(webUteCommand({ scope: undefined }), RILO_CAJA, NOW);
    assert.equal(validated.ambito, 'negocio');
  });

  it('rechaza businessId vacío', () => {
    assert.throws(
      () => validateRegisterCashMovement(webUteCommand({ businessId: '' }), RILO_CAJA, NOW),
      (err: unknown) => err instanceof CashDomainError && err.code === 'INVALID_BUSINESS'
    );
  });
});

describe('Paridad Web vs WhatsApp (documento ERP)', () => {
  it('mismos campos de negocio para UTE $370 negocio', () => {
    const web = buildManualCashMovementDocument(
      validateRegisterCashMovement(webUteCommand(), RILO_CAJA, NOW),
      NOW.toISOString()
    );
    const wa = buildManualCashMovementDocument(
      validateRegisterCashMovement(
        webUteCommand({
          source: 'whatsapp',
          actor: { type: 'whatsapp_user', phone: '+59899000000' },
          descripcion: null,
        }),
        RILO_CAJA,
        NOW
      ),
      NOW.toISOString()
    );

    assert.deepEqual(pickCashErpBusinessFields(web as unknown as Record<string, unknown>), pickCashErpBusinessFields(wa as unknown as Record<string, unknown>));
    assert.equal(wa.origenWhatsapp, true);
    assert.equal(wa.whatsappPhone, '+59899000000');
    assert.equal(wa.source, 'whatsapp');
    assert.equal(web.origenWhatsapp, undefined);
    assert.equal(web.source, 'web');
  });
});
