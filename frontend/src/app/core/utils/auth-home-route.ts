/** Única fuente de verdad para la ruta home post-login. */
export type HomeRouteInput = {
  isPlatformAdmin: boolean;
  canAccessErpWeb: boolean;
  canAccessWhatsapp: boolean;
  billingMode?: string | null;
  cashOnlyHome?: boolean;
  /** Resumen RILO (Bot) — no dashboard full. */
  summaryWebHome?: boolean;
};

export function resolveHomeRoute(input: HomeRouteInput): string {
  if (input.isPlatformAdmin) return '/platform';
  if (input.canAccessErpWeb && input.cashOnlyHome) return '/cash';
  if (input.canAccessErpWeb && input.summaryWebHome) return '/inicio';
  if (input.canAccessErpWeb) return '/dashboard';
  if (input.canAccessWhatsapp) return '/inicio';
  if (input.billingMode === 'blocked' || input.billingMode === 'lite') {
    return '/activar-suscripcion';
  }
  return '/activar-suscripcion';
}
