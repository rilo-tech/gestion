import { roundUsd } from './usage-cost.ts';

export type CostSourceFlag = 'real' | 'estimated';

export type ProfitCostLine = {
  code: 'gemini' | 'whatsapp_meta' | 'mercadopago' | 'firebase_gcp' | 'other';
  label: string;
  usd: number;
  source: CostSourceFlag;
};

export type ProfitIncomeLine = {
  code: 'plan' | 'erp_extra' | 'wa_extra' | 'addons' | 'discount' | 'custom';
  label: string;
  amount: number;
};

export function localAmountToUsd(
  amount: number,
  currency: 'UYU' | 'ARS' | string,
  rates: { uyuPerUsd: number; arsPerUsd: number }
): number {
  const n = Math.max(0, Number(amount) || 0);
  if (currency === 'ARS') {
    const fx = Math.max(1, Number(rates.arsPerUsd) || 1400);
    return n / fx;
  }
  const fx = Math.max(1, Number(rates.uyuPerUsd) || 40);
  return n / fx;
}

export function marginPct(incomeUsd: number, costUsd: number): number | null {
  if (!(incomeUsd > 0)) return null;
  return Math.round(((incomeUsd - costUsd) / incomeUsd) * 1000) / 10;
}

export function buildProfitability(input: {
  currency: 'UYU' | 'ARS' | string;
  incomeLines: ProfitIncomeLine[];
  incomeTotal: number;
  geminiUsd: number;
  whatsappMetaUsd: number;
  mercadoPagoUsd: number;
  mercadoPagoSource: CostSourceFlag;
  firebaseUsd: number;
  otherUsd: number;
  fx: { uyuPerUsd: number; arsPerUsd: number };
}) {
  const incomeUsdEstimated = roundUsd(
    localAmountToUsd(input.incomeTotal, input.currency, input.fx)
  );
  const costs: ProfitCostLine[] = [
    {
      code: 'gemini',
      label: 'Gemini',
      usd: roundUsd(input.geminiUsd),
      source: 'real',
    },
    {
      code: 'whatsapp_meta',
      label: 'WhatsApp Meta',
      usd: roundUsd(input.whatsappMetaUsd),
      source: 'estimated',
    },
    {
      code: 'mercadopago',
      label: 'Mercado Pago',
      usd: roundUsd(input.mercadoPagoUsd),
      source: input.mercadoPagoSource,
    },
    {
      code: 'firebase_gcp',
      label: 'Firebase/GCP',
      usd: roundUsd(input.firebaseUsd),
      source: 'estimated',
    },
    {
      code: 'other',
      label: 'Otros',
      usd: roundUsd(input.otherUsd),
      source: 'estimated',
    },
  ].filter((row) => row.usd > 0 || row.code === 'gemini' || row.code === 'whatsapp_meta');

  const costUsdReal = roundUsd(
    costs.filter((row) => row.source === 'real').reduce((sum, row) => sum + row.usd, 0)
  );
  const costUsdEstimated = roundUsd(
    costs.filter((row) => row.source === 'estimated').reduce((sum, row) => sum + row.usd, 0)
  );
  const costUsd = roundUsd(costUsdReal + costUsdEstimated);
  const profitUsd = roundUsd(incomeUsdEstimated - costUsd);

  return {
    income: {
      currency: input.currency,
      lines: input.incomeLines,
      total: input.incomeTotal,
      totalUsdEstimated: incomeUsdEstimated,
    },
    costs,
    costUsd,
    costUsdReal,
    costUsdEstimated,
    result: {
      profitUsd,
      marginPct: marginPct(incomeUsdEstimated, costUsd),
      incomeUsdEstimated,
    },
  };
}
