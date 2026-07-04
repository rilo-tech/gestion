import express from 'express';
import { requireAuth } from '../auth/middleware.ts';

const router = express.Router();

router.get('/plans', (_req, res) => {
  res.json({
    message: 'Selección de plan disponible próximamente con Mercado Pago.',
    available: false,
  });
});

router.post('/create-subscription', requireAuth, (_req, res) => {
  res.status(501).json({
    error: 'La activación con Mercado Pago se habilitará en la Fase 2.',
    phase: 2,
  });
});

export default router;
