import express from 'express';
import { handleWhatsappMessage } from '../whatsapp/message-handler.ts';

const router = express.Router();

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? 'rilo-dev-verify';

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
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    const from = message?.from ? `+${String(message.from)}` : null;
    const text = message?.text?.body ?? message?.button?.text ?? '';

    if (!from || !text) {
      return res.sendStatus(200);
    }

    const result = await handleWhatsappMessage({ from, text: String(text) });

    if (result.reply) {
      console.log('[whatsapp] Respuesta', {
        businessId: result.businessId,
        intent: result.intent,
        executed: result.executed,
        reply: result.reply,
      });
      // Envío real vía Meta Cloud API: integrar sendWhatsappText() cuando haya token de producción.
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('[whatsapp] Webhook error:', error);
    res.sendStatus(200);
  }
});

/** Prueba local sin Meta: POST /api/webhooks/whatsapp/dev { phone, message } */
router.post('/dev', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'No disponible en producción.' });
  }

  const phone = String(req.body?.phone ?? '').trim();
  const message = String(req.body?.message ?? '').trim();
  if (!phone || !message) {
    return res.status(400).json({ error: 'phone y message son obligatorios.' });
  }

  const result = await handleWhatsappMessage({ from: phone, text: message });
  res.json(result);
});

export default router;
