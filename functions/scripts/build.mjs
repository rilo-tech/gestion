import * as esbuild from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const functionsDir = join(__dirname, '..');
const repoRoot = join(functionsDir, '..');

await esbuild.build({
  entryPoints: [join(functionsDir, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(functionsDir, 'lib/index.js'),
  external: ['firebase-admin', 'firebase-functions'],
  sourcemap: true,
  logLevel: 'info',
  absWorkingDir: repoRoot,
});

console.log('[functions] Built', join(functionsDir, 'lib/index.js'));
