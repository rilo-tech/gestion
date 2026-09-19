import { db } from '../../../firebase.ts';
import { computeClientBalanceForIds } from '../../../utils/client-balance.ts';
import { listClientPendingReceivables } from '../../../utils/client-pending-receivables.ts';
import { resolveOrderLabel } from '../../../utils/order-number.ts';
import { getOrderEstadoLabel, normalizeOrderPedidosConfig } from '../../../utils/order-config.ts';
import { getCashBalance, getCashMonthlyIncomeSummary, getCashMovements, getCashWalletSummaryForPeriod } from '../../../domain/cash/index.ts';
import { findClient, getClient, listClients } from '../../../domain/client/index.ts';
import { findProduct, getProduct, getProductStock, listProducts, previewProductRename } from '../../../domain/stock/index.ts';
import { findSupplier, getSupplier, listSuppliers } from '../../../domain/supplier/index.ts';
import {
  findCollaborator,
  getCollaboratorEntity,
  listCollaboratorEntities,
  getCollaboratorBalance,
  getCollaboratorHoursSummary,
  getCollaboratorAccountSummary,
  listCollaboratorMovementRows,
} from '../../../domain/collaborator/index.ts';
import {
  assertCollaboratorReadAccess,
  logCollaboratorTool,
} from '../../collaborator-access.ts';
import { collaboratorDateRange, resolveCollaboratorIdFromArgs } from '../../collaborator-tool-helpers.ts';
import {
  countOrdersForQuery,
  findOrdersPage,
  type OrderListPageQuery,
} from '../../erp-queries.ts';
import {
  resolveFindOrderHintsForBusiness,
  type FindOrderLookupResult,
  type OrderLookupRecord,
} from '../../resolve-order-reference.ts';
import { resolveCashAccount, type CashAccountRef } from '../../resolve-cash-account.ts';
import { resolveOrderTargetFromContext, resolveCollaboratorTargetFromContext } from '../../v4-conversation-context.ts';
import {
  getFreshRecentOperation,
  resolveRecentRecordIdByIndex,
  recoverRecentOperationFromState,
} from '../../v4-recent-operation.ts';
import { applyLanguageMemory } from '../../language-memory.ts';
import type { OrderOperationContext } from '../../v4-order-operation.ts';
import {
  operationContextRequiresOrderClientResolution,
} from '../../v4-order-operation.ts';
import { resolveListPolicy, resolveQueryDateRange, presentListFooter } from '../../query-policy.ts';
import type { ToolDefinition, ToolExecutionContext } from '../tool-types.ts';
import {
  nBoolean,
  nInteger,
  nNumber,
  nString,
  nArray,
  reqString,
  strictObject,
} from '../strict-tool-schema.ts';
import { ingestVisualDocument, patchVisualDraft } from '../../v4-visual-draft.ts';
import { manageWorkflowAction } from '../../v4-workflow-manager.ts';
import { beginV4BotGuide } from '../../v4-onboarding.ts';
import {
  AUTOMATION_READ_HANDLERS,
  AUTOMATION_READ_TOOLS,
} from './automation-tools.ts';

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

type CashAccountFilterBlocked = {
  status: 'filter_blocked';
  errorCode: 'ENTITY_NOT_FOUND' | 'ENTITY_AMBIGUOUS';
  entityType: 'cash_account';
  message: string;
  title?: string;
  candidates?: Array<{ id: string; name: string; label: string }>;
  filter: { cashAccountHint?: string; ambitoId?: string };
};

function cashAccountCandidates(
  rows: CashAccountRef[]
): Array<{ id: string; name: string; label: string }> {
  return rows.map((row) => ({ id: row.id, name: row.name, label: row.name }));
}

/**
 * Resuelve caja para reads. Filtro no resuelto → filter_blocked (nunca query global).
 */
async function resolveCashAccountForRead(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  options: { requireAccount: boolean }
): Promise<
  | { status: 'resolved'; account: CashAccountRef }
  | { status: 'unscoped' }
  | CashAccountFilterBlocked
> {
  const cashAccountHint = String(args.cashAccountHint ?? '').trim() || undefined;
  const ambitoIdArg =
    String(args.ambitoId ?? args.cashAccountId ?? '').trim() || undefined;
  const explicit = Boolean(cashAccountHint || ambitoIdArg);
  const contextCashId = ctx.state?.focusEntities?.cash?.id;

  if (!options.requireAccount && !explicit && !contextCashId) {
    return { status: 'unscoped' };
  }

  const resolution = await resolveCashAccount({
    businessId: ctx.tenant.businessId,
    hint: cashAccountHint,
    resolvedId: ambitoIdArg,
    explicit,
    contextId: !explicit ? contextCashId : undefined,
  });

  if (resolution.status === 'resolved') {
    return { status: 'resolved', account: resolution.account };
  }

  const filter = { cashAccountHint, ambitoId: ambitoIdArg };
  if (resolution.status === 'not_found') {
    return {
      status: 'filter_blocked',
      errorCode: 'ENTITY_NOT_FOUND',
      entityType: 'cash_account',
      message: `No encontré una caja llamada "${resolution.hint}".`,
      filter,
    };
  }

  const candidates = cashAccountCandidates(resolution.candidates);
  return {
    status: 'filter_blocked',
    errorCode: 'ENTITY_AMBIGUOUS',
    entityType: 'cash_account',
    message: '¿De qué caja?',
    title: '¿De qué caja?',
    candidates,
    filter,
  };
}

async function pedidosEstadoLabel(businessId: string, estado?: string): Promise<string> {
  const snap = await db.doc(`negocios/${businessId}/config/app`).get();
  const raw = snap.data()?.pedidos;
  const config = normalizeOrderPedidosConfig(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});
  return getOrderEstadoLabel(estado, config.estados);
}

function itemNames(items: unknown): string {
  if (!Array.isArray(items) || !items.length) return '';
  return items
    .slice(0, 20)
    .map((row) => {
      const data = row as {
        nombre?: string;
        productName?: string;
        name?: string;
        descripcion?: string;
        cantidad?: number;
        quantity?: number;
      };
      const name = String(
        data.nombre ?? data.productName ?? data.name ?? data.descripcion ?? ''
      ).trim();
      const qty = Number(data.cantidad ?? data.quantity) || 0;
      if (!name) return '';
      return qty > 1 ? `${qty} × ${name}` : name;
    })
    .filter(Boolean)
    .join(', ');
}

function mapOrderItems(items: unknown): Array<{ name: string; quantity?: number }> {
  if (!Array.isArray(items) || !items.length) return [];
  const out: Array<{ name: string; quantity?: number }> = [];
  for (const row of items) {
    if (!row || typeof row !== 'object') continue;
    const data = row as Record<string, unknown>;
    const name = String(
      data.nombre ?? data.productName ?? data.name ?? data.descripcion ?? data.label ?? ''
    ).trim();
    if (!name) continue;
    const quantity = Number(data.cantidad ?? data.quantity) || undefined;
    out.push({ name, quantity: quantity && quantity > 0 ? quantity : undefined });
  }
  return out;
}

