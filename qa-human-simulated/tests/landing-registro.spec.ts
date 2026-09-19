import { test, expect } from '@playwright/test';
import {
  shot,
  collectVisibleText,
  findForbiddenTerms,
  FORBIDDEN_UI_TERMS,
  runVisualHeuristics,
  countInteractiveControls,
  densityWarning,
  ensureArtifactDir,
} from '../ux-helpers.ts';
import { runA11yChecks } from '../a11y.ts';
import { buildScenarioScore, type UxScenarioResult, type UxFinding } from '../ux-score.ts';
import fs from 'node:fs';
import path from 'node:path';

function viewportName(projectName: string): string {
  if (projectName.includes('mobile')) return 'mobile';
  if (projectName.includes('tablet')) return 'tablet';
  return 'desktop';
}

function appendResult(result: UxScenarioResult) {
  const dir = ensureArtifactDir();
  const file = path.join(dir, 'scenario-results.ndjson');
  fs.appendFileSync(file, `${JSON.stringify(result)}\n`, 'utf8');
}

test.describe('Persona Ana — primera impresión landing', () => {
  test('landing entiende producto en ≤5s (heurística contenido + CTA)', async ({ page }, info) => {
    const vp = viewportName(info.project.name);
    const steps: string[] = [];
    const friction: string[] = [];
    const observations: string[] = [];
    const findings: UxFinding[] = [];
    const screenshots: string[] = [];

    steps.push('Abrir /');
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    screenshots.push(await shot(page, 'ana', vp, 'landing-01'));

    const text = await collectVisibleText(page);
    steps.push('Leer hero y precios');

    const hasWhatsapp = /whatsapp|RILO Bot|bot/i.test(text);
    const hasGestion = /gesti[oó]n|panel/i.test(text);
    const hasCompleto = /completo/i.test(text);
    const hasCta = await page.getByRole('link', { name: /probar|empezar|gratis/i }).count();

    if (!hasWhatsapp) friction.push('No se entiende claramente WhatsApp / Bot');
    if (!hasGestion) friction.push('No se menciona Gestión/panel');
    if (!hasCompleto) friction.push('No se ve Completo');
    if (hasCta < 1) friction.push('Sin CTA claro de prueba');

    const forbidden = findForbiddenTerms(text, FORBIDDEN_UI_TERMS);
    for (const term of forbidden) {
      findings.push({
        id: `landing-term-${term}`,
        severity: 'HIGH',
        area: 'copy',
        title: `Tecnicismo en landing: ${term}`,
        detail: `Aparece “${term}” en texto visible.`,
      });
    }

    const visual = await runVisualHeuristics(page);
    for (const v of visual) {
      findings.push({
        id: `landing-visual-${v.kind}`,
        severity: v.kind === 'horizontal_overflow' ? 'HIGH' : 'MEDIUM',
        area: 'visual',
        title: v.kind,
        detail: v.detail,
      });
    }

    const controls = await countInteractiveControls(page);
    const dens = densityWarning(controls, text.length);
    if (dens) findings.push(dens);

    const a11y = await runA11yChecks(page);
    findings.push(...a11y.all.slice(0, 12));

    // Completo como valor: buscar badge/recomendado o ahorro
    if (!/recomend|mejor valor|ahorr/i.test(text)) {
      observations.push('No hay señal fuerte de “Completo = mejor valor” en el copy visible.');
      findings.push({
        id: 'landing-completo-value',
        severity: 'MEDIUM',
        area: 'landing',
        title: 'Completo poco destacado como mejor valor',
        detail: 'No se detectó badge/ahorro/recomendado en texto visible.',
      });
    } else {
      observations.push('Hay señal de valor/recomendado para Completo.');
    }

    if (text.length > 7500) {
      observations.push('Landing larga: riesgo de exceso de texto para Ana.');
      findings.push({
        id: 'landing-long',
        severity: 'LOW',
        area: 'landing',
        title: 'Landing extensa',
        detail: `${text.length} caracteres visibles.`,
      });
    }

    const taskSuccess = hasWhatsapp && hasCta >= 1 && visual.every((v) => v.kind !== 'horizontal_overflow');
    const { score, parts } = buildScenarioScore({
      taskSuccess,
      stepCount: steps.length,
      idealSteps: 3,
      clarityNotes: friction,
      errorCount: forbidden.length,
      responsiveOk: !visual.some((v) => v.kind === 'horizontal_overflow'),
      a11yHighCount: a11y.high.length,
    });

    expect(hasCta, 'CTA de prueba visible').toBeGreaterThan(0);
    expect(hasWhatsapp, 'Menciona WhatsApp/Bot').toBeTruthy();

    appendResult({
      id: 'landing-first-impression',
      flow: 'landing',
      persona: 'ana',
      viewport: vp,
      entry: '/',
      steps,
      expected: 'Entender qué es RILO, WhatsApp, planes y CTA en ≤5s',
      taskSuccess,
      stepCount: steps.length,
      friction,
      screenshots,
      observations,
      env: process.env.UX_BASE_URL ? 'STAGING' : 'LOCAL',
      status: taskSuccess ? 'PASS' : 'FAIL',
      score,
      parts,
      findings,
    });
  });
});

