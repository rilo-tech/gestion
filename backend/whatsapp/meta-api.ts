import crypto from 'node:crypto';

export interface WhatsappMetaConfig {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  apiVersion: string;
}

export function getWhatsappMetaConfig(): WhatsappMetaConfig | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId) return null;

  return {
    accessToken,
    phoneNumberId,
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim() ?? '',
    apiVersion: process.env.WHATSAPP_API_VERSION?.trim() || 'v21.0',
  };
}

export function isWhatsappOutboundConfigured(): boolean {
  return getWhatsappMetaConfig() !== null;
}

/** Meta espera el destinatario solo con dígitos (sin +). */
export function phoneToMetaRecipient(e164OrDigits: string): string {
  return e164OrDigits.replace(/\D/g, '');
}

export function verifyMetaWebhookSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined
): { ok: true } | { ok: false; reason: string } {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!appSecret) {
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true };
    }
    console.warn('[whatsapp] WHATSAPP_APP_SECRET no configurado; webhook sin verificación de firma.');
    return { ok: true };
  }

  if (!rawBody?.length) {
    return { ok: false, reason: 'Cuerpo sin raw body para verificar firma' };
  }

  if (!signatureHeader?.startsWith('sha256=')) {
    return { ok: false, reason: 'Cabecera X-Hub-Signature-256 ausente o inválida' };
  }

  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  try {
    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(signatureHeader, 'utf8');
    if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      return { ok: false, reason: 'Firma inválida' };
    }
  } catch {
    return { ok: false, reason: 'Firma inválida' };
  }

  return { ok: true };
}

export async function sendWhatsappText(
  toE164OrDigits: string,
  body: string
): Promise<{ ok: true; messageId?: string } | { ok: false; error: string; status?: number }> {
  const config = getWhatsappMetaConfig();
  if (!config) {
    return { ok: false, error: 'WhatsApp outbound no configurado (token o phone number id)' };
  }

  const to = phoneToMetaRecipient(toE164OrDigits);
  if (!to) {
    return { ok: false, error: 'Destinatario inválido' };
  }

  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: body.slice(0, 4096),
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[whatsapp] Meta send error', { status: response.status, body: text, to });
    return { ok: false, error: text || `HTTP ${response.status}`, status: response.status };
  }

  try {
    const payload = (await response.json()) as { messages?: Array<{ id?: string }> };
    return { ok: true, messageId: payload.messages?.[0]?.id };
  } catch {
    return { ok: true };
  }
}

export async function downloadWhatsappMedia(
  mediaId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const config = getWhatsappMetaConfig();
  const id = mediaId.trim();
  if (!config || !id) return null;

  const metaUrl = `https://graph.facebook.com/${config.apiVersion}/${id}`;
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });
  if (!metaRes.ok) {
    console.error('[whatsapp] Media metadata error', mediaId, await metaRes.text());
    return null;
  }

  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) return null;

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });
  if (!fileRes.ok) {
    console.error('[whatsapp] Media download error', mediaId, fileRes.status);
    return null;
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) return null;

  const contentType = String(meta.mime_type ?? fileRes.headers.get('content-type') ?? 'image/jpeg')
    .split(';')[0]!
    .trim()
    .toLowerCase();

  return { buffer, contentType: contentType || 'image/jpeg' };
}
