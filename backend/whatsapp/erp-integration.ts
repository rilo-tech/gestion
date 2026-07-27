import type { ParsedWhatsappCommand, WhatsappCommandEntities } from './ai-command-parser.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import {
  createOrderFromWhatsapp,
  createSaleFromWhatsapp,
  queryBalanceFromWhatsapp,
  queryCashTodayFromWhatsapp,
  registerCashFromWhatsapp,
  registerPaymentFromWhatsapp,
} from './erp-writes.ts';

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
  return 'raw' in parsed ? parsed.raw : '';
}

/** Ejecuta la intención contra el ERP del negocio del teléfono autorizado. */
export async function executeWhatsappCommand(
  tenant: WhatsappTenantContext,
  parsed: ParsedWhatsappCommand
): Promise<ErpIntegrationResult> {
  const intent = parsed.intent;

  if (intent === 'greeting') {
    return {
      executed: false,
      intent,
      reply: `Hola${tenant.userName ? ` ${tenant.userName}` : ''}. Soy RiloBot. Pedidos, ventas, cobros, saldos y caja. Si el cliente o producto no existe, te ofrezco crearlo. Confirmás siempre con SÍ.`,
    };
  }

  if (intent === 'help') {
    return {
      executed: false,
      intent,
      reply:
        'Así funciona RiloBot:\n1) Escribís como hablás\n2) Te muestro un resumen\n3) Confirmás con SÍ o NO\n\nEjemplos:\n• "Venta a María, 2 remeras, cobró 800"\n• "Pedido para Juan $5000"\n• "Pago de Pedro 500"\n• "Saldo de Ana"\n• "Caja de hoy" / "Cuánto vendí hoy"\n• "Gasto 500 nafta"\n• Foto + "pedido para Juan"\n\nSi el cliente o producto no está, te pregunto si lo creo (productos sin control de stock).\nStock, compras y proveedores: solo en el panel web.',
    };
  }

  if (intent === 'unknown') {
    return {
      executed: false,
      intent,
      reply: 'No entendí el mensaje. Escribí "ayuda" para ver ejemplos.',
    };
  }

  try {
    const entities = entitiesOf(parsed);
    const raw = rawOf(parsed);

    if (intent === 'create_order') {
      const result = await createOrderFromWhatsapp(tenant, entities, raw);
      return {
        executed: true,
        intent,
        reply: result.reply,
        data: { orderId: result.orderId },
      };
    }

    if (intent === 'create_sale') {
      const result = await createSaleFromWhatsapp(tenant, entities, raw);
      return {
        executed: true,
        intent,
        reply: result.reply,
        data: { ventaId: result.ventaId },
      };
    }

    if (intent === 'register_payment') {
      const result = await registerPaymentFromWhatsapp(tenant, entities);
      return { executed: true, intent, reply: result.reply };
    }

    if (intent === 'query_balance') {
      const result = await queryBalanceFromWhatsapp(tenant, entities);
      return { executed: true, intent, reply: result.reply };
    }

    if (intent === 'query_cash') {
      const result = await queryCashTodayFromWhatsapp(tenant);
      return { executed: true, intent, reply: result.reply };
    }

    if (intent === 'register_cash') {
      const result = await registerCashFromWhatsapp(tenant, entities);
      return { executed: true, intent, reply: result.reply };
    }

    return {
      executed: false,
      intent,
      reply: 'No pude procesar esa operación.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al registrar en el ERP.';
    console.error('[whatsapp] ERP write error:', error);
    return {
      executed: false,
      intent,
      reply: message,
    };
  }
}
