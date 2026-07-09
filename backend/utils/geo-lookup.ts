import type { GeoCountryOption } from '../../shared/geo.ts';

const COUNTRIES_CODES_URL = 'https://countriesnow.space/api/v0.1/countries/codes';
const CITIES_API_URL = 'https://countriesnow.space/api/v0.1/countries/cities';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`FETCH_FAILED:${response.status}`);
  }
  return (await response.json()) as T;
}

type CountriesNowCode = {
  name?: string;
  code?: string;
  dial_code?: string;
};

let countriesCache: { fetchedAt: number; countries: GeoCountryOption[] } | null = null;
const citiesCache = new Map<string, { fetchedAt: number; cities: string[] }>();

const spanishRegionNames =
  typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['es'], { type: 'region' })
    : null;

function isFresh(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < CACHE_TTL_MS;
}

function spanishCountryName(iso2: string, fallbackEn: string): string {
  const localized = spanishRegionNames?.of(iso2);
  return localized && localized !== iso2 ? localized : fallbackEn;
}

function normalizeDialCode(dialCode: string): string {
  return dialCode.replace(/\D/g, '');
}

export async function listGeoCountries(): Promise<GeoCountryOption[]> {
  if (countriesCache && isFresh(countriesCache.fetchedAt)) {
    return countriesCache.countries;
  }

  const payload = await fetchJson<{ error?: boolean; data?: CountriesNowCode[] }>(
    COUNTRIES_CODES_URL
  );
  if (payload.error || !Array.isArray(payload.data)) {
    throw new Error('COUNTRIES_FETCH_FAILED');
  }

  const countries = payload.data
    .map((country) => {
      const iso2 = String(country.code ?? '').trim().toUpperCase();
      const nameEn = String(country.name ?? '').trim();
      const dialCode = normalizeDialCode(String(country.dial_code ?? ''));
      if (!iso2 || !nameEn || !dialCode) return null;
      const nameEs = spanishCountryName(iso2, nameEn);
      return { iso2, nameEs, nameEn, dialCode };
    })
    .filter((country): country is GeoCountryOption => country !== null)
    .sort((a, b) => a.nameEs.localeCompare(b.nameEs, 'es', { sensitivity: 'base' }));

  countriesCache = { fetchedAt: Date.now(), countries };
  return countries;
}

export async function listGeoCities(countryEn: string): Promise<string[]> {
  const key = countryEn.trim().toLowerCase();
  if (!key) return [];

  const cached = citiesCache.get(key);
  if (cached && isFresh(cached.fetchedAt)) {
    return cached.cities;
  }

  const payload = await fetchJson<{ error?: boolean; data?: string[] }>(CITIES_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ country: countryEn.trim() }),
  });

  if (payload.error || !Array.isArray(payload.data)) {
    throw new Error('CITIES_FETCH_FAILED');
  }

  const cities = payload.data
    .map((city) => String(city).trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  citiesCache.set(key, { fetchedAt: Date.now(), cities });
  return cities;
}

export async function findGeoCountryBySpanishName(
  nameEs: string
): Promise<GeoCountryOption | null> {
  const normalized = nameEs.trim().toLowerCase();
  if (!normalized) return null;
  const countries = await listGeoCountries();
  return (
    countries.find((country) => country.nameEs.toLowerCase() === normalized) ??
    countries.find((country) => country.nameEn.toLowerCase() === normalized) ??
    null
  );
}
