import { incrementWhatsappOps } from '../../auth/usage-gates.ts';
import { createClient, updateClient } from '../../domain/client/index.ts';
import { createCollaborator, updateCollaborator, registerCollaboratorMovement, updateCollaboratorMovement } from '../../domain/collaborator/index.ts';
import { adjustStock, bulkRenameProductFamily, createProduct, getProduct, setStock, updateProduct } from '../../domain/stock/index.ts';
import { formatVerifiedRenameReply, verifyRenameProductsPersisted } from '../v4-write-verify.ts';
import { createSupplier, updateSupplier } from '../../domain/supplier/index.ts';
import { createPayableObligation } from '../../utils/payables.ts';
import {
  addOrderCostFromWhatsapp,
  createOrderFromWhatsapp,
  createPurchaseFromWhatsapp,
  createSaleFromWhatsapp,
  executeRegisterCashMovement,
  registerPaymentFromWhatsapp,
  updateProductCostFromWhatsapp,
} from '../erp-writes.ts';
import { formatPurchaseDateEs } from '../../utils/card-payment-schedule.ts';
import { updateOrderStatusFromWhatsapp } from '../order-status.ts';
import type { WhatsappCommandEntities } from '../ai-command-parser.ts';
import { AgentError } from './agent-errors.ts';
import { getToolByName } from './tool-registry.ts';
import type {
  AgentOperationPlan,
  AgentPlannedWrite,
  ToolCallRequest,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolRegistryEntry,
} from './tool-types.ts';
import { buildAgentOperationPlan } from './tools/write-tools.ts';
import { executeAutomationWrite } from './tools/automation-tools.ts';
import { pendingPlanFromState } from '../v4-conversation-context.ts';
import { normalizeStrictToolArgs } from './strict-tool-schema.ts';

const MAX_TOOL_ROUNDS = 6;

export function getMaxToolRounds(): number {
  return MAX_TOOL_ROUNDS;
}

function safeArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  return normalizeStrictToolArgs(args as Record<string, unknown>);
}

export async function executeReadToolCall(
  call: ToolCallRequest,
  ctx: ToolExecutionContext,
  registry: ToolRegistryEntry[]
): Promise<ToolExecutionResult> {
  const tool = getToolByName(call.name, registry);
  if (!tool || tool.mode !== 'read' || !tool.execute) {
    return {
      toolCallId: call.id,
      name: call.name,
      ok: false,
      output: {
        errorCode: 'CAPABILITY_NOT_ENABLED',
        message: 'Esa consulta no está disponible por ahora.',
      },
      errorCode: 'CAPABILITY_NOT_ENABLED',
    };
  }
  try {
    const output = await tool.execute(safeArgs(call.arguments), ctx);
    return { toolCallId: call.id, name: call.name, ok: true, output };
  } catch (error) {
    return {
      toolCallId: call.id,
      name: call.name,
      ok: false,
      output: {
        errorCode: error instanceof AgentError ? error.code : 'DOMAIN_VALIDATION_ERROR',
        message: error instanceof Error ? error.message : 'Error de tool',
      },
      errorCode: error instanceof AgentError ? error.code : 'DOMAIN_VALIDATION_ERROR',
    };
  }
}

export async function prepareWriteToolCalls(
  calls: ToolCallRequest[],
  ctx: ToolExecutionContext,
  registry: ToolRegistryEntry[]
): Promise<AgentOperationPlan> {
  const writes: AgentPlannedWrite[] = [];
  for (const call of calls) {
    const tool = getToolByName(call.name, registry);
    if (!tool || tool.mode !== 'write') {
      throw new AgentError(
        'CAPABILITY_NOT_ENABLED',
        'Esa acción no está disponible por WhatsApp en este momento.'
      );
    }
    if (!tool.prepare) {
      throw new AgentError(
        'CAPABILITY_NOT_ENABLED',
        'Esa acción todavía no se puede completar por WhatsApp.'
      );
    }
    writes.push(await tool.prepare(safeArgs(call.arguments), ctx));
  }
  return buildAgentOperationPlan(
    writes,
    ctx.rawUserMessage,
    ctx.messageId ? `wa:${ctx.messageId}:${writes.map((row) => row.tool).join('+')}` : undefined,
    pendingPlanFromState(ctx.state)
  );
}

