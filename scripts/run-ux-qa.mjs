/**
 * Runner npm run test:ux
 * - Asegura dist/ (build si falta)
 * - Limpia scenario-results.ndjson
 * - Playwright UX suite
 * - Genera UX_QA_RILO.md
 * NO toca producción.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = path.join(root, 'dist', 'index.html');
const artifactDir = path.join(root, 'qa-artifacts', 'ux');
const ndjson = path.join(artifactDir, 'scenario-results.ndjson');

fs.mkdirSync(artifactDir, { recursive: true });
if (fs.existsSync(ndjson)) fs.unlinkSync(ndjson);

function run(cmd, args, opts = {}) {
  console.log(`[test:ux] $ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  return r.status ?? 1;
}

if (!process.env.UX_BASE_URL) {
  if (!fs.existsSync(distIndex)) {
    console.log('[test:ux] dist/ ausente → npm run build');
    const buildCode = run('npm', ['run', 'build']);
    if (buildCode !== 0) process.exit(buildCode);
  } else {
    console.log('[test:ux] Reutilizando dist/ existente');
  }
} else {
  console.log(`[test:ux] UX_BASE_URL=${process.env.UX_BASE_URL} (sin vite preview)`);
}

const pw = run('npx', [
  'playwright',
  'test',
  '-c',
  'playwright.ux.config.ts',
  ...(process.env.UX_PROJECT ? [`--project=${process.env.UX_PROJECT}`] : []),
]);

// Generar reporte aunque haya fallos de expect (hallazgos UX)
const report = run('npx', ['tsx', 'qa-human-simulated/generate-report.ts']);
if (report !== 0) process.exit(report);

process.exit(pw === 0 ? 0 : pw);
