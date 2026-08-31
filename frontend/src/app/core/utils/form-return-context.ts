import type { Order, OrderLineItem } from '../services/order.service';

export type ClientFormReturnTo = 'clients' | 'orders' | 'sales';

const ORDER_DRAFT_KEY = 'gestion:return:order-draft';
const SALES_DRAFT_KEY = 'gestion:return:sales-draft';

export interface OrderFormDraftSnapshot {
  order: Partial<Order>;
  orderLines: OrderLineItem[];
  orderPhotos?: Order['fotos'];
  pendingClientName: string;
  selectedClientLabel?: string;
  editingOrderId: string | null;
  isDraftOrder: boolean;
  savedOrderEstado: string;
  orderFormLocked: boolean;
  savedAt?: number;
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
  saleFecha?: string;
  tipoComprobante?: string;
  editingSaleId: string | null;
  editingSaleLabel: string;
  editHasExtraCobros: boolean;
  orderFilterClienteId: string;
}

export interface PurchaseFormDraftLineSnapshot {
  id: string;
  tipoLinea: string;
  ambito: string;
  productoId?: string;
  productoNombre?: string;
  cantidad: number | null;
  costoUnitario: number | null;
  categoriaId?: string;
  descripcion?: string;
  importe: number | null;
  enOferta?: boolean;
  descuentoOfertaPct?: number | null;
  costoGuardado?: number;
}

export interface PurchaseFormDraftSnapshot {
  purchaseProveedorId: string;
  pendingSupplierName: string;
  purchaseNotas: string;
  purchaseNumeroComprobante: string;
  purchaseFecha: string;
  tipoComprobante: string;
  draftLines: PurchaseFormDraftLineSnapshot[];
  pagoMedioId: string;
  pagoTarjetaId: string;
  pagoCuotas: number;
  pagoFechaPrimerVencimiento: string;
  editingDraftId: string | null;
  editingConfirmedId: string | null;
}

const PURCHASE_DRAFT_KEY = 'gestion:return:purchase-draft';

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

const ORDER_DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function normalizeDraftOrderId(value: string | null | undefined): string | null {
  const id = String(value ?? '').trim();
  return id || null;
}

export function orderFormDraftMatchesRoute(
  draft: OrderFormDraftSnapshot,
  routeOrderId: string | null
): boolean {
  return normalizeDraftOrderId(draft.editingOrderId) === normalizeDraftOrderId(routeOrderId);
}

export function orderFormDraftIsFresh(draft: OrderFormDraftSnapshot): boolean {
  const savedAt = Number(draft.savedAt);
  if (!Number.isFinite(savedAt) || savedAt <= 0) return true;
  return Date.now() - savedAt <= ORDER_DRAFT_MAX_AGE_MS;
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

export function savePurchaseFormDraft(snapshot: PurchaseFormDraftSnapshot): void {
  try {
    sessionStorage.setItem(PURCHASE_DRAFT_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignorar cuotas de almacenamiento.
  }
}

export function readPurchaseFormDraft(): PurchaseFormDraftSnapshot | null {
  try {
    const raw = sessionStorage.getItem(PURCHASE_DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PurchaseFormDraftSnapshot;
  } catch {
    return null;
  }
}

export function clearPurchaseFormDraft(): void {
  sessionStorage.removeItem(PURCHASE_DRAFT_KEY);
}

export function purchaseFormDraftMatchesRoute(
  draft: PurchaseFormDraftSnapshot,
  routeConfirmedId: string | null,
  draftIdFromQuery: string | null
): boolean {
  if (routeConfirmedId) {
    return draft.editingConfirmedId === routeConfirmedId;
  }
  if (draftIdFromQuery) {
    return draft.editingDraftId === draftIdFromQuery && !draft.editingConfirmedId;
  }
  return !draft.editingConfirmedId && !draft.editingDraftId;
}

export function parseClientFormReturnTo(value: string | null): ClientFormReturnTo {
  if (value === 'orders' || value === 'sales') return value;
  return 'clients';
}
