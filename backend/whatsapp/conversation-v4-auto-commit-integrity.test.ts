import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  agentErrorReply,
  isInternalErrorLeak,
  sanitizeUserFacingErrorMessage,
} from './agent/agent-errors.ts';
import {
  decidePreparedWriteExecution,
  planAllowsAutoCommit,
  planNeedsConfirmation,
} from './v4-write-disposition.ts';
import { planAllowsAutoCommit as planAllowsAutoCommitFromAutoCommit } from './v4-auto-commit.ts';
import { mapFrozenWriteError } from './v4-confirm.ts';
import type { AgentOperationPlan } from './agent/tool-types.ts';

const here = dirname(fileURLToPath(import.meta.url));

function plan(writes: AgentOperationPlan['writes']): AgentOperationPlan {
  return {
    version: 'v4',
    writes,
    summary: { title: 't', lines: [] },
    rawUserMessage: 'x',
  };
}

describe('Auto-commit gate integrity', () => {
  it('planAllowsAutoCommit está definida y es la misma vía auto-commit reexport', () => {
    assert.equal(typeof planAllowsAutoCommit, 'function');
    assert.equal(planAllowsAutoCommit, planAllowsAutoCommitFromAutoCommit);
    assert.equal(typeof decidePreparedWriteExecution, 'function');
  });

  it('openai-agent importa planAllowsAutoCommit desde v4-write-disposition', () => {
    const src = readFileSync(join(here, 'agent', 'openai-agent.ts'), 'utf8');
    assert.match(
      src,
      /import\s*\{\s*planAllowsAutoCommit\s*\}\s*from\s*['\"]\.\.\/v4-write-disposition\.ts['\"]/
    );
    assert.match(src, /planAllowsAutoCommit\s*\(/);
  });

  it('handle-v4-turn importa planAllowsAutoCommit desde disposition (no implícito)', () => {
    const src = readFileSync(join(here, 'handle-v4-turn.ts'), 'utf8');
    assert.match(
      src,
      /import\s*\{[^}]*planAllowsAutoCommit[^}]*\}\s*from\s*['\"]\.\/v4-write-disposition\.ts['\"]/
    );
  });

  it('rename-only → auto-commit; cash → confirmación', () => {
    assert.equal(
      planAllowsAutoCommit(
        plan([{ tool: 'rename_products', label: 'r', args: { productIds: ['a'], newBaseName: 'X' } }])
      ),
      true
    );
    assert.equal(
      decidePreparedWriteExecution(
        plan([{ tool: 'rename_products', label: 'r', args: { productIds: ['a'], newBaseName: 'X' } }])
      ),
      'EXECUTE_DIRECTLY'
    );
    assert.equal(
      planNeedsConfirmation(
        plan([{ tool: 'register_cash_movement', label: 'c', args: { amount: 10 } }])
      ),
      true
    );
  });
});

describe('Errores técnicos no llegan a WhatsApp', () => {
  it('ReferenceError planAllowsAutoCommit se sanitiza', () => {
    const err = new ReferenceError('planAllowsAutoCommit is not defined');
    assert.equal(isInternalErrorLeak(err), true);
    const reply = agentErrorReply(err);
    assert.match(reply, /No pude completar ese cambio/);
    assert.doesNotMatch(reply, /planAllowsAutoCommit|ReferenceError|is not defined/);
  });

  it('mapFrozenWriteError oculta runtime internals', () => {
    const mapped = mapFrozenWriteError(new ReferenceError('planAllowsAutoCommit is not defined'));
    assert.equal(mapped.code, 'ERP_WRITE_FAILED');
    assert.doesNotMatch(mapped.reply, /planAllowsAutoCommit|ReferenceError/);
  });

  it('sanitizeUserFacingErrorMessage bloquea leaks de tool/capability', () => {
    assert.match(sanitizeUserFacingErrorMessage('La tool rename_products no está habilitada.'), /No pude completar/);
    assert.match(sanitizeUserFacingErrorMessage('capability missing'), /No pude completar/);
  });
});
