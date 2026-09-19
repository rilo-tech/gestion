import {
  buildCollaboratorsPeriodSummary,
  defaultFromDate,
  defaultToDate,
  getCollaborator,
  isUnvaluedHoursMovement,
  listCollaboratorMovements,
  type CollaboratorMovementRecord,
  type CollaboratorSummaryRow,
} from '../../utils/collaborators.ts';
import type { CollaboratorAccessScope } from '../../utils/collaborator-scope.ts';
import { assertCollaboratorInScope } from '../../utils/collaborator-scope.ts';

export type CollaboratorBalanceResult = {
  colaboradorId: string;
  name: string;
  devengadoLifetime: number;
  pagadoLifetime: number;
  saldoAcumulado: number;
  devengadoPeriodo: number;
  pagadoPeriodo: number;
  pendientePeriodo: number;
  horasPeriodo: number;
  /** Horas del período con importe calculado. */
  valuedHoursPeriodo: number;
  /** Horas del período sin tarifa/importe. */
  unvaluedHoursPeriodo: number;
  /** Horas sin valorar acumuladas (lifetime). */
  unvaluedHoursLifetime: number;
  hasUnvaluedHours: boolean;
  period: { from: string; to: string };
};

export type CollaboratorAccountSummary = {
  colaboradorId: string;
  name: string;
  valorHora?: number;
  period: { from: string; to: string };
  horas: number;
  horasSinValorar: number;
  montoHoras: number;
  montoExtras: number;
  devengado: number;
  pagado: number;
  pendientePeriodo: number;
  saldoAcumulado: number;
  recentMovements: Array<{
    id: string;
    tipo: string;
    fecha: string;
    monto: number;
    horas?: number;
    notas?: string;
  }>;
};

export type CollaboratorHoursSummary = {
  colaboradorId: string;
  name: string;
  period: { from: string; to: string };
  totalHoras: number;
  valuedHours: number;
  unvaluedHours: number;
  montoHoras: number;
  movements: Array<{
    id: string;
    fecha: string;
    horas: number;
    monto?: number;
    valorHora?: number;
    unvalued: boolean;
  }>;
};

