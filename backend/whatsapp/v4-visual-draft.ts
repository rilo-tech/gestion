import { loadCajaConfig } from '../domain/cash/index.ts';
import { findClient } from '../domain/client/index.ts';
import { createProduct, findProduct } from '../domain/stock/index.ts';
import { findSupplier } from '../domain/supplier/index.ts';
import {
  medioPagoGeneratesImmediateCash,
  medioPagoRequiereCuentaHija,
} from '../utils/finance-config.ts';
import { findSupplierProductMapping, mappingExternalDescription, normalizeExternalDescription } from './product-aliases.ts';
import { normalizeCandidateResult } from './entity-candidate-result.ts';
import {
  cardsForMedio,
  loadPurchasePaymentContext,
  matchMedioFromText,
  type PurchasePaymentContext,
} from './purchase-payment.ts';
import { resolveCashAccountFromCaja } from './resolve-cash-account.ts';
import { effectiveDefaultCashAccountId, loadBusinessOperationalDefaults } from './business-defaults.ts';
import { logAutoResolve } from './resolution-policy.ts';
import { isDeterministicNo, isDeterministicYes, V4_CONFIRM_INTENT } from './v4-confirm.ts';
import {
  computeFirstInstallmentDate,
  formatPurchaseDateEs,
} from '../utils/card-payment-schedule.ts';
import {
  findTarjetaInConfig,
  loadFinanzasConfig,
  medioPagoGeneratesPayables,
} from '../utils/finance-config.ts';
import {
  catalogCostFromTaxSnapshot,
  resolvePurchaseLineTax,
} from '../utils/purchase-tax.ts';
import {
  detectLinePriceTaxMode,
  inferDocumentTaxRate,
  inferTaxRateFromLineSumToGross,
  purchaseTotalMismatch,
  roundPurchaseMoney,
} from '../utils/purchase-document-totals.ts';
import { updateTarjetaConfig } from '../utils/tarjeta-config-service.ts';
import type { AgentOperationPlan, AgentPlannedWrite } from './agent/tool-types.ts';
import type { ConversationState } from './conversation-state.ts';
import type { ToolExecutionContext } from './agent/tool-types.ts';
import {
  type CandidateSelectionAwaiting,
  type CandidateSelectionOption,
  type CandidateSelectionResume,
  buildCandidateSelectionState,
  normalizeCandidateRows,
  parseNumericSelectionTurn,
  getCandidateSelectionAwaiting,
  resolveCandidateSelectionTurn,
} from './v4-candidate-selection.ts';
import { formatWhatsappMessage, waBold, WA_CHOICE_PAGE_SIZE } from '../../shared/whatsapp-format.ts';
import { WA_ICON } from '../../shared/whatsapp-visual.ts';
import { pageChoicePool, presentFamilyVariantMissing } from './catalog-rank.ts';
import {
  MAX_DOCUMENT_INTERPRETATION_ATTEMPTS,
  VISUAL_TAX_PRICES_EXCLUDE_IVA,
  VISUAL_TAX_PRICES_INCLUDE_IVA,
  applyTaxPresentationToDraftFields,
  buildTaxPresentationAmbiguityCandidates,
  isFinancialOnlyLine,
  mapTaxPresentationToPriceTaxMode,
  presentTaxPresentationAmbiguityAsk,
  reconcileFinancialDocument,
  type DocumentUnderstanding,
  type DocumentTaxBucket,
} from './document-understanding.ts';
import { V4_CANDIDATE_SELECTION_PROMPT, V4_CONFIRMATION_PROMPT, V4_PRODUCT_CANDIDATE_ASK } from './v4-ui-copy.ts';
import { ensureSingleListAsk } from '../../shared/whatsapp-visual.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';

export const VISUAL_DRAFT_TTL_MS = 45 * 60 * 1000;

export const VISUAL_NOT_FOUND_CREATE = '__visual_create__';
export const VISUAL_NOT_FOUND_FREE = '__visual_free_line__';
export const VISUAL_NOT_FOUND_DISCARD = '__visual_discard__';
/** @deprecated Free-text search replaces this numbered option. Kept for resume compat. */
export const VISUAL_NOT_FOUND_LINK = '__visual_link_existing__';
export const VISUAL_MANUAL_MATCH_BACK = '__visual_manual_back__';
/** @deprecated Pagination via free text / Agent. Kept for resume compat. */
export const VISUAL_MORE_OPTIONS = '__visual_more_options__';
export const VISUAL_CREATE_USE_REMITO_NAME = '__visual_create_use_remito__';
export const VISUAL_CANDIDATE_CANCEL = '__visual_candidate_cancel__';
export const VISUAL_CANDIDATE_BACK = '__visual_candidate_back__';
export const VISUAL_REVIEW_CHANGE = '__visual_review_change__';
export const VISUAL_REVIEW_CONTINUE = '__visual_review_continue__';
export const VISUAL_REVIEW_CANCEL = '__visual_review_cancel__';
export const VISUAL_EDIT_ITEM_BACK = '__visual_edit_item_back__';
export const VISUAL_PAYMENT_BACK = '__visual_payment_back__';
export {
  VISUAL_TAX_PRICES_INCLUDE_IVA,
  VISUAL_TAX_PRICES_EXCLUDE_IVA,
} from './document-understanding.ts';

export type VisualDraftWorkflowPhase =
  | 'resolving_items'
  | 'reviewing_items'
  | 'resolving_payment'
  | 'awaiting_confirmation';

export type VisualCatalogAwaiting = {
  type:
    | 'unresolved_catalog_item'
    | 'catalog_product_match_query'
    | 'manual_product_match_search'
    | 'visual_product_candidate_agent'
    | 'create_product_name';
  draftId: string;
  itemIndex: number;
  extractedDescription?: string;
};

export const VISUAL_CATALOG_MATCH_PROMPT =
  'Escribime cómo querés buscar este producto.';

export const VISUAL_CREATE_PRODUCT_NAME_PROMPT =
  'Si querés otro nombre, escribilo ahora.';

export type VisualMatchStatus = 'resolved' | 'ambiguous' | 'not_found' | 'discarded' | 'unresolved';
export type VisualSelectionSource = 'auto' | 'user_selected' | 'created' | 'discarded' | 'supplier_mapping';
export type VisualDraftKind = 'purchase' | 'order';
export type VisualDraftStatus =
  | 'draft'
  | 'awaiting_resolution'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'cancelled'
  | 'executed';
export type VisualReadability = 'ok' | 'partial' | 'unreadable';

export type VisualDraftItemAttributes = {
  type?: string | null;
  fabric?: string | null;
  model?: string | null;
  color?: string | null;
  size?: string | null;
  variant?: string | null;
};

export type VisualDraftItem = {
  index: number;
  sourceText: string;
  description: string;
  quantity?: number;
  unitCost?: number;
  unitCostNet?: number;
  taxRate?: number;
  taxAmount?: number;
  grossUnitCost?: number;
  priceTaxMode?: 'net' | 'gross' | 'unknown';
  subtotal?: number;
  attributes?: VisualDraftItemAttributes;
  notes?: string;
  confidence?: number;
  missing?: string[];
  matchStatus: VisualMatchStatus;
  /** Clasificación de matching (FAMILY_MATCH_VARIANT_MISSING, AMBIGUOUS, …). */
  matchKind?: string;
  missingVariant?: string;
  familyLabel?: string;
  matchedProductId?: string;
  matchedProductName?: string;
  matchConfidence?: number;
  selectionSource?: VisualSelectionSource;
  manualLinkPending?: boolean;
  candidates?: Array<{ id: string; name: string }>;
  /** Pool completo de candidatos confiables (paginado en `candidates`). */
  candidatePool?: Array<{ id: string; name: string }>;
  candidateOffset?: number;
  unresolvedAction?: 'create' | 'free_line' | 'discard' | null;
  proposedSupplierMapping?: {
    supplierId: string;
    externalDescription: string;
    productId: string;
    productName: string;
  };
};

export type VisualDocumentDraft = {
  id: string;
  kind: VisualDraftKind;
  status: VisualDraftStatus;
  createdAt: string;
  expiresAt: string;
  sourceMessageIds: string[];
  readability?: VisualReadability;
  notes?: string;
  supplierHint?: string;
  supplierId?: string;
  supplierName?: string;
  supplierMatchStatus?: VisualMatchStatus;
  date?: string;
  invoiceNumber?: string;
  total?: number;
  paymentStatus?: string;
  paymentMedioId?: string;
  paymentMedioLabel?: string;
  paymentTarjetaId?: string;
  paymentTarjetaLabel?: string;
  paymentCuotas?: number;
  paymentDueDate?: string;
  cashAccountId?: string;
  cashAccountLabel?: string;
  priceTaxMode?: 'net' | 'gross' | 'unknown';
  documentTaxRate?: number;
  documentNetTotal?: number;
  documentTaxTotal?: number;
  documentGrossTotal?: number;
  /** Cantidad de artículos del comprobante (si la IA la extrajo). */
  articleCount?: number;
  taxBreakdown?: DocumentTaxBucket[];
  /** true cuando el usuario aclaró neto/bruto o el reconciler cerró. */
  taxPresentationResolved?: boolean;
  interpretationAttempts?: number;
  clientHint?: string;
  clientId?: string;
  clientName?: string;
  clientMatchStatus?: VisualMatchStatus;
  deliveryDate?: string;
  deposit?: number;
  items: VisualDraftItem[];
  itemsReviewAcknowledged?: boolean;
  editItemMode?: boolean;
  workflowPhase?: VisualDraftWorkflowPhase;
};

export type VisualDraftDeps = {
  findProduct?: typeof findProduct;
  findClient?: typeof findClient;
  findSupplier?: typeof findSupplier;
  findSupplierProductMapping?: typeof findSupplierProductMapping;
  loadPurchasePaymentContext?: typeof loadPurchasePaymentContext;
  createProduct?: typeof createProduct;
};

export type IngestVisualDocumentArgs = {
  kind?: string;
  append?: boolean | null;
  replace?: boolean | null;
  readability?: string | null;
  notes?: string | null;
  supplierHint?: string | null;
  date?: string | null;
  invoiceNumber?: string | null;
  total?: number | null;
  documentNetTotal?: number | null;
  documentTaxTotal?: number | null;
  documentGrossTotal?: number | null;
  documentTaxRate?: number | null;
  priceTaxMode?: string | null;
  /** Alias semántico del modelo: net_prices | gross_prices | unknown */
  taxPresentation?: string | null;
  articleCount?: number | null;
  taxBreakdown?: unknown;
  interpretationAttempt?: number | null;
  paymentStatus?: string | null;
  clientHint?: string | null;
  deliveryDate?: string | null;
  deposit?: number | null;
  items?: unknown;
};

export function suggestedProductCreateName(item: Pick<VisualDraftItem, 'description' | 'sourceText'>): string {
  return asTrimmed(item.description) || asTrimmed(item.sourceText) || 'Producto';
}

/** Acciones del menú de matching — números solo para decisiones claras (sin Ver más / Buscar). */
export function buildProductMatchFooterActions(
  draft: Pick<VisualDocumentDraft, 'kind'>,
  item: VisualDraftItem,
  opts: {
    hasMore?: boolean;
    offset?: number;
    includeDiscard?: boolean;
    /** Si el exacto no existe (family missing / ambiguous / not_found). Default true. */
    allowCreate?: boolean;
    allowSearch?: boolean;
    allowFreeLine?: boolean;
  }
): Array<{ id: string; name: string }> {
  const suggested = suggestedProductCreateName(item);
  const allowCreate = opts.allowCreate !== false;
  const allowFreeLine = opts.allowFreeLine !== false && draft.kind === 'purchase';
  const includeDiscard = opts.includeDiscard !== false && draft.kind === 'purchase';
  const offset = Math.max(0, Number(opts.offset) || 0);
  const actions: Array<{ id: string; name: string }> = [];
  if (allowCreate) {
    actions.push({ id: VISUAL_NOT_FOUND_CREATE, name: `➕ Crear "${suggested}"` });
  }
  if (allowFreeLine) {
    actions.push({ id: VISUAL_NOT_FOUND_FREE, name: '🧰 Registrar como insumo sin stock' });
  }
  if (includeDiscard) {
    actions.push({ id: VISUAL_NOT_FOUND_DISCARD, name: '🗑️ Descartar del documento' });
  }
  if (offset > 0) {
    actions.push({ id: VISUAL_CANDIDATE_BACK, name: '↩️ Volver' });
  } else {
    actions.push({
      id: VISUAL_CANDIDATE_CANCEL,
      name: draft.kind === 'purchase' ? '❌ Cancelar compra' : '❌ Cancelar',
    });
  }
  return actions;
}

export function isVisualMatchActionId(id: string): boolean {
  return String(id ?? '').startsWith('__visual_');
}

export function countUnresolvedVisualItems(draft: VisualDocumentDraft): number {
  return draft.items.filter((item) => {
    if (item.matchStatus === 'discarded' || item.unresolvedAction === 'discard') return false;
    if (item.matchStatus === 'resolved' && (item.matchedProductId || item.unresolvedAction === 'free_line')) {
      return false;
    }
    if (item.unresolvedAction === 'create' && item.selectionSource === 'created' && item.matchedProductId) {
      return false;
    }
    return (
      item.matchStatus === 'ambiguous' ||
      item.matchStatus === 'not_found' ||
      item.matchStatus === 'unresolved' ||
      item.unresolvedAction === 'create'
    );
  }).length;
}

export type ResolutionLeadMode = 'start' | 'continue' | 'resume' | 'none';

export function buildProductResolutionLead(
  draft: VisualDocumentDraft,
  issue: { itemIndex?: number },
  mode: ResolutionLeadMode
): string | null {
  if (mode === 'none' || issue.itemIndex == null) return null;
  const item = draft.items.find((row) => row.index === issue.itemIndex);
  if (!item) return null;
  const label = asTrimmed(item.description) || asTrimmed(item.sourceText) || `Ítem ${item.index}`;
  const nameLine = `${WA_ICON.products} ${waBold(label)}`;
  const pending = countUnresolvedVisualItems(draft);
  const pendingLine =
    pending === 1 ? 'Queda 1 producto por resolver.' : `Quedan ${pending} productos por resolver.`;
  if (mode === 'resume') {
    const resumeLine =
      pending === 1
        ? 'Esta factura ya está cargada. Queda 1 producto por resolver.'
        : `Esta factura ya está cargada. Quedan ${pending} productos por resolver.`;
    return `${resumeLine}\n\n${nameLine}`;
  }
  // start | continue — misma estructura práctica
  return `${pendingLine}\n\n${nameLine}`;
}

function foldDraftKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clave de renglón de remito para propagar la misma decisión a duplicados. */
export function visualItemRemitoKey(item: Pick<VisualDraftItem, 'description' | 'sourceText'>): string {
  return foldDraftKey(item.description) || foldDraftKey(item.sourceText);
}

function isVisualItemStillUnresolved(item: VisualDraftItem): boolean {
  if (item.matchStatus === 'discarded' || item.unresolvedAction === 'discard') return false;
  if (item.matchStatus === 'resolved' && (item.matchedProductId || item.unresolvedAction === 'free_line')) {
    return false;
  }
  if (item.unresolvedAction === 'create' && item.selectionSource === 'created' && item.matchedProductId) {
    return false;
  }
  return (
    item.matchStatus === 'ambiguous' ||
    item.matchStatus === 'not_found' ||
    item.matchStatus === 'unresolved' ||
    item.unresolvedAction === 'create'
  );
}

/**
 * Si el remito trae el mismo nombre en varios renglones, al vincular/descartar uno
 * aplicamos la misma decisión a los demás (conservando cantidad/costo de cada línea).
 */
export function propagateVisualItemDecision(
  draft: VisualDocumentDraft,
  sourceIndex: number
): number {
  const source = draft.items.find((row) => row.index === sourceIndex);
  if (!source) return 0;
  const key = visualItemRemitoKey(source);
  if (!key) return 0;

  const decision:
    | { kind: 'product'; productId: string; productName: string; selectionSource: VisualDraftItem['selectionSource']; unresolvedAction: VisualDraftItem['unresolvedAction']; mapping?: VisualDraftItem['proposedSupplierMapping'] }
    | { kind: 'free_line' }
    | { kind: 'discard' }
    | null =
    source.matchStatus === 'discarded' || source.unresolvedAction === 'discard'
      ? { kind: 'discard' }
      : source.unresolvedAction === 'free_line' && source.matchStatus === 'resolved'
        ? { kind: 'free_line' }
        : source.matchStatus === 'resolved' && source.matchedProductId
          ? {
              kind: 'product',
              productId: source.matchedProductId,
              productName: source.matchedProductName || source.matchedProductId,
              selectionSource: source.selectionSource,
              unresolvedAction: source.unresolvedAction,
              mapping: source.proposedSupplierMapping,
            }
          : null;
  if (!decision) return 0;

  let applied = 0;
  for (const item of draft.items) {
    if (item.index === sourceIndex) continue;
    if (!isVisualItemStillUnresolved(item)) continue;
    if (visualItemRemitoKey(item) !== key) continue;

    if (decision.kind === 'discard') {
      item.matchStatus = 'discarded';
      item.selectionSource = 'discarded';
      item.unresolvedAction = 'discard';
      item.matchedProductId = undefined;
      item.matchedProductName = undefined;
      item.candidates = undefined;
      item.candidatePool = undefined;
      item.candidateOffset = undefined;
      item.manualLinkPending = false;
    } else if (decision.kind === 'free_line') {
      item.unresolvedAction = 'free_line';
      item.matchStatus = 'resolved';
      item.selectionSource = 'created';
      item.matchedProductId = undefined;
      item.matchedProductName = undefined;
      item.candidates = undefined;
      item.candidatePool = undefined;
      item.candidateOffset = undefined;
      item.manualLinkPending = false;
    } else {
      item.matchStatus = 'resolved';
      item.matchedProductId = decision.productId;
      item.matchedProductName = decision.productName;
      item.selectionSource = decision.selectionSource ?? 'user_selected';
      item.unresolvedAction = decision.unresolvedAction ?? null;
      item.manualLinkPending = false;
      item.matchConfidence = 1;
      item.candidates = undefined;
      item.candidatePool = undefined;
      item.candidateOffset = undefined;
      item.matchKind = undefined;
      item.missingVariant = undefined;
      if (decision.mapping) {
        item.proposedSupplierMapping = {
          ...decision.mapping,
          externalDescription: externalDescriptionForMapping(item),
        };
      } else if (draft.supplierId) {
        item.proposedSupplierMapping = {
          supplierId: draft.supplierId,
          externalDescription: externalDescriptionForMapping(item),
          productId: decision.productId,
          productName: decision.productName,
        };
      }
    }
    applied += 1;
  }
  if (applied > 0) {
    console.info(
      '[purchase:item:propagate-same-remito]',
      JSON.stringify({
        draftId: draft.id,
        sourceIndex,
        key,
        decision: decision.kind,
        applied,
      })
    );
  }
  return applied;
}

/** Misma factura ya en borrador: no reprocesar desde cero (solo si sigue vinculando productos). */
export function shouldResumeExistingPurchaseDraft(
  existing: VisualDocumentDraft | null | undefined,
  args: IngestVisualDocumentArgs
): boolean {
  if (!existing || existing.kind !== 'purchase') return false;
  if (!isVisualDraftAlive(existing)) return false;
  if (args.replace === true || args.append === true) return false;
  if (existing.status === 'cancelled' || existing.status === 'committed') return false;
  // Revisión / pago / confirmación: una boleta nueva reinicia el contexto.
  if (
    existing.itemsReviewAcknowledged ||
    existing.status === 'awaiting_confirmation' ||
    existing.workflowPhase === 'resolving_payment' ||
    existing.workflowPhase === 'reviewing_items' ||
    existing.workflowPhase === 'confirming'
  ) {
    return false;
  }
  const pending = countUnresolvedVisualItems(existing);
  if (pending === 0 && existing.status !== 'awaiting_resolution') return false;
  const invoice = asTrimmed(args.invoiceNumber);
  if (invoice && invoice === asTrimmed(existing.invoiceNumber)) return true;
  const incoming = parseIncomingItems(args.items, 1);
  if (!incoming.length || incoming.length !== existing.items.length) return false;
  const matches = incoming.every((inc, idx) => {
    const ex = existing.items[idx];
    if (!ex) return false;
    const a = foldDraftKey(inc.description) || foldDraftKey(inc.sourceText);
    const b = foldDraftKey(ex.description) || foldDraftKey(ex.sourceText);
    return Boolean(a) && a === b;
  });
  return matches;
}

function shouldReplaceExistingVisualDraft(
  existing: VisualDocumentDraft | null | undefined,
  args: IngestVisualDocumentArgs,
  kind: VisualDraftKind
): boolean {
  if (args.replace === true) return true;
  if (args.append === true) return false;
  if (!existing || existing.kind !== kind) return false;
  if (kind !== 'purchase') return false;
  return (
    existing.itemsReviewAcknowledged === true ||
    existing.status === 'awaiting_confirmation' ||
    existing.workflowPhase === 'resolving_payment' ||
    existing.workflowPhase === 'reviewing_items' ||
    existing.workflowPhase === 'confirming' ||
    countUnresolvedVisualItems(existing) === 0
  );
}

/** Candidatos útiles para menú (evita fuzzy irrelevante → Case D). */
const USEFUL_PRODUCT_MATCH_MIN = 40;

export function filterUsefulProductCandidates<T extends { id: string; name: string; score?: number }>(
  candidates: T[]
): T[] {
  if (!candidates.length) return [];
  const scored = candidates.filter((row) => typeof row.score === 'number');
  if (scored.length !== candidates.length) return candidates;
  return candidates.filter((row) => Number(row.score) >= USEFUL_PRODUCT_MATCH_MIN);
}

function candidateRowsFromResolved(
  resolved: { candidates?: Array<{ id: string; name: string; score?: number }> }
): Array<{ id: string; name: string; score?: number }> {
  return filterUsefulProductCandidates(resolved.candidates ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    score: row.score,
  }));
}

/** Costo unitario FINAL (con impuestos) para stock/ERP. */
export function finalUnitCostForVisualItem(item: VisualDraftItem): number {
  if (Number(item.grossUnitCost) > 0) return roundPurchaseMoney(Number(item.grossUnitCost));
  const unit = Number(item.unitCost) || 0;
  const net = Number(item.unitCostNet) || 0;
  // Si unitCost ya es mayor que el neto, asumimos que ya incluye IVA.
  if (unit > 0 && net > 0 && unit > net + 0.009) {
    return roundPurchaseMoney(unit);
  }
  const snap = resolvePurchaseLineTax({
    unitCost: item.unitCost,
    unitCostNet: item.unitCostNet,
    taxRate: item.taxRate,
    priceTaxMode: item.priceTaxMode ?? (net > 0 ? 'net' : undefined),
  });
  const catalog = catalogCostFromTaxSnapshot(snap);
  if (catalog != null && catalog > 0) return catalog;
  return roundPurchaseMoney(unit);
}

