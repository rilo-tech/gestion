const DEFAULT_FROM = 'RILO Gestión <onboarding@resend.dev>';

export function isTrialEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** En producción o con TRIAL_EMAIL_SEND_IN_DEV=true se intenta envío real (Resend). */
export function trialEmailDeliveryRequired(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.TRIAL_EMAIL_SEND_IN_DEV === 'true'
  );
}

/**
 * Resuelve API key. En local, si pedís envío real pero no hay key,
 * cae a modo desarrollo (código en consola/pantalla) en lugar de romper el registro.
 */
function resolveTrialEmailApiKey(): { apiKey: string; forceDevFallback: boolean } {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? '';
  if (apiKey) return { apiKey, forceDevFallback: false };

  if (process.env.NODE_ENV === 'production') {
    throw new Error('EMAIL_NOT_CONFIGURED');
  }

  if (trialEmailDeliveryRequired()) {
    console.warn(
      '[trial-email] TRIAL_EMAIL_SEND_IN_DEV=true pero falta RESEND_API_KEY — usando código en pantalla (dev).'
    );
  }
  return { apiKey: '', forceDevFallback: true };
}

export async function sendTrialSignupCodeEmail(
  to: string,
  code: string
): Promise<{ sent: boolean; devOnly: boolean }> {
  const { apiKey } = resolveTrialEmailApiKey();
  const from = process.env.TRIAL_EMAIL_FROM?.trim() || DEFAULT_FROM;
  const subject = `${code} — código de verificación RILO Gestión`;
  const html = `
    <p>Hola,</p>
    <p>Tu código para activar la prueba gratuita de <strong>RILO Gestión</strong> es:</p>
    <p style="font-size:28px;font-weight:bold;letter-spacing:4px;margin:24px 0">${code}</p>
    <p>Vence en 10 minutos. Si no pediste este código, ignorá este mensaje.</p>
  `.trim();

  if (!apiKey) {
    console.log(`[trial-email] signup-code to=${to} code=${code} (RESEND_API_KEY no configurada)`);
    return { sent: false, devOnly: true };
  }

  return sendResendEmail(apiKey, { from, to, subject, html });
}

export async function sendTrialEmailVerificationLink(
  to: string,
  url: string
): Promise<{ sent: boolean; devOnly: boolean }> {
  const { apiKey } = resolveTrialEmailApiKey();
  const from = process.env.TRIAL_EMAIL_FROM?.trim() || DEFAULT_FROM;
  const subject = 'Confirmá tu email — RILO Gestión';
  const html = `
    <p>Hola,</p>
    <p>Confirmá tu email para <strong>RILO Gestión</strong>:</p>
    <p><a href="${url}">Verificar email</a></p>
    <p style="color:#666;font-size:12px">Si el botón no funciona, copiá este enlace: ${url}</p>
  `.trim();

  if (!apiKey) {
    console.log(`[trial-email] verify-link to=${to} url=${url} (RESEND_API_KEY no configurada)`);
    return { sent: false, devOnly: true };
  }

  return sendResendEmail(apiKey, { from, to, subject, html });
}

async function sendResendEmail(
  apiKey: string,
  message: { from: string; to: string; subject: string; html: string }
): Promise<{ sent: boolean; devOnly: boolean }> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[trial-email] Resend error:', response.status, detail);

    // En local / con OTP en pantalla: no romper el registro si Resend rechaza
    // (ej. destinatario distinto al email de la cuenta Resend sin dominio verificado).
    const allowDevFallback =
      process.env.NODE_ENV !== 'production' || process.env.TRIAL_OTP_DEV_MODE !== 'false';
    if (allowDevFallback) {
      console.warn('[trial-email] Fallback a código en pantalla tras error de Resend');
      return { sent: false, devOnly: true };
    }
    throw new Error('EMAIL_SEND_FAILED');
  }

  console.log(`[trial-email] enviado a=${message.to} subject="${message.subject}"`);
  return { sent: true, devOnly: false };
}

