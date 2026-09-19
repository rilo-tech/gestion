/**
 * Deploy SOLO a rilo-staging.
 * Uso: npm run deploy:staging
 *
 * ABORT si el project resuelto es rilo-7eff4 (producción).
 * NO ejecutar sin autorización explícita del equipo.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  RILO_PRODUCTION_PROJECT_ID,
  RILO_STAGING_PROJECT_ID,
  assertStagingProjectOrThrow,
} from '../shared/rilo-environment.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function loadStagingEnv(): void {
  const candidates = ['.env.staging', `functions/.env.${RILO_STAGING_PROJECT_ID}`];
  for (const rel of candidates) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env) || process.env[key] === '') {
        process.env[key] = val;
      }
    }
  }
}

loadStagingEnv();
process.env.RILO_ENV = 'staging';
process.env.FIREBASE_PROJECT_ID = RILO_STAGING_PROJECT_ID;
process.env.GCLOUD_PROJECT = RILO_STAGING_PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = RILO_STAGING_PROJECT_ID;
delete process.env.USE_FIRESTORE_EMULATOR;

console.log('');
console.log('╔══════════════════════════════════════════════╗');
console.log('║   RILO DEPLOY → STAGING (rilo-staging)       ║');
console.log('║   Producción rilo-7eff4 = PROHIBIDA          ║');
console.log('╚══════════════════════════════════════════════╝');
console.log('');

try {
  assertStagingProjectOrThrow('deploy:staging');
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
}

if (
  process.env.FIREBASE_PROJECT_ID === RILO_PRODUCTION_PROJECT_ID ||
  process.env.GCLOUD_PROJECT === RILO_PRODUCTION_PROJECT_ID
) {
  console.error('[deploy:staging] ABORT: detectado proyecto de producción');
  process.exit(1);
}

function run(label: string, command: string, args: string[]): void {
  console.log(`\n[deploy:staging] ▶ ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: true,
  });
  if ((result.status ?? 1) !== 0) {
    console.error(`[deploy:staging] ✖ ${label}`);
    process.exit(result.status ?? 1);
  }
}

const firebaseBin = require.resolve('firebase-tools/lib/bin/firebase.js');

run('build frontend', 'npm', ['run', 'build']);
run('build functions', 'npm', ['run', 'build:functions']);
run('firebase deploy staging', process.execPath, [
  firebaseBin,
  'deploy',
  '--project',
  RILO_STAGING_PROJECT_ID,
  '--only',
  'hosting,functions,firestore:rules,storage',
]);

console.log('\n[deploy:staging] OK → STAGING only');
console.log(`[deploy:staging] project=${RILO_STAGING_PROJECT_ID}`);
