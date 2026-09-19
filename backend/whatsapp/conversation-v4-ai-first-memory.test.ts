import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyLanguageMemory,
  formatLanguageMemoryPrompt,
  isLearnableExpression,
  type UserLanguageMemory,
} from './language-memory.ts';
import { buildAgentDeveloperContext } from './agent/agent-context.ts';
import type { ConversationState } from './conversation-state.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';

describe('AI-first low-risk: language memory on agent path', () => {
  const memory: UserLanguageMemory = {
    aliases: [
      {
        userExpression: 'dry coll',
        resolvedMeaning: 'dry cool',
        entityType: 'product_term',
        confidence: 0.95,
        confirmations: 2,
        lastUsedAt: '2026-09-08T12:00:00.000Z',
      },
      {
        userExpression: 'carlitos',
        resolvedMeaning: 'Carlos Textil',
        entityType: 'supplier',
        entityId: 'sup-1',
        confidence: 0.92,
        confirmations: 1,
        lastUsedAt: '2026-09-08T12:00:00.000Z',
      },
    ],
  };

  it('applyLanguageMemory reescribe términos confirmados', () => {
    assert.equal(applyLanguageMemory('una dry coll negra XL', memory), 'una dry cool negra XL');
    assert.equal(applyLanguageMemory('compré a carlitos', memory), 'compré a Carlos Textil');
  });

  it('formatLanguageMemoryPrompt entra al developer context', () => {
    const prompt = formatLanguageMemoryPrompt(memory);
    assert.match(prompt, /dry coll/);
    assert.match(prompt, /carlitos/);
    const ctx = buildAgentDeveloperContext(
      { businessId: 'rilo', phone: '+5981' } as WhatsappTenantContext,
      {
        businessId: 'rilo',
        phone: '+5981',
        updatedAt: new Date().toISOString(),
      } as ConversationState,
      { languageMemory: memory }
    );
    assert.match(ctx, /Memoria de CÓMO HABLA ESTE usuario/);
    assert.match(ctx, /dry coll/);
  });

  it('no aprende expresiones circunstanciales', () => {
    assert.equal(isLearnableExpression('hoy', 'Remera Dry'), false);
    assert.equal(isLearnableExpression('carlitos', 'Carlos Textil'), true);
  });
});

describe('AI-first: multipaso prompt cues', () => {
  it('system instruction pide combinar tools y no inventar', async () => {
    const { RILOBOT_V4_SYSTEM_INSTRUCTION } = await import('./agent/agent-context.ts');
    assert.match(RILOBOT_V4_SYSTEM_INSTRUCTION, /multipaso/i);
    assert.match(RILOBOT_V4_SYSTEM_INSTRUCTION, /no inventes/i);
    assert.match(RILOBOT_V4_SYSTEM_INSTRUCTION, /NO lo vuelvas a pedir/i);
    assert.match(RILOBOT_V4_SYSTEM_INSTRUCTION, /dale|perfecto|mandale/i);
  });
});
