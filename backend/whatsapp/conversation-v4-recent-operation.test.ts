import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentOperationPlan } from './agent/tool-types.ts';
import {
  buildRecentOperationFromWrite,
  conversationPatchFromRecentOperation,
  formatRecentOperationForAgent,
  getFreshRecentOperation,
  isRecentOperationFresh,
  lookupQueryOverlapsRecentOperation,
  resolveRecentRecordIdByIndex,
  recoverRecentOperationFromState,
  RECENT_OPERATION_TTL_MS,
} from './v4-recent-operation.ts';
import type { ConversationState } from './conversation-state.ts';

function renamePlan(productIds: string[]): AgentOperationPlan {
  return {
    version: 'v4',
    planId: 'plan-rename',
    planVersion: 1,
    confirmationRequired: false,
    writes: [
      {
        tool: 'rename_products',
        label: 'rename',
        args: { productIds, newBaseName: 'Buzo Nuevo' },
      },
    ],
    summary: { title: 'Productos renombrados', lines: [] },
  };
}

describe('v4 recentOperation genérico', () => {
  it('write rename_products guarda entity/action/IDs ordenados y labels', () => {
    const recent = buildRecentOperationFromWrite(renamePlan(['p1', 'p2', 'p3', 'p4', 'p5']), {
      kind: 'product',
      action: 'rename',
      count: 5,
      productIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
      labels: ['A', 'B', 'C', 'D', 'E'],
    });
    assert.ok(recent);
    assert.equal(recent!.entityKind, 'product');
    assert.equal(recent!.action, 'rename');
    assert.deepEqual(recent!.recordIds, ['p1', 'p2', 'p3', 'p4', 'p5']);
    assert.deepEqual(recent!.labels, ['A', 'B', 'C', 'D', 'E']);
    assert.equal(resolveRecentRecordIdByIndex(recent, 3), 'p3');
    assert.equal(resolveRecentRecordIdByIndex(recent, 9), null);
  });

  it('conversationPatch write deja recentOperation + focus products + lastQueryResultIds', () => {
    const recent = buildRecentOperationFromWrite(renamePlan(['p1', 'p2', 'p3']), {
      kind: 'product',
      productIds: ['p1', 'p2', 'p3'],
      labels: ['Uno', 'Dos', 'Tres'],
      count: 3,
    });
    const patch = conversationPatchFromRecentOperation(recent!, null, { mode: 'write' });
    assert.deepEqual(patch.recentOperation?.recordIds, ['p1', 'p2', 'p3']);
    assert.deepEqual(patch.lastQueryResultIds, ['p1', 'p2', 'p3']);
    assert.equal(patch.focusEntities?.product?.id, 'p1');
    assert.equal(patch.focusEntities?.products?.length, 3);
    assert.equal(patch.focusEntities?.products?.[2]?.id, 'p3');
  });

  it('mode=list no enfoca el primer ítem (solo IDs referenciables)', () => {
    const recent = buildRecentOperationFromWrite(renamePlan(['p1', 'p2']), {
      kind: 'product',
      productIds: ['p1', 'p2'],
    });
    // reuse builder; force list semantics
    const listed = {
      ...recent!,
      action: 'list',
      tool: 'list_products',
    };
    const patch = conversationPatchFromRecentOperation(listed, null, { mode: 'list' });
    assert.deepEqual(patch.lastQueryResultIds, ['p1', 'p2']);
    assert.equal(patch.focusEntities, undefined);
    assert.equal(patch.lastPresentedEntities, undefined);
  });

  it('expira tras TTL y getFreshRecentOperation lo ignora', () => {
    const recent = buildRecentOperationFromWrite(renamePlan(['p1']), {
      kind: 'product',
      productIds: ['p1'],
    });
    assert.ok(isRecentOperationFresh(recent));
    const expired = {
      ...recent!,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    assert.equal(isRecentOperationFresh(expired), false);
    const state = {
      businessId: 'b1',
      phone: '+5981',
      recentOperation: expired,
      lastQueryResultIds: ['p1', 'p2', 'p3'],
      lastQuery: { intent: 'recent_product', slots: { entity: 'product', metric: 'rename' } },
      updatedAt: new Date().toISOString(),
    } as ConversationState;
    assert.equal(getFreshRecentOperation(state), null);
    const recovered = recoverRecentOperationFromState(state);
    assert.ok(recovered);
    assert.deepEqual(recovered!.recordIds, ['p1', 'p2', 'p3']);
    assert.ok(RECENT_OPERATION_TTL_MS >= 15 * 60 * 1000);
  });

  it('agent developer context expone recentOperation ordenado', () => {
    const recent = buildRecentOperationFromWrite(renamePlan(['p1', 'p2', 'p3']), {
      kind: 'product',
      productIds: ['p1', 'p2', 'p3'],
      labels: ['Rojo', 'Azul', 'Verde'],
    });
    assert.match(formatRecentOperationForAgent(recent), /recentOperation=entity:product/);
    assert.match(formatRecentOperationForAgent(recent), /1:p1\(Rojo\),2:p2\(Azul\),3:p3\(Verde\)/);
    assert.equal(formatRecentOperationForAgent(null), 'recentOperation=none');
  });

  it('flujo: modificar varios → listamelos usa mismos IDs; el tercero resuelve p3', () => {
    const afterWrite = conversationPatchFromRecentOperation(
      buildRecentOperationFromWrite(renamePlan(['p1', 'p2', 'p3', 'p4', 'p5']), {
        kind: 'product',
        productIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
        labels: ['N1', 'N2', 'N3', 'N4', 'N5'],
        count: 5,
      })!,
      null,
      { mode: 'write' }
    );
    const state = {
      businessId: 'b1',
      phone: '+5981',
      ...afterWrite,
      updatedAt: new Date().toISOString(),
    } as ConversationState;

    // "listamelos como quedaron" → tool con fromRecentOperation / mismos IDs
    const fresh = getFreshRecentOperation(state);
    assert.deepEqual(fresh?.recordIds, ['p1', 'p2', 'p3', 'p4', 'p5']);

    // "cambiá el tercero" → índice 3
    assert.equal(resolveRecentRecordIdByIndex(fresh, 3), 'p3');
    assert.equal(fresh?.labels?.[2], 'N3');
  });

  it('lookup overlap detecta prefijo compartido de labels', () => {
    const recent = buildRecentOperationFromWrite(renamePlan(['p1', 'p2']), {
      kind: 'product',
      productIds: ['p1', 'p2'],
      labels: ['Remera Polo Dry Negro L', 'Remera Polo Dry Negro M'],
      count: 2,
      action: 'rename',
    });
    assert.equal(lookupQueryOverlapsRecentOperation('Remera Polo Dry', recent), true);
    assert.equal(lookupQueryOverlapsRecentOperation('Zapatilla Nike', recent), false);
  });
});
