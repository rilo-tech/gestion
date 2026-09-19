/**
 * Release gate: suites (sin forzar emulator) → E2E con Firestore emulator → builds.
 * Uso: npm run test:release
 *
 * Requisitos E2E:
 * - Firebase CLI (firebase-tools)
 * - Java 11+ para Firestore emulator
 *
 * No cambia configuración de producción.
 */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function runStep(label, command, args, env = process.env) {
  console.log(`\n[release] ▶ ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: true,
  });
  if ((result.status ?? 1) !== 0) {
    console.error(`[release] ✖ ${label} exit=${result.status}`);
    process.exit(result.status ?? 1);
  }
  console.log(`[release] ✔ ${label}`);
}

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

// Suites unit/V4: no forzar emulator vacío (usan .env / mocks).
const suitesEnv = { ...process.env };
delete suitesEnv.USE_FIRESTORE_EMULATOR;
delete suitesEnv.FIRESTORE_EMULATOR_HOST;
// Evitar leftover demo-rilo de corridas E2E previas en el mismo shell.
if (suitesEnv.FIREBASE_PROJECT_ID === 'demo-rilo') delete suitesEnv.FIREBASE_PROJECT_ID;
if (suitesEnv.GCLOUD_PROJECT === 'demo-rilo') delete suitesEnv.GCLOUD_PROJECT;
if (suitesEnv.GOOGLE_CLOUD_PROJECT === 'demo-rilo') delete suitesEnv.GOOGLE_CLOUD_PROJECT;

runStep('suites', 'npm', ['run', 'test:release:suites'], suitesEnv);

const bin = require.resolve('firebase-tools/lib/bin/firebase.js');
const emuEnv = {
  ...process.env,
  USE_FIRESTORE_EMULATOR: 'true',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_PROJECT_ID: 'demo-rilo',
  GCLOUD_PROJECT: 'demo-rilo',
  GOOGLE_CLOUD_PROJECT: 'demo-rilo',
};
delete emuEnv.GOOGLE_APPLICATION_CREDENTIALS;

console.log('\n[release] Starting Firestore emulator for E2E…');
const emu = spawn(
  process.execPath,
  [bin, 'emulators:start', '--only', 'firestore', '--project', 'demo-rilo'],
  { cwd: root, env: emuEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
);
emu.stdout.on('data', (c) => process.stdout.write(c));
emu.stderr.on('data', (c) => process.stderr.write(c));

let shuttingDown = false;
async function shutdownEmu() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (process.platform === 'win32' && emu.pid) {
    spawnSync('taskkill', ['/pid', String(emu.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    emu.kill('SIGTERM');
  }
}

try {
  await waitForPort(8080);
  await new Promise((r) => setTimeout(r, 1500));
  Object.assign(process.env, emuEnv);
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  runStep('e2e', 'node', ['scripts/run-e2e-tests.mjs'], emuEnv);
  await shutdownEmu();
  runStep('frontend build', 'npm', ['run', 'build'], suitesEnv);
  runStep('functions build', 'npm', ['run', 'build:functions'], suitesEnv);
  console.log('\n[release] ALL STEPS PASSED');
  process.exit(0);
} catch (err) {
  console.error('[release] FAILED', err);
  await shutdownEmu();
  process.exit(1);
}
