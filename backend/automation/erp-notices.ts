/**
 * Persistencia y ciclo de vida de avisos RILO (erp_notices).
 * Situación open/resolved = negocio. Leído = por usuario.
 */
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase.ts';
import type { AutomationActionId } from '../../shared/automation-types.ts';
import type { AutomationPresetId } from '../../shared/automation-presets.ts';
import {
  MAX_OPEN_ERP_NOTICES,
  RESOLVED_NOTICE_RETENTION_DAYS,
  severityForNoticeType,
  type AttentionItem,
  type ErpNotice,
  type ErpNoticeStatus,
  type ErpNoticeWithUserState,
  type RiloNoticeActionKind,
  type RiloNoticeSeverity,
  type RiloNoticeType,
} from '../../shared/erp-notices.ts';

function noticesCol(businessId: string) {
  return db.collection(`negocios/${businessId}/erp_notices`);
}

function userReadsDoc(businessId: string, userId: string) {
  return db.doc(`negocios/${businessId}/private/notice_reads_${userId}`);
}

function mapNotice(id: string, businessId: string, data: Record<string, unknown>): ErpNotice {
  const type = (String(data.type ?? 'generic') || 'generic') as RiloNoticeType;
  const dedupeKey = String(data.dedupeKey ?? data.fingerprint ?? id);
  return {
    id,
    businessId,
    automationId: data.automationId != null ? String(data.automationId) : null,
    actionId: String(data.actionId ?? 'generic'),
    presetId: (data.presetId as AutomationPresetId | null | undefined) ?? null,
    type,
    severity: (String(data.severity ?? severityForNoticeType(type)) || 'attention') as RiloNoticeSeverity,
    title: String(data.title ?? ''),
    body: String(data.body ?? ''),
    route: data.route != null ? String(data.route) : null,
    dedupeKey,
    fingerprint: String(data.fingerprint ?? dedupeKey),
    entityType: data.entityType != null ? String(data.entityType) : null,
    entityId: data.entityId != null ? String(data.entityId) : null,
    dueAt: data.dueAt != null ? String(data.dueAt) : null,
    actionKind: (data.actionKind as RiloNoticeActionKind | null | undefined) ?? null,
    actionLabel: data.actionLabel != null ? String(data.actionLabel) : null,
    source: (String(data.source ?? 'automation') as ErpNotice['source']) || 'automation',
    status: String(data.status ?? 'open') as ErpNoticeStatus,
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? ''),
    resolvedAt: data.resolvedAt != null ? String(data.resolvedAt) : null,
    dismissedAt: data.dismissedAt != null ? String(data.dismissedAt) : null,
    readAt: data.readAt != null ? String(data.readAt) : null,
  };
}

