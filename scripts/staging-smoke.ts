/**
 * Smoke staging (solo lectura / GET).
 * Uso: npm run test:staging:smoke
 * Requiere APP_URL apuntando a staging. ABORT si URL/proyecto es producción.
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RILO_PRODUCTION_PROJECT_ID,
  RILO_STAGING_PROJECT_ID,
  assertStagingProjectOrThrow,
  resolveRiloEnvironment,
} from '../shared/rilo-environment.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(rel: string): void {
  const full = path.join(root, rel);
  if (fs.existsSync(full)) dotenv.config({ path: full, override: false });
}

loadEnvFile('.env.staging');
process.env.RILO_ENV = process.env.RILO_ENV || 'staging';

const base = (process.env.APP_URL || process.env.STAGING_APP_URL || '').replace(/\/$/, '');
if (!base) {
  console.error('[smoke] Falta APP_URL (staging). Ejemplo: https://rilo-staging.web.app');
  process.exit(1);
}
if (/rilo-7eff4/i.test(base)) {
  console.error('[smoke] ABORT: APP_URL apunta a producción');
  process.exit(1);
}

// Si hay credenciales de proyecto, exigir staging
if (process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT) {
  try {
    assertStagingProjectOrThrow('test:staging:smoke');
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: res.status, body };
}

function ok(label: string): void {
  console.log(`  ✔ ${label}`);
}
function fail(label: string, detail: string): never {
  console.error(`  ✖ ${label}: ${detail}`);
  process.exit(1);
}

console.log('[smoke] STAGING smoke');
console.log(`[smoke] APP_URL=${base}`);
console.log(`[smoke] env=${resolveRiloEnvironment()}`);

const front = await fetch(base);
if (!front.ok && front.status >= 500) fail('frontend', `HTTP ${front.status}`);
ok(`frontend HTTP ${front.status}`);

const health = await getJson(`${base}/api/health`);
if (health.status !== 200) fail('api health', `HTTP ${health.status}`);
const healthBody = health.body as { status?: string; environment?: string; projectId?: string };
if (healthBody?.projectId === RILO_PRODUCTION_PROJECT_ID) {
  fail('api health', 'projectId es producción');
}
ok(`api health status=${healthBody?.status} env=${healthBody?.environment ?? '?'}`);

const commercial = await getJson(`${base}/api/public/commercial?country=UY`);
if (commercial.status !== 200) fail('public commercial', `HTTP ${commercial.status}`);
ok('public commercial catalog');

// Auth config / login page should not 500
const loginPage = await fetch(`${base}/login`);
if (loginPage.status >= 500) fail('login route', `HTTP ${loginPage.status}`);
ok(`login route HTTP ${loginPage.status}`);

console.log('');
console.log('[smoke] PASS (checks básicos)');
console.log(`[smoke] Esperado hosting: https://${RILO_STAGING_PROJECT_ID}.web.app (cuando exista)`);
console.log('[smoke] Tenants QA / notices / capability-audit requieren auth → QA humano');
