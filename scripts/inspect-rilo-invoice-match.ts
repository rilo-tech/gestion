/**
 * Dry-run: match Disershop e-Ticket A-1640292 lines to RILO stock.
 *   npx tsx scripts/inspect-rilo-invoice-match.ts
 */
import dotenv from 'dotenv';
dotenv.config();
// Forzar producción (ignore USE_FIRESTORE_EMULATOR del .env local)
delete process.env.USE_FIRESTORE_EMULATOR;
delete process.env.FIRESTORE_EMULATOR_HOST;

import { db } from '../backend/firebase.ts';

const businessId = 'rilo';

type Line = {
  qty: number;
  desc: string;
  unitNet: number;
  subtotalNet: number;
};

const LINES: Line[] = [
  { qty: 1, desc: 'CAMISETA BLANCA XL', unitNet: 163.11, subtotalNet: 163.11 },
  { qty: 3, desc: 'CAMISETA BLANCA XXL', unitNet: 163.11, subtotalNet: 489.34 },
  { qty: 3, desc: 'CAMISETA NEGRA S', unitNet: 163.11, subtotalNet: 489.34 },
  { qty: 4, desc: 'CAMISETA GRIS MELANGE S', unitNet: 163.11, subtotalNet: 652.46 },
  { qty: 4, desc: 'CAMISETA GRIS MELANGE M', unitNet: 163.11, subtotalNet: 652.46 },
  { qty: 6, desc: 'CAMISETA GRIS MELANGE L', unitNet: 163.11, subtotalNet: 978.69 },
  { qty: 2, desc: 'CAMISETA GRIS MELANGE XXL', unitNet: 163.11, subtotalNet: 326.23 },
  { qty: 2, desc: 'CAMISETA GRIS MELANGE XL', unitNet: 163.11, subtotalNet: 326.23 },
  { qty: 2, desc: 'CAMISETA NIÑO BLANCA 8', unitNet: 122.13, subtotalNet: 244.26 },
  { qty: 1, desc: 'Camiseta dama DryCool II Negro S', unitNet: 122.13, subtotalNet: 122.13 },
  { qty: 2, desc: 'Camiseta dama DryCool II Negro XXL', unitNet: 122.13, subtotalNet: 244.26 },
  { qty: 1, desc: 'Camiseta dama DryCool II Negro XL', unitNet: 122.13, subtotalNet: 122.13 },
  { qty: 1, desc: 'Tinta DTF Otter Pro 500ml Blanco', unitNet: 1631.15, subtotalNet: 1631.15 },
  { qty: 1, desc: 'Tinta DTF Otter Pro 500ml Amarillo', unitNet: 1385.25, subtotalNet: 1385.25 },
];

function fold(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseSignals(desc: string) {
  const f = fold(desc);
  const sizeMatch = f.match(/\b(xxxxl|xxxl|xxl|xl|xs|s|m|l|2xl|3xl|\d{1,2})\b/);
  const size = sizeMatch?.[1] ?? null;
  let color: string | null = null;
  if (/\bblanco|blanca\b/.test(f)) color = 'blanco';
  else if (/\bnegro|negra\b/.test(f)) color = 'negro';
  else if (/\bgris|melange\b/.test(f)) color = 'gris';
  else if (/\bamarillo\b/.test(f)) color = 'amarillo';
  const type = /\bnino|nina|niño|niña\b/.test(f)
    ? 'nino'
    : /\bdama\b/.test(f)
      ? 'dama'
      : /\btinta|dtf|otter\b/.test(f)
        ? 'tinta'
        : 'camiseta';
  const fabric = /\bdry\s*cool|drycool\b/.test(f)
    ? 'drycool'
    : /\balgodon\b/.test(f)
      ? 'algodon'
      : /\bmelange\b/.test(f)
        ? 'melange'
        : null;
  return { f, size, color, type, fabric };
}

type StockRow = {
  id: string;
  nombre: string;
  color: string;
  talle: string;
  stock: number;
  label: string;
  folded: string;
};

function score(line: ReturnType<typeof parseSignals>, p: StockRow): number {
  let s = 0;
  if (line.color && p.folded.includes(line.color)) s += 30;
  if (line.color === 'gris' && /melange|algodon/.test(p.folded) && p.folded.includes('gris')) s += 10;
  if (line.size && (fold(p.talle) === line.size || p.folded.includes(` ${line.size} `) || p.folded.endsWith(` ${line.size}`)))
    s += 40;
  if (line.type === 'tinta' && /tinta|dtf|otter/.test(p.folded)) s += 50;
  if (line.type === 'nino' && /nino|nina|niño|kids|infantil/.test(p.folded)) s += 25;
  if (line.type === 'dama' && /dama|mujer|dry/.test(p.folded)) s += 25;
  if (line.type === 'camiseta' && /camiseta|remera/.test(p.folded)) s += 15;
  if (line.fabric === 'drycool' && /dry|cool/.test(p.folded)) s += 20;
  if (line.fabric === 'melange' && /algodon|melange|gris/.test(p.folded)) s += 8;
  if (line.color === 'blanco' && p.folded.includes('blanco')) s += 5;
  if (line.color === 'negro' && p.folded.includes('negro')) s += 5;
  // penalty wrong color
  if (line.color && !p.folded.includes(line.color) && !(/melange/.test(line.f) && p.folded.includes('gris')))
    s -= 40;
  return s;
}

async function main() {
  const stockSnap = await db.collection(`negocios/${businessId}/stock`).get();
  const products: StockRow[] = stockSnap.docs.map((doc) => {
    const d = doc.data();
    const nombre = String(d.nombre ?? '').trim();
    const color = String(d.color ?? '').trim();
    const talle = String(d.talle ?? '').trim();
    const label = [nombre, color, talle].filter(Boolean).join(' ');
    return {
      id: doc.id,
      nombre,
      color,
      talle,
      stock: Number(d.stockActual ?? d.stock ?? 0) || 0,
      label,
      folded: fold(label),
    };
  });

  console.log(`Stock products: ${products.length}`);
  console.log('--- MATCH PLAN ---\n');

  const unmatched: Line[] = [];
  for (const line of LINES) {
    const signals = parseSignals(line.desc);
    const ranked = products
      .map((p) => ({ p, s: score(signals, p) }))
      .filter((r) => r.s > 20)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5);
    const best = ranked[0];
    const second = ranked[1];
    const unique = best && (!second || best.s >= second.s + 15) && best.s >= 50;
    console.log(`• ${line.qty}× ${line.desc}  (neto $${line.unitNet})`);
    if (unique) {
      console.log(`  ✅ MATCH ${best!.p.label}  [score=${best!.s}] id=${best!.p.id}`);
    } else if (ranked.length) {
      console.log(`  ❓ AMBIGUOUS — candidates:`);
      for (const r of ranked) console.log(`     ${r.s}  ${r.p.label}  (${r.p.id})`);
      unmatched.push(line);
    } else {
      console.log(`  ❌ NOT FOUND`);
      unmatched.push(line);
    }
    console.log('');
  }

  const suppliers = await db.collection(`negocios/${businessId}/proveedores`).get();
  for (const doc of suppliers.docs) {
    const n = String(doc.data().nombre ?? '');
    if (/diser/i.test(n)) console.log('SUPPLIER', doc.id, n);
  }

  console.log('\nNeed user decision for', unmatched.length, 'lines');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
