/**
 * Eval manual con OpenAI real. No corre en CI por defecto.
 *
 * Uso:
 *   OPENAI_API_KEY=... RILOBOT_AI_PROVIDER=openai tsx scripts/eval-rilobot-v4-live.ts
 */
import 'dotenv/config';
import { createConversationAgent } from '../backend/whatsapp/agent/conversation-agent.ts';
import type { WhatsappTenantContext } from '../backend/whatsapp/tenant-resolver.ts';

const tenant: WhatsappTenantContext = {
  businessId: process.env.RILOBOT_EVAL_BUSINESS_ID ?? 'rilo',
  phone: process.env.RILOBOT_EVAL_PHONE ?? '+59899000000',
  rubro: 'indumentaria',
  platformAccess: {
    whatsappEnabled: true,
    aiEnabled: true,
    erpWebEnabled: true,
    whatsappOperationalStatus: 'active',
  } as WhatsappTenantContext['platformAccess'],
};

const prompts = [
  'mostrame los pedidos de Acapella',
  'solo los pendientes',
  'de agosto',
  'el primero cuánto debe?',
  'cobrá 500 y ponelo listo',
];

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Falta OPENAI_API_KEY');
    process.exit(1);
  }
  process.env.RILOBOT_AI_PROVIDER = 'openai';
  const agent = createConversationAgent();
  let state = null;
  for (const text of prompts) {
    console.log('\nUSER:', text);
    const result = await agent.runTurn({ tenant, state, text });
    console.log('BOT:', result.reply);
    console.log('TOOLS:', result.toolCalls?.map((row) => `${row.name}(${JSON.stringify(row.arguments)})`).join(' -> '));
    if (result.statePatch) {
      state = { ...(state ?? { businessId: tenant.businessId, phone: tenant.phone, updatedAt: new Date().toISOString() }), ...result.statePatch };
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
