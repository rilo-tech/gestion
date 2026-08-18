import { TRIAL_RUBROS, type TrialRubroId } from './trial-registration.ts';

export type WhatsappCopy = {
  rubro: TrialRubroId | null;
  /** True only when we have a concrete rubro (not empty / otro). */
  hasProductExamples: boolean;
  productHint: string;
  exampleSale: string;
  exampleOrder: string;
  exampleProduct: string;
  exampleProductOther: string;
};

const GENERIC: WhatsappCopy = {
  rubro: null,
  hasProductExamples: false,
  productHint:
    'Nombrá lo que vendés como lo usás vos. Si hay variantes, agregá el detalle que las distingue.',
  exampleSale: 'Venta a María Silva, lo que vendiste, cobró 180',
  exampleOrder: 'Pedido para Juan Pérez, lo que pidió, $180, entrega el viernes',
  exampleProduct: 'lo que vendés $180',
  exampleProductOther: 'otra cosa que vendés',
};

const BY_RUBRO: Record<Exclude<TrialRubroId, 'otro'>, Omit<WhatsappCopy, 'rubro' | 'hasProductExamples'>> = {
  personalizados: {
    productHint:
      'El producto puede ser simple. Si hay variantes, agregá el detalle que las distingue (talle, color, personalización).',
    exampleSale: 'Venta a María Silva, remera blanca L con nombre, cobró 1800',
    exampleOrder: 'Pedido para Juan Pérez, taza blanca con foto, $800, entrega el viernes',
    exampleProduct: 'remera blanca L $1800',
    exampleProductOther: 'taza blanca con foto $800',
  },
  ropa: {
    productHint:
      'El producto puede ser simple. Si hay variantes, agregá talle, color u otro detalle que las distingue.',
    exampleSale: 'Venta a María Silva, jean azul 42, cobró 2500',
    exampleOrder: 'Pedido para Juan Pérez, campera negra M, $4200, entrega el viernes',
    exampleProduct: 'jean azul 42 $2500',
    exampleProductOther: 'campera negra M',
  },
  almacen: {
    productHint:
      'El producto puede ser simple. Si hay variantes, agregá peso, marca u otro detalle que las distingue.',
    exampleSale: 'Venta a María Silva, 1 kilo de fideos, cobró 180',
    exampleOrder: 'Pedido para Juan Pérez, aceite 1.5 L, $250, entrega el viernes',
    exampleProduct: '1 kilo de fideos $180',
    exampleProductOther: 'aceite 1.5 L',
  },
  comida: {
    productHint:
      'El producto puede ser simple. Si hay variantes, agregá peso, porción u otro detalle que las distingue.',
    exampleSale: 'Venta a María Silva, 2 kg de asado, cobró 1800',
    exampleOrder: 'Pedido para Juan Pérez, menú del día, $450, entrega el viernes',
    exampleProduct: '2 kg de asado $1800',
    exampleProductOther: 'menú del día',
  },
  servicios: {
    productHint:
      'Nombrá el servicio como lo cobrás. Si hay variantes, agregá el detalle que las distingue (duración, tipo, domicilio).',
    exampleSale: 'Venta a María Silva, corte de pelo, cobró 800',
    exampleOrder: 'Pedido para Juan Pérez, consulta a domicilio, $1500, entrega el viernes',
    exampleProduct: 'corte de pelo $800',
    exampleProductOther: 'consulta a domicilio',
  },
};

const KNOWN_IDS = new Set<string>(TRIAL_RUBROS.map((r) => r.id).filter((id) => id !== 'otro'));

export function normalizeWhatsappRubro(rubro?: string | null): TrialRubroId | null {
  const id = String(rubro ?? '').trim().toLowerCase();
  if (!id || id === 'otro') return null;
  if (KNOWN_IDS.has(id)) return id as TrialRubroId;
  return null;
}

/** Copy for RiloBot. Without a known rubro, never invents a product name. */
export function whatsappCopyForRubro(rubro?: string | null): WhatsappCopy {
  const id = normalizeWhatsappRubro(rubro);
  if (!id || id === 'otro') return GENERIC;
  const specific = BY_RUBRO[id as Exclude<TrialRubroId, 'otro'>];
  if (!specific) return GENERIC;
  return {
    rubro: id,
    hasProductExamples: true,
    ...specific,
  };
}

export function productExamplesLine(copy: WhatsappCopy): string {
  if (!copy.hasProductExamples) {
    return 'Mandame el nombre como lo vendés, y el precio si querés.';
  }
  return `Ej: ${copy.exampleProduct}  ·  o  ${copy.exampleProductOther}`;
}
