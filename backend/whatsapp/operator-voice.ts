import { assertCanUseAi, incrementAiUsage } from '../auth/usage-gates.ts';
import { generateGeminiText } from './gemini.ts';
import { isThanksText } from '../../shared/whatsapp-copy.ts';

const SKIP_INTENTS = new Set([
  'empty',
  'account_offboarded',
  'ai_quota',
  'wa_quota',
  'audio_too_long',
  'audio_unreadable',
  'help',
  'help_topic',
  'greeting',
]);

/** Pregunta al margen mientras esperamos un número / SÍ / NO. */
export function looksLikePendingQuestion(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (/^(si|sí|ok|dale|confirmo|confirmar|yes|y)$/i.test(t)) return false;
  if (/^(no+|n[oó]|nop|cancelar|cancel|n)\s*[.!]*$/i.test(t)) return false;
  if (/^\d{1,2}$/.test(t)) return false;
  if (/^(el\s+)?(primero|segundo|tercero|ultimo|último)$/i.test(t)) return false;
  if (/^[¿?]/.test(t) || /[¿?]/.test(t)) return true;
  return /\b(est[aá]n?\s+registrad|son los que|hay un(?:a)?\s+(?:cliente|producto|solo)|cu[aá]l de (?:estos|esas|ellos)|qu[eé] significa|me explic[aá]s?|es solo|existe (?:uno|alguna)|est[aá]n en (?:el )?cat[aá]logo|son todos)\b/i.test(
    t
  );
}

export function isTrivialWhatsappTurn(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return true;
  if (/^(si|sí|ok|dale|confirmo|confirmar|yes|y)$/i.test(t)) return true;
  if (/^(no+|n[oó]|nop|cancelar|cancel|n)\s*[.!]*$/i.test(t)) return true;
  if (/^\d{1,2}$/.test(t)) return true;
  if (/^(hola|holaa+|buenas|hey|hello)[\s!¡?.]*$/i.test(t)) return true;
  if (isThanksText(t)) return true;
  return false;
}

function looksLikeForm(draft: string): boolean {
  return (
    /\bResumen\s+—/i.test(draft) ||
    /\bRegistrar (PEDIDO|VENTA|COMPRA|COBRO|CLIENTE|COSTO)/i.test(draft) ||
    /\bPara un pedido pasame:/i.test(draft) ||
    /\bPara anotar la compra\b/i.test(draft) ||
    /\bManual de RILO Bot\b/i.test(draft) ||
    /\bEl pago lo cargás\b/i.test(draft) ||
    /\bÍtems \d+–\d+\b/i.test(draft) ||
    /\bLeí la boleta\b/i.test(draft) ||
    /\bno (?:los )?reconozco\b/i.test(draft) ||
    /\bQuedan \d+\b/i.test(draft) ||
    /\bvincularlo(?: al catálogo)? o descartarlo\b/i.test(draft) ||
    /\bno parece un producto\b/i.test(draft) ||
    /\bEn la boleta\b/i.test(draft) ||
    /\bCómo responder\b/i.test(draft) ||
    /\bEj:\s+/i.test(draft) ||
    /\bEn qué caja anoto\b/i.test(draft) ||
    /\bQu[eé] puedo hacer\b/i.test(draft)
  );
}

function looksLikeChoiceList(draft: string): boolean {
  const numbered = draft.match(/^\d+[).]/gm);
  return Boolean(numbered && numbered.length >= 2);
}

