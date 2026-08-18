import express from 'express';
import { db } from '../firebase.ts';
import { hashPassword } from '../auth/password.ts';
import {
  createBusiness,
  buildNewBusinessPublicInfo,
  getBusiness,
  listPublicBusinessInfos,
  listSubscriptionPayments,
  toPublicBusinessInfo,
  updateBusiness,
  assertCanActivateUser,
  assertCanAddUser,
  type SubscriptionStatus,
} from '../auth/business.ts';
import { registerSubscriptionCoverage } from '../auth/subscription-payments.ts';
import { yearlyAmountFromMonthly } from '../../shared/billing-catalog.ts';
import {
  createPlan,
  DEFAULT_PLAN_ID,
  getPlan,
  listPlans,
  syncPlanTemplatesFromLandingCatalog,
  toPublicPlanInfo,
  updatePlan,
} from '../auth/plans.ts';
import { sanitizeBusinessSubscriptionPayload } from '../auth/subscription-entitlements.ts';
import { SELLABLE_SUBSCRIPTION_MODULE_CATALOG } from '../../shared/subscription-modules.ts';
import { buildTrialFieldUpdates } from '../auth/trial-business.ts';
import {
  clearFrozenPlanForBusinesses,
  countBusinessesOnPlan,
  freezePlanForExistingBusinesses,
} from '../auth/plan-snapshot.ts';
import { listSubscriptionHistory } from '../auth/subscription-history.ts';
import {
  adminReleaseTrialContactClaim,
  listPlatformPendingTrialRegistrations,
  listPlatformTrials,
} from '../auth/platform-trials.ts';
import {
  requireAuth,
  requireSuperadmin,
  type AuthenticatedRequest,
} from '../auth/middleware.ts';
import {
  resolvePlatformAccessForBusiness,
  sanitizePlatformAccessPatch,
  platformAccessPayload,
  platformAccessFromTrialProduct,
} from '../auth/platform-access.ts';
import {
  extendBusinessTrial,
  markBusinessAsPaid,
  updateBusinessContact,
  sendBusinessSubscriptionInvoiceEmail,
  offboardBusiness,
} from '../auth/platform-commercial.ts';
import {
  BILLING_PRODUCTS,
  getBillingProduct,
  resolveBillingCountry,
} from '../../shared/billing-catalog.ts';
import { getCommercialCatalog, saveCommercialCatalog } from '../auth/commercial-catalog.ts';
import { extraUserMonthlyFor, overlayProductsForCountry } from '../../shared/commercial-catalog.ts';
import { isTrialProductId, type TrialProductId } from '../../shared/platform-access.ts';
import { trialDaysForProduct } from '../../shared/trial-state.ts';
import {
  countActiveSupervisors,
  getStoredUser,
  listUsers,
  toPublicUser,
} from '../auth/users.ts';
import { sanitizeStaffPermissions, type UserRole } from '../auth/constants.ts';
import {
  countEnabledWhatsappUsers,
  deleteWhatsappUser,
  listWhatsappUsers,
  setWhatsappUserEnabled,
  upsertWhatsappUser,
} from '../whatsapp/whatsapp-users.ts';

const router = express.Router();

router.use(requireAuth, requireSuperadmin);

router.get('/trials', async (req, res) => {
  try {
    const status = req.query.status as 'active' | 'expiring' | 'expired' | 'all' | undefined;
    const source = typeof req.query.source === 'string' ? req.query.source : undefined;
    const trials = await listPlatformTrials({ status, source });
    res.json(trials);
  } catch (error) {
    console.error('Error listing platform trials:', error);
    res.status(500).json({ error: 'No se pudieron listar las pruebas.' });
  }
});

router.get('/trial-registrations/pending', async (_req, res) => {
  try {
    const rows = await listPlatformPendingTrialRegistrations();
    res.json({ registrations: rows });
  } catch (error) {
    console.error('Error listing pending trial registrations:', error);
    res.status(500).json({ error: 'No se pudieron listar los registros pendientes.' });
  }
});

