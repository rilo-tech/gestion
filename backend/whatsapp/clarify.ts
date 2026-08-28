import { assertCanUseAi, incrementAiUsage } from '../auth/usage-gates.ts';
import { generateGeminiText } from './gemini.ts';
import { whatsappCopyForRubro } from './copy.ts';
import type { LastWhatsappOperation } from './conversation-state.ts';
import { waCard } from '../../shared/whatsapp-format.ts';

/** Lo que el bot sabe hacer, para acotar la pregunta a opciones reales. */
const CAPABILITIES = [
  'anotar un pedido',
  'anotar una venta',
  'anotar una compra a proveedor (stock, sin caja)',
  'registrar un cobro o una seña',
  'marcar un pedido como listo o entregado',
  'sumar un costo extra a un pedido',
  'anotar un gasto o ingreso de caja',
  'cambiar el costo de un producto del catálogo',
  'dar de alta un cliente',
  'consultar saldo, caja o el estado de un pedido',
];

function fallbackQuestion(text: string, rubro?: string | null): string {
  const corto = text.trim().slice(0, 60);
  const ejemplo = whatsappCopyForRubro(rubro).exampleSale;
  return waCard({
    title: 'No te seguí',
    lines: corto ? [`Con «${corto}» no me queda claro.`] : undefined,
    ask:
      `¿Es un pedido nuevo, un cobro, o algo ya anotado?\n` +
      `Ej: «${ejemplo}»`,
  });
}

/**
 * En vez de tirar el menú de ayuda, pregunta qué quiso decir ofreciendo las
 * lecturas más probables de SU mensaje.
 */
export async function askWhatYouMeant(input: {
  text: string;
  businessId?: string;
  rubro?: string | null;
  lastOperation?: LastWhatsappOperation | null;
}): Promise<string> {
  const text = String(input.text ?? '').trim();
  if (!text) return fallbackQuestion('', input.rubro);

  if (input.businessId) {
    try {
      await assertCanUseAi(input.businessId, 1);
    } catch {
      return fallbackQuestion(text, input.rubro);
    }
  }

  const lastOp = input.lastOperation
    ? `Lo último que guardamos fue ${input.lastOperation.kind} ${
        input.lastOperation.label ? `#${input.lastOperation.label}` : ''
      } de ${input.lastOperation.clientName ?? 'un cliente'}.`
    : '';

  const prompt = `Sos el operador de RILO, un ERP por WhatsApp. El dueño del negocio te escribió algo que NO entendiste.
No inventes datos ni supongas la operación: PREGUNTALE qué quiso decir.

Mensaje del dueño: «${text}»
${lastOp}
Cosas que sabés hacer: ${CAPABILITIES.join(', ')}.

Escribí la respuesta en español rioplatense, tuteando.
Reglas:
- Título en negrita de WhatsApp en la primera línea: *No te seguí* (o similar corto).
- Después viñetas • con 2 o 3 lecturas concretas de SU mensaje (nombres, montos, productos que sí dijo).
- Última línea: cómo escribirlo para que salga de una.
- Máximo 8 renglones cortos. Nada de paredes de texto.
- Nunca digas «no te seguí del todo» ni pegues un menú genérico.
- No saludes. No pidas perdón. Nunca afirmes que guardaste algo.`;

  const reply = await generateGeminiText({
    parts: [{ text: prompt }],
    label: 'clarify-unknown',
    timeoutMs: 12000,
    businessId: input.businessId,
    tool: 'clarify',
  });

  const clean = String(reply ?? '')
    .replace(/^```[a-z]*\s*|\s*```$/g, '')
    .trim();
  if (!clean) return fallbackQuestion(text, input.rubro);

  if (input.businessId) {
    try {
      await incrementAiUsage(input.businessId, 1);
    } catch (error) {
      console.warn('[whatsapp] clarify usage:', error);
    }
  }
  return clean.slice(0, 600);
}
