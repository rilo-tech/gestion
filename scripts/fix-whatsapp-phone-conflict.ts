/**
 * Limpia el teléfono de líneas disabled en otras empresas y verifica resolveTenantByPhone.
 * Uso: npx tsx scripts/fix-whatsapp-phone-conflict.ts [phone] [keepBusinessId]
 */
import dotenv from 'dotenv';

dotenv.config();
process.env.USE_FIRESTORE_EMULATOR = 'false';

import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../backend/firebase.ts';
import { resolveTenantByPhone } from '../backend/whatsapp/tenant-resolver.ts';

const phone = (process.argv[2] || '+59892918112').trim();
const keepBusinessId = (process.argv[3] || 'rilo').trim();

async function main() {
  console.log('phone', phone, 'keep', keepBusinessId);

  for (const businessId of ['prueba', 'rilo']) {
    const users = await db.collection(`negocios/${businessId}/whatsapp_users`).get();
    for (const doc of users.docs) {
      const d = doc.data();
      console.log(businessId, doc.id, {
        phone: d.phone ?? null,
        previousPhone: d.previousPhone ?? null,
        enabled: d.enabled,
      });
      if (businessId === keepBusinessId) continue;
      const p = String(d.phone ?? '');
      const prev = String(d.previousPhone ?? '');
      if (p.includes('92918112') || prev.includes('92918112') || p === phone || prev === phone) {
        if (d.enabled === false || businessId === 'prueba') {
          await doc.ref.set(
            {
              enabled: false,
              phone: FieldValue.delete(),
              previousPhone: phone,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
          console.log('cleared', businessId, doc.id);
        }
      }
    }
  }

  const tenant = await resolveTenantByPhone(phone);
  console.log('resolveTenantByPhone =>', JSON.stringify(tenant, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
