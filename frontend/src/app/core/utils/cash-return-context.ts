import type { ParamMap } from '@angular/router';

export type CashReturnContext = {
  movementId: string;
  mes: number;
  anio: number;
};

export function parseCashReturnContext(params: ParamMap): CashReturnContext | null {
  if (params.get('returnTo') !== 'cash') return null;

  const movementId = params.get('movementId')?.trim() ?? '';
  if (!movementId) return null;

  const mes = Number(params.get('mes'));
  const anio = Number(params.get('anio'));
  if (!Number.isFinite(mes) || mes < 1 || mes > 12) return null;
  if (!Number.isFinite(anio) || anio < 2000 || anio > 2100) return null;

  return { movementId, mes, anio };
}

export function buildCashReturnQueryParams(ctx: CashReturnContext): Record<string, string> {
  return {
    returnTo: 'cash',
    movementId: ctx.movementId,
    mes: String(ctx.mes),
    anio: String(ctx.anio),
  };
}

export function buildCashReopenQueryParams(ctx: CashReturnContext): Record<string, string> {
  return {
    movementId: ctx.movementId,
    mes: String(ctx.mes),
    anio: String(ctx.anio),
  };
}
