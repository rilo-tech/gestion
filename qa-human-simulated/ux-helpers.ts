import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import type { UxFinding } from './ux-score.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const UX_ARTIFACT_ROOT = path.join(root, 'qa-artifacts', 'ux');

export function ensureArtifactDir(...parts: string[]): string {
  const dir = path.join(UX_ARTIFACT_ROOT, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function shot(
  page: Page,
  persona: string,
  viewport: string,
  name: string
): Promise<string> {
  const dir = ensureArtifactDir(persona, viewport);
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(root, file).replace(/\\/g, '/');
}

/** Palabras técnicas que no deberían aparecer en UI de usuario final. */
export const FORBIDDEN_UI_TERMS = [
  'handler',
  'adapter',
  'firestore',
  'capability',
  'tenant',
  'workflow',
  'action registry',
  'settlement',
  'policy',
  'module entitlement',
  'internal server error',
  'http 500',
  'undefined',
  'null',
  'NaN',
];

/** Tecnicismos de onboarding / producto. */
export const FORBIDDEN_ONBOARDING_TERMS = [
  'feature',
  'module',
  'automation',
  'policy',
  'settlement',
  'workflow',
];

export async function collectVisibleText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

export function findForbiddenTerms(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term.toLowerCase()));
}

export type VisualIssue = {
  kind: string;
  detail: string;
};

/**
 * Heurísticas visuales básicas vía DOM (sin ML).
 */
export async function runVisualHeuristics(page: Page): Promise<VisualIssue[]> {
  return page.evaluate(() => {
    const issues: Array<{ kind: string; detail: string }> = [];
    const docEl = document.documentElement;
    if (docEl.scrollWidth > docEl.clientWidth + 2) {
      issues.push({
        kind: 'horizontal_overflow',
        detail: `scrollWidth=${docEl.scrollWidth} clientWidth=${docEl.clientWidth}`,
      });
    }

    const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    let primaryWeight = 0;
    for (const el of buttons) {
      const style = window.getComputedStyle(el);
      const bg = style.backgroundColor;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        const elHtml = el as HTMLElement;
        const visible =
          typeof elHtml.checkVisibility === 'function'
            ? elHtml.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : false;
        // Solo reportar controles “rotos” que el usuario podría ver; nav responsive hidden no cuenta
        if (visible && (el.textContent || '').trim().length > 0) {
          issues.push({
            kind: 'zero_size_control',
            detail: (el.textContent || '').trim().slice(0, 40),
          });
        }
      }
      // Heurística: botones teal/solid grandes en primer viewport
      if (
        rect.top < window.innerHeight &&
        rect.height >= 40 &&
        (bg.includes('13, 148, 136') || bg.includes('20, 184, 166') || el.className.includes('bg-teal'))
      ) {
        primaryWeight += 1;
      }
    }
    if (primaryWeight > 3) {
      issues.push({
        kind: 'too_many_primary_ctas',
        detail: `≈${primaryWeight} CTAs de peso alto en viewport`,
      });
    }

    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog, .modal'));
    for (const d of dialogs) {
      const r = d.getBoundingClientRect();
      if (r.height > window.innerHeight + 8) {
        issues.push({ kind: 'modal_taller_than_viewport', detail: `h=${Math.round(r.height)}` });
      }
    }

    return issues;
  });
}

export async function countInteractiveControls(page: Page): Promise<number> {
  return page.locator('button, a[href], input, select, textarea, [role="button"]').count();
}

export function densityWarning(controlCount: number, textLen: number): UxFinding | null {
  if (controlCount > 40) {
    return {
      id: 'density-controls',
      severity: 'MEDIUM',
      area: 'density',
      title: 'Demasiados controles visibles',
      detail: `${controlCount} controles interactivos en la pantalla.`,
    };
  }
  // Landing marketing larga es esperable; warning solo si supera ~7.5k visibles
  if (textLen > 7500) {
    return {
      id: 'density-text',
      severity: 'LOW',
      area: 'density',
      title: 'Mucho texto en una sola vista',
      detail: `${textLen} caracteres visibles.`,
    };
  }
  return null;
}
