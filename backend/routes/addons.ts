import {
  requireCompanyBillingManager,
  type AuthenticatedRequest,
} from '../auth/middleware.ts';
import type { Response } from 'express';
import { createCompanyRouter } from './create-company-router.ts';
import {
  loadCommercialContext,
  quoteBusinessAddErpUser,
  quoteBusinessAddWhatsappNumber,
  syncBillableWhatsappSeats,
} from '../auth/commercial-pricing.ts';
import { listCommercialEvents, recordCommercialEvent } from '../auth/commercial-events.ts';
import { addonPolicyCopy, ADDON_BILLING_POLICY_COPY } from '../../shared/commercial-pricing.ts';
import {
  countPrimaryWhatsappLines,
  createPendingWhatsappLine,
  listWhatsappUsers,
  setWhatsappUserEnabled,
  upsertWhatsappUser,
} from '../whatsapp/whatsapp-users.ts';
import {
  sendExtraWhatsappLineCode,
  verifyExtraWhatsappLineCode,
} from '../auth/whatsapp-extra-otp.ts';
import { safeSyncRecurringAmount } from '../billing/recurring.ts';

export const ADDON_ROUTE_CONTRACT = [
  { method: 'GET', path: '/:businessId/addons' },
  { method: 'GET', path: '/:businessId/addons/quote-user' },
  { method: 'GET', path: '/:businessId/addons/quote-whatsapp' },
  { method: 'POST', path: '/:businessId/addons/whatsapp' },
  { method: 'POST', path: '/:businessId/addons/whatsapp/:lineId/send-code' },
  { method: 'POST', path: '/:businessId/addons/whatsapp/:lineId/verify' },
  { method: 'POST', path: '/:businessId/addons/whatsapp/:lineId/release' },
  { method: 'DELETE', path: '/:businessId/addons/whatsapp/:lineId' },
  { method: 'POST', path: '/:businessId/addons/whatsapp/replace-primary' },
] as const;

const router = createCompanyRouter();

function actorOf(req: AuthenticatedRequest): string {
  if (req.auth?.scope === 'platform') return `platform:${req.auth.userId}`;
  return `company:${req.auth?.userId ?? 'unknown'}`;
}

async function releaseWhatsappLine(req: AuthenticatedRequest, res: Response) {
  try {
    const { businessId, lineId } = req.params;
    const users = await listWhatsappUsers(businessId);
    const line = users.find((row) => row.id === lineId);
    if (!line) return res.status(404).json({ error: 'Número no encontrado.' });
    if (line.kind === 'primary' || line.id === 'owner') {
      const primaries = await countPrimaryWhatsappLines(businessId);
      if (primaries <= 1) {
        return res.status(400).json({
          code: 'PRIMARY_REQUIRED',
          error: 'No podés eliminar el número principal. Usá “Reemplazar número principal”.',
        });
      }
    }
    const before = await loadCommercialContext(businessId);
    await setWhatsappUserEnabled(businessId, lineId, false);
    const billable = await syncBillableWhatsappSeats({ businessId, actor: actorOf(req) });
    const after = await loadCommercialContext(businessId);
    const preapprovalSync = await safeSyncRecurringAmount(businessId);
    await recordCommercialEvent({
      businessId,
      type: 'whatsapp_number_released',
      actor: actorOf(req),
      oldValue: { lineId, phone: line.phone, status: line.status },
      newValue: { lineId, status: 'disconnected', billable },
      billingImpact: {
        oldTotal: before.quote.total,
        newTotal: after.quote.total,
        delta: after.quote.total - before.quote.total,
        effectiveAt: after.quote.effectiveAt,
      },
      note: 'Número WhatsApp liberado',
    });
    res.json({ ok: true, quote: after.quote, preapprovalSync });
  } catch (error) {
    console.error('Error releasing WhatsApp number:', error);
    res.status(500).json({ error: 'No se pudo desactivar el número.' });
  }
}

function mapOtpError(error: unknown): { status: number; message: string } | null {
  const code = error instanceof Error ? error.message : '';
  if (code === 'PHONE_INVALID') return { status: 400, message: 'Teléfono inválido. Usá formato internacional.' };
  if (code === 'PHONE_IN_USE') return { status: 409, message: 'Ese WhatsApp ya está autorizado en otra empresa.' };
  if (code === 'OTP_COOLDOWN') return { status: 429, message: 'Esperá un momento para pedir otro código.' };
  if (code === 'OTP_INVALID') return { status: 400, message: 'Código incorrecto.' };
  if (code === 'OTP_EXPIRED') return { status: 400, message: 'El código venció. Pedí uno nuevo.' };
  if (code === 'OTP_BLOCKED') return { status: 400, message: 'Demasiados intentos. Pedí un código nuevo.' };
  return null;
}

