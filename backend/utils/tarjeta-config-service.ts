import { db } from '../firebase.ts';
import {
  findTarjetaInConfig,
  normalizeFinanzasConfig,
  normalizeTarjetas,
  type TarjetaConfig,
} from './finance-config.ts';

export type TarjetaConfigPatch = {
  diaVencimiento?: number;
  diaCierre?: number;
  label?: string;
  emisor?: string;
};

export async function updateTarjetaConfig(
  businessId: string,
  tarjetaId: string,
  patch: TarjetaConfigPatch
): Promise<TarjetaConfig> {
  const ref = db.doc(`negocios/${businessId}/config/app`);
  const snap = await ref.get();
  const finanzasRaw = (snap.data()?.finanzas as Record<string, unknown>) ?? {};
  const finanzas = normalizeFinanzasConfig(finanzasRaw);
  const existing = findTarjetaInConfig(finanzas.tarjetas, tarjetaId);
  if (!existing) {
    throw new Error('Tarjeta no encontrada.');
  }

  const updated: TarjetaConfig = { ...existing };
  if (patch.label?.trim()) updated.label = patch.label.trim();
  if (patch.emisor?.trim()) updated.emisor = patch.emisor.trim();
  if (Number.isInteger(patch.diaVencimiento) && patch.diaVencimiento! >= 1 && patch.diaVencimiento! <= 31) {
    updated.diaVencimiento = patch.diaVencimiento;
  }
  if (Number.isInteger(patch.diaCierre) && patch.diaCierre! >= 1 && patch.diaCierre! <= 31) {
    updated.diaCierre = patch.diaCierre;
  }

  const tarjetas = finanzas.tarjetas.map((row) => (row.id === updated.id ? updated : row));
  await ref.set(
    {
      finanzas: {
        ...finanzasRaw,
        tarjetas: normalizeTarjetas(tarjetas, finanzas.mediosPago),
      },
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  return updated;
}
