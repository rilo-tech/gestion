/** Única fuente de verdad para la ruta home post-login. */
export type HomeRouteInput = {
  isPlatformAdmin: boolean;
  canAccessErpWeb: boolean;
  canAccessWhatsapp: boolean;
  billingMode?: string | null;
};

export function resolveHomeRoute(input: HomeRouteInput): string {
  if (input.isPlatformAdmin) return '/platform';
  if (input.canAccessErpWeb) return '/dashboard';
  if (input.canAccessWhatsapp) return '/inicio';
  if (input.billingMode === 'blocked' || input.billingMode === 'lite') {
    return '/activar-suscripcion';
  }
  return '/activar-suscripcion';
}
