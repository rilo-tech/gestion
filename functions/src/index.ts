import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { createApiApp } from '../../backend/create-app.ts';
import { purgeOrderPhotos } from './purge-order-photos.ts';

const API_REGION = 'southamerica-east1';

/** Secret Manager — no usar OPENAI_API_KEY en .env de functions. */
const openaiApiKey = defineSecret('OPENAI_API_KEY');

const geminiApiKey = defineString('GEMINI_API_KEY', { default: '' });
const whatsappWebhookVerifyToken = defineString('WHATSAPP_WEBHOOK_VERIFY_TOKEN', {
  default: 'rilo-dev-verify',
});
const whatsappAccessToken = defineString('WHATSAPP_ACCESS_TOKEN', { default: '' });
const whatsappPhoneNumberId = defineString('WHATSAPP_PHONE_NUMBER_ID', { default: '' });
const whatsappAppSecret = defineString('WHATSAPP_APP_SECRET', { default: '' });

const rilobotConversationEngine = defineString('RILOBOT_CONVERSATION_ENGINE', {
  default: 'v4',
});
const rilobotV4Tenants = defineString('RILOBOT_V4_TENANTS', { default: 'rilo' });
const rilobotAiProvider = defineString('RILOBOT_AI_PROVIDER', { default: 'openai' });
const openaiRilobotModel = defineString('OPENAI_RILOBOT_MODEL', { default: 'gpt-5.6-terra' });
const openaiRilobotFallbackModel = defineString('OPENAI_RILOBOT_FALLBACK_MODEL', {
  default: 'gpt-5.6-luna',
});
const openaiRilobotReasoningEffort = defineString('OPENAI_RILOBOT_REASONING_EFFORT', {
  default: 'low',
});

void [
  openaiApiKey,
  geminiApiKey,
  whatsappWebhookVerifyToken,
  whatsappAccessToken,
  whatsappPhoneNumberId,
  whatsappAppSecret,
  rilobotConversationEngine,
  rilobotV4Tenants,
  rilobotAiProvider,
  openaiRilobotModel,
  openaiRilobotFallbackModel,
  openaiRilobotReasoningEffort,
];

let apiApp: ReturnType<typeof createApiApp> | null = null;

function getApiApp() {
  apiApp ??= createApiApp();
  return apiApp;
}

export { purgeOrderPhotos };

export const api = onRequest(
  {
    region: API_REGION,
    timeoutSeconds: 120,
    memory: '512MiB',
    invoker: 'public',
    secrets: [openaiApiKey],
    // RiloBot order create/modify: pedido + cobro + caja in one batch.
  },
  async (req, res) => {
    if (req.path.includes('webhooks/whatsapp') || req.url.includes('webhooks/whatsapp')) {
      console.log('[whatsapp] HTTP', {
        method: req.method,
        url: req.url,
        originalUrl: req.originalUrl,
        path: req.path,
        bodyType: typeof req.body,
        hasMessages: Boolean((req.body as { entry?: unknown[] })?.entry),
      });
    }
    const app = getApiApp();
    return app(req, res);
  }
);
