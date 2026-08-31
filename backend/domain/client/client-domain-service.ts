import { db } from '../../firebase.ts';
import { assertCanCreateClient } from '../../auth/usage-gates.ts';
import { formatClientNombreConCel } from '../../whatsapp/client-identity.ts';

export type CreateClientInput = {
  businessId: string;
  name: string;
  telefono?: string;
  source?: 'web' | 'whatsapp';
};

export type UpdateClientInput = {
  businessId: string;
  clientId: string;
  name?: string;
  telefono?: string;
  email?: string;
  notas?: string;
};

export async function createClient(input: CreateClientInput): Promise<{ id: string; name: string; telefono: string }> {
  const clean = String(input.name ?? '').trim();
  if (!clean) throw new Error('Indicá el nombre del cliente.');
  await assertCanCreateClient(input.businessId);
  const formatted = formatClientNombreConCel(clean, input.telefono);
  const docRef = await db.collection(`negocios/${input.businessId}/clientes`).add({
    nombre: formatted.nombre,
    activo: true,
    telefono: formatted.telefono,
    email: '',
    notas: input.source === 'whatsapp' ? 'Alta vía WhatsApp RILO Bot' : '',
    origenWhatsapp: input.source === 'whatsapp',
    createdAt: new Date().toISOString(),
  });
  return { id: docRef.id, name: formatted.nombre, telefono: formatted.telefono };
}

export async function updateClient(input: UpdateClientInput): Promise<{ id: string; name: string }> {
  const clientId = String(input.clientId ?? '').trim();
  if (!clientId) throw new Error('Indicá el cliente.');
  const ref = db.doc(`negocios/${input.businessId}/clientes/${clientId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('No encontré ese cliente.');
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (input.name != null) {
    const formatted = formatClientNombreConCel(String(input.name).trim(), input.telefono);
    patch.nombre = formatted.nombre;
    if (input.telefono != null || formatted.telefono) patch.telefono = formatted.telefono;
  } else if (input.telefono != null) {
    patch.telefono = formatClientNombreConCel(String(snap.data()?.nombre ?? ''), input.telefono).telefono;
  }
  if (input.email != null) patch.email = input.email;
  if (input.notas != null) patch.notas = input.notas;
  await ref.update(patch);
  const next = await ref.get();
  return { id: clientId, name: String(next.data()?.nombre ?? input.name ?? '') };
}
