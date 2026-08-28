/** Tarifas para estimar el costo de RILO Bot (plataforma). No se muestran al cliente. */

export const META_SERVICE_PAID_FROM = '2026-10-01';
/** Utility Uruguay / resto LatAm, proxy de service desde oct 2026. */
export const META_UTILITY_UY_USD = 0.0113;

export type UsageToolId = 'parser' | 'catalog' | 'clarify' | 'voice';

export const USAGE_TOOL_LABELS: Record<UsageToolId, string> = {
  parser: 'Parser (entender el mensaje)',
  catalog: 'Match de catálogo',
  clarify: 'Aclarar intención',
  voice: 'Pregunta al margen',
};

type TokenRate = { inputPerMillion: number; outputPerMillion: number };

const GEMINI_RATES: Record<string, TokenRate> = {
  'gemini-3.1-flash-lite': { inputPerMillion: 0.25, outputPerMillion: 1.5 },
  'gemini-flash-lite-latest': { inputPerMillion: 0.25, outputPerMillion: 1.5 },
  'gemini-3.5-flash': { inputPerMillion: 1.5, outputPerMillion: 9 },
  'gemini-flash-latest': { inputPerMillion: 0.5, outputPerMillion: 3 },
};

const DEFAULT_GEMINI_RATE: TokenRate = { inputPerMillion: 0.25, outputPerMillion: 1.5 };

export function metaOutboundUsd(bubbles: number, at = new Date()): number {
  const day = at.toISOString().slice(0, 10);
  const rate = day >= META_SERVICE_PAID_FROM ? META_UTILITY_UY_USD : 0;
  return Math.max(0, Number(bubbles) || 0) * rate;
}

export function geminiUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rate = GEMINI_RATES[model] ?? DEFAULT_GEMINI_RATE;
  const input = Math.max(0, Number(inputTokens) || 0);
  const output = Math.max(0, Number(outputTokens) || 0);
  return (input / 1_000_000) * rate.inputPerMillion + (output / 1_000_000) * rate.outputPerMillion;
}

export type UsageToolTotals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
};

export type UsageMeterSnapshot = {
  period: string;
  aiActions: number;
  waOutbound: number;
  waInbound: number;
  waOps: number;
  /** Packs comprados este mes (no el extra de Superadmin). */
  purchasedWhatsapp: number;
  purchasedAi: number;
  /** Already sent the “cupo lleno” WhatsApp notice this period. */
  waQuotaNotified?: boolean;
  /** Already sent the 80% warning this period. */
  waQuotaWarned80?: boolean;
  tools: Partial<Record<UsageToolId, UsageToolTotals>>;
  models: Record<string, UsageToolTotals>;
  updatedAt?: string;
};

export function emptyUsageMeter(period: string): UsageMeterSnapshot {
  return {
    period,
    aiActions: 0,
    waOutbound: 0,
    waInbound: 0,
    waOps: 0,
    purchasedWhatsapp: 0,
    purchasedAi: 0,
    tools: {},
    models: {},
  };
}

export function geminiUsdFromMeter(meter: UsageMeterSnapshot): number {
  let total = 0;
  for (const [model, row] of Object.entries(meter.models ?? {})) {
    total += geminiUsd(model, row.inputTokens, row.outputTokens);
  }
  return total;
}

export function estimateUsageUsd(meter: UsageMeterSnapshot, at = new Date()): {
  whatsappUsd: number;
  geminiUsd: number;
  totalUsd: number;
} {
  const whatsappUsd = metaOutboundUsd(meter.waOutbound, at);
  const gemini = geminiUsdFromMeter(meter);
  return { whatsappUsd, geminiUsd: gemini, totalUsd: whatsappUsd + gemini };
}

export function roundUsd(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Extra cupo on top of the plan, per business. 0 = only the plan default. */
export type BusinessUsageQuota = {
  extraWhatsapp: number;
  extraAi: number;
};

export function emptyBusinessUsageQuota(): BusinessUsageQuota {
  return { extraWhatsapp: 0, extraAi: 0 };
}

export function parseBusinessUsageQuota(raw: unknown): BusinessUsageQuota {
  const row = (raw ?? {}) as Record<string, unknown>;
  const num = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));
  return {
    extraWhatsapp: num(row.extraWhatsapp),
    extraAi: num(row.extraAi),
  };
}
