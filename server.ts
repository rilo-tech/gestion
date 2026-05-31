import express from 'express';
import { createServer as createViteServer, loadEnv } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createApiApp } from './backend/create-app.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = createApiApp();
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    console.log('[dev] Iniciando Vite…');
    const viteMode = 'development';
    const viteEnv = loadEnv(viteMode, path.resolve(__dirname), '');
    for (const [key, value] of Object.entries(viteEnv)) {
      if (value !== undefined && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    const vite = await createViteServer({
      configFile: path.resolve(__dirname, 'vite.config.ts'),
      mode: viteMode,
      root: path.resolve(__dirname, 'frontend'),
      envDir: path.resolve(__dirname),
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[dev] Vite listo');
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
