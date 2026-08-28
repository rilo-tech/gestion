import type { ParsedWhatsappCommand, WhatsappCommandEntities } from './ai-command-parser.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import { buildWelcomeMessage } from './onboarding.ts';
import { whatsappCopyForRubro, riloBotHelpMenu } from './copy.ts';
import { waBold, waCard } from '../../shared/whatsapp-format.ts';
import {
  createOrderFromWhatsapp,
  createPurchaseFromWhatsapp,
  createSaleFromWhatsapp,
  createClientFromWhatsapp,
  addOrderCostFromWhatsapp,
  queryBalanceFromWhatsapp,
  queryCashTodayFromWhatsapp,
  registerCashFromWhatsapp,
  registerPaymentFromWhatsapp,
  updateProductCostFromWhatsapp,
} from './erp-writes.ts';
import { updateOrderStatusFromWhatsapp } from './order-status.ts';
import { queryStatusFromWhatsapp } from './erp-queries.ts';
import { getConversationState } from './conversation-state.ts';
import {
  assertCanRunWhatsappWrite,
  formatThrownUsage,
  incrementWhatsappOps,
} from '../auth/usage-gates.ts';

export interface ErpIntegrationResult {
  reply: string;
  executed: boolean;
  intent: string;
  data?: Record<string, unknown>;
}

function entitiesOf(parsed: ParsedWhatsappCommand): WhatsappCommandEntities {
  return 'entities' in parsed ? (parsed.entities ?? {}) : {};
}

function rawOf(parsed: ParsedWhatsappCommand): string {
  return 'raw' in parsed && typeof parsed.raw === 'string' ? parsed.raw : '';
}

function greetingReply(userName?: string, rubro?: string | null): string {
  return buildWelcomeMessage(userName, false, rubro);
}

function helpReply(_text: string, _rubro?: string | null, erpWeb = false): string {
  const extra = erpWeb ? `\n\nEl catálogo completo y los reportes: RILO Gestión.` : '';
  return riloBotHelpMenu() + extra;
}

