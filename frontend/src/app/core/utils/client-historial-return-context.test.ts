import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildClientHistorialReturnQueryParams,
  clientHistorialRoute,
  parseClientHistorialReturnContext,
} from './client-historial-return-context.ts';

function paramMap(values: Record<string, string>) {
  return {
    get: (key: string) => values[key] ?? null,
  };
}

describe('client historial return context', () => {
  it('parses returnTo=client-historial with clienteId', () => {
    const ctx = parseClientHistorialReturnContext(
      paramMap({ returnTo: 'client-historial', clienteId: 'c1' }) as never
    );
    assert.deepEqual(ctx, { clientId: 'c1' });
  });

  it('builds query params for venta deep-link', () => {
    const params = buildClientHistorialReturnQueryParams('c1', { ventaId: 'v9' });
    assert.equal(params.returnTo, 'client-historial');
    assert.equal(params.clienteId, 'c1');
    assert.equal(params.ventaId, 'v9');
  });

  it('builds historial route', () => {
    assert.deepEqual(clientHistorialRoute('abc'), ['/clients', 'abc', 'historial']);
  });
});
