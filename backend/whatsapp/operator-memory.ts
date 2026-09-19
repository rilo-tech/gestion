import { db } from '../firebase.ts';
import { productAliasKey, saveProductAlias, saveInsumoAlias } from './product-aliases.ts';
import { parsePersonNameAndPhone, formatClientNombreConCel } from './client-identity.ts';
import type { WhatsappCommandEntities } from './ai-command-parser.ts';

type AliasEntry = { spoken: string; id: string; nombre: string; hits: number };
type RecentEntry = { id: string; nombre: string };

export type OperatorMemory = {
  clientAliases: AliasEntry[];
  productAliases: AliasEntry[];
  recentClients: RecentEntry[];
  recentProducts: RecentEntry[];
  recentSuppliers: RecentEntry[];
  updatedAt?: string;
};

const MAX_ALIASES = 40;
const MAX_RECENTS = 8;
const PROMPT_ALIASES = 15;

function normalizeAlias(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function profileRef(businessId: string) {
  return db.doc(`negocios/${businessId}/whatsapp_memory/operator`);
}

function clientAliasRef(businessId: string, spoken: string) {
  return db.doc(`negocios/${businessId}/whatsapp_client_aliases/${productAliasKey(spoken)}`);
}

function supplierAliasRef(businessId: string, spoken: string) {
  return db.doc(`negocios/${businessId}/whatsapp_supplier_aliases/${productAliasKey(spoken)}`);
}

function asAliasList(raw: unknown): AliasEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const spoken = String((row as AliasEntry)?.spoken ?? '').trim();
      const id = String((row as AliasEntry)?.id ?? '').trim();
      const nombre = String((row as AliasEntry)?.nombre ?? '').trim();
      const hits = Math.max(1, Number((row as AliasEntry)?.hits) || 1);
      if (!spoken || !id || !nombre) return null;
      return { spoken, id, nombre, hits };
    })
    .filter((row): row is AliasEntry => row !== null)
    .slice(0, MAX_ALIASES);
}

function asRecentList(raw: unknown): RecentEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const id = String((row as RecentEntry)?.id ?? '').trim();
      const nombre = String((row as RecentEntry)?.nombre ?? '').trim();
      if (!id || !nombre) return null;
      return { id, nombre };
    })
    .filter((row): row is RecentEntry => row !== null)
    .slice(0, MAX_RECENTS);
}

function upsertAlias(list: AliasEntry[], entry: AliasEntry): AliasEntry[] {
  const key = normalizeAlias(entry.spoken);
  const rest = list.filter((item) => normalizeAlias(item.spoken) !== key);
  const prev = list.find((item) => normalizeAlias(item.spoken) === key);
  return [{ ...entry, hits: (prev?.hits ?? 0) + 1 }, ...rest].slice(0, MAX_ALIASES);
}

function upsertRecent(list: RecentEntry[], entry: RecentEntry): RecentEntry[] {
  return [entry, ...list.filter((item) => item.id !== entry.id)].slice(0, MAX_RECENTS);
}

export async function loadOperatorMemory(businessId: string): Promise<OperatorMemory> {
  const snap = await profileRef(businessId).get();
  const data = snap.data() ?? {};
  return {
    clientAliases: asAliasList(data.clientAliases),
    productAliases: asAliasList(data.productAliases),
    recentClients: asRecentList(data.recentClients),
    recentProducts: asRecentList(data.recentProducts),
    recentSuppliers: asRecentList(data.recentSuppliers),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
  };
}