router.delete('/trial-contact-claims/:type/:value', async (req, res) => {
  try {
    const type = req.params.type === 'phone' ? 'phone' : 'email';
    const value = decodeURIComponent(req.params.value ?? '');
    const force =
      req.query.force === '1' ||
      req.query.force === 'true' ||
      req.body?.force === true;
    const result = await adminReleaseTrialContactClaim(type, value, { force });
    res.json({
      ok: true,
      released: result.released,
      wasBoundToBusinessId: result.wasBoundToBusinessId,
      type,
      value: value.trim().toLowerCase(),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const meta = error as Error & { businessId?: string; businessName?: string };
    if (code === 'ACTIVE_SUBSCRIPTION_BLOCKS_RELEASE') {
      return res.status(409).json({
        error: meta.businessName
          ? `No se puede liberar: “${meta.businessName}” tiene la suscripción activa. Desactivála primero y después liberá el contacto.`
          : 'No se puede liberar: hay una suscripción activa vinculada a ese contacto. Desactivála primero.',
        code: 'ACTIVE_SUBSCRIPTION_BLOCKS_RELEASE',
        businessId: meta.businessId ?? null,
        businessName: meta.businessName ?? null,
      });
    }
    if (code === 'CLAIM_BOUND_TO_BUSINESS') {
      return res.status(409).json({
        error: meta.businessName
          ? `Ese contacto está vinculado a “${meta.businessName}” (suscripción no activa). Marcá “Forzar” para liberarlo de todos modos.`
          : 'Ese contacto está vinculado a una empresa. Marcá “Forzar” si la suscripción ya no está activa.',
        code: 'CLAIM_BOUND_TO_BUSINESS',
        businessId: meta.businessId ?? null,
        businessName: meta.businessName ?? null,
      });
    }
    console.error('Error releasing trial contact claim:', error);
    res.status(500).json({ error: 'No se pudo liberar el contacto.' });
  }
});

router.get('/modules', (_req, res) => {
  res.json(SELLABLE_SUBSCRIPTION_MODULE_CATALOG);
});

router.get('/billing-catalog', async (req, res) => {
  try {
    const country = resolveBillingCountry(
      typeof req.query.country === 'string' ? req.query.country : 'UY'
    );
    const catalog = await getCommercialCatalog();
    res.json({
      country,
      products: overlayProductsForCountry(catalog, country),
      allProducts: BILLING_PRODUCTS,
      trialDays: catalog.trialDays,
      lite: catalog.lite,
    });
  } catch (error) {
    console.error('Error loading billing catalog:', error);
    res.status(500).json({ error: 'No se pudo cargar el catálogo de precios.' });
  }
});

router.get('/commercial', async (_req, res) => {
  try {
    const catalog = await getCommercialCatalog();
    res.json(catalog);
  } catch (error) {
    console.error('Error loading commercial catalog:', error);
    res.status(500).json({ error: 'No se pudo cargar el embudo comercial.' });
  }
});

router.put('/commercial', async (req: AuthenticatedRequest, res) => {
  try {
    const catalog = await saveCommercialCatalog(req.body ?? {});
    const plans = await syncPlanTemplatesFromLandingCatalog();
    res.json({
      catalog,
      plans: plans.map(toPublicPlanInfo),
      message: 'Landing, checkout y plantillas de plan actualizados.',
    });
  } catch (error) {
    console.error('Error saving commercial catalog:', error);
    res.status(500).json({ error: 'No se pudo guardar el embudo comercial.' });
  }
});

router.post('/plans/sync-landing', async (_req, res) => {
  try {
    const plans = await syncPlanTemplatesFromLandingCatalog();
    res.json({
      plans: plans.map(toPublicPlanInfo),
      message: 'Plantillas alineadas con precios de la landing (UY).',
    });
  } catch (error) {
    console.error('Error syncing plans from landing:', error);
    res.status(500).json({ error: 'No se pudieron sincronizar los planes con la landing.' });
  }
});

router.get('/plans', async (_req, res) => {
  try {
    const plans = await listPlans();
    res.json(plans.map(toPublicPlanInfo));
  } catch (error) {
    console.error('Error listing plans:', error);
    res.status(500).json({ error: 'No se pudieron listar los planes.' });
  }
});

router.post('/plans', async (req, res) => {
  try {
    const planId = String(req.body.id ?? req.body.planId ?? '').trim();
    const nombre = String(req.body.nombre ?? '').trim();

    if (!planId || !nombre) {
      return res.status(400).json({ error: 'Id y nombre del plan son obligatorios.' });
    }

    const plan = await createPlan(planId, {
      nombre,
      limiteAdministradores: Number(req.body.limiteAdministradores ?? 1),
      limiteOperadores: Number(req.body.limiteOperadores ?? 0),
      limiteUsuariosTotal: Number(
        req.body.limiteUsuariosTotal ??
          Number(req.body.limiteAdministradores ?? 1) +
            Number(req.body.limiteOperadores ?? 0)
      ),
      precioMensual: Number(req.body.precioBaseMensual ?? req.body.precioMensual ?? 0),
      precioBaseMensual: Number(req.body.precioBaseMensual ?? req.body.precioMensual ?? 0),
      precioPorAdministrador: Number(req.body.precioPorAdministrador ?? 0),
      precioPorOperador: Number(req.body.precioPorOperador ?? 0),
      modulosIncluidos: req.body.modulosIncluidos ?? {},
      preciosAddonModulo: req.body.preciosAddonModulo ?? {},
      maxAmbitosCaja: Number(req.body.maxAmbitosCaja ?? 0),
      activo: req.body.activo !== false,
    });

    res.status(201).json(toPublicPlanInfo(plan));
  } catch (error) {
    if (error instanceof Error && error.message === 'PLAN_EXISTS') {
      return res.status(409).json({ error: 'Ya existe un plan con ese id.' });
    }
    console.error('Error creating plan:', error);
    res.status(500).json({ error: 'No se pudo crear el plan.' });
  }
});

router.patch('/plans/:planId', async (req, res) => {
  try {
    const { planId } = req.params;
    const applyToExisting = req.body.applyToExistingBusinesses === true;
    const existingPlan = await getPlan(planId);
    if (!existingPlan) {
      return res.status(404).json({ error: 'Plan no encontrado.' });
    }

    const affectedBusinessCount = await countBusinessesOnPlan(planId);
    let frozenBusinessCount = 0;
    let clearedFrozenCount = 0;

    if (!applyToExisting) {
      frozenBusinessCount = await freezePlanForExistingBusinesses(planId, existingPlan);
    } else {
      clearedFrozenCount = await clearFrozenPlanForBusinesses(planId);
    }

    const plan = await updatePlan(planId, {
      nombre: typeof req.body.nombre === 'string' ? req.body.nombre : undefined,
      limiteAdministradores:
        typeof req.body.limiteAdministradores === 'number'
          ? req.body.limiteAdministradores
          : undefined,
      limiteOperadores:
        typeof req.body.limiteOperadores === 'number'
          ? req.body.limiteOperadores
          : undefined,
      limiteUsuariosTotal:
        typeof req.body.limiteUsuariosTotal === 'number'
          ? req.body.limiteUsuariosTotal
          : undefined,
      precioMensual:
        typeof req.body.precioMensual === 'number'
          ? req.body.precioMensual
          : undefined,
      precioBaseMensual:
        typeof req.body.precioBaseMensual === 'number'
          ? req.body.precioBaseMensual
          : typeof req.body.precioMensual === 'number'
            ? req.body.precioMensual
            : undefined,
      precioPorAdministrador:
        typeof req.body.precioPorAdministrador === 'number'
          ? req.body.precioPorAdministrador
          : undefined,
      precioPorOperador:
        typeof req.body.precioPorOperador === 'number'
          ? req.body.precioPorOperador
          : undefined,
      modulosIncluidos: req.body.modulosIncluidos,
      preciosAddonModulo: req.body.preciosAddonModulo,
      maxAmbitosCaja:
        typeof req.body.maxAmbitosCaja === 'number' ? req.body.maxAmbitosCaja : undefined,
      activo: req.body.activo,
    });
    res.json({
      plan: toPublicPlanInfo(plan),
      affectedBusinessCount,
      applyToExistingBusinesses: applyToExisting,
      frozenBusinessCount,
      clearedFrozenCount,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'PLAN_NOT_FOUND') {
      return res.status(404).json({ error: 'Plan no encontrado.' });
    }
    console.error('Error updating plan:', error);
    res.status(500).json({ error: 'No se pudo actualizar el plan.' });
  }
});

router.get('/plans/:planId', async (req, res) => {
  try {
    const plan = await getPlan(req.params.planId);
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado.' });
    res.json(toPublicPlanInfo(plan));
  } catch (error) {
    res.status(500).json({ error: 'No se pudo cargar el plan.' });
  }
});

router.get('/businesses', async (_req, res) => {
  try {
    const enriched = await listPublicBusinessInfos();
    res.json(enriched);
  } catch (error) {
    console.error('Error listing businesses:', error);
    res.status(500).json({ error: 'No se pudieron listar las empresas.' });
  }
});

router.post('/businesses', async (req: AuthenticatedRequest, res) => {
  try {
    const businessId = String(req.body.id ?? req.body.businessId ?? '').trim();
    const nombre = String(req.body.nombre ?? '').trim();
    const enPrueba = req.body.enPrueba === true;
    const trialProductRaw =
      typeof req.body.trialProduct === 'string' ? req.body.trialProduct.trim() : '';
    const trialProduct = isTrialProductId(trialProductRaw)
      ? trialProductRaw
      : trialProductRaw
        ? null
        : null;
    const catalogProduct = trialProduct ? getBillingProduct(trialProduct) : null;

    let planId = String(req.body.planId ?? req.body.plan ?? DEFAULT_PLAN_ID).trim();
    if (catalogProduct?.erpPlanId) {
      planId = catalogProduct.erpPlanId;
    } else if (enPrueba && (!req.body.planId || planId === 'plan_basico')) {
      planId = 'plan_intermedio';
    }
    const supervisor = req.body.supervisor ?? {};

    if (!businessId || !nombre) {
      return res.status(400).json({ error: 'Id y nombre de empresa son obligatorios.' });
    }

    const supervisorNombre = String(supervisor.nombre ?? '').trim();
    const supervisorEmail = String(supervisor.email ?? '')
      .trim()
      .toLowerCase();
    const supervisorLogin = String(
      supervisor.loginUsername ?? supervisor.email ?? supervisorNombre
    )
      .trim()
      .toLowerCase();
    const supervisorPassword = String(supervisor.password ?? '').trim();
    const supervisorPhoneRaw = String(
      supervisor.phone ?? supervisor.telefono ?? req.body.phone ?? ''
    ).trim();

    if (!supervisorNombre || !supervisorLogin) {
      return res.status(400).json({
        error: 'El administrador inicial necesita nombre y usuario de acceso.',
      });
    }

    const plan = await getPlan(planId);
    if (!plan || !plan.activo) {
      return res.status(400).json({ error: 'Plan inválido o inactivo.' });
    }

    let supervisorPhone = '';
    if (supervisorPhoneRaw) {
      try {
        const { normalizePhone, isValidE164Phone } = await import('../../shared/phone.ts');
        if (isValidE164Phone(supervisorPhoneRaw)) {
          supervisorPhone = supervisorPhoneRaw;
        } else {
          const normalized = normalizePhone(supervisorPhoneRaw);
          if (!normalized || !isValidE164Phone(normalized)) {
            return res.status(400).json({
              error: 'Teléfono inválido. Usá formato internacional, ej. +59899123456.',
            });
          }
          supervisorPhone = normalized;
        }
      } catch {
        return res.status(400).json({ error: 'Teléfono inválido.' });
      }
    }

    const productForAccess: TrialProductId | null =
      trialProduct ??
      (planId === 'plan_basico'
        ? 'whatsapp'
        : planId === 'plan_profesional'
          ? 'completo'
          : planId === 'plan_intermedio'
            ? 'erp'
            : null);
    const platformAccess = productForAccess
      ? platformAccessFromTrialProduct(productForAccess)
      : undefined;

    if (
      (productForAccess === 'whatsapp' || productForAccess === 'completo') &&
      !supervisorPhone
    ) {
      return res.status(400).json({
        error: 'Con producto RiloBot o Completo necesitás el WhatsApp del responsable (+598…).',
      });
    }

    const commercial = await getCommercialCatalog();
    const business = await createBusiness(businessId, {
      nombre,
      planId,
      estadoSuscripcion: 'activa',
      enPrueba,
      ...buildTrialFieldUpdates(
        {
          enPrueba,
          trialStartDate: req.body.trialStartDate,
          trialEndDate: req.body.trialEndDate,
          trialStatus: enPrueba ? 'active' : undefined,
        },
        undefined,
        enPrueba
          ? { trialDays: commercial.trialDays || (productForAccess ? trialDaysForProduct(productForAccess) : 30) }
          : undefined
      ),
      creadoPor: req.auth?.userId,
      source: 'manual_platform',
      platformAccess,
      contactVerification: {
        email: supervisorEmail,
        emailVerified: false,
        emailStatus: 'pending',
        phone: supervisorPhone,
        phoneVerified: false,
        phoneStatus: supervisorPhone ? 'pending' : 'pending',
        whatsappOptIn: Boolean(supervisorPhone && platformAccess?.whatsappEnabled),
      },
      lifecycle: {
        source: 'manual_platform',
        ownerName: supervisorNombre,
        pais: typeof req.body.pais === 'string' ? req.body.pais.trim() : null,
        ciudad: typeof req.body.ciudad === 'string' ? req.body.ciudad.trim() : null,
        usageSummary: {
          ordersCount: 0,
          salesCount: 0,
          productsCount: 0,
          cashMovementsCount: 0,
        },
      },
    });

    if (supervisorEmail) {
      try {
        const { bindContactClaimToBusiness } = await import('../auth/trial-registration-store.ts');
        await bindContactClaimToBusiness('email', supervisorEmail, businessId);
      } catch (error) {
        console.warn('[platform] could not bind supervisor email claim', error);
      }
    }
    if (supervisorPhone) {
      try {
        const { bindContactClaimToBusiness } = await import('../auth/trial-registration-store.ts');
        await bindContactClaimToBusiness('phone', supervisorPhone, businessId);
      } catch (error) {
        console.warn('[platform] could not bind supervisor phone claim', error);
      }
    }

    const subscriptionPatch = sanitizeBusinessSubscriptionPayload(req.body);
    if (subscriptionPatch) {
      await updateBusiness(
        businessId,
        { suscripcion: subscriptionPatch },
        { allowSubscriptionFields: true }
      );
    }

    const passwordHash = supervisorPassword
      ? await hashPassword(supervisorPassword)
      : null;

    const userRef = await db.collection(`negocios/${businessId}/usuarios`).add({
      nombre: supervisorNombre,
      email: supervisorEmail,
      loginUsername: supervisorLogin,
      passwordHash,
      rol: 'supervisor',
      permisos: [],
      activo: true,
      telefono: supervisorPhone || null,
      createdAt: new Date().toISOString(),
    });

    await db.collection('negocios').doc(businessId).update({
      'lifecycle.ownerUserId': userRef.id,
      updatedAt: new Date().toISOString(),
    });

    if (supervisorPhone && (productForAccess === 'whatsapp' || productForAccess === 'completo')) {
      const { seedBusinessWhatsappAccess } = await import('../whatsapp/seed-access.ts');
      await seedBusinessWhatsappAccess({
        businessId,
        phone: supervisorPhone,
        ownerName: supervisorNombre,
        trialProduct: productForAccess,
        erpUserId: userRef.id,
        status: enPrueba ? 'trial' : 'active',
      });
    }

    const publicBusiness = await toPublicBusinessInfo(businessId);

    res.status(201).json({
      business: publicBusiness,
      supervisor: {
        id: userRef.id,
        nombre: supervisorNombre,
        email: supervisorEmail,
        loginUsername: supervisorLogin,
        rol: 'supervisor',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'BUSINESS_EXISTS') {
      return res.status(409).json({ error: 'Ya existe una empresa con ese id.' });
    }
    console.error('Error creating business:', error);
    res.status(500).json({ error: 'No se pudo crear la empresa.' });
  }
});

router.patch('/businesses/:businessId', async (req: AuthenticatedRequest, res) => {
  try {
    const { businessId } = req.params;
    const planId =
      typeof req.body.planId === 'string'
        ? req.body.planId
        : typeof req.body.plan === 'string'
          ? req.body.plan
          : undefined;
    const estadoSuscripcion = req.body.estadoSuscripcion as SubscriptionStatus | undefined;

    if (planId) {
      const plan = await getPlan(planId);
      if (!plan) {
        return res.status(400).json({ error: 'Plan no encontrado.' });
      }
    }

    const subscriptionPatch = sanitizeBusinessSubscriptionPayload(req.body);

    await updateBusiness(
      businessId,
      {
        nombre: typeof req.body.nombre === 'string' ? req.body.nombre : undefined,
        planId,
        estadoSuscripcion,
        enPrueba: req.body.enPrueba !== undefined ? req.body.enPrueba === true : undefined,
        trialStartDate:
          typeof req.body.trialStartDate === 'string' ? req.body.trialStartDate : undefined,
        trialEndDate:
          typeof req.body.trialEndDate === 'string' ? req.body.trialEndDate : undefined,
        trialStatus: req.body.trialStatus,
        ...(subscriptionPatch ? { suscripcion: subscriptionPatch } : {}),
      },
      {
        allowSubscriptionFields: true,
        changedBy: req.auth?.userId,
        historyNote:
          typeof req.body.historyNote === 'string' ? req.body.historyNote.trim() : undefined,
      }
    );

    const business = await toPublicBusinessInfo(businessId);
    res.json(business);
  } catch (error) {
    if (error instanceof Error && error.message === 'BUSINESS_NOT_FOUND') {
      return res.status(404).json({ error: 'Empresa no encontrada.' });
    }
    console.error('Error updating business:', error);
    res.status(500).json({ error: 'No se pudo actualizar la empresa.' });
  }
});

router.put('/businesses/:businessId/contact', async (req: AuthenticatedRequest, res) => {
  try {
    const business = await updateBusinessContact({
      businessId: req.params.businessId,
      ownerName: typeof req.body.ownerName === 'string' ? req.body.ownerName : undefined,
      email: typeof req.body.email === 'string' ? req.body.email : undefined,
      phone: typeof req.body.phone === 'string' ? req.body.phone : undefined,
      pais: typeof req.body.pais === 'string' ? req.body.pais : undefined,
      ciudad: typeof req.body.ciudad === 'string' ? req.body.ciudad : undefined,
      rubro: typeof req.body.rubro === 'string' ? req.body.rubro : undefined,
      whatsappOptIn:
        typeof req.body.whatsappOptIn === 'boolean' ? req.body.whatsappOptIn : undefined,
    });
    res.json(business);
  } catch (error) {
    if (error instanceof Error && error.message === 'BUSINESS_NOT_FOUND') {
      return res.status(404).json({ error: 'Empresa no encontrada.' });
    }
    if (error instanceof Error && error.message === 'EMAIL_INVALID') {
      return res.status(400).json({ error: 'Email inválido.' });
    }
    if (error instanceof Error && error.message === 'PHONE_INVALID') {
      return res.status(400).json({
        error: 'Teléfono inválido. Usá formato internacional, ej. +59899123456.',
      });
    }
    if (error instanceof Error && error.message === 'EMAIL_ALREADY_USED') {
      return res.status(409).json({ error: 'Ese email ya está vinculado a otra empresa.' });
    }
    if (error instanceof Error && error.message === 'PHONE_ALREADY_USED') {
      return res.status(409).json({ error: 'Ese teléfono ya está vinculado a otra empresa.' });
    }
    console.error('Error updating business contact:', error);
    res.status(500).json({ error: 'No se pudo guardar el contacto.' });
  }
});

router.post('/businesses/:businessId/offboard', async (req: AuthenticatedRequest, res) => {
  try {
    const result = await offboardBusiness({
      businessId: req.params.businessId,
      changedBy: req.auth?.userId,
    });
    res.json({
      ...result.business,
      releasedEmail: result.releasedEmail,
      releasedPhone: result.releasedPhone,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'BUSINESS_NOT_FOUND') {
      return res.status(404).json({ error: 'Empresa no encontrada.' });
    }
    console.error('Error offboarding business:', error);
    res.status(500).json({ error: 'No se pudo dar de baja la empresa.' });
  }
});

router.post('/businesses/:businessId/send-invoice-email', async (req: AuthenticatedRequest, res) => {
  try {
    const result = await sendBusinessSubscriptionInvoiceEmail({
      businessId: req.params.businessId,
      to: typeof req.body.to === 'string' ? req.body.to : undefined,
      periodo: typeof req.body.periodo === 'string' ? req.body.periodo : undefined,
      notes: typeof req.body.notes === 'string' ? req.body.notes : undefined,
      changedBy: req.auth?.userId,
    });
    res.json({
      ok: true,
      ...result,
      message: result.sent
        ? `Detalle enviado a ${result.to}`
        : result.devOnly
          ? `Mail no enviado (Resend no configurado). Quedó registrado el aviso para ${result.to}.`
          : `No se pudo enviar el mail a ${result.to}.`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVOICE_EMAIL_REQUIRED') {
      return res.status(400).json({
        error: 'Indicá un email de destino o cargá el contacto del responsable en Resumen.',
      });
    }
    if (error instanceof Error && error.message === 'EMAIL_SEND_FAILED') {
      return res.status(502).json({ error: 'El proveedor de correo rechazó el envío.' });
    }
    if (error instanceof Error && error.message === 'EMAIL_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Correo no configurado (RESEND_API_KEY).' });
    }
    console.error('Error sending invoice email:', error);
    res.status(500).json({ error: 'No se pudo armar ni enviar el detalle por mail.' });
  }
});

router.get('/businesses/:businessId/subscription-history', async (req, res) => {
  try {
    const history = await listSubscriptionHistory(req.params.businessId);
    res.json(history);
  } catch (error) {
    console.error('Error listing subscription history:', error);
    res.status(500).json({ error: 'No se pudo cargar el historial comercial.' });
  }
});

router.get('/businesses/:businessId/platform-access', async (req, res) => {
  try {
    const business = await getBusiness(req.params.businessId);
    if (!business) {
      return res.status(404).json({ error: 'Empresa no encontrada.' });
    }
    res.json(business.platformAccess ?? resolvePlatformAccessForBusiness({}));
  } catch (error) {
    console.error('Error fetching platform access:', error);
    res.status(500).json({ error: 'No se pudo cargar el acceso de módulos.' });
  }
});

router.put('/businesses/:businessId/platform-access', async (req, res) => {
  try {
    const business = await getBusiness(req.params.businessId);
    if (!business) {
      return res.status(404).json({ error: 'Empresa no encontrada.' });
    }
    const patch = sanitizePlatformAccessPatch(req.body ?? {});
    const next = platformAccessPayload({
      ...(business.platformAccess ?? resolvePlatformAccessForBusiness({})),
      ...patch,
      erpCoreEnabled: true,
    });
    await updateBusiness(req.params.businessId, { platformAccess: next });

    if (next.whatsappEnabled) {
      const phone = business.contactVerification?.phone?.trim() || '';
      if (phone) {
        const { seedBusinessWhatsappAccess } = await import('../whatsapp/seed-access.ts');
        await seedBusinessWhatsappAccess({
          businessId: req.params.businessId,
          phone,
          ownerName: business.lifecycle?.ownerName || business.nombre,
          trialProduct: next.trialProduct,
          forceLine: true,
          erpUserId: business.lifecycle?.ownerUserId ?? null,
          status: business.enPrueba ? 'trial' : 'active',
        });
      }
    }

    const updated = await toPublicBusinessInfo(req.params.businessId);
    res.json(updated.platformAccess ?? next);
  } catch (error) {
    console.error('Error updating platform access:', error);
    res.status(500).json({ error: 'No se pudo actualizar el acceso de módulos.' });
  }
});

router.get('/businesses/:businessId', async (req, res) => {
  try {
    const business = await toPublicBusinessInfo(req.params.businessId);
    res.json(business);
  } catch (error) {
    console.error('Error fetching business:', error);
    res.status(500).json({ error: 'No se pudo cargar la empresa.' });
  }
});

async function syncWhatsappSeatLimit(businessId: string): Promise<void> {
  const enabled = await countEnabledWhatsappUsers(businessId);
  const business = await getBusiness(businessId);
  if (!business) return;
  const catalog = await getCommercialCatalog();
  const country = resolveBillingCountry(business.lifecycle?.pais ?? null);
  const suggested =
    business.suscripcion?.precioPorWhatsappOverride ??
    business.suscripcion?.precioPorOperadorOverride ??
    extraUserMonthlyFor(catalog, country);
  await updateBusiness(
    businessId,
    {
      suscripcion: {
        limiteWhatsapp: enabled,
        ...(business.suscripcion?.precioPorWhatsappOverride == null
          ? { precioPorWhatsappOverride: suggested }
          : {}),
      },
    },
    { allowSubscriptionFields: true, historyNote: 'Cupo WhatsApp sincronizado' }
  );
}

function mapPlatformUserMutationError(error: unknown): { status: number; message: string } | null {
  const code = error instanceof Error ? error.message : '';
  if (code === 'ADMIN_LIMIT_REACHED') {
    return {
      status: 400,
      message: 'El plan no permite más administradores. Ampliá el cupo en la empresa.',
    };
  }
  if (code === 'OPERATOR_LIMIT_REACHED') {
    return {
      status: 400,
      message: 'El plan no permite más operadores. Ampliá el cupo en la empresa.',
    };
  }
  if (code === 'USER_LIMIT_REACHED') {
    return { status: 400, message: 'Se alcanzó el límite total de usuarios del plan.' };
  }
  if (code === 'SUBSCRIPTION_SUSPENDED') {
    return { status: 403, message: 'La suscripción de esta empresa está desactivada.' };
  }
  if (code === 'SUBSCRIPTION_EXPIRED') {
    return { status: 403, message: 'La suscripción está vencida.' };
  }
  if (code === 'PLAN_INACTIVE') {
    return { status: 403, message: 'El plan asignado no está activo.' };
  }
  return null;
}

function normalizePlatformUserPayload(userData: Record<string, unknown>) {
  const rol: UserRole =
    userData.rol === 'supervisor' || userData.rol === 'admin' ? userData.rol : 'staff';

  return {
    nombre: String(userData.nombre ?? '').trim(),
    email: String(userData.email ?? '')
      .trim()
      .toLowerCase(),
    loginUsername: String(userData.loginUsername ?? userData.email ?? '')
      .trim()
      .toLowerCase(),
    rol,
    permisos:
      rol === 'staff' || rol === 'admin'
        ? sanitizeStaffPermissions(userData.permisos)
        : [],
    activo: userData.activo !== false,
  };
}

router.get('/businesses/:businessId/users', async (req, res) => {
  try {
    const includeInactive =
      String(req.query.includeInactive ?? '') === '1' ||
      String(req.query.includeInactive ?? '').toLowerCase() === 'true';
    const users = await listUsers(req.params.businessId);
    res.json(includeInactive ? users : users.filter((u) => u.activo));
  } catch (error) {
    console.error('Error listing business users:', error);
    res.status(500).json({ error: 'No se pudieron listar los usuarios.' });
  }
});

router.post('/businesses/:businessId/users', async (req, res) => {
  try {
    const businessId = req.params.businessId;
    const business = await getBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Empresa no encontrada.' });
    }

    const { password, passwordHash, googleId, ...raw } = req.body ?? {};
    const normalized = normalizePlatformUserPayload(raw);
    if (!normalized.nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio.' });
    }
    if (!normalized.loginUsername && !normalized.email) {
      return res.status(400).json({ error: 'Email o usuario de acceso es obligatorio.' });
    }

    await assertCanAddUser(businessId, normalized.rol);

    const plainPassword = String(password ?? '').trim();
    let nextPasswordHash = passwordHash ? String(passwordHash) : undefined;
    if (plainPassword) {
      nextPasswordHash = await hashPassword(plainPassword);
    }

    const docRef = await db.collection(`negocios/${businessId}/usuarios`).add({
      ...normalized,
      passwordHash: nextPasswordHash ?? null,
      googleId: googleId ? String(googleId) : null,
      createdAt: new Date().toISOString(),
    });

    const created = await getStoredUser(businessId, docRef.id);
    res.status(201).json(created ? toPublicUser(created) : { id: docRef.id, ...normalized });
  } catch (error) {
    const mapped = mapPlatformUserMutationError(error);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.message });
    }
    console.error('Error creating platform business user:', error);
    res.status(500).json({ error: 'No se pudo crear el usuario.' });
  }
});

router.patch('/businesses/:businessId/users/:userId', async (req, res) => {
  try {
    const { businessId, userId } = req.params;
    const business = await getBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Empresa no encontrada.' });
    }

    const docRef = db.collection(`negocios/${businessId}/usuarios`).doc(userId);
    const existing = await docRef.get();
    if (!existing.exists) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const existingData = existing.data() as Record<string, unknown>;
    const { password, passwordHash, googleId, ...raw } = req.body ?? {};
    const merged = normalizePlatformUserPayload({ ...existingData, ...raw });

    const deactivatingLastSupervisor =
      existingData.rol === 'supervisor' &&
      existingData.activo !== false &&
      merged.activo === false;
    const demotingLastSupervisor =
      existingData.rol === 'supervisor' &&
      existingData.activo !== false &&
      merged.rol !== 'supervisor';

    if (deactivatingLastSupervisor || demotingLastSupervisor) {
      const supervisors = await countActiveSupervisors(businessId);
      if (supervisors <= 1) {
        return res.status(400).json({
          error: 'No se puede dar de baja ni degradar al único administrador principal activo.',
        });
      }
    }

    const activating = existingData.activo === false && merged.activo === true;
    const roleChanged = existingData.rol !== merged.rol;
    if (activating || roleChanged) {
      await assertCanActivateUser(businessId, merged.rol, userId);
    }

    const updatePayload: Record<string, unknown> = {
      ...merged,
      updatedAt: new Date().toISOString(),
    };

    const plainPassword = String(password ?? '').trim();
    if (plainPassword) {
      updatePayload.passwordHash = await hashPassword(plainPassword);
    } else if (passwordHash === null) {
      updatePayload.passwordHash = null;
    }

    if (googleId !== undefined) {
      updatePayload.googleId = googleId ? String(googleId) : null;
    }

    await docRef.update(updatePayload);
    const updated = await getStoredUser(businessId, userId);
    res.json(updated ? toPublicUser(updated) : { id: userId, ...merged });
  } catch (error) {
    const mapped = mapPlatformUserMutationError(error);
    if (mapped) {
      return res.status(mapped.status).json({ error: mapped.message });
    }
    console.error('Error updating platform business user:', error);
    res.status(500).json({ error: 'No se pudo actualizar el usuario.' });
  }
});

