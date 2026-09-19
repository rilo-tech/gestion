import type { Page } from '@playwright/test';
import type { UxFinding } from './ux-score.ts';

/**
 * Accessibility checks livianos.
 * Preferimos @axe-core/playwright cuando está disponible; fallback DOM si falla.
 */
export async function runA11yChecks(page: Page): Promise<{ high: UxFinding[]; all: UxFinding[] }> {
  const findings: UxFinding[] = [];

  try {
    const axeMod = await import('@axe-core/playwright');
    const AxeBuilder = axeMod.default;
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
      .analyze();
    for (const v of results.violations) {
      const impact = String(v.impact || 'moderate');
      const severity =
        impact === 'critical' || impact === 'serious'
          ? 'HIGH'
          : impact === 'moderate'
            ? 'MEDIUM'
            : 'LOW';
      findings.push({
        id: `axe-${v.id}`,
        severity: severity as UxFinding['severity'],
        area: 'accessibility',
        title: v.help,
        detail: `${v.id}: ${v.nodes.length} nodo(s). ${v.description}`,
      });
    }
  } catch {
    // Fallback DOM
    const domIssues = await page.evaluate(() => {
      const out: Array<{ id: string; title: string; detail: string; high: boolean }> = [];
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const b of buttons) {
        const name =
          b.getAttribute('aria-label') ||
          b.getAttribute('title') ||
          (b.textContent || '').trim();
        if (!name) {
          out.push({
            id: 'button-no-name',
            title: 'Botón sin nombre accesible',
            detail: b.outerHTML.slice(0, 120),
            high: true,
          });
        }
      }
      const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
      for (const input of inputs) {
        const id = input.getAttribute('id');
        const aria = input.getAttribute('aria-label');
        const labelled = id && document.querySelector(`label[for="${id}"]`);
        if (!aria && !labelled && input.getAttribute('type') !== 'hidden') {
          out.push({
            id: 'input-no-label',
            title: 'Input sin label',
            detail: (input.getAttribute('name') || input.getAttribute('placeholder') || 'input').slice(0, 80),
            high: true,
          });
        }
      }
      return out;
    });
    for (const row of domIssues) {
      findings.push({
        id: row.id,
        severity: row.high ? 'HIGH' : 'MEDIUM',
        area: 'accessibility',
        title: row.title,
        detail: row.detail,
      });
    }
  }

  const high = findings.filter((f) => f.severity === 'HIGH' || f.severity === 'BLOCKER');
  return { high, all: findings };
}
