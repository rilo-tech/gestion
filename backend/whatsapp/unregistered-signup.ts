import { db } from '../firebase.ts';
import { waBold, waCard } from '../../shared/whatsapp-format.ts';

const SIGNUP_ASK = 'signup_ask';

const YES = /^(si|sí|ok|dale|confirmo|confirmar|yes|y)$/i;
const NO = /^(no|ahora no|despu[eé]s|despues|cancelar|n)$/i;
const WANTS_SIGNUP =
  /\b(registr(arme|ame|ate|arme\?)|quiero registr|alta|crear cuenta|probar gratis)\b/i;

export function whatsappSignupUrl(): string {
  const base = (process.env.APP_URL ?? 'https://rilo-7eff4.web.app').replace(/\/$/, '');
  return `${base}/probar-gratis?producto=whatsapp`;
}

function signupRef(phone: string) {
  const key = phone.replace(/[^0-9+]/g, '') || 'unknown';
  return db.collection('whatsapp_signup_conversations').doc(key);
}

function wantsSignup(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (YES.test(trimmed)) return true;
  return WANTS_SIGNUP.test(trimmed);
}

function declinesSignup(text: string): boolean {
  return NO.test(text.trim());
}

function signupLinkReply(): string {
  return waCard({
    title: 'Creá tu cuenta',
    lines: ['Prueba gratis, con este mismo WhatsApp.'],
    ask: whatsappSignupUrl(),
  });
}

export async function handleUnregisteredWhatsapp(
  phone: string,
  text: string
): Promise<{ reply: string; intent: string; executed: false }> {
  const trimmed = String(text ?? '').trim();
  const snap = await signupRef(phone).get();
  const pending = String(snap.data()?.pendingIntent ?? '');
  const now = new Date().toISOString();

  if (pending === SIGNUP_ASK && declinesSignup(trimmed)) {
    await signupRef(phone).set({ phone, pendingIntent: null, updatedAt: now }, { merge: true });
    return {
      reply: 'Dale. Cuando quieras registrarte, escribime y te mando el link.',
      intent: 'unauthorized_declined',
      executed: false,
    };
  }

  if (wantsSignup(trimmed)) {
    await signupRef(phone).set({ phone, pendingIntent: null, updatedAt: now }, { merge: true });
    return {
      reply: signupLinkReply(),
      intent: 'unauthorized_signup',
      executed: false,
    };
  }

  if (pending === SIGNUP_ASK && trimmed) {
    return {
      reply: waCard({
        title: 'Registro',
        ask: `¿Querés registrarte?\n${waBold('SÍ')} = te mando el link\n${waBold('NO')} = ahora no`,
      }),
      intent: 'unauthorized',
      executed: false,
    };
  }

  await signupRef(phone).set({ phone, pendingIntent: SIGNUP_ASK, updatedAt: now }, { merge: true });
  return {
    reply: waCard({
      title: 'Hola 👋',
      lines: ['Soy RILO Bot. Este WhatsApp todavía no está registrado.'],
      ask: `¿Querés registrarte?\n${waBold('SÍ')} = te mando el link\n${waBold('NO')} = ahora no`,
    }),
    intent: 'unauthorized',
    executed: false,
  };
}
