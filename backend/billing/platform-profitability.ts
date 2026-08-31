import { getCommercialCatalog } from '../auth/commercial-catalog.ts';
import { listMpPaymentsInPeriod } from './mp-webhooks.ts';
import {
  buildProfitability,
  localAmountToUsd,
  type ProfitIncomeLine,
} from '../../shared/profitability.ts';
import { roundUsd } from '../../shared/usage-cost.ts';
import type { CommercialMonthlyQuote } from '../../shared/commercial-pricing.ts';

export async function attachProfitability<T extends {
  businessId?: string;
  expectedMonthly?: number;
  extraErpCost?: number;
  extraWhatsappCost?: number;
  geminiUsd?: number;
  whatsappUsd?: number;
  ai?: { used?: number };
  quote?: CommercialMonthlyQuote | null;
}>(rows: T[], period: string) {
  const catalog = await getCommercialCatalog();
  const fx = {
    uyuPerUsd: catalog.finops?.uyuPerUsd ?? 40,
    arsPerUsd: catalog.finops?.arsPerUsd ?? 1400,
  };
  const firebaseMonthly = catalog.finops?.firebaseMonthlyUsd ?? 25;
  const otherMonthly = catalog.finops?.otherMonthlyUsd ?? 0;
  const mpFeePercent = catalog.finops?.mpFeePercent ?? 4.99;
  const totalAi = rows.reduce((sum, row) => sum + (row.ai?.used || 0), 0) || 1;

  const enriched = await Promise.all(
    rows.map(async (row) => {
      const quote = row.quote;
      const currency = quote?.rates.currency ?? 'UYU';
      const incomeLines: ProfitIncomeLine[] = (quote?.lines ?? []).map((line) => ({
        code:
          line.code === 'BASE'
            ? 'plan'
            : line.code === 'ERP_EXTRA'
              ? 'erp_extra'
              : line.code === 'WA_EXTRA'
                ? 'wa_extra'
                : line.code === 'DISCOUNT'
                  ? 'discount'
                  : line.code === 'CUSTOM'
                    ? 'custom'
                    : 'addons',
        label: line.label,
        amount: line.amount,
      }));
      const incomeTotal = quote?.total ?? row.expectedMonthly ?? 0;
      const incomeUsd = localAmountToUsd(incomeTotal, currency, fx);
      let mpRealUsd = 0;
      let mpHasReal = false;
      if (row.businessId) {
        try {
          const payments = await listMpPaymentsInPeriod(row.businessId, period);
          const fees = payments.reduce((sum, payment) => sum + (Number(payment.feeAmount) || 0), 0);
          if (fees > 0) {
            mpRealUsd = localAmountToUsd(fees, payments[0]?.currency || currency, fx);
            mpHasReal = true;
          }
        } catch (error) {
          console.warn('[profitability] mp payments', row.businessId, error);
        }
      }
      const mpEstimatedUsd = incomeUsd * (mpFeePercent / 100);
      const firebaseUsd = firebaseMonthly * ((row.ai?.used || 0) / totalAi);
      const otherUsd = otherMonthly * ((row.ai?.used || 0) / totalAi);
      const profit = buildProfitability({
        currency,
        incomeLines,
        incomeTotal,
        geminiUsd: row.geminiUsd || 0,
        whatsappMetaUsd: row.whatsappUsd || 0,
        mercadoPagoUsd: mpHasReal ? mpRealUsd : mpEstimatedUsd,
        mercadoPagoSource: mpHasReal ? 'real' : 'estimated',
        firebaseUsd,
        otherUsd,
        fx,
      });
      return {
        ...row,
        incomePlan: quote?.rates.baseAmount ?? 0,
        extraErpCost: quote?.extraErpCost ?? row.extraErpCost ?? 0,
        extraWhatsappCost: quote?.extraWhatsappCost ?? row.extraWhatsappCost ?? 0,
        addonCost: quote?.addonTotal ?? 0,
        profitability: profit,
      };
    })
  );

  const totals = enriched.reduce(
    (acc, row) => {
      const p = row.profitability;
      acc.incomeUsd += p.result.incomeUsdEstimated;
      acc.costUsd += p.costUsd;
      acc.costUsdReal += p.costUsdReal;
      acc.costUsdEstimated += p.costUsdEstimated;
      acc.profitUsd += p.result.profitUsd;
      for (const cost of p.costs) {
        acc.byVendor[cost.code] = (acc.byVendor[cost.code] || 0) + cost.usd;
      }
      return acc;
    },
    {
      incomeUsd: 0,
      costUsd: 0,
      costUsdReal: 0,
      costUsdEstimated: 0,
      profitUsd: 0,
      byVendor: {} as Record<string, number>,
    }
  );

  return {
    rows: enriched,
    totals: {
      incomeUsdEstimated: roundUsd(totals.incomeUsd),
      costUsd: roundUsd(totals.costUsd),
      costUsdReal: roundUsd(totals.costUsdReal),
      costUsdEstimated: roundUsd(totals.costUsdEstimated),
      profitUsd: roundUsd(totals.profitUsd),
      marginPct:
        totals.incomeUsd > 0
          ? Math.round(((totals.incomeUsd - totals.costUsd) / totals.incomeUsd) * 1000) / 10
          : null,
      byVendor: Object.fromEntries(
        Object.entries(totals.byVendor).map(([key, value]) => [key, roundUsd(value)])
      ),
      firebaseNote:
        'Firebase/GCP es un estimado mensual atribuido por acciones. No es un costo exacto de la factura de Google.',
    },
  };
}