export async function createAndLinkVisualDraftProduct(
  businessId: string,
  draft: VisualDocumentDraft,
  itemIndex: number,
  deps: VisualDraftDeps = {},
  opts?: { nameOverride?: string }
): Promise<{ draft: VisualDocumentDraft; created: { id: string; name: string } }> {
  const next: VisualDocumentDraft = {
    ...draft,
    items: draft.items.map((row) => ({ ...row })),
    expiresAt: expiresAtFrom(),
  };
  ensurePurchaseDraftTaxMetadata(next, next.documentTaxRate ?? null);
  const item = next.items.find((row) => row.index === itemIndex);
  if (!item) throw new Error('No encontré el ítem del borrador para crear el producto.');
  const name = asTrimmed(opts?.nameOverride) || suggestedProductCreateName(item);
  const cost = finalUnitCostForVisualItem(item);
  console.info(
    '[purchase:item:create:start]',
    JSON.stringify({ draftId: next.id, itemIndex, name, cost })
  );
  const create = deps.createProduct ?? createProduct;
  let created: { id: string; name: string };
  try {
    created = await create({
      businessId,
      name,
      cost,
      controlsStock: true,
      source: 'whatsapp',
    });
  } catch (err) {
    console.error(
      '[purchase:item:create:error]',
      JSON.stringify({ draftId: next.id, itemIndex, name, error: String(err) })
    );
    throw err;
  }
  item.matchedProductId = created.id;
  item.matchedProductName = created.name;
  item.matchStatus = 'resolved';
  item.selectionSource = 'created';
  item.unresolvedAction = 'create';
  item.manualLinkPending = false;
  item.candidates = undefined;
  item.candidatePool = undefined;
  item.candidateOffset = undefined;
  item.matchKind = undefined;
  item.missingVariant = undefined;
  if (next.supplierId) {
    item.proposedSupplierMapping = {
      supplierId: next.supplierId,
      externalDescription: externalDescriptionForMapping(item),
      productId: created.id,
      productName: created.name,
    };
  }
  propagateVisualItemDecision(next, itemIndex);
  next.status = draftStatusFromItems(next);
  console.info(
    '[purchase:item:create:success]',
    JSON.stringify({
      draftId: next.id,
      itemIndex,
      productId: created.id,
      name: created.name,
      cost,
      mappingProposed: Boolean(item.proposedSupplierMapping),
    })
  );
  return { draft: next, created };
}

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function newDraftId(): string {
  return `vd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function expiresAtFrom(now = Date.now()): string {
  return new Date(now + VISUAL_DRAFT_TTL_MS).toISOString();
}

export function parseVisualDraft(value: unknown): VisualDocumentDraft | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as VisualDocumentDraft;
  if (row.kind !== 'purchase' && row.kind !== 'order') return null;
  if (!Array.isArray(row.items)) return null;
  return row;
}

export function isVisualDraftAlive(draft: VisualDocumentDraft | null | undefined, now = Date.now()): boolean {
  if (!draft) return false;
  if (draft.status === 'cancelled' || draft.status === 'executed') return false;
  const expires = Date.parse(String(draft.expiresAt ?? ''));
  if (Number.isFinite(expires) && expires < now) return false;
  return true;
}

export function liveVisualDraft(state: ConversationState | null | undefined): VisualDocumentDraft | null {
  const draft = parseVisualDraft(state?.visualDraft);
  return isVisualDraftAlive(draft) ? draft : null;
}

/** Borrador persistido aún utilizable (renueva TTL si expiró hace poco en el mismo flujo). */
export function reviveVisualDraft(state: ConversationState | null | undefined): VisualDocumentDraft | null {
  const draft = parseVisualDraft(state?.visualDraft);
  if (!draft) return null;
  if (draft.status === 'cancelled' || draft.status === 'executed') return null;
  const expires = Date.parse(String(draft.expiresAt ?? ''));
  if (Number.isFinite(expires) && expires < Date.now()) {
    draft.expiresAt = expiresAtFrom();
  }
  return draft;
}

const VISUAL_PURCHASE_PAYMENT_ISSUES = new Set([
  'purchase_payment',
  'purchase_payment_card',
  'purchase_cash_account',
]);

export function isVisualPurchasePaymentIssue(issue: VisualDraftIssue | null | undefined): boolean {
  return Boolean(issue?.issueKind && VISUAL_PURCHASE_PAYMENT_ISSUES.has(issue.issueKind));
}

function reindex(items: VisualDraftItem[]): VisualDraftItem[] {
  return items.map((item, idx) => ({ ...item, index: idx + 1 }));
}

function asTrimmed(value: unknown): string {
  return String(value ?? '').trim();
}

function asOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function externalDescriptionForMapping(
  item: Pick<VisualDraftItem, 'description' | 'sourceText'>
): string {
  const description = asTrimmed(item.description);
  if (description) return mappingExternalDescription(description) || description;
  return mappingExternalDescription(asTrimmed(item.sourceText));
}

function foldLoose(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * El usuario dice que ninguno de los candidatos sirve.
 * Debe ir al Agent (candidate_none), no re-buscar como nombre de producto.
 */
export function isCatalogCandidateRejection(text: string): boolean {
  const t = foldLoose(text).replace(/[.!?]+$/g, '').trim();
  if (!t) return false;
  if (/^(no\s+es\s+)?ningun[oa](\s+de\s+(estos|esas|ellos|los\s+dos))?$/.test(t)) return true;
  if (/^ningun[oa]\s+(sirve|es|de\s+estos|de\s+esas)$/.test(t)) return true;
  if (/^no\s+(es\s+)?(ninguno|ninguna|eso|ese|esa|estos|esas)$/.test(t)) return true;
  if (/^(ninguno|ninguna)\s+de\s+la\s+lista$/.test(t)) return true;
  return false;
}

/**
 * Consultas ERP (caja/saldo/deuda/ventas) durante match de producto del remito:
 * no buscar como nombre de catálogo — dejar al Agent con el draft intacto.
 */
export function looksLikeErpQueryInterrupt(text: string): boolean {
  const t = foldLoose(text).replace(/[¿?¡!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\b(cuanto|cuanta)\b/.test(t) && /\b(caja|saldo|vend|debe|stock|tengo|hay)\b/.test(t)) {
    return true;
  }
  if (/\bsaldo\b/.test(t) && /\b(caja|neto|hoy|tengo)\b/.test(t)) return true;
  if (/^(caja|saldo)(\s+(de|hoy|neto|actual))*$/.test(t)) return true;
  return false;
}

/**
 * Extrae el nombre de catálogo cuando el usuario lo enmarca en una frase
 * («está con el nombre X», «se llama X», «nombreCamiseta…»).
 * No es routing de intent: solo limpia el texto del slot de búsqueda de producto.
 */
export function extractCatalogProductQueryFromUserText(text: string): string {
  let raw = asTrimmed(text);
  if (!raw) return '';
  if (isCatalogCandidateRejection(raw)) return '';
  if (looksLikeErpQueryInterrupt(raw)) return '';
  // "nombreCamiseta" / "nombre:Camiseta" → separar el nombre del producto
  raw = raw.replace(/\bnombre\s*(?=[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/gi, 'nombre ');
  raw = raw.replace(/\bnombre\s*[:=]\s*/gi, 'nombre ');
  let out = raw;
  const wrappers: RegExp[] = [
    /^(?:est[aá]|esta)\s+(?:con\s+el\s+nombre|como|bajo\s+el\s+nombre|con\s+nombre|llamad[oa])\s+/i,
    /^(?:lo|la)\s+tengo\s+(?:con\s+el\s+nombre|como|guardad[oa]\s+como|como)\s+/i,
    /^(?:guardad[oa]|registrad[oa]|cargad[oa])\s+(?:con\s+el\s+nombre|como)\s+/i,
    /^(?:el\s+nombre\s+(?:es|que\s+tiene|guardado)|nombre)\s+/i,
    /^(?:se\s+llama|llamad[oa])\s+/i,
    /^(?:busc(?:a|á|alo|ala|ame)|encontr(?:a|á)|probalo\s+(?:como|con)|prob(?:a|á)\s+como)\s+/i,
    /^(?:es\s+el|es\s+la|ser[ií]a)\s+/i,
  ];
  for (const re of wrappers) {
    const next = out.replace(re, '').trim();
    if (next && next !== out) {
      out = next;
      break;
    }
  }
  return asTrimmed(out.replace(/^["“”']+|["“”']+$/g, ''));
}

function tokenizeCatalogQuery(value: string): string[] {
  return foldLoose(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length >= 2);
}

/** Match único contra candidatos ya mostrados (el usuario reescribe el nombre). */
export function matchShownCatalogCandidate(
  query: string,
  candidates: Array<{ id: string; name: string }>
): { id: string; name: string } | null {
  const q = foldLoose(extractCatalogProductQueryFromUserText(query)).replace(/\s+/g, ' ');
  if (!q || q.length < 2) return null;
  const productOnly = candidates.filter((row) => {
    const id = String(row.id ?? '').trim();
    const name = String(row.name ?? '').trim();
    return id.length > 0 && !id.startsWith('__') && name.length > 0;
  });
  if (!productOnly.length) return null;

  const exact = productOnly.filter((row) => foldLoose(row.name).replace(/\s+/g, ' ') === q);
  if (exact.length === 1) return { id: exact[0]!.id, name: exact[0]!.name };

  const qTokens = tokenizeCatalogQuery(q);
  const scored = productOnly
    .map((row) => {
      const n = foldLoose(row.name).replace(/\s+/g, ' ');
      let score = 0;
      if (n === q) score += 100;
      if (n.includes(q) || q.includes(n)) score += 40;
      const nTokens = tokenizeCatalogQuery(n);
      if (qTokens.length && nTokens.length) {
        const overlap = qTokens.filter((tok) => nTokens.includes(tok)).length;
        score += (overlap / Math.max(qTokens.length, nTokens.length)) * 50;
      }
      return { row, score };
    })
    .filter((row) => row.score >= 45)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored.length === 1) return { id: scored[0]!.row.id, name: scored[0]!.row.name };
  // Empate claro del top vs segundo
  if (scored[0]!.score >= scored[1]!.score + 12) {
    return { id: scored[0]!.row.id, name: scored[0]!.row.name };
  }
  return null;
}

/** Prepara confirmación numerada: no vincula hasta que el usuario elija 1. */
export function stageManualProductMatchCandidate(
  item: VisualDraftItem,
  candidate: { id: string; name: string }
): VisualDraftItem {
  const candidates = [{ id: candidate.id, name: candidate.name }];
  return {
    ...item,
    matchStatus: 'ambiguous',
    matchedProductId: undefined,
    matchedProductName: undefined,
    selectionSource: undefined,
    manualLinkPending: true,
    candidates,
    candidatePool: candidates,
    candidateOffset: 0,
    unresolvedAction: null,
  };
}

function catalogProductCandidatesFromContext(
  item: VisualDraftItem | undefined,
  candidateAwaiting?: CandidateSelectionAwaiting | null
): Array<{ id: string; name: string }> {
  const rows: Array<{ id: string; name: string }> = [];
  for (const row of [...(item?.candidatePool ?? []), ...(item?.candidates ?? [])]) {
    rows.push({ id: String(row.id ?? ''), name: String(row.name ?? '') });
  }
  for (const opt of candidateAwaiting?.options ?? []) {
    rows.push({ id: String(opt.entityId ?? ''), name: String(opt.label ?? '') });
  }
  const map = new Map<string, { id: string; name: string }>();
  for (const row of rows) {
    const id = asTrimmed(row.id);
    const name = asTrimmed(row.name).replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (!id || id.startsWith('__') || name.length < 2) continue;
    map.set(id, { id, name });
  }
  return [...map.values()];
}

/**
 * Referencias deícticas al texto del comprobante / pedido de mostrar opciones.
 * NO son un nombre de producto para buscar literalmente.
 */
export function isCatalogDeixisOrShowOptionsRequest(text: string): boolean {
  const t = foldLoose(text).replace(/[.!?]+$/g, '').trim();
  if (!t) return false;
  if (
    /^(si[, ]+)?(es |es el |es la )?(ese|esa|eso)( mismo| misma| producto| que dice( ahi| ahi)?)?$/.test(
      t
    )
  ) {
    return true;
  }
  if (/^(el|la) (mismo|misma)( producto)?$/.test(t)) return true;
  if (/^(ese|esa) (mismo|misma|producto|que dice)/.test(t)) return true;
  if (/^(mostrame|mostrar|dame|ver|pasame) (las )?((opciones|lista|candidatos|matches|productos)( para (matchear|vincular|elegir)?)?)$/.test(t)) {
    return true;
  }
  if (/^(opciones|lista|candidatos)$/.test(t)) return true;
  return false;
}

/** Query real a buscar: si el usuario confirma «ese», usá el texto extraído del ítem. */
export function resolveCatalogSearchQueryFromUserText(input: {
  text: string;
  extractedDescription?: string | null;
  itemDescription?: string | null;
}): { query: string; confirmedExtracted: boolean; showOptions: boolean } {
  const extracted =
    asTrimmed(input.extractedDescription) || asTrimmed(input.itemDescription) || '';
  const raw = asTrimmed(input.text);
  if (isCatalogDeixisOrShowOptionsRequest(raw) && extracted) {
    const folded = foldLoose(raw);
    const confirmed = /^(si\b|es\b|ese\b|esa\b|eso\b|el mismo|la misma)/.test(folded);
    return { query: extracted, confirmedExtracted: confirmed, showOptions: true };
  }
  return {
    query: extractCatalogProductQueryFromUserText(raw),
    confirmedExtracted: false,
    showOptions: false,
  };
}

function productQueryFromItem(item: Pick<VisualDraftItem, 'description' | 'sourceText' | 'attributes'>): string {
  const attrs = item.attributes ?? {};
  const fabric =
    attrs.fabric && foldLoose(String(attrs.fabric)) === 'melange' ? null : attrs.fabric;
  let color = attrs.color ?? null;
  if (color && /melange/i.test(String(color))) color = 'gris';
  if (
    !color &&
    /melange|\bgris\b/i.test(`${item.description ?? ''} ${item.sourceText ?? ''}`)
  ) {
    color = 'gris';
  }
  const base = externalDescriptionForMapping(item);
  return [base, attrs.type, color, attrs.size, attrs.variant, fabric]
    .map((part) => asTrimmed(part))
    .filter(Boolean)
    .join(' ');
}

function parseIncomingItems(raw: unknown, startIndex: number): VisualDraftItem[] {
  if (!Array.isArray(raw)) return [];
  const items: VisualDraftItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const rawSource =
      asTrimmed(item.sourceText) || asTrimmed(item.description ?? item.productDescription);
    const description =
      asTrimmed(item.description ?? item.productDescription) ||
      mappingExternalDescription(rawSource) ||
      rawSource;
    if (!description) continue;
    const attrs: VisualDraftItemAttributes = {
      type: asTrimmed(item.type) || null,
      fabric: asTrimmed(item.fabric) || null,
      model: asTrimmed(item.model) || null,
      color: asTrimmed(item.color ?? item.sizeColor) || null,
      size: asTrimmed(item.size ?? item.talle) || null,
      variant: asTrimmed(item.variant) || null,
    };
    const missing = Array.isArray(item.missing) ? item.missing.map((part) => asTrimmed(part)).filter(Boolean) : [];
    items.push({
      index: startIndex + items.length,
      sourceText: rawSource || description,
      description,
      quantity: asOptionalNumber(item.quantity),
      unitCost: asOptionalNumber(
        item.unitCost ?? item.price ?? item.unitPrice ?? item.displayedUnitPrice
      ),
      unitCostNet: asOptionalNumber(item.unitCostNet ?? item.netUnitCost),
      taxRate: asOptionalNumber(item.taxRate ?? item.ivaRate),
      priceTaxMode:
        item.priceTaxMode === 'net' || item.priceTaxMode === 'gross'
          ? item.priceTaxMode
          : item.displayedPriceBasis === 'net' || item.displayedPriceBasis === 'gross'
            ? item.displayedPriceBasis
            : item.priceTaxMode === 'unknown' || item.displayedPriceBasis === 'unknown'
              ? 'unknown'
              : undefined,
      subtotal: asOptionalNumber(item.subtotal ?? item.displayedLineTotal),
      attributes: attrs,
      notes: asTrimmed(item.notes) || undefined,
      confidence: asOptionalNumber(item.confidence),
      missing: missing.length ? missing : undefined,
      matchStatus: isFinancialOnlyLine(item.lineType ?? item.financialLineType)
        ? 'resolved'
        : 'unresolved',
      unresolvedAction: isFinancialOnlyLine(item.lineType ?? item.financialLineType)
        ? 'free_line'
        : undefined,
      selectionSource: isFinancialOnlyLine(item.lineType ?? item.financialLineType)
        ? 'created'
        : undefined,
    });
  }
  return items;
}

async function matchProductItem(
  businessId: string,
  item: VisualDraftItem,
  utterance: string,
  deps: VisualDraftDeps,
  supplierId?: string | null
): Promise<VisualDraftItem> {
  if (item.matchStatus === 'discarded') return item;
  const mappingDescription = externalDescriptionForMapping(item);
  const supplier = String(supplierId ?? '').trim();
  if (supplier) {
    const lookup = deps.findSupplierProductMapping ?? findSupplierProductMapping;
    const lookupKeys = [
      mappingDescription,
      mappingExternalDescription(asTrimmed(item.sourceText)),
      asTrimmed(item.sourceText),
      asTrimmed(item.description),
    ].filter((value, index, list) => value.length >= 2 && list.indexOf(value) === index);

    for (const key of lookupKeys) {
      const aliased = await lookup(businessId, supplier, key);
      if (aliased?.kind === 'product') {
        console.info(
          '[purchase:item:auto-resolved]',
          JSON.stringify({
            supplierId: supplier,
            externalDescription: key,
            productId: aliased.productId,
            source: 'supplier_mapping',
          })
        );
        return {
          ...item,
          matchStatus: 'resolved',
          matchedProductId: aliased.productId,
          matchedProductName: aliased.productName,
          matchConfidence: 1,
          selectionSource: 'supplier_mapping',
          candidates: undefined,
          unresolvedAction: null,
        };
      }
    }
  }
  const find = deps.findProduct ?? findProduct;
  const query = productQueryFromItem(item);
  if (!query) {
    return { ...item, matchStatus: 'not_found', selectionSource: undefined, matchedProductId: undefined };
  }
  const attrs = item.attributes ?? {};
  let fabric = attrs.fabric ?? null;
  let color = attrs.color ?? null;
  // Remitos Disershop/etc: «GRIS MELANGE» → color gris, no tela inventada.
  if (fabric && foldLoose(String(fabric)) === 'melange') fabric = null;
  const spokenColor = foldLoose(`${color ?? ''} ${item.description ?? ''} ${item.sourceText ?? ''}`);
  if ((!color || /melange/.test(foldLoose(String(color)))) && /melange|\bgris\b/.test(spokenColor)) {
    color = 'gris';
  }
  const resolved = await find(businessId, query, {
    utterance: utterance || query,
    attributes: {
      type: attrs.type ?? null,
      fabric,
      color,
      size: attrs.size ?? null,
    },
    preferChoices: true,
  });
  if (resolved.status === 'resolved' && resolved.entity?.id) {
    console.info(
      '[purchase:item:auto-resolved]',
      JSON.stringify({
        externalDescription: mappingDescription,
        productId: resolved.entity.id,
        source: 'catalog',
      })
    );
    return {
      ...item,
      matchStatus: 'resolved',
      matchKind: 'EXACT',
      matchedProductId: resolved.entity.id,
      matchedProductName: resolved.entity.name,
      matchConfidence: 1,
      selectionSource: 'auto',
      candidates: undefined,
      candidatePool: undefined,
      candidateOffset: undefined,
      missingVariant: undefined,
      familyLabel: undefined,
    };
  }
  if (
    (resolved.status === 'family_variant_missing' ||
      resolved.matchKind === 'FAMILY_MATCH_VARIANT_MISSING') &&
    resolved.candidates?.length
  ) {
    const useful = candidateRowsFromResolved(resolved);
    if (!useful.length) {
      console.info(
        '[purchase:item:no-reliable-match]',
        JSON.stringify({ externalDescription: mappingDescription, query, reason: 'family_pool_weak' })
      );
      return {
        ...item,
        matchStatus: 'not_found',
        matchKind: undefined,
        missingVariant: undefined,
        familyLabel: undefined,
        matchedProductId: undefined,
        matchedProductName: undefined,
        selectionSource: undefined,
        candidates: undefined,
        candidatePool: undefined,
        candidateOffset: undefined,
      };
    }
    const pool = useful.map((row) => ({ id: row.id, name: row.name }));
    const page = pageChoicePool(pool, 0, WA_CHOICE_PAGE_SIZE);
    return {
      ...item,
      matchStatus: 'ambiguous',
      matchKind: 'FAMILY_MATCH_VARIANT_MISSING',
      missingVariant: resolved.missingVariant,
      familyLabel: resolved.familyLabel,
      matchedProductId: undefined,
      matchedProductName: undefined,
      selectionSource: undefined,
      candidates: page.shown,
      candidatePool: pool,
      candidateOffset: 0,
    };
  }
  if (resolved.status === 'ambiguous' && resolved.candidates?.length) {
    const useful = candidateRowsFromResolved(resolved);
    if (!useful.length) {
      console.info(
        '[purchase:item:no-reliable-match]',
        JSON.stringify({ externalDescription: mappingDescription, query, reason: 'ambiguous_weak' })
      );
      return {
        ...item,
        matchStatus: 'not_found',
        matchKind: undefined,
        matchedProductId: undefined,
        matchedProductName: undefined,
        selectionSource: undefined,
        candidates: undefined,
        candidatePool: undefined,
        candidateOffset: undefined,
      };
    }
    const normalized = normalizeCandidateResult(useful.map((row) => ({ id: row.id, name: row.name })));
    if (normalized.status === 'resolved' && normalized.entity?.id) {
      return {
        ...item,
        matchStatus: 'resolved',
        matchKind: 'EXACT',
        matchedProductId: normalized.entity.id,
        matchedProductName: normalized.entity.name,
        matchConfidence: 1,
        selectionSource: 'auto',
        candidates: undefined,
        candidatePool: undefined,
        candidateOffset: undefined,
      };
    }
    if (normalized.status === 'not_found') {
      console.info(
        '[purchase:item:no-reliable-match]',
        JSON.stringify({ externalDescription: mappingDescription, query, reason: 'ambiguous_deduped_empty' })
      );
      return {
        ...item,
        matchStatus: 'not_found',
        matchedProductId: undefined,
        matchedProductName: undefined,
        selectionSource: undefined,
        candidates: undefined,
        candidatePool: undefined,
        candidateOffset: undefined,
      };
    }
    const pool = normalized.candidates!.map((row) => ({ id: row.id, name: row.name }));
    const page = pageChoicePool(pool, 0, WA_CHOICE_PAGE_SIZE);
    return {
      ...item,
      matchStatus: 'ambiguous',
      matchKind: resolved.matchKind === 'FAMILY_MATCH_VARIANT_MISSING' ? 'FAMILY_MATCH_VARIANT_MISSING' : 'AMBIGUOUS',
      matchedProductId: undefined,
      matchedProductName: undefined,
      selectionSource: undefined,
      candidates: page.shown,
      candidatePool: pool,
      candidateOffset: 0,
    };
  }
  console.info(
    '[purchase:item:no-reliable-match]',
    JSON.stringify({ externalDescription: mappingDescription, query, reason: 'catalog_not_found' })
  );
  return {
    ...item,
    matchStatus: 'not_found',
    matchedProductId: undefined,
    matchedProductName: undefined,
    selectionSource: undefined,
    candidates: undefined,
  };
}

export async function rematchUnresolvedDraftItems(
  businessId: string,
  draft: VisualDocumentDraft,
  utterance: string,
  deps: VisualDraftDeps = {}
): Promise<VisualDocumentDraft> {
  const items = await Promise.all(
    draft.items.map((item) => {
      if (item.selectionSource === 'user_selected') return item;
      if (item.matchStatus === 'discarded') return item;
      if (item.unresolvedAction === 'free_line') return item;
      return matchProductItem(businessId, item, utterance, deps, draft.supplierId);
    })
  );
  return {
    ...draft,
    items: reindex(items),
    expiresAt: expiresAtFrom(),
    status: draftStatusFromItems({ ...draft, items: reindex(items) }),
  };
}

async function linkProductByUserQuery(
  businessId: string,
  item: VisualDraftItem,
  userQuery: string,
  deps: VisualDraftDeps,
  options?: { manualSearch?: boolean }
): Promise<{
  item: VisualDraftItem;
  searchStatus: 'resolved' | 'ambiguous' | 'not_found' | 'awaiting_selection';
  matchedName?: string;
  candidates?: Array<{ id: string; name: string }>;
}> {
  const find = deps.findProduct ?? findProduct;
  const manualSearch = options?.manualSearch === true;
  // Búsqueda manual: el usuario escribió el nombre de catálogo — no sesgar con talle/color del remito
  // (si no, «Camiseta … S» sobre un renglón M puede no encontrar el producto que sí existe).
  const resolved = await find(businessId, userQuery, {
    utterance: userQuery,
    preferChoices: true,
    ...(manualSearch
      ? {}
      : {
          attributes: {
            type: item.attributes?.type ?? null,
            fabric: item.attributes?.fabric ?? null,
            color: item.attributes?.color ?? null,
            size: item.attributes?.size ?? null,
          },
        }),
  });
  const preserved = {
    sourceText: item.sourceText,
    description: item.description,
    quantity: item.quantity,
    unitCost: item.unitCost,
    unitCostNet: item.unitCostNet,
    grossUnitCost: item.grossUnitCost,
    taxRate: item.taxRate,
    priceTaxMode: item.priceTaxMode,
    subtotal: item.subtotal,
    attributes: item.attributes,
    notes: item.notes,
    confidence: item.confidence,
    missing: item.missing,
  };
  if (resolved.status === 'resolved' && resolved.entity?.id) {
    if (manualSearch) {
      const candidates = [{ id: resolved.entity.id, name: resolved.entity.name }];
      console.info(
        '[purchase:draft:item-search]',
        JSON.stringify({
          itemIndex: item.index,
          query: userQuery,
          candidateCount: 1,
          manual: true,
        })
      );
      return {
        item: {
          ...item,
          ...preserved,
          matchStatus: 'ambiguous',
          matchedProductId: undefined,
          matchedProductName: undefined,
          selectionSource: undefined,
          manualLinkPending: true,
          candidates,
          candidatePool: candidates,
          candidateOffset: 0,
          unresolvedAction: null,
        },
        searchStatus: 'awaiting_selection',
        candidates,
      };
    }
    return {
      item: {
        ...item,
        ...preserved,
        matchStatus: 'resolved',
        matchKind: 'EXACT',
        matchedProductId: resolved.entity.id,
        matchedProductName: resolved.entity.name,
        matchConfidence: 1,
        selectionSource: 'user_selected',
        manualLinkPending: false,
        candidates: undefined,
        unresolvedAction: null,
      },
      searchStatus: 'resolved',
      matchedName: resolved.entity.name,
    };
  }
  if (
    (resolved.status === 'family_variant_missing' ||
      resolved.matchKind === 'FAMILY_MATCH_VARIANT_MISSING' ||
      resolved.status === 'ambiguous') &&
    resolved.candidates?.length
  ) {
    const useful = candidateRowsFromResolved(resolved);
    if (!useful.length) {
      return {
        item: {
          ...item,
          ...preserved,
          matchStatus: 'not_found',
          matchKind: undefined,
          missingVariant: undefined,
          familyLabel: undefined,
          matchedProductId: undefined,
          matchedProductName: undefined,
          selectionSource: undefined,
          manualLinkPending: false,
          candidates: undefined,
          candidatePool: undefined,
          candidateOffset: undefined,
          unresolvedAction: null,
        },
        searchStatus: 'not_found',
      };
    }
    const pool = useful.map((row) => ({ id: row.id, name: row.name }));
    const page = pageChoicePool(pool, 0, WA_CHOICE_PAGE_SIZE);
    const candidates = page.shown;
    const familyMissing =
      resolved.status === 'family_variant_missing' ||
      resolved.matchKind === 'FAMILY_MATCH_VARIANT_MISSING';
    console.info(
      '[purchase:draft:item-search]',
      JSON.stringify({
        itemIndex: item.index,
        query: userQuery,
        candidateCount: pool.length,
        manual: manualSearch,
        matchKind: familyMissing ? 'FAMILY_MATCH_VARIANT_MISSING' : 'AMBIGUOUS',
      })
    );
    return {
      item: {
        ...item,
        ...preserved,
        matchStatus: 'ambiguous',
        matchKind: familyMissing ? 'FAMILY_MATCH_VARIANT_MISSING' : resolved.matchKind || 'AMBIGUOUS',
        missingVariant: familyMissing ? resolved.missingVariant : undefined,
        familyLabel: familyMissing ? resolved.familyLabel : undefined,
        matchedProductId: undefined,
        matchedProductName: undefined,
        selectionSource: undefined,
        // FAMILY_MATCH usa product_candidate_selection (presentFamilyVariantMissing), no el menú manual.
        manualLinkPending: manualSearch && !familyMissing,
        candidates,
        candidatePool: pool,
        candidateOffset: 0,
        unresolvedAction: null,
      },
      searchStatus: 'awaiting_selection',
      candidates,
    };
  }
  console.info(
    '[purchase:draft:item-search]',
    JSON.stringify({ itemIndex: item.index, query: userQuery, candidateCount: 0, manual: manualSearch })
  );
  // No borrar candidatos útiles ya mostrados: una búsqueda fallida no debe
  // dejar solo Crear/Descartar si el usuario acababa de ver productos reales.
  const previousProducts = [
    ...(item.candidatePool ?? []),
    ...(item.candidates ?? []),
  ].filter((row) => {
    const id = String(row.id ?? '').trim();
    return id.length > 0 && !id.startsWith('__') && String(row.name ?? '').trim().length > 0;
  });
  const uniquePrev = [...new Map(previousProducts.map((row) => [row.id, row])).values()];
  if (uniquePrev.length) {
    const page = pageChoicePool(uniquePrev, 0, WA_CHOICE_PAGE_SIZE);
    return {
      item: {
        ...item,
        ...preserved,
        matchStatus: 'ambiguous',
        matchKind: item.matchKind || 'AMBIGUOUS',
        matchedProductId: undefined,
        matchedProductName: undefined,
        selectionSource: undefined,
        manualLinkPending: true,
        candidates: page.shown,
        candidatePool: uniquePrev,
        candidateOffset: 0,
        unresolvedAction: null,
      },
      searchStatus: 'awaiting_selection',
      candidates: page.shown,
    };
  }
  return {
    item: {
      ...item,
      ...preserved,
      matchStatus: 'not_found',
      matchedProductId: undefined,
      matchedProductName: undefined,
      selectionSource: undefined,
      manualLinkPending: false,
      candidates: undefined,
      candidatePool: undefined,
      candidateOffset: undefined,
      unresolvedAction: null,
    },
    searchStatus: 'not_found',
  };
}

function draftStatusFromItems(draft: VisualDocumentDraft): VisualDraftStatus {
  const active = draft.items.filter((item) => item.matchStatus !== 'discarded');
  if (!active.length) return 'draft';
  if (draft.kind === 'order' && draft.clientMatchStatus === 'ambiguous') return 'awaiting_resolution';
  if (draft.kind === 'purchase' && draft.supplierMatchStatus === 'ambiguous') return 'awaiting_resolution';
  const unresolved = active.some(
    (item) => item.matchStatus === 'ambiguous' || item.matchStatus === 'not_found' || item.matchStatus === 'unresolved'
  );
  if (unresolved) return 'awaiting_resolution';
  if (draft.kind === 'order' && !draft.clientId && draft.clientMatchStatus === 'not_found') return 'awaiting_resolution';
  return 'awaiting_confirmation';
}

function activePurchaseItems(draft: VisualDocumentDraft): VisualDraftItem[] {
  return draft.items.filter(
    (item) => item.matchStatus !== 'discarded' && item.unresolvedAction !== 'discard'
  );
}

export function resetItemForEdit(item: VisualDraftItem): VisualDraftItem {
  return {
    ...item,
    matchStatus: 'not_found',
    matchedProductId: undefined,
    matchedProductName: undefined,
    selectionSource: undefined,
    matchConfidence: undefined,
    candidates: undefined,
    manualLinkPending: false,
    unresolvedAction: null,
    proposedSupplierMapping: undefined,
  };
}

function purchaseItemDisplayName(item: VisualDraftItem): string {
  if (item.unresolvedAction === 'free_line') {
    return asTrimmed(item.description) || externalDescriptionForMapping(item);
  }
  return item.matchedProductName || asTrimmed(item.description) || externalDescriptionForMapping(item);
}

export function buildPurchaseItemReviewBlocks(draft: VisualDocumentDraft): {
  itemLines: string[];
  supplyLines: string[];
} {
  const itemLines: string[] = [];
  const supplyLines: string[] = [];
  for (const item of activePurchaseItems(draft)) {
    const name = purchaseItemDisplayName(item);
    const qty = Math.max(1, Number(item.quantity) || 1);
    const unitNet = item.unitCostNet ?? item.unitCost;
    const lineNet =
      item.subtotal != null
        ? Number(item.subtotal)
        : unitNet != null
          ? qty * Number(unitNet)
          : null;
    const isSupply = item.unresolvedAction === 'free_line';
    const amount = lineNet != null ? ` · $${money(lineNet)}` : '';
    const suffix = isSupply ? ' · insumo' : '';
    const line = `• ${qty} ${name}${amount}${suffix}`;
    if (isSupply) supplyLines.push(line);
    else itemLines.push(line);
  }
  return { itemLines, supplyLines };
}

export function presentVisualPurchaseItemsReview(draft: VisualDocumentDraft): string {
  const supplier = asTrimmed(draft.supplierName || draft.supplierHint) || 'Proveedor';
  const { itemLines, supplyLines } = buildPurchaseItemReviewBlocks(draft);
  const reconcile = reconcilePurchaseDraftItems(draft);
  const lines: string[] = [];
  if (itemLines.length) {
    lines.push(...itemLines);
  }
  if (supplyLines.length) {
    if (itemLines.length) lines.push('');
    lines.push('*Insumos*', ...supplyLines);
  }
  lines.push('');
  lines.push(...purchaseReviewFinancialLines(draft));
  lines.push(`${reconcile.quantityTotal} artículos`);
  lines.push('');
  lines.push('¿Continuar con el pago?');
  lines.push('1. ✅ Continuar');
  lines.push('2. ✏️ Cambiar ítem');
  lines.push('0. ❌ Cancelar compra');
  return formatWhatsappMessage({
    title: `${WA_ICON.purchases} Compra · ${supplier}`,
    lines,
    ask: V4_CANDIDATE_SELECTION_PROMPT,
  });
}

export function buildPurchaseItemsReviewIssue(draft: VisualDocumentDraft): VisualDraftIssue {
  return {
    party: 'review',
    entityType: 'purchase',
    issueKind: 'purchase_items_review',
    candidates: [
      { id: VISUAL_REVIEW_CONTINUE, name: '✅ Continuar' },
      { id: VISUAL_REVIEW_CHANGE, name: '✏️ Cambiar ítem' },
      { id: VISUAL_REVIEW_CANCEL, name: '❌ Cancelar compra' },
    ],
    title: 'review',
  };
}

export function buildPurchaseEditItemIssue(draft: VisualDocumentDraft): VisualDraftIssue {
  const options = activePurchaseItems(draft).map((item) => ({
    id: String(item.index),
    name: purchaseItemDisplayName(item),
  }));
  return {
    party: 'edit_item',
    entityType: 'purchase',
    issueKind: 'purchase_edit_item',
    candidates: [...options, { id: VISUAL_EDIT_ITEM_BACK, name: '↩️ Volver' }],
    title: `${WA_ICON.products} ¿Qué ítem querés cambiar?`,
  };
}

/**
 * Avanza la compra visual tras «Sí, confirmar» en revisión de ítems.
 */
export async function acknowledgePurchaseItemsReviewTurn(input: {
  text: string;
  draft: VisualDocumentDraft;
  tenant: WhatsappTenantContext;
  deps?: VisualDraftDeps;
}): Promise<{ reply: string; statePatch: Partial<ConversationState>; intent: string }> {
  const option = {
    index: 1,
    entityId: VISUAL_REVIEW_CONTINUE,
    label: '✅ Sí, confirmar',
  };
  const updated = applyVisualDraftSelection({
    draft: input.draft,
    option,
    resume: {
      originalUserText: input.text,
      blockedTool: 'ingest_visual_document',
      draftId: input.draft.id,
      party: 'review',
    },
  });
  let next = firstUnresolvedVisualIssue(updated);
  if (!next && updated.kind === 'purchase') {
    next = await resolveVisualDraftBlockingIssue(
      updated,
      input.tenant.businessId,
      undefined,
      input.deps
    );
  }
  if (next) {
    return {
      reply: presentVisualDraftIssueReply(updated, next),
      statePatch: {
        ...buildVisualDraftIssueStatePatch(updated, next, input.text),
        visualDraft: updated,
      },
      intent: 'v4_purchase_review_acknowledged',
    };
  }
  return {
    reply: presentVisualDraft(updated),
    statePatch: {
      pendingIntent: null,
      pendingPayload: null,
      pendingPrompt: null,
      activeTask: null,
      visualDraft: updated,
    },
    intent: 'v4_purchase_review_acknowledged',
  };
}

export function purchaseDraftAwaitingItemsReview(
  draft: VisualDocumentDraft | null | undefined
): boolean {
  if (!draft || draft.kind !== 'purchase') return false;
  if (draft.itemsReviewAcknowledged) return false;
  if (draft.status === 'cancelled' || draft.status === 'executed') return false;
  return !firstUnresolvedVisualIssue(draft);
}

/**
 * Menú «¿Querés confirmar la compra?» (party=review): mapear sí/no libre
 * a las opciones numeradas. Sin esto, «Si» cae al Agent y pierde el draft step.
 */
export function tryResolveVisualReviewSelection(
  text: string,
  awaiting: CandidateSelectionAwaiting
): { kind: 'selected'; option: CandidateSelectionOption } | null {
  if (awaiting.resume.party !== 'review') return null;
  const continueOpt = awaiting.options.find((row) => row.entityId === VISUAL_REVIEW_CONTINUE);
  const cancelOpt = awaiting.options.find((row) => row.entityId === VISUAL_REVIEW_CANCEL);
  if (continueOpt && isDeterministicYes(text)) {
    return { kind: 'selected', option: continueOpt };
  }
  if (cancelOpt && isDeterministicNo(text)) {
    return { kind: 'selected', option: cancelOpt };
  }
  return null;
}

/**
 * Si el Agent contestó «no hay confirmación» y limpió el menú numerado pero el
 * visualDraft sigue en revisión de ítems, un «Sí»/«1» retoma sin rearmar la compra.
 */
export async function tryAcknowledgeOrphanPurchaseItemsReview(input: {
  text: string;
  state: ConversationState | null | undefined;
  tenant: WhatsappTenantContext;
  deps?: VisualDraftDeps;
}): Promise<{ reply: string; statePatch: Partial<ConversationState>; intent: string } | null> {
  const draft = reviveVisualDraft(input.state) ?? liveVisualDraft(input.state);
  if (!purchaseDraftAwaitingItemsReview(draft)) return null;
  const yes = isDeterministicYes(input.text);
  const pickedOne = parseNumericSelectionTurn(input.text).index === 1;
  if (!yes && !pickedOne) return null;
  return acknowledgePurchaseItemsReviewTurn({
    text: input.text,
    draft: draft!,
    tenant: input.tenant,
    deps: input.deps,
  });
}

export function shouldRouteVisualDraftFreeTextToAgent(
  awaiting: CandidateSelectionAwaiting,
  state: ConversationState | null | undefined
): boolean {
  if (!awaiting.resume.draftId || !reviveVisualDraft(state)) return false;
  const taskType = state?.activeTask?.awaiting?.type;
  if (
    taskType === 'catalog_product_match_query' ||
    taskType === 'manual_product_match_search'
  ) {
    return false;
  }
  if (
    awaiting.resume.party === 'review' ||
    awaiting.resume.party === 'edit_item' ||
    awaiting.resume.party === 'payment' ||
    awaiting.resume.party === 'payment_card' ||
    awaiting.resume.party === 'cash_account'
  ) {
    return false;
  }
  // Menú not_found o candidatos de producto: free text → Agent (no regex).
  if (isVisualNotFoundMenuAwaiting(awaiting)) return true;
  if (awaiting.resume.party === 'item' || awaiting.entityType === 'product') {
    return awaiting.options.some(
      (row) => row.entityId && !String(row.entityId).startsWith('__visual_')
    );
  }
  return false;
}

export function firstUnresolvedVisualIssue(draft: VisualDocumentDraft): {
  party:
    | 'item'
    | 'client'
    | 'supplier'
    | 'payment'
    | 'payment_card'
    | 'payment_installments'
    | 'payment_card_config'
    | 'cash_account'
    | 'purchase_total'
    | 'review'
    | 'edit_item';
  itemIndex?: number;
  entityType: 'product' | 'client' | 'supplier' | 'payment' | 'cash_account' | 'purchase';
  issueKind?:
    | 'visual_not_found_menu'
    | 'manual_product_match'
    | 'product_candidate_selection'
    | 'purchase_payment'
    | 'purchase_payment_card'
    | 'purchase_payment_installments'
    | 'purchase_card_due_day'
    | 'purchase_cash_account'
    | 'purchase_total_mismatch'
    | 'purchase_tax_presentation'
    | 'purchase_items_review'
    | 'purchase_edit_item';
  candidates: Array<{ id: string; name: string }>;
  title: string;
} | null {
  for (const item of draft.items) {
    if (item.matchStatus === 'discarded') continue;
    if (item.manualLinkPending && item.matchStatus === 'ambiguous' && item.candidates?.length) {
      const single = item.candidates.length === 1;
      const productRows = item.candidates.filter((row) => !isVisualMatchActionId(row.id));
      return {
        party: 'item',
        itemIndex: item.index,
        entityType: 'product',
        issueKind: 'manual_product_match',
        candidates: [
          ...productRows,
          ...buildProductMatchFooterActions(draft, item, {
            hasMore: false,
            offset: 0,
            includeDiscard: false,
            // Búsqueda manual: exacto no confirmado aún → mantener Crear con texto del remito.
            allowCreate: true,
          }).filter((row) => row.id !== VISUAL_CANDIDATE_CANCEL),
          { id: VISUAL_MANUAL_MATCH_BACK, name: '↩️ Volver' },
        ],
        title: single ? 'Producto encontrado' : 'Productos encontrados',
      };
    }
    if (item.matchStatus === 'ambiguous' && item.candidates?.length && !item.manualLinkPending) {
      const pool = item.candidatePool?.length ? item.candidatePool : item.candidates;
      const offset = Math.max(0, Number(item.candidateOffset) || 0);
      const page = pageChoicePool(pool, offset, WA_CHOICE_PAGE_SIZE);
      const pageCandidates = page.shown.length ? page.shown : item.candidates;
      const exactMissing =
        item.matchKind === 'FAMILY_MATCH_VARIANT_MISSING' ||
        !item.matchedProductId;
      const candidates = [
        ...pageCandidates.filter((row) => !isVisualMatchActionId(row.id)),
        ...buildProductMatchFooterActions(draft, item, {
          hasMore: page.rest.length > 0,
          offset,
          includeDiscard: true,
          allowCreate: exactMissing,
        }),
      ];
      return {
        party: 'item',
        itemIndex: item.index,
        entityType: 'product',
        issueKind: 'product_candidate_selection',
        candidates,
        title: `${WA_ICON.products} Ítem ${item.index} · Producto sin vincular`,
      };
    }
    if (item.matchStatus === 'not_found' && item.unresolvedAction == null) {
      return {
        party: 'item',
        itemIndex: item.index,
        entityType: 'product',
        issueKind: 'visual_not_found_menu',
        candidates: buildProductMatchFooterActions(draft, item, {
          hasMore: false,
          offset: 0,
          includeDiscard: true,
          allowCreate: true,
        }),
        title: `${WA_ICON.products} Ítem ${item.index} · Producto sin vincular`,
      };
    }
  }
  if (draft.kind === 'order' && draft.clientMatchStatus === 'not_found' && draft.clientHint) {
    return {
      party: 'client',
      entityType: 'client',
      candidates: [
        { id: VISUAL_NOT_FOUND_CREATE, name: 'Crear cliente' },
        { id: VISUAL_NOT_FOUND_DISCARD, name: 'Completar el cliente después' },
      ],
      title: `No encontré el cliente "${draft.clientHint}"`,
    };
  }
  return null;
}

export type VisualDraftIssue = NonNullable<ReturnType<typeof firstUnresolvedVisualIssue>>;

export function isVisualNotFoundMenuCandidates(candidates: Array<{ id: string; name: string }>): boolean {
  return candidates.some((row) => row.id === VISUAL_NOT_FOUND_CREATE);
}

function visualDraftItemForMenu(draft: VisualDocumentDraft, itemIndex: number): VisualDraftItem | undefined {
  return draft.items.find((row) => row.index === itemIndex);
}

/** Solo nombre — el precio/cantidad van al resumen final de la compra. */
function itemMatchNameOnly(item: VisualDraftItem): string {
  return asTrimmed(item.description) || externalDescriptionForMapping(item) || 'Sin descripción';
}

export function presentVisualNotFoundItemMenu(
  itemIndex: number,
  item?: VisualDraftItem,
  cancelLabel = 'Cancelar compra'
): string {
  const suggested = item ? suggestedProductCreateName(item) : 'producto';
  return ensureSingleListAsk(
    [
      `1. ➕ Crear "${suggested}"`,
      '2. 🧰 Registrar como insumo sin stock',
      '3. 🗑️ Descartar del documento',
      `0. ❌ ${cancelLabel}`,
    ].join('\n'),
    'product'
  );
}

export function presentProductCandidateMatchMenu(input: {
  itemIndex: number;
  item?: VisualDraftItem;
  products: Array<{ name: string }>;
  actions: Array<{ name: string }>;
  zeroLabel: string;
  /** @deprecated Ya no se muestra copy de talle / “no encontré”; se ignora. */
  familyMissing?: { queryLabel: string; missingVariant: string };
}): string {
  const productLines = input.products.map((row, idx) => `${idx + 1}. 👕 ${row.name}`);
  const actionLines = input.actions.map(
    (row, idx) => `${input.products.length + idx + 1}. ${row.name}`
  );
  return ensureSingleListAsk(
    [...productLines, ...actionLines, `0. ${input.zeroLabel}`].join('\n'),
    'product'
  );
}

export function presentCreateProductNameAsk(item: VisualDraftItem): string {
  const suggested = suggestedProductCreateName(item);
  return formatWhatsappMessage({
    title: `${WA_ICON.products} Crear producto`,
    lines: [
      waBold(itemMatchNameOnly(item)),
      '',
      `1. ✅ Crear "${suggested}"`,
      '0. ↩️ Volver',
    ].filter(Boolean),
    ask: VISUAL_CREATE_PRODUCT_NAME_PROMPT,
  });
}

export function buildCreateProductNameState(
  draft: VisualDocumentDraft,
  itemIndex: number
): Partial<ConversationState> {
  const item = draft.items.find((row) => row.index === itemIndex);
  const extractedDescription = suggestedProductCreateName(item ?? { description: '', sourceText: '' });
  const awaiting: VisualCatalogAwaiting = {
    type: 'create_product_name',
    draftId: draft.id,
    itemIndex,
    extractedDescription,
  };
  const selection = buildCandidateSelectionState({
    entityType: 'product',
    options: [
      { index: 1, entityId: VISUAL_CREATE_USE_REMITO_NAME, label: `✅ Crear "${extractedDescription}"` },
      { index: 0, entityId: VISUAL_CANDIDATE_BACK, label: '↩️ Volver' },
    ],
    resume: {
      originalUserText: '',
      blockedTool: 'ingest_visual_document',
      draftId: draft.id,
      itemIndex,
      party: 'item',
    },
  });
  return {
    ...selection,
    pendingPrompt: VISUAL_CREATE_PRODUCT_NAME_PROMPT,
    pendingPayload: {
      ...(selection.pendingPayload ?? {}),
      catalogProductMatch: awaiting,
      createProductName: awaiting,
    },
    activeTask: {
      intent: 'visual_draft_resolution',
      awaiting: {
        type: 'create_product_name',
        itemIndex,
        draftId: draft.id,
        extractedDescription,
      },
    },
    visualDraft: draft,
  };
}

export function presentManualProductMatchMenu(
  itemIndex: number,
  candidates: Array<{ id: string; name: string }>,
  singleResult: boolean,
  item?: VisualDraftItem
): string {
  const productOptions = candidates.filter((row) => !isVisualMatchActionId(row.id));
  const actions = candidates.filter(
    (row) =>
      isVisualMatchActionId(row.id) &&
      row.id !== VISUAL_MANUAL_MATCH_BACK &&
      row.id !== VISUAL_MORE_OPTIONS &&
      row.id !== VISUAL_NOT_FOUND_LINK
  );
  const back = candidates.find((row) => row.id === VISUAL_MANUAL_MATCH_BACK);
  const menu = presentProductCandidateMatchMenu({
    itemIndex,
    item,
    products: productOptions,
    actions: actions.length
      ? actions
      : item
        ? [{ name: `➕ Crear "${suggestedProductCreateName(item)}"` }]
        : [],
    zeroLabel: back ? back.name : '↩️ Volver',
  });
  if (singleResult && productOptions.length === 1) {
    const name = productOptions[0]!.name;
    const confirmAsk = `¿Es ${waBold(name)}? Respondé ${waBold('1')} para confirmar.`;
    // Reemplazar el ask genérico de catálogo por confirmación explícita.
    const withoutAsk = menu
      .replace(/\n\nSi no es ninguno, indicame el nombre[^\n]*$/i, '')
      .replace(/\n\nIndicame qué ítem querés usar[^\n]*$/i, '')
      .trim();
    return `${withoutAsk}\n\n${confirmAsk}`;
  }
  return menu;
}

export function presentVisualItemLinked(_item: VisualDraftItem, _productName: string): string {
  // Matching en cadena: no confirmar cada vínculo; el próximo menú ya muestra el progreso.
  return '';
}

function nextUnresolvedItemHint(draft: VisualDocumentDraft, afterIndex?: number): string | null {
  const issue = firstUnresolvedVisualIssue(draft);
  if (!issue?.itemIndex) return null;
  if (afterIndex != null && issue.itemIndex === afterIndex) return null;
  console.info(
    '[purchase:item:next-unresolved]',
    JSON.stringify({ draftId: draft.id, itemIndex: issue.itemIndex, afterIndex: afterIndex ?? null })
  );
  return buildProductResolutionLead(draft, issue, 'continue');
}

export function isVisualNotFoundMenuAwaiting(awaiting: CandidateSelectionAwaiting): boolean {
  return Boolean(awaiting.resume.draftId) && awaiting.options.some((row) => row.entityId === VISUAL_NOT_FOUND_CREATE);
}

export function presentVisualDraftIssueReply(
  draft: VisualDocumentDraft,
  issue: VisualDraftIssue,
  opts?: { lead?: ResolutionLeadMode }
): string {
  const leadMode = opts?.lead ?? 'start';
  const lead = buildProductResolutionLead(draft, issue, leadMode);
  let body = '';
  if (issue.issueKind === 'visual_not_found_menu' && issue.itemIndex != null) {
    body = presentVisualNotFoundItemMenu(
      issue.itemIndex,
      visualDraftItemForMenu(draft, issue.itemIndex)
    );
  } else if (issue.issueKind === 'manual_product_match' && issue.itemIndex != null) {
    const draftItem = visualDraftItemForMenu(draft, issue.itemIndex);
    const productCandidates = issue.candidates.filter((row) => !isVisualMatchActionId(row.id));
    const single = productCandidates.length === 1;
    body = presentManualProductMatchMenu(
      issue.itemIndex,
      issue.candidates,
      single,
      draftItem
    );
    // Single hit ya trae «¿Es X? Respondé 1…» — no pisar con el ask genérico de catálogo.
    if (single) {
      return lead ? `${lead}\n\n${body}` : body;
    }
  } else if (issue.issueKind === 'product_candidate_selection' && issue.itemIndex != null) {
    const products = issue.candidates.filter((row) => !isVisualMatchActionId(row.id));
    const actions = issue.candidates.filter(
      (row) =>
        isVisualMatchActionId(row.id) &&
        row.id !== VISUAL_CANDIDATE_CANCEL &&
        row.id !== VISUAL_CANDIDATE_BACK &&
        row.id !== VISUAL_MORE_OPTIONS &&
        row.id !== VISUAL_NOT_FOUND_LINK
    );
    const back = issue.candidates.find((row) => row.id === VISUAL_CANDIDATE_BACK);
    const cancel = issue.candidates.find((row) => row.id === VISUAL_CANDIDATE_CANCEL);
    const draftItem = draft.items.find((row) => row.index === issue.itemIndex);
    body = presentProductCandidateMatchMenu({
      itemIndex: issue.itemIndex,
      item: draftItem,
      products,
      actions,
      zeroLabel: back ? back.name : cancel ? cancel.name : '❌ Cancelar compra',
      familyMissing:
        draftItem?.matchKind === 'FAMILY_MATCH_VARIANT_MISSING' && draftItem.missingVariant
          ? {
              queryLabel:
                asTrimmed(draftItem.description) ||
                asTrimmed(draftItem.sourceText) ||
                `ítem ${draftItem.index}`,
              missingVariant: draftItem.missingVariant,
            }
          : undefined,
    });
  } else {
    // Fall through to remaining issue kinds below without lead for payment/review.
    return presentVisualDraftIssueReplyLegacy(draft, issue);
  }

  if (
    issue.issueKind === 'visual_not_found_menu' ||
    issue.issueKind === 'manual_product_match' ||
    issue.issueKind === 'product_candidate_selection'
  ) {
    return lead ? ensureSingleListAsk(`${lead}\n\n${body}`, 'product') : body;
  }
  return body;
}

function presentVisualDraftIssueReplyLegacy(draft: VisualDocumentDraft, issue: VisualDraftIssue): string {
  if (issue.issueKind === 'purchase_payment') {
    const paymentHint = asTrimmed(draft.paymentStatus);
    const numbered = issue.candidates.map((row, idx) => `${idx + 1}. ${row.name}`);
    return formatWhatsappMessage({
      title: `${WA_ICON.payment} ¿Cómo se pagó?`,
      lines: [
        ...(paymentHint ? [`Factura: ${paymentHint}`, ''] : []),
        ...numbered,
        '0. ↩️ Volver',
      ],
      ask: V4_CANDIDATE_SELECTION_PROMPT,
    });
  }
  if (issue.issueKind === 'purchase_items_review') {
    return presentVisualPurchaseItemsReview(draft);
  }
  if (issue.issueKind === 'purchase_tax_presentation') {
    return presentTaxPresentationAmbiguityAsk();
  }
  if (issue.issueKind === 'purchase_edit_item') {
    const back = issue.candidates.find((row) => row.id === VISUAL_EDIT_ITEM_BACK);
    const items = issue.candidates.filter((row) => row.id !== VISUAL_EDIT_ITEM_BACK);
    const numbered = items.map((row, idx) => `${idx + 1}. ${row.name}`);
    return formatWhatsappMessage({
      title: issue.title,
      lines: [...numbered, back ? `0. ${back.name}` : '0. ↩️ Volver'],
      ask: V4_CANDIDATE_SELECTION_PROMPT,
    });
  }
  if (issue.issueKind === 'purchase_payment_card') {
    const numbered = issue.candidates.map((row, idx) => `${idx + 1}. ${row.name}`);
    return formatWhatsappMessage({
      title: 'Tarjeta',
      lines: [...numbered, '0. ↩️ Volver'],
      ask: V4_CANDIDATE_SELECTION_PROMPT,
    });
  }
  if (issue.issueKind === 'purchase_payment_installments') {
    return formatWhatsappMessage({
      title: '¿En cuántas cuotas?',
      lines: ['0. ↩️ Volver'],
      ask: 'Escribí un número (ej. 3).',
    });
  }
  if (issue.issueKind === 'purchase_card_due_day') {
    const cardLabel = issue.candidates[0]?.name ?? 'Tarjeta';
    return formatWhatsappMessage({
      title: cardLabel,
      lines: ['No tengo configurado cuándo vence.', '¿Qué día del mes se paga normalmente? (1-31)'],
    });
  }
  if (issue.issueKind === 'purchase_cash_account') {
    const numbered = issue.candidates.map((row, idx) => `${idx + 1}. ${row.name}`);
    return formatWhatsappMessage({
      title: '¿Desde qué caja?',
      lines: [...numbered, '0. ↩️ Volver'],
      ask: V4_CANDIDATE_SELECTION_PROMPT,
    });
  }
  const options = normalizeCandidateRows(issue.entityType, issue.candidates);
  const numberedLines = options.map((row) => `${row.index}. ${row.label}`);
  return formatWhatsappMessage({
    title: issue.title,
    lines: numberedLines,
    ask: V4_CANDIDATE_SELECTION_PROMPT,
  });
}

export function buildCatalogProductMatchQueryState(
  draft: VisualDocumentDraft,
  itemIndex: number
): Partial<ConversationState> {
  const item = draft.items.find((row) => row.index === itemIndex);
  const extractedDescription = asTrimmed(item?.sourceText) || asTrimmed(item?.description) || undefined;
  const awaiting: VisualCatalogAwaiting = {
    type: 'catalog_product_match_query',
    draftId: draft.id,
    itemIndex,
    extractedDescription,
  };
  return {
    pendingIntent: null,
    pendingPayload: { catalogProductMatch: awaiting },
    pendingPrompt: VISUAL_CATALOG_MATCH_PROMPT,
    activeTask: {
      intent: 'visual_draft_resolution',
      awaiting: {
        type: 'catalog_product_match_query',
        itemIndex,
        draftId: draft.id,
        extractedDescription,
      },
    },
    visualDraft: draft,
  };
}

export function parseVisualCatalogAwaiting(
  state: ConversationState | null | undefined,
  candidateAwaiting?: CandidateSelectionAwaiting | null
): VisualCatalogAwaiting | null {
  const createPayload = state?.pendingPayload?.createProductName ?? state?.pendingPayload?.catalogProductMatch;
  if (createPayload && typeof createPayload === 'object') {
    const row = createPayload as VisualCatalogAwaiting;
    if (row.type === 'create_product_name' && row.itemIndex != null && row.draftId) {
      return row;
    }
  }
  const payload = state?.pendingPayload?.catalogProductMatch;
  if (payload && typeof payload === 'object') {
    const row = payload as VisualCatalogAwaiting;
    if (row.type === 'catalog_product_match_query' && row.itemIndex != null && row.draftId) {
      return row;
    }
  }
  const task = state?.activeTask?.awaiting;
  if (task?.type === 'create_product_name' && task.itemIndex != null) {
    const draft = parseVisualDraft(state?.visualDraft);
    return {
      type: 'create_product_name',
      draftId: String((task as Record<string, unknown>).draftId ?? draft?.id ?? ''),
      itemIndex: Number(task.itemIndex),
      extractedDescription: String((task as Record<string, unknown>).extractedDescription ?? ''),
    };
  }
  if (task?.type === 'catalog_product_match_query' && task.itemIndex != null) {
    const draft = parseVisualDraft(state?.visualDraft);
    return {
      type: 'catalog_product_match_query',
      draftId: String((task as Record<string, unknown>).draftId ?? draft?.id ?? ''),
      itemIndex: Number(task.itemIndex),
      extractedDescription: String((task as Record<string, unknown>).extractedDescription ?? ''),
    };
  }
  if (candidateAwaiting && isVisualNotFoundMenuAwaiting(candidateAwaiting)) {
    const draft = parseVisualDraft(state?.visualDraft);
    const itemIndex = Number(candidateAwaiting.resume.itemIndex ?? 0);
    const item = draft?.items.find((row) => row.index === itemIndex);
    return {
      type: 'unresolved_catalog_item',
      draftId: String(candidateAwaiting.resume.draftId ?? draft?.id ?? ''),
      itemIndex,
      extractedDescription: asTrimmed(item?.sourceText) || asTrimmed(item?.description) || undefined,
    };
  }
  // Candidatos de producto del remito ya mostrados: deixis / «mostrame más» usan el texto extraído.
  if (
    candidateAwaiting?.resume.draftId &&
    (candidateAwaiting.resume.party === 'item' || candidateAwaiting.entityType === 'product') &&
    candidateAwaiting.resume.itemIndex != null
  ) {
    const draft = parseVisualDraft(state?.visualDraft);
    const itemIndex = Number(candidateAwaiting.resume.itemIndex);
    const item = draft?.items.find((row) => row.index === itemIndex);
    return {
      type: 'unresolved_catalog_item',
      draftId: String(candidateAwaiting.resume.draftId ?? draft?.id ?? ''),
      itemIndex,
      extractedDescription: asTrimmed(item?.sourceText) || asTrimmed(item?.description) || undefined,
    };
  }
  if (task?.type === 'manual_product_match_search' && task.itemIndex != null) {
    const draft = parseVisualDraft(state?.visualDraft);
    return {
      type: 'manual_product_match_search',
      draftId: String((task as Record<string, unknown>).draftId ?? draft?.id ?? ''),
      itemIndex: Number(task.itemIndex),
      extractedDescription: String((task as Record<string, unknown>).extractedDescription ?? ''),
    };
  }
  if (task?.type === 'unresolved_catalog_item' && task.itemIndex != null) {
    const draft = parseVisualDraft(state?.visualDraft);
    return {
      type: 'unresolved_catalog_item',
      draftId: String((task as Record<string, unknown>).draftId ?? draft?.id ?? ''),
      itemIndex: Number(task.itemIndex),
      extractedDescription: String((task as Record<string, unknown>).extractedDescription ?? ''),
    };
  }
  return null;
}

export function presentManualCatalogSearchMiss(query: string): string {
  const q = asTrimmed(query);
  return q
    ? `No encontré ${waBold(q)} en tu catálogo.`
    : 'No encontré ese producto en tu catálogo.';
}

function buildVisualProductMatchReply(
  draft: VisualDocumentDraft,
  issue: VisualDraftIssue | null,
  linkStatus?: 'resolved' | 'not_found' | 'awaiting_selection',
  linkedItem?: VisualDraftItem,
  matchedName?: string,
  searchedQuery?: string
): string {
  if (linkStatus === 'resolved' && linkedItem && matchedName) {
    return buildVisualResolutionReply(draft, issue, { item: linkedItem, productName: matchedName });
  }
  if (linkStatus === 'not_found') {
    return buildVisualResolutionReply(draft, issue, undefined, true, searchedQuery);
  }
  if (linkStatus === 'awaiting_selection' && issue) {
    return presentVisualDraftIssueReply(draft, issue);
  }
  return buildVisualResolutionReply(draft, issue);
}

export async function tryResolveVisualCatalogProductTurn(input: {
  text: string;
  state: ConversationState | null;
  candidateAwaiting?: CandidateSelectionAwaiting | null;
  tenant: WhatsappTenantContext;
  deps?: VisualDraftDeps;
}): Promise<{ reply: string; statePatch: Partial<ConversationState>; intent: string } | null> {
  const trimmed = String(input.text ?? '').trim();
  if (!trimmed || parseNumericSelectionTurn(trimmed).index != null) return null;
  // «ninguno» / rechazo explícito → Agent (candidate_none), no búsqueda de catálogo.
  if (isCatalogCandidateRejection(trimmed)) return null;
  // Consulta ERP (caja/saldo/…) durante not_found → Agent, draft intacto.
  if (looksLikeErpQueryInterrupt(trimmed)) return null;

  const awaiting = parseVisualCatalogAwaiting(input.state, input.candidateAwaiting);
  if (!awaiting?.itemIndex) return null;

  const draft = liveVisualDraft(input.state);
  if (!draft || (awaiting.draftId && draft.id !== awaiting.draftId)) return null;

  // Nombre custom al crear producto desde menú Crear.
  if (awaiting.type === 'create_product_name') {
    const created = await createAndLinkVisualDraftProduct(
      input.tenant.businessId,
      draft,
      awaiting.itemIndex,
      input.deps ?? {},
      { nameOverride: trimmed }
    );
    let issue = firstUnresolvedVisualIssue(created.draft);
    if (!issue && created.draft.kind === 'purchase') {
      issue = await resolveVisualDraftBlockingIssue(
        created.draft,
        input.tenant.businessId,
        undefined,
        input.deps
      );
    }
    const linked = created.draft.items.find((row) => row.index === awaiting.itemIndex);
    const parts = [presentVisualItemLinked(linked!, created.created.name)];
    if (issue) {
      parts.push(presentVisualDraftIssueReply(created.draft, issue, { lead: 'continue' }));
      return {
        reply: parts.filter(Boolean).join('\n\n'),
        statePatch: {
          ...buildVisualDraftIssueStatePatch(created.draft, issue, trimmed),
          visualDraft: created.draft,
        },
        intent: 'v4_visual_product_created',
      };
    }
    if (isVisualDraftReadyToWrite(created.draft)) {
      const { freezeVisualDraftConfirmation } = await import('./v4-visual-draft-confirmation.ts');
      const frozen = await freezeVisualDraftConfirmation({
        draft: created.draft,
        tenant: input.tenant,
        state: input.state,
        rawUserMessage: trimmed,
      });
      if (frozen) {
        return {
          reply: parts.filter(Boolean).concat(frozen.reply).join('\n\n'),
          statePatch: { ...frozen.statePatch, visualDraft: created.draft },
          intent: 'confirm_v4',
        };
      }
    }
    return {
      reply: parts.filter(Boolean).join('\n\n') || presentVisualDraft(created.draft),
      statePatch: {
        pendingIntent: null,
        pendingPayload: null,
        pendingPrompt: null,
        activeTask: null,
        visualDraft: created.draft,
      },
      intent: 'v4_visual_product_created',
    };
  }

  const item = draft.items.find((row) => row.index === awaiting.itemIndex);
  const extracted =
    asTrimmed(awaiting.extractedDescription) ||
    asTrimmed(item?.sourceText) ||
    asTrimmed(item?.description);
  const resolvedQuery = resolveCatalogSearchQueryFromUserText({
    text: trimmed,
    extractedDescription: extracted,
    itemDescription: item?.description,
  });
  // Si pide opciones / confirma «ese» pero no hay texto del ítem, no inventar.
  if (resolvedQuery.showOptions && !resolvedQuery.query) return null;

  // Preferir candidatos YA mostrados si el usuario reescribe el nombre del catálogo.
  // Nunca auto-vincular: pedir confirmación numerada (¿es este?).
  const shownCandidates = catalogProductCandidatesFromContext(item, input.candidateAwaiting);
  const pickedFromShown =
    resolvedQuery.query && !resolvedQuery.showOptions
      ? matchShownCatalogCandidate(resolvedQuery.query, shownCandidates)
      : null;
  if (pickedFromShown && item) {
    const stagedDraft: VisualDocumentDraft = {
      ...draft,
      items: draft.items.map((row) =>
        row.index === item.index ? stageManualProductMatchCandidate(row, pickedFromShown) : row
      ),
    };
    stagedDraft.status = draftStatusFromItems(stagedDraft);
    const issue = firstUnresolvedVisualIssue(stagedDraft);
    const reply = buildVisualProductMatchReply(stagedDraft, issue, 'awaiting_selection');
    const statePatch: Partial<ConversationState> = {
      visualDraft: stagedDraft,
    };
    if (issue) {
      Object.assign(statePatch, buildVisualDraftIssueStatePatch(stagedDraft, issue, trimmed));
    }
    return {
      reply: ensureSingleListAsk(reply, 'product'),
      statePatch,
      intent: 'v4_visual_product_match',
    };
  }

  const ctx: ToolExecutionContext = {
    tenant: input.tenant,
    state: input.state,
    rawUserMessage: trimmed,
  };
  const result = await patchVisualDraft(
    {
      itemIndex: awaiting.itemIndex,
      productQuery: resolvedQuery.query,
      manualProductSearch: true,
    },
    ctx,
    input.deps ?? {}
  );
  const linkStatus = result.productLinkStatus as 'resolved' | 'not_found' | 'awaiting_selection' | undefined;
  const updatedDraft = parseVisualDraft(result.draft) ?? draft;
  let issue = firstUnresolvedVisualIssue(updatedDraft);
  if (!issue && updatedDraft.kind === 'purchase') {
    issue = await resolveVisualDraftBlockingIssue(updatedDraft, input.tenant.businessId, undefined, input.deps);
  }

  let effectiveLinkStatus: 'resolved' | 'not_found' | 'awaiting_selection' | undefined = linkStatus;

  // Deixis / «mostrame opciones»: NUNCA caer al Agent pidiendo un número sin lista.
  if (linkStatus === 'not_found' && resolvedQuery.showOptions && extracted) {
    const rematch = await linkProductByUserQuery(
      input.tenant.businessId,
      updatedDraft.items.find((row) => row.index === awaiting.itemIndex) ?? item!,
      extracted,
      input.deps ?? {},
      { manualSearch: false }
    );
    const idx = updatedDraft.items.findIndex((row) => row.index === awaiting.itemIndex);
    if (idx >= 0) updatedDraft.items[idx] = rematch.item;
    updatedDraft.status = draftStatusFromItems(updatedDraft);
    issue = firstUnresolvedVisualIssue(updatedDraft);
    effectiveLinkStatus = rematch.searchStatus;
  }

  // Si el usuario escribió un nombre y no está: decimos «No encontré…» y rearmamos menú.
  // Solo caer al Agent si no hubo query de catálogo que buscar.
  if (
    effectiveLinkStatus === 'not_found' &&
    awaiting.type === 'unresolved_catalog_item' &&
    !resolvedQuery.showOptions &&
    !resolvedQuery.query
  ) {
    return null;
  }

  const linkedItem =
    effectiveLinkStatus === 'resolved'
      ? updatedDraft.items.find((row) => row.index === awaiting.itemIndex)
      : undefined;

  let reply = String(
    result.message && !(resolvedQuery.showOptions && effectiveLinkStatus === 'awaiting_selection')
      ? result.message
      : buildVisualProductMatchReply(
          updatedDraft,
          issue,
          effectiveLinkStatus === 'not_found' &&
            (issue?.issueKind === 'product_candidate_selection' ||
              issue?.issueKind === 'manual_product_match')
            ? 'awaiting_selection'
            : effectiveLinkStatus,
          linkedItem,
          String(result.linkedProductName ?? linkedItem?.matchedProductName ?? ''),
          resolvedQuery.query || String(result.searchedQuery ?? '')
        )
  );

  const listIssue =
    issue?.issueKind === 'product_candidate_selection' || issue?.issueKind === 'manual_product_match'
      ? issue
      : null;

  if (resolvedQuery.confirmedExtracted && extracted && listIssue) {
    const prefix = `Sí, el comprobante dice *${extracted}*. Ahora lo vinculo con un producto de tu catálogo.`;
    reply = ensureSingleListAsk(`${prefix}\n\n${presentVisualDraftIssueReply(updatedDraft, listIssue)}`, 'product');
  } else if (resolvedQuery.showOptions && listIssue && !/^\s*1\.\s/m.test(reply)) {
    reply = presentVisualDraftIssueReply(updatedDraft, listIssue);
  }

  // Guardrail: nunca pedir número sin haber listado opciones.
  if (/indicame el n[uú]mero|eleg[ií] una opci[oó]n|decime cu[aá]l/i.test(reply) && !/^\s*\d+\.\s/m.test(reply)) {
    if (issue) reply = presentVisualDraftIssueReply(updatedDraft, issue);
    else if (extracted) {
      reply = `Para vincular *${extracted}* necesito opciones del catálogo. Escribí el nombre del producto o pedí crear la variante.`;
    }
  }

  const statePatch: Partial<ConversationState> = {
    ...(result.selectionPatch as Partial<ConversationState> | undefined),
    visualDraft: updatedDraft,
  };
  if (issue?.issueKind === 'visual_not_found_menu' && issue.itemIndex != null) {
    const row = updatedDraft.items.find((r) => r.index === issue.itemIndex);
    statePatch.activeTask = {
      intent: 'visual_draft_resolution',
      awaiting: {
        type: 'unresolved_catalog_item',
        itemIndex: issue.itemIndex,
        draftId: updatedDraft.id,
        extractedDescription: asTrimmed(row?.sourceText) || asTrimmed(row?.description) || undefined,
      },
    };
  } else if (issue?.issueKind === 'product_candidate_selection' || issue?.issueKind === 'manual_product_match') {
    Object.assign(statePatch, candidateStateForIssue(updatedDraft, issue, trimmed));
  } else if (!issue) {
    statePatch.activeTask = null;
  }

  if (!issue && isVisualDraftReadyToWrite(updatedDraft) && effectiveLinkStatus === 'resolved') {
    const { freezeVisualDraftConfirmation } = await import('./v4-visual-draft-confirmation.ts');
    const frozen = await freezeVisualDraftConfirmation({
      draft: updatedDraft,
      tenant: input.tenant,
      state: input.state,
      rawUserMessage: trimmed,
    });
    if (frozen) {
      const prefix =
        linkedItem?.matchedProductName
          ? presentVisualItemLinked(linkedItem, linkedItem.matchedProductName)
          : '';
      return {
        reply: [prefix, frozen.reply].filter(Boolean).join('\n\n'),
        statePatch: { ...frozen.statePatch, visualDraft: updatedDraft },
        intent: 'confirm_v4',
      };
    }
  }

  return {
    reply: ensureSingleListAsk(reply, 'product'),
    statePatch,
    intent:
      effectiveLinkStatus === 'resolved'
        ? 'v4_visual_product_linked'
        : 'v4_visual_product_match',
  };
}

function supplierAmbiguousIssue(
  draft: VisualDocumentDraft,
  candidates: Array<{ id: string; name: string }>
): ReturnType<typeof firstUnresolvedVisualIssue> {
  return {
    party: 'supplier',
    entityType: 'supplier',
    candidates,
    title: 'Encontré varios proveedores',
  };
}

function clientAmbiguousIssue(
  draft: VisualDocumentDraft,
  candidates: Array<{ id: string; name: string }>
): ReturnType<typeof firstUnresolvedVisualIssue> {
  return {
    party: 'client',
    entityType: 'client',
    candidates,
    title: 'Encontré varios clientes',
  };
}

export function reconcilePurchaseDraftItems(draft: VisualDocumentDraft): {
  ok: boolean;
  code?: 'PURCHASE_DRAFT_ITEM_LOSS';
  extractedCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  discardedCount: number;
  quantityTotal: number;
} {
  const extractedCount = draft.items.length;
  let resolvedCount = 0;
  let unresolvedCount = 0;
  let discardedCount = 0;
  let quantityTotal = 0;

  for (const item of draft.items) {
    if (item.matchStatus === 'discarded' || item.unresolvedAction === 'discard') {
      discardedCount += 1;
      continue;
    }
    quantityTotal += Math.max(0, Number(item.quantity) || 0);
    if (
      item.matchStatus === 'resolved' &&
      (item.matchedProductId || item.unresolvedAction === 'free_line' || item.selectionSource === 'supplier_mapping')
    ) {
      resolvedCount += 1;
      continue;
    }
    if (
      item.matchStatus === 'ambiguous' ||
      item.matchStatus === 'not_found' ||
      item.matchStatus === 'unresolved' ||
      item.unresolvedAction === 'create'
    ) {
      unresolvedCount += 1;
      continue;
    }
  }

  const accounted = resolvedCount + unresolvedCount + discardedCount;
  const ok = accounted === extractedCount;
  console.info(
    '[purchase:draft:reconcile-items]',
    JSON.stringify({
      draftId: draft.id,
      extractedCount,
      resolvedCount,
      unresolvedCount,
      discardedCount,
      quantityTotal,
      ok,
    })
  );
  return {
    ok,
    code: ok ? undefined : 'PURCHASE_DRAFT_ITEM_LOSS',
    extractedCount,
    resolvedCount,
    unresolvedCount,
    discardedCount,
    quantityTotal,
  };
}

/** Suma de importes impresos en líneas (antes de gross-up). */
export function computePrintedLineSum(draft: VisualDocumentDraft): number {
  let sum = 0;
  for (const item of draft.items) {
    if (item.matchStatus === 'discarded' || item.unresolvedAction === 'discard') continue;
    if (item.subtotal != null) {
      sum += Number(item.subtotal) || 0;
      continue;
    }
    const qty = Math.max(0, Number(item.quantity) || 0);
    const printed =
      Number(item.unitCostNet) > 0
        ? Number(item.unitCostNet)
        : Number(item.unitCost) || 0;
    sum += qty * printed;
  }
  return roundPurchaseMoney(sum);
}

/**
 * Infiere neto vs IVA incluido y aplica costo unitario FINAL (con impuestos) para stock/ERP.
 * Nunca inventa una tasa: la toma del comprobante, de la razón totales/líneas, o deja pendiente.
 */
export function ensurePurchaseDraftTaxMetadata(
  draft: VisualDocumentDraft,
  fallbackTaxRate?: number | null
): void {
  if (draft.kind !== 'purchase') return;

  const grossCandidate = draft.documentGrossTotal ?? draft.total;
  const printedSum = computePrintedLineSum(draft);
  if (printedSum <= 0 && (grossCandidate == null || grossCandidate <= 0)) return;

  if (grossCandidate != null && grossCandidate > 0) {
    const gross = roundPurchaseMoney(grossCandidate);
    draft.documentGrossTotal = gross;
    draft.total = draft.total ?? gross;
  }

  const inferredFromDoc = inferDocumentTaxRate({
    documentNetTotal: draft.documentNetTotal,
    documentTaxTotal: draft.documentTaxTotal,
    documentGrossTotal: draft.documentGrossTotal,
  });
  const inferredFromLines = inferTaxRateFromLineSumToGross(printedSum, draft.documentGrossTotal);
  const detectedMode =
    draft.priceTaxMode === 'net' || draft.priceTaxMode === 'gross'
      ? draft.priceTaxMode
      : detectLinePriceTaxMode({
          lineSum: printedSum,
          documentNetTotal: draft.documentNetTotal,
          documentTaxTotal: draft.documentTaxTotal,
          documentGrossTotal: draft.documentGrossTotal,
        });

  if (!draft.priceTaxMode || draft.priceTaxMode === 'unknown') {
    if (detectedMode !== 'unknown') {
      draft.priceTaxMode = detectedMode;
    } else if (
      draft.documentNetTotal != null &&
      draft.documentTaxTotal != null &&
      draft.documentGrossTotal != null &&
      Math.abs(draft.documentNetTotal + draft.documentTaxTotal - draft.documentGrossTotal) <= 0.05 &&
      draft.documentTaxTotal > 0
    ) {
      // Totales de factura con IVA separado ⇒ líneas impresas suelen ser netas.
      draft.priceTaxMode = 'net';
    }
  }

  let taxRate =
    Number(draft.documentTaxRate) > 0
      ? Number(draft.documentTaxRate)
      : inferredFromDoc != null
        ? inferredFromDoc
        : draft.priceTaxMode === 'net' && inferredFromLines != null
          ? inferredFromLines
          : undefined;

  // Fallback del negocio solo si el comprobante ya se detectó como neto y la tasa cierra el total.
  if (
    taxRate == null &&
    draft.priceTaxMode === 'net' &&
    Number(fallbackTaxRate) > 0 &&
    draft.documentGrossTotal != null
  ) {
    const expectedGross = roundPurchaseMoney(printedSum * (1 + Number(fallbackTaxRate) / 100));
    if (Math.abs(expectedGross - draft.documentGrossTotal) <= 0.05) {
      taxRate = Number(fallbackTaxRate);
    }
  }

  if (taxRate != null && Number.isFinite(taxRate) && taxRate >= 0) {
    if (taxRate > 0 && taxRate < 1) taxRate = taxRate * 100;
    draft.documentTaxRate = roundPurchaseMoney(taxRate);
  }

  if (draft.documentNetTotal == null && draft.priceTaxMode === 'net') {
    draft.documentNetTotal = printedSum;
  }
  if (
    draft.documentTaxTotal == null &&
    draft.documentGrossTotal != null &&
    draft.documentNetTotal != null
  ) {
    draft.documentTaxTotal = roundPurchaseMoney(draft.documentGrossTotal - draft.documentNetTotal);
  } else if (
    draft.documentTaxTotal == null &&
    draft.priceTaxMode === 'gross' &&
    draft.documentGrossTotal != null
  ) {
    draft.documentNetTotal = draft.documentNetTotal ?? draft.documentGrossTotal;
    draft.documentTaxTotal = 0;
  }

  if (draft.priceTaxMode === 'net' && draft.documentTaxRate != null) {
    for (const item of draft.items) {
      if (item.matchStatus === 'discarded' || item.unresolvedAction === 'discard') continue;
      const printedNet =
        Number(item.unitCostNet) > 0
          ? Number(item.unitCostNet)
          : Number(item.unitCost) || 0;
      const tax = resolvePurchaseLineTax(
        {
          unitCost: printedNet,
          unitCostNet: printedNet,
          taxRate: item.taxRate ?? draft.documentTaxRate,
          priceTaxMode: 'net',
        },
        { defaultPurchaseTaxRate: draft.documentTaxRate }
      );
      item.unitCostNet = tax.netUnitCost;
      item.grossUnitCost = tax.grossUnitCost;
      item.taxAmount = tax.taxAmount;
      // Costo de catálogo / compra = FINAL con impuestos.
      item.unitCost = tax.grossUnitCost;
      item.priceTaxMode = 'net';
      if (tax.taxRate != null) item.taxRate = tax.taxRate;
      if (item.quantity != null && tax.netUnitCost != null) {
        item.subtotal = roundPurchaseMoney(item.quantity * tax.netUnitCost);
      }
    }
  } else if (draft.priceTaxMode === 'gross') {
    for (const item of draft.items) {
      if (item.matchStatus === 'discarded' || item.unresolvedAction === 'discard') continue;
      const printedGross = Number(item.unitCost) || 0;
      const tax = resolvePurchaseLineTax(
        {
          unitCost: printedGross,
          unitCostNet: item.unitCostNet,
          taxRate: item.taxRate ?? draft.documentTaxRate,
          priceTaxMode: 'gross',
        },
        draft.documentTaxRate != null
          ? { defaultPurchaseTaxRate: draft.documentTaxRate }
          : undefined
      );
      item.grossUnitCost = tax.grossUnitCost;
      item.unitCost = tax.grossUnitCost;
      item.unitCostNet = tax.netUnitCost;
      item.taxAmount = tax.taxAmount;
      item.priceTaxMode = 'gross';
      if (tax.taxRate != null) item.taxRate = tax.taxRate;
    }
  }
}

function purchaseReviewFinancialLines(draft: VisualDocumentDraft): string[] {
  const financial = computeDraftFinancialTotals(draft);
  if (
    financial.taxTotal > 0.009 &&
    Math.abs(financial.grossTotal - financial.netTotal) > 0.009
  ) {
    return [
      `Neto $${money(financial.netTotal)} · IVA $${money(financial.taxTotal)}`,
      `*Total $${money(financial.grossTotal)}*`,
    ];
  }
  return [`*Total $${money(financial.grossTotal)}*`];
}

export function computeRecognizedLineNetTotal(draft: VisualDocumentDraft): number {
  const finanzasTaxRate = draft.documentTaxRate;
  let netTotal = 0;
  for (const item of draft.items) {
    if (item.matchStatus === 'discarded' || item.unresolvedAction === 'discard') continue;
    if (item.subtotal != null) {
      netTotal += item.subtotal;
      continue;
    }
    const qty = Math.max(0, Number(item.quantity) || 0);
    const tax = resolvePurchaseLineTax(
      {
        unitCost: item.unitCost,
        unitCostNet: item.unitCostNet,
        taxRate: item.taxRate ?? finanzasTaxRate,
        priceTaxMode: item.priceTaxMode ?? draft.priceTaxMode,
      },
      { defaultPurchaseTaxRate: finanzasTaxRate ?? undefined }
    );
    const unitNet = tax.netUnitCost ?? item.unitCost ?? 0;
    netTotal += qty * unitNet;
  }
  return roundPurchaseMoney(netTotal);
}

export function computeRecognizedGrossTotal(draft: VisualDocumentDraft): number {
  const recognizedNet = computeRecognizedLineNetTotal(draft);
  if (draft.documentTaxRate != null && draft.priceTaxMode === 'net') {
    return roundPurchaseMoney(recognizedNet * (1 + draft.documentTaxRate / 100));
  }
  if (
    draft.documentNetTotal != null &&
    Math.abs(draft.documentNetTotal - recognizedNet) <= 0.05 &&
    (draft.documentGrossTotal != null || draft.total != null)
  ) {
    return roundPurchaseMoney(draft.documentGrossTotal ?? draft.total ?? recognizedNet);
  }
  let gross = 0;
  for (const item of draft.items) {
    if (item.matchStatus === 'discarded' || item.unresolvedAction === 'discard') continue;
    const qty = Math.max(0, Number(item.quantity) || 0);
    const unit = item.grossUnitCost ?? item.unitCost ?? 0;
    gross += qty * unit;
  }
  return roundPurchaseMoney(gross > 0 ? gross : recognizedNet);
}

export function computeDraftFinancialTotals(draft: VisualDocumentDraft): {
  netTotal: number;
  taxTotal: number;
  grossTotal: number;
} {
  const recognizedNet = computeRecognizedLineNetTotal(draft);
  const recognizedGross = computeRecognizedGrossTotal(draft);
  const documentNet = draft.documentNetTotal ?? recognizedNet;
  const documentGross = draft.documentGrossTotal ?? draft.total ?? recognizedGross;
  const documentTax =
    draft.documentTaxTotal != null
      ? draft.documentTaxTotal
      : roundPurchaseMoney(documentGross - documentNet);
  return {
    netTotal: documentNet,
    taxTotal: documentTax > 0 ? documentTax : roundPurchaseMoney(documentGross - recognizedNet),
    grossTotal: documentGross,
  };
}

export function computeDraftTotal(draft: VisualDocumentDraft): number {
  const financial = computeDraftFinancialTotals(draft);
  const computed = financial.grossTotal;
  if (draft.documentGrossTotal != null && Math.abs(draft.documentGrossTotal - computed) > 0.02) {
    console.info(
      '[purchase:document:totals]',
      JSON.stringify({
        draftId: draft.id,
        documentGrossTotal: draft.documentGrossTotal,
        computedGrossTotal: computed,
      })
    );
  }
  return computed;
}

function businessDefaultPurchaseTaxRate(finanzas: {
  purchase?: { purchaseTax?: { defaultPurchaseTaxRate?: number | null }; defaultPurchaseTaxRate?: number | null };
}): number | null {
  const nested = Number(finanzas.purchase?.purchaseTax?.defaultPurchaseTaxRate);
  if (Number.isFinite(nested) && nested > 0) return nested;
  const legacy = Number(finanzas.purchase?.defaultPurchaseTaxRate);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return null;
}

function parseTaxBreakdown(raw: unknown): DocumentTaxBucket[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows: DocumentTaxBucket[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    rows.push({
      rate: asOptionalNumber(row.rate),
      taxableBase: asOptionalNumber(row.taxableBase),
      taxAmount: asOptionalNumber(row.taxAmount),
      label: asTrimmed(row.label) || null,
    });
  }
  return rows.length ? rows : undefined;
}

export function documentUnderstandingFromIngestArgs(
  args: IngestVisualDocumentArgs,
  items: VisualDraftItem[]
): DocumentUnderstanding {
  return {
    supplierName: asTrimmed(args.supplierHint) || null,
    documentNumber: asTrimmed(args.invoiceNumber) || null,
    documentDate: asTrimmed(args.date) || null,
    taxPresentation: (asTrimmed(args.taxPresentation) || asTrimmed(args.priceTaxMode) || null) as
      | DocumentUnderstanding['taxPresentation'],
    priceTaxMode: mapTaxPresentationToPriceTaxMode(args.priceTaxMode),
    documentNetTotal: asOptionalNumber(args.documentNetTotal) ?? null,
    documentTaxTotal: asOptionalNumber(args.documentTaxTotal) ?? null,
    documentGrossTotal:
      asOptionalNumber(args.documentGrossTotal) ?? asOptionalNumber(args.total) ?? null,
    documentTaxRate: asOptionalNumber(args.documentTaxRate) ?? null,
    articleCount: asOptionalNumber(args.articleCount) ?? null,
    interpretationAttempt: asOptionalNumber(args.interpretationAttempt) ?? null,
    items: items.map((item) => ({
      description: item.description,
      rawDescription: item.sourceText,
      quantity: item.quantity,
      displayedUnitPrice: item.unitCostNet ?? item.unitCost,
      displayedLineTotal: item.subtotal,
      displayedPriceBasis: item.priceTaxMode,
      taxRate: item.taxRate,
      lineType: item.unresolvedAction === 'free_line' ? 'other_financial_line' : 'product',
      confidence: item.confidence,
    })),
  };
}

/**
 * Aplica reconciliación financiera del DocumentUnderstanding al PurchaseDraft.
 * No inventa tasa: solo usa la del documento o la inferida matemáticamente.
 */
export function applyDocumentUnderstandingToDraft(
  draft: VisualDocumentDraft,
  args: IngestVisualDocumentArgs
): { reconcile: ReturnType<typeof reconcileFinancialDocument>; askTaxPresentation: boolean } {
  if (draft.kind !== 'purchase') {
    return {
      reconcile: {
        ok: false,
        reason: 'no_items',
        askUser: false,
        printedLineSum: 0,
        netInterpretationOk: false,
        grossInterpretationOk: false,
        articleCountOk: true,
        feedback: {
          computedGrossFromLines: 0,
          computedArticleCount: 0,
          netOk: false,
          grossOk: false,
        },
      },
      askTaxPresentation: false,
    };
  }

  const attempt =
    asOptionalNumber(args.interpretationAttempt) ??
    Number(draft.interpretationAttempts ?? 0) + 1;
  draft.interpretationAttempts = attempt;

  if (args.taxBreakdown != null) {
    draft.taxBreakdown = parseTaxBreakdown(args.taxBreakdown);
  }
  const articleCount = asOptionalNumber(args.articleCount);
  if (articleCount != null) draft.articleCount = articleCount;

  const understanding = documentUnderstandingFromIngestArgs(args, draft.items);
  const reconcile = reconcileFinancialDocument(understanding);

  if (reconcile.ok) {
    draft.priceTaxMode = reconcile.priceTaxMode;
    draft.taxPresentationResolved = true;
    if (reconcile.documentNetTotal != null) draft.documentNetTotal = reconcile.documentNetTotal;
    if (reconcile.documentTaxTotal != null) draft.documentTaxTotal = reconcile.documentTaxTotal;
    if (reconcile.documentGrossTotal != null) {
      draft.documentGrossTotal = reconcile.documentGrossTotal;
      draft.total = reconcile.documentGrossTotal;
    }
    if (reconcile.documentTaxRate != null) draft.documentTaxRate = reconcile.documentTaxRate;
    if (reconcile.articleCount != null) draft.articleCount = reconcile.articleCount;
    for (const item of draft.items) {
      if (item.matchStatus === 'discarded') continue;
      if (!item.priceTaxMode || item.priceTaxMode === 'unknown') {
        item.priceTaxMode = reconcile.priceTaxMode;
      }
      if (reconcile.priceTaxMode === 'net' && !(Number(item.unitCostNet) > 0) && Number(item.unitCost) > 0) {
        item.unitCostNet = item.unitCost;
      }
    }
    return { reconcile, askTaxPresentation: false };
  }

  // Solo pedir reinterpretación / aclaración si hay anclas financieras conflictivas.
  const hasAnchors =
    draft.documentNetTotal != null ||
    draft.documentTaxTotal != null ||
    draft.documentGrossTotal != null ||
    draft.total != null;
  if (!hasAnchors || reconcile.reason === 'no_items') {
    return { reconcile, askTaxPresentation: false };
  }

  if (reconcile.askUser && attempt >= MAX_DOCUMENT_INTERPRETATION_ATTEMPTS) {
    return { reconcile, askTaxPresentation: true };
  }

  return { reconcile, askTaxPresentation: false };
}

export function buildPurchaseTaxPresentationIssue(draft: VisualDocumentDraft): VisualDraftIssue {
  return {
    party: 'purchase_total',
    entityType: 'purchase',
    issueKind: 'purchase_tax_presentation',
    candidates: buildTaxPresentationAmbiguityCandidates(),
    title: 'Presentación de precios',
  };
}

export function applyTaxPresentationCorrection(
  draft: VisualDocumentDraft,
  mode: 'net' | 'gross'
): void {
  applyTaxPresentationToDraftFields(draft, mode, {
    documentTaxRate: draft.documentTaxRate ?? null,
  });
  // Recalcular costos con metadata existente (sin inventar tasa).
  ensurePurchaseDraftTaxMetadata(draft, draft.documentTaxRate ?? null);
}

function purchaseTaxPresentationIssue(draft: VisualDocumentDraft): VisualDraftIssue | null {
  if (draft.kind !== 'purchase') return null;
  if (draft.taxPresentationResolved) return null;
  if (draft.priceTaxMode === 'net' || draft.priceTaxMode === 'gross') return null;
  if ((draft.interpretationAttempts ?? 0) < MAX_DOCUMENT_INTERPRETATION_ATTEMPTS) return null;
  return buildPurchaseTaxPresentationIssue(draft);
}

function purchaseFinancialMismatchIssue(draft: VisualDocumentDraft): VisualDraftIssue | null {
  if (draft.kind !== 'purchase') return null;
  const documentGross = draft.documentGrossTotal ?? draft.total;
  if (documentGross == null || documentGross <= 0) return null;
  const recognizedNet = computeRecognizedLineNetTotal(draft);
  const documentNet = draft.documentNetTotal;
  if (
    documentNet != null &&
    Math.abs(documentNet - recognizedNet) <= 0.05 &&
    Math.abs(documentGross - (documentNet + (draft.documentTaxTotal ?? 0))) <= 0.05
  ) {
    return null;
  }
  const recognized = computeRecognizedGrossTotal(draft);
  const { mismatch, difference } = purchaseTotalMismatch(documentGross, recognized);
  if (!mismatch) return null;
  console.info(
    '[purchase:financial:reconcile]',
    JSON.stringify({ draftId: draft.id, documentGross, recognized, difference })
  );
  return {
    party: 'purchase_total',
    entityType: 'purchase',
    issueKind: 'purchase_total_mismatch',
    candidates: [],
    title: formatWhatsappMessage({
      title: 'Falta importe por resolver',
      lines: [
        `• Total factura: $${money(documentGross)}`,
        `• Total reconocido: $${money(recognized)}`,
        `• Diferencia: $${money(difference)}`,
        '',
        'Revisemos los ítems pendientes.',
      ],
    }),
  };
}

function applyCardScheduleToDraft(
  draft: VisualDocumentDraft,
  card: { diaCierre?: number; diaVencimiento?: number }
): boolean {
  if (draft.paymentDueDate) return true;
  const purchaseDate = asTrimmed(draft.date) || new Date().toISOString().slice(0, 10);
  const dueDate = computeFirstInstallmentDate(purchaseDate, card);
  if (!dueDate) return false;
  draft.paymentDueDate = dueDate;
  console.info(
    '[purchase:card:schedule]',
    JSON.stringify({ draftId: draft.id, cardId: draft.paymentTarjetaId, firstInstallmentDate: dueDate })
  );
  return true;
}

function purchasePaymentComplete(draft: VisualDocumentDraft, ctx: PurchasePaymentContext): boolean {
  if (draft.kind !== 'purchase') return true;
  const medioId = String(draft.paymentMedioId ?? '').trim();
  if (!medioId) return false;
  const medio = ctx.medios.find((row) => row.id === medioId);
  if (!medio) return false;
  if (medioPagoRequiereCuentaHija(medio) && !String(draft.paymentTarjetaId ?? '').trim()) return false;
  if (medioPagoGeneratesPayables(medio)) {
    if (!Number(draft.paymentCuotas) || Number(draft.paymentCuotas) < 1) return false;
    if (medioPagoRequiereCuentaHija(medio) && !String(draft.paymentDueDate ?? '').trim()) return false;
  }
  if (medioPagoGeneratesImmediateCash(medio) && !String(draft.cashAccountId ?? '').trim()) return false;
  return true;
}

export async function resolveVisualDraftBlockingIssue(
  draft: VisualDocumentDraft,
  businessId: string,
  paymentCtx?: PurchasePaymentContext,
  deps?: VisualDraftDeps
): Promise<VisualDraftIssue | null> {
  const itemIssue = firstUnresolvedVisualIssue(draft);
  if (itemIssue) return itemIssue;
  if (draft.kind !== 'purchase') return null;

  const itemReconcile = reconcilePurchaseDraftItems(draft);
  if (!itemReconcile.ok) {
    console.error(
      '[purchase:draft:reconcile-items]',
      JSON.stringify({ draftId: draft.id, code: itemReconcile.code, ...itemReconcile })
    );
    return firstUnresolvedVisualIssue(draft);
  }

  if (!draft.itemsReviewAcknowledged) {
    draft.workflowPhase = draft.editItemMode ? 'reviewing_items' : 'reviewing_items';
    if (draft.editItemMode) return buildPurchaseEditItemIssue(draft);
    return buildPurchaseItemsReviewIssue(draft);
  }

  const finanzas = await loadFinanzasConfig(businessId);
  ensurePurchaseDraftTaxMetadata(draft, businessDefaultPurchaseTaxRate(finanzas));

  const taxPresentationIssue = purchaseTaxPresentationIssue(draft);
  if (taxPresentationIssue) return taxPresentationIssue;

  const totalIssue = purchaseFinancialMismatchIssue(draft);
  if (totalIssue) return totalIssue;

  draft.workflowPhase = 'resolving_payment';

  const loadPayment = deps?.loadPurchasePaymentContext ?? loadPurchasePaymentContext;
  const ctx = paymentCtx ?? (await loadPayment(businessId));

  if (!draft.paymentMedioId) {
    if (ctx.medios.length) {
      return {
        party: 'payment',
        entityType: 'payment',
        issueKind: 'purchase_payment',
        candidates: ctx.medios.map((medio) => ({ id: medio.id, name: medio.label })),
        title: `${WA_ICON.payment} ¿Cómo se pagó?`,
      };
    }
  }

  const medio = ctx.medios.find((row) => row.id === draft.paymentMedioId);
  if (!medio) return null;

  if (medioPagoRequiereCuentaHija(medio) && !draft.paymentTarjetaId) {
    const cards = cardsForMedio(ctx.tarjetas, medio.id);
    if (cards.length === 1) {
      draft.paymentTarjetaId = cards[0]!.id;
      draft.paymentTarjetaLabel = cards[0]!.label;
    } else if (cards.length) {
      return {
        party: 'payment_card',
        entityType: 'payment',
        issueKind: 'purchase_payment_card',
        candidates: cards.map((card) => ({ id: card.id, name: card.label })),
        title: 'Tarjeta',
      };
    }
  }

  if (medioPagoGeneratesPayables(medio)) {
    console.info(
      '[purchase:payment:credit-card]',
      JSON.stringify({
        draftId: draft.id,
        paymentMedioId: draft.paymentMedioId,
        paymentTarjetaId: draft.paymentTarjetaId ?? null,
      })
    );
    if (!medioPagoRequiereCuentaHija(medio)) {
      if (!draft.paymentCuotas) draft.paymentCuotas = 1;
      if (!draft.paymentDueDate) {
        draft.paymentDueDate = asTrimmed(draft.date) || new Date().toISOString().slice(0, 10);
      }
    } else if (!draft.paymentCuotas) {
      return {
        party: 'payment_installments',
        entityType: 'payment',
        issueKind: 'purchase_payment_installments',
        candidates: [],
        title: '¿En cuántas cuotas?',
      };
    } else if (draft.paymentTarjetaId && !draft.paymentDueDate) {
      const card = findTarjetaInConfig(ctx.tarjetas, draft.paymentTarjetaId);
      if (card && applyCardScheduleToDraft(draft, card)) {
        // schedule computed
      } else if (card) {
        return {
          party: 'payment_card_config',
          entityType: 'payment',
          issueKind: 'purchase_card_due_day',
          candidates: [{ id: card.id, name: card.label }],
          title: card.label,
        };
      }
    }
  }

  if (medioPagoGeneratesImmediateCash(medio) && !draft.cashAccountId) {
    const caja = await loadCajaConfig(businessId);
    const defaults = await loadBusinessOperationalDefaults(businessId);
    const cash = resolveCashAccountFromCaja(caja, {
      businessDefaultId: effectiveDefaultCashAccountId(defaults),
      contextId: draft.cashAccountId,
    });
    if (cash.status === 'needs_selection' || cash.status === 'ambiguous') {
      return {
        party: 'cash_account',
        entityType: 'cash_account',
        issueKind: 'purchase_cash_account',
        candidates: cash.candidates.map((row) => ({ id: row.id, name: row.name })),
        title: '¿Desde qué caja?',
      };
    }
    if (cash.status === 'resolved') {
      draft.cashAccountId = cash.account.id;
      draft.cashAccountLabel = cash.account.name;
    }
  }

  console.info(
    '[purchase:draft:payment-resolved]',
    JSON.stringify({
      businessId,
      draftId: draft.id,
      paymentMedioId: draft.paymentMedioId,
      cashAccountId: draft.cashAccountId ?? null,
    })
  );

  draft.workflowPhase = 'awaiting_confirmation';

  const financial = computeDraftFinancialTotals(draft);
  console.info(
    '[purchase:draft:reconcile-financial]',
    JSON.stringify({
      draftId: draft.id,
      documentNet: draft.documentNetTotal ?? null,
      documentTax: draft.documentTaxTotal ?? null,
      documentGross: draft.documentGrossTotal ?? draft.total ?? null,
      draftNet: financial.netTotal,
      draftTax: financial.taxTotal,
      draftGross: financial.grossTotal,
    })
  );

  return null;
}

export function presentVisualPurchaseFinalReview(draft: VisualDocumentDraft): string {
  const supplier = asTrimmed(draft.supplierName || draft.supplierHint) || 'Proveedor';
  const reconcile = reconcilePurchaseDraftItems(draft);
  const { itemLines, supplyLines } = buildPurchaseItemReviewBlocks(draft);
  const blocks: string[] = [...itemLines];
  if (supplyLines.length) {
    if (blocks.length) blocks.push('');
    blocks.push('*Insumos*', ...supplyLines);
  }
  blocks.push('');
  blocks.push(...purchaseReviewFinancialLines(draft));
  blocks.push(`${reconcile.quantityTotal} artículos`);
  const paymentBits: string[] = [];
  if (draft.paymentMedioLabel) paymentBits.push(draft.paymentMedioLabel);
  if (draft.paymentTarjetaLabel) paymentBits.push(draft.paymentTarjetaLabel);
  if (draft.paymentCuotas) paymentBits.push(`${draft.paymentCuotas} cuotas`);
  if (draft.paymentDueDate) {
    paymentBits.push(`1ª ${formatPurchaseDateEs(draft.paymentDueDate)}`);
  }
  if (draft.cashAccountLabel) paymentBits.push(`caja ${draft.cashAccountLabel}`);
  if (paymentBits.length) {
    blocks.push(`Pago: ${paymentBits.join(' · ')}`);
  }
  return formatWhatsappMessage({
    title: `${WA_ICON.purchases} Compra · ${supplier}`,
    lines: blocks,
    ask: V4_CONFIRMATION_PROMPT,
  });
}

function buildVisualResolutionReply(
  draft: VisualDocumentDraft,
  issue: VisualDraftIssue | null,
  linkedItem?: { item: VisualDraftItem; productName: string },
  linkNotFound?: boolean,
  searchedQuery?: string
): string {
  const parts: string[] = [];
  if (linkedItem) {
    parts.push(presentVisualItemLinked(linkedItem.item, linkedItem.productName));
    console.info(
      '[purchase:draft:item-linked]',
      JSON.stringify({
        draftId: draft.id,
        itemIndex: linkedItem.item.index,
        productId: linkedItem.item.matchedProductId ?? null,
      })
    );
    if (issue && (issue.issueKind === 'visual_not_found_menu' || issue.issueKind === 'product_candidate_selection' || issue.issueKind === 'manual_product_match')) {
      parts.push(presentVisualDraftIssueReply(draft, issue, { lead: 'continue' }));
      return parts.filter(Boolean).join('\n\n');
    }
  } else if (linkNotFound) {
    parts.push(presentManualCatalogSearchMiss(searchedQuery ?? ''));
  }
  if (issue) {
    const lead =
      issue.issueKind === 'visual_not_found_menu' ||
      issue.issueKind === 'product_candidate_selection' ||
      issue.issueKind === 'manual_product_match'
        ? linkNotFound
          ? 'continue'
          : 'start'
        : 'none';
    parts.push(presentVisualDraftIssueReply(draft, issue, { lead }));
  } else if (isVisualDraftReadyToWrite(draft)) {
    console.info('[purchase:draft:ready-for-confirmation]', JSON.stringify({ draftId: draft.id }));
    parts.push(
      draft.kind === 'purchase' ? presentVisualPurchaseFinalReview(draft) : presentVisualDraft(draft)
    );
  }
  return parts.filter(Boolean).join('\n\n');
}

export function isVisualDraftReadyToWrite(draft: VisualDocumentDraft): boolean {
  if (!isVisualDraftAlive(draft)) return false;
  const active = draft.items.filter((item) => item.matchStatus !== 'discarded');
  if (!active.length) return false;
  if (draft.kind === 'purchase') {
    if (!asTrimmed(draft.supplierName || draft.supplierHint || draft.supplierId)) return false;
    if (!draft.itemsReviewAcknowledged) return false;
    if (!String(draft.paymentMedioId ?? '').trim()) return false;
  }
  if (draft.kind === 'order') {
    if (!asTrimmed(draft.clientId)) return false;
    if (!asTrimmed(draft.deliveryDate)) return false;
  }
  return active.every((item) => {
    if (item.matchStatus === 'resolved' && item.matchedProductId) return true;
    if (item.unresolvedAction === 'free_line') return true;
    if (item.unresolvedAction === 'create' && item.selectionSource === 'created' && item.matchedProductId) return true;
    return false;
  });
}

export function presentVisualDraft(draft: VisualDocumentDraft): string {
  const title =
    draft.kind === 'purchase'
      ? `Compra · ${asTrimmed(draft.supplierName || draft.supplierHint) || 'Proveedor'}`
      : `Pedido para ${asTrimmed(draft.clientName || draft.clientHint) || 'cliente'}`;
  const lines: string[] = [];
  if (draft.readability === 'unreadable' || draft.readability === 'partial') {
    lines.push('No pude leer bien algunos datos de la imagen.');
  }
  for (const item of draft.items) {
    const qty = item.quantity != null ? `${item.quantity} u` : '';
    const cost = item.unitCost != null ? `$${money(item.unitCost)} c/u` : '';
    const detail = [qty, cost].filter(Boolean).join(' · ');
    if (item.matchStatus === 'discarded' || item.unresolvedAction === 'discard') {
      lines.push(`${item.index}. ${item.description}`, 'DESCARTADO');
      continue;
    }
    const matchLabel =
      item.matchStatus === 'resolved' && item.matchedProductName
        ? `Match: ${item.matchedProductName}`
        : item.unresolvedAction === 'free_line'
          ? 'Insumo sin stock'
          : item.matchStatus === 'ambiguous'
            ? 'Match: a confirmar'
            : item.matchStatus === 'not_found'
              ? 'Sin match'
              : '';
    lines.push(`${item.index}. ${item.description}`);
    if (detail) lines.push(detail);
    if (matchLabel) lines.push(matchLabel);
  }
  const computedTotal = draft.items.reduce((sum, item) => {
    if (item.matchStatus === 'discarded' || item.unresolvedAction === 'discard') return sum;
    if (item.subtotal != null) return sum + item.subtotal;
    if (item.quantity != null && item.unitCost != null) return sum + item.quantity * item.unitCost;
    return sum;
  }, 0);
  const total = draft.total != null ? draft.total : computedTotal || undefined;
  if (draft.kind === 'order') {
    if (draft.deliveryDate) lines.push(`Entrega: ${draft.deliveryDate}`);
    if (draft.deposit != null) lines.push(`Seña: $${money(draft.deposit)}`);
  } else if (total != null && total > 0) {
    lines.push(`Total: $${money(total)}`);
  }
  const ask = undefined;
  return formatWhatsappMessage({ title, lines, ask });
}

export function candidateOptionsForIssue(issue: VisualDraftIssue): CandidateSelectionOption[] {
  if (issue.issueKind === 'manual_product_match') {
    const products = issue.candidates.filter((row) => !isVisualMatchActionId(row.id));
    const actions = issue.candidates.filter(
      (row) => isVisualMatchActionId(row.id) && row.id !== VISUAL_MANUAL_MATCH_BACK
    );
    const back = issue.candidates.find((row) => row.id === VISUAL_MANUAL_MATCH_BACK);
    const options = [
      ...products.map((row, idx) => ({ index: idx + 1, entityId: row.id, label: row.name })),
      ...actions.map((row, idx) => ({
        index: products.length + idx + 1,
        entityId: row.id,
        label: row.name,
      })),
    ];
    if (back) options.unshift({ index: 0, entityId: VISUAL_MANUAL_MATCH_BACK, label: back.name });
    return options;
  }
  if (issue.issueKind === 'product_candidate_selection') {
    const products = issue.candidates.filter((row) => !isVisualMatchActionId(row.id));
    const actions = issue.candidates.filter(
      (row) =>
        isVisualMatchActionId(row.id) &&
        row.id !== VISUAL_CANDIDATE_CANCEL &&
        row.id !== VISUAL_CANDIDATE_BACK &&
        row.id !== VISUAL_MORE_OPTIONS &&
        row.id !== VISUAL_NOT_FOUND_LINK
    );
    const back = issue.candidates.find((row) => row.id === VISUAL_CANDIDATE_BACK);
    const cancel = issue.candidates.find((row) => row.id === VISUAL_CANDIDATE_CANCEL);
    const options = [
      ...products.map((row, idx) => ({ index: idx + 1, entityId: row.id, label: row.name })),
      ...actions.map((row, idx) => ({
        index: products.length + idx + 1,
        entityId: row.id,
        label: row.name,
      })),
    ];
    if (back) options.unshift({ index: 0, entityId: VISUAL_CANDIDATE_BACK, label: back.name });
    else if (cancel) {
      options.unshift({ index: 0, entityId: VISUAL_CANDIDATE_CANCEL, label: cancel.name });
    }
    return options;
  }
  if (issue.issueKind === 'visual_not_found_menu') {
    const actionable = issue.candidates.filter((row) => row.id !== VISUAL_CANDIDATE_CANCEL);
    const cancel = issue.candidates.find((row) => row.id === VISUAL_CANDIDATE_CANCEL);
    const options = actionable.map((row, idx) => ({
      index: idx + 1,
      entityId: row.id,
      label: row.name,
    }));
    if (cancel) options.unshift({ index: 0, entityId: cancel.id, label: cancel.name });
    return options;
  }
  if (issue.issueKind === 'purchase_tax_presentation') {
    const actionable = issue.candidates.filter((row) => row.id !== VISUAL_CANDIDATE_CANCEL);
    const cancel = issue.candidates.find((row) => row.id === VISUAL_CANDIDATE_CANCEL);
    const options = actionable.map((row, idx) => ({
      index: idx + 1,
      entityId: row.id,
      label: row.name,
    }));
    if (cancel) options.unshift({ index: 0, entityId: cancel.id, label: cancel.name });
    return options;
  }
  if (
    issue.issueKind === 'purchase_payment' ||
    issue.issueKind === 'purchase_payment_card' ||
    issue.issueKind === 'purchase_cash_account'
  ) {
    const options = issue.candidates.map((row, idx) => ({
      index: idx + 1,
      entityId: row.id,
      label: row.name,
    }));
    options.unshift({ index: 0, entityId: VISUAL_PAYMENT_BACK, label: '↩️ Volver' });
    return options;
  }
  if (issue.issueKind === 'purchase_items_review') {
    return [
      { index: 1, entityId: VISUAL_REVIEW_CONTINUE, label: '✅ Continuar' },
      { index: 2, entityId: VISUAL_REVIEW_CHANGE, label: '✏️ Cambiar ítem' },
      { index: 0, entityId: VISUAL_REVIEW_CANCEL, label: '❌ Cancelar compra' },
    ];
  }
  if (issue.issueKind === 'purchase_edit_item') {
    const options = issue.candidates
      .filter((row) => row.id !== VISUAL_EDIT_ITEM_BACK)
      .map((row, idx) => ({ index: idx + 1, entityId: row.id, label: row.name }));
    options.unshift({ index: 0, entityId: VISUAL_EDIT_ITEM_BACK, label: '↩️ Volver' });
    return options;
  }
  return normalizeCandidateRows(issue.entityType, issue.candidates);
}

function candidateStateForIssue(
  draft: VisualDocumentDraft,
  issue: VisualDraftIssue,
  originalUserText: string
): Partial<ConversationState> {
  const options = candidateOptionsForIssue(issue);
  const resume: CandidateSelectionResume = {
    originalUserText,
    blockedTool: 'ingest_visual_document',
    sourceTool: 'ingest_visual_document',
    draftId: draft.id,
    itemIndex: issue.itemIndex,
    party: issue.party,
  };
  const item = issue.itemIndex != null ? draft.items.find((row) => row.index === issue.itemIndex) : undefined;
  const extractedDescription = asTrimmed(item?.sourceText) || asTrimmed(item?.description) || undefined;
  const awaitingType =
    issue.issueKind === 'visual_not_found_menu'
      ? 'unresolved_catalog_item'
      : issue.issueKind === 'manual_product_match'
        ? 'manual_product_match_search'
        : 'candidate_selection';
  if (issue.issueKind === 'purchase_card_due_day') {
    return {
      visualDraft: draft,
      pendingIntent: null,
      pendingPayload: null,
      pendingPrompt: issue.title,
      activeTask: {
        intent: 'visual_draft_resolution',
        awaiting: {
          type: 'purchase_card_due_day',
          draftId: draft.id,
          cardId: issue.candidates[0]?.id ?? draft.paymentTarjetaId,
        },
      },
    };
  }
  if (issue.issueKind === 'purchase_payment_installments') {
    return {
      visualDraft: draft,
      pendingIntent: null,
      pendingPayload: null,
      pendingPrompt: '¿En cuántas cuotas?',
      activeTask: {
        intent: 'visual_draft_resolution',
        awaiting: {
          type: 'purchase_payment_installments',
          draftId: draft.id,
        },
      },
    };
  }
  return {
    ...buildCandidateSelectionState({
      entityType: issue.entityType,
      options,
      resume,
    }),
    visualDraft: draft,
    pendingPrompt: issue.issueKind === 'visual_not_found_menu' ? VISUAL_CATALOG_MATCH_PROMPT : issue.title,
    activeTask: {
      intent: 'visual_draft_resolution',
      awaiting:
        awaitingType === 'candidate_selection'
          ? { field: 'selection', type: 'candidate_selection', reason: issue.entityType }
          : {
              type: awaitingType,
              itemIndex: issue.itemIndex,
              draftId: draft.id,
              extractedDescription,
            },
    },
  };
}

async function resolveParty(
  businessId: string,
  kind: VisualDraftKind,
  hint: string,
  deps: VisualDraftDeps
): Promise<{ status: VisualMatchStatus; id?: string; name?: string; candidates?: Array<{ id: string; name: string }> }> {
  if (!hint) return { status: 'unresolved' };
  if (kind === 'purchase') {
    const find = deps.findSupplier ?? findSupplier;
    const resolved = await find(businessId, hint);
    if (resolved.status === 'resolved' && resolved.entity) {
      return { status: 'resolved', id: resolved.entity.id, name: resolved.entity.name };
    }
    if (resolved.status === 'ambiguous') {
      return { status: 'ambiguous', candidates: resolved.candidates };
    }
    return { status: 'not_found', name: hint };
  }
  const find = deps.findClient ?? findClient;
  const resolved = await find(businessId, hint, { utterance: hint });
  if (resolved.status === 'resolved' && resolved.entity) {
    return { status: 'resolved', id: resolved.entity.id, name: resolved.entity.name };
  }
  if (resolved.status === 'ambiguous') {
    return { status: 'ambiguous', candidates: resolved.candidates };
  }
  return { status: 'not_found', name: hint };
}

export async function ingestVisualDocument(
  args: IngestVisualDocumentArgs,
  ctx: ToolExecutionContext,
  deps: VisualDraftDeps = {}
): Promise<Record<string, unknown>> {
  const kind: VisualDraftKind = asTrimmed(args.kind).toLowerCase() === 'order' ? 'order' : 'purchase';
  const existing = liveVisualDraft(ctx.state);

  if (kind === 'purchase' && shouldResumeExistingPurchaseDraft(existing, args)) {
    const draft = existing!;
    draft.expiresAt = expiresAtFrom();
    let issue = firstUnresolvedVisualIssue(draft);
    if (!issue) {
      issue = await resolveVisualDraftBlockingIssue(draft, ctx.tenant.businessId, undefined, deps);
    }
    const pending = countUnresolvedVisualItems(draft);
    console.info(
      '[purchase:draft:resume-existing]',
      JSON.stringify({
        draftId: draft.id,
        pending,
        invoiceNumber: draft.invoiceNumber ?? null,
      })
    );
    const result = serializeIngestResult(draft, issue, ctx.rawUserMessage);
    if (
      issue &&
      (issue.issueKind === 'visual_not_found_menu' ||
        issue.issueKind === 'product_candidate_selection' ||
        issue.issueKind === 'manual_product_match')
    ) {
      result.message = presentVisualDraftIssueReply(draft, issue, { lead: 'resume' });
    } else if (isVisualDraftReadyToWrite(draft)) {
      result.message = [
        'Esta factura ya está cargada.',
        draft.kind === 'purchase' ? presentVisualPurchaseFinalReview(draft) : presentVisualDraft(draft),
      ].join('\n\n');
    } else if (issue) {
      result.message = [
        pending > 0
          ? pending === 1
            ? 'Esta factura ya está cargada. Queda 1 producto por resolver.'
            : `Esta factura ya está cargada. Quedan ${pending} productos por resolver.`
          : 'Esta factura ya está cargada.',
        presentVisualDraftIssueReply(draft, issue, { lead: 'none' }),
      ]
        .filter(Boolean)
        .join('\n\n');
    }
    result.resumedExisting = true;
    return result;
  }

  const replace = shouldReplaceExistingVisualDraft(existing, args, kind);
  const append =
    args.append === true || (!replace && Boolean(existing) && existing?.kind === kind && args.append !== false);
  const incoming = parseIncomingItems(args.items, append && existing ? existing.items.length + 1 : 1);
  const readabilityRaw = asTrimmed(args.readability).toLowerCase();
  const readability: VisualReadability | undefined =
    readabilityRaw === 'unreadable' || readabilityRaw === 'partial' || readabilityRaw === 'ok'
      ? (readabilityRaw as VisualReadability)
      : incoming.length
        ? undefined
        : 'unreadable';

  let draft: VisualDocumentDraft;
  if (append && existing && existing.kind === kind) {
    draft = {
      ...existing,
      expiresAt: expiresAtFrom(),
      readability: readability ?? existing.readability,
      notes: asTrimmed(args.notes) || existing.notes,
      supplierHint: asTrimmed(args.supplierHint) || existing.supplierHint,
      date: asTrimmed(args.date) || existing.date,
      invoiceNumber: asTrimmed(args.invoiceNumber) || existing.invoiceNumber,
      total: asOptionalNumber(args.total) ?? existing.total,
      documentNetTotal: asOptionalNumber(args.documentNetTotal) ?? existing.documentNetTotal,
      documentTaxTotal: asOptionalNumber(args.documentTaxTotal) ?? existing.documentTaxTotal,
      documentGrossTotal:
        asOptionalNumber(args.documentGrossTotal) ??
        asOptionalNumber(args.total) ??
        existing.documentGrossTotal,
      documentTaxRate: asOptionalNumber(args.documentTaxRate) ?? existing.documentTaxRate,
      priceTaxMode:
        mapTaxPresentationToPriceTaxMode(args.taxPresentation) ??
        (args.priceTaxMode === 'net' || args.priceTaxMode === 'gross' || args.priceTaxMode === 'unknown'
          ? args.priceTaxMode
          : existing.priceTaxMode),
      articleCount: asOptionalNumber(args.articleCount) ?? existing.articleCount,
      paymentStatus: asTrimmed(args.paymentStatus) || existing.paymentStatus,
      clientHint: asTrimmed(args.clientHint) || existing.clientHint,
      deliveryDate: asTrimmed(args.deliveryDate) || existing.deliveryDate,
      deposit: asOptionalNumber(args.deposit) ?? existing.deposit,
      sourceMessageIds: [...new Set([...(existing.sourceMessageIds ?? []), asTrimmed(ctx.messageId)].filter(Boolean))],
      items: reindex([...(existing.items ?? []), ...incoming]),
    };
  } else {
    draft = {
      id: newDraftId(),
      kind,
      status: 'draft',
      createdAt: nowIso(),
      expiresAt: expiresAtFrom(),
      sourceMessageIds: [asTrimmed(ctx.messageId)].filter(Boolean),
      readability,
      notes: asTrimmed(args.notes) || undefined,
      supplierHint: asTrimmed(args.supplierHint) || undefined,
      date: asTrimmed(args.date) || undefined,
      invoiceNumber: asTrimmed(args.invoiceNumber) || undefined,
      total: asOptionalNumber(args.total),
      documentNetTotal: asOptionalNumber(args.documentNetTotal),
      documentTaxTotal: asOptionalNumber(args.documentTaxTotal),
      documentGrossTotal: asOptionalNumber(args.documentGrossTotal) ?? asOptionalNumber(args.total),
      documentTaxRate: asOptionalNumber(args.documentTaxRate),
      priceTaxMode:
        mapTaxPresentationToPriceTaxMode(args.taxPresentation) ??
        (args.priceTaxMode === 'net' || args.priceTaxMode === 'gross' || args.priceTaxMode === 'unknown'
          ? args.priceTaxMode
          : undefined),
      articleCount: asOptionalNumber(args.articleCount),
      paymentStatus: asTrimmed(args.paymentStatus) || undefined,
      clientHint: asTrimmed(args.clientHint) || undefined,
      deliveryDate: asTrimmed(args.deliveryDate) || undefined,
      deposit: asOptionalNumber(args.deposit),
      items: reindex(incoming),
    };
  }

  const utterance = ctx.rawUserMessage;

  // 1) Document Understanding financiero ANTES del matching de catálogo.
  let interpretationFeedback: Record<string, unknown> | undefined;
  if (kind === 'purchase') {
    const { reconcile, askTaxPresentation } = applyDocumentUnderstandingToDraft(draft, args);
    const finanzas = await loadFinanzasConfig(ctx.tenant.businessId);
    ensurePurchaseDraftTaxMetadata(draft, businessDefaultPurchaseTaxRate(finanzas));
    if (!reconcile.ok && 'feedback' in reconcile) {
      interpretationFeedback = reconcile.feedback as unknown as Record<string, unknown>;
    }
    if (askTaxPresentation) {
      draft.status = 'awaiting_resolution';
      const taxIssue = buildPurchaseTaxPresentationIssue(draft);
      const result = serializeIngestResult(draft, taxIssue, ctx.rawUserMessage);
      result.interpretationFeedback = interpretationFeedback;
      result.message = presentTaxPresentationAmbiguityAsk();
      return result;
    }
    // Feedback estructurado para reintento del Agent; no bloquea matching.
    if (
      !reconcile.ok &&
      reconcile.askUser &&
      reconcile.reason === 'ambiguous' &&
      (draft.interpretationAttempts ?? 0) < MAX_DOCUMENT_INTERPRETATION_ATTEMPTS
    ) {
      console.info(
        '[purchase:document:needs-reinterpretation]',
        JSON.stringify({ draftId: draft.id, feedback: reconcile.feedback })
      );
    }
  }

  if (kind === 'purchase' && draft.supplierHint && !draft.supplierId) {
    const party = await resolveParty(ctx.tenant.businessId, 'purchase', draft.supplierHint, deps);
    draft.supplierMatchStatus = party.status;
    draft.supplierId = party.id;
    draft.supplierName = party.name || draft.supplierHint;
    if (party.status === 'ambiguous') {
      draft.status = 'awaiting_resolution';
      return serializeIngestResult(draft, supplierAmbiguousIssue(draft, party.candidates ?? []), ctx.rawUserMessage);
    }
    if (party.status === 'not_found') {
      draft.supplierName = draft.supplierHint;
    }
  }

  draft.items = await Promise.all(draft.items.map((item) => {
    if (item.matchStatus === 'resolved' || item.matchStatus === 'discarded') return item;
    if (item.unresolvedAction === 'free_line') return item;
    if (item.selectionSource === 'user_selected') return item;
    return matchProductItem(ctx.tenant.businessId, item, utterance, deps, draft.supplierId);
  }));

  if (kind === 'order' && draft.clientHint && !draft.clientId) {
    const party = await resolveParty(ctx.tenant.businessId, 'order', draft.clientHint, deps);
    draft.clientMatchStatus = party.status;
    draft.clientId = party.id;
    draft.clientName = party.name || draft.clientHint;
    if (party.status === 'ambiguous') {
      draft.status = 'awaiting_resolution';
      return serializeIngestResult(draft, clientAmbiguousIssue(draft, party.candidates ?? []), ctx.rawUserMessage);
    }
  }

  draft.status = draftStatusFromItems(draft);
  if (draft.kind === 'purchase') {
    const finanzas = await loadFinanzasConfig(ctx.tenant.businessId);
    ensurePurchaseDraftTaxMetadata(draft, businessDefaultPurchaseTaxRate(finanzas));
  }
  let issue = firstUnresolvedVisualIssue(draft);
  if (!issue && draft.kind === 'purchase') {
    console.info('[purchase:draft:all-items-resolved]', JSON.stringify({ draftId: draft.id }));
    issue = await resolveVisualDraftBlockingIssue(draft, ctx.tenant.businessId, undefined, deps);
  }
  const result = serializeIngestResult(draft, issue, ctx.rawUserMessage);
  if (interpretationFeedback) {
    result.interpretationFeedback = interpretationFeedback;
  }
  return result;
}

function serializeIngestResult(
  draft: VisualDocumentDraft,
  issue: VisualDraftIssue | null,
  originalUserText: string,
  extras?: {
    productLinkStatus?:
      | 'resolved'
      | 'not_found'
      | 'awaiting_selection'
      | 'candidate_none'
      | 'create_new_product'
      | 'free_line';
    linkedProductName?: string;
    linkedItemIndex?: number;
    searchedQuery?: string;
  }
): Record<string, unknown> {
  const ready = isVisualDraftReadyToWrite(draft);
  const linkedItem =
    extras?.linkedItemIndex != null
      ? draft.items.find((row) => row.index === extras.linkedItemIndex)
      : undefined;
  const defaultMessage = issue
    ? presentVisualDraftIssueReply(draft, issue)
    : ready
      ? draft.kind === 'purchase'
        ? presentVisualPurchaseFinalReview(draft)
        : presentVisualDraft(draft)
      : presentVisualDraft(draft);

  const base: Record<string, unknown> = {
    status: ready ? 'ready' : issue ? 'ambiguous' : draft.status,
    draft,
    kind: draft.kind,
    draftId: draft.id,
    wroteErp: false,
    message: defaultMessage,
  };
  if (extras?.productLinkStatus === 'resolved' && extras.linkedProductName && linkedItem) {
    base.message = buildVisualProductMatchReply(
      draft,
      issue,
      'resolved',
      linkedItem,
      extras.linkedProductName
    );
  } else if (extras?.productLinkStatus === 'not_found') {
    base.message = buildVisualProductMatchReply(
      draft,
      issue,
      'not_found',
      undefined,
      undefined,
      extras.searchedQuery
    );
  } else if (extras?.productLinkStatus === 'awaiting_selection' && issue) {
    base.message = buildVisualProductMatchReply(draft, issue, 'awaiting_selection');
  }
  if (issue) {
    base.status = 'ambiguous';
    base.errorCode = 'ENTITY_AMBIGUOUS';
    base.entityType = issue.entityType;
    base.candidates = issue.candidates;
    base.itemIndex = issue.itemIndex ?? null;
    base.party = issue.party;
    base.title = issue.title;
    base.issueKind = issue.issueKind ?? null;
    base.draftId = draft.id;
    base.selectionPatch = candidateStateForIssue(draft, issue, originalUserText);
  }
  if (extras?.productLinkStatus) {
    base.productLinkStatus = extras.productLinkStatus;
    base.linkedProductName = extras.linkedProductName ?? null;
  }
  if (extras?.searchedQuery) {
    base.searchedQuery = extras.searchedQuery;
  }
  return base;
}

async function applyVisualDraftPaymentPatch(
  draft: VisualDocumentDraft,
  args: Record<string, unknown>,
  businessId: string,
  deps: VisualDraftDeps
): Promise<void> {
  const loadPayment = deps.loadPurchasePaymentContext ?? loadPurchasePaymentContext;
  const paymentCtx = await loadPayment(businessId);
  const medioId = asTrimmed(args.paymentMedioId);
  if (medioId) {
    const medio = paymentCtx.medios.find((row) => row.id === medioId);
    if (medio) {
      draft.paymentMedioId = medio.id;
      draft.paymentMedioLabel = medio.label;
    }
  }
  const medioQuery = asTrimmed(args.paymentMedioQuery);
  if (medioQuery && !draft.paymentMedioId) {
    const matched = matchMedioFromText(medioQuery, paymentCtx.medios);
    if (matched) {
      draft.paymentMedioId = matched.id;
      draft.paymentMedioLabel = matched.label;
    }
  }
  const tarjetaId = asTrimmed(args.paymentTarjetaId);
  if (tarjetaId) {
    const card = paymentCtx.tarjetas.find((row) => row.id === tarjetaId);
    draft.paymentTarjetaId = tarjetaId;
    draft.paymentTarjetaLabel = card?.label ?? tarjetaId;
  }
  const tarjetaQuery = asTrimmed(args.paymentTarjetaQuery);
  if (tarjetaQuery && draft.paymentMedioId) {
    const cards = cardsForMedio(paymentCtx.tarjetas, draft.paymentMedioId);
    const card = cards.find((row) =>
      row.label.toLowerCase().includes(tarjetaQuery.toLowerCase())
    );
    if (card) {
      draft.paymentTarjetaId = card.id;
      draft.paymentTarjetaLabel = card.label;
    }
  }
  if (args.paymentCuotas != null) {
    draft.paymentCuotas = Math.max(1, Number(args.paymentCuotas) || 1);
  }
}

async function applyVisualDraftConversationAction(
  draft: VisualDocumentDraft,
  item: VisualDraftItem,
  action: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  deps: VisualDraftDeps
): Promise<Record<string, unknown> | null> {
  if (action === 'candidate_none') {
    item.matchStatus = 'not_found';
    item.candidates = undefined;
    item.candidatePool = undefined;
    item.candidateOffset = undefined;
    item.manualLinkPending = false;
    item.unresolvedAction = null;
    item.matchedProductId = undefined;
    item.matchedProductName = undefined;
    item.selectionSource = undefined;
    draft.status = draftStatusFromItems(draft);
    const issue = firstUnresolvedVisualIssue(draft);
    return serializeIngestResult(draft, issue, ctx.rawUserMessage, { productLinkStatus: 'candidate_none' });
  }
  if (action === 'create_new_product') {
    const created = await createAndLinkVisualDraftProduct(
      ctx.tenant.businessId,
      draft,
      item.index,
      deps
    );
    Object.assign(draft, created.draft);
    const nextItem = draft.items.find((row) => row.index === item.index);
    if (nextItem) Object.assign(item, nextItem);
    draft.status = draftStatusFromItems(draft);
    let issue = firstUnresolvedVisualIssue(draft);
    if (!issue && draft.kind === 'purchase') {
      issue = await resolveVisualDraftBlockingIssue(draft, ctx.tenant.businessId, undefined, deps);
    }
    return serializeIngestResult(draft, issue, ctx.rawUserMessage, {
      productLinkStatus: 'resolved',
      linkedProductName: created.created.name,
      linkedItemIndex: item.index,
    });
  }
  if (action === 'use_uncatalogued_item') {
    item.unresolvedAction = 'free_line';
    item.matchStatus = 'resolved';
    item.selectionSource = 'created';
    item.matchedProductId = undefined;
    item.candidates = undefined;
    draft.status = draftStatusFromItems(draft);
    let issue = firstUnresolvedVisualIssue(draft);
    if (!issue && draft.kind === 'purchase') {
      issue = await resolveVisualDraftBlockingIssue(draft, ctx.tenant.businessId, undefined, deps);
    }
    return serializeIngestResult(draft, issue, ctx.rawUserMessage, { productLinkStatus: 'free_line' });
  }
  if (action === 'discard_item') {
    item.matchStatus = 'discarded';
    item.selectionSource = 'discarded';
    item.unresolvedAction = 'discard';
    item.matchedProductId = undefined;
    item.candidates = undefined;
    draft.status = draftStatusFromItems(draft);
    let issue = firstUnresolvedVisualIssue(draft);
    if (!issue && draft.kind === 'purchase') {
      issue = await resolveVisualDraftBlockingIssue(draft, ctx.tenant.businessId, undefined, deps);
    }
    return serializeIngestResult(draft, issue, ctx.rawUserMessage);
  }
  if (action === 'search_other_product') {
    const productQuery = extractCatalogProductQueryFromUserText(asTrimmed(args.productQuery));
    if (!productQuery) return null;
    // Siempre pedir confirmación numerada (igual que free-text manual).
    const linked = await linkProductByUserQuery(ctx.tenant.businessId, item, productQuery, deps, {
      manualSearch: true,
    });
    Object.assign(item, linked.item);
    draft.status = draftStatusFromItems(draft);
    let issue = firstUnresolvedVisualIssue(draft);
    if (linked.searchStatus === 'not_found') {
      return serializeIngestResult(draft, issue, ctx.rawUserMessage, {
        productLinkStatus: 'not_found',
        searchedQuery: productQuery,
      });
    }
    if (linked.searchStatus === 'awaiting_selection') {
      return serializeIngestResult(draft, issue, ctx.rawUserMessage, { productLinkStatus: 'awaiting_selection' });
    }
    if (linked.searchStatus === 'resolved') {
      if (!issue && draft.kind === 'purchase') {
        issue = await resolveVisualDraftBlockingIssue(draft, ctx.tenant.businessId, undefined, deps);
      }
      return serializeIngestResult(draft, issue, ctx.rawUserMessage, {
        productLinkStatus: 'resolved',
        linkedProductName: linked.matchedName,
        linkedItemIndex: item.index,
      });
    }
    return serializeIngestResult(draft, issue, ctx.rawUserMessage);
  }
  if (action === 'cancel_workflow') {
    draft.status = 'cancelled';
    return serializeIngestResult(draft, null, ctx.rawUserMessage);
  }
  return null;
}

export async function tryResolveOrphanVisualDraftPaymentSelection(input: {
  text: string;
  state: ConversationState | null | undefined;
  tenant: WhatsappTenantContext;
  deps?: VisualDraftDeps;
}): Promise<{ reply: string; statePatch: Partial<ConversationState>; intent: string } | null> {
  if (getCandidateSelectionAwaiting(input.state)) return null;

  const draft = reviveVisualDraft(input.state);
  if (!draft || draft.kind !== 'purchase' || !draft.itemsReviewAcknowledged) return null;
  if (parseNumericSelectionTurn(input.text).index == null) return null;

  let issue = firstUnresolvedVisualIssue(draft);
  if (!issue) {
    issue = await resolveVisualDraftBlockingIssue(
      draft,
      input.tenant.businessId,
      undefined,
      input.deps
    );
  }
  if (!isVisualPurchasePaymentIssue(issue)) return null;

  const options = candidateOptionsForIssue(issue!);
  const awaiting = {
    type: 'candidate_selection' as const,
    entityType: issue!.entityType,
    options,
    resume: {
      originalUserText: input.text,
      blockedTool: 'ingest_visual_document',
      sourceTool: 'ingest_visual_document',
      draftId: draft.id,
      party: issue!.party,
    },
  };
  const resolution = resolveCandidateSelectionTurn(input.text, awaiting);
  if (resolution.kind !== 'selected') return null;

  const { resumeBlockedToolAfterSelection } = await import('./v4-resume-blocked-tool.ts');
  const resumed = await resumeBlockedToolAfterSelection({
    tenant: input.tenant,
    state: { ...(input.state ?? {}), visualDraft: draft },
    awaiting,
    option: resolution.option,
    visualDraftDeps: input.deps,
  });
  return {
    reply: resumed.reply,
    statePatch: { ...resumed.statePatch, visualDraft: draft },
    intent: 'v4_purchase_payment_selected',
  };
}

export async function patchVisualDraft(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  deps: VisualDraftDeps = {}
): Promise<Record<string, unknown>> {
  const existing = reviveVisualDraft(ctx.state);
  if (!existing) {
    return { status: 'not_found', message: 'No hay un borrador de imagen activo.', wroteErp: false };
  }
  const draft: VisualDocumentDraft = {
    ...existing,
    items: existing.items.map((item) => ({ ...item })),
    expiresAt: expiresAtFrom(),
  };

  const reviewAction = asTrimmed(args.reviewAction);
  if (reviewAction === 'continue') {
    draft.itemsReviewAcknowledged = true;
    draft.editItemMode = false;
    draft.workflowPhase = 'resolving_payment';
  } else if (reviewAction === 'change') {
    draft.editItemMode = true;
    draft.workflowPhase = 'reviewing_items';
  } else if (reviewAction === 'cancel') {
    draft.status = 'cancelled';
  }

  const editItemIndex = args.editItemIndex != null ? Number(args.editItemIndex) : undefined;
  if (editItemIndex != null && Number.isFinite(editItemIndex)) {
    const editItem = draft.items.find((row) => row.index === editItemIndex);
    if (editItem) {
      Object.assign(editItem, resetItemForEdit(editItem));
      draft.editItemMode = false;
    }
  }

  await applyVisualDraftPaymentPatch(draft, args, ctx.tenant.businessId, deps);

  // Corrección fiscal natural vía Agent (sin perder matches de producto).
  const taxPresentationPatch =
    mapTaxPresentationToPriceTaxMode(args.taxPresentation) ??
    mapTaxPresentationToPriceTaxMode(args.priceTaxMode);
  if (taxPresentationPatch === 'net' || taxPresentationPatch === 'gross') {
    const productIdsBefore = draft.items.map((row) => row.matchedProductId ?? null);
    applyTaxPresentationCorrection(draft, taxPresentationPatch);
    console.info(
      '[purchase:document:tax-presentation:patch]',
      JSON.stringify({
        draftId: draft.id,
        priceTaxMode: taxPresentationPatch,
        productsPreserved: draft.items.every(
          (row, idx) => (row.matchedProductId ?? null) === productIdsBefore[idx]
        ),
      })
    );
  }

  const itemIndex = args.itemIndex != null ? Number(args.itemIndex) : undefined;
  if (itemIndex != null && Number.isFinite(itemIndex)) {
    const item = draft.items.find((row) => row.index === itemIndex);
    if (!item) {
      return { status: 'not_found', message: `No hay ítem ${itemIndex} en el borrador.`, draft, wroteErp: false };
    }
    const conversationAction = asTrimmed(args.conversationAction);
    if (conversationAction) {
      const handled = await applyVisualDraftConversationAction(
        draft,
        item,
        conversationAction,
        args,
        ctx,
        deps
      );
      if (handled) return handled;
    }
    if (args.discard === true) {
      item.matchStatus = 'discarded';
      item.selectionSource = 'discarded';
      item.unresolvedAction = 'discard';
      item.matchedProductId = undefined;
      item.matchedProductName = undefined;
      item.candidates = undefined;
    } else {
      if (args.quantity != null) item.quantity = asOptionalNumber(args.quantity);
      if (args.unitCost != null) item.unitCost = asOptionalNumber(args.unitCost);
      if (args.notes != null) item.notes = asTrimmed(args.notes) || undefined;
      const attrs = { ...(item.attributes ?? {}) };
      if (args.size != null) attrs.size = asTrimmed(args.size) || null;
      if (args.color != null) attrs.color = asTrimmed(args.color) || null;
      if (args.type != null) attrs.type = asTrimmed(args.type) || null;
      if (args.variant != null) attrs.variant = asTrimmed(args.variant) || null;
      item.attributes = attrs;
      if (args.description != null) {
        item.description = asTrimmed(args.description) || item.description;
        item.sourceText = item.description;
      }
      const action = asTrimmed(args.unresolvedAction);
      if (action === 'free_line' || action === 'discard' || action === 'create') {
        item.unresolvedAction = action;
        if (action === 'discard') {
          item.matchStatus = 'discarded';
          item.selectionSource = 'discarded';
        }
        if (action === 'free_line') {
          item.matchStatus = 'resolved';
          item.selectionSource = 'created';
          item.matchedProductId = undefined;
        }
      }
      const productQuery = extractCatalogProductQueryFromUserText(asTrimmed(args.productQuery));
      if (productQuery) {
        const manualSearch = args.manualProductSearch === true;
        const linked = await linkProductByUserQuery(ctx.tenant.businessId, item, productQuery, deps, {
          manualSearch,
        });
        Object.assign(item, linked.item);
        draft.status = draftStatusFromItems(draft);
        let issue = firstUnresolvedVisualIssue(draft);
        if (linked.searchStatus === 'not_found') {
          return serializeIngestResult(draft, issue, ctx.rawUserMessage, {
            productLinkStatus: 'not_found',
            searchedQuery: productQuery,
          });
        }
        if (linked.searchStatus === 'awaiting_selection') {
          return serializeIngestResult(draft, issue, ctx.rawUserMessage, {
            productLinkStatus: 'awaiting_selection',
          });
        }
        if (linked.searchStatus === 'resolved') {
          if (!issue && draft.kind === 'purchase') {
            console.info('[purchase:draft:all-items-resolved]', JSON.stringify({ draftId: draft.id }));
            issue = await resolveVisualDraftBlockingIssue(draft, ctx.tenant.businessId, undefined, deps);
          }
          return serializeIngestResult(draft, issue, ctx.rawUserMessage, {
            productLinkStatus: 'resolved',
            linkedProductName: linked.matchedName,
            linkedItemIndex: item.index,
          });
        }
        return serializeIngestResult(draft, issue, ctx.rawUserMessage);
      }
    }
  }

  if (args.deliveryDate != null) draft.deliveryDate = asTrimmed(args.deliveryDate) || undefined;
  if (args.notes != null && itemIndex == null) draft.notes = asTrimmed(args.notes) || undefined;
  if (args.deposit != null) draft.deposit = asOptionalNumber(args.deposit);
  if (args.invoiceNumber != null) draft.invoiceNumber = asTrimmed(args.invoiceNumber) || undefined;
  if (args.date != null) draft.date = asTrimmed(args.date) || undefined;
  if (args.total != null) draft.total = asOptionalNumber(args.total);

  const clientQuery = asTrimmed(args.clientQuery);
  if (clientQuery) {
    draft.clientHint = clientQuery;
    const party = await resolveParty(ctx.tenant.businessId, 'order', clientQuery, deps);
    draft.clientMatchStatus = party.status;
    draft.clientId = party.id;
    draft.clientName = party.name || clientQuery;
  }
  const supplierQuery = asTrimmed(args.supplierQuery);
  if (supplierQuery) {
    draft.supplierHint = supplierQuery;
    const party = await resolveParty(ctx.tenant.businessId, 'purchase', supplierQuery, deps);
    draft.supplierMatchStatus = party.status;
    draft.supplierId = party.id;
    draft.supplierName = party.name || supplierQuery;
    if (party.status === 'resolved' && party.id) {
      const rematched = await rematchUnresolvedDraftItems(
        ctx.tenant.businessId,
        draft,
        ctx.rawUserMessage,
        deps
      );
      Object.assign(draft, rematched);
      draft.items = rematched.items;
    }
  }

  draft.status = draftStatusFromItems(draft);
  let issue = firstUnresolvedVisualIssue(draft);
  if (!issue && draft.kind === 'purchase') {
    console.info('[purchase:draft:all-items-resolved]', JSON.stringify({ draftId: draft.id }));
    issue = await resolveVisualDraftBlockingIssue(draft, ctx.tenant.businessId, undefined, deps);
  }
  return serializeIngestResult(draft, issue, ctx.rawUserMessage);
}

export function rewindPurchasePaymentDraft(
  draft: VisualDocumentDraft,
  from: 'payment' | 'payment_card' | 'payment_installments' | 'cash_account'
): void {
  const clearMedio = () => {
    draft.paymentMedioId = undefined;
    draft.paymentMedioLabel = undefined;
  };
  const clearCard = () => {
    draft.paymentTarjetaId = undefined;
    draft.paymentTarjetaLabel = undefined;
  };
  const clearInstallments = () => {
    draft.paymentCuotas = undefined;
    draft.paymentDueDate = undefined;
  };
  const clearCash = () => {
    draft.cashAccountId = undefined;
    draft.cashAccountLabel = undefined;
  };

  if (from === 'payment') {
    clearMedio();
    clearCard();
    clearInstallments();
    clearCash();
    draft.itemsReviewAcknowledged = false;
    draft.workflowPhase = 'reviewing_items';
    return;
  }

  draft.workflowPhase = 'resolving_payment';
  if (from === 'payment_card') {
    clearCard();
    clearInstallments();
    clearCash();
    clearMedio();
    return;
  }
  if (from === 'payment_installments') {
    clearInstallments();
    clearCard();
    return;
  }
  if (from === 'cash_account') {
    clearCash();
    clearMedio();
    clearCard();
    clearInstallments();
  }
}

export async function presentNextPurchaseDraftPaymentStep(input: {
  draft: VisualDocumentDraft;
  tenant: WhatsappTenantContext;
  state: ConversationState | null;
  text: string;
  deps?: VisualDraftDeps;
  leadMessage?: string;
}): Promise<{ reply: string; statePatch: Partial<ConversationState>; intent: string }> {
  let issue = firstUnresolvedVisualIssue(input.draft);
  if (!issue) {
    issue = await resolveVisualDraftBlockingIssue(
      input.draft,
      input.tenant.businessId,
      undefined,
      input.deps
    );
  }
  if (issue) {
    const body = presentVisualDraftIssueReply(input.draft, issue);
    return {
      reply: input.leadMessage ? `${input.leadMessage}\n\n${body}` : body,
      statePatch: {
        ...buildVisualDraftIssueStatePatch(input.draft, issue, input.text),
        visualDraft: input.draft,
      },
      intent: 'v4_purchase_payment_step',
    };
  }
  if (isVisualDraftReadyToWrite(input.draft)) {
    const { freezeVisualDraftConfirmation } = await import('./v4-visual-draft-confirmation.ts');
    const frozen = await freezeVisualDraftConfirmation({
      draft: input.draft,
      tenant: input.tenant,
      state: input.state,
      rawUserMessage: input.text,
    });
    if (frozen) {
      return {
        reply: frozen.reply,
        statePatch: frozen.statePatch,
        intent: 'confirm_v4',
      };
    }
  }
  return {
    reply: presentVisualDraft(input.draft),
    statePatch: { visualDraft: input.draft, activeTask: null },
    intent: 'v4_purchase_payment_step',
  };
}

export function applyVisualDraftSelection(input: {
  draft: VisualDocumentDraft;
  option: CandidateSelectionOption;
  resume: CandidateSelectionResume;
}): VisualDocumentDraft {
  const draft: VisualDocumentDraft = {
    ...input.draft,
    items: input.draft.items.map((item) => ({ ...item })),
    expiresAt: expiresAtFrom(),
  };
  const party = input.resume.party ?? (input.resume.itemIndex != null ? 'item' : 'item');
  const optionId = String(input.option.entityId ?? '').trim();
  const label = String(input.option.label ?? '').split(' · ')[0]?.trim() || optionId;

  if (optionId === VISUAL_PAYMENT_BACK) {
    if (party === 'payment') rewindPurchasePaymentDraft(draft, 'payment');
    else if (party === 'payment_card') rewindPurchasePaymentDraft(draft, 'payment_card');
    else if (party === 'cash_account') rewindPurchasePaymentDraft(draft, 'cash_account');
    return draft;
  }

  if (party === 'supplier') {
    draft.supplierId = optionId;
    draft.supplierName = label;
    draft.supplierMatchStatus = 'resolved';
  } else if (party === 'payment') {
    draft.paymentMedioId = optionId;
    draft.paymentMedioLabel = label;
    draft.paymentTarjetaId = undefined;
    draft.paymentTarjetaLabel = undefined;
    draft.paymentCuotas = undefined;
    draft.paymentDueDate = undefined;
    draft.cashAccountId = undefined;
    draft.cashAccountLabel = undefined;
    console.info(
      '[purchase:payment:selected]',
      JSON.stringify({ draftId: draft.id, paymentMedioId: optionId, label })
    );
  } else if (party === 'payment_card') {
    draft.paymentTarjetaId = optionId;
    draft.paymentTarjetaLabel = label;
    draft.paymentCuotas = undefined;
    draft.paymentDueDate = undefined;
  } else if (party === 'payment_installments') {
    draft.paymentCuotas = Math.max(1, Number(optionId) || 1);
  } else if (party === 'cash_account') {
    draft.cashAccountId = optionId;
    draft.cashAccountLabel = label;
  } else if (party === 'review') {
    if (optionId === VISUAL_REVIEW_CONTINUE) {
      draft.itemsReviewAcknowledged = true;
      draft.editItemMode = false;
      draft.workflowPhase = 'resolving_payment';
    } else if (optionId === VISUAL_REVIEW_CHANGE) {
      draft.editItemMode = true;
      draft.workflowPhase = 'reviewing_items';
    } else if (optionId === VISUAL_REVIEW_CANCEL) {
      draft.status = 'cancelled';
      draft.workflowPhase = undefined;
    }
  } else if (party === 'purchase_total') {
    if (optionId === VISUAL_TAX_PRICES_INCLUDE_IVA) {
      applyTaxPresentationCorrection(draft, 'gross');
      console.info(
        '[purchase:document:tax-presentation:user]',
        JSON.stringify({ draftId: draft.id, priceTaxMode: 'gross' })
      );
    } else if (optionId === VISUAL_TAX_PRICES_EXCLUDE_IVA) {
      applyTaxPresentationCorrection(draft, 'net');
      console.info(
        '[purchase:document:tax-presentation:user]',
        JSON.stringify({ draftId: draft.id, priceTaxMode: 'net' })
      );
    } else if (optionId === VISUAL_CANDIDATE_CANCEL) {
      draft.status = 'cancelled';
      draft.workflowPhase = undefined;
    }
  } else if (party === 'edit_item') {
    if (optionId === VISUAL_EDIT_ITEM_BACK) {
      draft.editItemMode = false;
    } else {
      const itemIndex = Number(optionId);
      const item = draft.items.find((row) => row.index === itemIndex);
      if (item) {
        Object.assign(item, resetItemForEdit(item));
        draft.editItemMode = false;
        console.info(
          '[purchase:item:edit-rematch]',
          JSON.stringify({ draftId: draft.id, itemIndex: item.index })
        );
      }
    }
  } else if (party === 'client') {
    if (optionId === VISUAL_NOT_FOUND_CREATE) {
      draft.clientMatchStatus = 'not_found';
    } else if (optionId === VISUAL_NOT_FOUND_DISCARD) {
      draft.clientHint = undefined;
      draft.clientMatchStatus = 'unresolved';
    } else {
      draft.clientId = optionId;
      draft.clientName = label;
      draft.clientMatchStatus = 'resolved';
    }
  } else {
    const item = draft.items.find((row) => row.index === input.resume.itemIndex);
    if (item) {
      if (optionId === VISUAL_NOT_FOUND_DISCARD) {
        item.matchStatus = 'discarded';
        item.selectionSource = 'discarded';
        item.unresolvedAction = 'discard';
        item.matchedProductId = undefined;
        item.candidates = undefined;
        console.info(
          '[purchase:item:discarded]',
          JSON.stringify({ draftId: draft.id, itemIndex: item.index, description: item.description })
        );
        propagateVisualItemDecision(draft, item.index);
      } else if (optionId === VISUAL_NOT_FOUND_FREE) {
        item.unresolvedAction = 'free_line';
        item.matchStatus = 'resolved';
        item.selectionSource = 'created';
        item.matchedProductId = undefined;
        item.candidates = undefined;
        console.info(
          '[purchase:item:non-stock]',
          JSON.stringify({ draftId: draft.id, itemIndex: item.index, description: item.description })
        );
        propagateVisualItemDecision(draft, item.index);
      } else if (optionId === VISUAL_NOT_FOUND_CREATE) {
        item.unresolvedAction = 'create';
        item.matchStatus = 'not_found';
      } else if (optionId === VISUAL_CANDIDATE_CANCEL) {
        draft.status = 'cancelled';
        draft.workflowPhase = undefined;
      } else if (optionId === VISUAL_MORE_OPTIONS) {
        const pool = item.candidatePool?.length ? item.candidatePool : item.candidates ?? [];
        const nextOffset = Math.max(0, Number(item.candidateOffset) || 0) + WA_CHOICE_PAGE_SIZE;
        const page = pageChoicePool(pool, nextOffset, WA_CHOICE_PAGE_SIZE);
        if (page.shown.length) {
          item.candidatePool = pool;
          item.candidateOffset = nextOffset;
          item.candidates = page.shown;
          item.matchStatus = 'ambiguous';
        }
      } else if (optionId === VISUAL_CANDIDATE_BACK) {
        const pool = item.candidatePool?.length ? item.candidatePool : item.candidates ?? [];
        const prevOffset = Math.max(0, (Number(item.candidateOffset) || 0) - WA_CHOICE_PAGE_SIZE);
        const page = pageChoicePool(pool, prevOffset, WA_CHOICE_PAGE_SIZE);
        item.candidatePool = pool;
        item.candidateOffset = prevOffset;
        item.candidates = page.shown.length ? page.shown : pool.slice(0, WA_CHOICE_PAGE_SIZE);
        item.matchStatus = 'ambiguous';
      } else if (optionId === VISUAL_MANUAL_MATCH_BACK) {
        item.matchStatus = 'not_found';
        item.manualLinkPending = false;
        item.matchedProductId = undefined;
        item.matchedProductName = undefined;
        item.selectionSource = undefined;
        item.candidates = undefined;
        item.candidatePool = undefined;
        item.candidateOffset = undefined;
        item.unresolvedAction = null;
      } else if (optionId === VISUAL_NOT_FOUND_LINK) {
        item.matchStatus = 'not_found';
      } else {
        item.matchStatus = 'resolved';
        item.matchedProductId = optionId;
        item.matchedProductName = label;
        item.selectionSource = 'user_selected';
        item.manualLinkPending = false;
        item.matchConfidence = 1;
        item.candidates = undefined;
        item.candidatePool = undefined;
        item.candidateOffset = undefined;
        item.unresolvedAction = null;
        if (draft.supplierId) {
          item.proposedSupplierMapping = {
            supplierId: draft.supplierId,
            externalDescription: externalDescriptionForMapping(item),
            productId: optionId,
            productName: label,
          };
        }
        propagateVisualItemDecision(draft, item.index);
      }
    }
  }

  draft.status = draftStatusFromItems(draft);
  return draft;
}

function activePurchaseLines(draft: VisualDocumentDraft) {
  return draft.items
    .filter((item) => item.matchStatus !== 'discarded' && item.unresolvedAction !== 'discard')
    .map((item) => {
      const nonStock = item.unresolvedAction === 'free_line';
      console.info(
        '[purchase:item:classification]',
        JSON.stringify({
          draftId: draft.id,
          itemIndex: item.index,
          kind: nonStock ? 'non_stock' : 'stock',
        })
      );
      return {
        productName: item.matchedProductName || item.description,
        invoiceName: item.sourceText,
        productId: item.matchedProductId,
        quantity: Math.max(1, Number(item.quantity) || 1),
        unitCost: finalUnitCostForVisualItem(item),
        unitCostNet: Math.max(0, Number(item.unitCostNet) || 0) || undefined,
        tipoLinea: nonStock ? ('insumo' as const) : ('stock' as const),
        taxRate: item.taxRate ?? draft.documentTaxRate,
        priceTaxMode: item.priceTaxMode ?? draft.priceTaxMode,
        grossUnitCost: item.grossUnitCost,
      };
    });
}

function activeOrderItems(draft: VisualDocumentDraft) {
  return draft.items
    .filter((item) => item.matchStatus !== 'discarded' && item.unresolvedAction !== 'discard')
    .map((item) => ({
      quantity: Math.max(1, Number(item.quantity) || 1),
      rawText: item.sourceText,
      productHint: item.description,
      productId: item.unresolvedAction === 'free_line' ? undefined : item.matchedProductId,
      productName: item.matchedProductName || item.description,
      spokenProductName: item.sourceText,
      unitPrice: item.unitCost ?? null,
      attributes: item.attributes,
      skipped: false,
      tipoLinea: item.unresolvedAction === 'free_line' ? ('concepto' as const) : undefined,
    }));
}

export function plannedWriteFromVisualDraft(draft: VisualDocumentDraft): AgentPlannedWrite {
  if (!isVisualDraftReadyToWrite(draft)) {
    throw new Error('El borrador todavía tiene ítems sin resolver.');
  }
  if (draft.kind === 'purchase') {
    const lines = activePurchaseLines(draft);
    const financial = computeDraftFinancialTotals(draft);
    const supplierName = asTrimmed(draft.supplierName || draft.supplierHint) || 'Proveedor';
    console.info(
      '[purchase:payment:plan]',
      JSON.stringify({
        draftId: draft.id,
        paymentMedioId: draft.paymentMedioId,
        grossTotal: financial.grossTotal,
      })
    );
    return {
      tool: 'create_purchase',
      label: `Compra · ${supplierName}`,
      args: {
        supplierId: draft.supplierId,
        supplierQuery: supplierName,
        supplierName,
        amount: financial.grossTotal,
        documentNetTotal: financial.netTotal,
        documentTaxTotal: financial.taxTotal,
        documentGrossTotal: financial.grossTotal,
        priceTaxMode: draft.priceTaxMode,
        documentTaxRate: draft.documentTaxRate,
        invoiceNumber: draft.invoiceNumber,
        date: draft.date,
        notes: draft.notes,
        purchaseLines: lines,
        visualDraftId: draft.id,
        paymentMedioId: draft.paymentMedioId,
        paymentMedioLabel: draft.paymentMedioLabel,
        paymentTarjetaId: draft.paymentTarjetaId,
        paymentTarjetaLabel: draft.paymentTarjetaLabel,
        paymentCuotas: draft.paymentCuotas,
        paymentDueDate: draft.paymentDueDate,
        cashAccountId: draft.cashAccountId,
        cashAccountLabel: draft.cashAccountLabel,
      },
    };
  }
  const items = activeOrderItems(draft);
  const clientName = asTrimmed(draft.clientName || draft.clientHint);
    return {
      tool: 'create_order',
      label: `Pedido para ${clientName}`,
      args: {
      clientId: draft.clientId,
      clientName,
      notes: draft.notes,
      deliveryDate: draft.deliveryDate,
      seniaAmount: draft.deposit,
      items,
      visualDraftId: draft.id,
    },
  };
}

export function aliasesFromVisualDraft(draft: VisualDocumentDraft): Array<{
  spoken: string;
  resolvedName: string;
  productId?: string;
  source?: 'confirmed_manual_match' | 'confirmed_auto_match';
}> {
  if (draft.kind !== 'purchase' || !asTrimmed(draft.supplierId)) return [];
  const out: Array<{
    spoken: string;
    resolvedName: string;
    productId?: string;
    source?: 'confirmed_manual_match' | 'confirmed_auto_match';
  }> = [];
  const seen = new Set<string>();

  const pushAlias = (
    spoken: string,
    resolvedName: string,
    productId: string,
    source: 'confirmed_manual_match' | 'confirmed_auto_match'
  ) => {
    const key = `${normalizeExternalDescription(spoken)}::${productId}`;
    if (!spoken || spoken.length < 2 || seen.has(key)) return;
    seen.add(key);
    out.push({ spoken, resolvedName, productId, source });
  };

  for (const item of draft.items) {
    if (item.selectionSource === 'discarded' || item.matchStatus === 'discarded') continue;
    if (!item.matchedProductId || !item.matchedProductName) continue;

    const selection = item.selectionSource;
    if (
      selection !== 'user_selected' &&
      selection !== 'auto' &&
      selection !== 'supplier_mapping' &&
      selection !== 'created'
    ) {
      continue;
    }

    const source: 'confirmed_manual_match' | 'confirmed_auto_match' =
      selection === 'user_selected' || item.proposedSupplierMapping?.productId
        ? 'confirmed_manual_match'
        : 'confirmed_auto_match';

    if (item.proposedSupplierMapping?.productId) {
      pushAlias(
        item.proposedSupplierMapping.externalDescription,
        item.proposedSupplierMapping.productName,
        item.proposedSupplierMapping.productId,
        'confirmed_manual_match'
      );
    }

    const description = externalDescriptionForMapping(item);
    if (description) {
      pushAlias(description, item.matchedProductName, item.matchedProductId, source);
    }
    const sourceText = mappingExternalDescription(asTrimmed(item.sourceText));
    if (sourceText && sourceText !== description) {
      pushAlias(sourceText, item.matchedProductName, item.matchedProductId, source);
    }
  }
  return out;
}

export function buildVisualDraftIssueStatePatch(
  draft: VisualDocumentDraft,
  issue: VisualDraftIssue,
  originalUserText: string
): Partial<ConversationState> {
  return candidateStateForIssue(draft, issue, originalUserText);
}

export function visualDraftPlanSummary(draft: VisualDocumentDraft): { title: string; lines: string[] } {
  const presented =
    draft.kind === 'purchase' ? presentVisualPurchaseFinalReview(draft) : presentVisualDraft(draft);
  const parts = presented.split('\n').map((row) => row.trim()).filter(Boolean);
  const title = (parts.shift() ?? '').replace(/\*/g, '');
  const lines = parts.filter(
    (row) =>
      row !== V4_CONFIRMATION_PROMPT &&
      row !== '¿Confirmo? Sí / No' &&
      row !== '¿Confirmo? *Sí* / *No*' &&
      row !== '1. ✅ Confirmar compra' &&
      row !== '0. ❌ Cancelar' &&
      row !== V4_CANDIDATE_SELECTION_PROMPT
  );
  return {
    title: title || (draft.kind === 'order' ? 'Pedido' : 'Compra'),
    lines: [...lines, '1. ✅ Confirmar compra', '0. ❌ Cancelar'],
  };
}

export function visualDraftConfirmationPatch(
  plan: AgentOperationPlan,
  draft: VisualDocumentDraft
): Partial<ConversationState> {
  return {
    visualDraft: { ...draft, status: 'awaiting_confirmation' },
    pendingIntent: V4_CONFIRM_INTENT,
    pendingPayload: { plan },
    pendingPrompt: plan.summary.title,
    operationPlan: plan as unknown as Record<string, unknown>,
    activeTask: {
      intent: 'confirm_v4',
      awaiting: { field: 'confirmation', type: 'confirm' },
    },
  };
}

export function isPurchasePaymentFreeformBackTurn(
  text: string,
  state: ConversationState | null | undefined
): boolean {
  if (String(text ?? '').trim() !== '0') return false;
  const task = state?.activeTask?.awaiting as { type?: string } | undefined;
  return task?.type === 'purchase_payment_installments';
}

export async function tryResolvePurchaseInstallmentsTurn(input: {
  text: string;
  state: ConversationState | null;
  tenant: WhatsappTenantContext;
  deps?: VisualDraftDeps;
}): Promise<{ reply: string; statePatch: Partial<ConversationState>; intent: string } | null> {
  const task = input.state?.activeTask?.awaiting as Record<string, unknown> | undefined;
  if (task?.type !== 'purchase_payment_installments') return null;

  const trimmed = String(input.text ?? '').trim();
  if (trimmed === '0') {
    const draft = liveVisualDraft(input.state);
    if (!draft) return null;
    rewindPurchasePaymentDraft(draft, 'payment_installments');
    return presentNextPurchaseDraftPaymentStep({
      draft,
      tenant: input.tenant,
      state: input.state,
      text: input.text,
      deps: input.deps,
    });
  }

  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const cuotas = Number(trimmed);
  if (!Number.isInteger(cuotas) || cuotas < 1 || cuotas > 120) {
    return {
      reply: 'Escribí un número de cuotas entre 1 y 120, o 0 para volver.',
      statePatch: {},
      intent: 'v4_purchase_installments_invalid',
    };
  }

  const draft = liveVisualDraft(input.state);
  if (!draft) return null;
  draft.paymentCuotas = cuotas;

  return presentNextPurchaseDraftPaymentStep({
    draft,
    tenant: input.tenant,
    state: input.state,
    text: input.text,
    deps: input.deps,
  });
}

export async function tryResolvePurchaseCardDueDayTurn(input: {
  text: string;
  state: ConversationState | null;
  tenant: WhatsappTenantContext;
  deps?: VisualDraftDeps;
}): Promise<{ reply: string; statePatch: Partial<ConversationState>; intent: string } | null> {
  const task = input.state?.activeTask?.awaiting as Record<string, unknown> | undefined;
  if (task?.type !== 'purchase_card_due_day') return null;
  const day = Number(String(input.text ?? '').trim());
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  const draft = liveVisualDraft(input.state);
  if (!draft) return null;
  const cardId = String(task.cardId ?? draft.paymentTarjetaId ?? '').trim();
  if (!cardId) return null;

  await updateTarjetaConfig(input.tenant.businessId, cardId, { diaVencimiento: day });
  const finanzas = await loadFinanzasConfig(input.tenant.businessId);
  const card = findTarjetaInConfig(finanzas.tarjetas, cardId);
  if (card) {
    applyCardScheduleToDraft(draft, { ...card, diaVencimiento: day });
  }

  let issue = firstUnresolvedVisualIssue(draft);
  if (!issue) {
    issue = await resolveVisualDraftBlockingIssue(draft, input.tenant.businessId, undefined, input.deps);
  }

  if (issue) {
    const reply =
      formatWhatsappMessage({
        title: 'Tarjeta configurada',
        lines: [`• Día de pago: ${day}`],
      }) + `\n\n${presentVisualDraftIssueReply(draft, issue)}`;
    return {
      reply,
      statePatch: {
        ...buildVisualDraftIssueStatePatch(draft, issue, input.text),
        visualDraft: draft,
      },
      intent: 'v4_purchase_card_configured',
    };
  }

  return presentNextPurchaseDraftPaymentStep({
    draft,
    tenant: input.tenant,
    state: input.state,
    text: input.text,
    deps: input.deps,
  });
}