router.get('/:businessId/addons', async (req: AuthenticatedRequest, res) => {
  try {
    const { businessId } = req.params;
    const ctx = await loadCommercialContext(businessId);
    const events = await listCommercialEvents(businessId, 40);
    const autoRenew = ctx.business.billing?.autoRenew === true;
    res.json({
      productId: ctx.productId,
      country: ctx.country,
      currency: ctx.rates.currency,
      rates: ctx.rates,
      quote: ctx.quote,
      paidUntil: ctx.paidUntil,
      policyCopy: addonPolicyCopy(autoRenew),
      autoRenew,
      nextPaymentDate: ctx.business.billing?.nextPaymentDate ?? null,
      erp: {
        included: ctx.rates.includedErpUsers,
        extraContracted: ctx.quote.extraErpUsers,
        active: ctx.activeErpUsers,
        extraUnit: ctx.rates.extraErpUserPrice,
        extraCost: ctx.quote.extraErpCost,
      },
      whatsapp: {
        included: ctx.rates.includedWhatsappNumbers,
        extraContracted: ctx.quote.extraWhatsappNumbers,
        billable: ctx.billableWhatsappNumbers,
        extraUnit: ctx.rates.extraWhatsappNumberPrice,
        extraCost: ctx.quote.extraWhatsappCost,
        max: ctx.rates.maxWhatsappNumbers,
        lines: ctx.waUsers,
      },
      history: events,
    });
  } catch (error) {
    console.error('Error loading addons:', error);
    res.status(500).json({ error: 'No se pudo cargar la autogestión de la cuenta.' });
  }
});

router.get('/:businessId/addons/quote-user', requireCompanyBillingManager, async (req, res) => {
  try {
    const quote = await quoteBusinessAddErpUser(req.params.businessId);
    const ctx = await loadCommercialContext(req.params.businessId);
    res.json({
      ...quote,
      policyCopy: addonPolicyCopy(ctx.business.billing?.autoRenew === true),
      appliedAt: ctx.business.billing?.nextPaymentDate || ctx.paidUntil || 'próxima renovación',
    });
  } catch (error) {
    console.error('Error quoting ERP user:', error);
    res.status(500).json({ error: 'No se pudo cotizar el usuario adicional.' });
  }
});

router.get('/:businessId/addons/quote-whatsapp', requireCompanyBillingManager, async (req, res) => {
  try {
    const quote = await quoteBusinessAddWhatsappNumber(req.params.businessId);
    const ctx = await loadCommercialContext(req.params.businessId);
    res.json({
      ...quote,
      policyCopy: addonPolicyCopy(ctx.business.billing?.autoRenew === true),
      appliedAt: ctx.business.billing?.nextPaymentDate || ctx.paidUntil || 'próxima renovación',
    });
  } catch (error) {
    console.error('Error quoting WhatsApp number:', error);
    res.status(500).json({ error: 'No se pudo cotizar el número adicional.' });
  }
});

router.post(
  '/:businessId/addons/whatsapp',
  requireCompanyBillingManager,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { businessId } = req.params;
      if (req.body?.confirmBilling !== true) {
        const quote = await quoteBusinessAddWhatsappNumber(businessId);
        return res.status(409).json({
          code: 'BILLING_CONFIRMATION_REQUIRED',
          error: 'Confirmá el costo adicional antes de agregar el número.',
          quote,
        });
      }
      const ctx = await loadCommercialContext(businessId);
      const pendingAndBillable =
        ctx.billableWhatsappNumbers +
        ctx.waUsers.filter((row) => row.status === 'pending').length;
      if (ctx.rates.maxWhatsappNumbers != null && pendingAndBillable >= ctx.rates.maxWhatsappNumbers) {
        return res.status(400).json({ error: 'Llegaste al máximo de números de este plan.' });
      }
      const before = ctx.quote;
      const line = await createPendingWhatsappLine({
        businessId,
        name: String(req.body?.name ?? '').trim() || 'Número adicional',
        addedBy: actorOf(req),
      });
      const afterQuote = await quoteBusinessAddWhatsappNumber(businessId);
      await recordCommercialEvent({
        businessId,
        type: 'whatsapp_number_added',
        actor: actorOf(req),
        oldValue: { billable: ctx.billableWhatsappNumbers, status: 'none' },
        newValue: { lineId: line.id, status: 'pending' },
        billingImpact: {
          oldTotal: before.total,
          newTotal: afterQuote.newTotal,
          delta: afterQuote.delta,
          effectiveAt: afterQuote.effectiveAt,
        },
        note: 'Línea WhatsApp adicional pendiente de verificación',
      });
      res.status(201).json({
        line,
        quote: afterQuote,
        policyCopy: ADDON_BILLING_POLICY_COPY,
      });
    } catch (error) {
      console.error('Error adding WhatsApp number:', error);
      res.status(500).json({ error: 'No se pudo agregar el número.' });
    }
  }
);

