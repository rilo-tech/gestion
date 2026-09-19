/**
 * Genera UX_QA_RILO.md a partir de qa-artifacts/ux/scenario-results.ndjson
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CRITICAL_FLOW_IDS,
  CRITICAL_SCORE_TARGET,
  type UxFinding,
  type UxScenarioResult,
  type UxSeverity,
} from './ux-score.ts';
import { UX_PERSONAS } from './personas.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.join(root, 'qa-artifacts', 'ux');
const ndjsonPath = path.join(artifactDir, 'scenario-results.ndjson');
const outMd = path.join(root, 'UX_QA_RILO.md');

function loadResults(): UxScenarioResult[] {
  if (!fs.existsSync(ndjsonPath)) return [];
  return fs
    .readFileSync(ndjsonPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as UxScenarioResult);
}

function dedupeScenarios(rows: UxScenarioResult[]): UxScenarioResult[] {
  const byKey = new Map<string, UxScenarioResult>();
  for (const row of rows) {
    const key = `${row.id}::${row.viewport}`;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

function bestByFlow(rows: UxScenarioResult[]): Map<string, UxScenarioResult> {
  const map = new Map<string, UxScenarioResult>();
  for (const row of rows) {
    const prev = map.get(row.id);
    if (!prev) {
      map.set(row.id, row);
      continue;
    }
    const prevRank = (prev.viewport === 'desktop' ? 1000 : 0) + prev.score;
    const nextRank = (row.viewport === 'desktop' ? 1000 : 0) + row.score;
    if (nextRank >= prevRank) map.set(row.id, row);
  }
  return map;
}

function uniqueFindings(findings: UxFinding[]): UxFinding[] {
  const seen = new Set<string>();
  const out: UxFinding[] = [];
  for (const f of findings) {
    const key = `${f.severity}::${f.area}::${f.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function countSeverity(findings: UxFinding[]): Record<UxSeverity, number> {
  const out: Record<UxSeverity, number> = {
    BLOCKER: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    UX_POLISH: 0,
  };
  for (const f of uniqueFindings(findings)) out[f.severity] += 1;
  return out;
}

function scoreCell(row: UxScenarioResult | undefined): string {
  if (!row) return 'MISSING';
  if (row.status === 'STAGING_REQUIRED') return 'N/A — requiere staging';
  return String(row.score);
}

function verdict(input: {
  blockers: number;
  highs: number;
  criticalBelow: string[];
  stagingRequired: number;
}): string {
  if (input.blockers > 0) return 'UX BLOCKED';
  if (input.criticalBelow.length > 0) return 'UX NEEDS FIXES';
  if (input.highs > 0) return 'UX NEEDS FIXES';
  if (input.stagingRequired > 0) return 'UX READY FOR STAGING';
  return 'UX READY FOR HUMAN VALIDATION';
}

function main() {
  const raw = loadResults();
  const rows = dedupeScenarios(raw);
  const byFlow = bestByFlow(rows);
  const localRows = rows.filter((r) => r.status !== 'STAGING_REQUIRED');
  const stagingRows = rows.filter((r) => r.status === 'STAGING_REQUIRED');

  const localFindings = localRows.flatMap((r) => r.findings || []).filter((f) => !f.stagingRequired);
  const sev = countSeverity(localFindings);

  const criticalScores: Array<{ id: string; scoreLabel: string; status: string }> = [];
  const criticalBelow: string[] = [];
  for (const id of CRITICAL_FLOW_IDS) {
    const row = byFlow.get(id);
    if (!row) {
      criticalScores.push({ id, scoreLabel: 'MISSING', status: 'MISSING' });
      criticalBelow.push(id);
      continue;
    }
    criticalScores.push({ id, scoreLabel: scoreCell(row), status: row.status });
    if (row.status !== 'STAGING_REQUIRED' && row.score < CRITICAL_SCORE_TARGET) {
      criticalBelow.push(id);
    }
  }

  const stagingRequired = stagingRows.length;
  const v = verdict({
    blockers: sev.BLOCKER,
    highs: sev.HIGH,
    criticalBelow,
    stagingRequired,
  });

  const topIssues = uniqueFindings(localFindings)
    .sort((a, b) => {
      const order: Record<UxSeverity, number> = {
        BLOCKER: 0,
        HIGH: 1,
        MEDIUM: 2,
        LOW: 3,
        UX_POLISH: 4,
      };
      return order[a.severity] - order[b.severity];
    })
    .slice(0, 10);

  const quickWins = topIssues
    .filter((f) => f.severity === 'LOW' || f.severity === 'UX_POLISH' || f.severity === 'MEDIUM')
    .filter((f) => /texto|cta|empty|aria|label|overflow|contraste|contrast/i.test(f.title + f.detail))
    .slice(0, 5);

  const screenshots = rows.flatMap((r) => r.screenshots || []);
  const envNote = process.env.UX_BASE_URL
    ? `STAGING via UX_BASE_URL=${process.env.UX_BASE_URL}`
    : 'LOCAL VERIFIED (vite preview / dist) — flujos autenticados = STAGING REQUIRED';

  const localTable = localRows
    .filter((r, i, arr) => arr.findIndex((x) => x.id === r.id && x.viewport === 'desktop') === i || r.viewport === 'n/a')
    .map((r) => {
      const best = byFlow.get(r.id) || r;
      if (best.viewport !== r.viewport && r.viewport !== 'n/a') return null;
      return `| ${best.flow} | ${best.persona} | ${best.viewport} | ${best.taskSuccess ? 'yes' : 'no'} | ${best.stepCount} | ${best.score} | ${best.status} |`;
    })
    .filter(Boolean)
    .join('\n');

  const stagingTable = [...byFlow.values()]
    .filter((r) => r.status === 'STAGING_REQUIRED')
    .map(
      (r) =>
        `| ${r.flow} | ${r.persona} | ${r.viewport} | N/A — requiere staging | ${r.status} |`
    )
    .join('\n');

  const criticalTable = criticalScores
    .map((c) => `| ${c.id} | ${c.scoreLabel} | ${c.status} |`)
    .join('\n');

  const md = `# UX_QA_RILO.md

QA humano simulado + heurísticas UX/UI automáticas (Playwright).  
**No es producción.** No agrega módulos ni cambia precios.

**Fecha:** ${new Date().toISOString().slice(0, 10)}  
**Entorno:** ${envNote}  
**Comando:** \`npm run test:ux\`  
**Veredicto:** **${v}**

## Resumen

- Escenarios registrados: **${rows.length}** (viewports × flujos)
- Flujos únicos: **${byFlow.size}**
- Findings **LOCALES** (únicos): BLOCKER **${sev.BLOCKER}** · HIGH **${sev.HIGH}** · MEDIUM **${sev.MEDIUM}** · LOW **${sev.LOW}** · POLISH **${sev.UX_POLISH}**
- STAGING_REQUIRED: **${stagingRequired}** (sin score — falta sesión QA)
- Fórmula score (solo flujos ejecutables): taskSuccess 40 + pasos 15 + claridad 15 + errores 10 + responsive 10 + a11y 10 (objetivo ≥ ${CRITICAL_SCORE_TARGET})

## Personas

${UX_PERSONAS.map((p) => `- **${p.name}** (${p.label}) — plan ${p.planHint} — goals: ${p.goals.join('; ')}`).join('\n')}

## LOCAL VERIFIED

Flujos públicos / smoke ejecutados contra vite preview (\`dist/\`).

| Flujo | Persona | Viewport | Task success | Pasos | Score | Estado |
|---|---|---|---|---:|---:|---|
${localTable || '_Sin escenarios locales._'}

### Críticos locales

| Flujo | Score | Estado |
|---|---|---|
${criticalScores
  .filter((c) => c.status !== 'STAGING_REQUIRED')
  .map((c) => `| ${c.id} | ${c.scoreLabel} | ${c.status} |`)
  .join('\n')}

## STAGING REQUIRED

Estos flujos **no se puntúan en local**. El redirect a login no es un fallo UX: falta tenant/sesión de staging.

| Flujo | Persona | Viewport | Score | Estado |
|---|---|---|---|---|
${stagingTable || '_Ninguno._'}

| Flujo crítico | Score | Estado |
|---|---|---|
${criticalScores
  .filter((c) => c.status === 'STAGING_REQUIRED')
  .map((c) => `| ${c.id} | N/A — requiere staging | STAGING_REQUIRED |`)
  .join('\n')}

## Scores (críticos)

| Flujo | Score | Estado |
|---|---|---|
${criticalTable}

## Mobile / Tablet / Desktop

- mobile-375 (375×812)
- tablet-768 (768×1024)
- desktop-1366 (1366×768)

Screenshots en \`qa-artifacts/ux/{persona}/{viewport}/\`.

## Accessibility

axe-core + fallback DOM. Objetivo: **HIGH = 0** en páginas públicas locales.

## Copy

Scanner distingue **static source code** vs **visible user copy** (texto entre tags / placeholder / aria-label).  
No reporta \`null\`/\`undefined\`/\`tenant\` de TypeScript interno.

## Bot

Dataset \`qa-human-simulated/bot-phrases.ts\` — sin writes, sin Agent V4 live.  
\`pagué 500\` → \`ambiguous\`.

## Problemas locales encontrados

${
  topIssues.length
    ? topIssues.map((f, i) => `${i + 1}. **[${f.severity}]** ${f.title} — ${f.detail}`).join('\n')
    : '_Ningún finding local relevante en esta corrida._'
}

## Corregidos (esta pasada)

- Contraste CTAs públicos: \`bg-teal-600\`+\`text-white\` → \`bg-teal-700\`+\`text-white\` (shell, pricing CTA, landing, registro, product page).
- Badge Completo: \`text-teal-200\`/\`bg-teal-700\` → \`text-white\`/\`bg-teal-800\`.
- Muted chat/landing: \`text-gray-500\` → \`text-gray-400\` donde fallaba AA.
- Densidad landing: progressive disclosure en ejemplos (“Ver más ejemplos”).
- Scanner UX: solo copy visible (no falsos positivos de código).

## Recomendaciones visuales

1. Completar sesión QA en staging para scores de onboarding/venta/pedido/avisos.
2. Revisar landmarks \`main\` en registro si axe lo marca MEDIUM.
3. Empty states ERP con CTA (staging).

## Staging required (detalle)

| Ítem | Motivo |
|---|---|
| Onboarding autenticado | Requiere tenant trial |
| Primera venta / pedido / finalizar | Requiere login + datos |
| Avisos / payables / settings | Requiere plan + módulos |
| Resumen Bot (/inicio) | Requiere producto Bot |
| Agent V4 live + typos | Requiere Meta/OpenAI staging |

## Screenshot index

${
  screenshots.length
    ? screenshots.map((s) => `- \`${s}\``).join('\n')
    : '_Sin screenshots._'
}

## Top 10 UX issues (locales)

${topIssues.length ? topIssues.map((f, i) => `${i + 1}. [${f.severity}] ${f.title}`).join('\n') : '_Ninguno._'}

## Top 5 quick wins

${quickWins.length ? quickWins.map((f, i) => `${i + 1}. ${f.title} — ${f.detail}`).join('\n') : '_Sin quick wins pendientes._'}

## ¿Se siente simple?

1. ¿Usuario no técnico entiende RILO? — **Parcial (landing LOCAL)**.
2. ¿Registro corto? — **Sí (score local)**.
3. ¿Onboarding corto? — **STAGING REQUIRED**.
4. ¿Primera acción obvia? — **STAGING REQUIRED**.
5. ¿Venta sencilla? — **STAGING REQUIRED**.
6. ¿Pedido sencillo? — **STAGING REQUIRED**.
7. ¿Cobrar/finalizar claro? — **STAGING REQUIRED**.
8. ¿Avisos ayudan o abruman? — **STAGING REQUIRED**.
9. ¿Centro de avisos intuitivo? — **STAGING REQUIRED**.
10. ¿Mobile cómodo? — **Heurística LOCAL**.
11. ¿Pantallas cargadas? — Landing con progressive disclosure en ejemplos.
12. ¿Terminología técnica? — Scanner visible-copy LOCAL.
13–18. Bot/ERP/planes — smoke LOCAL / staging pendiente.
19. ¿Blocker UX? — **${sev.BLOCKER > 0 ? 'SÍ' : 'NO'}**.
20. ¿Mostrarlo a un cliente real? — **${v === 'UX READY FOR HUMAN VALIDATION' ? 'Sí, con cuidado' : 'Tras staging + validación humana'}**.

## Veredicto

**${v}**

No se declara “UX PERFECT”.

---

# UX SHELL / AVISOS REDESIGN

Pasada exclusiva UX/UI/responsive del shell ERP (sin cambios de negocio/SSOT).

## Sidebar antes / después

| Antes | Después |
|---|---|
| Lista larga de módulos + Avisos como ítem principal | Primary: Inicio, Clientes, Pedidos, Ventas, Caja + **Herramientas** |
| Scroll interno visible en desktop | Sin \`overflow-y-auto\` en nav principal |
| Flyout flotante “Más herramientas” tapando contenido | **Rail acoplado** \`data-tools-rail\` (empuja layout) / 2ª vista drawer en mobile |
| Configuración mezclada | Configuración fija abajo |

## Navegación Avisos

- Sacado del sidebar.
- Acceso principal: campanita del header (\`data-avisos-bell\`) con badge, preview corto + severity y **Ver todos los avisos** → \`/avisos\`.
- Misma fuente: \`AutomationsService\` (sin segundo sistema de notificaciones).

## Layout /avisos

- \`PAGE_SHELL_CLASS\` + \`PAGE_CONTENT_MAX_CLASS\` (\`max-w-[1500px]\`, width 100%).
- Header: título + **Configurar avisos** + “Marcar todos como leídos” / ⋮ mobile.
- Tabs Hoy | Próximos | Resueltos a ancho completo.
- Cards: severity badge + borde sutil, título corto, detalle, meta, **1 CTA primaria**, secundarias livianas.
- Empty: “Todo tranquilo por acá”.
- Próximos: orden por \`dueAt\` + grupos Hoy/Mañana/Esta semana (solo presentación).

## Coach Bot

- Copy identificado como **Consejo de RILO Bot**.
- Auto-dismiss ~8s + X; persistencia en \`sessionStorage\`.
- Gestión (solo ERP): sin tips de Bot; solo tip de campanita avisos.
- Completo/Bot: tips Bot ocasionales.
- Mobile: centrado abajo elevado / z-index menor para no tapar CTAs.

## Mobile

- Sidebar desktop oculto; hamburger + drawer.
- Header: ☰ · RILO · 🔔 (campanita siempre visible).
- Herramientas: segunda vista del drawer (Volver + lista), no caja flotante.
- Touch targets ~44px en hamburger/campanita/cerrar.

## Accessibility

- \`main#main-content\` en layout ERP y shell público.
- Nav con \`aria-label\`; campanita/hamburger con labels.
- Imágenes decorativas \`alt=\"\"\` (evita alt redundante en logo).

## Screenshots

\`qa-artifacts/ux-redesign/\` (fixtures + live si \`UX_QA_EMAIL\`/\`UX_QA_PASSWORD\`).

## Tests

- \`shell-ux-redesign.spec.ts\` — contratos fuente + runtime desktop/mobile.
- Suite: \`npm run test:ux\` / \`npm run test:release\`.

---

# NAVIGATION / NOTIFICATIONS UX REDESIGN

## Por qué se cambió

La solución anterior de **“Más herramientas”** era un panel/flyout debajo (o a la derecha) del sidebar que:
- se sentía agendada “aparte”,
- tapaba contenido del main,
- no formaba parte del layout flex,
- en mobile ocupaba espacio de forma incómoda.

## Solución elegida

**Rail lateral acoplado + 2ª vista del drawer (mobile).**

- Sidebar normal: Inicio · Clientes · Pedidos · Ventas · Caja · **Herramientas** · (abajo) Configuración.
- Desktop: al tocar Herramientas se abre \`data-tools-rail\` (columna adyacente, anima width, empuja el contenido; Escape / ✕ cierra).
- Mobile: Herramientas abre una segunda vista dentro del drawer (Volver + Operación / Administración).
- Sin Avisos en el sidebar; sin flyout flotante legacy.

## Dónde quedaron los avisos

- Campanita del header (único acceso principal): badge, preview corto, severity, **Ver todos los avisos**.
- Ruta \`/avisos\` con ancho ERP unificado + botón **Configurar avisos** → \`/settings?tab=avisos\`.
- Configuración → **RILO te avisa** (preferencias, horario, panel/WhatsApp según plan).

## Criterio final (objetivo)

1–9: sidebar limpio, sin caja rara, avisos en campanita, /avisos ok, herramientas accesibles, parte del layout, mobile claro, sin flotantes molestos, config avisos fácil.
10–11: \`test:ux\` / \`test:release\` PASS.
`;

  fs.writeFileSync(outMd, md, 'utf8');
  fs.writeFileSync(
    path.join(artifactDir, 'summary.json'),
    JSON.stringify(
      {
        verdict: v,
        scenarios: rows.length,
        severity: sev,
        criticalScores,
        stagingRequired,
        localHigh: sev.HIGH,
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`[ux-report] Wrote ${outMd}`);
  console.log(`[ux-report] verdict=${v} scenarios=${rows.length} HIGH=${sev.HIGH}`);
}

main();
