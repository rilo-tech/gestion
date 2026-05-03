import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
import clientRoutes from './backend/routes/clients.ts';
import stockRoutes from './backend/routes/stock.ts';
import orderRoutes from './backend/routes/orders.ts';
import salesRoutes from './backend/routes/sales.ts';
import cashRoutes from './backend/routes/cash.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Firebase Admin Setup (Server-side)
  // For this environment, we'll try to use the project ID from the config
  // In a real production apps, you'd use a service account key
  // But here we can often rely on the environment's default credentials if in Cloud Run
  // Or we can use the config file for client-side and process.env.GEMINI_API_KEY for AI tasks
  
  // NOTE: firebase-admin initialization might need a service account in some environments
  // Since we don't have one provided, we'll use a placeholder or check if we can use default
  // Actually, for AI Studio's Firestore, it's often easier to use the Client SDK even in the backend
  // OR if we use firebase-admin, we might need to set it up specifically.
  // Given the constraints, I'll provide a structure that can be easily configured.

  // API Routes
  app.use('/api/clients', clientRoutes);
  app.use('/api/stock', stockRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/sales', salesRoutes);
  app.use('/api/cash', cashRoutes);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'RILO Gestión API is running' });
  });

  // Example API route for Clients
  app.get('/api/clients', (req, res) => {
    res.json([{ id: '1', nombre: 'Cliente Ejemplo' }]);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      configFile: path.resolve(__dirname, 'vite.config.ts'),
      mode: 'development',
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\nPuerto ${PORT} ocupado (otro npm run dev o proceso Node). Opciones:\n` +
          `  • Cerrá esa terminal o: Get-NetTCPConnection -LocalPort ${PORT},24678 -State Listen | Select -Expand OwningProcess -Unique | % { Stop-Process -Id $_ -Force }\n` +
          `  • Otra instancia: $env:PORT="3001"; $env:VITE_HMR_PORT="24679"; npm run dev\n`
      );
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}

startServer();