function assertScope(scope: CollaboratorAccessScope | undefined, colaboradorId: string): void {
  if (scope) assertCollaboratorInScope(scope, colaboradorId);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function summaryRow(
  summary: Awaited<ReturnType<typeof buildCollaboratorsPeriodSummary>>,
  colaboradorId: string
): CollaboratorSummaryRow | null {
  return summary.colaboradores.find((row) => row.colaboradorId === colaboradorId) ?? null;
}

export async function getCollaboratorBalanceAccurate(
  businessId: string,
  colaboradorId: string,
  options?: { from?: string; to?: string; scope?: CollaboratorAccessScope }
): Promise<CollaboratorBalanceResult | null> {
  const id = String(colaboradorId ?? '').trim();
  if (!id) return null;
  assertScope(options?.scope, id);

  const collaborator = await getCollaborator(businessId, id);
  if (!collaborator) return null;

  const from = String(options?.from ?? defaultFromDate()).slice(0, 10);
  const to = String(options?.to ?? defaultToDate()).slice(0, 10);
  const summary = await buildCollaboratorsPeriodSummary(businessId, from, to, id);
  const row = summaryRow(summary, id);

  const allMovements = await listCollaboratorMovements(businessId, { colaboradorId: id });
  let devengadoLifetime = 0;
  let pagadoLifetime = 0;
  let unvaluedHoursLifetime = 0;
  for (const mov of allMovements) {
    if (mov.tipo === 'horas') {
      const horas = Number(mov.horas) || 0;
      if (isUnvaluedHoursMovement(mov)) {
        unvaluedHoursLifetime += horas;
        continue;
      }
    }
    const monto = Number(mov.monto) || 0;
    if (mov.tipo === 'pago') pagadoLifetime += monto;
    else devengadoLifetime += monto;
  }

  const valuedHoursPeriodo = Math.max(0, (row?.horas ?? 0) - (row?.horasSinValorar ?? 0));

  return {
    colaboradorId: id,
    name: collaborator.nombre,
    devengadoLifetime: round2(devengadoLifetime),
    pagadoLifetime: round2(pagadoLifetime),
    saldoAcumulado: row?.saldoAcumulado ?? round2(devengadoLifetime - pagadoLifetime),
    devengadoPeriodo: row?.devengado ?? 0,
    pagadoPeriodo: row?.pagado ?? 0,
    pendientePeriodo: row?.pendientePeriodo ?? 0,
    horasPeriodo: row?.horas ?? 0,
    valuedHoursPeriodo: round2(valuedHoursPeriodo),
    unvaluedHoursPeriodo: row?.horasSinValorar ?? 0,
    unvaluedHoursLifetime: round2(unvaluedHoursLifetime),
    hasUnvaluedHours: unvaluedHoursLifetime > 0,
    period: { from, to },
  };
}

export async function getCollaboratorAccountSummary(
  businessId: string,
  colaboradorId: string,
  from: string,
  to: string,
  options?: { scope?: CollaboratorAccessScope; movementLimit?: number }
): Promise<CollaboratorAccountSummary | null> {
  const id = String(colaboradorId ?? '').trim();
  if (!id) return null;
  assertScope(options?.scope, id);

  const collaborator = await getCollaborator(businessId, id);
  if (!collaborator) return null;

  const fromDay = String(from ?? defaultFromDate()).slice(0, 10);
  const toDay = String(to ?? defaultToDate()).slice(0, 10);
  const summary = await buildCollaboratorsPeriodSummary(businessId, fromDay, toDay, id);
  const row = summaryRow(summary, id);
  const movements = await listCollaboratorMovements(businessId, {
    colaboradorId: id,
    from: fromDay,
    to: toDay,
  });
  const limit = Math.min(30, Math.max(1, options?.movementLimit ?? 12));

  return {
    colaboradorId: id,
    name: collaborator.nombre,
    valorHora: collaborator.valorHora,
    period: { from: fromDay, to: toDay },
    horas: row?.horas ?? 0,
    horasSinValorar: row?.horasSinValorar ?? 0,
    montoHoras: row?.montoHoras ?? 0,
    montoExtras: row?.montoExtras ?? 0,
    devengado: row?.devengado ?? 0,
    pagado: row?.pagado ?? 0,
    pendientePeriodo: row?.pendientePeriodo ?? 0,
    saldoAcumulado: row?.saldoAcumulado ?? 0,
    recentMovements: movements.slice(0, limit).map(mapMovementBrief),
  };
}

export async function getCollaboratorHoursSummary(
  businessId: string,
  colaboradorId: string,
  from: string,
  to: string,
  options?: { scope?: CollaboratorAccessScope }
): Promise<CollaboratorHoursSummary | null> {
  const id = String(colaboradorId ?? '').trim();
  if (!id) return null;
  assertScope(options?.scope, id);

  const collaborator = await getCollaborator(businessId, id);
  if (!collaborator) return null;

  const fromDay = String(from ?? defaultFromDate()).slice(0, 10);
  const toDay = String(to ?? defaultToDate()).slice(0, 10);
  const movements = (await listCollaboratorMovements(businessId, {
    colaboradorId: id,
    from: fromDay,
    to: toDay,
  })).filter((row) => row.tipo === 'horas');

  let totalHoras = 0;
  let valuedHours = 0;
  let unvaluedHours = 0;
  let montoHoras = 0;
  const items = movements.map((mov) => {
    const horas = Number(mov.horas) || 0;
    const unvalued = isUnvaluedHoursMovement(mov);
    const monto = unvalued ? undefined : Number(mov.monto) || 0;
    totalHoras += horas;
    if (unvalued) unvaluedHours += horas;
    else {
      valuedHours += horas;
      montoHoras += monto ?? 0;
    }
    return {
      id: mov.id,
      fecha: mov.fecha,
      horas,
      monto,
      valorHora: mov.valorHora,
      unvalued,
    };
  });

  return {
    colaboradorId: id,
    name: collaborator.nombre,
    period: { from: fromDay, to: toDay },
    totalHoras: round2(totalHoras),
    valuedHours: round2(valuedHours),
    unvaluedHours: round2(unvaluedHours),
    montoHoras: round2(montoHoras),
    movements: items,
  };
}

export async function listCollaboratorMovementRows(
  businessId: string,
  input: {
    colaboradorId?: string;
    tipo?: 'horas' | 'extra' | 'pago' | null;
    from?: string;
    to?: string;
    scope?: CollaboratorAccessScope;
    limit?: number;
  }
): Promise<{ items: CollaboratorMovementRecord[]; total: number }> {
  const scopedId =
    input.scope?.mode === 'own'
      ? input.scope.colaboradorId
      : String(input.colaboradorId ?? '').trim() || undefined;

  if (input.scope?.mode === 'own' && input.colaboradorId && input.colaboradorId !== input.scope.colaboradorId) {
    throw new Error('No tenés permiso para ver datos de otro colaborador.');
  }

  let rows = await listCollaboratorMovements(businessId, {
    colaboradorId: scopedId,
    from: input.from,
    to: input.to,
  });

  if (input.tipo) rows = rows.filter((row) => row.tipo === input.tipo);
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
  return { items: rows.slice(0, limit), total: rows.length };
}

function mapMovementBrief(mov: CollaboratorMovementRecord) {
  const unvalued = isUnvaluedHoursMovement(mov);
  return {
    id: mov.id,
    tipo: mov.tipo,
    fecha: mov.fecha,
    monto: unvalued ? undefined : Number(mov.monto) || 0,
    horas: mov.horas,
    notas: mov.notas,
    unvalued: mov.tipo === 'horas' ? unvalued : undefined,
  };
}
