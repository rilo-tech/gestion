import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildFullOperationalToolRegistry,
  findAgentToolCatalogGaps,
  getToolByName,
  listRegistryToolNames,
} from './agent/tool-registry.ts';
import { WRITE_TOOLS } from './agent/tools/write-tools.ts';
import {
  EXECUTE_DIRECTLY_WRITE_TOOLS,
  NEEDS_CONFIRMATION_WRITE_TOOLS,
  writeToolDisposition,
} from './v4-write-disposition.ts';
import { isUnwiredCapability } from './capability-registry.ts';

describe('Agent tool catalog sync', () => {
  it('no deja writes implementados fuera del registry', () => {
    const gaps = findAgentToolCatalogGaps();
    assert.deepEqual(gaps, [], gaps.join('\n'));
  });

  it('expone rename_products, update_client, update_supplier, adjust_stock', () => {
    const names = listRegistryToolNames(buildFullOperationalToolRegistry());
    for (const name of ['rename_products', 'update_client', 'update_supplier', 'adjust_stock', 'set_stock']) {
      assert.ok(names.includes(name), `missing ${name}`);
    }
  });

  it('anota risk/entity en writes', () => {
    const rename = getToolByName('rename_products', buildFullOperationalToolRegistry());
    assert.equal(rename?.mode, 'write');
    assert.equal(rename?.risk, 'low');
    assert.equal(rename?.entity, 'product');
    assert.equal(writeToolDisposition('rename_products'), 'EXECUTE_DIRECTLY');

    const stock = getToolByName('adjust_stock', buildFullOperationalToolRegistry());
    assert.equal(stock?.risk, 'sensitive');
  });

  it('toda write tool tiene disposition explícita o default seguro', () => {
    for (const tool of WRITE_TOOLS) {
      const d = writeToolDisposition(tool.name);
      assert.ok(d === 'EXECUTE_DIRECTLY' || d === 'NEEDS_CONFIRMATION');
      if (d === 'EXECUTE_DIRECTLY') {
        assert.ok(EXECUTE_DIRECTLY_WRITE_TOOLS.has(tool.name), tool.name);
      }
      if (NEEDS_CONFIRMATION_WRITE_TOOLS.has(tool.name)) {
        assert.equal(d, 'NEEDS_CONFIRMATION');
      }
    }
  });

  it('capabilities de tools expuestas no se marcan unwired', () => {
    const registry = buildFullOperationalToolRegistry();
    for (const tool of registry) {
      if (tool.mode !== 'write') continue;
      assert.equal(
        isUnwiredCapability(tool.capability),
        false,
        `capability unwired: ${tool.name} → ${tool.capability}`
      );
    }
  });
});
