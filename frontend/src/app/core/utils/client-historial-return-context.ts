import type { ParamMap } from '@angular/router';

export type ClientHistorialReturnContext = {
  clientId: string;
};

export function parseClientHistorialReturnContext(
  params: ParamMap
): ClientHistorialReturnContext | null {
  if (params.get('returnTo') !== 'client-historial') return null;
  const clientId = params.get('clienteId')?.trim() || params.get('clientId')?.trim() || '';
  if (!clientId) return null;
  return { clientId };
}

export function buildClientHistorialReturnQueryParams(
  clientId: string,
  extra?: Record<string, string>
): Record<string, string> {
  return {
    ...(extra ?? {}),
    returnTo: 'client-historial',
    clienteId: clientId,
  };
}

export function clientHistorialRoute(clientId: string): string[] {
  return ['/clients', clientId, 'historial'];
}
