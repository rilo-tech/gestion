import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('createApiApp routers', () => {
  it('cada router de create-app.ts está importado', () => {
    const src = readFileSync(new URL('./create-app.ts', import.meta.url), 'utf8');
    const imported = new Set(
      [...src.matchAll(/^import (\w+) from '\.\/routes\//gm)].map((m) => m[1])
    );
    const used = [...src.matchAll(/use\([^,]+,\s*(\w+Routes)/g)].map((m) => m[1]);
    const missing = [...new Set(used)].filter((name) => !imported.has(name));
    assert.deepEqual(missing, []);
  });
});
