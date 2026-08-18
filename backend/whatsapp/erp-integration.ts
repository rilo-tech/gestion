import type { ParsedWhatsappCommand, WhatsappCommandEntities } from './ai-command-parser.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';
import { buildWelcomeMessage } from './onboarding.ts';
import { whatsappCopyForRubro } from './copy.ts';
import {
  createOrderFromWhatsapp,
  createPurchaseFromWhatsapp,
  createSaleFromWhatsapp,
  queryBalanceFromWhatsapp,
  queryCashTodayFromWhatsapp,
  registerCashFromWhatsapp,
  registerPaymentFromWhatsapp,
} from './erp-writes.ts';
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

function helpReply(text: string, rubro?: string | null, erpWeb = false): string {
  const copy = whatsappCopyForRubro(rubro);
  const aboutProducts = /\b(productos?|cat[aá]logo|stock|qu[eé] vend)/i.test(text);
  if (aboutProducts) {
    const keepAsSaid = copy.hasProductExamples
      ? `Así «${copy.exampleProduct.replace(/\s*\$[\d.]+$/, '')}» queda como está; si hay dos parecidos, detallá lo que los diferencia.\n\n`
      : `Si hay dos parecidos, detallá lo que los diferencia.\n\n`;
    return (
      `Los productos los nombrás al registrar, no hace falta una lista acá.\n\n` +
      `${copy.productHint}\n` +
      keepAsSaid +
      `Ejemplo: «${copy.exampleSale}».\n` +
      `Si no está, te pregunto si la creo (sin control de stock).\n\n` +
      `Compras: mandá la foto de la factura o remito. Si decís cómo pagó (efectivo, transferencia, tarjeta), se registra igual que en el panel y suma stock. Si el pago no está claro, queda un borrador para completar en Compras.\n` +
      `Catálogo completo y reportes: panel web.\n` +
      `Otra duda: escribí Consultame.`
    );
  }
  return (
    `Funciono así: me escribís, armo el resumen, confirmás con SÍ o NO.\n\n` +
    `• ${copy.exampleSale}\n` +
    `• ${copy.exampleOrder}\n` +
    `• Compra a Distribuidora López, 10 remeras a $800, pagó efectivo\n` +
    `• Foto de la factura/remito del proveedor (si falta el pago, queda borrador en el panel)\n` +
    `• Pago de Pedro Gómez 500\n` +
    `• Saldo de Ana / Caja de hoy\n\n` +
    `Con clientes: si hay varias Marías te listo las opciones. Silva no es Silveira: no asumo. Si no existe, te pregunto si lo registrás.\n` +
    `Para un pedido: cliente, producto con detalle, precio y fecha de entrega. La fecha de carga, si no la decís, queda hoy.\n` +
    `${copy.productHint}\n` +
    `La caja arranca en $0; productos y clientes se crean cuando los usás. Si querés cargar un saldo inicial o un listado, escribí Configurar.\n` +
    (erpWeb
      ? `Reportes y el resto del catálogo: en el panel web. Las compras por acá, con el medio de pago, también suman stock.\n`
      : `Las compras (texto o foto) se registran acá: si el pago está claro, suman stock; si no, quedan en borrador.\n`) +
    `Cuando tengas una duda, escribí Consultame.`
  );
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
      reply:
        `No te seguí del todo.\n\n` +
        `Podés decirme por ejemplo «${whatsappCopyForRubro(tenant.rubro).exampleSale}», «compra a un proveedor» o mandar la foto del remito.\n` +
        `Si tenés dudas, escribí Consultame.`,
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
        data: { orderId: result.orderId },
      };
    }

    if (intent === 'create_sale') {
      const result = await createSaleFromWhatsapp(tenant, entities, raw);
      await incrementWhatsappOps(tenant.businessId);
      return {
        executed: true,
        intent,
        reply: result.reply,
        data: { ventaId: result.ventaId },
      };
    }

    if (intent === 'create_purchase') {
      const result = await createPurchaseFromWhatsapp(tenant, entities, raw);
      await incrementWhatsappOps(tenant.businessId);
      return {
        executed: true,
        intent,
        reply: result.reply,
        data: { compraId: result.compraId, draft: result.draft === true },
      };
    }

    if (intent === 'register_payment') {
      const result = await registerPaymentFromWhatsapp(tenant, entities);
      await incrementWhatsappOps(tenant.businessId);
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
      await incrementWhatsappOps(tenant.businessId);
      return { executed: true, intent, reply: result.reply };
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
