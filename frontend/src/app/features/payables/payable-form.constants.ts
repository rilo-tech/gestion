import type { PayableTipo } from '../../core/services/payables.service';

export interface ObligationPreset {
  id: string;
  label: string;
  beneficiario: string;
  tipo: PayableTipo;
  categoriaId?: string;
}

export const OBLIGATION_PRESETS: ObligationPreset[] = [
  {
    id: 'vps',
    label: 'VPS / hosting',
    beneficiario: 'VPS / Hosting',
    tipo: 'mensual',
    categoriaId: 'servicios_cloud',
  },
  {
    id: 'luz',
    label: 'Luz / agua',
    beneficiario: 'Servicios públicos',
    tipo: 'mensual',
    categoriaId: 'servicios_publicos',
  },
  {
    id: 'alquiler',
    label: 'Alquiler',
    beneficiario: 'Alquiler',
    tipo: 'mensual',
    categoriaId: 'alquiler',
  },
];
