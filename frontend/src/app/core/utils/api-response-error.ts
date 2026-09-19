/** Detecta cuando el cliente esperaba JSON y recibió HTML (típico de SPA sin backend). */
export function isHtmlInsteadOfJsonError(err: unknown): boolean {
  const parts: string[] = [];

  if (err instanceof Error && err.message) {
    parts.push(err.message);
  }

  if (typeof err === 'object' && err !== null) {
    const maybeHttp = err as { error?: unknown; message?: string };
    if (typeof maybeHttp.message === 'string') parts.push(maybeHttp.message);
    if (typeof maybeHttp.error === 'string') parts.push(maybeHttp.error);
    try {
      parts.push(JSON.stringify(maybeHttp.error ?? ''));
    } catch {
      // ignore
    }
  }

  const haystack = parts.join(' ').toLowerCase();
  return (
    haystack.includes('<!doctype') ||
    haystack.includes('unexpected token') ||
    haystack.includes('not valid json')
  );
}

export const API_HTML_RESPONSE_MESSAGE =
  'No se pudo conectar con la API del servidor. Si acabás de desplegar, esperá 1–2 minutos y probá de nuevo.';

export function extractHttpErrorMessage(err: unknown, fallback: string): string {
  if (isHtmlInsteadOfJsonError(err)) return API_HTML_RESPONSE_MESSAGE;

  const http = err as { error?: unknown; message?: string };
  const body = http.error;

  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }

  if (typeof body === 'string' && body.trim() && !body.trimStart().toLowerCase().startsWith('<!')) {
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed.error === 'string') return parsed.error;
    } catch {
      if (body.length < 220 && !body.toLowerCase().includes('unexpected token')) {
        return body;
      }
    }
  }

  return fallback;
}
