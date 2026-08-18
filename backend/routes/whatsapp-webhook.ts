import express from 'express';
import { handleWhatsappMessage } from '../whatsapp/message-handler.ts';
import {
  isWhatsappOutboundConfigured,
  sendWhatsappText,
  verifyMetaWebhookSignature,
} from '../whatsapp/meta-api.ts';

const router = express.Router();

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? 'rilo-dev-verify';

type RequestWithRawBody = express.Request & { rawBody?: Buffer };

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN && typeof challenge === 'string') {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post('/', async (req, res) => {
  const signature = req.get('x-hub-signature-256') ?? undefined;
  const rawBody =
    (req as RequestWithRawBody).rawBody ??
    (req as RequestWithRawBody & { rawBody?: Buffer }).rawBody;
  const verified = verifyMetaWebhookSignature(rawBody, signature);
  if (!verified.ok) {
    console.warn('[whatsapp] Webhook rechazado:', verified.reason);
    return res.sendStatus(403);
  }

  console.log('[whatsapp] POST recibido', {
    object: (req.body as { object?: string } | undefined)?.object ?? null,
    hasEntry: Boolean((req.body as { entry?: unknown[] } | undefined)?.entry?.length),
  });

  // Cloud Run congela el CPU al terminar el handler. Hay que await para que
  // la respuesta a WhatsApp se envíe de verdad (Meta ya recibió el 200).
  res.sendStatus(200);
  try {
    await processWhatsappNotification(req.body);
  } catch (error) {
    console.error('[whatsapp] Webhook async error:', error);
  }
});

async function processWhatsappNotification(body: unknown) {
  const payload = body as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{
            from?: string;
            type?: string;
            text?: { body?: string };
            button?: { text?: string };
            caption?: string;
            image?: { id?: string; caption?: string };
          }>;
        };
      }>;
    }>;
  };

  const entry = payload?.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];
  const fromDigits = message?.from ? String(message.from) : '';
  const from = fromDigits ? `+${fromDigits.replace(/\D/g, '')}` : null;
  const text = message?.text?.body ?? message?.button?.text ?? message?.caption ?? '';
  const imageId = message?.image?.id ? String(message.image.id) : null;
  const caption = message?.image?.caption ? String(message.image.caption) : '';
  const combinedText = String(text || caption || '').trim();

  if (!from || (!combinedText && !imageId)) {
    console.log('[whatsapp] Webhook sin mensaje de usuario', {
      hasEntry: Boolean(entry),
      type: message?.type ?? null,
    });
    return;
  }

  console.log('[whatsapp] Inbound', {
    from,
    type: message?.type ?? 'text',
    hasImage: Boolean(imageId),
    textLen: combinedText.length,
    outboundConfigured: isWhatsappOutboundConfigured(),
  });

  const result = await handleWhatsappMessage({
    from,
    text: combinedText,
    mediaId: imageId,
    mediaType: imageId ? 'image' : null,
  });

  if (!result.reply) {
    console.log('[whatsapp] Sin texto de respuesta', { intent: result.intent, from });
    return;
  }

  console.log('[whatsapp] Respuesta', {
    from,
    businessId: result.businessId ?? null,
    intent: result.intent,
    executed: result.executed,
  });

  if (!isWhatsappOutboundConfigured()) {
    console.error('[whatsapp] Token/phone id no configurados; no se envía respuesta');
    return;
  }

  const sent = await sendWhatsappText(from, result.reply);
  if (!sent.ok) {
    console.error('[whatsapp] No se pudo enviar respuesta:', sent.error);
  } else {
    console.log('[whatsapp] Enviado', { from, messageId: sent.messageId ?? null });
  }
}

/** Prueba local sin Meta: POST /api/webhooks/whatsapp/dev { phone, message, mediaId? } */
router.post('/dev', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'No disponible en producción.' });
  }

  const phone = String(req.body?.phone ?? '').trim();
  const message = String(req.body?.message ?? '').trim();
  const mediaId = req.body?.mediaId ? String(req.body.mediaId).trim() : null;
  if (!phone || (!message && !mediaId)) {
    return res.status(400).json({ error: 'phone y message (o mediaId) son obligatorios.' });
  }

  const result = await handleWhatsappMessage({
    from: phone,
    text: message,
    mediaId,
  });

  let send: Awaited<ReturnType<typeof sendWhatsappText>> | null = null;
  if (result.reply && isWhatsappOutboundConfigured()) {
    send = await sendWhatsappText(phone, result.reply);
  }

  res.json({
    ...result,
    outboundConfigured: isWhatsappOutboundConfigured(),
    send,
  });
});

export default router;