router.delete('/businesses/:businessId/users/:userId', async (req, res) => {
  try {
    const { businessId, userId } = req.params;
    const docRef = db.collection(`negocios/${businessId}/usuarios`).doc(userId);
    const existing = await docRef.get();
    if (!existing.exists) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    if (existing.data()?.rol === 'supervisor' && existing.data()?.activo !== false) {
      const supervisors = await countActiveSupervisors(businessId);
      if (supervisors <= 1) {
        return res.status(400).json({
          error: 'No se puede eliminar el único administrador principal activo.',
        });
      }
    }

    await docRef.delete();
    res.json({ id: userId, ok: true });
  } catch (error) {
    console.error('Error deleting platform business user:', error);
    res.status(500).json({ error: 'No se pudo eliminar el usuario.' });
  }
});

router.get('/businesses/:businessId/whatsapp-users', async (req, res) => {
  try {
    const users = await listWhatsappUsers(req.params.businessId);
    res.json({ users, enabledCount: users.filter((u) => u.enabled).length });
  } catch (error) {
    console.error('Error listing whatsapp users:', error);
    res.status(500).json({ error: 'No se pudieron listar los WhatsApp.' });
  }
});

router.post('/businesses/:businessId/whatsapp-users', async (req, res) => {
  try {
    const user = await upsertWhatsappUser(req.params.businessId, {
      phone: String(req.body.phone ?? ''),
      name: String(req.body.name ?? ''),
      role: req.body.role,
      enabled: req.body.enabled !== false,
      erpUserId: req.body.erpUserId ?? null,
    });
    await syncWhatsappSeatLimit(req.params.businessId);
    res.status(201).json(user);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'INVALID_PHONE') {
      return res.status(400).json({ error: 'Teléfono inválido. Usá formato internacional (+598…).' });
    }
    if (code === 'PHONE_IN_USE') {
      return res.status(409).json({ error: 'Ese WhatsApp ya está autorizado en otra empresa.' });
    }
    console.error('Error creating whatsapp user:', error);
    res.status(500).json({ error: 'No se pudo agregar el WhatsApp.' });
  }
});

