import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';

export type AnalyticsEventName =
  | 'landing_view'
  | 'demo_view'
  | 'start_trial_click'
  | 'registration_started'
  | 'registration_completed'
  | 'email_verified'
  | 'whatsapp_opened'
  | 'first_bot_message'
  | 'first_operation_completed'
  | 'third_operation_completed'
  | 'erp_first_login'
  | 'returned_day_2'
  | 'returned_day_7'
  | 'pricing_view'
  | 'checkout_started'
  | 'subscription_paid'
  | 'campaign_landing_view';

export type UtmAttribution = {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  campaignSource?: string | null;
  landingPath?: string | null;
};

const UTM_STORAGE_KEY = 'rilo_attribution_v1';

function readQueryAttribution(search: string): UtmAttribution {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const pick = (key: string) => {
    const value = params.get(key);
    return value && value.trim() ? value.trim() : null;
  };
  return {
    utmSource: pick('utm_source'),
    utmMedium: pick('utm_medium'),
    utmCampaign: pick('utm_campaign'),
    utmContent: pick('utm_content'),
    utmTerm: pick('utm_term'),
    fbclid: pick('fbclid'),
    gclid: pick('gclid'),
    campaignSource: pick('campaignSource') || pick('campaign_source'),
  };
}

function mergeAttribution(base: UtmAttribution, next: UtmAttribution): UtmAttribution {
  return {
    utmSource: next.utmSource || base.utmSource || null,
    utmMedium: next.utmMedium || base.utmMedium || null,
    utmCampaign: next.utmCampaign || base.utmCampaign || null,
    utmContent: next.utmContent || base.utmContent || null,
    utmTerm: next.utmTerm || base.utmTerm || null,
    fbclid: next.fbclid || base.fbclid || null,
    gclid: next.gclid || base.gclid || null,
    campaignSource: next.campaignSource || base.campaignSource || null,
    landingPath: next.landingPath || base.landingPath || null,
  };
}

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

/**
 * Analytics FRONTEND (landing / funnel web).
 * Emite solo eventos de producto web; NO secrets Meta/GA4.
 *
 * FRONTEND emite:
 * - landing_view, demo_view, campaign_landing_view, pricing_view
 * - start_trial_click, registration_started, registration_completed
 * - email_verified, whatsapp_opened, checkout_started
 *
 * BACKEND emite (ver backend/analytics/analytics-event-service.ts):
 * - first_bot_message, first_operation_completed, third_operation_completed
 * - subscription_paid (y erp_first_login cuando se cablee)
 *
 * Tipados abajo incluyen nombres backend para no romper dataLayer tipado,
 * pero el FE no debe inventar milestonos de bot.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private auth = inject(AuthService, { optional: true });

  captureAttributionFromUrl(url = typeof window !== 'undefined' ? window.location.href : ''): UtmAttribution {
    if (typeof window === 'undefined') return this.getAttribution();
    try {
      const parsed = new URL(url, window.location.origin);
      const fromQuery = readQueryAttribution(parsed.search);
      const prev = this.getAttribution();
      const merged = mergeAttribution(prev, {
        ...fromQuery,
        landingPath: prev.landingPath || parsed.pathname || null,
      });
      sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(merged));
      return merged;
    } catch {
      return this.getAttribution();
    }
  }

  getAttribution(): UtmAttribution {
    if (typeof window === 'undefined') return {};
    try {
      const raw = sessionStorage.getItem(UTM_STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as UtmAttribution;
    } catch {
      return {};
    }
  }

  mergeAttribution(next: UtmAttribution): UtmAttribution {
    const merged = mergeAttribution(this.getAttribution(), next);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(merged));
    }
    return merged;
  }

  attributionForRegistration(): Record<string, string | null | undefined> {
    const a = this.getAttribution();
    return {
      utmSource: a.utmSource ?? undefined,
      utmMedium: a.utmMedium ?? undefined,
      utmCampaign: a.utmCampaign ?? undefined,
      utmContent: a.utmContent ?? undefined,
      utmTerm: a.utmTerm ?? undefined,
      fbclid: a.fbclid ?? undefined,
      gclid: a.gclid ?? undefined,
      campaignSource: a.campaignSource ?? undefined,
      landingPath: a.landingPath ?? undefined,
    };
  }

  track(event: AnalyticsEventName, props: Record<string, unknown> = {}): void {
    const attribution = this.getAttribution();
    const payload = {
      event,
      environment:
        typeof import.meta !== 'undefined'
          ? String((import.meta as { env?: { VITE_RILO_ENV?: string } }).env?.VITE_RILO_ENV || 'unknown')
          : 'unknown',
      ...props,
      ...attribution,
      businessId: this.auth?.currentBusiness?.id ?? null,
      ts: new Date().toISOString(),
    };

    const externalOk =
      typeof import.meta !== 'undefined' &&
      (import.meta as { env?: { VITE_RILO_ENV?: string; VITE_ANALYTICS_EXTERNAL?: string } }).env
        ?.VITE_RILO_ENV === 'staging'
        ? (import.meta as { env?: { VITE_ANALYTICS_EXTERNAL?: string } }).env?.VITE_ANALYTICS_EXTERNAL ===
          'true'
        : (import.meta as { env?: { VITE_RILO_ENV?: string } }).env?.VITE_RILO_ENV !== 'local';

    if (typeof window !== 'undefined') {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(payload);
      if (externalOk && typeof window.gtag === 'function') {
        window.gtag('event', event, payload);
      }
      if (
        externalOk &&
        typeof window.fbq === 'function' &&
        (event === 'registration_completed' || event === 'start_trial_click')
      ) {
        window.fbq('trackCustom', event, payload);
      }
    }

    if (
      typeof import.meta !== 'undefined' &&
      ((import.meta as { env?: { DEV?: boolean; VITE_RILO_ENV?: string } }).env?.DEV ||
        (import.meta as { env?: { VITE_RILO_ENV?: string } }).env?.VITE_RILO_ENV === 'staging')
    ) {
      console.info('[analytics]', event, payload);
    }
  }
}
