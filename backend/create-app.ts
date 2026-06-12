import express from 'express';
import cors from 'cors';
import clientRoutes from './routes/clients.ts';
import stockRoutes from './routes/stock.ts';
import purchaseRoutes from './routes/purchases.ts';
import orderRoutes from './routes/orders.ts';
import salesRoutes from './routes/sales.ts';
import cashRoutes from './routes/cash.ts';
import catalogConfigRoutes from './routes/catalog-config.ts';
import priceCatalogRoutes from './routes/price-catalog.ts';
import supplierRoutes from './routes/suppliers.ts';
import userRoutes from './routes/users.ts';
import authRoutes from './routes/auth.ts';
import businessRoutes from './routes/business.ts';
import platformRoutes from './routes/platform.ts';
import payablesRoutes from './routes/payables.ts';
import activityRoutes from './routes/activity.ts';
import reportsRoutes from './routes/reports.ts';
import collaboratorsRoutes from './routes/collaborators.ts';
import { ensureDefaultSupervisor } from './auth/users.ts';
import { ensureDefaultBusiness } from './auth/business.ts';
import { ensureDefaultPlatformAdmin } from './auth/platform.ts';
import { ensureDefaultPlans } from './auth/plans.ts';

const BOOTSTRAP_TIMEOUT_MS = 45_000;

let bootstrapPromise: Promise<void> | null = null;
let bootstrapState: 'idle' | 'running' | 'ready' | 'failed' = 'idle';

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Timeout al iniciar ${label} (${BOOTSTRAP_TIMEOUT_MS}ms). Revisá Firebase o el emulador.`
          )
        );
      }, BOOTSTRAP_TIMEOUT_MS);
    }),
  ]);
}

export function runApiBootstrap(): Promise<void> {
  if (bootstrapState === 'ready') {
    return Promise.resolve();
  }

  if (!bootstrapPromise) {
    bootstrapState = 'running';
    bootstrapPromise = (async () => {
      console.log('[api] Bootstrap iniciando…');
      await withTimeout(ensureDefaultPlatformAdmin(), 'platform admin');
      await withTimeout(ensureDefaultPlans(), 'planes');
      if (process.env.SKIP_DEFAULT_BUSINESS !== 'true') {
        await withTimeout(ensureDefaultBusiness(), 'empresa demo');
        await withTimeout(ensureDefaultSupervisor(), 'supervisor demo');
      }
      bootstrapState = 'ready';
      console.log('[api] Bootstrap listo');
    })().catch((err) => {
      bootstrapState = 'failed';
      bootstrapPromise = null;
      console.error('[api] Bootstrap falló:', err);
      throw err;
    });
  }

  return bootstrapPromise;
}

export function getApiBootstrapState(): 'idle' | 'running' | 'ready' | 'failed' {
  return bootstrapState;
}

/** Express app con solo rutas /api (sin Vite ni estáticos). */
export function createApiApp(): express.Express {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: bootstrapState === 'ready' ? 'ok' : bootstrapState,
      bootstrap: bootstrapState,
      message: 'RILO Gestión API is running',
    });
  });

  const withBootstrap: express.RequestHandler = async (_req, res, next) => {
    try {
      await runApiBootstrap();
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bootstrap failed';
      res.status(503).json({
        error: `Servicio no disponible: ${message}`,
      });
    }
  };

  const api = express.Router();
  api.use('/auth', authRoutes);
  api.use('/platform', platformRoutes);
  api.use('/business', businessRoutes);
  api.use('/clients', clientRoutes);
  api.use('/suppliers', supplierRoutes);
  api.use('/users', userRoutes);
  api.use('/stock', stockRoutes);
  api.use('/purchases', purchaseRoutes);
  api.use('/orders', orderRoutes);
  api.use('/sales', salesRoutes);
  api.use('/cash', cashRoutes);
  api.use('/config', catalogConfigRoutes);
  api.use('/price-catalog', priceCatalogRoutes);
  api.use('/payables', payablesRoutes);
  api.use('/activity', activityRoutes);
  api.use('/reports', reportsRoutes);
  api.use('/collaborators', collaboratorsRoutes);

  app.use('/api', withBootstrap, api);

  void runApiBootstrap().catch(() => {
    // El error ya se registró; las rutas /api responderán 503 hasta que arranque.
  });

  return app;
}
