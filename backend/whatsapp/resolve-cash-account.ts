import { loadCajaConfig } from '../domain/cash/index.ts';
import {
  matchCashAmbitoFromText,
  normalizeCajaAmbitos,
  parseCashAmbitoOrNull,
  type CajaAmbitoConfig,
} from '../utils/caja-ambitos.ts';
import {
  effectiveDefaultCashAccountId,
  loadBusinessOperationalDefaults,
} from './business-defaults.ts';
import { logAskRequired, resolveCandidatesWithPolicy } from './resolution-policy.ts';

export type CashAccountRef = {
  id: string;
  name: string;
};

export type ResolveCashAccountResult =
  | { status: 'resolved'; account: CashAccountRef; source?: string }
  | { status: 'needs_selection'; candidates: CashAccountRef[] }
  | { status: 'not_found'; hint: string }
  | { status: 'ambiguous'; hint: string; candidates: CashAccountRef[] };

function toCandidates(ambitos: CajaAmbitoConfig[]): CashAccountRef[] {
  return ambitos.map((row) => ({ id: row.id, name: row.label }));
}

function resolveByHint(
  caja: Record<string, unknown>,
  ambitos: CajaAmbitoConfig[],
  hint: string
):
  | { kind: 'resolved'; account: CashAccountRef }
  | { kind: 'not_found'; hint: string }
  | { kind: 'ambiguous'; hint: string; candidates: CashAccountRef[] } {
  const parsedId = parseCashAmbitoOrNull(hint, caja);
  if (parsedId) {
    const match = ambitos.find((row) => row.id === parsedId);
    if (match) return { kind: 'resolved', account: { id: match.id, name: match.label } };
  }

  const foldedHint = hint.trim().toLowerCase();
  const labelMatches = ambitos.filter(
    (row) => row.label.trim().toLowerCase() === foldedHint || row.id === foldedHint
  );
  if (labelMatches.length === 1) {
    const match = labelMatches[0]!;
    return { kind: 'resolved', account: { id: match.id, name: match.label } };
  }
  if (labelMatches.length > 1) {
    return { kind: 'ambiguous', hint, candidates: toCandidates(labelMatches) };
  }

  // Hint ya estructurado por el agente (ej. "caja de rilo"): token match contra labels/ids.
  const fromSpoken = matchCashAmbitoFromText(hint, ambitos);
  if (fromSpoken) {
    return { kind: 'resolved', account: { id: fromSpoken.id, name: fromSpoken.label } };
  }

  return { kind: 'not_found', hint };
}

export type ResolveCashAccountInput = {
  hint?: string | null;
  resolvedId?: string | null;
  /** true cuando el turno actual indicó caja (hint o id explícito). */
  explicit?: boolean;
  /** Default operativo del negocio (BusinessProfile.defaults.defaultCashAccountId). */
  businessDefaultId?: string | null;
  /** Contexto conversacional (focusEntities.cash, draft previo). */
  contextId?: string | null;
};

/**
 * Resuelve una referencia de caja contra la configuración ERP del tenant.
 *
 * Aplica ResolutionPolicy: explicit > context > business_default > single > ask.
 */
export function resolveCashAccountFromCaja(
  caja: Record<string, unknown>,
  input: ResolveCashAccountInput = {}
): ResolveCashAccountResult {
  const ambitos = normalizeCajaAmbitos(caja);
  const candidates = toCandidates(ambitos);

  const hint = String(input.hint ?? '').trim();
  const explicit = input.explicit === true;

  if (hint) {
    const byHint = resolveByHint(caja, ambitos, hint);
    if (byHint.kind === 'resolved') {
      return { status: 'resolved', account: byHint.account, source: 'explicit' };
    }
    if (byHint.kind === 'ambiguous') {
      return { status: 'ambiguous', hint: byHint.hint, candidates: byHint.candidates };
    }
    return { status: 'not_found', hint: byHint.hint };
  }

  const policy = resolveCandidatesWithPolicy({
    field: 'cash_account',
    candidates,
    getId: (row) => row.id,
    explicitId: explicit ? input.resolvedId : undefined,
    contextId: !explicit ? input.contextId ?? input.resolvedId : undefined,
    businessDefaultId: input.businessDefaultId,
  });

  if (policy.action === 'resolved') {
    return { status: 'resolved', account: policy.value, source: policy.source };
  }
  if (policy.action === 'ask') {
    return { status: 'needs_selection', candidates: policy.candidates };
  }

  if (explicit && input.resolvedId) {
    return { status: 'not_found', hint: String(input.resolvedId) };
  }

  logAskRequired('cash_account', 'no_resolvable_default', { candidateCount: candidates.length });
  return { status: 'needs_selection', candidates };
}

export async function resolveCashAccount(input: {
  businessId: string;
  hint?: string | null;
  resolvedId?: string | null;
  explicit?: boolean;
  contextId?: string | null;
  businessDefaultId?: string | null;
}): Promise<ResolveCashAccountResult & { caja: Record<string, unknown> }> {
  const caja = await loadCajaConfig(input.businessId);
  let businessDefaultId = input.businessDefaultId;
  if (businessDefaultId == null) {
    const defaults = await loadBusinessOperationalDefaults(input.businessId);
    businessDefaultId = effectiveDefaultCashAccountId(defaults);
  }
  const result = resolveCashAccountFromCaja(caja, {
    hint: input.hint,
    resolvedId: input.resolvedId,
    explicit: input.explicit,
    contextId: input.contextId,
    businessDefaultId,
  });
  return { ...result, caja };
}
