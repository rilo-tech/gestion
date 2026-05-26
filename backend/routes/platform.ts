import express from 'express';
import { db } from '../firebase.ts';
import { hashPassword } from '../auth/password.ts';
import {
  createBusiness,
  buildNewBusinessPublicInfo,
  listPublicBusinessInfos,
  listSubscriptionPayments,
  registerSubscriptionPayment,
  toPublicBusinessInfo,
  updateBusiness,
  type SubscriptionStatus,
} from '../auth/business.ts';
import {
  createPlan,
  DEFAULT_PLAN_ID,
  getPlan,
  listPlans,
  toPublicPlanInfo,
  updatePlan,
} from '../auth/plans.ts';
import {
  requireAuth,
  requireSuperadmin,
  type AuthenticatedRequest,
} from '../auth/middleware.ts';

const router = express.Router();

router.use(requireAuth, requireSuperadmin);

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
      precioMensual: Number(req.body.precioMensual ?? 0),
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
      activo: req.body.activo,
    });
    res.json(toPublicPlanInfo(plan));
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
    const planId = String(req.body.planId ?? req.body.plan ?? DEFAULT_PLAN_ID).trim();
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

    if (!supervisorNombre || !supervisorLogin) {
      return res.status(400).json({
        error: 'El administrador inicial necesita nombre y usuario de acceso.',
      });
    }

    const plan = await getPlan(planId);
    if (!plan || !plan.activo) {
      return res.status(400).json({ error: 'Plan inválido o inactivo.' });
    }

    const business = await createBusiness(businessId, {
      nombre,
      planId,
      estadoSuscripcion: 'activa',
      enPrueba: req.body.enPrueba === true,
      creadoPor: req.auth?.userId,
    });

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
      createdAt: new Date().toISOString(),
    });

    const publicBusiness = buildNewBusinessPublicInfo(business, plan);

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

router.patch('/businesses/:businessId', async (req, res) => {
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

    await updateBusiness(
      businessId,
      {
        nombre: typeof req.body.nombre === 'string' ? req.body.nombre : undefined,
        planId,
        estadoSuscripcion,
        enPrueba: req.body.enPrueba !== undefined ? req.body.enPrueba === true : undefined,
      },
      { allowSubscriptionFields: true }
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

router.get('/businesses/:businessId', async (req, res) => {
  try {
    const business = await toPublicBusinessInfo(req.params.businessId);
    res.json(business);
  } catch (error) {
    console.error('Error fetching business:', error);
    res.status(500).json({ error: 'No se pudo cargar la empresa.' });
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

router.post('/businesses/:businessId/payments', async (req, res) => {
  try {
    const business = await toPublicBusinessInfo(req.params.businessId);
    const payment = await registerSubscriptionPayment(req.params.businessId, {
      periodo: req.body.periodo,
      monto:
        req.body.monto !== undefined
          ? Number(req.body.monto)
          : business.montoMensualEsperado,
      fechaPago: req.body.fechaPago,
      notas: typeof req.body.notas === 'string' ? req.body.notas : undefined,
    });
    res.status(201).json(payment);
  } catch (error) {
    if (error instanceof Error && error.message === 'PAYMENT_PERIOD_EXISTS') {
      return res.status(409).json({ error: 'Ya hay un pago registrado para ese mes.' });
    }
    console.error('Error registering subscription payment:', error);
    res.status(500).json({ error: 'No se pudo registrar el pago.' });
  }
});

export default router;