function mapOrderRow(
  businessId: string,
  id: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const notes = String(data.descripcion ?? '').trim();
  const mappedItems = mapOrderItems(data.items);
  return pedidosEstadoLabel(businessId, String(data.estado ?? '')).then((statusLabel) => ({
    id,
    number: resolveOrderLabel({
      numeroPedido: Number(data.numeroPedido) || undefined,
      numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
    }),
    clientId: String(data.clienteId ?? ''),
    clientName: String(data.clienteNombre ?? '').trim(),
    status: String(data.estado ?? ''),
    statusLabel,
    total: Number(data.total) || 0,
    balance: Math.max(0, Number(data.saldo) || 0),
    deliveryDate: String(data.fechaEntrega ?? '').slice(0, 10) || undefined,
    createdAt: String(data.createdAt ?? '').slice(0, 10) || undefined,
    items: mappedItems,
    products: itemNames(data.items) || undefined,
    notes: notes && !/^origen:\s*whatsapp/i.test(notes) ? notes.slice(0, 160) : undefined,
  }));
}

async function mapLookupRecord(
  businessId: string,
  row: OrderLookupRecord
): Promise<Record<string, unknown>> {
  return mapOrderRow(businessId, row.id, row.data);
}

async function presentFindOrderResult(
  businessId: string,
  result: FindOrderLookupResult
): Promise<Record<string, unknown>> {
  const classified = result.classified;
  const base: Record<string, unknown> = {
    status: result.status,
    classified: classified.kind,
    entityType: result.entityType,
    errorCode: result.errorCode,
    message: result.message,
    title: result.title,
    operationOutcome: result.operationOutcome,
    filter: result.filter,
    clientId: result.clientId,
    clientName: result.clientName,
  };
  if (classified.kind === 'order_reference') {
    base.orderReferenceRaw = classified.raw;
    base.orderReferenceNormalized = classified.ref.label;
    base.erpFields = ['numeroPedidoLabel', 'numeroPedido'];
  }
  if (result.entity) {
    base.entity = await mapLookupRecord(businessId, result.entity);
  }
  if (Array.isArray(result.candidates) && result.candidates.length) {
    if (result.entityType === 'client') {
      base.candidates = result.candidates;
    } else {
      base.candidates = await Promise.all(
        (result.candidates as OrderLookupRecord[]).map((row) => mapLookupRecord(businessId, row))
      );
    }
  }
  if (result.status === 'not_found' && classified.kind === 'order_reference') {
    base.message =
      result.message ?? `No encontré el pedido #${classified.ref.label}.`;
  }
  return base;
}

async function resolveOrderByHint(
  businessId: string,
  input: {
    orderId?: string;
    orderNumber?: string;
    query?: string;
    clientQuery?: string;
    clientId?: string;
    operationContext?: OrderOperationContext;
  },
  utterance?: string
): Promise<Record<string, unknown>> {
  const result = await resolveFindOrderHintsForBusiness(businessId, input, utterance);
  return presentFindOrderResult(businessId, result);
}

function listPolicyFromArgs(args: Record<string, unknown>, stateOffset?: number) {
  return resolveListPolicy({
    metric: String(args.metric ?? 'list'),
    limit: args.limit != null ? Number(args.limit) : undefined,
    requestAll: args.requestAll === true,
    page: String(args.page ?? ''),
    offset: args.offset != null ? Number(args.offset) : stateOffset,
    sortDirection: String(args.sort ?? 'recent_desc').includes('asc') ? 'asc' : 'desc',
  });
}

function dateRangeFromArgs(args: Record<string, unknown>, today: string) {
  const token = String(args.dateRange ?? args.month ?? args.date ?? '').trim();
  return resolveQueryDateRange(token, today);
}

