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

let bootstrapPromise: Promise<void> | null = null;

async function ensureApiBootstrap(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await ensureDefaultPlatformAdmin();
      await ensureDefaultPlans();
      if (process.env.SKIP_DEFAULT_BUSINESS !== 'true') {
        await ensureDefaultBusiness();
        await ensureDefaultSupervisor();
      }
    })();
  }
  await bootstrapPromise;
}

/** Express app con solo rutas /api (sin Vite ni estáticos). */
export async function createApiApp(): Promise<express.Express> {
  await ensureApiBootstrap();

  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json());

  app.use('/api/auth', authRoutes);
  app.use('/api/platform', platformRoutes);
  app.use('/api/business', businessRoutes);
  app.use('/api/clients', clientRoutes);
  app.use('/api/suppliers', supplierRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/stock', stockRoutes);
  app.use('/api/purchases', purchaseRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/sales', salesRoutes);
  app.use('/api/cash', cashRoutes);
  app.use('/api/config', catalogConfigRoutes);
  app.use('/api/price-catalog', priceCatalogRoutes);
  app.use('/api/payables', payablesRoutes);
  app.use('/api/activity', activityRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/collaborators', collaboratorsRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', message: 'RILO Gestión API is running' });
  });

  return app;
}