/** Reescribe el mensaje para que suene a una persona, sin inventar datos. */
export async function speakLikeOperator(input: {
  userText?: string;
  draft: string;
  intent?: string;
  businessId?: string;
  /** true si la operación ya quedó guardada en el ERP. */
  saved?: boolean;
}): Promise<string> {
  const draft = String(input.draft ?? '').trim();
  if (!draft) return draft;
  if (input.intent && SKIP_INTENTS.has(input.intent)) return draft;
  if (looksLikeForm(draft) || looksLikeChoiceList(draft)) return draft;
  if (String(input.intent ?? '').startsWith('select_')) return draft;
  if (isTrivialWhatsappTurn(input.userText ?? '') && !looksLikeForm(draft) && draft.length < 220) {
    return draft;
  }

  if (input.businessId) {
    try {
      await assertCanUseAi(input.businessId, 1);
    } catch {
      return draft;
    }
  }

  try {
    const prompt = `Sos RILO, la persona que anota pedidos por WhatsApp en un negocio chico (Uruguay/Argentina). Hablás de vos, breve, natural, rioplatense. No sos un bot ni un formulario.

Reescribí el BORRADOR para mandárselo al dueño. El dueño acaba de escribir: ${JSON.stringify(input.userText || '')}

Reglas estrictas:
- Podés arrancar con un resumen corto de lo que el dueño acaba de escribir (cliente, precio, descripción). No agregues nada que él no haya dicho y no esté en el borrador.
- No inventes clientes, productos, precios, fechas ni números de pedido.
- Conservá TODAS las opciones numeradas (1) 2) 3)) con los mismos nombres, precios y el mismo número.
- UNA sola pregunta: la del borrador. Si el borrador pide elegir de una lista, pedí SOLO eso.
- La ÚLTIMA línea del borrador dice cómo contestar: copiala tal cual, no le agregues ni le saques opciones.
- NO agregues «¿lo guardo?», SÍ, NO, LISTO ni CREAR si el borrador no los tiene. Nada de mezclar pasos.
${
  input.saved
    ? '- Ya quedó guardado: podés decir «Listo, lo guardé» y el número si está en el borrador.'
    : '- Todavía NO guardaste nada: no digas «Anoté», «registré» ni «guardé». Si resumís lo que entendiste, decí «Para anotar…» o «Tengo…».'
}
- No saludes ni digas «¡Hola!».
- Sacá tono de sistema: nada de «Resumen —», «Registrar PEDIDO», «transacción», «entidades».
- Máximo 8 líneas. Podés usar •.
- Devolvé SOLO el texto de WhatsApp, sin comillas ni markdown de bloque.

Borrador:
${draft}`;

    const generated = await generateGeminiText({
      parts: [{ text: prompt }],
      timeoutMs: 10000,
      label: 'operator voice',
      businessId: input.businessId,
      tool: 'voice',
    });
    const spoken = String(generated ?? '')
      .trim()
      .replace(/^```(?:text|markdown)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    if (!spoken || spoken.length < 8) return draft;
    if (input.businessId) {
      try {
        await incrementAiUsage(input.businessId, 1);
      } catch (error) {
        console.warn('[whatsapp] operator voice usage:', error);
      }
    }
    return spoken.slice(0, 1400);
  } catch (error) {
    console.warn('[whatsapp] operator voice fallback:', error);
    return draft;
  }
}

/** Contesta una pregunta sin avanzar el flujo; el caller vuelve a pegar las opciones. */
export async function answerWhileWaiting(input: {
  businessId?: string;
  userText: string;
  waitingFor: string;
  options: string;
}): Promise<string> {
  const fallback =
    'Sí, te contesto y después seguimos. Elegí un número (o SÍ/NO si te lo pedí) para no perder el pedido.';

  if (input.businessId) {
    try {
      await assertCanUseAi(input.businessId, 1);
    } catch {
      return fallback;
    }
  }

  try {
    const prompt = `Sos RILO, anotas pedidos por WhatsApp (Uruguay/Argentina). El dueño preguntó ALGO mientras estábamos eligiendo. Contestá la pregunta y dejá claro que después tiene que elegir.

Qué estábamos esperando: ${JSON.stringify(input.waitingFor)}
Pregunta: ${JSON.stringify(input.userText)}
Opciones / resumen (usá SOLO esto, no inventes otros clientes ni productos):
${input.options}

Reglas:
- Respondé en 1-4 líneas, rioplatense, de vos.
- Si pregunta si X está registrado y X está en la lista, decí que sí y el número. Si no está, decí que no y que puede usar «Registrar nuevo».
- NO elijas por él. NO digas que ya quedó confirmado.
- NO copies de nuevo toda la lista numerada: va aparte después.
- Devolvé SOLO el texto, sin comillas.

Texto:`;
    const generated = await generateGeminiText({
      parts: [{ text: prompt }],
      timeoutMs: 10000,
      label: 'pending question',
      businessId: input.businessId,
      tool: 'voice',
    });
    const spoken = String(generated ?? '')
      .trim()
      .replace(/^```(?:text|markdown)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    if (input.businessId) {
      try {
        await incrementAiUsage(input.businessId, 1);
      } catch (error) {
        console.warn('[whatsapp] pending question usage:', error);
      }
    }
    if (!spoken || spoken.length < 8) return fallback;
    return spoken.slice(0, 900);
  } catch (error) {
    console.warn('[whatsapp] pending question fallback:', error);
    return fallback;
  }
}
