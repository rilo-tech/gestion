import express from 'express';
import { getBusiness } from '../auth/business.ts';
import { resolvePlatformAccessForBusiness } from '../auth/platform-access.ts';
import { requireAuth, requireSuperadmin } from '../auth/middleware.ts';
import { handleWhatsappMessage } from '../whatsapp/message-handler.ts';
import { resolveOwnerPhoneForBusiness } from '../whatsapp/tenant-resolver.ts';

const router = express.Router();

router.use(requireAuth, requireSuperadmin);

router.post('/simulate', async (req, res) => {
  try {
    const businessId = String(req.body?.businessId ?? '').trim();
    const message = String(req.body?.message ?? '').trim();
    let phone = String(req.body?.phone ?? '').trim();

    if (!businessId || !message) {
      return res.status(400).json({ error: 'businessId y message son obligatorios.' });
    }

    const business = await getBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Empresa no encontrada.' });
    }

    if (!phone) {
      phone =
        (await resolveOwnerPhoneForBusiness(businessId)) ??
        business.contactVerification?.phone?.trim() ??
        '';
    }

    if (!phone) {
      return res.status(400).json({
        error: 'Indicá un teléfono autorizado o registrá un usuario WhatsApp para la empresa.',
      });
    }

    const platformAccess = business.platformAccess ?? resolvePlatformAccessForBusiness({});
    if (!platformAccess.whatsappEnabled) {
      return res.status(400).json({ error: 'WhatsApp no habilitado para esta empresa.' });
    }

    const result = await handleWhatsappMessage({
      from: phone,
      text: message,
    });

    res.json({
      result,
      platformAccess,
    });
  } catch (error) {
    console.error('[platform-bot] simulate error:', error);
    res.status(500).json({ error: 'No se pudo simular el mensaje.' });
  }
});

export default router;
