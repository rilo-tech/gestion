import type { Order, OrderLineItem } from '../services/order.service';

export type ClientFormReturnTo = 'clients' | 'orders' | 'sales';

const ORDER_DRAFT_KEY = 'gestion:return:order-draft';
const SALES_DRAFT_KEY = 'gestion:return:sales-draft';

export interface OrderFormDraftSnapshot {
  order: Partial<Order>;
  orderLines: OrderLineItem[];
  pendingClientName: string;
  editingOrderId: string | null;
  isDraftOrder: boolean;
  savedOrderEstado: string;
  orderFormLocked: boolean;
}

export interface SalesFormDraftSnapshot {
  saleModalMode: string;
  saleModalOpen: boolean;
  saleClienteId: string;
  pendingClientName: string;
  draftLines: Array<{
    stockItemId: string;
    cantidad: number;
    precioUnitario: number;
    costoUnitario: number;
    costosExtra: Array<{ nombre: string; costo: number }>;
  }>;
  selectedOrderId: string;
  montoCobrado: number | null;
  medioPago: string;
  saleNotas: string;
  editingSaleId: string | null;
  editingSaleLabel: string;
  editHasExtraCobros: boolean;
  orderFilterClienteId: string;
}

export function saveOrderFormDraft(snapshot: OrderFormDraftSnapshot): void {
  try {
    sessionStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignorar cuotas de almacenamiento.
  }
}

export function readOrderFormDraft(): OrderFormDraftSnapshot | null {
  try {
    const raw = sessionStorage.getItem(ORDER_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OrderFormDraftSnapshot;
  } catch {
    return null;
  }
}

export function clearOrderFormDraft(): void {
  sessionStorage.removeItem(ORDER_DRAFT_KEY);
}

export function saveSalesFormDraft(snapshot: SalesFormDraftSnapshot): void {
  try {
    sessionStorage.setItem(SALES_DRAFT_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignorar cuotas de almacenamiento.
  }
}

export function readSalesFormDraft(): SalesFormDraftSnapshot | null {
  try {
    const raw = sessionStorage.getItem(SALES_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SalesFormDraftSnapshot;
  } catch {
    return null;
  }
}

export function clearSalesFormDraft(): void {
  sessionStorage.removeItem(SALES_DRAFT_KEY);
}

export function parseClientFormReturnTo(value: string | null): ClientFormReturnTo {
  if (value === 'orders' || value === 'sales') return value;
  return 'clients';
}
