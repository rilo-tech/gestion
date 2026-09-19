import type { BusinessFeatureId } from './business-profile.ts';

export const AUTOMATION_CATEGORY_IDS = [
  'business',
  'cash',
  'sales',
  'orders',
  'clients',
  'stock',
  'purchases',
  'suppliers',
  'cards',
  'collaborators',
] as const;

export type AutomationCategoryId = (typeof AUTOMATION_CATEGORY_IDS)[number];

export type AutomationCategoryMeta = {
  id: AutomationCategoryId;
  label: string;
  icon: string;
  /** Feature mínima para mostrar la categoría en el menú */
  requiredFeature: BusinessFeatureId;
};

export const AUTOMATION_CATEGORY_CATALOG: readonly AutomationCategoryMeta[] = [
  { id: 'business', label: 'Resúmenes', icon: '📊', requiredFeature: 'sales' },
  { id: 'cash', label: 'Caja', icon: '💰', requiredFeature: 'cash' },
  { id: 'sales', label: 'Ventas', icon: '🛒', requiredFeature: 'sales' },
  { id: 'orders', label: 'Pedidos', icon: '📋', requiredFeature: 'orders' },
  { id: 'clients', label: 'Cobros', icon: '💵', requiredFeature: 'clients' },
  { id: 'stock', label: 'Stock', icon: '📦', requiredFeature: 'stock' },
  { id: 'purchases', label: 'Compras', icon: '🧾', requiredFeature: 'purchases' },
  { id: 'suppliers', label: 'Proveedores', icon: '🏭', requiredFeature: 'suppliers' },
  { id: 'cards', label: 'Tarjetas', icon: '💳', requiredFeature: 'payables' },
  { id: 'collaborators', label: 'Colaboradores', icon: '👷', requiredFeature: 'collaborators' },
];

export function automationCategoryMeta(id: AutomationCategoryId): AutomationCategoryMeta | undefined {
  return AUTOMATION_CATEGORY_CATALOG.find((row) => row.id === id);
}