router.patch('/businesses/:businessId/whatsapp-users/:userId', async (req, res) => {
  try {
    const { businessId, userId } = req.params;
    if (typeof req.body.enabled === 'boolean' && req.body.phone === undefined) {
      const user = await setWhatsappUserEnabled(businessId, userId, req.body.enabled);
      await syncWhatsappSeatLimit(businessId);
      return res.json(user);
    }
    const user = await upsertWhatsappUser(businessId, {
      id: userId,
      phone: String(req.body.phone ?? ''),
      name: String(req.body.name ?? ''),
      role: req.body.role,
      enabled: req.body.enabled,
      erpUserId: req.body.erpUserId ?? null,
    });
    await syncWhatsappSeatLimit(businessId);
    res.json(user);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'INVALID_PHONE') {
      return res.status(400).json({ error: 'Teléfono inválido. Usá formato internacional (+598…).' });
    }
    if (code === 'PHONE_IN_USE') {
      return res.status(409).json({ error: 'Ese WhatsApp ya está autorizado en otra empresa.' });
    }
    if (code === 'WHATSAPP_USER_NOT_FOUND') {
      return res.status(404).json({ error: 'WhatsApp no encontrado.' });
    }
    console.error('Error updating whatsapp user:', error);
    res.status(500).json({ error: 'No se pudo actualizar el WhatsApp.' });
  }
});

