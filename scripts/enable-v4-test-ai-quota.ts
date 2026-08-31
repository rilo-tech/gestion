/**
 * Habilita cuota IA de prueba vía usageQuota.extraAi (mecanismo comercial existente).
 * Trial: max = trialAccionesIaMes + extraAi + purchasedAi
 *
 * Uso:
 *   tsx scripts/enable-v4-test-ai-quota.ts [businessId] [--apply]
 */
import dotenv from 'dotenv';

dotenv.config();
process.env.USE_FIRESTORE_EMULATOR = 'false';

import { db } from '../backend/firebase.ts';
import { getBusiness } from '../backend/auth/business.ts';
import { aiQuotaForBusiness, assertCanUseAi } from '../backend/auth/usage-gates.ts';
import { parseBusinessUsageQuota } from '../shared/usage-cost.ts';

const businessId = process.argv[2]?.trim() || 'rilo';
const apply = process.argv.includes('--apply');
const TARGET_EXTRA_AI = 100_000;

async function diagnose() {
  const business = await getBusiness(businessId);
  if (!business) {
    console.error(`[quota] Negocio no encontrado: ${businessId}`);
    process.exit(1);
  }

  const quota = await aiQuotaForBusiness(businessId);
  const usageQuota = parseBusinessUsageQuota(business.usageQuota);
  const productQuote =
    quota.catalog.products.completo ?? quota.catalog.products[Object.keys(quota.catalog.products)[0]];

  const blocking =
    quota.mode !== 'blocked' &&
    !quota.unlimited &&
    quota.max > 0 &&
    quota.used + 2 > quota.max
      ? 'AI_QUOTA_EXCEEDED (used + cost > max)'
      : quota.mode === 'blocked'
        ? 'SUBSCRIPTION_INACTIVE'
        : quota.unlimited
          ? null
          : null;

  console.log(
    JSON.stringify(
      {
        businessId,
        billingMode: quota.mode,
        used: quota.used,
        max: quota.max,
        extraAi: quota.extra,
        purchasedAi: quota.purchased,
        unlimited: quota.unlimited,
        trialAccionesIaMes: quota.catalog.trialAccionesIaMes,
        usageModeOverride: business.suscripcion?.usageModeOverride ?? null,
        includedAiOverride: business.suscripcion?.includedAiOverride ?? null,
        productIncludedAi: productQuote?.includedAi ?? null,
        productUsageMode: productQuote?.usageMode ?? null,
        usageQuotaExtraAi: usageQuota.extraAi,
        enPrueba: business.enPrueba ?? null,
        trialStatus: business.trialStatus ?? null,
        blocking,
      },
      null,
      2
    )
  );

  return { business, quota, usageQuota, blocking };
}

async function main() {
  const { quota, usageQuota, blocking } = await diagnose();

  if (quota.unlimited) {
    console.log('[quota] Ya unlimited (paid + usageModeOverride). assertCanUseAi OK.');
    await assertCanUseAi(businessId, 2);
    console.log('[quota] assertCanUseAi: PERMITIDO');
    return;
  }

  if (!blocking && quota.used + 2 <= quota.max && usageQuota.extraAi >= TARGET_EXTRA_AI) {
    console.log('[quota] Cuota suficiente sin cambios.');
    await assertCanUseAi(businessId, 2);
    console.log('[quota] assertCanUseAi: PERMITIDO');
    return;
  }

  const nextExtra = Math.max(usageQuota.extraAi, TARGET_EXTRA_AI);
  console.log(
    `[quota] Propuesta: usageQuota.extraAi = ${nextExtra} (trialAccionesIaMes ${quota.catalog.trialAccionesIaMes} + extra + purchased)`
  );

  if (!apply) {
    if (blocking) {
      console.log('[quota] Dry-run. Re-ejecutá con --apply para escribir en Firestore.');
      process.exit(2);
    }
    console.log('[quota] Dry-run (headroom). Re-ejecutá con --apply para fijar extraAi alto.');
    process.exit(2);
  }

  await db.doc(`negocios/${businessId}`).set(
    {
      usageQuota: {
        ...usageQuota,
        extraAi: nextExtra,
      },
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  const after = await aiQuotaForBusiness(businessId);
  await assertCanUseAi(businessId, 2);
  console.log(
    JSON.stringify(
      {
        applied: true,
        extraAi: after.extra,
        max: after.max,
        used: after.used,
        assertCanUseAi: 'PERMITIDO',
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[quota] Error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