export const READ_TOOLS: ToolDefinition[] = [
  {
    name: 'find_client',
    description:
      'Busca un cliente por nombre. Para cambiar estado o cobrar un pedido de un cliente, preferí find_order con clientQuery en el mismo turno que las write tools.',
    mode: 'read',
    capability: 'query_client',
    parameters: strictObject({ query: reqString() }),
  },
  {
    name: 'get_client',
    description: 'Obtiene un cliente por id real del ERP.',
    mode: 'read',
    capability: 'query_client',
    parameters: strictObject({ clientId: reqString() }),
  },
  {
    name: 'list_clients',
    description: 'Lista clientes con paginación opcional.',
    mode: 'read',
    capability: 'query_client',
    parameters: strictObject({
      query: nString(),
      limit: nInteger(),
      offset: nInteger(),
    }),
  },
  {
    name: 'find_product',
    description: 'Busca un producto del catálogo por hint.',
    mode: 'read',
    capability: 'query_product',
    parameters: strictObject({ query: reqString() }),
  },
  {
    name: 'get_product',
    description: 'Obtiene un producto por id real del ERP.',
    mode: 'read',
    capability: 'query_product',
    parameters: strictObject({ productId: reqString() }),
  },
  {
    name: 'list_products',
    description:
      'Lista productos del catálogo. Con productIds o fromRecentOperation=true relee exactamente esos IDs en orden (valores actuales), sin búsqueda nueva.',
    mode: 'read',
    capability: 'query_product',
    parameters: strictObject({
      query: nString(),
      productIds: nArray({ type: 'string' }),
      fromRecentOperation: nBoolean(),
      limit: nInteger(),
      offset: nInteger(),
    }),
  },
  {
    name: 'list_recent_operation_records',
    description:
      'Relee por ID los registros de recentOperation (orden preservado, valores actuales en BD). Usá ante referencias al conjunto recién operado/listado («cómo quedaron», «listamelos», «el tercero», «esos»). No busca de cero en el ERP.',
    mode: 'read',
    /** Capability neutra: no mapea a un módulo; siempre disponible si hay sesión. */
    capability: 'recent_operation',
    parameters: strictObject({
      recordIndex: nInteger(),
      recentRecordIndex: nInteger(),
    }),
  },
  {
    name: 'preview_rename_product',
    description:
      'Audita rename de producto/familia (nombreBase + color/talle). Devuelve preview e IDs. Si scope=auto y hay varias variantes, pide alcance. No escribe.',
    mode: 'read',
    capability: 'query_product',
    parameters: strictObject({
      productId: nString(),
      productIds: nArray({ type: 'string' }),
      productQuery: nString(),
      newBaseName: reqString(),
      scope: nString(),
      colors: nArray({ type: 'string' }),
      sizes: nArray({ type: 'string' }),
      excludeProductIds: nArray({ type: 'string' }),
    }),
  },
  {
    name: 'get_stock',
    description: 'Consulta stock actual de un producto por id.',
    mode: 'read',
    capability: 'query_stock',
    parameters: strictObject({ productId: reqString() }),
  },
  {
    name: 'find_order',
    description: 'Busca un pedido por número visible, id ERP o cliente.',
    mode: 'read',
    capability: 'query_order',
    parameters: strictObject({
      query: nString(),
      orderNumber: nString(),
      orderId: nString(),
      clientQuery: nString(),
      clientId: nString(),
      targetReference: nString(),
    }),
  },
  {
    name: 'get_order',
    description: 'Obtiene un pedido por id real del ERP.',
    mode: 'read',
    capability: 'query_order',
    parameters: strictObject({ orderId: reqString() }),
  },
  {
    name: 'list_orders',
    description: 'Lista pedidos. Si el usuario pidió pedidos de un cliente, clientId es obligatorio.',
    mode: 'read',
    capability: 'query_orders',
    parameters: strictObject({
      clientId: nString(),
      clientQuery: nString(),
      status: nString(),
      limit: nInteger(),
      offset: nInteger(),
      page: nString(),
      sort: nString(),
      metric: nString(),
      requestAll: nBoolean(),
      dateRange: nString(),
      month: nString(),
    }),
  },
  {
    name: 'get_order_balance',
    description: 'Saldo pendiente de un pedido por id.',
    mode: 'read',
    capability: 'query_order_balance',
    parameters: strictObject({ orderId: reqString() }),
  },
  {
    name: 'get_client_balance',
    description:
      'Saldo total pendiente de un cliente por id, con detalle de comprobantes con saldo (ventas/pedidos) e ítems. Usar para “cuánto debe”.',
    mode: 'read',
    capability: 'query_client_balance',
    parameters: strictObject({ clientId: reqString() }),
  },
  {
    name: 'get_cash_balance',
    description:
      'Saldo actual de caja. Si el usuario nombró una caja, pasá cashAccountHint. Sin caja y varias cuentas: overview de todas.',
    mode: 'read',
    capability: 'query_cash',
    parameters: strictObject({
      ambitoId: nString(),
      cashAccountHint: nString(),
    }),
  },
  {
    name: 'list_cash_movements',
    description:
      'Lista movimientos recientes de una caja. Pasá cashAccountHint con el nombre que dijo el usuario. Si hay varias cajas y no se puede resolver, el backend pide cuál.',
    mode: 'read',
    capability: 'query_cash',
    parameters: strictObject({
      limit: nInteger(),
      ambitoId: nString(),
      cashAccountHint: nString(),
    }),
  },
  {
    name: 'get_cash_income_summary',
    description:
      'Promedio e ingresos mensuales de caja (plata que entró). Usar para “cuánto facturo por mes”, “promedio de ingresos”, “ingresos de los últimos meses”. NO listar pedidos. Opcional cashAccountHint (ej. Rilo). months default 6.',
    mode: 'read',
    capability: 'query_cash',
    parameters: strictObject({
      months: nInteger(),
      ambitoId: nString(),
      cashAccountHint: nString(),
    }),
  },
  {
    name: 'get_cash_wallet_summary',
    description:
      'Resumen tipo billetera: ingresos, egresos y balance agrupados por categoría. Usar para “¿en qué gasté más?”, “resumen de agosto”, “cuánto gasté esta semana”, “ingresos del mes”. period: today|week|month|previous_month|custom (con from/to YYYY-MM-DD). Sin IA: calcula desde movimientos.',
    mode: 'read',
    capability: 'query_cash',
    parameters: strictObject({
      period: nString(),
      from: nString(),
      to: nString(),
      ambitoId: nString(),
      cashAccountHint: nString(),
    }),
  },
  {
    name: 'find_supplier',
    description: 'Busca un proveedor por nombre.',
    mode: 'read',
    capability: 'query_supplier',
    parameters: strictObject({ query: reqString() }),
  },
  {
    name: 'get_supplier',
    description: 'Obtiene un proveedor por id.',
    mode: 'read',
    capability: 'query_supplier',
    parameters: strictObject({ supplierId: reqString() }),
  },
  {
    name: 'list_suppliers',
    description: 'Lista proveedores.',
    mode: 'read',
    capability: 'query_supplier',
    parameters: strictObject({
      query: nString(),
      limit: nInteger(),
      offset: nInteger(),
    }),
  },
  {
    name: 'find_collaborator',
    description: 'Busca un colaborador del ERP por nombre o hint.',
    mode: 'read',
    capability: 'query_collaborators',
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    parameters: strictObject({
      query: reqString(),
      targetReference: nString(),
    }),
  },
  {
    name: 'get_collaborator',
    description: 'Obtiene un colaborador por id real del ERP.',
    mode: 'read',
    capability: 'query_collaborators',
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    parameters: strictObject({
      collaboratorId: nString(),
      targetReference: nString(),
    }),
  },
  {
    name: 'list_collaborators',
    description: 'Lista colaboradores del ERP con filtros estructurados.',
    mode: 'read',
    capability: 'query_collaborators',
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    parameters: strictObject({
      query: nString(),
      active: nBoolean(),
      modalidad: nString(),
      limit: nInteger(),
      offset: nInteger(),
    }),
  },
  {
    name: 'list_collaborator_hours',
    description: 'Lista registros de horas de un colaborador en un período.',
    mode: 'read',
    capability: 'query_collaborator_hours',
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    parameters: strictObject({
      collaboratorId: nString(),
      query: nString(),
      targetReference: nString(),
      dateRange: nString(),
      from: nString(),
      to: nString(),
      limit: nInteger(),
    }),
  },
  {
    name: 'get_collaborator_hours_summary',
    description: 'Resumen de horas trabajadas de un colaborador en un período.',
    mode: 'read',
    capability: 'query_collaborator_hours',
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    parameters: strictObject({
      collaboratorId: nString(),
      query: nString(),
      targetReference: nString(),
      dateRange: nString(),
      from: nString(),
      to: nString(),
    }),
  },
  {
    name: 'get_collaborator_balance',
    description: 'Saldo acumulado de un colaborador (mismo cálculo ERP).',
    mode: 'read',
    capability: 'query_collaborator_balance',
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    parameters: strictObject({
      collaboratorId: nString(),
      query: nString(),
      targetReference: nString(),
      dateRange: nString(),
      from: nString(),
      to: nString(),
    }),
  },
  {
    name: 'list_collaborator_payments',
    description: 'Lista pagos registrados a un colaborador en un período.',
    mode: 'read',
    capability: 'query_collaborator_account',
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    parameters: strictObject({
      collaboratorId: nString(),
      query: nString(),
      targetReference: nString(),
      dateRange: nString(),
      from: nString(),
      to: nString(),
      limit: nInteger(),
    }),
  },
  {
    name: 'get_collaborator_account_summary',
    description: 'Resumen de cuenta del colaborador: horas, pagos, saldo y movimientos recientes.',
    mode: 'read',
    capability: 'query_collaborator_account',
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    parameters: strictObject({
      collaboratorId: nString(),
      query: nString(),
      targetReference: nString(),
      dateRange: nString(),
      from: nString(),
      to: nString(),
      movementLimit: nInteger(),
    }),
  },
  {
    name: 'list_sales',
    description: 'Lista ventas recientes.',
    mode: 'read',
    capability: 'query_sales',
    requiresDomainAdapter: true,
    parameters: strictObject({
      limit: nInteger(),
      offset: nInteger(),
    }),
  },
  {
    name: 'query_payables',
    description:
      'Consulta cuentas a pagar reales: hoy, esta semana, atrasados o un mes (YYYY-MM). Nunca inventes montos.',
    mode: 'read',
    capability: 'query_payables',
    requiresDomainAdapter: true,
    parameters: strictObject({
      scope: reqString(),
      month: nString(),
    }),
  },
  {
    name: 'aggregate_sales',
    description: 'Suma ventas por rango.',
    mode: 'read',
    capability: 'aggregate_sales',
    requiresDomainAdapter: true,
    parameters: strictObject({ dateRange: nString() }),
  },
  {
    name: 'list_purchases',
    description: 'Lista compras recientes.',
    mode: 'read',
    capability: 'query_purchases',
    requiresDomainAdapter: true,
    parameters: strictObject({
      limit: nInteger(),
      offset: nInteger(),
    }),
  },
  {
    name: 'get_supplier_balance',
    description: 'Saldo/deuda de proveedor.',
    mode: 'read',
    capability: 'query_supplier_balance',
    requiresDomainAdapter: true,
    parameters: strictObject({ supplierId: reqString() }),
  },
  {
    name: 'ingest_visual_document',
    description:
      'Guarda un borrador temporal de compra o pedido extraído de una imagen. Resuelve productos/cliente/proveedor contra el ERP. No persiste la operación ni mueve stock.',
    mode: 'read',
    capability: 'query_product',
    parameters: strictObject({
      kind: reqString(),
      append: nBoolean(),
      replace: nBoolean(),
      readability: nString(),
      notes: nString(),
      supplierHint: nString(),
      date: nString(),
      invoiceNumber: nString(),
      total: nNumber(),
      documentNetTotal: nNumber(),
      documentTaxTotal: nNumber(),
      documentGrossTotal: nNumber(),
      documentTaxRate: nNumber(),
      priceTaxMode: nString(),
      taxPresentation: nString(),
      articleCount: nNumber(),
      taxBreakdown: nArray(
        strictObject({
          rate: nNumber(),
          taxableBase: nNumber(),
          taxAmount: nNumber(),
          label: nString(),
        })
      ),
      interpretationAttempt: nInteger(),
      paymentStatus: nString(),
      clientHint: nString(),
      deliveryDate: nString(),
      deposit: nNumber(),
      items: nArray(
        strictObject({
          description: reqString(),
          sourceText: nString(),
          quantity: nNumber(),
          unitCost: nNumber(),
          unitCostNet: nNumber(),
          taxRate: nNumber(),
          priceTaxMode: nString(),
          displayedPriceBasis: nString(),
          displayedUnitPrice: nNumber(),
          displayedLineTotal: nNumber(),
          lineType: nString(),
          financialLineType: nString(),
          subtotal: nNumber(),
          type: nString(),
          fabric: nString(),
          model: nString(),
          color: nString(),
          size: nString(),
          variant: nString(),
          notes: nString(),
          confidence: nNumber(),
        })
      ),
    }),
  },
  {
    name: 'patch_visual_draft',
    description:
      'Corrige o descarta ítems del borrador visual activo. No recrea el documento ni escribe en el ERP.',
    mode: 'read',
    capability: 'query_product',
    parameters: strictObject({
      itemIndex: nInteger(),
      discard: nBoolean(),
      quantity: nNumber(),
      unitCost: nNumber(),
      description: nString(),
      size: nString(),
      color: nString(),
      type: nString(),
      variant: nString(),
      notes: nString(),
      productQuery: nString(),
      unresolvedAction: nString(),
      conversationAction: nString(),
      reviewAction: nString(),
      editItemIndex: nInteger(),
      taxPresentation: nString(),
      priceTaxMode: nString(),
      paymentMedioId: nString(),
      paymentMedioQuery: nString(),
      paymentTarjetaId: nString(),
      paymentTarjetaQuery: nString(),
      paymentCuotas: nInteger(),
      clientQuery: nString(),
      supplierQuery: nString(),
      deliveryDate: nString(),
      deposit: nNumber(),
      date: nString(),
      invoiceNumber: nString(),
      total: nNumber(),
    }),
  },
  {
    name: 'manage_workflow',
    description:
      'Gestiona workflows interactivos pendientes: cancelar, retomar o listar operaciones suspendidas. No escribe en el ERP.',
    mode: 'read',
    capability: 'query_product',
    parameters: strictObject({
      action: reqString(),
      workflowId: nString(),
    }),
  },
  {
    name: 'show_bot_guide',
    description:
      'Muestra la guía interactiva de RILO Bot (menú por categorías). Usar cuando el usuario pide ayuda, tutorial o "mostrame la guía".',
    mode: 'read',
    capability: 'show_guide',
    parameters: strictObject({}),
  },
  ...AUTOMATION_READ_TOOLS,
];

