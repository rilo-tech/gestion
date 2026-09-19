/**
 * Smoke real tenant rilo — matching de 3 productos de factura.
 * Uso: npx tsx scripts/smoke-purchase-pending-match.ts
 */
import { signalsFromItem } from '../backend/whatsapp/catalog-rank.ts';
import { findProduct } from '../backend/domain/stock/index.ts';
import {
  firstUnresolvedVisualIssue,
  presentVisualDraftIssueReply,
  type VisualDocumentDraft,
  type VisualDraftItem,
} from '../backend/whatsapp/v4-visual-draft.ts';
import { pageChoicePool } from '../backend/whatsapp/catalog-rank.ts';
import { WA_CHOICE_PAGE_SIZE } from '../shared/whatsapp-format.ts';

const biz = 'rilo';
const queries = [
  'Remera Polo Dry Negro S',
  'Body sublimable blanco 0 Mes',
  'Camiseta Dry Blanco M',
] as const;

async function main() {
  for (const q of queries) {
    const signals = signalsFromItem({ rawText: q, productHint: q });
    console.log('\n====', q, '====');
    console.log('signals', signals);
    const t0 = Date.now();
    const r = await Promise.race([
      findProduct(biz, q, {
        utterance: q,
        preferChoices: true,
        attributes: {
          type: signals.type,
          fabric: signals.fabric,
          color: signals.color,
          size: signals.size,
        },
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout 45s')), 45_000)),
    ]).catch((err) => {
      console.error('findProduct failed', err);
      return null;
    });
    console.log('elapsed_ms', Date.now() - t0);
    if (!r) continue;
    console.log({
      status: r.status,
      matchKind: r.matchKind,
      missingVariant: r.missingVariant,
      familyLabel: r.familyLabel,
      entity: r.entity?.name,
      candidates: (r.candidates ?? []).slice(0, 10).map((c) => `${c.name} (${c.score ?? '-'})`),
    });

    if (r.status === 'resolved') continue;

    const item: VisualDraftItem = {
      index: 1,
      sourceText: q,
      description: q,
      quantity: 1,
      unitCostNet: 204.1,
      taxRate: 0.22,
      unitCost: 249,
      matchStatus:
        r.status === 'family_variant_missing' || r.status === 'ambiguous' ? 'ambiguous' : 'not_found',
      matchKind:
        r.status === 'family_variant_missing'
          ? 'FAMILY_MATCH_VARIANT_MISSING'
          : r.matchKind || undefined,
      missingVariant: r.missingVariant,
      familyLabel: r.familyLabel,
      candidateOffset: 0,
    };
    if (r.candidates?.length) {
      const pool = r.candidates.map((c) => ({ id: c.id, name: c.name }));
      const page = pageChoicePool(pool, 0, WA_CHOICE_PAGE_SIZE);
      item.candidates = page.shown;
      item.candidatePool = pool;
    }
    const draft: VisualDocumentDraft = {
      id: 'smoke',
      kind: 'purchase',
      status: 'awaiting_resolution',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sourceMessageIds: [],
      items: [item],
    };
    const issue = firstUnresolvedVisualIssue(draft);
    if (issue) {
      console.log('--- MENU ---\n' + presentVisualDraftIssueReply(draft, issue, { lead: 'start' }));
    }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
