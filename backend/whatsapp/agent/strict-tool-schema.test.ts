import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildToolRegistry } from './tool-registry.ts';
import { READ_TOOLS } from './tools/read-tools.ts';
import { WRITE_TOOLS } from './tools/write-tools.ts';
import {
  normalizeStrictToolArgs,
  validateStrictToolSchema,
} from './strict-tool-schema.ts';

describe('strict OpenAI tool schemas', () => {
  it('all V4 OpenAI tool schemas are strict-compatible', () => {
    const registry = buildToolRegistry();
    const issues = registry.flatMap((tool) => validateStrictToolSchema(tool));
    if (issues.length) {
      const detail = issues
        .map((row) => `${row.toolName}\n  ${row.path}\n  ${row.problem}${row.missing?.length ? `: ${row.missing.join(', ')}` : ''}`)
        .join('\n');
      assert.fail(`Invalid strict schemas:\n${detail}`);
    }
    assert.equal(issues.length, 0);
    assert.ok(registry.length > 0);
  });

  it('all registered tool definitions (including adapters) are strict-compatible', () => {
    const all = [...READ_TOOLS, ...WRITE_TOOLS];
    const issues = all.flatMap((tool) => validateStrictToolSchema(tool));
    assert.equal(issues.length, 0, JSON.stringify(issues, null, 2));
  });

  it('normalizeStrictToolArgs strips null without stringifying', () => {
    assert.deepEqual(
      normalizeStrictToolArgs({
        status: null,
        query: 'Acapella',
        limit: null,
        requestAll: null,
        nested: { dateFrom: null, dateTo: null, keep: 1 },
      }),
      {
        query: 'Acapella',
        nested: { keep: 1 },
      }
    );
    assert.equal(String(normalizeStrictToolArgs({ query: null }).query ?? ''), '');
  });
});
