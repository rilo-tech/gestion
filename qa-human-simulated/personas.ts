/**
 * Personas de QA humano simulado (RiloTech).
 * No son tenants reales — guían escenarios y scoring.
 */

export type UxPersonaId = 'ana' | 'carla' | 'martin' | 'diego_bot' | 'lucia_completo';

export type UxPersona = {
  id: UxPersonaId;
  name: string;
  label: string;
  planHint: 'bot' | 'gestion' | 'completo' | 'caja' | 'any';
  techComfort: 'low' | 'medium' | 'high';
  goals: string[];
  entry: string;
};

export const UX_PERSONAS: UxPersona[] = [
  {
    id: 'ana',
    name: 'Ana',
    label: 'No soy tecnológica',
    planHint: 'any',
    techComfort: 'low',
    goals: [
      'Registrarse',
      'Registrar una venta',
      'Saber cuánto vendió',
      'Ver quién le debe',
      'Saber qué tiene para hoy',
    ],
    entry: '/',
  },
  {
    id: 'carla',
    name: 'Carla',
    label: 'Trabajo por pedidos',
    planHint: 'completo',
    techComfort: 'medium',
    goals: [
      'Crear pedido',
      'Cobrar seña',
      'Ver entrega',
      'Estados: en proceso → listo → entregado',
      'Cobrar saldo',
    ],
    entry: '/registro?producto=completo',
  },
  {
    id: 'martin',
    name: 'Martín',
    label: 'Comercio',
    planHint: 'gestion',
    techComfort: 'medium',
    goals: ['Venta', 'Stock', 'Compra', 'Producto bajo', 'Aviso', 'Caja'],
    entry: '/registro?producto=gestion',
  },
  {
    id: 'diego_bot',
    name: 'Diego',
    label: 'Solo quiero el Bot',
    planHint: 'bot',
    techComfort: 'low',
    goals: ['Operar por WhatsApp', 'Ver Resumen web', 'Sin módulos ERP a medias'],
    entry: '/registro?producto=bot',
  },
  {
    id: 'lucia_completo',
    name: 'Lucía',
    label: 'Quiero administrar todo',
    planHint: 'completo',
    techComfort: 'high',
    goals: ['WhatsApp + ERP mismo sistema', 'Sin banners de upgrade'],
    entry: '/registro?producto=completo',
  },
];

export function personaById(id: UxPersonaId): UxPersona {
  const row = UX_PERSONAS.find((p) => p.id === id);
  if (!row) throw new Error(`Persona desconocida: ${id}`);
  return row;
}
