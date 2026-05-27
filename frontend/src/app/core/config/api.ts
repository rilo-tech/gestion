const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim();

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  if (!rawApiBaseUrl) return '';
  return trimTrailingSlashes(rawApiBaseUrl);
}

export function resolveApiUrl(url: string): string {
  if (!url.startsWith('/api/')) return url;
  const base = getApiBaseUrl();
  if (!base) return url;
  return `${base}${url}`;
}

