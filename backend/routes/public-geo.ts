import express from 'express';
import { checkRateLimit, clientIp } from '../utils/rate-limit.ts';
import {
  findGeoCountryBySpanishName,
  listGeoCities,
  listGeoCountries,
} from '../utils/geo-lookup.ts';

const router = express.Router();

router.get('/countries', async (req, res) => {
  try {
    const ip = clientIp(req);
    const limit = checkRateLimit(`geo-countries:${ip}`, 30, 60 * 60 * 1000);
    if (!limit.allowed) {
      return res.status(429).json({ error: 'Demasiadas consultas. Probá más tarde.' });
    }

    const countries = await listGeoCountries();
    res.json({ countries });
  } catch (error) {
    console.error('Geo countries error:', error);
    res.status(503).json({ error: 'No se pudieron cargar los países.' });
  }
});

router.post('/cities', async (req, res) => {
  try {
    const ip = clientIp(req);
    const limit = checkRateLimit(`geo-cities:${ip}`, 60, 60 * 60 * 1000);
    if (!limit.allowed) {
      return res.status(429).json({ error: 'Demasiadas consultas. Probá más tarde.' });
    }

    const countryEs = String(req.body.countryEs ?? req.body.country ?? '').trim();
    const countryEn = String(req.body.countryEn ?? '').trim();

    let resolvedEn = countryEn;
    if (!resolvedEn && countryEs) {
      const match = await findGeoCountryBySpanishName(countryEs);
      resolvedEn = match?.nameEn ?? '';
    }

    if (!resolvedEn) {
      return res.status(400).json({ error: 'Seleccioná un país válido.' });
    }

    const cities = await listGeoCities(resolvedEn);
    res.json({ countryEn: resolvedEn, cities });
  } catch (error) {
    console.error('Geo cities error:', error);
    res.status(503).json({ error: 'No se pudieron cargar las ciudades.' });
  }
});

export default router;
