import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { createApiApp } from '../../backend/create-app.ts';
import { purgeOrderPhotos } from './purge-order-photos.ts';

const API_REGION = 'southamerica-east1';

const geminiApiKey = defineString('GEMINI_API_KEY', { default: '' });
const whatsappWebhookVerifyToken = defineString('WHATSAPP_WEBHOOK_VERIFY_TOKEN', {
  default: 'rilo-dev-verify',
});
const whatsappAccessToken = defineString('WHATSAPP_ACCESS_TOKEN', { default: '' });
const whatsappPhoneNumberId = defineString('WHATSAPP_PHONE_NUMBER_ID', { default: '' });
const whatsappAppSecret = defineString('WHATSAPP_APP_SECRET', { default: '' });

void [
  geminiApiKey,
  whatsappWebhookVerifyToken,
  whatsappAccessToken,
  whatsappPhoneNumberId,
  whatsappAppSecret,
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
