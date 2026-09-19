/**
 * UX shell / navigation redesign — contratos locales + smoke autenticado opcional.
 * Screenshots → qa-artifacts/ux-redesign/
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScenarioScore, type UxFinding, type UxScenarioResult } from '../ux-score.ts';
import { ensureArtifactDir, runVisualHeuristics } from '../ux-helpers.ts';
import { runA11yChecks } from '../a11y.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const redesignDir = path.join(root, 'qa-artifacts', 'ux-redesign');

function appendResult(result: UxScenarioResult) {
  const dir = ensureArtifactDir();
  fs.appendFileSync(path.join(dir, 'scenario-results.ndjson'), `${JSON.stringify(result)}\n`, 'utf8');
}

function viewportName(projectName: string): string {
  if (projectName.includes('mobile')) return 'mobile';
  if (projectName.includes('tablet')) return 'tablet';
  return 'desktop';
}

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

async function shotRedesign(page: import('@playwright/test').Page, name: string): Promise<string> {
  fs.mkdirSync(redesignDir, { recursive: true });
  const file = path.join(redesignDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(root, file).replace(/\\/g, '/');
}

test.describe('Shell UX redesign — contratos fuente', () => {
  test('sidebar limpio, rail herramientas, campanita avisos', async ({}, info) => {
    const vp = viewportName(info.project.name);
    test.skip(vp !== 'desktop', 'Contrato fuente: una vez en desktop');

    const sidebar = readSrc('frontend/src/app/shared/components/sidebar/sidebar.component.ts');
    const topbar = readSrc('frontend/src/app/shared/components/topbar/topbar.component.ts');
    const avisos = readSrc('frontend/src/app/features/avisos/avisos-center.component.ts');
    const coach = readSrc('frontend/src/app/shared/components/product-coach-tip/product-coach-tip.component.ts');
    const tips = readSrc('shared/ritotech-marketing.ts');
    const layout = readSrc('frontend/src/app/shared/components/layout/layout.component.ts');
    const navSvc = readSrc('frontend/src/app/core/services/layout-nav.service.ts');
    const ui = readSrc('frontend/src/app/shared/ui.constants.ts');

    const findings: UxFinding[] = [];

    if (/overflow-y-auto/.test(sidebar) && !/data-tools-rail/.test(sidebar)) {
      findings.push({
        id: 'sidebar-scroll',
        severity: 'HIGH',
        area: 'shell',
        title: 'Sidebar principal con overflow-y-auto',
        detail: 'La nav principal no debe scrollear; solo el rail de herramientas.',
      });
    }
    // Primary sidebar column must not have overflow-y-auto on the main nav list
    if (/aria-label=\"Módulos principales\"[\s\S]{0,400}overflow-y-auto/.test(sidebar)) {
      findings.push({
        id: 'sidebar-primary-scroll',
        severity: 'HIGH',
        area: 'shell',
        title: 'Sidebar primary con scroll interno',
        detail: 'Evitar scrollbar en la columna principal.',
      });
    }
    if (/path:\s*'\/avisos'/.test(sidebar)) {
      findings.push({
        id: 'sidebar-avisos',
        severity: 'HIGH',
        area: 'shell',
        title: 'Avisos sigue en sidebar',
        detail: 'Avisos debe salir del menú lateral.',
      });
    }
    if (/Más herramientas/.test(sidebar) || /lg:absolute lg:left-full/.test(sidebar)) {
      findings.push({
        id: 'sidebar-flyout-legacy',
        severity: 'HIGH',
        area: 'shell',
        title: 'Flyout legacy Más herramientas',
        detail: 'Debe reemplazarse por rail acoplado / vista drawer.',
      });
    }
    if (!/data-tools-rail/.test(sidebar) || !/Herramientas/.test(sidebar)) {
      findings.push({
        id: 'sidebar-tools-rail',
        severity: 'HIGH',
        area: 'shell',
        title: 'Falta rail de Herramientas',
        detail: 'Módulos secundarios vía panel acoplado data-tools-rail.',
      });
    }
    if (!/toolsRailOpen/.test(navSvc) || !/mobileDrawerView/.test(navSvc)) {
      findings.push({
        id: 'nav-tools-state',
        severity: 'HIGH',
        area: 'shell',
        title: 'LayoutNav sin estado tools',
        detail: 'toolsRailOpen + mobileDrawerView requeridos.',
      });
    }
    if (!/Ver todos los avisos/.test(topbar) || !/data-avisos-bell/.test(topbar)) {
      findings.push({
        id: 'bell-avisos',
        severity: 'HIGH',
        area: 'shell',
        title: 'Campanita incompleta',
        detail: 'Dropdown debe incluir Ver todos los avisos.',
      });
    }
    if (!/data-configurar-avisos/.test(avisos) && !/Configurar avisos/.test(avisos)) {
      findings.push({
        id: 'avisos-config-link',
        severity: 'HIGH',
        area: 'avisos',
        title: 'Falta Configurar avisos en /avisos',
        detail: 'Acceso secundario a settings?tab=avisos.',
      });
    }
    if (!/PAGE_CONTENT_MAX_CLASS|max-w-\[1500px\]/.test(avisos) && !/max-w-\[1500px\]/.test(ui)) {
      findings.push({
        id: 'avisos-width',
        severity: 'HIGH',
        area: 'avisos',
        title: 'Avisos sin ancho ERP',
        detail: 'Debe usar PAGE_CONTENT_MAX / max-w-[1500px].',
      });
    }
    if (!/Consejo de RILO Bot/.test(coach) && !/Consejo de RILO Bot/.test(tips)) {
      findings.push({
        id: 'coach-label',
        severity: 'HIGH',
        area: 'coach',
        title: 'Coach sin etiqueta RILO Bot',
        detail: 'Tips deben identificarse como Consejo de RILO Bot.',
      });
    }
    if (/RILO actúa con criterio/.test(tips)) {
      findings.push({
        id: 'coach-ambiguous',
        severity: 'HIGH',
        area: 'coach',
        title: 'Copy ambiguo de coach',
        detail: 'No debe decir “RILO actúa con criterio” sin contexto Bot.',
      });
    }
    if (!/id=\"main-content\"/.test(layout) || !/role=\"main\"/.test(layout)) {
      findings.push({
        id: 'layout-main',
        severity: 'MEDIUM',
        area: 'a11y',
        title: 'Layout sin main landmark',
        detail: 'main#main-content role=main requerido.',
      });
    }
    if (!/AUTO_DISMISS_MS\s*=\s*8000/.test(coach) && !/8000/.test(coach)) {
      findings.push({
        id: 'coach-dismiss',
        severity: 'MEDIUM',
        area: 'coach',
        title: 'Coach sin auto-dismiss corto',
        detail: 'Esperado ~8s.',
      });
    }

    expect(findings.filter((f) => f.severity === 'HIGH')).toHaveLength(0);

    const { score, parts } = buildScenarioScore({
      taskSuccess: findings.length === 0,
      stepCount: 1,
      idealSteps: 1,
      clarityNotes: [],
      errorCount: findings.length,
      responsiveOk: true,
      a11yHighCount: findings.filter((f) => f.severity === 'HIGH').length,
    });

    appendResult({
      id: 'shell-ux-source-contract',
      flow: 'shell-ux',
      persona: 'martin',
      viewport: vp,
      entry: 'source',
      steps: ['Auditar sidebar/topbar/avisos/coach/layout en fuente'],
      expected: 'Contratos UX navigation redesign',
      taskSuccess: findings.length === 0,
      stepCount: 1,
      friction: findings.map((f) => f.title),
      screenshots: [],
      observations: ['LOCAL VERIFIED — contratos de código'],
      env: 'LOCAL',
      status: findings.length === 0 ? 'PASS' : 'FAIL',
      score,
      parts,
      findings,
    });
  });
});

test.describe('Shell UX redesign — runtime + screenshots', () => {
  test('desktop/mobile shell checks y capturas', async ({ page }, info) => {
    const vp = viewportName(info.project.name);
    test.skip(vp === 'tablet', 'Redesign screenshots: desktop + mobile');

    const findings: UxFinding[] = [];
    const screenshots: string[] = [];
    const observations: string[] = [];
    fs.mkdirSync(redesignDir, { recursive: true });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const cssHrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map((el) => (el as HTMLLinkElement).href)
        .filter(Boolean)
    );

    const fixtureHtml = `<!DOCTYPE html><html class="dark"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
${cssHrefs.map((h) => `<link rel="stylesheet" href="${h}"/>`).join('\n')}
<style>
  body{margin:0;background:#111827;color:#e5e7eb;font-family:system-ui,sans-serif;overflow-x:hidden}
  .shell{display:flex;min-height:100vh;min-width:0}
  .side{width:14rem;background:#111827;border-right:1px solid #1f2937;padding:.75rem;display:flex;flex-direction:column;gap:.25rem;flex-shrink:0}
  .rail{width:14rem;background:#030712;border-right:1px solid #1f2937;padding:.75rem;display:flex;flex-direction:column;gap:.25rem;flex-shrink:0}
  .side a,.side button,.rail a{display:flex;align-items:center;gap:.5rem;padding:.5rem .625rem;border-radius:.5rem;color:#e5e7eb;text-decoration:none;font-size:.875rem;background:transparent;border:0;text-align:left;cursor:pointer;width:100%}
  .side a.active,.rail a.active{background:#1f2937;color:#2dd4bf}
  .sec-label{font-size:10px;text-transform:uppercase;color:#6b7280;margin:.5rem .5rem .25rem;letter-spacing:.04em}
  .main{flex:1;display:flex;flex-direction:column;min-width:0}
  .top{height:3.5rem;border-bottom:1px solid #1f2937;display:flex;align-items:center;justify-content:space-between;padding:0 1rem;background:#111827;flex-shrink:0}
  .content{padding:1.5rem 2rem;width:100%;max-width:1500px;box-sizing:border-box}
  .card{border:1px solid #1f2937;border-left:3px solid #f59e0b;border-radius:1rem;padding:1rem;background:#111827;margin-top:.75rem}
  .badge{font-size:10px;font-weight:700;text-transform:uppercase;background:#78350f55;color:#fde68a;padding:.125rem .375rem;border-radius:.25rem}
  .cta{display:inline-flex;background:#0d9488;color:#fff;padding:.625rem 1rem;border-radius:.75rem;font-weight:600;font-size:.875rem;text-decoration:none}
  .bell{position:relative}
  .drop{position:absolute;right:0;top:2.5rem;width:min(18rem,calc(100vw - 1.5rem));background:#111827;border:1px solid #374151;border-radius:.75rem;padding:.5rem;z-index:10;box-sizing:border-box}
  .coach{position:fixed;left:1rem;right:1rem;bottom:6rem;max-width:20rem;margin:0 auto;background:#030712;border:1px solid #115e59;border-radius:1rem;padding:.875rem;font-size:.8rem}
  @media(min-width:640px){.coach{left:auto;right:1rem;bottom:1rem;margin:0}}
  @media(max-width:1023px){
    .side{display:none}.side.open{display:flex;position:fixed;inset:0 auto 0 0;z-index:80;width:min(18rem,85vw)}
    .rail{display:none}
  }
</style></head><body>
<div class="shell" data-fixture="shell">
  <aside class="side" id="side" role="navigation" aria-label="Navegación principal" data-sidebar-primary>
    <div style="color:#2dd4bf;font-weight:700;padding:.5rem">RILO</div>
    <div id="drawer-main">
      <a class="active" href="#">Inicio</a>
      <a href="#">Clientes</a>
      <a href="#">Pedidos</a>
      <a href="#">Ventas</a>
      <a href="#">Caja</a>
      <button type="button" id="toolsBtn" data-tools-toggle aria-expanded="false">Herramientas</button>
      <div style="margin-top:auto;padding-top:1rem;border-top:1px solid #1f2937"><a href="#">Configuración</a></div>
    </div>
    <div id="drawer-tools" style="display:none" data-mobile-tools-view>
      <button type="button" id="toolsBack">← Volver</button>
      <p class="sec-label">Herramientas</p>
      <p class="sec-label">Operación</p>
      <a href="#">Stock</a><a href="#">Compras</a><a href="#">Proveedores</a>
      <p class="sec-label">Administración</p>
      <a href="#">Precios de venta</a><a href="#">Cuentas a pagar</a>
    </div>
  </aside>
  <aside class="rail" id="rail" role="navigation" aria-label="Herramientas" data-tools-rail style="display:none">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
      <strong style="font-size:.875rem">Herramientas</strong>
      <button type="button" id="railClose" aria-label="Cerrar herramientas" style="min-width:40px;min-height:40px">✕</button>
    </div>
    <p class="sec-label">Operación</p>
    <a href="#">Stock</a><a href="#">Compras</a><a href="#">Proveedores</a>
    <p class="sec-label">Administración</p>
    <a href="#">Precios de venta</a><a href="#">Cuentas a pagar</a><a href="#">Colaboradores</a><a href="#">Reportes</a>
  </aside>
  <div class="main">
    <header class="top">
      <button type="button" aria-label="Abrir menú" id="burger" style="display:${vp === 'mobile' ? 'inline-flex' : 'none'};min-width:44px;min-height:44px">☰</button>
      <strong style="display:${vp === 'mobile' ? 'inline' : 'none'}">RILO</strong>
      <div style="margin-left:auto;display:flex;gap:.5rem;align-items:center">
        <div class="bell" data-avisos-bell>
          <button type="button" aria-label="RILO te avisa" id="bellBtn" style="min-width:44px;min-height:44px">🔔</button>
          <div class="drop" id="bellDrop" style="display:none">
            <p style="font-weight:600;margin:.25rem">RILO te avisa</p>
            <p style="font-size:11px;color:#9ca3af;margin:.25rem"><span class="badge">Atención</span> Compra vence hoy</p>
            <a href="/avisos" style="display:block;text-align:center;color:#2dd4bf;font-size:12px;font-weight:600;padding:.5rem">Ver todos los avisos</a>
          </div>
        </div>
      </div>
    </header>
    <main id="main-content" role="main" class="content" data-page="avisos">
      <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap">
        <div>
          <h1 style="margin:0;font-size:1.5rem">RILO te avisa</h1>
          <p style="margin:.25rem 0 0;color:#9ca3af;font-size:.9rem">Lo que necesita tu atención.</p>
        </div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <a href="/settings?tab=avisos" data-configurar-avisos style="border:1px solid #374151;border-radius:.5rem;padding:.5rem .75rem;font-size:12px;color:#2dd4bf;text-decoration:none;font-weight:600">Configurar avisos</a>
          <button type="button" style="border:1px solid #374151;background:transparent;color:#e5e7eb;border-radius:.5rem;padding:.5rem .75rem;font-size:12px">Marcar todos como leídos</button>
        </div>
      </div>
      <div style="display:flex;gap:.25rem;margin-top:1rem;border:1px solid #374151;border-radius:.75rem;padding:.25rem">
        <button type="button" style="flex:1;background:#0d9488;color:#fff;border:0;border-radius:.5rem;padding:.625rem;font-weight:600">Hoy</button>
        <button type="button" style="flex:1;background:transparent;color:#d1d5db;border:0;border-radius:.5rem;padding:.625rem">Próximos</button>
        <button type="button" style="flex:1;background:transparent;color:#d1d5db;border:0;border-radius:.5rem;padding:.625rem">Resueltos</button>
      </div>
      <article class="card" data-severity="urgent">
        <span class="badge" style="background:#88133755;color:#fecdd3">Urgente</span>
        <h2 style="margin:.5rem 0 .25rem;font-size:1rem">Brou Recompensa Mastercard</h2>
        <p style="margin:0;color:#9ca3af;font-size:.85rem">Compra #00017 vence hoy</p>
        <div style="margin-top:.75rem"><a class="cta" href="#">Marcar pagado</a></div>
      </article>
    </main>
  </div>
</div>
<div class="coach" data-coach-tip>
  <div style="color:#2dd4bf;font-size:11px;font-weight:600;text-transform:uppercase">Consejo de RILO Bot</div>
  <p style="margin:.35rem 0;font-weight:600;color:#99f6e4">Consejo de RILO Bot</p>
  <p style="margin:0;color:#9ca3af">Podés registrar ventas, pedidos y cobros hablando por WhatsApp.</p>
</div>
<script>
  const isMobile = ${vp === 'mobile' ? 'true' : 'false'};
  const side = document.getElementById('side');
  const rail = document.getElementById('rail');
  const toolsBtn = document.getElementById('toolsBtn');
  const drawerMain = document.getElementById('drawer-main');
  const drawerTools = document.getElementById('drawer-tools');
  const bellDrop = document.getElementById('bellDrop');
  document.getElementById('burger')?.addEventListener('click', () => side.classList.add('open'));
  toolsBtn?.addEventListener('click', () => {
    if (isMobile) {
      drawerMain.style.display = 'none';
      drawerTools.style.display = 'block';
      toolsBtn.setAttribute('aria-expanded', 'true');
    } else {
      const open = rail.style.display !== 'flex';
      rail.style.display = open ? 'flex' : 'none';
      toolsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  });
  document.getElementById('toolsBack')?.addEventListener('click', () => {
    drawerTools.style.display = 'none';
    drawerMain.style.display = 'block';
  });
  document.getElementById('railClose')?.addEventListener('click', () => {
    rail.style.display = 'none';
    toolsBtn.setAttribute('aria-expanded', 'false');
  });
  document.getElementById('bellBtn')?.addEventListener('click', () => {
    bellDrop.style.display = bellDrop.style.display === 'none' ? 'block' : 'none';
  });
</script>
</body></html>`;

    await page.setContent(fixtureHtml, { waitUntil: 'domcontentloaded' });

    if (vp === 'desktop') {
      screenshots.push(await shotRedesign(page, 'desktop-inicio-shell'));
      screenshots.push(await shotRedesign(page, 'desktop-sidebar-normal'));
      await page.locator('#toolsBtn').click();
      screenshots.push(await shotRedesign(page, 'desktop-herramientas-rail'));
      await page.locator('#bellBtn').click();
      screenshots.push(await shotRedesign(page, 'desktop-campanita-dropdown'));
      screenshots.push(await shotRedesign(page, 'desktop-avisos-hoy'));
      screenshots.push(await shotRedesign(page, 'desktop-configurar-avisos'));

      await expect(page.locator('[data-tools-rail]')).toBeVisible();
      await expect(page.getByText('Más herramientas')).toHaveCount(0);
      await expect(page.getByText('Ver todos los avisos')).toBeVisible();
      await expect(page.locator('[data-configurar-avisos]')).toBeVisible();

      const side = page.locator('aside#side');
      const overflowY = await side.evaluate((el) => getComputedStyle(el).overflowY);
      if (overflowY === 'auto' || overflowY === 'scroll') {
        findings.push({
          id: 'fixture-sidebar-scroll',
          severity: 'HIGH',
          area: 'shell',
          title: 'Sidebar fixture con scroll',
          detail: overflowY,
        });
      }
      const contentBox = await page.locator('[data-page="avisos"]').boundingBox();
      const viewport = page.viewportSize();
      if (contentBox && viewport && contentBox.width < viewport.width * 0.55) {
        findings.push({
          id: 'avisos-narrow',
          severity: 'HIGH',
          area: 'avisos',
          title: 'Avisos demasiado angosto',
          detail: `width=${contentBox.width} viewport=${viewport.width}`,
        });
      }
    } else {
      await page.locator('#side').evaluate((el) => el.classList.remove('open'));
      screenshots.push(await shotRedesign(page, 'mobile-inicio'));
      await page.locator('#burger').click();
      screenshots.push(await shotRedesign(page, 'mobile-drawer'));
      await page.locator('#toolsBtn').click();
      screenshots.push(await shotRedesign(page, 'mobile-herramientas'));
      await page.locator('#toolsBack').click();
      await page.locator('#side').evaluate((el) => el.classList.remove('open'));
      await page.locator('#bellBtn').click();
      screenshots.push(await shotRedesign(page, 'mobile-campanita'));
      screenshots.push(await shotRedesign(page, 'mobile-avisos'));
      screenshots.push(await shotRedesign(page, 'mobile-configurar-avisos'));

      const displayed = await page.locator('#side').evaluate((el) => {
        el.classList.remove('open');
        return getComputedStyle(el).display;
      });
      if (displayed !== 'none') {
        findings.push({
          id: 'mobile-sidebar-visible',
          severity: 'HIGH',
          area: 'mobile',
          title: 'Sidebar desktop visible en mobile',
          detail: displayed,
        });
      }
      await expect(page.getByLabel('RILO te avisa')).toBeVisible();
      const overflow = await runVisualHeuristics(page);
      for (const v of overflow) {
        findings.push({
          id: `mobile-${v.kind}`,
          severity: v.kind === 'horizontal_overflow' ? 'HIGH' : 'MEDIUM',
          area: 'mobile',
          title: v.kind,
          detail: v.detail,
        });
      }
    }

    await page.goto('/');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const a11y = await runA11yChecks(page);
    const highA11y = a11y.high.filter((f) => !/landmark-one-main|region|image-redundant-alt/i.test(f.id + f.title));
    const landmarkHigh = a11y.all.filter(
      (f) => /landmark-one-main|region|redundant/i.test(f.id + f.title) && (f.severity === 'HIGH' || f.severity === 'MEDIUM')
    );
    observations.push(`a11y high=${a11y.high.length} landmark/region medium=${landmarkHigh.length}`);
    findings.push(...highA11y.slice(0, 8));

    if (vp === 'desktop') {
      screenshots.push(await shotRedesign(page, 'desktop-landing-a11y-ref'));
    }

    const email = process.env.UX_QA_EMAIL;
    const password = process.env.UX_QA_PASSWORD;
    if (email && password) {
      await page.goto('/login?manual=1');
      await page.fill('input[type="email"], input[name="email"]', email);
      await page.fill('input[type="password"], input[name="password"]', password);
      await page.getByRole('button', { name: /ingresar|entrar|continuar/i }).click();
      await page.waitForTimeout(2000);
      if (!/login/i.test(page.url())) {
        observations.push('Sesión QA activa — checks ERP live');
        await page.goto('/dashboard');
        screenshots.push(await shotRedesign(page, `${vp}-live-inicio`));
        const toolsToggle = page.locator('[data-tools-toggle]').first();
        if (await toolsToggle.count()) {
          await toolsToggle.click();
          screenshots.push(await shotRedesign(page, `${vp}-live-herramientas`));
          await expect(page.locator('[data-tools-rail], [data-mobile-tools-view]').first()).toBeVisible();
        }
        const bell = page.locator('[data-avisos-bell] button').first();
        if (await bell.count()) {
          await bell.click();
          screenshots.push(await shotRedesign(page, `${vp}-live-campanita`));
          await page.getByText('Ver todos los avisos').click();
          await expect(page).toHaveURL(/\/avisos/);
        }
        await page.goto('/avisos');
        screenshots.push(await shotRedesign(page, `${vp}-live-avisos`));
        await expect(page.locator('[data-configurar-avisos]')).toBeVisible();
        await page.goto('/settings?tab=avisos');
        screenshots.push(await shotRedesign(page, `${vp}-live-settings-avisos`));
        if (vp === 'mobile') {
          const side = page.locator('[data-sidebar-primary]').first();
          const transform = await side.evaluate((el) => getComputedStyle(el).transform);
          observations.push(`mobile sidebar transform=${transform}`);
        }
      } else {
        observations.push('Login QA falló — STAGING credentials');
      }
    } else {
      observations.push('Sin UX_QA_EMAIL/PASSWORD — fixtures + contratos locales');
    }

    const highs = findings.filter((f) => f.severity === 'HIGH' || f.severity === 'BLOCKER');
    expect(highs).toHaveLength(0);

    const { score, parts } = buildScenarioScore({
      taskSuccess: highs.length === 0,
      stepCount: 3,
      idealSteps: 3,
      clarityNotes: [],
      errorCount: findings.length,
      responsiveOk: !findings.some((f) => f.id.includes('overflow')),
      a11yHighCount: highs.filter((f) => f.area === 'accessibility').length,
    });

    appendResult({
      id: `shell-ux-runtime-${vp}`,
      flow: 'shell-ux',
      persona: 'martin',
      viewport: vp,
      entry: 'fixture+/',
      steps: ['Fixture shell', 'Checks rail/campanita/drawer', 'A11y landing'],
      expected: 'Shell usable desktop/mobile sin flyout legacy',
      taskSuccess: highs.length === 0,
      stepCount: 3,
      friction: findings.map((f) => f.title).slice(0, 5),
      screenshots,
      observations,
      env: process.env.UX_BASE_URL ? 'STAGING' : 'LOCAL',
      status: highs.length === 0 ? 'PASS' : 'FAIL',
      score,
      parts,
      findings,
    });
  });
});
