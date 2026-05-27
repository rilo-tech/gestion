import angular from '@analogjs/vite-plugin-angular';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  return {
    root: 'frontend',
    // Single .env at repo root (same as server.ts dotenv) — not frontend/.env
    envDir: path.resolve(__dirname),
    plugins: [
      angular({
        tsconfig: path.resolve(__dirname, 'tsconfig.app.json'),
      }),
      tailwindcss(),
    ],
    resolve: {
      mainFields: ['module'],
      alias: {
        '@': path.resolve(__dirname, './frontend/src'),
      },
    },
    build: {
      outDir: '../dist',
      emptyOutDir: true,
      target: 'es2022',
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true,
      hmr:
        process.env.DISABLE_HMR === 'true'
          ? false
          : {
              port: Number(process.env.VITE_HMR_PORT) || 24678,
            }
    }
  };
});
