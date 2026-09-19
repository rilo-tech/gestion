/**
 * Equivale a Plataforma → empresa Rilo → Tope RILO Bot = Libre, y guardar.
 *
 *   npx tsx scripts/set-rilo-bot-unlimited.ts [--apply]
 */
import dotenv from 'dotenv';

dotenv.config();
process.env.USE_FIRESTORE_EMULATOR = 'false';

import { db } from '../backend/firebase.ts';
import { getBusiness, updateBusiness } from '../backend/auth/business.ts';
import {
  aiQuotaForBusiness,
  assertCanUseAi,
  resolveBillingMode,
} from '../backend/auth/usage-gates.ts';

const businessId = process.argv[2]?.startsWith('--') ? 'rilo' : process.argv[2]?.trim() || 'rilo';
const apply = process.argv.includes('--apply');
const PAID_UNTIL = '2099-12-31T23:59:59.000Z';

async function main() {
  const beforeBiz = await getBusiness(businessId);
  if (!beforeBiz) {
    console.error(`Empresa no encontrada: ${businessId}`);
    process.exit(1);
  }

  const beforeQuota = await aiQuotaForBusiness(businessId);
  const billingMode = resolveBillingMode(beforeBiz);
  console.log(
    JSON.stringify(
      {
        before: {
          billingMode,
          enPrueba: beforeBiz.enPrueba ?? null,
          estadoSuscripcion: beforeBiz.estadoSuscripcion,
          trialStatus: beforeBiz.trialStatus ?? null,
          paidUntil: beforeBiz.billing?.paidUntil ?? null,
          usageModeOverride: beforeBiz.suscripcion?.usageModeOverride ?? null,
          unlimited: beforeQuota.unlimited,
          used: beforeQuota.used,
          max: beforeQuota.max,
        },
      },
      null,
      2
    )
  );

  if (beforeQuota.unlimited && billingMode === 'paid') {
    await assertCanUseAi(businessId, 1);
    console.log('Ya está en Libre (paid + unlimited). Nada que cambiar.');
    return;
  }

  if (!apply) {
    console.log('Dry-run. Re-ejecutá con --apply para guardar como en Plataforma.');
    process.exit(2);
  }

  const needsPaidUntil =
    !beforeBiz.billing?.paidUntil ||
    new Date(beforeBiz.billing.paidUntil).getTime() < Date.now();
  if (needsPaidUntil) {
    await db.doc(`negocios/${businessId}`).update({
      'billing.paidUntil': PAID_UNTIL,
      'billing.lifecycleStatus': 'active',
      updatedAt: new Date().toISOString(),
    });
  }

  await updateBusiness(
    businessId,
    {
      estadoSuscripcion: 'activa',
      enPrueba: false,
      trialStatus: 'converted',
      suscripcion: {
        usageModeOverride: 'unlimited',
      },
    },
    {
      allowSubscriptionFields: true,
      changedBy: 'platform-script',
      historyNote: 'Tope RILO Bot → Libre (acciones ilimitadas)',
    }
  );

  const afterQuota = await aiQuotaForBusiness(businessId);
  await assertCanUseAi(businessId, 1);
  const afterBiz = await getBusiness(businessId);
  console.log(
    JSON.stringify(
      {
        applied: true,
        after: {
          billingMode: afterBiz ? resolveBillingMode(afterBiz) : null,
          usageModeOverride: afterBiz?.suscripcion?.usageModeOverride ?? null,
          paidUntil: afterBiz?.billing?.paidUntil ?? null,
          unlimited: afterQuota.unlimited,
          used: afterQuota.used,
          max: afterQuota.max,
          assertCanUseAi: 'PERMITIDO',
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
