import { onRequest } from 'firebase-functions/v2/https';
import { createApiApp } from '../../backend/create-app.ts';
import { purgeOrderPhotos } from './purge-order-photos.ts';

const API_REGION = 'southamerica-east1';

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
  },
  async (req, res) => {
    const app = getApiApp();
    return app(req, res);
  }
);