export function formatOperatorMemoryPrompt(memory: OperatorMemory): string {
  const clientLines = [...memory.clientAliases]
    .sort((a, b) => b.hits - a.hits)
    .slice(0, PROMPT_ALIASES)
    .map((item) => `- "${item.spoken}" → ${item.nombre}`);
  const productLines = [...memory.productAliases]
    .sort((a, b) => b.hits - a.hits)
    .slice(0, PROMPT_ALIASES)
    .map((item) => `- "${item.spoken}" → ${item.nombre}`);
  const recents: string[] = [];
  if (memory.recentClients.length) {
    recents.push(`clientes: ${memory.recentClients.map((c) => c.nombre).join(', ')}`);
  }
  if (memory.recentProducts.length) {
    recents.push(`productos: ${memory.recentProducts.map((p) => p.nombre).join(', ')}`);
  }
  if (memory.recentSuppliers.length) {
    recents.push(`proveedores: ${memory.recentSuppliers.map((s) => s.nombre).join(', ')}`);
  }
  if (!clientLines.length && !productLines.length && !recents.length) return '';

  const parts = [
    'Memoria de ESTE negocio (aprendida cuando el dueño confirmó con SÍ). Usala para interpretar apodos; no inventes clientes ni productos que no estén acá.',
  ];
  if (clientLines.length) {
    parts.push(`Apodos de clientes:\n${clientLines.join('\n')}`);
  }
  if (productLines.length) {
    parts.push(`Apodos de productos:\n${productLines.join('\n')}`);
  }
  if (recents.length) {
    parts.push(`Usó últimamente: ${recents.join('; ')}.`);
  }
  parts.push(
    'Si dice un apodo de la lista, poné en clientName/productName el nombre real del ERP. No asumas un cliente solo porque apareció en «últimamente».'
  );
  return parts.join('\n');
}

export async function findClientAlias(
  businessId: string,
  spoken: string
): Promise<{ clientId: string; clientName: string } | null> {
  const raw = spoken.trim();
  if (raw.length < 2) return null;
  const snap = await clientAliasRef(businessId, raw).get();
  if (!snap.exists) return null;
  const data = snap.data() as { clientId?: string; clientName?: string };
  const clientId = String(data.clientId ?? '').trim();
  if (!clientId) return null;

  const clientSnap = await db.doc(`negocios/${businessId}/clientes/${clientId}`).get();
  if (!clientSnap.exists || clientSnap.data()?.activo === false) {
    await snap.ref.delete().catch(() => undefined);
    return null;
  }
  const nombre = String(clientSnap.data()?.nombre ?? data.clientName ?? '').trim();
  return { clientId, clientName: nombre || raw };
}

