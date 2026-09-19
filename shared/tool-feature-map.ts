import type { BusinessFeatureId } from './business-profile.ts';

/** Mapeo capability del agente V4 → feature operativa del BusinessProfile. */
export function featureForAgentCapability(capability: string): BusinessFeatureId | null {
  const c = capability.trim().toLowerCase();
  if (!c) return null;
  if (c.includes('cash') || c === 'register_cash') return 'cash';
  if (c.includes('collaborator')) return 'collaborators';
  if (c.includes('supplier')) return 'suppliers';
  if (c.includes('purchase')) return 'purchases';
  if (c.includes('sale') || c === 'aggregate_sales') return 'sales';
  if (c.includes('order')) return 'orders';
  if (c.includes('stock') || c === 'adjust_stock' || c === 'set_stock') return 'stock';
  if (c.includes('product') || c.includes('visual')) return 'catalog';
  if (c.includes('payable') || c.includes('recurring_expense')) return 'payables';
  if (c.includes('client')) return 'clients';
  return null;
}
