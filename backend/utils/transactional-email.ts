const DEFAULT_FROM = 'RILO Gestión <onboarding@resend.dev>';

export function isTrialEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

/** En producción o con TRIAL_EMAIL_SEND_IN_DEV=true se exige envío real (Resend). */
export function trialEmailDeliveryRequired(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.TRIAL_EMAIL_SEND_IN_DEV === 'true'
  );
}

function assertTrialEmailCanSend(): string {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey && trialEmailDeliveryRequired()) {
    throw new Error('EMAIL_NOT_CONFIGURED');
  }
  return apiKey ?? '';
}

export async function sendTrialSignupCodeEmail(
  to: string,
  code: string
): Promise<{ sent: boolean; devOnly: boolean }> {
  const apiKey = assertTrialEmailCanSend();
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
  const apiKey = assertTrialEmailCanSend();
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
    throw new Error('EMAIL_SEND_FAILED');
  }

  console.log(`[trial-email] enviado a=${message.to} subject="${message.subject}"`);
  return { sent: true, devOnly: false };
}
