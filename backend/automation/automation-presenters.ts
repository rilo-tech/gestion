import type { AutomationExecuteResult } from '../../shared/automation-types.ts';

export function formatAutomationMessage(result: AutomationExecuteResult): string {
  const lines = [`*${result.title}*`, '', ...result.lines];
  return lines.join('\n').trim();
}

export function formatAutomationListItem(label: string, detail: string): string {
  return `• ${label} · ${detail}`;
}

export function formatAutomationsListMenu(
  items: Array<{ index: number; icon: string; label: string; detail: string }>
): string {
  const lines = items.map((item) => `${item.index}. ${item.icon} ${item.label} · ${item.detail}`);
  return ['*⏰ Tus automatizaciones*', '', ...lines, '', 'Elegí una opción.'].join('\n');
}

export function formatAutomationDetailMenu(
  title: string,
  summaryLines: string[],
  statusLabel: string
): string {
  return [
    `*${title}*`,
    '',
    ...summaryLines,
    `• Estado: ${statusLabel}`,
    '',
    '1. ✏️ Modificar',
    '2. ⏸️ Pausar',
    '3. 🗑️ Cancelar',
    '0. ↩️ Volver',
  ].join('\n');
}

export function formatAutomationConfirmation(title: string, summaryLines: string[]): string {
  return [`*⏰ ${title}*`, '', ...summaryLines, '', '¿Confirmo? Sí / No'].join('\n');
}
