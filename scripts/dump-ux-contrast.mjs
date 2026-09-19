/**
 * Dump axe color-contrast failures for public pages (local preview).
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('qa-artifacts/ux/contrast-dump.json');
fs.mkdirSync(path.dirname(out), { recursive: true });

async function waitForServer(url, ms = 60_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('preview not up');
}

async function dump(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const nodes = [];
  for (const v of results.violations.filter((x) => x.id === 'color-contrast')) {
    for (const n of v.nodes) {
      const data = n.any?.[0]?.data || {};
      nodes.push({
        url,
        target: n.target,
        html: (n.html || '').slice(0, 220),
        fg: data.fgColor,
        bg: data.bgColor,
        ratio: data.contrastRatio,
        expected: data.expectedContrastRatio,
        fontSize: data.fontSize,
        fontWeight: data.fontWeight,
      });
    }
  }
  return nodes;
}

const server = spawn(
  'npx',
  ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
  { shell: true, stdio: 'ignore', cwd: process.cwd() }
);

try {
  await waitForServer('http://127.0.0.1:4173/');
  const browser = await chromium.launch();
  const all = [];
  for (const vp of [
    { w: 1366, h: 768, name: 'desktop' },
    { w: 375, h: 812, name: 'mobile' },
  ]) {
    const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await context.newPage();
    for (const pathUrl of ['/', '/registro', '/planes']) {
      const nodes = await dump(page, `http://127.0.0.1:4173${pathUrl}`);
      for (const n of nodes) {
        all.push({ ...n, viewport: vp.name });
      }
    }
    await context.close();
  }
  await browser.close();
  fs.writeFileSync(out, JSON.stringify(all, null, 2), 'utf8');
  console.log(`Wrote ${all.length} nodes → ${out}`);
  for (const n of all) {
    console.log(
      `[${n.viewport}] ${n.url} fg=${n.fg} bg=${n.bg} ratio=${n.ratio} html=${String(n.html).slice(0, 120)}`
    );
  }
} finally {
  try {
    server.kill();
  } catch {
    /* ignore */
  }
}