export async function saveClientAlias(
  businessId: string,
  spoken: string,
  client: { id: string; nombre: string }
): Promise<void> {
  const raw = spoken.trim();
  if (raw.length < 2 || !client.id) return;
  if (normalizeAlias(raw) === normalizeAlias(client.nombre)) return;
  await clientAliasRef(businessId, raw).set(
    {
      aliasKey: productAliasKey(raw),
      aliasRaw: raw,
      clientId: client.id,
      clientName: client.nombre,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function findSupplierAlias(
  businessId: string,
  spoken: string
): Promise<{ supplierId: string; supplierName: string } | null> {
  const raw = spoken.trim();
  if (raw.length < 2) return null;
  const snap = await supplierAliasRef(businessId, raw).get();
  if (!snap.exists) return null;
  const data = snap.data() as { supplierId?: string; supplierName?: string };
  const supplierId = String(data.supplierId ?? '').trim();
  if (!supplierId) return null;

  const supplierSnap = await db.doc(`negocios/${businessId}/proveedores/${supplierId}`).get();
  if (!supplierSnap.exists || supplierSnap.data()?.activo === false) {
    await snap.ref.delete().catch(() => undefined);
    return null;
  }
  const nombre = String(supplierSnap.data()?.nombre ?? data.supplierName ?? '').trim();
  return { supplierId, supplierName: nombre || raw };
}

export async function saveSupplierAlias(
  businessId: string,
  spoken: string,
  supplier: { id: string; nombre: string }
): Promise<void> {
  const raw = spoken.trim();
  if (raw.length < 2 || !supplier.id) return;
  if (normalizeAlias(raw) === normalizeAlias(supplier.nombre)) return;
  await supplierAliasRef(businessId, raw).set(
    {
      aliasKey: productAliasKey(raw),
      aliasRaw: raw,
      supplierId: supplier.id,
      supplierName: supplier.nombre,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}

export async function rememberConfirmedOperation(
  businessId: string,
  entities: WhatsappCommandEntities
): Promise<void> {
  const spokenClient = String(entities.spokenClientName ?? '').trim();
  const clientId = String(entities.clientId ?? '').trim();
  const clientName = String(entities.clientName ?? '').trim();
  const spokenProduct = String(entities.spokenProductName ?? '').trim();
  const productId = String(entities.productId ?? '').trim();
  const productName = String(entities.productName ?? '').trim();
  const supplierId = String(entities.supplierId ?? '').trim();
  const supplierName = String(entities.supplierName ?? '').trim();

  if (clientId && spokenClient) {
    await saveClientAlias(businessId, spokenClient, { id: clientId, nombre: clientName || spokenClient });
  }
  const spokenPhone =
    String(entities.clientPhone ?? '').trim() || parsePersonNameAndPhone(spokenClient).telefono;
  if (clientId && spokenPhone) {
    const phone = formatClientNombreConCel('', spokenPhone).telefono;
    const ref = db.doc(`negocios/${businessId}/clientes/${clientId}`);
    const snap = await ref.get();
    if (snap.exists && !String(snap.data()?.telefono ?? '').trim() && phone) {
      await ref.update({ telefono: phone, updatedAt: new Date().toISOString() });
    }
  }
  if (productId && spokenProduct) {
    await saveProductAlias(businessId, spokenProduct, { id: productId, nombre: productName || spokenProduct });
  }
  for (const line of entities.items ?? []) {
    const spoken = String(line.spokenProductName || line.rawText || '').trim();
    const lineProductId = String(line.productId ?? '').trim();
    const lineProductName = String(line.productName ?? '').trim();
    if (lineProductId && spoken) {
      await saveProductAlias(businessId, spoken, {
        id: lineProductId,
        nombre: lineProductName || spoken,
      });
    }
  }
  for (const line of entities.purchaseLines ?? []) {
    const invoiceName = String(line.invoiceName ?? '').trim();
    const lineProductId = String(line.productId ?? '').trim();
    const lineProductName = String(line.productName ?? '').trim();
    if (lineProductId && invoiceName) {
      await saveProductAlias(businessId, invoiceName, {
        id: lineProductId,
        nombre: lineProductName || invoiceName,
      });
    } else if (line.tipoLinea === 'insumo' && invoiceName) {
      await saveInsumoAlias(businessId, invoiceName);
    }
  }

  const memory = await loadOperatorMemory(businessId);
  if (clientId && clientName) {
    memory.recentClients = upsertRecent(memory.recentClients, { id: clientId, nombre: clientName });
    if (spokenClient && normalizeAlias(spokenClient) !== normalizeAlias(clientName)) {
      memory.clientAliases = upsertAlias(memory.clientAliases, {
        spoken: spokenClient,
        id: clientId,
        nombre: clientName,
        hits: 1,
      });
    }
  }
  if (productId && productName) {
    memory.recentProducts = upsertRecent(memory.recentProducts, { id: productId, nombre: productName });
    if (spokenProduct && normalizeAlias(spokenProduct) !== normalizeAlias(productName)) {
      memory.productAliases = upsertAlias(memory.productAliases, {
        spoken: spokenProduct,
        id: productId,
        nombre: productName,
        hits: 1,
      });
    }
  }
  for (const line of entities.purchaseLines ?? []) {
    const invoiceName = String(line.invoiceName ?? '').trim();
    const lineProductId = String(line.productId ?? '').trim();
    const lineProductName = String(line.productName ?? '').trim();
    if (!lineProductId || !lineProductName) continue;
    memory.recentProducts = upsertRecent(memory.recentProducts, {
      id: lineProductId,
      nombre: lineProductName,
    });
    if (invoiceName && normalizeAlias(invoiceName) !== normalizeAlias(lineProductName)) {
      memory.productAliases = upsertAlias(memory.productAliases, {
        spoken: invoiceName,
        id: lineProductId,
        nombre: lineProductName,
        hits: 1,
      });
    }
  }
  if (supplierId && supplierName) {
    memory.recentSuppliers = upsertRecent(memory.recentSuppliers, {
      id: supplierId,
      nombre: supplierName,
    });
  }

  await profileRef(businessId).set(
    {
      ...memory,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}
