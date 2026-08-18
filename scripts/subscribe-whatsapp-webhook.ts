import dotenv from 'dotenv';

dotenv.config({ path: 'functions/.env.rilo-7eff4' });

const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
const verify = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim();
const version = process.env.WHATSAPP_API_VERSION?.trim() || 'v21.0';
const callback = 'https://api-akmf432gba-rj.a.run.app/api/webhooks/whatsapp';
const appId = process.env.WHATSAPP_APP_ID?.trim() || '1034485642372593';

if (!token || !phoneId || !verify) {
  console.error('Faltan WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_WEBHOOK_VERIFY_TOKEN');
  process.exit(1);
}

async function graph(path: string, init?: RequestInit) {
  const res = await fetch(`https://graph.facebook.com/${version}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 800) };
  }
  return { status: res.status, json };
}

const phone = await graph(
  `/${phoneId}?fields=id,display_phone_number,verified_name,webhook_configuration,whatsapp_business_account`
);
console.log('phone', JSON.stringify(phone, null, 2));

const wabaId =
  (phone.json as { whatsapp_business_account?: { id?: string } })?.whatsapp_business_account?.id ||
  '1340641761581895';
console.log('wabaId', wabaId);

const before = await graph(`/${wabaId}/subscribed_apps`);
console.log('subscribed_before', JSON.stringify(before, null, 2));

const subscribe = await graph(`/${wabaId}/subscribed_apps`, {
  method: 'POST',
  body: JSON.stringify({
    override_callback_uri: callback,
    verify_token: verify,
  }),
});
console.log('subscribe', JSON.stringify(subscribe, null, 2));

const appSub = await graph(`/${appId}/subscriptions`, {
  method: 'POST',
  body: JSON.stringify({
    object: 'whatsapp_business_account',
    callback_url: callback,
    verify_token: verify,
    fields: 'messages',
  }),
});
console.log('app_subscriptions', JSON.stringify(appSub, null, 2));

const after = await graph(`/${wabaId}/subscribed_apps`);
console.log('subscribed_after', JSON.stringify(after, null, 2));
