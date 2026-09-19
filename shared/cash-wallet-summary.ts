/**
 * Resumen tipo billetera: ingresos/egresos/balance agrupados por categoría.
 * Puro cálculo sobre movimientos (sin IA).
 */

export type CashWalletMovement = {
  tipo: 'ingreso' | 'egreso';
  monto: number;
  /** Categoría / concepto libre */
  categoria?: string | null;
  concepto?: string | null;
  fecha?: string | null;
};

export type CashWalletCategoryRow = {
  label: string;
  amount: number;
  pct: number;
};

export type CashWalletSummary = {
  periodLabel: string;
  ingresosTotal: number;
  egresosTotal: number;
  balance: number;
  ingresosByCategory: CashWalletCategoryRow[];
  egresosByCategory: CashWalletCategoryRow[];
  movementCount: number;
};

function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function categoryLabel(row: CashWalletMovement): string {
  const raw = String(row.categoria ?? row.concepto ?? '').trim();
  return raw || 'Sin categoría';
}

function groupByCategory(
  rows: CashWalletMovement[],
  tipo: 'ingreso' | 'egreso'
): CashWalletCategoryRow[] {
  const map = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    if (row.tipo !== tipo) continue;
    const amount = money(row.monto);
    if (amount <= 0) continue;
    const label = categoryLabel(row);
    map.set(label, money((map.get(label) ?? 0) + amount));
    total = money(total + amount);
  }
  return [...map.entries()]
    .map(([label, amount]) => ({
      label,
      amount,
      pct: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function buildCashWalletSummary(
  movements: CashWalletMovement[],
  periodLabel: string
): CashWalletSummary {
  let ingresosTotal = 0;
  let egresosTotal = 0;
  for (const row of movements) {
    const amount = money(row.monto);
    if (amount <= 0) continue;
    if (row.tipo === 'ingreso') ingresosTotal = money(ingresosTotal + amount);
    else egresosTotal = money(egresosTotal + amount);
  }
  return {
    periodLabel,
    ingresosTotal,
    egresosTotal,
    balance: money(ingresosTotal - egresosTotal),
    ingresosByCategory: groupByCategory(movements, 'ingreso'),
    egresosByCategory: groupByCategory(movements, 'egreso'),
    movementCount: movements.length,
  };
}

export function formatCashWalletSummaryMessage(summary: CashWalletSummary): string {
  const lines: string[] = [`*${summary.periodLabel}*`, ''];
  lines.push(`Ingresos: $${summary.ingresosTotal.toLocaleString('es-UY')}`);
  for (const row of summary.ingresosByCategory.slice(0, 8)) {
    lines.push(`- ${row.label}: $${row.amount.toLocaleString('es-UY')} (${row.pct}%)`);
  }
  lines.push('');
  lines.push(`Egresos: $${summary.egresosTotal.toLocaleString('es-UY')}`);
  for (const row of summary.egresosByCategory.slice(0, 8)) {
    lines.push(`- ${row.label}: $${row.amount.toLocaleString('es-UY')} (${row.pct}%)`);
  }
  lines.push('');
  const sign = summary.balance >= 0 ? '+' : '';
  lines.push(`Balance: ${sign}$${summary.balance.toLocaleString('es-UY')}`);
  return lines.join('\n');
}
