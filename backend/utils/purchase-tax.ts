import type { PriceTaxMode, PurchaseTaxConfig } from '../../shared/finance-config.ts';

export type PurchaseLineTaxSnapshot = {
  netUnitCost?: number;
  taxRate?: number;
  taxAmount?: number;
  grossUnitCost: number;
  priceTaxMode: PriceTaxMode;
};

export type ResolveLineTaxInput = {
  unitCost?: number;
  unitCostNet?: number;
  taxRate?: number;
  priceTaxMode?: PriceTaxMode;
  declaredTotal?: number;
  lineNetSubtotal?: number;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolvePurchaseLineTax(
  input: ResolveLineTaxInput,
  config?: PurchaseTaxConfig
): PurchaseLineTaxSnapshot {
  const explicitMode = input.priceTaxMode;
  const netCandidate =
    Number(input.unitCostNet) > 0
      ? Number(input.unitCostNet)
      : explicitMode === 'net' && Number(input.unitCost) > 0
        ? Number(input.unitCost)
        : undefined;
  const grossCandidate =
    explicitMode === 'gross' && Number(input.unitCost) > 0 ? Number(input.unitCost) : undefined;

  let taxRate = Number(input.taxRate);
  if (!Number.isFinite(taxRate) || taxRate < 0) {
    const configured = Number(config?.defaultPurchaseTaxRate);
    taxRate = Number.isFinite(configured) && configured >= 0 ? configured : NaN;
  }
  // OCR/agent a veces manda fracción (0.22) en lugar de porcentaje (22).
  if (Number.isFinite(taxRate) && taxRate > 0 && taxRate < 1) {
    taxRate = taxRate * 100;
  }

  if (grossCandidate != null) {
    const grossUnitCost = roundMoney(grossCandidate);
    if (Number.isFinite(taxRate) && taxRate > 0) {
      const netUnitCost = roundMoney(grossUnitCost / (1 + taxRate / 100));
      const taxAmount = roundMoney(grossUnitCost - netUnitCost);
      console.info(
        '[purchase:item:tax-calculated]',
        JSON.stringify({ priceTaxMode: 'gross', grossUnitCost, netUnitCost, taxRate })
      );
      return { netUnitCost, taxRate, taxAmount, grossUnitCost, priceTaxMode: 'gross' };
    }
    return { grossUnitCost, priceTaxMode: 'gross' };
  }

  if (netCandidate != null && Number.isFinite(taxRate) && taxRate > 0) {
    const netUnitCost = roundMoney(netCandidate);
    const taxAmount = roundMoney(netUnitCost * (taxRate / 100));
    const grossUnitCost = roundMoney(netUnitCost + taxAmount);
    console.info(
      '[purchase:item:tax-calculated]',
      JSON.stringify({ priceTaxMode: 'net', grossUnitCost, netUnitCost, taxRate })
    );
    return { netUnitCost, taxRate, taxAmount, grossUnitCost, priceTaxMode: 'net' };
  }

  const fallback = roundMoney(Number(input.unitCost) || 0);
  return {
    grossUnitCost: fallback,
    priceTaxMode: explicitMode ?? 'unknown',
    ...(netCandidate != null ? { netUnitCost: roundMoney(netCandidate) } : {}),
  };
}

export function applyTaxSnapshotToUnitCost(
  snapshot: PurchaseLineTaxSnapshot,
  config?: PurchaseTaxConfig
): number {
  if (config?.pricesIncludeTax === false && snapshot.netUnitCost != null) {
    return snapshot.netUnitCost;
  }
  return snapshot.grossUnitCost;
}

export function catalogCostFromTaxSnapshot(snapshot: PurchaseLineTaxSnapshot): number | null {
  if (snapshot.priceTaxMode === 'gross') return snapshot.grossUnitCost;
  if (snapshot.grossUnitCost > 0) return snapshot.grossUnitCost;
  return null;
}
