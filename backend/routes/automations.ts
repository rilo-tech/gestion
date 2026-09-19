import type { AuthenticatedRequest } from '../auth/middleware.ts';
import { createCompanyRouter } from './create-company-router.ts';
import {
  countUnreadOpenNotices,
  listErpNotices,
  markAllOpenNoticesReadForUser,
  markNoticeReadForUser,
  updateErpNoticeStatus,
} from '../automation/erp-notices.ts';
import {
  detectAttentionItems,
  summarizeAttentionItems,
  syncAttentionNotices,
} from '../automation/attention-sync.ts';
import {
  listPresetViews,
  listProgressiveOffers,
  neverShowPreset,
  respondProgressiveOffer,
  setPresetEnabled,
  enableStandardRecommendedAlerts,
} from '../automation/automation-presets-service.ts';
import { loadAutomationUserPrefs, saveAutomationUserPrefs } from '../automation/automation-prefs.ts';
import type { AutomationPresetId } from '../../shared/automation-presets.ts';
import type { AutomationOfferId } from '../../shared/erp-notices.ts';
import type { AutomationChannel } from '../../shared/automation-channels.ts';
import type { ErpNoticeStatus } from '../../shared/erp-notices.ts';
import { emitAnalyticsEvent } from '../analytics/analytics-event-service.ts';

export const AUTOMATIONS_ROUTE_CONTRACT = [
  { method: 'GET', path: '/:businessId/automations/presets' },
  { method: 'POST', path: '/:businessId/automations/presets/:presetId' },
  { method: 'POST', path: '/:businessId/automations/presets/:presetId/never' },
  { method: 'POST', path: '/:businessId/automations/recommended' },
  { method: 'GET', path: '/:businessId/automations/notices' },
  { method: 'GET', path: '/:businessId/automations/notices/badge' },
  { method: 'GET', path: '/:businessId/automations/notices/attention' },
  { method: 'POST', path: '/:businessId/automations/notices/sync' },
  { method: 'POST', path: '/:businessId/automations/notices/mark-all-read' },
  { method: 'POST', path: '/:businessId/automations/notices/:noticeId' },
  { method: 'POST', path: '/:businessId/automations/notices/:noticeId/read' },
  { method: 'GET', path: '/:businessId/automations/offers' },
  { method: 'POST', path: '/:businessId/automations/offers/:offerId' },
  { method: 'GET', path: '/:businessId/automations/prefs' },
  { method: 'POST', path: '/:businessId/automations/prefs' },
] as const;

const router = createCompanyRouter();

function actorOf(req: AuthenticatedRequest): string {
  if (req.auth?.scope === 'platform') return `platform:${req.auth.userId}`;
  return `company:${req.auth?.userId ?? 'unknown'}`;
}

function userIdOf(req: AuthenticatedRequest): string {
  return String(req.auth?.userId ?? 'anonymous');
}

router.get('/:businessId/automations/presets', async (req, res) => {
  try {
    const data = await listPresetViews(req.params.businessId);
    res.json(data);
  } catch (error) {
    console.error('Error listing automation presets:', error);
    res.status(500).json({ error: 'No se pudieron cargar las automatizaciones.' });
  }
});

router.post('/:businessId/automations/presets/:presetId', async (req: AuthenticatedRequest, res) => {
  try {
    const presetId = req.params.presetId as AutomationPresetId;
    const enabled = req.body?.enabled === true;
    const time = typeof req.body?.time === 'string' ? req.body.time : undefined;
    const channels = Array.isArray(req.body?.channels)
      ? (req.body.channels as AutomationChannel[])
      : undefined;
    const view = await setPresetEnabled({
      businessId: req.params.businessId,
      presetId,
      enabled,
      time,
      channels,
      actor: actorOf(req),
    });
    res.json({ preset: view });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'PRESET_UNKNOWN') return res.status(404).json({ error: 'Aviso no encontrado.' });
    if (code === 'AUTOMATION_ACTION_NOT_AVAILABLE') {
      return res.status(400).json({ error: 'Este aviso no está disponible en tu plan.' });
    }
    if (code === 'NO_CHANNELS_FOR_PLAN') {
      return res.status(400).json({ error: 'Tu plan actual no tiene canal de avisos activo.' });
    }
    if (code === 'WHATSAPP_RECIPIENT_REQUIRED') {
      return res.status(400).json({
        error: 'Conectá un número de WhatsApp antes de activar avisos por WhatsApp.',
      });
    }
    console.error('Error updating automation preset:', error);
    res.status(500).json({ error: 'No se pudo actualizar el aviso.' });
  }
});