async function executePlannedWrite(
  tenant: ToolExecutionContext['tenant'],
  write: AgentPlannedWrite
): Promise<{ reply: string; data?: Record<string, unknown> }> {
  const args = write.args;
  switch (write.tool) {
    case 'create_client': {
      const created = await createClient({
        businessId: tenant.businessId,
        name: String(args.name ?? ''),
        telefono: String(args.telefono ?? '') || undefined,
        source: 'whatsapp',
      });
      await incrementWhatsappOps(tenant.businessId);
      return {
        reply: `Listo. Cliente *${created.name}* creado.`,
        data: { clientId: created.id, clientName: created.name, kind: 'client' },
      };
    }
    case 'update_client': {
      const updated = await updateClient({
        businessId: tenant.businessId,
        clientId: String(args.clientId ?? ''),
        name: args.name != null ? String(args.name) : undefined,
        telefono: args.telefono != null ? String(args.telefono) : undefined,
      });
      await incrementWhatsappOps(tenant.businessId);
      return {
        reply: `Listo. Actualicé a *${updated.name}*.`,
        data: {
          clientId: updated.id,
          clientName: updated.name,
          kind: 'client',
          action: 'update',
          persisted: true,
          recordIds: [updated.id],
          labels: [updated.name],
        },
      };
    }
    case 'create_product': {
      const created = await createProduct({
        businessId: tenant.businessId,
        name: String(args.name ?? ''),
        salePrice: args.salePrice != null ? Number(args.salePrice) : undefined,
        cost: args.cost != null ? Number(args.cost) : undefined,
        initialStock: args.initialStock != null ? Number(args.initialStock) : undefined,
        controlsStock: args.controlsStock === true,
        source: 'whatsapp',
      });
      await incrementWhatsappOps(tenant.businessId);
      return {
        reply: `Listo. Producto *${created.name}* creado.`,
        data: { productId: created.id, productName: created.name, kind: 'product' },
      };
    }
    case 'update_product_price': {
      const updated = await updateProduct({
        businessId: tenant.businessId,
        productId: String(args.productId ?? ''),
        salePrice: Number(args.salePrice) || 0,
      });
      await incrementWhatsappOps(tenant.businessId);
      return { reply: `Listo. Precio de *${updated.name}* actualizado.` };
    }
    case 'update_product_cost': {
      const result = await updateProductCostFromWhatsapp(tenant, {
        productId: String(args.productId ?? ''),
        amount: Number(args.cost) || 0,
      } as WhatsappCommandEntities);
      await incrementWhatsappOps(tenant.businessId);
      return { reply: result.reply, data: { productId: result.productId, productName: result.productName } };
    }
    case 'rename_products': {
      const productIds = Array.isArray(args.productIds)
        ? args.productIds.map((id) => String(id ?? '').trim()).filter(Boolean)
        : [];
      const newBaseName = String(args.newBaseName ?? '').trim();
      if (!productIds.length) {
        throw new AgentError('MISSING_REQUIRED_FIELD', 'Faltan productIds para renombrar.');
      }
      if (!newBaseName) {
        throw new AgentError('MISSING_REQUIRED_FIELD', 'Falta el nuevo nombre.');
      }
      const result = await bulkRenameProductFamily({
        businessId: tenant.businessId,
        productIds,
        newBaseName,
      });
      if (result.updated.length !== productIds.length) {
        throw new AgentError(
          'WRITE_NOT_PERSISTED',
          'No pude renombrar esos productos. No quedó nada guardado.'
        );
      }
      // Releer BD: el mensaje de éxito solo usa nombres reales persistidos.
      const verified = await verifyRenameProductsPersisted({
        businessId: tenant.businessId,
        productIds,
        newBaseName,
      });
      await incrementWhatsappOps(tenant.businessId);
      return {
        reply: formatVerifiedRenameReply(verified.labels),
        data: {
          productIds: verified.productIds,
          recordIds: verified.productIds,
          labels: verified.labels,
          count: verified.count,
          newBaseName,
          kind: 'product',
          action: 'rename',
          persisted: true,
        },
      };
    }
    case 'adjust_stock': {
      const result = await adjustStock({
        businessId: tenant.businessId,
        productId: String(args.productId ?? ''),
        quantity: Number(args.quantity) || 0,
        reason: String(args.reason ?? 'Ajuste WhatsApp'),
        actorId: 'whatsapp',
      });
      await incrementWhatsappOps(tenant.businessId);
      return { reply: `Listo. Stock actual: *${result.stock}*.`, data: { productId: result.productId, stock: result.stock } };
    }
    case 'set_stock': {
      const result = await setStock({
        businessId: tenant.businessId,
        productId: String(args.productId ?? ''),
        stock: Number(args.stock) || 0,
        reason: String(args.reason ?? 'Ajuste WhatsApp'),
        actorId: 'whatsapp',
      });
      await incrementWhatsappOps(tenant.businessId);
      return { reply: `Listo. Stock actual: *${result.stock}*.`, data: { productId: result.productId, stock: result.stock } };
    }
    case 'register_order_payment':
    case 'register_order_deposit':
    case 'collect_order_full_balance': {
      const entities: WhatsappCommandEntities = {
        targetOrderId: String(args.orderId ?? ''),
        clientName: String(args.clientName ?? ''),
        amount: args.amount != null ? Number(args.amount) : undefined,
        payFullBalance: write.tool === 'collect_order_full_balance' || args.payFullBalance === true,
        paid: true,
        paymentKind: write.tool === 'register_order_deposit' ? 'senia' : undefined,
        idempotencyKey: String(args.idempotencyKey ?? ''),
      };
      const result = await registerPaymentFromWhatsapp(tenant, entities);
      await incrementWhatsappOps(tenant.businessId);
      return {
        reply: result.reply,
        data: { clientId: result.clientId, clientName: result.clientName, amount: result.amount, kind: 'payment' },
      };
    }
    case 'update_order_status': {
      if (!tenant?.businessId) {
        throw new AgentError('ERP_WRITE_FAILED', 'Falta businessId para ejecutar el plan congelado.');
      }
      const entities: WhatsappCommandEntities = {
        targetOrderId: String(args.orderId ?? ''),
        orderNumber: String(args.orderNumber ?? ''),
        clientName: String(args.clientName ?? ''),
        orderStatus: String(args.status ?? args.requestedStatus ?? '') as WhatsappCommandEntities['orderStatus'],
        idempotencyKey: String(args.idempotencyKey ?? ''),
      };
      const result = await updateOrderStatusFromWhatsapp(tenant, entities);
      await incrementWhatsappOps(tenant.businessId);
      return {
        reply: result.reply,
        data: {
          orderId: result.orderId,
          label: result.label,
          clientName: result.clientName,
          clientId: result.clientId,
          status: result.status,
          saldoRemaining: result.saldoRemaining,
          kind: 'order',
        },
      };
    }
    case 'register_cash_movement': {
      const expectedScope = String(args.ambitoId ?? args.cashAccountId ?? '').trim();
      const categoryLabel = String(args.categoriaLabel ?? '').trim();
      const result = await executeRegisterCashMovement(tenant, {
        businessId: tenant.businessId,
        type: String(args.type ?? 'ingreso') === 'egreso' ? 'egreso' : 'ingreso',
        amount: Number(args.amount) || 0,
        concept: String(args.concept ?? ''),
        scope: expectedScope || undefined,
        categoriaId: String(args.categoriaId ?? '').trim() || null,
        medio: String(args.medio ?? '').trim() || undefined,
        source: 'whatsapp',
        actor: { type: 'whatsapp_user', phone: tenant.phone },
        idempotencyKey: String(args.idempotencyKey ?? ''),
      });
      const persistedScope = String(result.scope ?? '').trim();
      if (expectedScope && persistedScope && expectedScope !== persistedScope) {
        console.error(
          '[CASH_SCOPE_MISMATCH]',
          JSON.stringify({
            businessId: tenant.businessId,
            expectedScope,
            persistedScope,
            movementId: result.movementId ?? null,
          })
        );
      }
      await incrementWhatsappOps(tenant.businessId);
      const tipo = String(args.type ?? 'ingreso') === 'egreso' ? 'egreso' : 'ingreso';
      const amountLabel = (Number(args.amount) || 0).toLocaleString('es-UY');
      const friendly = categoryLabel
        ? `✅ Registré un ${tipo} de $${amountLabel} en ${categoryLabel}.\nSi querés cambiar algo, decime.`
        : result.reply;
      return {
        reply: friendly,
        data: {
          kind: 'cash',
          amount: Number(args.amount) || 0,
          scope: persistedScope || expectedScope,
          movementId: result.movementId,
          categoriaId: args.categoriaId ?? null,
          categoriaLabel: categoryLabel || null,
        },
      };
    }
    case 'create_supplier': {
      const created = await createSupplier({
        businessId: tenant.businessId,
        name: String(args.name ?? ''),
        source: 'whatsapp',
      });
      await incrementWhatsappOps(tenant.businessId);
      return { reply: `Listo. Proveedor *${created.name}* creado.`, data: { supplierId: created.id } };
    }
    case 'update_supplier': {
      const updated = await updateSupplier({
        businessId: tenant.businessId,
        supplierId: String(args.supplierId ?? ''),
        name: args.name != null ? String(args.name) : undefined,
        telefono: args.telefono != null ? String(args.telefono) : undefined,
        email: args.email != null ? String(args.email) : undefined,
        notas: args.notas != null ? String(args.notas) : undefined,
      });
      await incrementWhatsappOps(tenant.businessId);
      return {
        reply: `Listo. Actualicé al proveedor *${updated.name}*.`,
        data: {
          supplierId: updated.id,
          supplierName: updated.name,
          kind: 'supplier',
          action: 'update',
          persisted: true,
          recordIds: [updated.id],
          labels: [updated.name],
        },
      };
    }
    case 'create_recurring_payable': {
      const name = String(args.name ?? '').trim();
      const amount = Number(args.amount) || 0;
      const firstDueDate = String(args.firstDueDate ?? '').trim().slice(0, 10);
      const notes = String(args.notes ?? '').trim() || undefined;
      const ambito = String(args.ambitoId ?? '').trim() || undefined;
      const { createPayable } = await import('../../domain/payables/payables-application-service.ts');
      const result = await createPayable({
        businessId: tenant.businessId,
        source: 'whatsapp',
        beneficiario: name,
        monto: amount,
        fechaVencimiento: firstDueDate,
        tipo: 'mensual',
        notas: notes,
        ambitoId: ambito,
      });
      await incrementWhatsappOps(tenant.businessId);
      const day = firstDueDate.slice(8, 10);
      const amountLabel = amount.toLocaleString('es-AR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
      return {
        reply: `Listo. Registré el gasto fijo *${name}* por *$${amountLabel}* (vence el día ${day} de cada mes). Aparece en Cuentas a pagar; el egreso de caja se registra cuando lo marques como pagado.`,
        data: {
          obligacionId: result.obligation.id,
          kind: 'recurring_payable',
          amount,
          firstDueDate,
        },
      };
    }
    case 'create_one_time_payable': {
      const name = String(args.name ?? 'Obligación').trim();
      const amount = Number(args.amount) || 0;
      const dueDate = String(args.dueDate ?? '').trim().slice(0, 10);
      const notes = String(args.notes ?? '').trim() || undefined;
      const { createPayable } = await import('../../domain/payables/payables-application-service.ts');
      const result = await createPayable({
        businessId: tenant.businessId,
        source: 'whatsapp',
        beneficiario: name,
        monto: amount,
        fechaVencimiento: dueDate,
        tipo: 'unico',
        notas: notes,
      });
      await incrementWhatsappOps(tenant.businessId);
      const amountLabel = amount.toLocaleString('es-AR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
      return {
        reply: `Listo. Registré *${name}* por *$${amountLabel}* con vencimiento ${dueDate.slice(8, 10)}/${dueDate.slice(5, 7)}. No moví caja todavía.`,
        data: {
          obligacionId: result.obligation.id,
          kind: 'payable',
          amount,
          dueDate,
        },
      };
    }
    case 'pay_payable': {
      const cuotaId = String(args.cuotaId ?? '').trim();
      const medioPagoId = String(args.paymentMethod ?? '').trim().toLowerCase() || undefined;
      const montoPago = args.amount != null ? Number(args.amount) : undefined;
      const { payPayable } = await import('../../domain/payables/payables-application-service.ts');
      const cuota = await payPayable({
        businessId: tenant.businessId,
        source: 'whatsapp',
        cuotaId,
        medioPagoId,
        montoPago,
      });
      await incrementWhatsappOps(tenant.businessId);
      const amountLabel = Number(cuota.monto || 0).toLocaleString('es-AR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
      return {
        reply: `Listo. Marqué *${cuota.beneficiario}* ($${amountLabel}) como pagado y registré el egreso en caja.`,
        data: { cuotaId: cuota.id, kind: 'payable_payment', amount: cuota.monto },
      };
    }
    case 'create_collaborator': {
      console.info('[v4:collaborator:plan]', JSON.stringify({ tool: 'create_collaborator', businessId: tenant.businessId }));
      const created = await createCollaborator({
        businessId: tenant.businessId,
        name: String(args.name ?? ''),
        telefono: String(args.telefono ?? '') || undefined,
        email: String(args.email ?? '') || undefined,
        notas: String(args.notas ?? '') || undefined,
        modalidad: args.modalidad as import('../../utils/collaborators.ts').CollaboratorModalidad | undefined,
        valorHora: args.valorHora != null ? Number(args.valorHora) : undefined,
        montoFijoPeriodo: args.montoFijoPeriodo != null ? Number(args.montoFijoPeriodo) : undefined,
        periodoReferencia: args.periodoReferencia as import('../../utils/collaborators.ts').CollaboratorPeriodoReferencia | undefined,
        source: 'whatsapp',
      });
      await incrementWhatsappOps(tenant.businessId);
      return {
        reply: `Listo. Colaborador *${created.name}* agregado.`,
        data: { collaboratorId: created.id, collaboratorName: created.name, kind: 'collaborator' },
      };
    }
    case 'update_collaborator': {
      console.info('[v4:collaborator:plan]', JSON.stringify({ tool: 'update_collaborator', businessId: tenant.businessId }));
      const updated = await updateCollaborator({
        businessId: tenant.businessId,
        colaboradorId: String(args.colaboradorId ?? ''),
        name: args.name != null ? String(args.name) : undefined,
        telefono: args.telefono != null ? String(args.telefono) : undefined,
        email: args.email != null ? String(args.email) : undefined,
        notas: args.notas != null ? String(args.notas) : undefined,
        modalidad: args.modalidad as import('../../utils/collaborators.ts').CollaboratorModalidad | undefined,
        valorHora: args.valorHora != null ? Number(args.valorHora) : undefined,
        montoFijoPeriodo: args.montoFijoPeriodo != null ? Number(args.montoFijoPeriodo) : undefined,
        periodoReferencia: args.periodoReferencia as import('../../utils/collaborators.ts').CollaboratorPeriodoReferencia | undefined,
        activo: args.activo === true || args.activo === false ? args.activo : undefined,
      });
      await incrementWhatsappOps(tenant.businessId);
      const reply =
        args.activo === false
          ? `Listo. Di de baja a *${updated.name}*.`
          : `Listo. Actualicé a *${updated.name}*.`;
      return {
        reply,
        data: { collaboratorId: updated.id, collaboratorName: updated.name, kind: 'collaborator' },
      };
    }
    case 'register_collaborator_hours': {
      console.info('[v4:collaborator:plan]', JSON.stringify({ tool: 'register_collaborator_hours', businessId: tenant.businessId }));
      const body = (args.movementBody ?? {}) as Record<string, unknown>;
      const result = await registerCollaboratorMovement({
        businessId: tenant.businessId,
        body,
        idempotencyKey: String(args.idempotencyKey ?? ''),
        source: 'whatsapp',
      });
      if (!result.duplicate) await incrementWhatsappOps(tenant.businessId);
      const horas = Number(result.movement.horas) || Number(args.hours) || 0;
      const name = String(args.collaboratorName ?? '');
      const fechaRaw = String(result.movement.fecha ?? body.fecha ?? args.date ?? '').slice(0, 10);
      const fechaLabel = /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw) ? formatPurchaseDateEs(fechaRaw) : '';
      return {
        reply: result.duplicate
          ? fechaLabel
            ? `Ese registro ya estaba cargado para *${name}* el *${fechaLabel}*.`
            : `Ese registro ya estaba cargado para *${name}*.`
          : fechaLabel
            ? `Listo. Registré *${horas} h* el *${fechaLabel}* para *${name}*.`
            : `Listo. Registré *${horas} h* para *${name}*.`,
        data: {
          collaboratorId: result.movement.colaboradorId,
          movementId: result.id,
          kind: 'collaborator_hours',
          date: fechaRaw || undefined,
        },
      };
    }
    case 'register_collaborator_extra': {
      console.info('[v4:collaborator:plan]', JSON.stringify({ tool: 'register_collaborator_extra', businessId: tenant.businessId }));
      const body = (args.movementBody ?? {}) as Record<string, unknown>;
      const result = await registerCollaboratorMovement({
        businessId: tenant.businessId,
        body,
        idempotencyKey: String(args.idempotencyKey ?? ''),
        source: 'whatsapp',
      });
      if (!result.duplicate) await incrementWhatsappOps(tenant.businessId);
      const amount = Number(result.movement.monto) || Number(args.amount) || 0;
      const name = String(args.collaboratorName ?? '');
      const amountLabel = amount.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      return {
        reply: result.duplicate
          ? `Ese extra ya estaba registrado para *${name}*.`
          : `Listo. Registré extra de *$${amountLabel}* para *${name}*.`,
        data: {
          collaboratorId: result.movement.colaboradorId,
          movementId: result.id,
          kind: 'collaborator_extra',
        },
      };
    }
    case 'register_collaborator_payment': {
      console.info('[v4:collaborator:plan]', JSON.stringify({ tool: 'register_collaborator_payment', businessId: tenant.businessId }));
      const body = (args.movementBody ?? {}) as Record<string, unknown>;
      const result = await registerCollaboratorMovement({
        businessId: tenant.businessId,
        body,
        idempotencyKey: String(args.idempotencyKey ?? ''),
        source: 'whatsapp',
      });
      if (!result.duplicate) await incrementWhatsappOps(tenant.businessId);
      const amount = Number(result.movement.monto) || Number(args.amount) || 0;
      const name = String(args.collaboratorName ?? '');
      const amountLabel = amount.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      return {
        reply: result.duplicate
          ? `Ese pago ya estaba registrado para *${name}*.`
          : `Listo. Registré pago de *$${amountLabel}* a *${name}*.`,
        data: {
          collaboratorId: result.movement.colaboradorId,
          movementId: result.id,
          movimientoCajaId: result.movimientoCajaId,
          kind: 'collaborator_payment',
        },
      };
    }
    case 'update_collaborator_movement': {
      const body = (args.movementBody ?? {}) as Record<string, unknown>;
      const updated = await updateCollaboratorMovement({
        businessId: tenant.businessId,
        movimientoId: String(args.movementId ?? ''),
        body,
      });
      await incrementWhatsappOps(tenant.businessId);
      return {
        reply: 'Listo. Actualicé el movimiento del colaborador.',
        data: { movementId: updated.id, kind: 'collaborator_movement' },
      };
    }
    case 'create_order': {
      const result = await createOrderFromWhatsapp(
        tenant,
        {
          clientId: String(args.clientId ?? ''),
          clientName: String(args.clientName ?? ''),
          notes: String(args.notes ?? '') || undefined,
          deliveryDate: String(args.deliveryDate ?? '') || undefined,
          seniaAmount: args.seniaAmount != null ? Number(args.seniaAmount) : undefined,
          items: Array.isArray(args.items) ? (args.items as WhatsappCommandEntities['items']) : undefined,
          mediaId: args.visualDraftId ? String(args.visualDraftId) : undefined,
        } as WhatsappCommandEntities,
        ''
      );
      await incrementWhatsappOps(tenant.businessId);
      return {
        reply: result.reply,
        data: {
          orderId: result.orderId,
          label: result.label,
          clientName: result.clientName,
          clientId: result.clientId,
          status: result.status,
          kind: 'order',
        },
      };
    }
    case 'create_sale': {
      const result = await createSaleFromWhatsapp(
        tenant,
        {
          clientId: String(args.clientId ?? ''),
          amount: Number(args.amount) || 0,
        } as WhatsappCommandEntities,
        ''
      );
      await incrementWhatsappOps(tenant.businessId);
      return { reply: result.reply, data: { ventaId: result.ventaId, kind: 'sale' } };
    }
    case 'create_purchase': {
      const result = await createPurchaseFromWhatsapp(
        tenant,
        {
          supplierId: String(args.supplierId ?? '') || undefined,
          supplierName: String(args.supplierName ?? args.supplierQuery ?? ''),
          amount: Number(args.amount) || 0,
          invoiceNumber: String(args.invoiceNumber ?? '') || undefined,
          orderDate: String(args.date ?? '') || undefined,
          notes: String(args.notes ?? '') || undefined,
          purchaseLines: Array.isArray(args.purchaseLines)
            ? (args.purchaseLines as WhatsappCommandEntities['purchaseLines'])
            : undefined,
          paymentMedioId: String(args.paymentMedioId ?? '') || undefined,
          paymentMedioLabel: String(args.paymentMedioLabel ?? '') || undefined,
          paymentTarjetaId: String(args.paymentTarjetaId ?? '') || undefined,
          paymentTarjetaLabel: String(args.paymentTarjetaLabel ?? '') || undefined,
          paymentCuotas: Number(args.paymentCuotas) || undefined,
          paymentDueDate: String(args.paymentDueDate ?? '') || undefined,
          cashAccountId: String(args.cashAccountId ?? '') || undefined,
          documentNetTotal: Number(args.documentNetTotal) || undefined,
          documentTaxTotal: Number(args.documentTaxTotal) || undefined,
          documentGrossTotal: Number(args.documentGrossTotal) || undefined,
          documentTaxRate: Number(args.documentTaxRate) || undefined,
          priceTaxMode:
            args.priceTaxMode === 'net' || args.priceTaxMode === 'gross' || args.priceTaxMode === 'unknown'
              ? args.priceTaxMode
              : undefined,
        } as WhatsappCommandEntities,
        ''
      );
      await incrementWhatsappOps(tenant.businessId);
      return { reply: result.reply, data: { compraId: result.compraId, kind: 'purchase' } };
    }
    case 'add_order_extra_cost': {
      const result = await addOrderCostFromWhatsapp(tenant, {
        targetOrderId: String(args.orderId ?? ''),
        amount: Number(args.amount) || 0,
        notes: String(args.concept ?? ''),
      } as WhatsappCommandEntities);
      await incrementWhatsappOps(tenant.businessId);
      return { reply: result.reply, data: { orderId: result.orderId, kind: 'order' } };
    }
    case 'update_rilo_aviso':
    case 'prepare_create_automation':
    case 'prepare_update_automation':
    case 'prepare_pause_automation':
    case 'prepare_resume_automation':
    case 'prepare_cancel_automation': {
      const result = await executeAutomationWrite(tenant, write);
      await incrementWhatsappOps(tenant.businessId);
      return result;
    }
    default:
      throw new AgentError('CAPABILITY_NOT_ENABLED', 'Esa acción todavía no está disponible por WhatsApp.');
  }
}

export async function executeAgentOperationPlan(
  tenant: ToolExecutionContext['tenant'],
  plan: AgentOperationPlan
): Promise<{ reply: string; data?: Record<string, unknown> }> {
  const replies: string[] = [];
  let lastData: Record<string, unknown> | undefined;
  for (const write of plan.writes) {
    const result = await executePlannedWrite(tenant, {
      ...write,
      args: {
        ...write.args,
        idempotencyKey: plan.idempotencyKey ? `${plan.idempotencyKey}:${write.tool}` : undefined,
      },
    });
    replies.push(result.reply);
    lastData = result.data ?? lastData;
  }
  return { reply: replies.join('\n\n'), data: lastData };
}

export function summarizeToolOutput(output: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (key === 'items' && Array.isArray(value)) {
      clone[key] = value.slice(0, 10);
      clone.itemsTruncated = value.length > 10;
      continue;
    }
    clone[key] = value;
  }
  return clone;
}
