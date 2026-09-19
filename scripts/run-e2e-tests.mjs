/**
 * Levanta Firestore emulator si no hay uno, corre E2E, no apaga emulators ajenos.
 * Preferido desde test:release (emulator ya arriba). Standalone: npm run test:e2e
 * usa run-e2e-with-emulator.mjs.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.env.USE_FIRESTORE_EMULATOR = 'true';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_PROJECT_ID ??= 'demo-rilo';
process.env.GCLOUD_PROJECT ??= 'demo-rilo';
process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-rilo';
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', 'backend/e2e/release-gate.e2e.test.ts'],
  {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  }
);

process.exit(result.status ?? 1);
