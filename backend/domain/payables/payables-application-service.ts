/**
 * Payables application service — create / query / pay.
 * ERP y WhatsApp usan estas funciones (sin lógica paralela).
 */
import {
  createPayableObligation,
  listPayableInstallments,
  setPayableInstallmentPaid,
  type CreatePayableObligationInput,
  type PayableCuotaRecord,
  type PayableDisplayEstado,
  type PayableObligationRecord,
} from '../../utils/payables.ts';

export type PayablesSource = 'erp' | 'whatsapp' | 'system';

export type CreatePayableCommand = {
  businessId: string;
  source: PayablesSource;
  beneficiario: string;
  monto: number;
  fechaVencimiento: string;
  tipo?: 'unico' | 'mensual';
  /** Día del mes para mensual (1-31). */
  dueDay?: number;
  notas?: string;
  ambitoId?: string;
  categoriaId?: string;
};

export type QueryPayablesCommand = {
  businessId: string;
  /** today | week | overdue | month */
  scope: 'today' | 'week' | 'overdue' | 'month' | 'pending';
  /** YYYY-MM when scope=month */
  month?: string;
};

export type PayPayableCommand = {
  businessId: string;
  source: PayablesSource;
  cuotaId: string;
  medioPagoId?: string;
  montoPago?: number;
};

export async function createPayable(command: CreatePayableCommand): Promise<{
  obligation: PayableObligationRecord;
  cuotasCreated: number;
}> {
  const tipo = command.tipo ?? 'unico';
  const input: CreatePayableObligationInput = {
    beneficiario: command.beneficiario.trim(),
    monto: command.monto,
    tipo,
    cantidadCuotas: tipo === 'mensual' ? 1 : 1,
    fechaPrimerVencimiento: command.fechaVencimiento.slice(0, 10),
    notas: command.notas,
    ambito: command.ambitoId,
    categoriaId: command.categoriaId,
    origenTipo: 'manual',
  };
  return createPayableObligation(command.businessId, input);
}

export async function queryPayables(command: QueryPayablesCommand): Promise<
  Array<PayableCuotaRecord & { displayEstado: PayableDisplayEstado }>
> {
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);

  if (command.scope === 'month' && command.month) {
    const { items } = await listPayableInstallments(command.businessId, {
      scope: 'month',
      mes: command.month,
    });
    return items.filter((row) => row.estado !== 'pagada');
  }

  const { items } = await listPayableInstallments(command.businessId, {
    scope: 'all',
  });

  const pending = items.filter((row) => row.estado !== 'pagada');

  if (command.scope === 'today') {
    return pending.filter((row) => String(row.fechaVencimiento).slice(0, 10) === todayKey);
  }

  if (command.scope === 'overdue') {
    return pending.filter(
      (row) =>
        row.displayEstado === 'vencida' ||
        String(row.fechaVencimiento).slice(0, 10) < todayKey
    );
  }

  if (command.scope === 'week') {
    const end = new Date(today);
    end.setDate(end.getDate() + 7);
    const endKey = end.toISOString().slice(0, 10);
    return pending.filter((row) => {
      const due = String(row.fechaVencimiento).slice(0, 10);
      return due >= todayKey && due <= endKey;
    });
  }

  return pending;
}

export async function payPayable(command: PayPayableCommand): Promise<
  PayableCuotaRecord & { displayEstado: PayableDisplayEstado }
> {
  return setPayableInstallmentPaid(command.businessId, command.cuotaId, true, {
    medioPagoId: command.medioPagoId,
    montoPago: command.montoPago,
  });
}

export async function findPayablesByBeneficiaryHint(
  businessId: string,
  hint: string
): Promise<Array<PayableCuotaRecord & { displayEstado: PayableDisplayEstado }>> {
  const key = hint
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  const pending = await queryPayables({ businessId, scope: 'pending' });
  if (!key) return pending;
  return pending.filter((row) => {
    const name = String(row.beneficiario ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '');
    return name.includes(key) || key.includes(name);
  });
}
