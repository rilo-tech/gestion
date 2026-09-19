import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildRenamePreview,
  filterVariantsByConstraints,
  type ProductVariantRow,
} from '../domain/stock/product-rename-service.ts';
import { buildRecentOperationFromWrite } from './v4-recent-operation.ts';
import type { AgentOperationPlan } from './agent/tool-types.ts';

function variant(partial: Partial<ProductVariantRow> & { id: string; name: string }): ProductVariantRow {
  return {
    nombreBase: partial.nombreBase ?? 'Remera Dry',
    color: partial.color ?? 'Negro',
    talle: partial.talle ?? 'L',
    stock: partial.stock ?? 1,
    price: partial.price ?? 100,
    cost: partial.cost ?? 50,
    ...partial,
  };
}

describe('rename persistence contract', () => {
  it('preview ready incluye selectedIds ordenados (fuente de verdad del write)', () => {
    const selected = [
      variant({ id: 'p1', name: 'Remera Dry Negro L', talle: 'L' }),
      variant({ id: 'p2', name: 'Remera Dry Negro M', talle: 'M' }),
      variant({ id: 'p3', name: 'Remera Dry Negro XL', talle: 'XL' }),
    ];
    const preview = buildRenamePreview({
      variants: selected,
      selected,
      oldBaseName: 'Remera Dry',
      newBaseName: 'Remera Polo Dry',
      scope: 'matching_variants',
    });
    assert.equal(preview.status, 'ready');
    assert.deepEqual(preview.selectedIds, ['p1', 'p2', 'p3']);
    assert.equal(preview.previewNames.length, 3);
    assert.match(preview.previewNames[0]!.to, /Polo Dry/);
  });

  it('filterVariantsByConstraints no inventa filas', () => {
    const rows = [
      variant({ id: 'p1', name: 'A Negro L', color: 'Negro', talle: 'L' }),
      variant({ id: 'p2', name: 'A Rojo L', color: 'Rojo', talle: 'L' }),
    ];
    const filtered = filterVariantsByConstraints(rows, { colors: ['Negro'] });
    assert.deepEqual(
      filtered.map((row) => row.id),
      ['p1']
    );
  });

  it('éxito de write exige mismos IDs en recentOperation (no solo texto)', () => {
    const plan: AgentOperationPlan = {
      version: 'v4',
      planId: 'p',
      planVersion: 1,
      confirmationRequired: false,
      writes: [
        {
          tool: 'rename_products',
          label: 'r',
          args: { productIds: ['a', 'b', 'c', 'd', 'e'], newBaseName: 'Remera Polo Dry' },
        },
      ],
      summary: { title: 'ok', lines: [] },
    };
    const recent = buildRecentOperationFromWrite(plan, {
      kind: 'product',
      action: 'rename',
      persisted: true,
      count: 5,
      productIds: ['a', 'b', 'c', 'd', 'e'],
      labels: [
        'Remera Polo Dry Negro L',
        'Remera Polo Dry Negro M',
        'Remera Polo Dry Negro XL',
        'Remera Polo Dry Negro XS',
        'Remera Polo Dry Negro XXL',
      ],
    });
    assert.ok(recent);
    assert.equal(recent!.recordIds.length, 5);
    assert.equal(recent!.action, 'rename');
    assert.equal(recent!.labels?.[2], 'Remera Polo Dry Negro XL');
  });

  it('sin productIds persistidos no arma recent vacío silencioso desde data hueca', () => {
    const plan: AgentOperationPlan = {
      version: 'v4',
      planId: 'p',
      planVersion: 1,
      confirmationRequired: false,
      writes: [{ tool: 'rename_products', label: 'r', args: { productIds: ['x'], newBaseName: 'Y' } }],
      summary: { title: 'ok', lines: [] },
    };
    // data sin ids → cae a writeArgs.productIds
    const recent = buildRecentOperationFromWrite(plan, { kind: 'product', count: 0 });
    assert.ok(recent);
    assert.deepEqual(recent!.recordIds, ['x']);
  });
});
