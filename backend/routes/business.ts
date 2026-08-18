import express from 'express';
import { toPublicBusinessInfo } from '../auth/business.ts';
import { enableProductOnBusiness } from '../auth/enable-product.ts';
import {
  sendWhatsappPhoneCode,
  verifyWhatsappPhoneCode,
} from '../auth/whatsapp-phone-verify.ts';
import { isTrialProductId } from '../../shared/platform-access.ts';
import {
  assertCompanyTenantAccess,
  requireAuth,
  requireSupervisor,
  type AuthenticatedRequest,
} from '../auth/middleware.ts';

const router = express.Router();

router.get(
  '/:businessId',
  requireAuth,
  assertCompanyTenantAccess,
  requireSupervisor,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { businessId } = req.params;
      const business = await toPublicBusinessInfo(businessId);
      res.json(business);
    } catch (error) {
      console.error('Error fetching business info:', error);
      res.status(500).json({ error: 'No se pudo cargar la información de la empresa.' });
    }
  }
);

router.post(
  '/:businessId/enable-product',
  requireAuth,
  assertCompanyTenantAccess,
  requireSupervisor,
  async (req: AuthenticatedRequest, res) => {
    try {
      const { businessId } = req.params;
      const raw = req.body?.product ?? req.body?.producto;
      if (!isTrialProductId(raw)) {
        return res.status(400).json({ error: 'Elegí RiloBot, panel o completo.' });
      }
      const result = await enableProductOnBusiness({ businessId, product: raw });
      const business = await toPublicBusinessInfo(businessId, { business: result.business });
      if (result.outcome === 'checkout_required') {
        return res.status(402).json({
          error: 'Para sumar este módulo tenés que activar o actualizar el plan.',
          outcome: result.outcome,
          checkoutProduct: result.checkoutProduct,
          business,
        });
      }
      return res.json({
        outcome: result.outcome,
        business,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN';
      if (code === 'WHATSAPP_PHONE_REQUIRED') {
        return res.status(400).json({
          error: 'Para activar RiloBot tenés que cargar y confirmar el WhatsApp de la cuenta.',
          code,
        });
      }
      console.error('Error enabling product:', error);
      res.status(500).json({ error: 'No se pudo habilitar el módulo.' });
    }
  }
);

function phoneVerifyError(code: string): { status: number; error: string } | null {
  switch (code) {
    case 'PHONE_INVALID':
      return { status: 400, error: 'Ingresá un celular válido con código de país.' };
    case 'PHONE_ALREADY_USED':
      return { status: 409, error: 'Ese WhatsApp ya está vinculado a otra empresa.' };
    case 'OTP_INVALID':
      return { status: 400, error: 'El código no es correcto.' };
    case 'OTP_EXPIRED':
      return { status: 400, error: 'El código venció. Pedí uno nuevo.' };
    case 'OTP_BLOCKED':
      return { status: 429, error: 'Demasiados intentos. Pedí un código nuevo.' };
    case 'OTP_COOLDOWN':
      return { status: 429, error: 'Esperá unos segundos y pedí el código de nuevo.' };
    case 'BUSINESS_NOT_FOUND':
      return { status: 404, error: 'Empresa no encontrada.' };
    default:
      return null;
  }
}

router.post(
  '/:businessId/whatsapp-phone/send-code',
  requireAuth,
  assertCompanyTenantAccess,
  requireSupervisor,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await sendWhatsappPhoneCode({
        businessId: req.params.businessId,
        phone: String(req.body?.phone ?? ''),
      });
      res.json({
        phone: result.phone,
        whatsappSent: result.whatsappSent,
        ...(result.devCode ? { devCode: result.devCode } : {}),
        hint: result.whatsappSent
          ? 'Te mandamos un código por WhatsApp.'
          : 'Si no te llega el código, escribí Hola a RiloBot con ese número y pedilo de nuevo.',
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN';
      const mapped = phoneVerifyError(code);
      if (mapped) return res.status(mapped.status).json({ error: mapped.error, code });
      console.error('Error sending WhatsApp phone code:', error);
      res.status(500).json({ error: 'No se pudo enviar el código.' });
    }
  }
);

router.post(
  '/:businessId/whatsapp-phone/verify',
  requireAuth,
  assertCompanyTenantAccess,
  requireSupervisor,
  async (req: AuthenticatedRequest, res) => {
    try {
      const result = await verifyWhatsappPhoneCode({
        businessId: req.params.businessId,
        phone: String(req.body?.phone ?? ''),
        code: String(req.body?.code ?? ''),
      });
      const business = await toPublicBusinessInfo(req.params.businessId);
      res.json({ phone: result.phone, business });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN';
      const mapped = phoneVerifyError(code);
      if (mapped) return res.status(mapped.status).json({ error: mapped.error, code });
      console.error('Error verifying WhatsApp phone:', error);
      res.status(500).json({ error: 'No se pudo confirmar el WhatsApp.' });
    }
  }
);

export default router;
