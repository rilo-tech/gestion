import type { ConversationAgent } from './tool-types.ts';
import { OpenAIConversationAgent } from './openai-agent.ts';

export function createConversationAgent(): ConversationAgent {
  const provider = String(process.env.RILOBOT_AI_PROVIDER ?? 'openai').trim().toLowerCase();
  if (provider !== 'openai') {
    throw new Error(`V4 requiere RILOBOT_AI_PROVIDER=openai (actual: ${provider || 'unset'})`);
  }
  return new OpenAIConversationAgent();
}

export { OpenAIConversationAgent, MockConversationAgent } from './openai-agent.ts';
