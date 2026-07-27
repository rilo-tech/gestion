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
  try {
    const signature = req.get('x-hub-signature-256') ?? undefined;
    const verified = verifyMetaWebhookSignature((req as RequestWithRawBody).rawBody, signature);
    if (!verified.ok) {
      console.warn('[whatsapp] Webhook rechazado:', verified.reason);
      return res.sendStatus(403);
    }

    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    const from = message?.from ? `+${String(message.from)}` : null;
    const text = message?.text?.body ?? message?.button?.text ?? message?.caption ?? '';
    const imageId = message?.image?.id ? String(message.image.id) : null;
    const caption = message?.image?.caption ? String(message.image.caption) : '';
    const combinedText = String(text || caption || '').trim();

    if (!from || (!combinedText && !imageId)) {
      return res.sendStatus(200);
    }

    const result = await handleWhatsappMessage({
      from,
      text: combinedText,
      mediaId: imageId,
      mediaType: imageId ? 'image' : null,
    });

    if (result.reply) {
      console.log('[whatsapp] Respuesta', {
        businessId: result.businessId,
        intent: result.intent,
        executed: result.executed,
        reply: result.reply,
        outboundConfigured: isWhatsappOutboundConfigured(),
      });

      if (isWhatsappOutboundConfigured()) {
        const sent = await sendWhatsappText(from, result.reply);
        if (!sent.ok) {
          console.error('[whatsapp] No se pudo enviar respuesta:', sent.error);
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('[whatsapp] Webhook error:', error);
    res.sendStatus(200);
  }
});

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
