import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assistantClaimsCompletedMutation,
  formatVerifiedRenameReply,
} from './v4-write-verify.ts';
import { appendListAskIfNumberedResults } from './v4-whatsapp-present.ts';
import { ensureListActionAsk, presentEntityList } from './conversation-query.ts';
import { freezeWriteCallsFromToolResults } from './agent/freeze-write-proposal.ts';

describe('write verify + list ask (AI-first hardening)', () => {
  it('detecta claims de mutación del LLM sin write', () => {
    assert.equal(assistantClaimsCompletedMutation('Renombré los 5 productos:\n1. X'), true);
    assert.equal(assistantClaimsCompletedMutation('Modifiqué el cliente'), true);
    assert.equal(assistantClaimsCompletedMutation('¿Querés que los renombre?'), false);
    assert.equal(assistantClaimsCompletedMutation('Encontré 5 productos'), false);
  });

  it('formatVerifiedRenameReply usa pasado + oferta', () => {
    const text = formatVerifiedRenameReply(['A', 'B', 'C']);
    assert.match(text, /✅ Listo, renombré los 3 productos/);
    assert.match(text, /1\. A/);
    assert.match(text, /Si querés hacer algún otro cambio/);
  });

  it('presentEntityList y listados numerados terminan con la frase centralizada', () => {
    const list = presentEntityList({
      title: '📦 Productos encontrados',
      lines: [
        '1. Remera Dry Negro L — stock 8',
        '2. Remera Dry Negro M — stock 8',
      ],
      shown: 2,
      total: 2,
      hasMore: false,
      emptyText: 'vacío',
    });
    assert.match(list, /Si no es ninguno, indicame el nombre con el que está guardado/);
    assert.equal((list.match(/Si no es ninguno/g) ?? []).length, 1);
    assert.equal((list.match(/Indicame qué producto/g) ?? []).length, 0);
    assert.equal(ensureListActionAsk(list, 'product'), list);

    const outbound = appendListAskIfNumberedResults(
      '*📦 Productos encontrados*\n\n1. Remera Dry Negro L\n2. Remera Dry Negro M\n\nIndicame qué ítem querés usar o qué querés hacer.'
    );
    assert.equal((outbound.match(/Si no es ninguno/g) ?? []).length, 1);
    assert.match(outbound, /Si no es ninguno, indicame el nombre con el que está guardado/);
  });

  it('freezeWrite se extrae del preview ready', () => {
    const calls = freezeWriteCallsFromToolResults([
      {
        toolCallId: '1',
        name: 'preview_rename_product',
        ok: true,
        output: {
          status: 'ready',
          freezeWrite: {
            tool: 'rename_products',
            args: { productIds: ['a', 'b'], newBaseName: 'Remera Polo Dry' },
          },
        },
      },
    ]);
    assert.equal(calls[0]?.name, 'rename_products');
    assert.deepEqual(calls[0]?.arguments.productIds, ['a', 'b']);
  });
});