router.post(
  '/:businessId/addons/whatsapp/:lineId/send-code',
  requireCompanyBillingManager,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await sendExtraWhatsappLineCode({
        businessId: req.params.businessId,
        lineId: req.params.lineId,
        phone: String(req.body?.phone ?? ''),
      });
      res.json(result);
    } catch (error) {
      const mapped = mapOtpError(error);
      if (mapped) return res.status(mapped.status).json({ error: mapped.message });
      console.error('Error sending extra WhatsApp code:', error);
      res.status(500).json({ error: 'No se pudo enviar el código.' });
    }
  }
);

router.post(
  '/:businessId/addons/whatsapp/:lineId/verify',
  requireCompanyBillingManager,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { businessId, lineId } = req.params;
      const before = await loadCommercialContext(businessId);
      const result = await verifyExtraWhatsappLineCode({
        businessId,
        lineId,
        phone: String(req.body?.phone ?? ''),
        code: String(req.body?.code ?? ''),
        name: String(req.body?.name ?? ''),
      });
      const billable = await syncBillableWhatsappSeats({ businessId, actor: actorOf(req) });
      const after = await loadCommercialContext(businessId);
      const preapprovalSync = await safeSyncRecurringAmount(businessId);
      await recordCommercialEvent({
        businessId,
        type: 'whatsapp_number_added',
        actor: actorOf(req),
        oldValue: { billable: before.billableWhatsappNumbers, status: 'pending' },
        newValue: { lineId, phone: result.phone, status: 'active', billable },
        billingImpact: {
          oldTotal: before.quote.total,
          newTotal: after.quote.total,
          delta: after.quote.total - before.quote.total,
          effectiveAt: after.quote.effectiveAt,
        },
        note: 'Número WhatsApp verificado y facturable',
      });
      res.json({ phone: result.phone, quote: after.quote, billable, preapprovalSync });
    } catch (error) {
      const mapped = mapOtpError(error);
      if (mapped) return res.status(mapped.status).json({ error: mapped.message });
      console.error('Error verifying extra WhatsApp:', error);
      res.status(500).json({ error: 'No se pudo verificar el número.' });
    }
  }
);

router.post(
  '/:businessId/addons/whatsapp/:lineId/release',
  requireCompanyBillingManager,
  releaseWhatsappLine
);

router.delete(
  '/:businessId/addons/whatsapp/:lineId',
  requireCompanyBillingManager,
  releaseWhatsappLine
);

router.post(
  '/:businessId/addons/whatsapp/replace-primary',
  requireCompanyBillingManager,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { businessId } = req.params;
      const phone = String(req.body?.phone ?? '').trim();
      const code = String(req.body?.code ?? '').trim();
      if (!phone) return res.status(400).json({ error: 'Ingresá el nuevo número.' });
      const users = await listWhatsappUsers(businessId);
      const primary = users.find((row) => row.kind === 'primary' || row.id === 'owner') ?? users[0];
      if (!primary) return res.status(400).json({ error: 'No hay un número principal para reemplazar.' });
      if (!code) {
        const sent = await sendExtraWhatsappLineCode({
          businessId,
          lineId: primary.id,
          phone,
        });
        return res.json({ ...sent, step: 'code_sent' });
      }
      const before = await loadCommercialContext(businessId);
      await verifyExtraWhatsappLineCode({
        businessId,
        lineId: primary.id,
        phone,
        code,
        name: primary.name || 'Principal',
      });
      await upsertWhatsappUser(businessId, {
        id: primary.id,
        phone,
        name: primary.name || 'Principal',
        role: 'supervisor',
        enabled: true,
        erpUserId: primary.erpUserId,
      });
      await syncBillableWhatsappSeats({ businessId, actor: actorOf(req) });
      const after = await loadCommercialContext(businessId);
      await recordCommercialEvent({
        businessId,
        type: 'whatsapp_number_added',
        actor: actorOf(req),
        oldValue: { primary: primary.phone },
        newValue: { primary: phone },
        billingImpact: {
          oldTotal: before.quote.total,
          newTotal: after.quote.total,
          delta: 0,
          effectiveAt: after.quote.effectiveAt,
        },
        note: 'Reemplazo del número principal',
      });
      res.json({ ok: true, phone, quote: after.quote });
    } catch (error) {
      const mapped = mapOtpError(error);
      if (mapped) return res.status(mapped.status).json({ error: mapped.message });
      console.error('Error replacing primary WhatsApp:', error);
      res.status(500).json({ error: 'No se pudo reemplazar el número principal.' });
    }
  }
);

export default router;
