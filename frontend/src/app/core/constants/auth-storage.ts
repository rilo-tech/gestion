export const AUTH_TOKEN_STORAGE_KEY = 'rilo-auth-token';
export const AUTH_BUSINESS_STORAGE_KEY = 'rilo-auth-business-id';
export const DEFAULT_BUSINESS_ID = 'rilo-default';

export function trialBannerDismissStorageKey(businessId: string): string {
  return `rilo-trial-banner-dismissed:${businessId}`;
}

export function getStoredBusinessId(fallback = DEFAULT_BUSINESS_ID): string {
  return localStorage.getItem(AUTH_BUSINESS_STORAGE_KEY) ?? fallback;
}
