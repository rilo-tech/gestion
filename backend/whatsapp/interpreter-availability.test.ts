import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  INTERPRETER_UNAVAILABLE_REPLY,
  classifyInterpreterError,
  interpreterCircuitIsOpen,
  interpreterModelChain,
  interpreterTimeoutMs,
  isInterpreterTechnicalFailure,
  isRetryableInterpreterFailure,
  noteInterpreterFailure,
  noteInterpreterSuccess,
  resetInterpreterCircuitForTests,
} from './interpreter-availability.ts';

afterEach(() => {
  resetInterpreterCircuitForTests();
  delete process.env.GEMINI_WHATSAPP_MODEL;
  delete process.env.GEMINI_WHATSAPP_FALLBACK_MODEL;
  delete process.env.GEMINI_INTERPRETER_MODEL;
  delete process.env.GEMINI_INTERPRETER_FALLBACK_MODEL;
  delete process.env.GEMINI_INTERPRETER_TIMEOUT_MS;
  delete process.env.GEMINI_INTERPRETER_RETRY_TIMEOUT_MS;
});

describe('Interpreter availability', () => {
  it('timeout y 429 no son unknown semántico', () => {
    assert.equal(isInterpreterTechnicalFailure(undefined), false);
    assert.equal(classifyInterpreterError(new Error('rilobot-interpreter timeout')).kind, 'INTERPRETER_TIMEOUT');
    assert.equal(classifyInterpreterError({ status: 429, message: 'RESOURCE_EXHAUSTED' }).kind, 'INTERPRETER_RATE_LIMITED');
    assert.equal(classifyInterpreterError({ status: 503, message: 'UNAVAILABLE' }).kind, 'INTERPRETER_UNAVAILABLE');
  });

  it('retry solo en errores recuperables', () => {
    const timeout = {
      kind: 'INTERPRETER_TIMEOUT' as const,
      provider: 'gemini',
      model: 'x',
      durationMs: 1,
      retry: false,
      fallbackUsed: false,
      errorType: 'timeout',
      httpStatus: null,
    };
    const invalid = { ...timeout, kind: 'INTERPRETER_INVALID_RESPONSE' as const, errorType: 'schema_invalid' };
    const badKey = { ...timeout, kind: 'INTERPRETER_MISSING_KEY' as const, errorType: 'missing_key' };
    const four = { ...timeout, kind: 'INTERPRETER_UNAVAILABLE' as const, errorType: 'http_4xx', httpStatus: 400 };
    assert.equal(isRetryableInterpreterFailure(timeout), true);
    assert.equal(isRetryableInterpreterFailure(invalid), false);
    assert.equal(isRetryableInterpreterFailure(badKey), false);
    assert.equal(isRetryableInterpreterFailure(four), false);
  });

  it('respuesta de fallo técnico no pide aclaración de intent', () => {
    assert.match(INTERPRETER_UNAVAILABLE_REPLY, /procesar/i);
    assert.doesNotMatch(INTERPRETER_UNAVAILABLE_REPLY, /pedido nuevo/i);
    assert.doesNotMatch(INTERPRETER_UNAVAILABLE_REPLY, /cobro/i);
    assert.doesNotMatch(INTERPRETER_UNAVAILABLE_REPLY, /anotado/i);
  });

  it('fallback de modelo solo si está en env', () => {
    process.env.GEMINI_WHATSAPP_MODEL = 'gemini-3.5-flash-lite';
    assert.deepEqual(interpreterModelChain(), { primary: 'gemini-3.5-flash-lite', fallback: null });
    process.env.GEMINI_WHATSAPP_FALLBACK_MODEL = 'gemini-flash-latest';
    assert.deepEqual(interpreterModelChain(), {
      primary: 'gemini-3.5-flash-lite',
      fallback: 'gemini-flash-latest',
    });
  });

  it('timeouts por env con default 20s / 15s', () => {
    assert.equal(interpreterTimeoutMs('primary'), 20000);
    assert.equal(interpreterTimeoutMs('retry'), 15000);
  });

  it('circuit breaker simple', () => {
    const now = 1_000_000;
    noteInterpreterFailure(now);
    noteInterpreterFailure(now);
    assert.equal(interpreterCircuitIsOpen(now), false);
    noteInterpreterFailure(now);
    assert.equal(interpreterCircuitIsOpen(now), true);
    noteInterpreterSuccess();
    assert.equal(interpreterCircuitIsOpen(now), false);
  });
});
