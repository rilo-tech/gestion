/**
 * Corrige el registro de horas de Flor Silva guardado con fecha inválida "03/09"
 * (sin año ISO) a 2026-09-03.
 *
 * Uso:
 *   npx tsx scripts/repair-flor-hours-fecha.ts           # dry-run
 *   npx tsx scripts/repair-flor-hours-fecha.ts --apply   # aplicar
 */
import dotenv from 'dotenv';

dotenv.config();

import { db } from '../backend/firebase.ts';
import { normalizeCollaboratorFecha } from '../backend/utils/collaborators.ts';

const APPLY = process.argv.includes('--apply');
const businessId =
  process.argv.find((arg) => arg.startsWith('--business='))?.split('=')[1]?.trim() || 'rilo';
const TARGET_ISO = '2026-09-03';
const TARGET_HOURS = 24;

function looksLikeFlor(name: string): boolean {
  const n = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return n.includes('flor');
}

function isBadFecha(raw: string): boolean {
  const value = String(raw ?? '').trim();
  if (!value) return true;
  if (value === TARGET_ISO) return false;
  // Guardado por el bot sin año, o cualquier DD/MM(/YYYY) que normalice al target.
  const normalized = normalizeCollaboratorFecha(value, TARGET_ISO);
  if (normalized === TARGET_ISO && value !== TARGET_ISO) return true;
  return value === '03/09' || value === '3/9' || value.startsWith('03/09');
}

async function main(): Promise<void> {
  console.log(`[repair-flor-hours] negocio=${businessId} modo=${APPLY ? 'APPLY' : 'dry-run'}`);

  const [collabSnap, movSnap] = await Promise.all([
    db.collection(`negocios/${businessId}/colaboradores`).get(),
    db.collection(`negocios/${businessId}/colaboradores_movimientos`).get(),
  ]);

  const florIds = new Set<string>();
  for (const doc of collabSnap.docs) {
    const nombre = String(doc.data().nombre ?? '').trim();
    if (looksLikeFlor(nombre)) {
      florIds.add(doc.id);
      console.log(`  colaborador: ${nombre} (${doc.id})`);
    }
  }

  const candidates = movSnap.docs.filter((doc) => {
    const data = doc.data() as Record<string, unknown>;
    if (String(data.tipo ?? '') !== 'horas') return false;
    const horas = Number(data.horas);
    if (!Number.isFinite(horas) || Math.abs(horas - TARGET_HOURS) > 0.01) return false;
    const colaboradorId = String(data.colaboradorId ?? '');
    const nombre = String(data.colaboradorNombre ?? '');
    const matchesFlor = florIds.has(colaboradorId) || looksLikeFlor(nombre);
    if (!matchesFlor) return false;
    return isBadFecha(String(data.fecha ?? ''));
  });

  if (candidates.length === 0) {
    // También buscar cualquier horas=24 de Flor aunque la fecha ya esté OK (informativo).
    const florHours = movSnap.docs.filter((doc) => {
      const data = doc.data() as Record<string, unknown>;
      if (String(data.tipo ?? '') !== 'horas') return false;
      if (Math.abs(Number(data.horas) - TARGET_HOURS) > 0.01) return false;
      const colaboradorId = String(data.colaboradorId ?? '');
      const nombre = String(data.colaboradorNombre ?? '');
      return florIds.has(colaboradorId) || looksLikeFlor(nombre);
    });
    console.log(`Sin candidatos a reparar. Registros Flor ${TARGET_HOURS}h encontrados: ${florHours.length}`);
    for (const doc of florHours) {
      const data = doc.data() as Record<string, unknown>;
      console.log(`  - ${doc.id} fecha=${data.fecha} horas=${data.horas} nombre=${data.colaboradorNombre}`);
    }
    return;
  }

  console.log(`Candidatos a corregir → ${TARGET_ISO}:`);
  for (const doc of candidates) {
    const data = doc.data() as Record<string, unknown>;
    console.log(
      `  - ${doc.id} fecha="${data.fecha}" → "${TARGET_ISO}" horas=${data.horas} nombre=${data.colaboradorNombre}`
    );
  }

  if (!APPLY) {
    console.log('Dry-run. Corré con --apply para persistir.');
    return;
  }

  for (const doc of candidates) {
    await doc.ref.update({
      fecha: TARGET_ISO,
      fechaRepairNote: `normalized from ${String(doc.data().fecha ?? '')} → ${TARGET_ISO}`,
      fechaRepairedAt: new Date().toISOString(),
    });
    console.log(`  OK updated ${doc.id}`);
  }
  console.log('Listo.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