export function buildNoticeFingerprint(input: {
  actionId: string;
  title: string;
  body: string;
  dayKey: string;
}): string {
  const raw = `${input.actionId}|${input.dayKey}|${input.title}|${input.body}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

const ACTION_ROUTES: Partial<Record<string, string>> = {
  daily_business_summary: '/inicio',
  daily_attention_digest: '/avisos',
  cash_daily_summary: '/cash',
  cash_balance_watch: '/cash',
  cash_expenses_summary: '/cash',
  cash_wallet_period_summary: '/cash',
  cash_no_movements_soft: '/cash',
  pending_orders_summary: '/pedidos',
  orders_due_today: '/pedidos',
  orders_status_review: '/pedidos',
  overdue_orders_watch: '/pedidos',
  customer_balances_summary: '/clientes',
  customer_balance_watch: '/clientes',
  customer_payment_promises_due: '/clientes',
  low_stock_summary: '/stock',
  product_stock_threshold_watch: '/stock',
  payables_due_reminder: '/cuentas-pagar',
};

export function routeForAction(actionId: AutomationActionId | string): string | null {
  return ACTION_ROUTES[actionId] ?? null;
}

async function loadUserReads(
  businessId: string,
  userId: string | null | undefined
): Promise<Record<string, string>> {
  if (!userId) return {};
  const snap = await userReadsDoc(businessId, userId).get();
  if (!snap.exists) return {};
  const data = snap.data() as Record<string, unknown>;
  const reads = (data.reads as Record<string, string> | undefined) ?? {};
  return reads && typeof reads === 'object' ? reads : {};
}

function withUserState(notice: ErpNotice, reads: Record<string, string>): ErpNoticeWithUserState {
  const userReadAt = reads[notice.id] ?? null;
  const unread = notice.status === 'open' && !userReadAt;
  return { ...notice, userReadAt, unread };
}

export async function listErpNotices(
  businessId: string,
  options?: {
    status?: ErpNoticeStatus | ErpNoticeStatus[];
    limit?: number;
    userId?: string | null;
    includeUpcoming?: boolean;
  }
): Promise<ErpNoticeWithUserState[]> {
  const snap = await noticesCol(businessId).orderBy('createdAt', 'desc').limit(120).get();
  const statuses = options?.status
    ? Array.isArray(options.status)
      ? options.status
      : [options.status]
    : (['open'] as ErpNoticeStatus[]);
  const limit = options?.limit ?? MAX_OPEN_ERP_NOTICES;
  const reads = await loadUserReads(businessId, options?.userId);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RESOLVED_NOTICE_RETENTION_DAYS);
  const cutoffIso = cutoff.toISOString();

  return snap.docs
    .map((doc) => mapNotice(doc.id, businessId, doc.data() as Record<string, unknown>))
    .filter((row) => {
      if (!statuses.includes(row.status)) return false;
      if (row.status === 'resolved' && row.resolvedAt && row.resolvedAt < cutoffIso) return false;
      return true;
    })
    .map((row) => withUserState(row, reads))
    .slice(0, limit);
}

export async function countUnreadOpenNotices(
  businessId: string,
  userId: string
): Promise<number> {
  const [openSnap, reads] = await Promise.all([
    noticesCol(businessId).where('status', '==', 'open').get(),
    loadUserReads(businessId, userId),
  ]);
  let count = 0;
  for (const doc of openSnap.docs) {
    if (!reads[doc.id]) count += 1;
  }
  return count;
}

export async function createErpNotice(input: {
  businessId: string;
  automationId?: string | null;
  actionId: AutomationActionId | string;
  presetId?: AutomationPresetId | null;
  title: string;
  body: string;
  fingerprint: string;
  route?: string | null;
  type?: RiloNoticeType;
  severity?: RiloNoticeSeverity;
  dedupeKey?: string;
  entityType?: string | null;
  entityId?: string | null;
  dueAt?: string | null;
  actionKind?: RiloNoticeActionKind | null;
  actionLabel?: string | null;
  source?: ErpNotice['source'];
}): Promise<ErpNotice | null> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) return null;

  const dedupeKey = input.dedupeKey || input.fingerprint;
  const existing = await noticesCol(input.businessId)
    .where('fingerprint', '==', dedupeKey)
    .limit(1)
    .get();
  // also try dedupeKey field for new docs
  let existingDoc = existing.empty ? null : existing.docs[0]!;
  if (!existingDoc) {
    const byKey = await noticesCol(input.businessId)
      .where('dedupeKey', '==', dedupeKey)
      .limit(1)
      .get();
    existingDoc = byKey.empty ? null : byKey.docs[0]!;
  }

  if (existingDoc) {
    const current = mapNotice(
      existingDoc.id,
      input.businessId,
      existingDoc.data() as Record<string, unknown>
    );
    if (current.status === 'muted') return null;
    if (current.status === 'open') {
      // Actualizar título/cuerpo/severity sin duplicar
      const now = new Date().toISOString();
      await existingDoc.ref.set(
        {
          title,
          body,
          severity: input.severity ?? current.severity,
          updatedAt: now,
          dueAt: input.dueAt ?? current.dueAt ?? null,
          route: input.route ?? current.route ?? null,
        },
        { merge: true }
      );
      return mapNotice(existingDoc.id, input.businessId, {
        ...existingDoc.data(),
        title,
        body,
        updatedAt: now,
      } as Record<string, unknown>);
    }
    if (current.status === 'resolved') {
      // Reabrir si la situación vuelve
      const now = new Date().toISOString();
      await existingDoc.ref.set(
        {
          status: 'open',
          title,
          body,
          resolvedAt: null,
          dismissedAt: null,
          updatedAt: now,
          severity: input.severity ?? current.severity,
        },
        { merge: true }
      );
      return mapNotice(existingDoc.id, input.businessId, {
        ...existingDoc.data(),
        status: 'open',
        title,
        body,
        resolvedAt: null,
        updatedAt: now,
      } as Record<string, unknown>);
    }
  }

  const openSnap = await noticesCol(input.businessId).where('status', '==', 'open').get();
  if (openSnap.size >= MAX_OPEN_ERP_NOTICES) {
    const oldest = openSnap.docs
      .map((d) => ({ id: d.id, createdAt: String(d.data().createdAt ?? '') }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (oldest) {
      await noticesCol(input.businessId).doc(oldest.id).set(
        { status: 'hidden', updatedAt: new Date().toISOString() },
        { merge: true }
      );
    }
  }

  const now = new Date().toISOString();
  const type = input.type ?? 'generic';
  const ref = noticesCol(input.businessId).doc();
  const payload = {
    automationId: input.automationId ?? null,
    actionId: input.actionId,
    presetId: input.presetId ?? null,
    type,
    severity: input.severity ?? severityForNoticeType(type),
    title,
    body,
    route: input.route ?? routeForAction(input.actionId),
    fingerprint: dedupeKey,
    dedupeKey,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    dueAt: input.dueAt ?? null,
    actionKind: input.actionKind ?? null,
    actionLabel: input.actionLabel ?? null,
    source: input.source ?? 'automation',
    status: 'open' as const,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    dismissedAt: null,
    readAt: null,
  };
  await ref.set(payload);
  return mapNotice(ref.id, input.businessId, payload);
}

/** Upsert por AttentionItem (misma fuente panel/WA). */
export async function upsertAttentionNotice(
  businessId: string,
  item: AttentionItem
): Promise<ErpNotice | null> {
  return createErpNotice({
    businessId,
    actionId: item.actionId ?? item.type,
    presetId: item.presetId ?? null,
    title: item.title,
    body: item.body,
    fingerprint: item.dedupeKey,
    dedupeKey: item.dedupeKey,
    type: item.type,
    severity: item.severity,
    route: item.route,
    entityType: item.entityType,
    entityId: item.entityId,
    dueAt: item.dueAt,
    actionKind: item.actionKind,
    actionLabel: item.actionLabel,
    source: 'attention_sync',
  });
}

export async function resolveNoticeByDedupeKey(
  businessId: string,
  dedupeKey: string
): Promise<void> {
  const snap = await noticesCol(businessId).where('dedupeKey', '==', dedupeKey).limit(5).get();
  const legacy = snap.empty
    ? await noticesCol(businessId).where('fingerprint', '==', dedupeKey).limit(5).get()
    : snap;
  const now = new Date().toISOString();
  const batch = db.batch();
  for (const doc of legacy.docs) {
    const status = String(doc.data().status ?? '');
    if (status !== 'open') continue;
    batch.set(
      doc.ref,
      { status: 'resolved', resolvedAt: now, updatedAt: now, dismissedAt: now },
      { merge: true }
    );
  }
  if (!legacy.empty) await batch.commit();
}

export async function resolveStaleAttentionNotices(
  businessId: string,
  activeKeys: Set<string>
): Promise<number> {
  const snap = await noticesCol(businessId).where('status', '==', 'open').get();
  const now = new Date().toISOString();
  let n = 0;
  const batch = db.batch();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (String(data.source ?? '') !== 'attention_sync') continue;
    const key = String(data.dedupeKey ?? data.fingerprint ?? '');
    if (!key || activeKeys.has(key)) continue;
    batch.set(
      doc.ref,
      { status: 'resolved', resolvedAt: now, updatedAt: now, dismissedAt: now },
      { merge: true }
    );
    n += 1;
  }
  if (n) await batch.commit();
  return n;
}

export async function resolveNoticesMissingKeys(
  businessId: string,
  _typePrefix: string,
  activeKeys: Set<string>
): Promise<number> {
  return resolveStaleAttentionNotices(businessId, activeKeys);
}

export async function updateErpNoticeStatus(
  businessId: string,
  noticeId: string,
  status: ErpNoticeStatus
): Promise<ErpNotice | null> {
  const ref = noticesCol(businessId).doc(noticeId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const now = new Date().toISOString();
  await ref.set(
    {
      status,
      updatedAt: now,
      resolvedAt: status === 'resolved' ? now : null,
      dismissedAt: status === 'hidden' || status === 'muted' || status === 'resolved' ? now : null,
    },
    { merge: true }
  );
  const fresh = await ref.get();
  return mapNotice(fresh.id, businessId, fresh.data() as Record<string, unknown>);
}

export async function markNoticeReadForUser(
  businessId: string,
  userId: string,
  noticeId: string
): Promise<void> {
  const now = new Date().toISOString();
  await userReadsDoc(businessId, userId).set(
    {
      reads: { [noticeId]: now },
      updatedAt: now,
    },
    { merge: true }
  );
}

export async function markAllOpenNoticesReadForUser(
  businessId: string,
  userId: string
): Promise<number> {
  const openSnap = await noticesCol(businessId).where('status', '==', 'open').get();
  const now = new Date().toISOString();
  const reads: Record<string, string> = {};
  for (const doc of openSnap.docs) {
    reads[doc.id] = now;
  }
  await userReadsDoc(businessId, userId).set({ reads, updatedAt: now }, { merge: true });
  return openSnap.size;
}

export async function muteNoticesForPreset(
  businessId: string,
  presetId: AutomationPresetId
): Promise<void> {
  const snap = await noticesCol(businessId).where('presetId', '==', presetId).get();
  const batch = db.batch();
  const now = new Date().toISOString();
  for (const doc of snap.docs) {
    batch.set(doc.ref, { status: 'muted', updatedAt: now, dismissedAt: now }, { merge: true });
  }
  if (!snap.empty) await batch.commit();
}

export async function countOpenNotices(businessId: string): Promise<number> {
  const snap = await noticesCol(businessId).where('status', '==', 'open').count().get();
  return snap.data().count;
}

export async function deleteAllNotices(businessId: string): Promise<void> {
  const snap = await noticesCol(businessId).get();
  const batch = db.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  if (!snap.empty) await batch.commit();
  void FieldValue;
}
