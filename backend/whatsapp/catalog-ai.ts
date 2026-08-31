import { db } from '../firebase.ts';
import { assertCanUseAi, incrementAiUsage } from '../auth/usage-gates.ts';
import { generateGeminiJson } from './gemini.ts';

const MAX_CATALOG = 500;

export type AiClientHit = { id: string; nombre: string };
export type AiProductHit = {
  id: string;
  nombre: string;
  label: string;
  color?: string;
  talle?: string;
  precioVenta: number;
  costo: number;
};

async function generateJson(prompt: string, businessId: string): Promise<Record<string, unknown> | null> {
  try {
    await assertCanUseAi(businessId, 1);
  } catch {
    return null;
  }
  const parsed = await generateGeminiJson({
    parts: [{ text: prompt }],
    timeoutMs: 18000,
    label: 'catalog ai',
    businessId,
    tool: 'catalog',
  });
  if (!parsed) return null;
  try {
    await incrementAiUsage(businessId, 1);
  } catch (error) {
    console.warn('[whatsapp] catalog ai usage:', error);
  }
  return parsed;
}

function parseIds(raw: Record<string, unknown> | null): string[] {
  if (!raw) return [];
  const ids = Array.isArray(raw.ids) ? raw.ids : [];
  return ids
    .map((id) => String(id ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function productLabel(data: { nombre?: string; color?: string; talle?: string }): string {
  const nombre = String(data.nombre ?? '').trim();
  const extra = [data.color, data.talle]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return extra.length ? `${nombre} (${extra.join(', ')})` : nombre;
}

async function loadClients(businessId: string): Promise<AiClientHit[]> {
  const snap = await db.collection(`negocios/${businessId}/clientes`).get();
  const out: AiClientHit[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as { nombre?: string; activo?: boolean };
    if (data.activo === false) continue;
    const nombre = String(data.nombre ?? '').trim();
    if (!nombre) continue;
    out.push({ id: doc.id, nombre });
    if (out.length >= MAX_CATALOG) break;
  }
  return out;
}

async function loadProducts(businessId: string): Promise<AiProductHit[]> {
  const snap = await db.collection(`negocios/${businessId}/stock`).get();
  const out: AiProductHit[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as {
      nombre?: string;
      color?: string;
      talle?: string;
      precioVenta?: number;
      precio?: number;
      costo?: number;
      activo?: boolean;
    };
    if (data.activo === false) continue;
    const nombre = String(data.nombre ?? '').trim();
    if (!nombre) continue;
    const color = String(data.color ?? '').trim();
    const talle = String(data.talle ?? '').trim();
    out.push({
      id: doc.id,
      nombre,
      label: productLabel(data),
      color: color || undefined,
      talle: talle || undefined,
      precioVenta: Number(data.precioVenta ?? data.precio) || 0,
      costo: Number(data.costo) || 0,
    });
    if (out.length >= 1500) break;
  }
  return out;
}

/** El modelo elige clientes parecidos. null = no se pudo usar IA. */
export async function pickClientsWithAi(
  businessId: string,
  spoken: string,
  utterance?: string
): Promise<AiClientHit[] | null> {
  const query = String(spoken ?? '').trim();
  if (!query) return [];
  const catalog = await loadClients(businessId);
  if (!catalog.length) return [];

  const prompt = `Sos una persona del negocio. El dueño pidió un cliente por WhatsApp, a su manera (typos, apodos, un solo nombre).
Elegí del CATÁLOGO cuáles podrían ser. No inventes ids.

Cómo habló: ${JSON.stringify(utterance || query)}
Nombre que entendimos: ${JSON.stringify(query)}

CATÁLOGO (id | nombre):
${catalog.map((c) => `${c.id} | ${c.nombre}`).join('\n')}

Reglas:
- Pensá como humana: Danyelyn puede ser Daniela, Dany, Daniele, etc. si suena o se escribe parecido.
- Si hay varios parecidos, devolvé todos (máx 8). Nunca asumas uno solo.
- Si no hay ninguno razonable, ids vacío.
Devolvé SOLO JSON: {"ids":["..."]}`;

  const parsed = await generateJson(prompt, businessId);
  if (!parsed) return null;
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return parseIds(parsed)
    .map((id) => byId.get(id))
    .filter((row): row is AiClientHit => Boolean(row));
}

function productCatalogLine(p: AiProductHit): string {
  const color = p.color || '-';
  const talle = p.talle || '-';
  return `${p.id} | ${p.nombre} | color:${color} | talle:${talle} | ${p.label} | $${p.precioVenta}`;
}

function mapProductIds(
  parsed: Record<string, unknown> | null,
  catalog: AiProductHit[]
): AiProductHit[] {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  return parseIds(parsed)
    .map((id) => byId.get(id))
    .filter((row): row is AiProductHit => Boolean(row))
    .slice(0, 6);
}

/** El modelo elige productos. null = no se pudo usar IA. */
export async function pickProductsWithAi(
  businessId: string,
  spoken: string,
  utterance?: string,
  messageContext?: string
): Promise<AiProductHit[] | null> {
  const query = String(spoken ?? '').trim();
  if (!query) return [];
  const catalog = await loadProducts(businessId);
  if (!catalog.length) return [];

  const itemPhrase = String(utterance || query).trim();
  const extraContext =
    messageContext && messageContext.trim() && messageContext.trim() !== itemPhrase
      ? `Contexto del mensaje (NO es el producto a ubicar): ${JSON.stringify(messageContext.trim().slice(0, 280))}\n`
      : '';
  const spokenBlock = `${extraContext}Producto que hay que ubicar: ${JSON.stringify(query)}
Frase de ESE ítem: ${JSON.stringify(itemPhrase)}

CATÁLOGO (id | nombre | color | talle | etiqueta | precio):
${catalog.map(productCatalogLine).join('\n')}`;

  const prompt = `Sos del negocio (indumentaria y sublimación). El dueño pidió un producto por WhatsApp o mandó una boleta, como habla, sin un orden fijo.
Elegí del CATÁLOGO cuáles son ESE producto. No inventes ids.

${spokenBlock}

Reglas (como una persona, no un buscador exacto):
- El orden de las palabras NO importa: «canguro felpa rojo l» ES «Canguro felpa Rojo L».
- camiseta = remera = playera. canguro = buzo = hoodie. felpa = terry = frisa. jarro / taza / mug = el mismo tipo.
- Códigos cortos del proveedor (SW, SL, modelo) NO son talle ni color: ignorarlos.
- COLOR: si el renglón trae un color, NO devuelvas otro color. Un combo que INCLUYE ese color (gris con manga Rojo) sí vale.
- Orden de ids, estricto:
  1) mismo color + mismo talle + alguna palabra del nombre (canguro, felpa, etc.). El más parecido al renglón primero.
  2) recién después, mismo color + palabra del nombre con OTRO talle.
- No mezcles: un Rojo L va ANTES que un Rojo M/S/XL. Un Amarillo no va nunca si pidió Rojo.
- Máximo 6. Nunca asumas uno solo si hay varios que cierran color+talle+nombre.
Devolvé SOLO JSON: {"ids":["..."]}`;

  let parsed = await generateJson(prompt, businessId);
  if (!parsed) return null;
  let hits = mapProductIds(parsed, catalog);
  if (hits.length) return hits;

  const retry = `No devolviste ninguno y casi seguro hay. Mirá de nuevo el catálogo.
${spokenBlock}

Ejemplo: pidió «camiseta xl roja de algodon» → id de «Camiseta algodón Rojo XL».
Devolvé SOLO JSON: {"ids":["..."]}`;
  parsed = await generateJson(retry, businessId);
  if (!parsed) return null;
  return mapProductIds(parsed, catalog);
}