function formatMoneyUyu(amount: number): string {
  return new Intl.NumberFormat('es-UY', {
    style: 'currency',
    currency: 'UYU',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export type SubscriptionInvoiceEmailLine = {
  concepto: string;
  codigo?: string;
  cantidad?: number;
  precioUnitario?: number;
  monto: number;
};

export type SubscriptionInvoiceEmailPayload = {
  to: string;
  businessName: string;
  businessId: string;
  periodo: string;
  ownerName?: string | null;
  lineas: SubscriptionInvoiceEmailLine[];
  subtotal: number;
  descuento: number;
  total: number;
  notes?: string | null;
};

/** Detalle de cuota / aviso de cobro listo para facturar. */
export async function sendSubscriptionInvoiceEmail(
  payload: SubscriptionInvoiceEmailPayload
): Promise<{ sent: boolean; devOnly: boolean }> {
  const { apiKey, forceDevFallback } = resolveTrialEmailApiKey();
  const from = process.env.BILLING_EMAIL_FROM?.trim() || process.env.TRIAL_EMAIL_FROM?.trim() || DEFAULT_FROM;
  const greeting = payload.ownerName?.trim() || 'Hola';
  const rows = payload.lineas
    .map((line) => {
      const qty = line.cantidad ?? 1;
      const unit = line.precioUnitario ?? line.monto;
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(line.concepto)}${
          line.codigo
            ? `<div style="font-size:11px;color:#9ca3af;font-family:monospace">${escapeHtml(line.codigo)}</div>`
            : ''
        }</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${qty}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${formatMoneyUyu(unit)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${formatMoneyUyu(line.monto)}</td>
      </tr>`;
    })
    .join('');

  const subject = `Detalle de cuota RILO · ${payload.businessName} · ${payload.periodo}`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;max-width:560px;margin:0 auto">
      <p>${escapeHtml(greeting)},</p>
      <p>Te enviamos el <strong>detalle de cuota</strong> de <strong>${escapeHtml(payload.businessName)}</strong> para el período <strong>${escapeHtml(payload.periodo)}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
        <thead>
          <tr style="background:#f0fdfa;color:#115e59">
            <th style="padding:8px 10px;text-align:left">Concepto</th>
            <th style="padding:8px 10px;text-align:right">Cant.</th>
            <th style="padding:8px 10px;text-align:right">P. unit.</th>
            <th style="padding:8px 10px;text-align:right">Importe</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="4" style="padding:12px;text-align:center;color:#6b7280">Sin ítems</td></tr>`}
        </tbody>
      </table>
      ${
        payload.descuento > 0
          ? `<p style="margin:0 0 4px;text-align:right;color:#047857">Descuento: -${formatMoneyUyu(payload.descuento)}</p>`
          : ''
      }
      <p style="margin:0;text-align:right;color:#6b7280">Subtotal: ${formatMoneyUyu(payload.subtotal)}</p>
      <p style="margin:8px 0 0;text-align:right;font-size:18px;font-weight:700">Total: ${formatMoneyUyu(payload.total)}</p>
      ${
        payload.notes
          ? `<p style="margin-top:20px;padding:12px;background:#f9fafb;border-radius:8px;font-size:13px;color:#374151">${escapeHtml(payload.notes)}</p>`
          : ''
      }
      <p style="margin-top:24px;font-size:12px;color:#9ca3af">Empresa: ${escapeHtml(payload.businessId)} · RILO Gestión</p>
    </div>
  `.trim();

  if (!apiKey || forceDevFallback) {
    console.log(
      `[billing-email] invoice to=${payload.to} periodo=${payload.periodo} total=${payload.total} (sin envío real)`
    );
    return { sent: false, devOnly: true };
  }

  return sendResendEmail(apiKey, { from, to: payload.to, subject, html });
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
