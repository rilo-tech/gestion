import { db } from '../firebase.ts';
import {
  formatCashAmbitoChoices,
  matchCashAmbitoFromText,
  normalizeCajaAmbitos,
  type CajaAmbitoConfig,
} from '../utils/caja-ambitos.ts';
import type { WhatsappCommandEntities } from './ai-command-parser.ts';

export { formatCashAmbitoChoices };

export const SELECT_CASH_AMBITO_INTENT = 'select_cash_ambito';

export async function loadWhatsappCajaAmbitos(businessId: string): Promise<{
  caja: Record<string, unknown>;
  ambitos: CajaAmbitoConfig[];
}> {
  const snap = await db.doc(`negocios/${businessId}/config/app`).get();
  const caja = (snap.data()?.caja as Record<string, unknown>) ?? {};
  return { caja, ambitos: normalizeCajaAmbitos(caja) };
}

export function applyCashAmbitoToEntities(
  entities: WhatsappCommandEntities,
  ambito: CajaAmbitoConfig
): void {
  entities.cashAmbitoId = ambito.id;
  entities.cashAmbitoLabel = ambito.label;
}

export function resolveSpokenCashAmbito(
  entities: WhatsappCommandEntities,
  ambitos: CajaAmbitoConfig[]
): CajaAmbitoConfig | null {
  if (!ambitos.length) return null;
  if (ambitos.length === 1) return ambitos[0]!;
  const knownId = String(entities.cashAmbitoId ?? '').trim().toLowerCase();
  if (knownId) {
    const byId = ambitos.find((ambito) => ambito.id === knownId);
    if (byId) return byId;
  }
  const spoken = [
    entities.cashAmbitoHint,
    entities.cashAmbitoLabel,
    entities.cashConcept,
    entities.notes,
    entities.sourceText,
  ]
    .filter(Boolean)
    .join(' ');
  return matchCashAmbitoFromText(spoken, ambitos);
}

export function cleanCashConcept(
  raw: string,
  ambitos: CajaAmbitoConfig[],
  fallback: string
): string {
  let text = String(raw ?? '');
  text = text.replace(
    /\b(hace|hac[eé]|hacele|anot[aá]|registr[aá]|pon[eé]|cargar|carg[aá])\s+(un[ao]?\s+)?/gi,
    ' '
  );
  text = text.replace(
    /\b(egreso|ingreso|gasto|salida|entrada|retiro|retir[eéo]|sac[aáe](?:lo)?)\b/gi,
    ' '
  );
  text = text.replace(/\b(de|del|en|a|la|el|por|caja)\b/gi, ' ');
  for (const ambito of ambitos) {
    const bits = [ambito.id, ambito.label].filter(Boolean);
    for (const bit of bits) {
      text = text.replace(new RegExp(`\\b${escapeRegExp(bit)}\\b`, 'gi'), ' ');
    }
  }
  text = text.replace(/\b(personal|negocio|empresa|local|general|mia|m[ií]a)\b/gi, ' ');
  text = text.replace(/\$?\s*[\d.]+(?:,\d{1,2})?/g, ' ');
  const clean = text.replace(/[.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length >= 2 ? clean.slice(0, 80) : fallback;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
