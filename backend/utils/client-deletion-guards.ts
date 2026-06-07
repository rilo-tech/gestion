import { db } from '../firebase.ts';
import { DeletionBlockedError } from './deletion-guards.ts';

export interface ClientReferenceSummary {
  ventas: boolean;
  pedidos: boolean;
  movimientosCaja: boolean;
  compromisosPago: boolean;
}

function hasAnyReference(summary: ClientReferenceSummary): boolean {
  return summary.ventas || summary.pedidos || summary.movimientosCaja || summary.compromisosPago;
}

export async function getClientReferenceSummary(
  businessId: string,
  clientId: string
): Promise<ClientReferenceSummary> {
  const base = `negocios/${businessId}`;
  const [ventasSnap, pedidosSnap, cajaSnap, compromisosSnap] = await Promise.all([
    db.collection(`${base}/ventas`).where('clienteId', '==', clientId).limit(1).get(),
    db.collection(`${base}/pedidos`).where('clienteId', '==', clientId).limit(1).get(),
    db.collection(`${base}/movimientos_caja`).where('clienteId', '==', clientId).limit(1).get(),
    db.collection(`${base}/compromisos_pago`).where('clienteId', '==', clientId).limit(1).get(),
  ]);

  return {
    ventas: !ventasSnap.empty,
    pedidos: !pedidosSnap.empty,
    movimientosCaja: !cajaSnap.empty,
    compromisosPago: !compromisosSnap.empty,
  };
}

export function buildClientDeletionBlockedMessage(summary: ClientReferenceSummary): string {
  const parts: string[] = [];
  if (summary.ventas) parts.push('ventas');
  if (summary.pedidos) parts.push('pedidos');
  if (summary.movimientosCaja) parts.push('movimientos de caja');
  if (summary.compromisosPago) parts.push('compromisos de cobro');

  const list =
    parts.length === 1
      ? parts[0]
      : parts.length === 2
        ? `${parts[0]} y ${parts[1]}`
        : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;

  return `Este cliente tiene ${list} asociados. No se puede eliminar del sistema. Marcá el cliente como inactivo si ya no lo usás.`;
}

export async function validateClientDeletion(
  businessId: string,
  clientId: string
): Promise<void> {
  const summary = await getClientReferenceSummary(businessId, clientId);
  if (!hasAnyReference(summary)) return;
  throw new DeletionBlockedError(buildClientDeletionBlockedMessage(summary));
}