test.describe('Persona Ana — registro', () => {
  test('registro corto con CTA principal', async ({ page }, info) => {
    const vp = viewportName(info.project.name);
    const steps: string[] = [];
    const friction: string[] = [];
    const observations: string[] = [];
    const findings: UxFinding[] = [];
    const screenshots: string[] = [];

    steps.push('Ir a /registro');
    await page.goto('/registro');
    await page.waitForLoadState('domcontentloaded');
    screenshots.push(await shot(page, 'ana', vp, 'registro-01'));

    const text = await collectVisibleText(page);
    steps.push('Contar campos y CTAs');

    const inputs = await page.locator('input:visible, select:visible, textarea:visible').count();
    const primaryCtas = await page.getByRole('button', { name: /continuar|crear|empezar|probar|registr/i }).count();
    const linksCta = await page.getByRole('link', { name: /continuar|crear|empezar|probar|registr/i }).count();
    const ctaTotal = primaryCtas + linksCta;

    if (inputs > 12) {
      friction.push(`Demasiados campos visibles (${inputs})`);
      findings.push({
        id: 'registro-fields',
        severity: 'HIGH',
        area: 'registro',
        title: 'Registro pide demasiados campos',
        detail: `${inputs} inputs visibles en el primer paso.`,
      });
    }
    if (ctaTotal < 1) {
      friction.push('Sin CTA principal claro');
    }
    if (ctaTotal > 3) {
      observations.push('Varios CTAs compiten en registro.');
      findings.push({
        id: 'registro-multi-cta',
        severity: 'MEDIUM',
        area: 'registro',
        title: 'Más de un CTA fuerte en registro',
        detail: `${ctaTotal} CTAs detectados.`,
      });
    }

    const forbidden = findForbiddenTerms(text, FORBIDDEN_UI_TERMS);
    for (const term of forbidden) {
      findings.push({
        id: `registro-term-${term}`,
        severity: 'HIGH',
        area: 'copy',
        title: `Tecnicismo en registro: ${term}`,
        detail: term,
      });
    }

    const visual = await runVisualHeuristics(page);
    const a11y = await runA11yChecks(page);
    findings.push(
      ...visual.map((v) => ({
        id: `registro-${v.kind}`,
        severity: (v.kind === 'horizontal_overflow' ? 'HIGH' : 'MEDIUM') as UxFinding['severity'],
        area: 'visual',
        title: v.kind,
        detail: v.detail,
      }))
    );
    findings.push(...a11y.all.slice(0, 8));

    // Advanced config check
    if (/api key|webhook|firestore|smtp|merchant/i.test(text)) {
      findings.push({
        id: 'registro-advanced',
        severity: 'BLOCKER',
        area: 'registro',
        title: 'Registro pide configuración avanzada',
        detail: 'Texto sugiere setup técnico en el alta.',
      });
      friction.push('Configuración avanzada en registro');
    }

    const taskSuccess = ctaTotal >= 1 && inputs <= 12 && !friction.some((f) => f.includes('avanzada'));
    const { score, parts } = buildScenarioScore({
      taskSuccess,
      stepCount: steps.length + Math.max(0, inputs - 4),
      idealSteps: 5,
      clarityNotes: friction,
      errorCount: forbidden.length,
      responsiveOk: !visual.some((v) => v.kind === 'horizontal_overflow'),
      a11yHighCount: a11y.high.length,
    });

    expect(ctaTotal).toBeGreaterThan(0);

    appendResult({
      id: 'registro',
      flow: 'registro',
      persona: 'ana',
      viewport: vp,
      entry: '/registro',
      steps,
      expected: 'Registro corto, un CTA, sin config avanzada',
      taskSuccess,
      stepCount: steps.length,
      friction,
      screenshots,
      observations: [
        ...observations,
        `Campos visibles: ${inputs}`,
        `CTAs: ${ctaTotal}`,
      ],
      env: process.env.UX_BASE_URL ? 'STAGING' : 'LOCAL',
      status: taskSuccess ? 'PASS' : 'FAIL',
      score,
      parts,
      findings,
    });
  });
});

test.describe('Persona Diego — plan Bot CTA', () => {
  test('landing/planes no confunde Bot con ERP completo', async ({ page }, info) => {
    const vp = viewportName(info.project.name);
    await page.goto('/planes');
    await page.waitForLoadState('domcontentloaded');
    const shotPath = await shot(page, 'diego_bot', vp, 'planes-01');
    const text = await collectVisibleText(page);
    const hasBot = /RILO Bot|WhatsApp/i.test(text);
    const hasGestion = /Gestión|Gestion/i.test(text);
    expect(hasBot).toBeTruthy();
    expect(hasGestion).toBeTruthy();

    const { score, parts } = buildScenarioScore({
      taskSuccess: hasBot && hasGestion,
      stepCount: 2,
      idealSteps: 2,
      clarityNotes: [],
      errorCount: 0,
      responsiveOk: true,
      a11yHighCount: 0,
    });

    appendResult({
      id: 'planes-bot-vs-gestion',
      flow: 'planes',
      persona: 'diego_bot',
      viewport: vp,
      entry: '/planes',
      steps: ['Abrir /planes', 'Comparar Bot vs Gestión'],
      expected: 'Distinguir Bot y Gestión',
      taskSuccess: hasBot && hasGestion,
      stepCount: 2,
      friction: [],
      screenshots: [shotPath],
      observations: ['Comparativa de planes visible en copy.'],
      env: process.env.UX_BASE_URL ? 'STAGING' : 'LOCAL',
      status: 'PASS',
      score,
      parts,
      findings: [],
    });
  });
});
