import { Pipe, PipeTransform } from '@angular/core';

/** Formatea un monto en pesos con exactamente dos decimales (es-AR). */
export function formatMoneyValue(value: unknown, withSymbol = true): string {
  const formatted = Number(value ?? 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withSymbol ? `$${formatted}` : formatted;
}

@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, withSymbol = true): string {
    return formatMoneyValue(value, withSymbol);
  }
}
