import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { AuthService } from './auth.service';

export type AutomationChannel = 'whatsapp' | 'erp';

export type AutomationPresetId =
  | 'daily_summary'
  | 'daily_attention'
  | 'cash_summary'
  | 'cash_weekly_categories'
  | 'cash_monthly_categories'
  | 'cash_soft_nudge'
  | 'orders_due_today'
  | 'orders_status_review'
  | 'overdue_orders'
  | 'pending_balances'
  | 'payment_promises_due'
  | 'payables_due'
  | 'low_stock';

export type RiloNoticeSeverity = 'info' | 'attention' | 'urgent';

export type AutomationPresetView = {
  preset: {
    id: AutomationPresetId;
    label: string;
    blurb: string;
    icon: string;
    defaultTime?: string;
    scheduleRequired: boolean;
  };
  enabled: boolean;
  automationId: string | null;
  time: string | null;
  channels: AutomationChannel[];
  available: boolean;
  unavailableReason?: string;
};

export type ErpNoticeDto = {
  id: string;
  title: string;
  body: string;
  route?: string | null;
  status: string;
  createdAt: string;
  presetId?: string | null;
  type?: string;
  severity?: RiloNoticeSeverity;
  unread?: boolean;
  userReadAt?: string | null;
  dueAt?: string | null;
  actionKind?: string | null;
  actionLabel?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  resolvedAt?: string | null;
};

export type ErpNoticesTab = 'hoy' | 'proximos' | 'resueltos';

export type AttentionSummaryDto = {
  count: number;
  lines: string[];
  items?: unknown[];
};

export type NoticesBadgeDto = {
  unreadCount: number;
  preview: ErpNoticeDto[];
};

export type ProgressiveOfferDto = {
  id: string;
  presetId: AutomationPresetId;
  title: string;
  body: string;
};

@Injectable({ providedIn: 'root' })
export class AutomationsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private get businessId(): string {
    return this.auth.currentBusinessId || '';
  }

  private noticesBase(): string {
    return `/api/business/${this.businessId}/automations/notices`;
  }

  listPresets() {
    return this.http.get<{
      presets: AutomationPresetView[];
      allowedChannels: AutomationChannel[];
      productId: string | null;
    }>(`/api/business/${this.businessId}/automations/presets`);
  }

  setPreset(
    presetId: AutomationPresetId,
    payload: { enabled: boolean; time?: string; channels?: AutomationChannel[] }
  ) {
    return this.http.post<{ preset: AutomationPresetView }>(
      `/api/business/${this.businessId}/automations/presets/${presetId}`,
      payload
    );
  }

  neverShowPreset(presetId: AutomationPresetId) {
    return this.http.post<{ ok: boolean }>(
      `/api/business/${this.businessId}/automations/presets/${presetId}/never`,
      {}
    );
  }

  /** @deprecated Prefer listNotices({ tab, sync }). */
  listNotices(opts?: { tab?: ErpNoticesTab; sync?: boolean }) {
    let params = new HttpParams();
    if (opts?.tab) params = params.set('tab', opts.tab);
    if (opts?.sync) params = params.set('sync', '1');
    return this.http.get<{ notices: ErpNoticeDto[]; unreadCount?: number }>(this.noticesBase(), {
      params,
    });
  }

  badge() {
    return this.http.get<NoticesBadgeDto>(`${this.noticesBase()}/badge`);
  }

  attentionSummary() {
    return this.http.get<AttentionSummaryDto>(`${this.noticesBase()}/attention`);
  }

  syncNotices() {
    return this.http.post<{ upserted: number; resolved: number }>(`${this.noticesBase()}/sync`, {});
  }

  markRead(noticeId: string) {
    return this.http.post<{ ok: boolean }>(`${this.noticesBase()}/${noticeId}/read`, {});
  }

  markAllRead() {
    return this.http.post<{ ok: boolean; count: number }>(`${this.noticesBase()}/mark-all-read`, {});
  }

  updateNotice(noticeId: string, status: 'resolved' | 'hidden' | 'muted' | 'open') {
    return this.http.post<{ notice: ErpNoticeDto }>(`${this.noticesBase()}/${noticeId}`, {
      status,
    });
  }

  listOffers() {
    return this.http.get<{ offers: ProgressiveOfferDto[] }>(
      `/api/business/${this.businessId}/automations/offers`
    );
  }

  respondOffer(
    offerId: string,
    choice: 'accepted' | 'deferred' | 'declined',
    time?: string
  ) {
    return this.http.post(`/api/business/${this.businessId}/automations/offers/${offerId}`, {
      choice,
      time,
    });
  }

  enableRecommended() {
    return this.http.post<{ presets: AutomationPresetView[] }>(
      `/api/business/${this.businessId}/automations/recommended`,
      {}
    );
  }
}
