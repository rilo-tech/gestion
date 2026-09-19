import type { TarjetaConfig } from '../../shared/finance-config.ts';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function dateOnly(year: number, monthIndex: number, day: number): string {
  const dom = Math.min(day, lastDayOfMonth(year, monthIndex));
  return `${year}-${pad2(monthIndex + 1)}-${pad2(dom)}`;
}

/** Calcula la primera fecha de vencimiento según día de cierre/vencimiento de la tarjeta. */
export function computeFirstInstallmentDate(
  purchaseDate: string,
  card: Pick<TarjetaConfig, 'diaCierre' | 'diaVencimiento'>
): string | null {
  const diaVenc = Number(card.diaVencimiento);
  if (!Number.isInteger(diaVenc) || diaVenc < 1 || diaVenc > 31) return null;

  const parsed = new Date(`${purchaseDate.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;

  const purchaseDay = parsed.getDate();
  let month = parsed.getMonth();
  let year = parsed.getFullYear();
  const diaCierre = Number(card.diaCierre);

  if (Number.isInteger(diaCierre) && diaCierre >= 1 && diaCierre <= 31) {
    month += purchaseDay > diaCierre ? 2 : 1;
  } else if (purchaseDay > diaVenc) {
    month += 1;
  }

  while (month > 11) {
    month -= 12;
    year += 1;
  }

  return dateOnly(year, month, diaVenc);
}

export function formatPurchaseDateEs(value: string): string {
  const raw = String(value ?? '').slice(0, 10);
  const [year, month, day] = raw.split('-');
  if (!year || !month || !day) return raw;
  return `${day}/${month}/${year}`;
}
