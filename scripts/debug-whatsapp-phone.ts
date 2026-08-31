/**
 * Diagnóstico rápido WA para un teléfono.
 * Uso: npx tsx scripts/debug-whatsapp-phone.ts [phone] [businessId?]
 */
import dotenv from 'dotenv';

dotenv.config();
process.env.USE_FIRESTORE_EMULATOR = 'false';

import { db } from '../backend/firebase.ts';
import { resolveTenantByPhone } from '../backend/whatsapp/tenant-resolver.ts';
import { assertWhatsappFeatures } from '../backend/whatsapp/feature-guard.ts';
import { getBusiness } from '../backend/auth/business.ts';

const phone = (process.argv[2] || '+59892918112').trim();
const focusBusiness = (process.argv[3] || 'rilo').trim();

async function main() {
  console.log('phone', phone);

  const tenant = await resolveTenantByPhone(phone);
  console.log('tenant', JSON.stringify(tenant, null, 2));

  if (tenant) {
    const business = await getBusiness(tenant.businessId);
    console.log('platformAccess', business?.platformAccess);
    console.log('estadoSuscripcion', business?.estadoSuscripcion, 'enPrueba', business?.enPrueba);
    const guard = assertWhatsappFeatures(tenant, { subscriptionActive: true });
    console.log('guard', guard);
  }

  const biz = await db.collection('negocios').doc(focusBusiness).get();
  console.log('focus business exists', biz.exists);
  if (biz.exists) {
    console.log('focus platformAccess', biz.data()?.platformAccess);
    console.log('focus contact', biz.data()?.contactVerification);
  }

  const users = await db.collection(`negocios/${focusBusiness}/whatsapp_users`).get();
  for (const doc of users.docs) {
    console.log('user', doc.id, JSON.stringify(doc.data()));
  }

  const keys = [...new Set([phone, phone.replace(/^\+/, ''), `+${phone.replace(/\D/g, '')}`])];
  for (const key of keys) {
    try {
      const byPhone = await db.collectionGroup('whatsapp_users').where('phone', '==', key).get();
      for (const doc of byPhone.docs) {
        console.log('CG phone', key, doc.ref.path, JSON.stringify(doc.data()));
      }
    } catch (e) {
      console.log('CG phone err', key, e instanceof Error ? e.message : e);
    }
    try {
      const byPrev = await db.collectionGroup('whatsapp_users').where('previousPhone', '==', key).get();
      for (const doc of byPrev.docs) {
        console.log('CG previousPhone', key, doc.ref.path, JSON.stringify(doc.data()));
      }
    } catch (e) {
      console.log('CG previousPhone err', key, e instanceof Error ? e.message : e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