router.delete('/businesses/:businessId/whatsapp-users/:userId', async (req, res) => {
  try {
    await deleteWhatsappUser(req.params.businessId, req.params.userId);
    await syncWhatsappSeatLimit(req.params.businessId);
    res.json({ ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'WHATSAPP_USER_NOT_FOUND') {
      return res.status(404).json({ error: 'WhatsApp no encontrado.' });
    }
    console.error('Error deleting whatsapp user:', error);
    res.status(500).json({ error: 'No se pudo eliminar el WhatsApp.' });
  }
});

router.get('/businesses/:businessId/payments', async (req, res) => {
  try {
    const payments = await listSubscriptionPayments(req.params.businessId);
    res.json(payments);
  } catch (error) {
    console.error('Error listing subscription payments:', error);
    res.status(500).json({ error: 'No se pudieron cargar los pagos.' });
  }
});

router.post('/businesses/:businessId/extend-trial', async (req: AuthenticatedRequest, res) => {
  try {
    const days = Number(req.body.days);
    const business = await extendBusinessTrial({
      businessId: req.params.businessId,
      days,
      changedBy: req.auth?.userId,
    });
    res.json(business);
  } catch (error) {
    if (error instanceof Error && error.message === 'BUSINESS_NOT_FOUND') {
      return res.status(404).json({ error: 'Empresa no encontrada.' });
    }
    if (error instanceof Error && error.message === 'INVALID_TRIAL_DAYS') {
      return res.status(400).json({ error: 'Indicá una cantidad de días entre 1 y 365.' });
    }
    console.error('Error extending trial:', error);
    res.status(500).json({ error: 'No se pudo extender la prueba.' });
  }
});

router.post('/businesses/:businessId/mark-paid', async (req: AuthenticatedRequest, res) => {
  try {
    const business = await markBusinessAsPaid({
      businessId: req.params.businessId,
      productId: typeof req.body.productId === 'string' ? req.body.productId : undefined,
      country:
        req.body.country === 'AR' || req.body.country === 'UY' ? req.body.country : undefined,
      registerPayment: req.body.registerPayment !== false,
      amount: typeof req.body.amount === 'number' ? req.body.amount : undefined,
      billingInterval: req.body.billingInterval === 'year' ? 'year' : 'month',
      enablePerUserPricing: req.body.enablePerUserPricing === true,
      precioPorOperador:
        typeof req.body.precioPorOperador === 'number' ? req.body.precioPorOperador : undefined,
      changedBy: req.auth?.userId,
    });
    res.json(business);
  } catch (error) {
    if (error instanceof Error && error.message === 'BUSINESS_NOT_FOUND') {
      return res.status(404).json({ error: 'Empresa no encontrada.' });
    }
    if (error instanceof Error && error.message === 'INVALID_PRODUCT') {
      return res.status(400).json({ error: 'Producto de landing inválido.' });
    }
    console.error('Error marking business as paid:', error);
    res.status(500).json({ error: 'No se pudo marcar la empresa como paga.' });
  }
});

router.post('/businesses/:businessId/payments', async (req, res) => {
  try {
    const businessId = req.params.businessId;
    const business = await toPublicBusinessInfo(businessId);
    const coverageMonthsRaw = Number(req.body.coverageMonths);
    const coverageMonths =
      Number.isFinite(coverageMonthsRaw) && coverageMonthsRaw > 1
        ? Math.min(24, Math.floor(coverageMonthsRaw))
        : 1;
    const monto =
      req.body.monto !== undefined
        ? Number(req.body.monto)
        : coverageMonths > 1
          ? yearlyAmountFromMonthly(business.montoMensualEsperado)
          : business.montoMensualEsperado;
    const notas =
      typeof req.body.notas === 'string'
        ? req.body.notas
        : coverageMonths > 1
          ? `Pago anual registrado desde Plataforma (${coverageMonths} meses)`
          : undefined;

    const coverage = await registerSubscriptionCoverage(businessId, {
      coverageMonths,
      montoTotal: monto,
      startPeriodo: typeof req.body.periodo === 'string' ? req.body.periodo : undefined,
      fechaPago: typeof req.body.fechaPago === 'string' ? req.body.fechaPago : undefined,
      notas,
    });

    await db.collection('negocios').doc(businessId).set(
      {
        billing: {
          paidUntil: coverage.paidUntil,
          billingInterval: coverageMonths > 1 ? 'year' : 'month',
          source: 'platform_payment',
          updatedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    res.status(201).json({
      ...coverage.payments[0],
      coverageMonths: coverage.coverageMonths,
      paidUntil: coverage.paidUntil,
      paymentsRegistered: coverage.payments.length,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'PAYMENT_PERIOD_EXISTS') {
      return res.status(409).json({ error: 'Ya hay un pago registrado para ese mes.' });
    }
    console.error('Error registering subscription payment:', error);
    res.status(500).json({ error: 'No se pudo registrar el pago.' });
  }
});

export default router;
