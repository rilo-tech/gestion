import { assertCanRunWhatsappWrite } from '../../../auth/usage-gates.ts';
import { db } from '../../../firebase.ts';
import { findClient } from '../../../domain/client/index.ts';
import { findProduct, previewProductRename } from '../../../domain/stock/index.ts';
import { findSupplier } from '../../../domain/supplier/index.ts';
import { resolveCashAccount } from '../../resolve-cash-account.ts';
import { AgentError } from '../agent-errors.ts';
import type { AgentOperationPlan, AgentPlannedWrite, ToolDefinition, ToolExecutionContext } from '../tool-types.ts';
import {
  nArray,
  nBoolean,
  nNumber,
  nString,
  reqBoolean,
  reqNumber,
  reqString,
  strictObject,
} from '../strict-tool-schema.ts';
import { isVisualDraftReadyToWrite, liveVisualDraft, plannedWriteFromVisualDraft } from '../../v4-visual-draft.ts';
import {
  resolveOrderTargetFromContext,
  supersedeOperationPlan,
  nextOperationPlanId,
} from '../../v4-conversation-context.ts';
import {
  getFreshRecentOperation,
  resolveRecentRecordIdByIndex,
  recoverRecentOperationFromState,
} from '../../v4-recent-operation.ts';
import {
  previewCollaboratorMovement,
  getCollaboratorBalance,
} from '../../../domain/collaborator/index.ts';
import {
  createPayableObligation,
  resolveRecurringPayableFirstDueDate,
} from '../../../utils/payables.ts';
import { calendarDayAr, resolveDateToken } from '../../semantic-command.ts';
import { loadCajaConfig } from '../../../domain/cash/index.ts';
import { getBusinessCashAmbitoId } from '../../../utils/caja-ambitos.ts';
import { isUnvaluedHoursMovement, getCollaboratorMovement, listHoursMovementsForDate } from '../../../utils/collaborators.ts';
import {
  AUTOMATION_WRITE_HANDLERS,
  AUTOMATION_WRITE_TOOLS,
} from './automation-tools.ts';
import {
  assertCollaboratorWriteAccess,
  assertCollaboratorHoursWriteAccess,
  assertCollaboratorPaymentWriteAccess,
  logCollaboratorTool,
  type WhatsappCollaboratorGate,
} from '../../collaborator-access.ts';
import { resolveCollaboratorExtraTipoLabel } from '../../../../shared/collaborators-config.ts';
import { loadCollaboratorExtraTipos } from '../../../utils/collaborators-config.ts';
import { resolveCollaboratorIdFromArgs } from '../../collaborator-tool-helpers.ts';
import type { CollaboratorModalidad, CollaboratorPeriodoReferencia } from '../../../utils/collaborators.ts';

