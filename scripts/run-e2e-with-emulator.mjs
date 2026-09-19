/**
 * Standalone E2E: arranca emulator + corre tests (misma estrategia que test:release).
 */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bin = require.resolve('firebase-tools/lib/bin/firebase.js');

function waitForPort(port, host = '127.0.0.1', timeoutMs = 120_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout esperando ${host}:${port}`));
          return;
        }
        setTimeout(tryOnce, 500);
      });
    };
    tryOnce();
  });
}

process.env.USE_FIRESTORE_EMULATOR = 'true';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_PROJECT_ID = 'demo-rilo';
process.env.GCLOUD_PROJECT = 'demo-rilo';
process.env.GOOGLE_CLOUD_PROJECT = 'demo-rilo';
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

console.log('[e2e] Starting Firestore emulator…');

const emu = spawn(
  process.execPath,
  [bin, 'emulators:start', '--only', 'firestore', '--project', 'demo-rilo'],
  { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
);

emu.stdout.on('data', (c) => process.stdout.write(c));
emu.stderr.on('data', (c) => process.stderr.write(c));

let shuttingDown = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (process.platform === 'win32' && emu.pid) {
    spawnSync('taskkill', ['/pid', String(emu.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    emu.kill('SIGTERM');
  }
  process.exit(code);
}

try {
  await waitForPort(8080);
  await new Promise((r) => setTimeout(r, 1500));
  const result = spawnSync(process.execPath, ['scripts/run-e2e-tests.mjs'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  await shutdown(result.status ?? 1);
} catch (err) {
  console.error('[e2e] FAILED', err);
  await shutdown(1);
}