function resolveLookupQuery(raw: string, ctx: ToolExecutionContext): string {
  const query = String(raw ?? '').trim();
  if (!query || !ctx.languageMemory?.aliases?.length) return query;
  return applyLanguageMemory(query, ctx.languageMemory).trim() || query;
}

export const READ_TOOL_HANDLERS: Record<string, (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<Record<string, unknown>>> = {
  async find_client(args, ctx) {
    const operationContext = args.operationContext as OrderOperationContext | undefined;
    const query = resolveLookupQuery(String(args.query ?? ''), ctx);
    if (operationContextRequiresOrderClientResolution(operationContext)) {
      return resolveOrderByHint(
        ctx.tenant.businessId,
        { clientQuery: query, operationContext },
        ctx.rawUserMessage
      );
    }
    return findClient(ctx.tenant.businessId, query, {
      utterance: ctx.rawUserMessage,
    });
  },
  async get_client(args, ctx) {
    const entity = await getClient(ctx.tenant.businessId, String(args.clientId ?? ''));
    return entity ? { status: 'resolved', entity } : { status: 'not_found' };
  },
  async list_clients(args, ctx) {
    const result = await listClients(ctx.tenant.businessId, {
      query: String(args.query ?? ''),
      limit: args.limit != null ? Number(args.limit) : undefined,
      offset: args.offset != null ? Number(args.offset) : undefined,
    });
    return result;
  },
  async find_product(args, ctx) {
    const query = resolveLookupQuery(String(args.query ?? ''), ctx);
    return findProduct(ctx.tenant.businessId, query, { utterance: ctx.rawUserMessage });
  },
  async get_product(args, ctx) {
    const entity = await getProduct(ctx.tenant.businessId, String(args.productId ?? ''));
    return entity ? { status: 'resolved', entity } : { status: 'not_found' };
  },
  async list_products(args, ctx) {
    const fromRecent = args.fromRecentOperation === true;
    let productIds = Array.isArray(args.productIds)
      ? args.productIds.map((id) => String(id ?? '').trim()).filter(Boolean)
      : [];
    if (!productIds.length && fromRecent) {
      const recent = recoverRecentOperationFromState(ctx.state) ?? getFreshRecentOperation(ctx.state);
      if (recent && (recent.entityKind === 'product' || recent.entityKind === 'stock')) {
        productIds = recent.recordIds;
      }
    }
    if (productIds.length) {
      const items = [];
      for (const id of productIds) {
        const row = await getProduct(ctx.tenant.businessId, id);
        if (row) items.push(row);
      }
      return {
        status: items.length ? 'resolved' : 'not_found',
        source: 'ids',
        items,
        total: items.length,
        hasMore: false,
        query: String(args.query ?? ''),
        message: items.length
          ? items.map((row, index) => `${index + 1}. ${row.name}`).join('\n')
          : 'No encontré esos productos.',
      };
    }
    const listed = await listProducts(ctx.tenant.businessId, {
      query: String(args.query ?? ''),
      limit: args.limit != null ? Number(args.limit) : undefined,
      offset: args.offset != null ? Number(args.offset) : undefined,
    });
    const items = Array.isArray((listed as { items?: unknown[] }).items)
      ? ((listed as { items: unknown[] }).items as unknown[])
      : [];
    if (!items.length && String(args.query ?? '').trim()) {
      return {
        ...listed,
        status: 'not_found',
        query: String(args.query ?? '').trim(),
        items: [],
        total: 0,
      };
    }
    return listed;
  },
  async list_recent_operation_records(args, ctx) {
    const recent = recoverRecentOperationFromState(ctx.state) ?? getFreshRecentOperation(ctx.state);
    if (!recent) {
      return {
        status: 'not_found',
        errorCode: 'ENTITY_NOT_FOUND',
        message: 'No hay una operación reciente para listar. Decime qué registros querés ver.',
      };
    }
    const index =
      args.recordIndex != null
        ? Number(args.recordIndex)
        : args.recentRecordIndex != null
          ? Number(args.recentRecordIndex)
          : null;
    const ids =
      index != null && Number.isFinite(index)
        ? (() => {
            const id = resolveRecentRecordIdByIndex(recent, index);
            return id ? [id] : [];
          })()
        : recent.recordIds;
    if (!ids.length) {
      return {
        status: 'not_found',
        errorCode: 'ENTITY_NOT_FOUND',
        message: `No hay un registro #${index} en la operación reciente (${recent.recordIds.length} en total).`,
        recentOperation: {
          entityKind: recent.entityKind,
          action: recent.action,
          count: recent.recordIds.length,
        },
      };
    }

    if (recent.entityKind === 'product' || recent.entityKind === 'stock') {
      const items = [];
      for (const id of ids) {
        const row = await getProduct(ctx.tenant.businessId, id);
        if (row) items.push(row);
      }
      return {
        status: 'resolved',
        entityKind: recent.entityKind,
        action: recent.action,
        source: 'recent_operation',
        items,
        total: items.length,
        recordIds: ids,
        message: items.length
          ? items.map((row, i) => `${i + 1}. ${row.name}`).join('\n')
          : 'No encontré esos productos.',
      };
    }

    if (recent.entityKind === 'client') {
      const items = [];
      for (const id of ids) {
        const row = await getClient(ctx.tenant.businessId, id);
        if (row) items.push(row);
      }
      return {
        status: 'resolved',
        entityKind: 'client',
        action: recent.action,
        source: 'recent_operation',
        items,
        total: items.length,
        recordIds: ids,
        message: items.length
          ? items.map((row, i) => `${i + 1}. ${(row as { name?: string }).name ?? id}`).join('\n')
          : 'No encontré esos clientes.',
      };
    }

    if (recent.entityKind === 'order') {
      const items = [];
      for (const id of ids) {
        const snap = await db.doc(`negocios/${ctx.tenant.businessId}/pedidos/${id}`).get();
        if (!snap.exists) continue;
        const data = snap.data() as Record<string, unknown>;
        const number = resolveOrderLabel({
          numeroPedido: Number(data.numeroPedido) || undefined,
          numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
        });
        items.push({
          id: snap.id,
          number,
          clientName: String(data.clienteNombre ?? '').trim(),
          status: String(data.estado ?? '').trim(),
        });
      }
      return {
        status: 'resolved',
        entityKind: 'order',
        action: recent.action,
        source: 'recent_operation',
        items,
        total: items.length,
        recordIds: ids,
        message: items.length
          ? items
              .map(
                (row, i) =>
                  `${i + 1}. #${row.number}${row.clientName ? ` · ${row.clientName}` : ''}${row.status ? ` · ${row.status}` : ''}`
              )
              .join('\n')
          : 'No encontré esos pedidos.',
      };
    }

    if (recent.entityKind === 'supplier') {
      const items = [];
      for (const id of ids) {
        const row = await getSupplier(ctx.tenant.businessId, id);
        if (row) items.push(row);
      }
      return {
        status: 'resolved',
        entityKind: 'supplier',
        action: recent.action,
        source: 'recent_operation',
        items,
        total: items.length,
        recordIds: ids,
        message: items.length
          ? items.map((row, i) => `${i + 1}. ${(row as { name?: string }).name ?? id}`).join('\n')
          : 'No encontré esos proveedores.',
      };
    }

    if (recent.entityKind === 'collaborator') {
      const items = [];
      for (const id of ids) {
        const row = await getCollaboratorEntity(ctx.tenant.businessId, id);
        if (row) items.push(row);
      }
      return {
        status: 'resolved',
        entityKind: 'collaborator',
        action: recent.action,
        source: 'recent_operation',
        items,
        total: items.length,
        recordIds: ids,
        message: items.length
          ? items.map((row, i) => `${i + 1}. ${(row as { name?: string }).name ?? id}`).join('\n')
          : 'No encontré esos colaboradores.',
      };
    }

    return {
      status: 'resolved',
      entityKind: recent.entityKind,
      action: recent.action,
      source: 'recent_operation',
      recordIds: ids,
      labels: recent.labels,
      message:
        (recent.labels?.length ? recent.labels : ids)
          .map((label, i) => `${i + 1}. ${label}`)
          .join('\n') || `Hay ${ids.length} registro(s) en la operación reciente.`,
    };
  },
  async preview_rename_product(args, ctx) {
    const newBaseName = String(args.newBaseName ?? '').trim();
    const productIds = Array.isArray(args.productIds)
      ? args.productIds.map((id) => String(id ?? '').trim()).filter(Boolean)
      : [];
    let productId = String(args.productId ?? '').trim() || undefined;
    const productQuery = String(args.productQuery ?? '').trim();
    let baseNameHint: string | undefined;
    if (!productId && !productIds.length && productQuery) {
      const found = await findProduct(ctx.tenant.businessId, productQuery, {
        utterance: ctx.rawUserMessage,
        preferChoices: true,
      });
      if (found.status === 'resolved' && found.entity?.id) {
        productId = found.entity.id;
      } else if (found.status === 'ambiguous' && found.candidates?.length) {
        return {
          status: 'ambiguous',
          errorCode: 'ENTITY_AMBIGUOUS',
          entityType: 'product',
          message: 'Encontré varios productos. Elegí cuál renombrar.',
          candidates: found.candidates,
          newBaseName,
        };
      } else {
        baseNameHint = productQuery;
      }
    }
    const scopeRaw = String(args.scope ?? 'auto').trim().toLowerCase();
    const scope =
      scopeRaw === 'single' || scopeRaw === 'matching_variants' ? scopeRaw : 'auto';
    const preview = await previewProductRename({
      businessId: ctx.tenant.businessId,
      productId,
      productIds,
      baseNameHint,
      newBaseName,
      scope,
      constraints: {
        colors: Array.isArray(args.colors)
          ? args.colors.map((row) => String(row ?? '').trim()).filter(Boolean)
          : undefined,
        sizes: Array.isArray(args.sizes)
          ? args.sizes.map((row) => String(row ?? '').trim()).filter(Boolean)
          : undefined,
        excludeIds: Array.isArray(args.excludeProductIds)
          ? args.excludeProductIds.map((row) => String(row ?? '').trim()).filter(Boolean)
          : undefined,
      },
    });
    if (preview.status === 'needs_scope') {
      return {
        ...preview,
        message:
          preview.message ||
          'Hay varias variantes. ¿Querés cambiar solo este producto o todas las variantes?',
        scopeOptions: [
          { id: 'single', name: 'Solo este producto' },
          { id: 'matching_variants', name: 'Todas las variantes' },
        ],
      };
    }
    if (preview.status === 'ready' && preview.selectedIds.length && newBaseName) {
      return {
        ...preview,
        /** Señal genérica: el Agent loop congela OperationPlan aunque el LLM no emita write. */
        freezeWrite: {
          tool: 'rename_products',
          args: {
            productIds: preview.selectedIds,
            newBaseName,
            mode: preview.scope === 'matching_variants' ? 'base_name' : 'base_name',
            oldBaseName: preview.oldBaseName,
          },
        },
      };
    }
    return preview;
  },
  async get_stock(args, ctx) {
    const row = await getProductStock(ctx.tenant.businessId, String(args.productId ?? ''));
    return row ? { status: 'resolved', ...row } : { status: 'not_found' };
  },
  async find_order(args, ctx) {
    const targetReference = String(args.targetReference ?? '').trim();
    const orderId = String(args.orderId ?? '').trim();
    const orderNumber = String(args.orderNumber ?? '').trim();
    const query = String(args.query ?? '').trim();
    if (targetReference && !orderId && !orderNumber && !query) {
      const resolved = await resolveOrderTargetFromContext(ctx, { targetReference });
      return resolveOrderByHint(
        ctx.tenant.businessId,
        { orderId: resolved.orderId },
        ctx.rawUserMessage
      );
    }
    return resolveOrderByHint(
      ctx.tenant.businessId,
      {
        orderId,
        orderNumber,
        query,
        clientQuery: String(args.clientQuery ?? ''),
        clientId: String(args.clientId ?? ''),
        operationContext: args.operationContext as OrderOperationContext | undefined,
      },
      ctx.rawUserMessage
    );
  },
  async get_order(args, ctx) {
    return resolveOrderByHint(
      ctx.tenant.businessId,
      { orderId: String(args.orderId ?? '') },
      ctx.rawUserMessage
    );
  },
  async list_orders(args, ctx) {
    const businessId = ctx.tenant.businessId;
    const today = new Date().toISOString().slice(0, 10);
    const clientQuery = String(args.clientQuery ?? '').trim();
    let clientId = String(args.clientId ?? '').trim();
    let clientName = '';

    if (clientQuery && !clientId) {
      const operationContext = args.operationContext as OrderOperationContext | undefined;
      if (operationContextRequiresOrderClientResolution(operationContext)) {
        return resolveOrderByHint(
          businessId,
          { clientQuery, operationContext },
          ctx.rawUserMessage
        );
      }
      const resolved = await findClient(businessId, clientQuery, { utterance: ctx.rawUserMessage });
      console.info(
        '[whatsapp:resolver:client]',
        JSON.stringify({
          query: clientQuery,
          status: resolved.status,
          selected: resolved.entity ? { id: resolved.entity.id, name: resolved.entity.name } : null,
          candidates: (resolved.candidates ?? []).slice(0, 8).map((row) => ({
            id: row.id,
            name: row.name,
            score: row.score,
          })),
        })
      );
      if (resolved.status === 'not_found') {
        return {
          status: 'filter_blocked',
          errorCode: 'ENTITY_NOT_FOUND',
          message: `No encontré un cliente llamado ${clientQuery}.`,
          filter: { clientQuery },
        };
      }
      if (resolved.status === 'ambiguous') {
        return {
          status: 'filter_blocked',
          errorCode: 'ENTITY_AMBIGUOUS',
          message: `Encontré más de un cliente parecido a ${clientQuery}.`,
          candidates: resolved.candidates,
          filter: { clientQuery },
        };
      }
      clientId = resolved.entity!.id;
      clientName = resolved.entity!.name;
    }

    const policy = listPolicyFromArgs(args, ctx.state?.listContext?.offset);
    const range = dateRangeFromArgs(args, today);
    const pageQuery: OrderListPageQuery = {
      businessId,
      clientId: clientId || undefined,
      status: String(args.status ?? '').trim() || undefined,
      dateFrom: range?.from,
      dateTo: range?.to,
      sortDir: policy.sortDirection,
      limit: policy.limit,
      offset: policy.offset,
    };

    if (policy.mode === 'count') {
      const total = (await countOrdersForQuery(pageQuery)) ?? 0;
      return {
        mode: 'count',
        total,
        filter: { clientId: clientId || undefined, clientName: clientName || undefined, status: pageQuery.status },
      };
    }

    const page = await findOrdersPage(pageQuery);
    const total = clientId ? (await countOrdersForQuery(pageQuery)) ?? page.items.length : undefined;
    const items = await Promise.all(
      page.items.map((row) => mapOrderRow(businessId, row.id, row.data))
    );
    return {
      items,
      total: total ?? items.length,
      hasMore: page.hasMore,
      nextOffset: page.hasMore ? policy.offset + policy.limit : undefined,
      filter: { clientId: clientId || undefined, clientName: clientName || undefined, status: pageQuery.status },
      footer: presentListFooter({
        shown: items.length,
        total: total ?? items.length,
        hasMore: page.hasMore,
        requestAll: policy.requestAll,
      }),
    };
  },
  async get_order_balance(args, ctx) {
    const orderId = String(args.orderId ?? '').trim();
    const snap = await db.doc(`negocios/${ctx.tenant.businessId}/pedidos/${orderId}`).get();
    if (!snap.exists) return { status: 'not_found' };
    const data = snap.data() as Record<string, unknown>;
    return {
      status: 'resolved',
      orderId,
      number: resolveOrderLabel({
        numeroPedido: Number(data.numeroPedido) || undefined,
        numeroPedidoLabel: String(data.numeroPedidoLabel ?? ''),
      }),
      balance: Math.max(0, Number(data.saldo) || 0),
      total: Number(data.total) || 0,
      clientName: String(data.clienteNombre ?? '').trim(),
    };
  },
  async get_client_balance(args, ctx) {
    const clientId = String(args.clientId ?? '').trim();
    const [balances, pending, client] = await Promise.all([
      computeClientBalanceForIds(ctx.tenant.businessId, [clientId]),
      listClientPendingReceivables(ctx.tenant.businessId, clientId),
      getClient(ctx.tenant.businessId, clientId),
    ]);
    const balance = balances.get(clientId) ?? 0;
    return {
      status: 'resolved',
      clientId,
      clientName: client?.name,
      balance,
      formattedBalance: money(balance),
      pending,
      pendingCount: pending.length,
    };
  },
  async get_cash_balance(args, ctx) {
    const resolved = await resolveCashAccountForRead(args, ctx, { requireAccount: false });
    if (resolved.status === 'filter_blocked') return resolved;
    const ambitoId =
      resolved.status === 'resolved' ? resolved.account.id : undefined;
    const balance = await getCashBalance(ctx.tenant.businessId, { ambitoId });
    return {
      status: 'resolved',
      saldo: balance.saldo,
      scope: balance.scope,
      byAmbito: balance.byAmbito,
      empty: balance.empty === true,
      cashAccountId: resolved.status === 'resolved' ? resolved.account.id : undefined,
      cashAccountName: resolved.status === 'resolved' ? resolved.account.name : undefined,
    };
  },
  async list_cash_movements(args, ctx) {
    const resolved = await resolveCashAccountForRead(args, ctx, { requireAccount: true });
    if (resolved.status !== 'resolved') return resolved;

    const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
    const listed = await getCashMovements(ctx.tenant.businessId, {
      limit,
      ambitoId: resolved.account.id,
    });
    const items = Array.isArray(listed) ? listed : listed.items;
    return {
      status: 'resolved',
      items: items.map((row) => ({
        id: row.id,
        type: row.tipo,
        amount: row.monto,
        concept: row.concepto,
        date: row.fecha,
        ambito: row.ambito,
      })),
      hasMore: false,
      nextCursor: null,
      cashAccountId: resolved.account.id,
      cashAccountName: resolved.account.name,
      filter: {
        cashAccountId: resolved.account.id,
        cashAccountName: resolved.account.name,
        limit,
      },
    };
  },
  async get_cash_income_summary(args, ctx) {
    const resolved = await resolveCashAccountForRead(args, ctx, { requireAccount: false });
    if (resolved.status === 'filter_blocked') return resolved;
    const months = Math.min(24, Math.max(1, Number(args.months) || 6));
    const ambitoId = resolved.status === 'resolved' ? resolved.account.id : undefined;
    const summary = await getCashMonthlyIncomeSummary(ctx.tenant.businessId, {
      months,
      ambitoId,
    });
    return {
      status: 'resolved',
      ...summary,
      cashAccountId: summary.cashAccountId ?? (resolved.status === 'resolved' ? resolved.account.id : undefined),
      cashAccountName:
        summary.cashAccountName ?? (resolved.status === 'resolved' ? resolved.account.name : undefined),
      formatted: {
        totalIngresos: money(summary.totalIngresos),
        promedioMensualIngresos: money(summary.promedioMensualIngresos),
      },
    };
  },
  async get_cash_wallet_summary(args, ctx) {
    const resolved = await resolveCashAccountForRead(args, ctx, { requireAccount: false });
    if (resolved.status === 'filter_blocked') return resolved;
    const raw = String(args.period ?? 'month').trim().toLowerCase();
    const period = (
      ['today', 'week', 'month', 'previous_month', 'custom'].includes(raw) ? raw : 'month'
    ) as 'today' | 'week' | 'month' | 'previous_month' | 'custom';
    const ambitoId = resolved.status === 'resolved' ? resolved.account.id : undefined;
    const summary = await getCashWalletSummaryForPeriod(ctx.tenant.businessId, period, {
      from: String(args.from ?? '').trim() || undefined,
      to: String(args.to ?? '').trim() || undefined,
      ambitoId,
    });
    return {
      status: 'resolved',
      ...summary,
      cashAccountId: resolved.status === 'resolved' ? resolved.account.id : undefined,
      cashAccountName: resolved.status === 'resolved' ? resolved.account.name : undefined,
    };
  },
  async find_supplier(args, ctx) {
    const query = resolveLookupQuery(String(args.query ?? ''), ctx);
    return findSupplier(ctx.tenant.businessId, query);
  },
  async get_supplier(args, ctx) {
    const entity = await getSupplier(ctx.tenant.businessId, String(args.supplierId ?? ''));
    return entity ? { status: 'resolved', entity } : { status: 'not_found' };
  },
  async list_suppliers(args, ctx) {
    return listSuppliers(ctx.tenant.businessId, {
      query: String(args.query ?? ''),
      limit: args.limit != null ? Number(args.limit) : undefined,
      offset: args.offset != null ? Number(args.offset) : undefined,
    });
  },
  async find_collaborator(args, ctx) {
    const gate = await assertCollaboratorReadAccess(ctx);
    logCollaboratorTool('find_collaborator', ctx.tenant.businessId, { query: args.query });
    const targetReference = String(args.targetReference ?? '').trim();
    const query = String(args.query ?? '').trim();
    if (targetReference && !query) {
      const resolved = await resolveCollaboratorTargetFromContext(ctx, { targetReference });
      const entity = await getCollaboratorEntity(ctx.tenant.businessId, resolved.colaboradorId, {
        scope: gate.scope,
      });
      return entity
        ? { status: 'resolved', entity, entityType: 'collaborator' }
        : { status: 'not_found', entityType: 'collaborator' };
    }
    return findCollaborator(ctx.tenant.businessId, query, { scope: gate.scope });
  },
  async get_collaborator(args, ctx) {
    const gate = await assertCollaboratorReadAccess(ctx);
    logCollaboratorTool('get_collaborator', ctx.tenant.businessId);
    let collaboratorId = String(args.collaboratorId ?? '').trim();
    const targetReference = String(args.targetReference ?? '').trim();
    if (!collaboratorId && targetReference) {
      const resolved = await resolveCollaboratorTargetFromContext(ctx, { targetReference });
      collaboratorId = resolved.colaboradorId;
    }
    const entity = await getCollaboratorEntity(ctx.tenant.businessId, collaboratorId, {
      scope: gate.scope,
    });
    return entity ? { status: 'resolved', entity, entityType: 'collaborator' } : { status: 'not_found', entityType: 'collaborator' };
  },
  async list_collaborators(args, ctx) {
    const gate = await assertCollaboratorReadAccess(ctx);
    logCollaboratorTool('list_collaborators', ctx.tenant.businessId, {
      active: args.active,
      query: args.query,
    });
    const policy = listPolicyFromArgs(args, ctx.state?.listContext?.offset);
    const modalidadRaw = String(args.modalidad ?? '').trim();
    const modalidad =
      modalidadRaw === 'fijo' || modalidadRaw === 'mixto' || modalidadRaw === 'por_hora'
        ? modalidadRaw
        : null;
    const active =
      args.active === true ? true : args.active === false ? false : (args.active == null ? true : null);
    const result = await listCollaboratorEntities(ctx.tenant.businessId, {
      query: String(args.query ?? ''),
      active,
      modalidad,
      limit: policy.limit,
      offset: policy.offset,
      scope: gate.scope,
    });
    const activeCount =
      active === false
        ? result.total
        : result.items.filter((row) => row.activo !== false).length;
    return {
      ...result,
      activeCount,
      footer: presentListFooter({
        shown: result.items.length,
        total: result.total,
        hasMore: result.hasMore,
        requestAll: policy.requestAll,
      }),
    };
  },
  async list_collaborator_hours(args, ctx) {
    const gate = await assertCollaboratorReadAccess(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const { colaboradorId, name } = await resolveCollaboratorIdFromArgs(ctx, args, gate);
    const range = collaboratorDateRange(args, today);
    logCollaboratorTool('list_collaborator_hours', ctx.tenant.businessId, { colaboradorId, ...range });
    const result = await listCollaboratorMovementRows(ctx.tenant.businessId, {
      colaboradorId,
      tipo: 'horas',
      from: range.from,
      to: range.to,
      scope: gate.scope,
      limit: args.limit != null ? Number(args.limit) : undefined,
    });
    return { status: 'resolved', colaboradorId, name, period: range, ...result };
  },
  async get_collaborator_hours_summary(args, ctx) {
    const gate = await assertCollaboratorReadAccess(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const { colaboradorId } = await resolveCollaboratorIdFromArgs(ctx, args, gate);
    const range = collaboratorDateRange(args, today);
    logCollaboratorTool('get_collaborator_hours_summary', ctx.tenant.businessId, { colaboradorId, ...range });
    const summary = await getCollaboratorHoursSummary(ctx.tenant.businessId, colaboradorId, range.from, range.to, {
      scope: gate.scope,
    });
    return summary ? { status: 'resolved', ...summary } : { status: 'not_found', colaboradorId };
  },
  async get_collaborator_balance(args, ctx) {
    const gate = await assertCollaboratorReadAccess(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const { colaboradorId } = await resolveCollaboratorIdFromArgs(ctx, args, gate);
    const range = collaboratorDateRange(args, today);
    logCollaboratorTool('get_collaborator_balance', ctx.tenant.businessId, { colaboradorId });
    const balance = await getCollaboratorBalance(ctx.tenant.businessId, colaboradorId, {
      from: range.from,
      to: range.to,
      scope: gate.scope,
    });
    return balance ? { status: 'resolved', ...balance } : { status: 'not_found', colaboradorId };
  },
  async list_collaborator_payments(args, ctx) {
    const gate = await assertCollaboratorReadAccess(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const { colaboradorId, name } = await resolveCollaboratorIdFromArgs(ctx, args, gate);
    const range = collaboratorDateRange(args, today);
    logCollaboratorTool('list_collaborator_payments', ctx.tenant.businessId, { colaboradorId, ...range });
    const result = await listCollaboratorMovementRows(ctx.tenant.businessId, {
      colaboradorId,
      tipo: 'pago',
      from: range.from,
      to: range.to,
      scope: gate.scope,
      limit: args.limit != null ? Number(args.limit) : undefined,
    });
    return { status: 'resolved', colaboradorId, name, period: range, ...result };
  },
  async get_collaborator_account_summary(args, ctx) {
    const gate = await assertCollaboratorReadAccess(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const { colaboradorId } = await resolveCollaboratorIdFromArgs(ctx, args, gate);
    const range = collaboratorDateRange(args, today);
    logCollaboratorTool('get_collaborator_account_summary', ctx.tenant.businessId, { colaboradorId, ...range });
    const summary = await getCollaboratorAccountSummary(
      ctx.tenant.businessId,
      colaboradorId,
      range.from,
      range.to,
      {
        scope: gate.scope,
        movementLimit: args.movementLimit != null ? Number(args.movementLimit) : undefined,
      }
    );
    return summary ? { status: 'resolved', ...summary } : { status: 'not_found', colaboradorId };
  },
  async list_sales() {
    return { status: 'requires_domain_adapter', message: 'list_sales aún no está adaptado en V4.' };
  },
  async query_payables(args, ctx) {
    const scopeRaw = String(args.scope ?? 'pending').toLowerCase();
    const scope =
      scopeRaw === 'today' ||
      scopeRaw === 'week' ||
      scopeRaw === 'overdue' ||
      scopeRaw === 'month' ||
      scopeRaw === 'pending'
        ? scopeRaw
        : 'pending';
    const month = String(args.month ?? '').trim().slice(0, 7) || undefined;
    const { queryPayables } = await import('../../../domain/payables/payables-application-service.ts');
    const items = await queryPayables({
      businessId: ctx.tenant.businessId,
      scope,
      month,
    });
    const money = (n: number) =>
      n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const lines = items.slice(0, 20).map((row) => {
      const due = String(row.fechaVencimiento).slice(0, 10);
      const dueLabel = `${due.slice(8, 10)}/${due.slice(5, 7)}`;
      return `• ${row.beneficiario} · $${money(row.monto)} · vence ${dueLabel}${
        row.displayEstado === 'vencida' ? ' (atrasado)' : ''
      }`;
    });
    if (!lines.length) {
      return {
        status: 'resolved',
        empty: true,
        message:
          scope === 'today'
            ? 'No tenés vencimientos para hoy.'
            : scope === 'overdue'
              ? 'No tenés pagos atrasados.'
              : 'No encontré vencimientos en ese período.',
        items: [],
      };
    }
    return {
      status: 'resolved',
      empty: false,
      message: lines.join('\n'),
      items: items.map((row) => ({
        id: row.id,
        beneficiario: row.beneficiario,
        monto: row.monto,
        fechaVencimiento: row.fechaVencimiento,
        displayEstado: row.displayEstado,
      })),
    };
  },
  async aggregate_sales() {
    return { status: 'requires_domain_adapter', message: 'aggregate_sales aún no está adaptado en V4.' };
  },
  async list_purchases() {
    return { status: 'requires_domain_adapter', message: 'list_purchases aún no está adaptado en V4.' };
  },
  async get_supplier_balance() {
    return { status: 'requires_domain_adapter', message: 'get_supplier_balance aún no está adaptado en V4.' };
  },
  async ingest_visual_document(args, ctx) {
    return ingestVisualDocument(args, ctx);
  },
  async patch_visual_draft(args, ctx) {
    return patchVisualDraft(args, ctx);
  },
  async manage_workflow(args, ctx) {
    const result = await manageWorkflowAction(
      String(args.action ?? ''),
      ctx.state ?? null,
      args.workflowId != null ? String(args.workflowId) : undefined
    );
    return {
      status: 'resolved',
      intent: result.intent,
      message: result.reply,
      statePatch: result.patch,
    };
  },
  async show_bot_guide(_args, ctx) {
    const result = await beginV4BotGuide(ctx.tenant);
    if (result.kind !== 'handled') {
      return { status: 'not_available', message: 'Guía no disponible.' };
    }
    return {
      status: 'resolved',
      intent: result.intent,
      message: result.reply,
      statePatch: result.statePatch,
      presentVerbatim: true,
    };
  },
  ...AUTOMATION_READ_HANDLERS,
};
