import { onRequest } from 'firebase-functions/v2/https';
import { createApiApp } from '../../backend/create-app.ts';

const API_REGION = 'southamerica-east1';

let appPromise: ReturnType<typeof createApiApp> | null = null;

async function getApiApp() {
  appPromise ??= createApiApp();
  return appPromise;
}

export const api = onRequest(
  {
    region: API_REGION,
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (req, res) => {
    const app = await getApiApp();
    return app(req, res);
  }
);
