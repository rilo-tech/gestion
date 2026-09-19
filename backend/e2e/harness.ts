/**
 * Harness E2E contra Firestore emulator (no producción).
 * Requiere USE_FIRESTORE_EMULATOR=true y FIRESTORE_EMULATOR_HOST.
 */
import { randomUUID } from 'node:crypto';
import { db } from '../firebase.ts';
import { buildStandardAppConfigSeed, RILO_STANDARD_CONFIG_VERSION } from '../../shared/rilo-standard-config.ts';
import { DEFAULT_ORDER_ESTADOS } from '../utils/order-config.ts';
import type { ClientPlatformAccess } from '../../shared/platform-access.ts';
import { initialProfileForTrialProduct } from '../../shared/business-profile.ts';

export function assertEmulatorOrThrow(): void {
  if (process.env.USE_FIRESTORE_EMULATOR !== 'true') {
    throw new Error('E2E abortado: USE_FIRESTORE_EMULATOR debe ser true');
  }
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('E2E abortado: FIRESTORE_EMULATOR_HOST no configurado');
  }
}

export type SeedProductId = 'whatsapp' | 'erp' | 'completo';

function accessForProduct(product: SeedProductId): ClientPlatformAccess {
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

export async function seedStandardTenant(opts?: {
  product?: SeedProductId;
  name?: string;
  defaultPaymentMethod?: string;
}): Promise<{
  businessId: string;
  clientId: string;
  productId: string;
  userIdA: string;
  userIdB: string;
}> {
  assertEmulatorOrThrow();
  const product = opts?.product ?? 'completo';
  const businessId = `e2e_${product}_${randomUUID().slice(0, 8)}`;
  const seed = buildStandardAppConfigSeed({
    defaultPaymentMethod: opts?.defaultPaymentMethod ?? 'transferencia',
    sells: 'both',
    managesStock: true,
    enableRecommendedAlerts: true,
  });
  const profile = initialProfileForTrialProduct(product === 'whatsapp' ? 'whatsapp' : product === 'erp' ? 'erp' : 'completo');
  if (profile.defaults) {
    profile.defaults.defaultPaymentMethod = seed.defaults.defaultPaymentMethod;
  } else {
    profile.defaults = { defaultPaymentMethod: seed.defaults.defaultPaymentMethod };
  }

  await db.doc(`negocios/${businessId}`).set({
    nombre: opts?.name ?? `E2E ${product}`,
    activo: true,
    createdAt: new Date().toISOString(),
    platformAccess: accessForProduct(product),
    businessProfile: profile,
    trialProduct: product,
  });

  await db.doc(`negocios/${businessId}/config/app`).set({
    standardConfigVersion: RILO_STANDARD_CONFIG_VERSION,
    finanzas: seed.finanzas,
    pedidos: {
      estados: DEFAULT_ORDER_ESTADOS,
    },
    caja: {
      ambitos: [{ id: 'negocio', label: 'Negocio', activo: true }],
    },
    defaults: seed.defaults,
  });

  const clientRef = db.collection(`negocios/${businessId}/clientes`).doc();
  await clientRef.set({
    nombre: 'Ana',
    activo: true,
    createdAt: new Date().toISOString(),
    negocioId: businessId,
  });

  const productRef = db.collection(`negocios/${businessId}/stock`).doc();
  await productRef.set({
    nombre: 'Producto A',
    name: 'Producto A',
    cantidad: 10,
    stock: 10,
    stockActual: 10,
    stockMinimo: 0,
    precioVenta: 1500,
    costo: 500,
    controlaStock: true,
    activo: true,
    negocioId: businessId,
    createdAt: new Date().toISOString(),
  });

  // Destinatario WA requerido por presets con canal whatsapp (Completo / Bot).
  if (product === 'whatsapp' || product === 'completo') {
    const phone = `+5989${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    await db.doc(`negocios/${businessId}/whatsapp_users/owner`).set({
      phone,
      name: 'Owner E2E',
      role: 'supervisor',
      enabled: true,
      kind: 'primary',
      status: 'active',
      erpUserId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    businessId,
    clientId: clientRef.id,
    productId: productRef.id,
    userIdA: `user_a_${businessId}`,
    userIdB: `user_b_${businessId}`,
  };
}

export async function createStockProduct(
  businessId: string,
  input: { nombre: string; stock: number; stockMinimo?: number; precioVenta?: number }
): Promise<string> {
  const ref = db.collection(`negocios/${businessId}/stock`).doc();
  await ref.set({
    nombre: input.nombre,
    name: input.nombre,
    cantidad: input.stock,
    stock: input.stock,
    stockActual: input.stock,
    stockMinimo: input.stockMinimo ?? 0,
    precioVenta: input.precioVenta ?? 100,
    costo: 40,
    controlaStock: true,
    activo: true,
    negocioId: businessId,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function getClientBalance(businessId: string, clientId: string): Promise<number> {
  const { computeClientBalanceMap } = await import('../utils/client-balance.ts');
  const map = await computeClientBalanceMap(businessId);
  return map.get(clientId) ?? 0;
}

export async function sumCashByTipo(
  businessId: string,
  tipo: 'ingreso' | 'egreso'
): Promise<number> {
  const snap = await db.collection(`negocios/${businessId}/movimientos_caja`).get();
  let total = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.tipo !== tipo) continue;
    total += Number(data.monto) || 0;
  }
  return Math.round(total * 100) / 100;
}

export async function countCashMovements(
  businessId: string,
  filter?: { medio?: string; tipo?: string }
): Promise<number> {
  const snap = await db.collection(`negocios/${businessId}/movimientos_caja`).get();
  return snap.docs.filter((doc) => {
    const data = doc.data();
    if (filter?.tipo && data.tipo !== filter.tipo) return false;
    if (filter?.medio && String(data.medio ?? '') !== filter.medio) return false;
    return true;
  }).length;
}

export async function getProductStock(businessId: string, productId: string): Promise<number> {
  const snap = await db.doc(`negocios/${businessId}/stock/${productId}`).get();
  const data = snap.data() ?? {};
  // SSOT de dominio: stockActual (createMostradorSale / reservas).
  return Number(data.stockActual ?? data.stock ?? data.cantidad ?? 0) || 0;
}

export async function listOpenNotices(businessId: string) {
  const { listErpNotices } = await import('../automation/erp-notices.ts');
  return listErpNotices(businessId, { status: 'open', limit: 80 });
}

export async function tomorrowIso(): Promise<string> {
  const today = await todayIso();
  const [y, m, d] = today.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/** Día civil en TZ del negocio (misma base que attention-sync), no UTC. */
export async function todayIso(): Promise<string> {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
