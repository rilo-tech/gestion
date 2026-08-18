import express from 'express';
import { getCommercialCatalog } from '../auth/commercial-catalog.ts';
import {
  extraUserMonthlyFor,
  overlayProductsForCountry,
  litePitch,
} from '../../shared/commercial-catalog.ts';
import { TRIAL_PRODUCT_DESCRIPTIONS, TRIAL_PRODUCT_LABELS } from '../../shared/platform-access.ts';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const catalog = await getCommercialCatalog();
    const country = String(req.query.country ?? 'UY').toUpperCase() === 'AR' ? 'AR' : 'UY';
    const extraUser = extraUserMonthlyFor(catalog, country);
    const products = overlayProductsForCountry(catalog, country).map((row) => ({
      id: row.id,
      label: TRIAL_PRODUCT_LABELS[row.id],
      description: TRIAL_PRODUCT_DESCRIPTIONS[row.id],
      whatsapp: row.id !== 'erp',
      panel: row.id !== 'whatsapp',
      featured: row.id === 'whatsapp',
      trialDays: catalog.trialDays,
      includedAi: row.includedAi,
      amountMonthly: row.amountMonthly,
      amountYearly: row.amountYearly,
      extraUserMonthly: extraUser,
      priceLabel: row.priceLabel,
      priceLabelYearly: row.priceLabelYearly,
    }));
    res.json({
      country,
      trialDays: catalog.trialDays,
      trialAccionesIaMes: catalog.trialAccionesIaMes,
      lite: catalog.lite,
      introDiscountMonths: catalog.introDiscountMonths,
      introDiscountPercent: catalog.introDiscountPercent,
      extraUserMonthly: extraUser,
      litePitch: litePitch(catalog),
      products,
      updatedAt: catalog.updatedAt,
    });
  } catch (error) {
    console.error('Error loading public commercial catalog:', error);
    res.status(500).json({ error: 'No se pudo cargar el catálogo comercial.' });
  }
});

export default router;
