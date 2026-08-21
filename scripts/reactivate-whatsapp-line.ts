/**
 * Apaga y prende la línea WhatsApp de una empresa (limpia rastro de baja).
 * Uso: npx tsx scripts/reactivate-whatsapp-line.ts [businessId]
 */
import dotenv from 'dotenv';

dotenv.config();
process.env.USE_FIRESTORE_EMULATOR = 'false';

import { db } from '../backend/firebase.ts';
import { setWhatsappUserEnabled, listWhatsappUsers } from '../backend/whatsapp/whatsapp-users.ts';
import { seedBusinessWhatsappAccess } from '../backend/whatsapp/seed-access.ts';

const businessId = (process.argv[2] || 'rilo').trim();

async function main() {
  console.log('Empresa:', businessId);
  const businessSnap = await db.collection('negocios').doc(businessId).get();
  if (!businessSnap.exists) {
    throw new Error(`Empresa no encontrada: ${businessId}`);
  }
  const business = businessSnap.data() as Record<string, unknown>;
  const contact = business.contactVerification as { phone?: string } | undefined;
  const life = business.lifecycle as { ownerName?: string; ownerUserId?: string } | undefined;
  const access = business.platformAccess as {
    whatsappEnabled?: boolean;
    whatsappPaused?: boolean;
    trialProduct?: string | null;
  } | undefined;

  console.log('platformAccess:', access ?? null);
  console.log('contact phone:', contact?.phone ?? null);

  const before = await listWhatsappUsers(businessId);
  console.log(
    'whatsapp_users antes:',
    before.map((u) => ({ id: u.id, phone: u.phone, enabled: u.enabled, name: u.name }))
  );

  const rawDocs = await db.collection(`negocios/${businessId}/whatsapp_users`).get();
  for (const doc of rawDocs.docs) {
    const d = doc.data();
    console.log('raw', doc.id, {
      phone: d.phone ?? null,
      previousPhone: d.previousPhone ?? null,
      enabled: d.enabled,
      releasedAt: d.releasedAt ?? null,
    });
  }

  for (const user of before) {
    console.log('→ apagar', user.id, user.phone);
    await setWhatsappUserEnabled(businessId, user.id, false);
    console.log('→ prender', user.id);
    await setWhatsappUserEnabled(businessId, user.id, true);
  }

  if (!before.length && contact?.phone) {
    console.log('→ seed owner con', contact.phone);
    await seedBusinessWhatsappAccess({
      businessId,
      phone: contact.phone,
      ownerName: String(life?.ownerName ?? 'Responsable'),
      trialProduct: (access?.trialProduct as 'whatsapp' | 'erp' | 'completo' | null) ?? 'whatsapp',
      forceLine: true,
      erpUserId: life?.ownerUserId ?? null,
      status: 'active',
    });
  }

  // Asegura producto WA operativo (no pausado).
  if (access?.whatsappEnabled === true && access.whatsappPaused === true) {
    await db.collection('negocios').doc(businessId).set(
      {
        platformAccess: { ...access, whatsappPaused: false },
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    console.log('→ whatsappPaused limpiado');
  }

  await db.collection(`negocios/${businessId}/whatsapp_config`).doc('default').set(
    { enabled: true, updatedAt: new Date().toISOString() },
    { merge: true }
  );

  const after = await listWhatsappUsers(businessId);
  console.log(
    'whatsapp_users después:',
    after.map((u) => ({ id: u.id, phone: u.phone, enabled: u.enabled, name: u.name }))
  );

  for (const doc of (await db.collection(`negocios/${businessId}/whatsapp_users`).get()).docs) {
    const d = doc.data();
    console.log('raw after', doc.id, {
      phone: d.phone ?? null,
      previousPhone: d.previousPhone ?? null,
      enabled: d.enabled,
    });
  }

  console.log('OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