function money(value: number): string {
  return Number(value || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Normaliza type de register_cash_movement desde args estructurados del LLM
 * (type/tipo/cashType/…). No re-parsea el utterance del usuario.
 */
export function normalizeCashMovementType(
  args: Record<string, unknown>
): 'ingreso' | 'egreso' | null {
  const candidates = [args.type, args.tipo, args.cashType, args.movementType, args.kind]
    .map((value) =>
      String(value ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
    )
    .filter(Boolean);

  for (const value of candidates) {
    if (value === 'ingreso' || value === 'egreso') return value;
    // El modelo a veces manda frases ("ingreso a caja", "egreso/gasto").
    if (/(^|[^a-z])(egreso|gasto|salida|expense|outflow)([^a-z]|$)/.test(value)) {
      return 'egreso';
    }
    if (/(^|[^a-z])(ingreso|entrada|income|inflow)([^a-z]|$)/.test(value)) {
      return 'ingreso';
    }
  }
  return null;
}


function normalizeRequestedOrderStatus(raw: string): string {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (value.includes('entreg')) return 'entregado';
  if (value.includes('pend')) return 'pendiente';
  if (value.includes('produc')) return 'en_produccion';
  if (value.includes('list')) return 'listo';
  return String(raw ?? '').trim();
}

async function resolveOrderId(
  ctx: ToolExecutionContext,
  args: Record<string, unknown>
): Promise<{ orderId: string; label: string; clientName?: string; fromStatus?: string }> {
  const resolved = await resolveOrderTargetFromContext(ctx, {
    orderId: String(args.orderId ?? ''),
    orderNumber: String(args.orderNumber ?? ''),
    query: String(args.query ?? ''),
    clientName: String(args.clientName ?? ''),
    targetReference: String(args.targetReference ?? ''),
  });
  return {
    orderId: resolved.orderId,
    label: resolved.label,
    clientName: resolved.clientName,
    fromStatus: resolved.fromStatus,
  };
}

function baseWriteTool(
  name: string,
  description: string,
  capability: string,
  properties: Record<string, unknown>
): ToolDefinition {
  return {
    name,
    description,
    mode: 'write',
    capability,
    permission: 'write',
    parameters: strictObject(properties),
  };
}

export const WRITE_TOOLS: ToolDefinition[] = [
  baseWriteTool('create_client', 'Alta de cliente.', 'create_client', {
    name: reqString(),
    telefono: nString(),
  }),
  baseWriteTool('update_client', 'Actualiza un cliente existente.', 'update_client', {
    clientId: reqString(),
    name: nString(),
    telefono: nString(),
  }),
  baseWriteTool('create_product', 'Alta de producto en catálogo.', 'create_product', {
    name: reqString(),
    salePrice: nNumber(),
    cost: nNumber(),
    initialStock: nNumber(),
    controlsStock: nBoolean(),
  }),
  baseWriteTool('update_product_price', 'Actualiza precio de venta.', 'update_product_price', {
    productId: nString(),
    query: nString(),
    salePrice: reqNumber(),
  }),
  baseWriteTool('update_product_cost', 'Actualiza costo de producto.', 'update_product_cost', {
    productId: nString(),
    query: nString(),
    cost: reqNumber(),
  }),
  baseWriteTool(
    'rename_products',
    'Renombra productos por IDs (o fromRecentOperation / recentRecordIndex sobre recentOperation de productos). Preserva color/talle/stock/precio.',
    'rename_products',
    {
      productIds: nArray({ type: 'string' }),
      newBaseName: reqString(),
      mode: nString(),
      oldBaseName: nString(),
      recentRecordIndex: nNumber(),
      fromRecentOperation: nBoolean(),
    }
  ),
  baseWriteTool('adjust_stock', 'Ajusta stock (+/-).', 'adjust_stock', {
    productId: nString(),
    query: nString(),
    quantity: reqNumber(),
    reason: nString(),
  }),
  baseWriteTool('set_stock', 'Fija stock absoluto.', 'set_stock', {
    productId: nString(),
    query: nString(),
    stock: reqNumber(),
  }),
  baseWriteTool('register_order_payment', 'Registra cobro parcial de pedido.', 'register_order_payment', {
    orderId: nString(),
    amount: reqNumber(),
    clientName: nString(),
    orderNumber: nString(),
    targetReference: nString(),
  }),
  baseWriteTool('register_order_deposit', 'Registra seña de pedido.', 'register_order_deposit', {
    orderId: nString(),
    amount: reqNumber(),
    clientName: nString(),
    orderNumber: nString(),
    targetReference: nString(),
  }),
  baseWriteTool('collect_order_full_balance', 'Cobra saldo completo del pedido.', 'collect_order_full_balance', {
    orderId: nString(),
    clientName: nString(),
    orderNumber: nString(),
    targetReference: nString(),
  }),
  baseWriteTool('update_order_status', 'Cambia estado del pedido.', 'update_order_status', {
    orderId: nString(),
    status: reqString(),
    clientName: nString(),
    orderNumber: nString(),
    targetReference: nString(),
  }),
  baseWriteTool(
    'register_cash_movement',
    'Registra ingreso o egreso de caja. type OBLIGATORIO: "ingreso" o "egreso" (si el usuario dijo ingreso/egreso/gasto/sacá/meté, completá type; NUNCA lo dejes vacío ni preguntes de nuevo). amount = monto. concept = motivo. cashAccountHint = nombre de caja si lo dijo (ej. personal, rilo).',
    'register_cash',
    {
      type: reqString(),
      amount: reqNumber(),
      concept: nString(),
      cashAccountHint: nString(),
      ambitoId: nString(),
    }
  ),
  {
    ...baseWriteTool(
      'create_recurring_payable',
      'Crea un gasto fijo / recurrente mensual en Cuentas a pagar (UTE, sueldo, seguro, etc.). NO registra egreso de caja ahora: solo agenda el vencimiento cada mes. Usá dueDay (1-31) o firstDueDate (YYYY-MM-DD). Para un gasto único de caja usá register_cash_movement.',
      'create_payable',
      {
        name: reqString(),
        amount: reqNumber(),
        dueDay: nNumber(),
        firstDueDate: nString(),
        notes: nString(),
        cashAccountHint: nString(),
        ambitoId: nString(),
      }
    ),
    requiredModule: 'payables',
  },
  {
    ...baseWriteTool(
      'create_one_time_payable',
      'Crea una obligación de pago ÚNICA (no recurrente). Ej: "Tengo que pagar $12000 a Norte el viernes". NO registra caja al crear. amount, dueDate (YYYY-MM-DD), name/beneficiario opcional.',
      'create_payable',
      {
        name: nString(),
        amount: reqNumber(),
        dueDate: reqString(),
        notes: nString(),
      }
    ),
    requiredModule: 'payables',
  },
  {
    ...baseWriteTool(
      'pay_payable',
      'Marca una cuota/obligación de cuentas a pagar como pagada y registra el egreso de caja. Si hay varias coincidencias, el sistema pedirá cuál. Usá after confirmation.',
      'pay_payable',
      {
        cuotaId: nString(),
        name: nString(),
        amount: nNumber(),
        paymentMethod: nString(),
        confirm: nBoolean(),
      }
    ),
    requiredModule: 'payables',
  },
  baseWriteTool('create_supplier', 'Alta de proveedor.', 'create_supplier', { name: reqString() }),
  baseWriteTool('update_supplier', 'Actualiza un proveedor existente.', 'update_supplier', {
    supplierId: nString(),
    query: nString(),
    name: nString(),
    telefono: nString(),
    email: nString(),
    notas: nString(),
  }),
  {
    ...baseWriteTool('create_collaborator', 'Alta de colaborador en el ERP.', 'create_collaborator', {
      name: reqString(),
      telefono: nString(),
      email: nString(),
      notas: nString(),
      modalidad: nString(),
      valorHora: nNumber(),
      montoFijoPeriodo: nNumber(),
      periodoReferencia: nString(),
    }),
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    requiresTeamManage: true,
  },
  {
    ...baseWriteTool('update_collaborator', 'Actualiza un colaborador existente.', 'update_collaborator', {
      collaboratorId: nString(),
      query: nString(),
      targetReference: nString(),
      name: nString(),
      telefono: nString(),
      email: nString(),
      notas: nString(),
      modalidad: nString(),
      valorHora: nNumber(),
      montoFijoPeriodo: nNumber(),
      periodoReferencia: nString(),
      activo: nBoolean(),
    }),
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    requiresTeamManage: true,
  },
  {
    ...baseWriteTool(
      'register_collaborator_hours',
      'Registra horas trabajadas de un colaborador. date en YYYY-MM-DD (preferido) o DD/MM/YYYY / DD/MM (Argentina). Si no hay tarifa o el usuario pide sin valorar, usar valuationMode=unvalued. Tarifa explícita: valuationMode=explicit_rate y hourlyRate.',
      'register_collaborator_hours',
      {
        collaboratorId: nString(),
        query: nString(),
        targetReference: nString(),
        date: nString(),
        hours: reqNumber(),
        horaDesde: nString(),
        horaHasta: nString(),
        hourlyRate: nNumber(),
        valorHora: nNumber(),
        valuationMode: nString(),
        notes: nString(),
      }
    ),
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    requiresHoursWrite: true,
  },
  {
    ...baseWriteTool(
      'register_collaborator_extra',
      'Registra un extra/devengado a colaborador (movimiento ERP tipo extra). Aumenta el saldo que le debés. Usar cuando piden cargar, agregar o sumar un extra, reparto, premio, envío, etc. NO confundir con register_collaborator_payment.',
      'register_collaborator_extra',
      {
        collaboratorId: nString(),
        query: nString(),
        targetReference: nString(),
        date: nString(),
        amount: reqNumber(),
        extraTipo: nString(),
        concept: nString(),
        notes: nString(),
      }
    ),
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    requiresTeamManage: true,
  },
  {
    ...baseWriteTool(
      'register_collaborator_payment',
      'Registra pago/liquidación cuando ya le pagaste al colaborador. Reduce el saldo. NO usar para extras ni horas — eso es register_collaborator_extra o register_collaborator_hours.',
      'register_collaborator_payment',
      {
        collaboratorId: nString(),
        query: nString(),
        targetReference: nString(),
        date: nString(),
        amount: reqNumber(),
        medioPagoId: nString(),
        notes: nString(),
      }
    ),
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    requiresPaymentWrite: true,
  },
  {
    ...baseWriteTool(
      'update_collaborator_movement',
      'Actualiza un registro de horas de colaborador (valor hora, horas, notas). Resuelve por colaborador + fecha si no hay movementId. hourlyRate=0 es válido (distinto de null/sin valorar).',
      'update_collaborator_movement',
      {
        movementId: nString(),
        collaboratorId: nString(),
        query: nString(),
        targetReference: nString(),
        date: nString(),
        hours: nNumber(),
        hourlyRate: nNumber(),
        amount: nNumber(),
        horaDesde: nString(),
        horaHasta: nString(),
        valorHora: nNumber(),
        valuationMode: nString(),
        notes: nString(),
        activo: nBoolean(),
      }
    ),
    requiredModule: 'collaborators',
    accessPermission: 'collaborators.access',
    requiresHoursWrite: true,
  },
  baseWriteTool('create_order', 'Crea un pedido.', 'create_order', {
    clientQuery: nString(),
    clientId: nString(),
    notes: nString(),
    deliveryDate: nString(),
  }),
  baseWriteTool('create_sale', 'Registra una venta.', 'create_sale', {
    clientId: nString(),
    amount: reqNumber(),
  }),
  baseWriteTool('create_purchase', 'Registra una compra.', 'create_purchase', {
    supplierQuery: nString(),
    amount: nNumber(),
  }),
  baseWriteTool('add_order_extra_cost', 'Agrega costo extra a pedido.', 'add_order_extra_cost', {
    orderId: nString(),
    amount: reqNumber(),
    concept: nString(),
    orderNumber: nString(),
    targetReference: nString(),
  }),
  baseWriteTool(
    'prepare_visual_draft_write',
    'Prepara la confirmación de una compra o pedido desde el borrador visual ya resuelto. No escribe en el ERP hasta que el usuario confirme.',
    'create_visual_document',
    {
      kind: nString(),
    }
  ),
  ...AUTOMATION_WRITE_TOOLS,
];

type WriteHandler = {
  prepare: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<AgentPlannedWrite>;
};

async function ensureWritePermission(ctx: ToolExecutionContext): Promise<void> {
  await assertCanRunWhatsappWrite(ctx.tenant.businessId);
}

async function resolveProductId(
  ctx: ToolExecutionContext,
  args: Record<string, unknown>
): Promise<{ productId: string; name: string }> {
  const direct = String(args.productId ?? '').trim();
  if (direct) {
    const snap = await db.doc(`negocios/${ctx.tenant.businessId}/stock/${direct}`).get();
    if (!snap.exists) throw new Error('No encontré ese producto.');
    return { productId: direct, name: String(snap.data()?.nombre ?? '').trim() };
  }
  const query = String(args.query ?? ctx.state?.focusEntities?.product?.name ?? '').trim();
  if (!query) throw new Error('Indicá el producto.');
  const resolved = await findProduct(ctx.tenant.businessId, query, { utterance: ctx.rawUserMessage });
  if (resolved.status === 'not_found') throw new Error(`No encontré un producto llamado ${query}.`);
  if (resolved.status === 'ambiguous') throw new Error(`Encontré más de un producto parecido a ${query}.`);
  return { productId: resolved.entity!.id, name: resolved.entity!.name };
}

async function resolveClientId(
  ctx: ToolExecutionContext,
  args: Record<string, unknown>
): Promise<{ clientId: string; name: string }> {
  const direct = String(args.clientId ?? '').trim();
  if (direct) return { clientId: direct, name: String(args.name ?? ctx.state?.focusEntities?.client?.name ?? '') };
  const query = String(args.clientQuery ?? args.name ?? ctx.state?.focusEntities?.client?.name ?? '').trim();
  if (!query) throw new Error('Indicá el cliente.');
  const resolved = await findClient(ctx.tenant.businessId, query, { utterance: ctx.rawUserMessage });
  if (resolved.status === 'not_found') throw new Error(`No encontré un cliente llamado ${query}.`);
  if (resolved.status === 'ambiguous') throw new Error(`Encontré más de un cliente parecido a ${query}.`);
  return { clientId: resolved.entity!.id, name: resolved.entity!.name };
}

async function resolveCollaboratorId(
  ctx: ToolExecutionContext,
  args: Record<string, unknown>,
  gate?: WhatsappCollaboratorGate
): Promise<{ colaboradorId: string; name: string }> {
  return resolveCollaboratorIdFromArgs(ctx, args, gate);
}

function formatDayLabel(iso: string): string {
  const raw = String(iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [y, m, d] = raw.split('-');
  return `${d}/${m}/${y}`;
}

/** Fuerza YYYY-MM-DD (AR: DD/MM). Si no se puede normalizar, falla en prepare. */
function requireToolDate(raw: unknown, today: string, label = 'fecha'): string {
  const resolved = resolveDateToken(raw != null ? String(raw) : undefined, today);
  if (!resolved || !/^\d{4}-\d{2}-\d{2}$/.test(resolved)) {
    throw new Error(`Indicá una ${label} válida (ej. 03/09 o 2026-09-03).`);
  }
  return resolved;
}

function movementBodyFromHoursArgs(
  colaboradorId: string,
  args: Record<string, unknown>,
  today: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    colaboradorId,
    tipo: 'horas',
    fecha: String(args.date ?? today).slice(0, 10),
    horas: Number(args.hours),
    horaDesde: args.horaDesde != null ? String(args.horaDesde) : undefined,
    horaHasta: args.horaHasta != null ? String(args.horaHasta) : undefined,
    notas: args.notes != null ? String(args.notes) : undefined,
  };
  const valuationMode = String(args.valuationMode ?? '').trim();
  if (valuationMode) body.valuationMode = valuationMode;
  const rate = args.hourlyRate ?? args.valorHora;
  if (rate === null) {
    body.valuationMode = 'unvalued';
  } else if (rate != null && Number.isFinite(Number(rate)) && Number(rate) >= 0) {
    body.valorHora = Number(rate);
    body.valuationMode = valuationMode || 'explicit_rate';
  }
  return body;
}

function movementBodyFromPaymentArgs(
  colaboradorId: string,
  args: Record<string, unknown>,
  today: string
): Record<string, unknown> {
  return {
    colaboradorId,
    tipo: 'pago',
    fecha: String(args.date ?? today).slice(0, 10),
    monto: Number(args.amount),
    medioPagoId: String(args.medioPagoId ?? 'efectivo').trim() || 'efectivo',
    notas: args.notes != null ? String(args.notes) : undefined,
  };
}

function movementBodyFromExtraArgs(
  colaboradorId: string,
  args: Record<string, unknown>,
  today: string
): Record<string, unknown> {
  return {
    colaboradorId,
    tipo: 'extra',
    fecha: String(args.date ?? today).slice(0, 10),
    monto: Number(args.amount),
    extraTipo: args.extraTipo != null ? String(args.extraTipo).trim() : undefined,
    concepto:
      args.concept != null
        ? String(args.concept).trim()
        : args.concepto != null
          ? String(args.concepto).trim()
          : undefined,
    notas: args.notes != null ? String(args.notes) : undefined,
  };
}

function normalizeCollaboratorModalidad(raw: unknown): CollaboratorModalidad | undefined {
  const value = String(raw ?? '').trim();
  if (value === 'fijo' || value === 'mixto' || value === 'por_hora') return value;
  return undefined;
}

function normalizeCollaboratorPeriodo(raw: unknown): CollaboratorPeriodoReferencia | undefined {
  const value = String(raw ?? '').trim();
  if (value === 'quincena' || value === 'mes' || value === 'semana') return value;
  return undefined;
}

function collaboratorSummaryLines(tool: string, args: Record<string, unknown>): string[] {
  if (tool === 'create_collaborator') {
    const lines = [`• Nombre: ${String(args.name ?? '')}`];
    if (args.telefono) lines.push(`• Teléfono: ${String(args.telefono)}`);
    if (args.modalidad) lines.push(`• Modalidad: ${String(args.modalidad)}`);
    return lines;
  }
  if (tool === 'update_collaborator') {
    const lines: string[] = [];
    if (args.name) lines.push(`• Nombre: ${String(args.name)}`);
    if (args.telefono != null) lines.push(`• Teléfono: ${String(args.telefono)}`);
    if (args.modalidad) lines.push(`• Modalidad: ${String(args.modalidad)}`);
    if (args.activo === false) lines.push('• Estado: inactivo');
    if (args.activo === true) lines.push('• Estado: activo');
    return lines.length ? lines : ['• Actualizar colaborador'];
  }
  if (tool === 'register_collaborator_hours') {
    const lines = [
      `• Colaborador: ${String(args.collaboratorName ?? args.name ?? '')}`,
      `• Fecha: ${formatDayLabel(String(args.date ?? ''))}`,
      `• Horas: ${Number(args.hours) || 0}`,
    ];
    if (args.valuationMode === 'unvalued' || args.generatedAmount == null) {
      lines.push('• Importe: Sin valorar');
    } else {
      if (args.valorHora != null) lines.push(`• Valor hora: $${money(Number(args.valorHora))}`);
      lines.push(`• Importe generado: $${money(Number(args.generatedAmount))}`);
      if (args.estimatedBalance != null) {
        lines.push(`• Nuevo saldo estimado: $${money(Number(args.estimatedBalance))}`);
      }
    }
    return lines;
  }
  if (tool === 'register_collaborator_extra') {
    const lines = [
      `• Colaborador: ${String(args.collaboratorName ?? args.name ?? '')}`,
      `• Importe: $${money(Number(args.amount) || 0)}`,
    ];
    if (args.extraTipoLabel) lines.push(`• Tipo: ${String(args.extraTipoLabel)}`);
    if (args.concept) lines.push(`• Concepto: ${String(args.concept)}`);
    if (args.currentBalance != null) {
      lines.push(`• Saldo actual: $${money(Number(args.currentBalance))}`);
    }
    if (args.estimatedBalance != null) {
      lines.push(`• Nuevo saldo estimado: $${money(Number(args.estimatedBalance))}`);
    }
    return lines;
  }
  if (tool === 'register_collaborator_payment') {
    return [
      `• Colaborador: ${String(args.collaboratorName ?? args.name ?? '')}`,
      `• Importe: $${money(Number(args.amount) || 0)}`,
      ...(args.currentBalance != null ? [`• Saldo actual: $${money(Number(args.currentBalance))}`] : []),
      ...(args.balanceAfter != null ? [`• Saldo después del pago: $${money(Number(args.balanceAfter))}`] : []),
    ];
  }
  if (tool === 'update_collaborator_movement') {
    const lines = [
      `• Fecha: ${formatDayLabel(String(args.date ?? ''))}`,
      `• Horas: ${Number(args.hours) || 0}`,
    ];
    if (args.previousValorHora != null) {
      lines.push(`• Valor hora actual: $${money(Number(args.previousValorHora))}/h`);
    } else if (args.previousUnvalued) {
      lines.push('• Valor hora actual: Sin valorar');
    }
    if (args.valuationMode === 'unvalued') {
      lines.push('• Nuevo valor hora: Sin valorar');
      lines.push('• Nuevo importe: Sin valorar');
    } else if (args.valorHora != null) {
      lines.push(`• Nuevo valor hora: *$${money(Number(args.valorHora))}/h*`);
      lines.push(`• Nuevo importe: *$${money(Number(args.generatedAmount ?? 0))}*`);
    }
    if (args.previousGeneratedAmount != null) {
      lines.splice(2, 0, `• Importe actual: $${money(Number(args.previousGeneratedAmount))}`);
    }
    return lines;
  }
  return [];
}

export const WRITE_TOOL_HANDLERS: Record<string, WriteHandler> = {
  create_client: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const name = String(args.name ?? '').trim();
      if (!name) throw new Error('Indicá el nombre del cliente.');
      return {
        tool: 'create_client',
        label: `Crear cliente ${name}`,
        args: { name, telefono: String(args.telefono ?? '').trim() || undefined },
      };
    },
  },
  update_client: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const clientId = String(args.clientId ?? ctx.state?.focusEntities?.client?.id ?? '').trim();
      if (!clientId) throw new Error('Indicá el cliente.');
      return {
        tool: 'update_client',
        label: 'Actualizar cliente',
        args: {
          clientId,
          name: args.name != null ? String(args.name) : undefined,
          telefono: args.telefono != null ? String(args.telefono) : undefined,
        },
      };
    },
  },
  create_product: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const name = String(args.name ?? '').trim();
      if (!name) throw new Error('Indicá el producto.');
      return {
        tool: 'create_product',
        label: `Crear producto ${name}`,
        args: {
          name,
          salePrice: args.salePrice != null ? Number(args.salePrice) : undefined,
          cost: args.cost != null ? Number(args.cost) : undefined,
          initialStock: args.initialStock != null ? Number(args.initialStock) : undefined,
          controlsStock: args.controlsStock === true,
        },
      };
    },
  },
  update_product_price: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const product = await resolveProductId(ctx, args);
      const salePrice = Number(args.salePrice) || 0;
      if (salePrice <= 0) throw new Error('Indicá el precio de venta.');
      return {
        tool: 'update_product_price',
        label: `Precio ${product.name} → $${money(salePrice)}`,
        args: { productId: product.productId, salePrice },
      };
    },
  },
  update_product_cost: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const product = await resolveProductId(ctx, args);
      const cost = Number(args.cost) || 0;
      if (cost < 0) throw new Error('Indicá el costo.');
      return {
        tool: 'update_product_cost',
        label: `Costo ${product.name} → $${money(cost)}`,
        args: { productId: product.productId, cost },
      };
    },
  },
  rename_products: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const newBaseName = String(args.newBaseName ?? '').trim();
      if (!newBaseName) throw new Error('Indicá el nuevo nombre.');
      const rawIds = Array.isArray(args.productIds)
        ? args.productIds
        : typeof args.productIds === 'string'
          ? String(args.productIds)
              .split(/[,;\s]+/)
              .map((id) => id.trim())
              .filter(Boolean)
          : [];
      let productIds = [...new Set(rawIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
      const recent = recoverRecentOperationFromState(ctx.state) ?? getFreshRecentOperation(ctx.state);
      const recentIndex =
        args.recentRecordIndex != null ? Number(args.recentRecordIndex) : NaN;
      if (!productIds.length && Number.isFinite(recentIndex) && recentIndex >= 1) {
        const id = resolveRecentRecordIdByIndex(recent, recentIndex);
        if (!id) {
          throw new Error(
            recent?.recordIds?.length
              ? `No hay un registro #${recentIndex} en la operación reciente (${recent.recordIds.length} en total).`
              : 'No hay una operación reciente de productos para ese índice.'
          );
        }
        if (recent && recent.entityKind !== 'product' && recent.entityKind !== 'stock') {
          throw new Error('La operación reciente no es de productos. Aclarame a qué te referís.');
        }
        productIds = [id];
      } else if (!productIds.length && args.fromRecentOperation === true) {
        if (!recent || (recent.entityKind !== 'product' && recent.entityKind !== 'stock')) {
          throw new Error('No hay productos recientes para modificar. Indicá cuáles.');
        }
        productIds = [...recent.recordIds];
      }
      if (!productIds.length) throw new Error('Indicá los productIds concretos a renombrar.');

      const preview = await previewProductRename({
        businessId: ctx.tenant.businessId,
        productIds,
        newBaseName,
      });
      if (preview.status !== 'ready' || !preview.selectedIds.length) {
        throw new Error(preview.message || 'No pude preparar el rename.');
      }
      const count = preview.previewNames.length;
      const sample = preview.previewNames
        .slice(0, 8)
        .map((row) => `• ${row.from} → ${row.to}`);
      const more =
        preview.previewNames.length > 8
          ? [`• … y ${preview.previewNames.length - 8} más`]
          : [];
      return {
        tool: 'rename_products',
        label:
          count === 1
            ? `Renombrar producto → ${newBaseName}`
            : `Renombrar ${count} productos → ${newBaseName}`,
        summaryTitle: count === 1 ? 'Producto renombrado' : 'Productos renombrados',
        summaryLines: [
          ...(count > 1
            ? [`*${count}* variantes de *${preview.oldBaseName}*:`, ...sample, ...more]
            : sample),
          `Nombre base: *${newBaseName}*`,
        ],
        args: {
          productIds: preview.selectedIds,
          newBaseName,
          mode: count > 1 ? 'base_name' : String(args.mode ?? 'base_name'),
          oldBaseName: preview.oldBaseName,
          previewNames: preview.previewNames,
        },
      };
    },
  },
  adjust_stock: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const product = await resolveProductId(ctx, args);
      const quantity = Number(args.quantity) || 0;
      if (!quantity) throw new Error('Indicá la cantidad.');
      return {
        tool: 'adjust_stock',
        label: `Stock ${product.name} ${quantity > 0 ? '+' : ''}${quantity}`,
        args: { productId: product.productId, quantity, reason: String(args.reason ?? 'Ajuste WhatsApp') },
      };
    },
  },
  set_stock: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const product = await resolveProductId(ctx, args);
      const stock = Number(args.stock);
      if (!Number.isFinite(stock) || stock < 0) throw new Error('Indicá el stock.');
      return {
        tool: 'set_stock',
        label: `Stock ${product.name} → ${stock}`,
        args: { productId: product.productId, stock },
      };
    },
  },
  register_order_payment: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const order = await resolveOrderId(ctx, args);
      const amount = Number(args.amount) || 0;
      if (amount <= 0) throw new Error('Indicá el monto del cobro.');
      return {
        tool: 'register_order_payment',
        label: `Cobrar $${money(amount)} al pedido #${order.label}`,
        args: { orderId: order.orderId, amount, clientName: order.clientName },
      };
    },
  },
  register_order_deposit: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const order = await resolveOrderId(ctx, args);
      const amount = Number(args.amount) || 0;
      if (amount <= 0) throw new Error('Indicá el monto de la seña.');
      return {
        tool: 'register_order_deposit',
        label: `Seña $${money(amount)} al pedido #${order.label}`,
        args: { orderId: order.orderId, amount, clientName: order.clientName, paymentKind: 'senia' },
      };
    },
  },
  collect_order_full_balance: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const order = await resolveOrderId(ctx, args);
      return {
        tool: 'collect_order_full_balance',
        label: `Cobrar saldo completo del pedido #${order.label}`,
        args: { orderId: order.orderId, payFullBalance: true, clientName: order.clientName },
      };
    },
  },
  update_order_status: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const order = await resolveOrderId(ctx, args);
      const status = normalizeRequestedOrderStatus(String(args.status ?? ''));
      if (!status) throw new Error('Indicá el estado.');
      return {
        tool: 'update_order_status',
        label: `Estado #${order.label} → ${status}`,
        args: {
          businessId: ctx.tenant.businessId,
          orderId: order.orderId,
          orderNumber: order.label,
          fromStatus: order.fromStatus,
          status,
          requestedStatus: status,
          clientName: order.clientName,
        },
      };
    },
  },
  register_cash_movement: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const type = normalizeCashMovementType(args);
      const amount = Number(args.amount) || 0;
      const concept = String(args.concept ?? args.motivo ?? args.description ?? '').trim();
      if (!type) throw new Error('Indicá ingreso o egreso.');
      if (amount <= 0) throw new Error('Indicá el monto.');
      if (!concept) throw new Error('Indicá el concepto.');

      const { suggestCashCategoryFromText } = await import('../../../../shared/cash-taxonomy.ts');
      const suggested =
        String(args.categoriaId ?? '').trim() || String(args.categoryId ?? '').trim()
          ? {
              id: String(args.categoriaId ?? args.categoryId).trim(),
              label: String(args.categoriaLabel ?? args.categoryLabel ?? '').trim() || concept,
            }
          : suggestCashCategoryFromText(type === 'egreso' ? 'egreso' : 'ingreso', concept);

      const cashAccountHint = String(args.cashAccountHint ?? '').trim() || undefined;
      const ambitoIdArg = String(args.ambitoId ?? args.cashAccountId ?? '').trim() || undefined;
      const contextCashId = ctx.state?.focusEntities?.cash?.id;
      const explicit = Boolean(cashAccountHint || ambitoIdArg);
      const resolvedId = ambitoIdArg || undefined;
      const contextId = !explicit ? contextCashId : undefined;

      const resolution = await resolveCashAccount({
        businessId: ctx.tenant.businessId,
        hint: cashAccountHint,
        resolvedId,
        contextId,
        explicit,
      });

      const blockedArgs = {
        type,
        amount,
        concept,
        cashAccountHint,
        categoriaId: suggested?.id,
        categoriaLabel: suggested?.label,
      };

      if (resolution.status === 'needs_selection') {
        throw new AgentError('ENTITY_AMBIGUOUS', '¿En qué caja?', {
          entityType: 'cash_account',
          candidates: resolution.candidates.map((row) => ({
            id: row.id,
            name: row.name,
            label: row.name,
          })),
          blockedTool: 'register_cash_movement',
          blockedArgs,
        });
      }
      if (resolution.status === 'not_found') {
        throw new AgentError('ENTITY_NOT_FOUND', `No encontré una caja llamada "${resolution.hint}".`, {
          entityType: 'cash_account',
          hint: resolution.hint,
        });
      }
      if (resolution.status === 'ambiguous') {
        throw new AgentError('ENTITY_AMBIGUOUS', 'Encontré más de una caja parecida.', {
          entityType: 'cash_account',
          candidates: resolution.candidates.map((row) => ({
            id: row.id,
            name: row.name,
            label: row.name,
          })),
          blockedTool: 'register_cash_movement',
          blockedArgs,
        });
      }

      const account = resolution.account;
      const categoryBit = suggested?.label ? ` en ${suggested.label}` : '';
      const movementLabel = `${type === 'egreso' ? 'Egreso' : 'Ingreso'} $${money(amount)}${categoryBit} · ${concept}`;

      return {
        tool: 'register_cash_movement',
        label: movementLabel,
        summaryTitle: movementLabel,
        summaryLines: [`Caja: ${account.name}`],
        args: {
          type,
          amount,
          concept,
          ambitoId: account.id,
          cashAccountId: account.id,
          cashAccountName: account.name,
          cashAccountHint,
          categoriaId: suggested?.id ?? null,
          categoriaLabel: suggested?.label ?? null,
          medio: String(args.medio ?? args.paymentMethod ?? '').trim() || undefined,
        },
      };
    },
  },
  create_recurring_payable: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const name = String(args.name ?? '').trim();
      const amount = Number(args.amount) || 0;
      if (!name) throw new Error('Indicá el nombre del gasto o beneficiario (ej. UTE).');
      if (amount <= 0) throw new Error('Indicá el monto mensual del gasto.');

      const firstDueExplicit = String(args.firstDueDate ?? '').trim().slice(0, 10);
      let fechaPrimerVencimiento = '';
      let dueDay: number | undefined;
      if (/^\d{4}-\d{2}-\d{2}$/.test(firstDueExplicit)) {
        fechaPrimerVencimiento = firstDueExplicit;
        dueDay = Number(firstDueExplicit.slice(8, 10));
      } else {
        const rawDay = Number(args.dueDay);
        if (!Number.isInteger(rawDay) || rawDay < 1 || rawDay > 31) {
          throw new Error('Indicá el día del mes del vencimiento (1 a 31), o la fecha del primer vencimiento.');
        }
        dueDay = rawDay;
        fechaPrimerVencimiento = resolveRecurringPayableFirstDueDate(rawDay);
      }

      const notes = String(args.notes ?? '').trim() || undefined;
      const caja = await loadCajaConfig(ctx.tenant.businessId);
      let ambito = getBusinessCashAmbitoId(caja);

      const cashAccountHint = String(args.cashAccountHint ?? '').trim() || undefined;
      const ambitoIdArg = String(args.ambitoId ?? '').trim() || undefined;
      if (cashAccountHint || ambitoIdArg) {
        const resolution = await resolveCashAccount({
          businessId: ctx.tenant.businessId,
          hint: cashAccountHint,
          resolvedId: ambitoIdArg || undefined,
          explicit: true,
        });
        if (resolution.status === 'needs_selection' || resolution.status === 'ambiguous') {
          throw new AgentError('ENTITY_AMBIGUOUS', '¿En qué caja / ámbito?', {
            entityType: 'cash_account',
            candidates: resolution.candidates.map((row) => ({
              id: row.id,
              name: row.name,
              label: row.name,
            })),
            blockedTool: 'create_recurring_payable',
            blockedArgs: {
              name,
              amount,
              dueDay: dueDay ?? null,
              firstDueDate: fechaPrimerVencimiento,
              notes: notes ?? null,
              cashAccountHint: cashAccountHint ?? null,
            },
          });
        }
        if (resolution.status === 'not_found') {
          throw new AgentError('ENTITY_NOT_FOUND', `No encontré una caja llamada "${resolution.hint}".`, {
            entityType: 'cash_account',
            hint: resolution.hint,
          });
        }
        ambito = resolution.account.id;
      }

      const preparedArgs = {
        name,
        amount,
        dueDay,
        firstDueDate: fechaPrimerVencimiento,
        notes,
        ambitoId: ambito,
        tipo: 'mensual',
      };

      const dayLabel = String(dueDay ?? fechaPrimerVencimiento.slice(8, 10)).padStart(2, '0');
      return {
        tool: 'create_recurring_payable',
        label: `Gasto fijo · ${name} · $${money(amount)}`,
        args: preparedArgs,
        summaryTitle: 'Registrar gasto fijo mensual',
        summaryLines: [
          `• Beneficiario: ${name}`,
          `• Monto: $${money(amount)}`,
          `• Vence cada mes el día ${dayLabel}`,
          `• Primer vencimiento: ${fechaPrimerVencimiento.slice(8, 10)}/${fechaPrimerVencimiento.slice(5, 7)}/${fechaPrimerVencimiento.slice(0, 4)}`,
          '• No registra caja ahora: el egreso se carga al pagar el vencimiento',
        ],
      };
    },
  },
  create_one_time_payable: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const name = String(args.name ?? 'Obligación').trim() || 'Obligación';
      const amount = Number(args.amount) || 0;
      const dueDate = String(args.dueDate ?? '').trim().slice(0, 10);
      if (amount <= 0) throw new Error('Indicá el monto a pagar.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        throw new Error('Indicá la fecha de vencimiento (ej. viernes → YYYY-MM-DD).');
      }
      const notes = String(args.notes ?? '').trim() || undefined;
      return {
        tool: 'create_one_time_payable',
        label: `Pagar · ${name} · $${money(amount)}`,
        args: { name, amount, dueDate, notes },
        summaryTitle: 'Registrar obligación a pagar',
        summaryLines: [
          `• ${name}`,
          `• Monto: $${money(amount)}`,
          `• Vence: ${dueDate.slice(8, 10)}/${dueDate.slice(5, 7)}/${dueDate.slice(0, 4)}`,
          '• No registra caja ahora',
        ],
      };
    },
  },
  pay_payable: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const {
        findPayablesByBeneficiaryHint,
      } = await import('../../../domain/payables/payables-application-service.ts');
      let cuotaId = String(args.cuotaId ?? '').trim();
      const name = String(args.name ?? '').trim();
      if (!cuotaId) {
        const matches = await findPayablesByBeneficiaryHint(ctx.tenant.businessId, name || '');
        if (!matches.length) {
          throw new Error(
            name
              ? `No encontré un vencimiento pendiente de "${name}".`
              : 'Indicá qué obligación querés marcar como pagada (ej. UTE).'
          );
        }
        if (matches.length > 1) {
          throw new AgentError('ENTITY_AMBIGUOUS', 'Encontré varios vencimientos. ¿Cuál marco como pagado?', {
            entityType: 'payable',
            candidates: matches.slice(0, 8).map((row) => ({
              id: row.id,
              name: `${row.beneficiario} · $${money(row.monto)} · ${String(row.fechaVencimiento).slice(0, 10)}`,
              label: row.beneficiario,
            })),
            blockedTool: 'pay_payable',
            blockedArgs: {
              name,
              amount: args.amount != null ? Number(args.amount) : null,
              paymentMethod: args.paymentMethod != null ? String(args.paymentMethod) : null,
            },
          });
        }
        cuotaId = matches[0].id;
      }
      const matches = await findPayablesByBeneficiaryHint(ctx.tenant.businessId, '');
      const row = matches.find((m) => m.id === cuotaId);
      if (!row) throw new Error('No encontré ese vencimiento pendiente.');
      const due = String(row.fechaVencimiento).slice(0, 10);
      return {
        tool: 'pay_payable',
        label: `Pagar · ${row.beneficiario} · $${money(row.monto)}`,
        args: {
          cuotaId,
          paymentMethod: String(args.paymentMethod ?? '').trim().toLowerCase() || undefined,
          amount: args.amount != null ? Number(args.amount) : undefined,
        },
        summaryTitle: 'Marcar obligación como pagada',
        summaryLines: [
          `• ${row.beneficiario}`,
          `• $${money(row.monto)}`,
          `• Vence ${due.slice(8, 10)}/${due.slice(5, 7)}`,
          '• Se registrará el egreso en caja',
        ],
      };
    },
  },
  create_supplier: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const name = String(args.name ?? '').trim();
      if (!name) throw new Error('Indicá el proveedor.');
      return { tool: 'create_supplier', label: `Crear proveedor ${name}`, args: { name } };
    },
  },
  update_supplier: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      let supplierId = String(args.supplierId ?? ctx.state?.focusEntities?.supplier?.id ?? '').trim();
      const query = String(args.query ?? '').trim();
      if (!supplierId && query) {
        const resolved = await findSupplier(ctx.tenant.businessId, query);
        if (resolved.status === 'not_found') throw new Error(`No encontré un proveedor llamado ${query}.`);
        if (resolved.status === 'ambiguous') {
          throw new AgentError('ENTITY_AMBIGUOUS', 'Encontré varios proveedores. Indicame cuál.', {
            entityType: 'supplier',
            candidates: (resolved.candidates ?? []).map((row) => ({
              id: row.id,
              name: row.name,
              label: row.name,
            })),
            blockedTool: 'update_supplier',
            blockedArgs: {
              query,
              name: args.name != null ? String(args.name) : undefined,
              telefono: args.telefono != null ? String(args.telefono) : undefined,
              email: args.email != null ? String(args.email) : undefined,
              notas: args.notas != null ? String(args.notas) : undefined,
            },
          });
        }
        supplierId = resolved.entity!.id;
      }
      if (!supplierId) throw new Error('Indicá el proveedor.');
      return {
        tool: 'update_supplier',
        label: 'Actualizar proveedor',
        args: {
          supplierId,
          name: args.name != null ? String(args.name) : undefined,
          telefono: args.telefono != null ? String(args.telefono) : undefined,
          email: args.email != null ? String(args.email) : undefined,
          notas: args.notas != null ? String(args.notas) : undefined,
        },
      };
    },
  },
  create_collaborator: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      await assertCollaboratorWriteAccess(ctx);
      logCollaboratorTool('create_collaborator', ctx.tenant.businessId, { phase: 'plan' });
      const name = String(args.name ?? '').trim();
      if (!name) throw new Error('Indicá el nombre del colaborador.');
      const preparedArgs = {
        name,
        telefono: String(args.telefono ?? '').trim() || undefined,
        email: String(args.email ?? '').trim() || undefined,
        notas: String(args.notas ?? '').trim() || undefined,
        modalidad: normalizeCollaboratorModalidad(args.modalidad),
        valorHora: args.valorHora != null ? Number(args.valorHora) : undefined,
        montoFijoPeriodo: args.montoFijoPeriodo != null ? Number(args.montoFijoPeriodo) : undefined,
        periodoReferencia: normalizeCollaboratorPeriodo(args.periodoReferencia),
      };
      return {
        tool: 'create_collaborator',
        label: `Agregar colaborador · ${name}`,
        args: preparedArgs,
        summaryTitle: 'Agregar colaborador',
        summaryLines: collaboratorSummaryLines('create_collaborator', preparedArgs),
      };
    },
  },
  update_collaborator: {
    prepare: async (args, ctx) => {
      const gate = await assertCollaboratorWriteAccess(ctx);
      logCollaboratorTool('update_collaborator', ctx.tenant.businessId, { phase: 'plan' });
      const collaborator = await resolveCollaboratorId(ctx, args, gate);
      const preparedArgs: Record<string, unknown> = {
        colaboradorId: collaborator.colaboradorId,
      };
      if (args.name != null) preparedArgs.name = String(args.name);
      if (args.telefono != null) preparedArgs.telefono = String(args.telefono);
      if (args.email != null) preparedArgs.email = String(args.email);
      if (args.notas != null) preparedArgs.notas = String(args.notas);
      if (args.modalidad != null) preparedArgs.modalidad = normalizeCollaboratorModalidad(args.modalidad);
      if (args.valorHora != null) preparedArgs.valorHora = Number(args.valorHora);
      if (args.montoFijoPeriodo != null) preparedArgs.montoFijoPeriodo = Number(args.montoFijoPeriodo);
      if (args.periodoReferencia != null) {
        preparedArgs.periodoReferencia = normalizeCollaboratorPeriodo(args.periodoReferencia);
      }
      if (args.activo === true || args.activo === false) preparedArgs.activo = args.activo;
      const actionLabel =
        args.activo === false
          ? `Dar de baja a ${collaborator.name}`
          : `Actualizar colaborador · ${collaborator.name}`;
      return {
        tool: 'update_collaborator',
        label: actionLabel,
        args: preparedArgs,
        summaryTitle: args.activo === false ? 'Dar de baja colaborador' : 'Actualizar colaborador',
        summaryLines: collaboratorSummaryLines('update_collaborator', {
          ...preparedArgs,
          name: preparedArgs.name ?? collaborator.name,
        }),
      };
    },
  },
  register_collaborator_hours: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const gate = await assertCollaboratorHoursWriteAccess(ctx);
      logCollaboratorTool('register_collaborator_hours', ctx.tenant.businessId, { phase: 'plan' });
      const today = calendarDayAr();
      const collaborator = await resolveCollaboratorId(ctx, args, gate);
      const hours = Number(args.hours);
      if (!Number.isFinite(hours) || hours <= 0) throw new Error('Indicá las horas trabajadas.');
      const fecha = requireToolDate(args.date ?? today, today);
      const body = movementBodyFromHoursArgs(collaborator.colaboradorId, { ...args, date: fecha }, today);
      const preview = await previewCollaboratorMovement(ctx.tenant.businessId, body);
      const unvalued = preview.tipo === 'horas' && isUnvaluedHoursMovement(preview);
      const balance = await getCollaboratorBalance(ctx.tenant.businessId, collaborator.colaboradorId, {
        scope: gate.scope,
      });
      const generatedAmount = unvalued ? null : preview.monto ?? null;
      const estimatedBalance =
        generatedAmount != null ? (balance?.saldoAcumulado ?? 0) + generatedAmount : balance?.saldoAcumulado ?? null;
      const preparedArgs = {
        colaboradorId: collaborator.colaboradorId,
        collaboratorName: collaborator.name,
        date: fecha,
        hours,
        horaDesde: args.horaDesde != null ? String(args.horaDesde) : undefined,
        horaHasta: args.horaHasta != null ? String(args.horaHasta) : undefined,
        valorHora: unvalued ? null : preview.valorHora ?? null,
        valuationMode: unvalued ? 'unvalued' : preview.valorHora ? 'configured_rate' : 'unvalued',
        notes: args.notes != null ? String(args.notes) : undefined,
        generatedAmount,
        estimatedBalance,
        movementBody: body,
      };
      return {
        tool: 'register_collaborator_hours',
        label: `Registrar ${hours} h · ${collaborator.name}`,
        args: preparedArgs,
        summaryTitle: 'Registrar horas',
        summaryLines: collaboratorSummaryLines('register_collaborator_hours', preparedArgs),
      };
    },
  },
  register_collaborator_extra: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const gate = await assertCollaboratorWriteAccess(ctx);
      logCollaboratorTool('register_collaborator_extra', ctx.tenant.businessId, { phase: 'plan' });
      const today = calendarDayAr();
      const collaborator = await resolveCollaboratorId(ctx, args, gate);
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Indicá el monto del extra.');
      const fecha = requireToolDate(args.date ?? today, today);
      const body = movementBodyFromExtraArgs(collaborator.colaboradorId, { ...args, date: fecha }, today);
      const preview = await previewCollaboratorMovement(ctx.tenant.businessId, body);
      const balance = await getCollaboratorBalance(ctx.tenant.businessId, collaborator.colaboradorId, {
        scope: gate.scope,
      });
      const currentBalance = balance?.saldoAcumulado ?? 0;
      const extraAmount = Number(preview.monto ?? amount);
      const extraTipos = await loadCollaboratorExtraTipos(ctx.tenant.businessId);
      const extraTipoLabel = resolveCollaboratorExtraTipoLabel(extraTipos, preview.extraTipo);
      const preparedArgs = {
        colaboradorId: collaborator.colaboradorId,
        collaboratorName: collaborator.name,
        date: fecha,
        amount: extraAmount,
        extraTipo: preview.extraTipo,
        extraTipoLabel,
        concept: preview.concepto ?? (args.concept != null ? String(args.concept).trim() : undefined),
        notes: args.notes != null ? String(args.notes) : undefined,
        currentBalance,
        estimatedBalance: currentBalance + extraAmount,
        movementBody: body,
      };
      return {
        tool: 'register_collaborator_extra',
        label: `Extra $${money(extraAmount)} · ${collaborator.name}`,
        args: preparedArgs,
        summaryTitle: 'Registrar extra a colaborador',
        summaryLines: collaboratorSummaryLines('register_collaborator_extra', preparedArgs),
      };
    },
  },
  register_collaborator_payment: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const gate = await assertCollaboratorPaymentWriteAccess(ctx);
      logCollaboratorTool('register_collaborator_payment', ctx.tenant.businessId, { phase: 'plan' });
      const today = calendarDayAr();
      const collaborator = await resolveCollaboratorId(ctx, args, gate);
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Indicá el monto del pago.');
      const fecha = requireToolDate(args.date ?? today, today);
      const body = movementBodyFromPaymentArgs(collaborator.colaboradorId, { ...args, date: fecha }, today);
      await previewCollaboratorMovement(ctx.tenant.businessId, body);
      const balance = await getCollaboratorBalance(ctx.tenant.businessId, collaborator.colaboradorId, {
        scope: gate.scope,
      });
      const currentBalance = balance?.saldoAcumulado ?? 0;
      const preparedArgs = {
        colaboradorId: collaborator.colaboradorId,
        collaboratorName: collaborator.name,
        date: fecha,
        amount,
        medioPagoId: String(args.medioPagoId ?? 'efectivo').trim() || 'efectivo',
        notes: args.notes != null ? String(args.notes) : undefined,
        currentBalance,
        balanceAfter: currentBalance - amount,
        movementBody: body,
      };
      return {
        tool: 'register_collaborator_payment',
        label: `Pago $${money(amount)} · ${collaborator.name}`,
        args: preparedArgs,
        summaryTitle: 'Registrar pago a colaborador',
        summaryLines: collaboratorSummaryLines('register_collaborator_payment', preparedArgs),
      };
    },
  },
  update_collaborator_movement: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const gate = await assertCollaboratorHoursWriteAccess(ctx);
      logCollaboratorTool('update_collaborator_movement', ctx.tenant.businessId, { phase: 'plan' });
      const today = calendarDayAr();
      const fecha = requireToolDate(args.date ?? today, today);
      const collaborator = await resolveCollaboratorId(ctx, args, gate);

      let movementId = String(args.movementId ?? '').trim();
      if (!movementId) {
        const rows = await listHoursMovementsForDate(
          ctx.tenant.businessId,
          collaborator.colaboradorId,
          fecha
        );
        if (!rows.length) {
          throw new AgentError(
            'ENTITY_NOT_FOUND',
            `*👷 No encontré horas registradas*\n\n• Colaborador: ${collaborator.name}\n• Fecha: ${formatDayLabel(fecha)}`
          );
        }
        if (rows.length > 1) {
          throw new AgentError('ENTITY_AMBIGUOUS', `*👷 Registros del ${formatDayLabel(fecha)}*`, {
            entityType: 'work_log',
            candidates: rows.map((row) => ({
              id: row.id,
              name: row.id,
              label: `🕒 ${Number(row.horas) || 0} h · $${money(Number(row.valorHora ?? 0))}/h · $${money(Number(row.monto ?? 0))}`,
            })),
            blockedTool: 'update_collaborator_movement',
            blockedArgs: { ...args, collaboratorId: collaborator.colaboradorId, date: fecha },
          });
        }
        movementId = rows[0]!.id;
      }

      const existing = await getCollaboratorMovement(ctx.tenant.businessId, movementId);
      if (!existing || existing.tipo !== 'horas') {
        throw new AgentError('ENTITY_NOT_FOUND', 'No encontré ese registro de horas.');
      }
      if (existing.colaboradorId !== collaborator.colaboradorId) {
        throw new AgentError('ENTITY_NOT_FOUND', 'El registro no corresponde a ese colaborador.');
      }

      const body: Record<string, unknown> = {
        colaboradorId: existing.colaboradorId,
        tipo: 'horas',
        fecha: String(args.date ?? existing.fecha ?? fecha).slice(0, 10),
        horas: args.hours != null ? Number(args.hours) : existing.horas,
        horaDesde: args.horaDesde != null ? String(args.horaDesde) : existing.horaDesde,
        horaHasta: args.horaHasta != null ? String(args.horaHasta) : existing.horaHasta,
        notas: args.notes != null ? String(args.notes) : existing.notas,
      };

      const rateArg = args.hourlyRate ?? args.valorHora;
      if (String(args.valuationMode ?? '') === 'unvalued' || rateArg === null) {
        body.valuationMode = 'unvalued';
      } else if (rateArg != null && Number.isFinite(Number(rateArg)) && Number(rateArg) >= 0) {
        body.valorHora = Number(rateArg);
        body.valuationMode = 'explicit_rate';
      } else if (existing.valorHora != null && Number.isFinite(Number(existing.valorHora))) {
        body.valorHora = existing.valorHora;
        body.valuationMode = 'explicit_rate';
      }

      const preview = await previewCollaboratorMovement(ctx.tenant.businessId, body);
      const unvalued = isUnvaluedHoursMovement(preview);
      const preparedArgs = {
        movementId,
        colaboradorId: collaborator.colaboradorId,
        collaboratorName: collaborator.name,
        date: body.fecha,
        hours: preview.horas ?? body.horas,
        valorHora: unvalued ? null : preview.valorHora ?? null,
        valuationMode: unvalued ? 'unvalued' : 'explicit_rate',
        generatedAmount: unvalued ? null : preview.monto ?? null,
        previousValorHora: existing.valorHora ?? null,
        previousGeneratedAmount: existing.monto ?? null,
        previousUnvalued: isUnvaluedHoursMovement(existing),
        movementBody: body,
      };

      return {
        tool: 'update_collaborator_movement',
        label: `Modificar horas · ${collaborator.name}`,
        args: preparedArgs,
        summaryTitle: `👷 Modificar horas · ${collaborator.name}`,
        summaryLines: collaboratorSummaryLines('update_collaborator_movement', preparedArgs),
      };
    },
  },
  create_order: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const client = await resolveClientId(ctx, args);
      return {
        tool: 'create_order',
        label: `Pedido para ${client.name}`,
        args: {
          clientId: client.clientId,
          clientName: client.name,
          notes: String(args.notes ?? '').trim() || undefined,
          deliveryDate: String(args.deliveryDate ?? '').trim() || undefined,
        },
      };
    },
  },
  create_sale: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      return {
        tool: 'create_sale',
        label: 'Registrar venta',
        args: {
          clientId: String(args.clientId ?? '').trim() || undefined,
          amount: Number(args.amount) || 0,
        },
      };
    },
  },
  create_purchase: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      return {
        tool: 'create_purchase',
        label: 'Registrar compra',
        args: {
          supplierQuery: String(args.supplierQuery ?? '').trim() || undefined,
          amount: Number(args.amount) || 0,
        },
      };
    },
  },
  add_order_extra_cost: {
    prepare: async (args, ctx) => {
      await ensureWritePermission(ctx);
      const order = await resolveOrderId(ctx, args);
      const amount = Number(args.amount) || 0;
      if (amount <= 0) throw new Error('Indicá el monto del costo.');
      return {
        tool: 'add_order_extra_cost',
        label: `Costo extra #${order.label} · $${money(amount)}`,
        args: {
          orderId: order.orderId,
          amount,
          concept: String(args.concept ?? 'Costo extra').trim(),
        },
      };
    },
  },
  prepare_visual_draft_write: {
    prepare: async (_args, ctx) => {
      await ensureWritePermission(ctx);
      const draft = liveVisualDraft(ctx.state);
      if (!draft) {
        throw new Error('No hay un borrador de imagen para confirmar.');
      }
      if (!isVisualDraftReadyToWrite(draft)) {
        throw new Error('El borrador todavía tiene ítems sin resolver.');
      }
      return plannedWriteFromVisualDraft(draft);
    },
  },
  ...Object.fromEntries(
    Object.entries(AUTOMATION_WRITE_HANDLERS).map(([name, handler]) => [
      name,
      {
        prepare: async (args: Record<string, unknown>, ctx: ToolExecutionContext) => {
          await ensureWritePermission(ctx);
          return handler.prepare(args, ctx);
        },
      },
    ])
  ),
};

export function buildAgentOperationPlan(
  writes: AgentPlannedWrite[],
  rawUserMessage: string,
  idempotencyKey?: string,
  previous?: AgentOperationPlan | null
): AgentOperationPlan {
  const customSummary = writes.find((row) => row.summaryTitle || row.summaryLines?.length);
  const base: AgentOperationPlan = {
    version: 'v4',
    planId: nextOperationPlanId(),
    planVersion: 1,
    status: 'awaiting_confirmation',
    writes,
    summary: {
      title:
        customSummary?.summaryTitle ??
        (writes.length === 1 ? writes[0]!.label : 'Confirmar operaciones'),
      lines:
        customSummary?.summaryLines?.length
          ? customSummary.summaryLines
          : writes.map((row) => `• ${row.label}`),
    },
    rawUserMessage,
    idempotencyKey,
  };
  return previous?.planId ? supersedeOperationPlan(previous, base) : base;
}

export function parseAgentOperationPlan(value: unknown): AgentOperationPlan | null {
  if (!value || typeof value !== 'object') return null;
  const plan = value as AgentOperationPlan;
  if (plan.version !== 'v4' || !Array.isArray(plan.writes)) return null;
  return plan;
}
