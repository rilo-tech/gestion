import { db } from '../../firebase.ts';

export type CreateSupplierInput = {
  businessId: string;
  name: string;
  source?: 'web' | 'whatsapp';
};

export type UpdateSupplierInput = {
  businessId: string;
  supplierId: string;
  name?: string;
  telefono?: string;
  email?: string;
  notas?: string;
};

export async function createSupplier(input: CreateSupplierInput): Promise<{ id: string; name: string }> {
  const clean = String(input.name ?? '').trim();
  if (!clean) throw new Error('Indicá el nombre del proveedor.');
  const docRef = await db.collection(`negocios/${input.businessId}/proveedores`).add({
    nombre: clean,
    activo: true,
    telefono: '',
    email: '',
    notas: input.source === 'whatsapp' ? 'Alta vía WhatsApp RILO Bot' : '',
    origenWhatsapp: input.source === 'whatsapp',
    createdAt: new Date().toISOString(),
  });
  return { id: docRef.id, name: clean };
}

export async function updateSupplier(input: UpdateSupplierInput): Promise<{ id: string; name: string }> {
  const supplierId = String(input.supplierId ?? '').trim();
  if (!supplierId) throw new Error('Indicá el proveedor.');
  const ref = db.doc(`negocios/${input.businessId}/proveedores/${supplierId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('No encontré ese proveedor.');
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (input.name != null) patch.nombre = String(input.name).trim();
  if (input.telefono != null) patch.telefono = input.telefono;
  if (input.email != null) patch.email = input.email;
  if (input.notas != null) patch.notas = input.notas;
  await ref.update(patch);
  const next = await ref.get();
  return { id: supplierId, name: String(next.data()?.nombre ?? input.name ?? '') };
}