router.post(
  '/:businessId/automations/presets/:presetId/never',
  async (req: AuthenticatedRequest, res) => {
    try {
      await neverShowPreset(req.params.businessId, req.params.presetId as AutomationPresetId);
      res.json({ ok: true });
    } catch (error) {
      console.error('Error muting preset:', error);
      res.status(500).json({ error: 'No se pudo ocultar el aviso.' });
    }
  }
);

router.post('/:businessId/automations/recommended', async (req: AuthenticatedRequest, res) => {
  try {
    const presets = await enableStandardRecommendedAlerts({
      businessId: req.params.businessId,
      actor: actorOf(req),
    });
    res.json({ presets });
  } catch (error) {
    console.error('Error enabling recommended automations:', error);
    res.status(500).json({ error: 'No se pudieron activar los avisos recomendados.' });
  }
});

router.get('/:businessId/automations/notices', async (req: AuthenticatedRequest, res) => {
  try {
    const sync = String(req.query.sync ?? '') === '1';
    if (sync) {
      await syncAttentionNotices(req.params.businessId);
    }
    const tab = String(req.query.tab ?? 'hoy');
    const userId = userIdOf(req);
    let statuses: ErpNoticeStatus[] = ['open'];
    if (tab === 'resueltos') statuses = ['resolved'];
    else if (tab === 'proximos') statuses = ['open'];
    else if (tab === 'all') statuses = ['open', 'resolved'];

    const notices = await listErpNotices(req.params.businessId, {
      status: statuses,
      limit: tab === 'resueltos' ? 40 : 40,
      userId,
    });

    let filtered = notices;
    if (tab === 'proximos') {
      const today = new Date().toISOString().slice(0, 10);
      filtered = notices.filter(
        (n) => n.status === 'open' && n.dueAt && String(n.dueAt).slice(0, 10) > today
      );
    } else if (tab === 'hoy') {
      const today = new Date().toISOString().slice(0, 10);
      filtered = notices.filter((n) => {
        if (n.status !== 'open') return false;
        if (!n.dueAt) return true;
        return String(n.dueAt).slice(0, 10) <= today;
      });
    }

    const unread = await countUnreadOpenNotices(req.params.businessId, userId);
    res.json({ notices: filtered, unreadCount: unread });
  } catch (error) {
    console.error('Error listing ERP notices:', error);
    res.status(500).json({ error: 'No se pudieron cargar los avisos.' });
  }
});

router.get('/:businessId/automations/notices/badge', async (req: AuthenticatedRequest, res) => {
  try {
    const unreadCount = await countUnreadOpenNotices(req.params.businessId, userIdOf(req));
    const open = await listErpNotices(req.params.businessId, {
      status: 'open',
      limit: 5,
      userId: userIdOf(req),
    });
    res.json({ unreadCount, preview: open });
  } catch (error) {
    console.error('Error badge notices:', error);
    res.status(500).json({ error: 'No se pudo cargar el badge.' });
  }
});

router.get('/:businessId/automations/notices/attention', async (req, res) => {
  try {
    const items = await detectAttentionItems(req.params.businessId);
    const summary = summarizeAttentionItems(items);
    res.json({ ...summary, items: items.slice(0, 20) });
  } catch (error) {
    console.error('Error attention summary:', error);
    res.status(500).json({ error: 'No se pudo cargar la atención.' });
  }
});

