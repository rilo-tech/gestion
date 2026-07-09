import type { ParsedWhatsappCommand } from './ai-command-parser.ts';
import type { WhatsappTenantContext } from './tenant-resolver.ts';

export interface ErpIntegrationResult {
  reply: string;
  executed: boolean;
  intent: string;
  data?: Record<string, unknown>;
}

/** Puente hacia ERP Core: por ahora responde y registra intención (sin mutar datos). */
export async function executeWhatsappCommand(
  tenant: WhatsappTenantContext,
  parsed: ParsedWhatsappCommand
): Promise<ErpIntegrationResult> {
  const intent = parsed.intent;

  if (intent === 'greeting') {
    return {
      executed: false,
      intent,
      reply: `Hola${tenant.userName ? ` ${tenant.userName}` : ''}. Soy RiloBot. Podés pedirme cargar un pedido, venta o consultar saldos.`,
    };
  }

  if (intent === 'help') {
    return {
      executed: false,
      intent,
      reply:
        'Comandos: "nuevo pedido para Juan", "venta a María", "pago de $500", "saldo de Pedro". Siempre te pido confirmación antes de guardar.',
    };
  }

  if (intent === 'unknown') {
    return {
      executed: false,
      intent,
      reply: 'No entendí el mensaje. Escribí "ayuda" para ver ejemplos.',
    };
  }

  return {
    executed: false,
    intent,
    reply: `Entendí: ${intent}. (Simulación — confirmación pendiente de implementar en ERP Core).`,
    data: {
      businessId: tenant.businessId,
      phone: tenant.phone,
      raw: 'raw' in parsed ? parsed.raw : undefined,
    },
  };
}