/** Ejecuta la intención contra el ERP del negocio del teléfono autorizado. */
export async function executeWhatsappCommand(
  tenant: WhatsappTenantContext,
  parsed: ParsedWhatsappCommand
): Promise<ErpIntegrationResult> {
  const intent = parsed.intent;
  const raw = rawOf(parsed);

  if (intent === 'greeting') {
    return {
      executed: false,
      intent,
      reply: greetingReply(tenant.userName, tenant.rubro),
    };
  }

  if (intent === 'help') {
    return {
      executed: false,
      intent,
      reply: helpReply(raw, tenant.rubro, tenant.platformAccess.erpWebEnabled),
    };
  }

  if (intent === 'unknown') {
    return {
      executed: false,
      intent,
      reply: waCard({
        title: 'No te seguí',
        lines: [
          `Ej: «${whatsappCopyForRubro(tenant.rubro).exampleSale}»`,
          '• Compra: foto del remito',
          '• Audio corto',
        ],
        ask: `O escribí ${waBold('consultame')}.`,
      }),
    };
  }

  try {
    const entities = entitiesOf(parsed);
    const isWrite = [
      'create_order',
      'create_sale',
      'create_purchase',
      'register_payment',
      'register_cash',
      'create_client',
      'register_cost',
      'update_product_cost',
      'update_order_status',
    ].includes(intent);
    if (isWrite) {
      await assertCanRunWhatsappWrite(tenant.businessId);
    }

    if (intent === 'create_order') {
      const result = await createOrderFromWhatsapp(tenant, entities, raw);
      await incrementWhatsappOps(tenant.businessId);
      return {
        executed: true,
        intent,
        reply: result.reply,
        data: {
          orderId: result.orderId,
          recordId: result.orderId,
          kind: 'order',
          label: result.label,
          clientName: result.clientName,
          amount: result.amount,
        },
      };
    }

    if (intent === 'create_sale') {
      const result = await createSaleFromWhatsapp(tenant, entities, raw);
      await incrementWhatsappOps(tenant.businessId);
      return {
        executed: true,
        intent,
        reply: result.reply,
        data: {
          ventaId: result.ventaId,
          recordId: result.ventaId,
          kind: 'sale',
          label: result.label,
          clientName: result.clientName,
          amount: result.amount,
        },
      };
    }

    if (intent === 'create_purchase') {
      const result = await createPurchaseFromWhatsapp(tenant, entities, raw);
      await incrementWhatsappOps(tenant.businessId);
      return {
        executed: true,
        intent,
        reply: result.reply,
        data: {
          compraId: result.compraId,
          recordId: result.compraId,
          kind: 'purchase',
          label: result.label,
          clientName: result.clientName,
          amount: result.amount,
          draft: result.draft === true,
        },
      };
    }

    if (intent === 'update_order_status') {
      const result = await updateOrderStatusFromWhatsapp(tenant, entities);
      await incrementWhatsappOps(tenant.businessId);
      return {
        executed: true,
        intent,
        reply: result.reply,
        data: {
          orderId: result.orderId,
          recordId: result.orderId,
          kind: 'order',
          label: result.label,
          clientName: result.clientName,
          amount: result.amount,
        },
      };
    }

    if (intent === 'register_payment') {
      const result = await registerPaymentFromWhatsapp(tenant, entities);
      await incrementWhatsappOps(tenant.businessId);
      return {
        executed: true,
        intent,
        reply: result.reply,
        data: {
          recordId: result.clientId,
          kind: 'payment',
          clientName: result.clientName,
          amount: result.amount,
        },
      };
    }

    if (intent === 'query_balance') {
      const result = await queryBalanceFromWhatsapp(tenant, entities);
      return { executed: true, intent, reply: result.reply };
    }

    if (intent === 'query_cash') {
      const result = await queryCashTodayFromWhatsapp(tenant, entities);
      return { executed: true, intent, reply: result.reply };
    }

    if (intent === 'query_status') {
      const state = await getConversationState(tenant.businessId, tenant.phone);
      const result = await queryStatusFromWhatsapp(tenant, entities, state?.lastOperation);
      return { executed: true, intent, reply: result.reply };
    }

    if (intent === 'register_cash') {
      const result = await registerCashFromWhatsapp(tenant, entities);
      await incrementWhatsappOps(tenant.businessId);
      return { executed: true, intent, reply: result.reply };
    }

    if (intent === 'register_cost') {
      const result = await addOrderCostFromWhatsapp(tenant, entities);
      await incrementWhatsappOps(tenant.businessId);
      return {
        executed: true,
        intent,
        reply: result.reply,
        data: {
          orderId: result.orderId,
          recordId: result.orderId,
          kind: 'order',
          label: result.label,
          clientName: result.clientName,
          amount: result.amount,
        },
      };
    }

    if (intent === 'update_product_cost') {
      const result = await updateProductCostFromWhatsapp(tenant, entities);
      await incrementWhatsappOps(tenant.businessId);
      return {
        executed: true,
        intent,
        reply: result.reply,
        data: {
          recordId: result.productId,
          label: result.productName,
          amount: result.amount,
        },
      };
    }

    if (intent === 'create_client') {
      const created = await createClientFromWhatsapp(tenant.businessId, String(entities.clientName ?? ''), {
        telefono: entities.clientPhone,
      });
      await incrementWhatsappOps(tenant.businessId);
      return {
        executed: true,
        intent,
        reply: entities.clientPhone?.trim()
          ? `Listo. Registré a ${created.nombre} (${entities.clientPhone.trim()}).`
          : `Listo. Registré a ${created.nombre}.`,
        data: { clientId: created.id, recordId: created.id, kind: 'client', clientName: created.nombre },
      };
    }

    return {
      executed: false,
      intent,
      reply: 'No pude procesar esa operación.',
    };
  } catch (error) {
    const message = await formatThrownUsage(error, tenant.businessId);
    console.error('[whatsapp] ERP write error:', error);
    return {
      executed: false,
      intent,
      reply: message,
    };
  }
}
