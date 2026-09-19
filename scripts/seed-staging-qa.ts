/**
 * Seed QA idempotente SOLO en rilo-staging.
 * Uso: npm run seed:staging:qa
 *
 * Crea/actualiza: qa-bot, qa-gestion, qa-completo, qa-legacy
 * ABORT en rilo-7eff4.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import {
  RILO_STAGING_PROJECT_ID,
  assertStagingProjectOrThrow,
} from '../shared/rilo-environment.ts';
import { buildStandardAppConfigSeed, RILO_STANDARD_CONFIG_VERSION } from '../shared/rilo-standard-config.ts';
import { DEFAULT_ORDER_ESTADOS } from '../backend/utils/order-config.ts';
import { initialProfileForTrialProduct } from '../shared/business-profile.ts';
import type { ClientPlatformAccess } from '../shared/platform-access.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(rel: string): void {
  const full = path.join(root, rel);
  if (fs.existsSync(full)) dotenv.config({ path: full, override: false });
}

loadEnvFile('.env.staging');
loadEnvFile(`functions/.env.${RILO_STAGING_PROJECT_ID}`);
process.env.RILO_ENV = 'staging';
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || RILO_STAGING_PROJECT_ID;
process.env.GCLOUD_PROJECT = process.env.FIREBASE_PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = process.env.FIREBASE_PROJECT_ID;
process.env.USE_FIRESTORE_EMULATOR = 'false';

assertStagingProjectOrThrow('seed:staging:qa');

const { db } = await import('../backend/firebase.ts');
const { ensureDefaultPlans } = await import('../backend/auth/plans.ts');
const { ensureDefaultPlatformAdmin } = await import('../backend/auth/platform.ts');

const QA_PHONE = (process.env.WHATSAPP_QA_PHONE || '').trim();

type AccessProduct = 'whatsapp' | 'erp' | 'completo';

function accessFor(product: AccessProduct): ClientPlatformAccess {
  if (product === 'whatsapp') {
    return {
      whatsappEnabled: true,
      erpWebEnabled: true,
      webExperience: 'summary',
      trialProduct: 'whatsapp',
    };
  }
  if (product === 'erp') {
    return {
      whatsappEnabled: false,
      erpWebEnabled: true,
      webExperience: 'full',
      trialProduct: 'erp',
    };
  }
  return {
    whatsappEnabled: true,
    erpWebEnabled: true,
    webExperience: 'full',
    trialProduct: 'completo',
  };
}

async function upsertBusiness(
  businessId: string,
  opts: {
    name: string;
    product: AccessProduct;
    standard: boolean;
    sparse: boolean;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const profile = initialProfileForTrialProduct(
    opts.product === 'whatsapp' ? 'whatsapp' : opts.product === 'erp' ? 'erp' : 'completo'
  );

  const bizRef = db.doc(`negocios/${businessId}`);
  const existing = await bizRef.get();
  await bizRef.set(
    {
      nombre: opts.name,
      activo: true,
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
      platformAccess: accessFor(opts.product),
      businessProfile: profile,
      trialProduct: opts.product,
      qaTenant: true,
      source: 'seed:staging:qa',
      estadoSuscripcion: 'activa',
    },
    { merge: true }
  );

  if (opts.standard) {
    const seed = buildStandardAppConfigSeed({
      defaultPaymentMethod: 'transferencia',
      sells: 'both',
      managesStock: true,
      enableRecommendedAlerts: true,
    });
    await db.doc(`negocios/${businessId}/config/app`).set(
      {
        standardConfigVersion: RILO_STANDARD_CONFIG_VERSION,
        finanzas: seed.finanzas,
        pedidos: { estados: DEFAULT_ORDER_ESTADOS },
        caja: {
          ambitos: [{ id: 'negocio', label: 'Negocio', activo: true }],
        },
        defaults: seed.defaults,
        updatedAt: now,
      },
      { merge: true }
    );
  } else {
    // Legacy fixture — SIN standardConfigVersion
    await db.doc(`negocios/${businessId}/config/app`).set(
      {
        finanzas: {
          categoriasGasto: [
            { id: 'dtf', label: 'DTF', ambitoDefault: 'negocio', afectaReporteNegocio: true },
            {
              id: 'sublimacion',
              label: 'Sublimación',
              ambitoDefault: 'negocio',
              afectaReporteNegocio: true,
            },
            {
              id: 'packaging',
              label: 'Packaging',
              ambitoDefault: 'negocio',
              afectaReporteNegocio: true,
            },
          ],
          mediosPago: [
            { id: 'efectivo', label: 'Efectivo', activo: true, generaMovimientoCaja: true },
            {
              id: 'transferencia',
              label: 'Transferencia',
              activo: true,
              generaMovimientoCaja: true,
            },
          ],
        },
        pedidos: {
          estados: [
            { value: 'pendiente', label: 'Pendiente', sistema: true },
            { value: 'en_produccion', label: 'Preparando', sistema: true },
            { value: 'listo', label: 'Listo p/retirar', sistema: true },
            { value: 'entregado', label: 'Entregado', sistema: true },
            { value: 'cancelado', label: 'Cancelado', sistema: true },
          ],
        },
        caja: {
          ambitos: [
            { id: 'negocio', label: 'Negocio', activo: true },
            { id: 'personal', label: 'Personal RILO', activo: true },
            { id: 'dtf', label: 'Caja DTF', activo: true },
          ],
        },
        updatedAt: now,
      },
      { merge: true }
    );
  }

  // Owner ERP user (password hash omitted — crear login vía trial/platform)
  const users = await db.collection(`negocios/${businessId}/usuarios`).limit(1).get();
  if (users.empty) {
    await db.collection(`negocios/${businessId}/usuarios`).add({
      nombre: 'QA Owner',
      email: `${businessId}@qa.rilo.local`,
      loginUsername: businessId,
      rol: 'supervisor',
      activo: true,
      isOwner: true,
      qaUser: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  if ((opts.product === 'whatsapp' || opts.product === 'completo') && QA_PHONE) {
    await db.doc(`negocios/${businessId}/whatsapp_users/owner`).set(
      {
        phone: QA_PHONE,
        name: 'QA WhatsApp',
        role: 'supervisor',
        enabled: true,
        kind: 'primary',
        status: 'active',
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    );
  }

  if (opts.sparse) {
    console.log(`[seed] ${businessId}: sparse (empty-state / onboarding)`);
    return;
  }

  // Clientes
  const clientNames = ['Ana', 'Juan', 'María'];
  const clientIds: string[] = [];
  for (const nombre of clientNames) {
    const snap = await db
      .collection(`negocios/${businessId}/clientes`)
      .where('nombre', '==', nombre)
      .limit(1)
      .get();
    if (!snap.empty) {
      clientIds.push(snap.docs[0]!.id);
      continue;
    }
    const ref = await db.collection(`negocios/${businessId}/clientes`).add({
      nombre,
      activo: true,
      qaSeed: true,
      createdAt: now,
      negocioId: businessId,
    });
    clientIds.push(ref.id);
  }

  // Productos
  const products = [
    { nombre: 'Producto A', stock: 10, precio: 1500 },
    { nombre: 'Producto B', stock: 5, precio: 800 },
    { nombre: 'Producto C', stock: 2, precio: 300, stockMinimo: 3 },
  ];
  for (const p of products) {
    const snap = await db
      .collection(`negocios/${businessId}/stock`)
      .where('nombre', '==', p.nombre)
      .limit(1)
      .get();
    if (!snap.empty) continue;
    await db.collection(`negocios/${businessId}/stock`).add({
      nombre: p.nombre,
      name: p.nombre,
      cantidad: p.stock,
      stock: p.stock,
      stockActual: p.stock,
      stockMinimo: p.stockMinimo ?? 0,
      precioVenta: p.precio,
      costo: Math.round(p.precio * 0.4),
      controlaStock: true,
      activo: true,
      qaSeed: true,
      negocioId: businessId,
      createdAt: now,
    });
  }

  // Payable sample (UTE) if none
  const paySnap = await db
    .collection(`negocios/${businessId}/obligaciones_pago`)
    .where('beneficiario', '==', 'UTE')
    .limit(1)
    .get();
  if (paySnap.empty) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await db.collection(`negocios/${businessId}/obligaciones_pago`).add({
      beneficiario: 'UTE',
      monto: 7500,
      tipo: 'unico',
      estado: 'pendiente',
      fechaVencimiento: tomorrow.toISOString().slice(0, 10),
      qaSeed: true,
      createdAt: now,
      negocioId: businessId,
    });
  }

  console.log(`[seed] ${businessId}: datos sintéticos OK (clientes=${clientIds.length})`);
}

async function main(): Promise<void> {
  console.log(`[seed:staging:qa] project=${assertStagingProjectOrThrow('seed:staging:qa')}`);
  await ensureDefaultPlans();
  await ensureDefaultPlatformAdmin();

  await upsertBusiness('qa-bot', {
    name: 'QA Bot',
    product: 'whatsapp',
    standard: true,
    sparse: true,
  });
  await upsertBusiness('qa-gestion', {
    name: 'QA Gestión',
    product: 'erp',
    standard: true,
    sparse: false,
  });
  await upsertBusiness('qa-completo', {
    name: 'QA Completo',
    product: 'completo',
    standard: true,
    sparse: false,
  });
  await upsertBusiness('qa-legacy', {
    name: 'QA Legacy Personalizados',
    product: 'completo',
    standard: false,
    sparse: false,
  });

  console.log('');
  console.log('[seed:staging:qa] Listo.');
  console.log('[seed:staging:qa] Tenants: qa-bot (sparse), qa-gestion, qa-completo, qa-legacy');
  if (QA_PHONE) {
    console.log(`[seed:staging:qa] WA owner phone seteado en Bot/Completo (allowlist required)`);
  } else {
    console.log('[seed:staging:qa] WHATSAPP_QA_PHONE no seteado — vincular número QA a mano');
  }
  console.log('[seed:staging:qa] Usuarios: loginUsername = businessId; password vía platform/trial');
}

main().catch((err) => {
  console.error('[seed:staging:qa]', err);
  process.exit(1);
});
