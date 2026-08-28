import express from 'express';
import { handleWhatsappMessage } from '../whatsapp/message-handler.ts';
import {
  isWhatsappOutboundConfigured,
  sendWhatsappText,
  sendWhatsappTexts,
  verifyMetaWebhookSignature,
} from '../whatsapp/meta-api.ts';
import { incrementUsageField } from '../auth/usage-meter.ts';

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

  // Cloud Run congela el CPU apenas se envía el 200. Hay que procesar ANTES
  // de responder, si no el lookup del teléfono timeout-ea y parece "no registrado".
  const inboundId = inboundMessageId(req.body);
  if (inboundId && !claimInboundMessage(inboundId)) {
    return res.sendStatus(200);
  }

  try {
    await processWhatsappNotification(req.body);
    completeInboundMessage(inboundId);
  } catch (error) {
    console.error('[whatsapp] Webhook async error:', error);
  }
  return res.sendStatus(200);
});

const recentInboundIds = new Map<string, { at: number; done: boolean }>();
const INBOUND_DEDUP_MS = 10 * 60 * 1000;
const INBOUND_STALE_MS = 20 * 1000;

function inboundMessageId(body: unknown): string | null {
  const payload = body as {
    entry?: Array<{
      changes?: Array<{ value?: { messages?: Array<{ id?: string }> } }>;
    }>;
  };
  const id = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function claimInboundMessage(id: string): boolean {
  const now = Date.now();
  for (const [key, claim] of recentInboundIds) {
    if (now - claim.at > INBOUND_DEDUP_MS) recentInboundIds.delete(key);
  }
  const prev = recentInboundIds.get(id);
  if (prev?.done) return false;
  if (prev && now - prev.at < INBOUND_STALE_MS) return false;
  recentInboundIds.set(id, { at: now, done: false });
  return true;
}

function completeInboundMessage(id: string | null) {
  if (!id) return;
  const prev = recentInboundIds.get(id);
  if (prev) recentInboundIds.set(id, { at: prev.at, done: true });
}

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
            audio?: { id?: string; mime_type?: string; voice?: boolean };
            voice?: { id?: string; mime_type?: string };
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
  const audioId = message?.audio?.id
    ? String(message.audio.id)
    : message?.voice?.id
      ? String(message.voice.id)
      : null;
  const caption = message?.image?.caption ? String(message.image.caption) : '';
  const combinedText = String(text || caption || '').trim();
  const mediaId = imageId || audioId;
  const mediaType = imageId ? 'image' : audioId ? 'audio' : null;

  if (!from || (!combinedText && !mediaId)) {
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
    hasAudio: Boolean(audioId),
    textLen: combinedText.length,
    outboundConfigured: isWhatsappOutboundConfigured(),
  });

  try {
    const result = await handleWhatsappMessage({
      from,
      text: combinedText,
      mediaId,
      mediaType,
    });

    if (result.businessId) {
      void incrementUsageField(result.businessId, 'waInbound', 1).catch((error) =>
        console.warn('[whatsapp] inbound meter:', error)
      );
    }

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

    const outbound = result.replies?.length ? result.replies : [result.reply];
    const sent = await sendWhatsappTexts(from, outbound);
    if (!sent.ok) {
      if (sent.error.includes('131030')) {
        console.error(
          '[whatsapp] Meta no deja enviar: el destinatario no está en la lista de prueba (131030)',
          { from, intent: result.intent }
        );
      } else {
        console.error('[whatsapp] No se pudo enviar respuesta:', sent.error);
      }
    } else {
      console.log('[whatsapp] Enviado', { from, messageId: sent.messageId ?? null });
      if (result.businessId) {
        void incrementUsageField(result.businessId, 'waOutbound', outbound.length).catch((error) =>
          console.warn('[whatsapp] outbound meter:', error)
        );
      }
    }
  } catch (error) {
    console.error('[whatsapp] Handler error:', error);
    if (!isWhatsappOutboundConfigured()) return;
    const sent = await sendWhatsappText(
      from,
      'Tuve un problema procesando tu mensaje. Escribime de nuevo en un momento.'
    );
    if (!sent.ok) {
      console.error('[whatsapp] No se pudo enviar fallback:', sent.error);
    }
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
  const mediaType =
    req.body?.mediaType === 'audio' || req.body?.mediaType === 'image'
      ? String(req.body.mediaType)
      : mediaId
        ? 'image'
        : null;
  if (!phone || (!message && !mediaId)) {
    return res.status(400).json({ error: 'phone y message (o mediaId) son obligatorios.' });
  }

  const result = await handleWhatsappMessage({
    from: phone,
    text: message,
    mediaId,
    mediaType,
  });

  let send: Awaited<ReturnType<typeof sendWhatsappTexts>> | null = null;
  if (result.reply && isWhatsappOutboundConfigured()) {
    send = await sendWhatsappTexts(phone, result.replies?.length ? result.replies : [result.reply]);
  }

  res.json({
    ...result,
    outboundConfigured: isWhatsappOutboundConfigured(),
    send,
  });
});

export default router;