router.post('/:businessId/automations/notices/sync', async (req, res) => {
  try {
    const result = await syncAttentionNotices(req.params.businessId);
    void emitAnalyticsEvent({
      name: 'notification_synced',
      businessId: req.params.businessId,
      props: { upserted: result.upserted, resolved: result.resolved },
    }).catch(() => undefined);
    res.json(result);
  } catch (error) {
    console.error('Error syncing notices:', error);
    res.status(500).json({ error: 'No se pudieron sincronizar los avisos.' });
  }
});

router.post('/:businessId/automations/notices/mark-all-read', async (req: AuthenticatedRequest, res) => {
  try {
    const count = await markAllOpenNoticesReadForUser(req.params.businessId, userIdOf(req));
    res.json({ ok: true, count });
  } catch (error) {
    console.error('Error mark all read:', error);
    res.status(500).json({ error: 'No se pudieron marcar como leídos.' });
  }
});

router.post('/:businessId/automations/notices/:noticeId/read', async (req: AuthenticatedRequest, res) => {
  try {
    await markNoticeReadForUser(req.params.businessId, userIdOf(req), req.params.noticeId);
    void emitAnalyticsEvent({
      name: 'notification_opened',
      businessId: req.params.businessId,
      props: { noticeId: req.params.noticeId },
    }).catch(() => undefined);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error mark read:', error);
    res.status(500).json({ error: 'No se pudo marcar como leído.' });
  }
});

router.post('/:businessId/automations/notices/:noticeId', async (req, res) => {
  try {
    const status = String(req.body?.status ?? '') as ErpNoticeStatus;
    if (!['resolved', 'hidden', 'muted', 'open'].includes(status)) {
      return res.status(400).json({ error: 'Estado inválido.' });
    }
    const notice = await updateErpNoticeStatus(req.params.businessId, req.params.noticeId, status);
    if (!notice) return res.status(404).json({ error: 'Aviso no encontrado.' });
    if (status === 'resolved') {
      void emitAnalyticsEvent({
        name: 'notification_resolved',
        businessId: req.params.businessId,
        props: { noticeId: req.params.noticeId, manual: true },
      }).catch(() => undefined);
    }
    res.json({ notice });
  } catch (error) {
    console.error('Error updating ERP notice:', error);
    res.status(500).json({ error: 'No se pudo actualizar el aviso.' });
  }
});

router.get('/:businessId/automations/offers', async (req, res) => {
  try {
    const offers = await listProgressiveOffers(req.params.businessId);
    res.json({ offers });
  } catch (error) {
    console.error('Error listing offers:', error);
    res.status(500).json({ error: 'No se pudieron cargar las sugerencias.' });
  }
});

router.post('/:businessId/automations/offers/:offerId', async (req: AuthenticatedRequest, res) => {
  try {
    const choice = String(req.body?.choice ?? '');
    if (choice !== 'accepted' && choice !== 'deferred' && choice !== 'declined') {
      return res.status(400).json({ error: 'Opción inválida.' });
    }
    const result = await respondProgressiveOffer({
      businessId: req.params.businessId,
      offerId: req.params.offerId as AutomationOfferId,
      choice,
      time: typeof req.body?.time === 'string' ? req.body.time : undefined,
      actor: actorOf(req),
    });
    res.json(result);
  } catch (error) {
    console.error('Error responding offer:', error);
    res.status(500).json({ error: 'No se pudo guardar la elección.' });
  }
});

router.get('/:businessId/automations/prefs', async (req, res) => {
  try {
    const prefs = await loadAutomationUserPrefs(req.params.businessId);
    res.json({ prefs });
  } catch (error) {
    console.error('Error loading automation prefs:', error);
    res.status(500).json({ error: 'No se pudieron cargar las preferencias.' });
  }
});

router.post('/:businessId/automations/prefs', async (req, res) => {
  try {
    const prefs = await saveAutomationUserPrefs(req.params.businessId, {
      preferredChannels: Array.isArray(req.body?.preferredChannels)
        ? req.body.preferredChannels
        : undefined,
    });
    res.json({ prefs });
  } catch (error) {
    console.error('Error saving automation prefs:', error);
    res.status(500).json({ error: 'No se pudieron guardar las preferencias.' });
  }
});

export default router;
