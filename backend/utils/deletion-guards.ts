import { db } from '../firebase.ts';

export class DeletionBlockedError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'DeletionBlockedError';
  }
}

export const CONTRA_DOCUMENT_HINT =
  ' Registrá un documento con signo contrario (anulación o ajuste) desde el documento origen, en lugar de borrar el registro.';

function isManualCashMovement(movement: Record<string, unknown>): boolean {
  if (movement.origenGrupo === 'manual') return true;

  const tipo = String(movement.origenTipo ?? '');
  if (tipo.startsWith('caja_manual')) return true;
  if (movement.pedidoId) return false;
  if (tipo.startsWith('pedido') || tipo === 'venta' || tipo.startsWith('venta')) return false;
  if (movement.origenGrupo === 'pedido' || movement.origenGrupo === 'venta') return false;

  return true;
}

function isManualStockMovement(movement: Record<string, unknown>): boolean {
  const grupo = movement.origenGrupo;
  const tipo = String(movement.origenTipo ?? '');

  if (grupo === 'ajuste' || tipo.startsWith('ajuste')) return true;
  if (grupo === 'pedido' || tipo.startsWith('pedido') || movement.pedidoId) return false;
  if (grupo === 'compra' || tipo === 'compra' || movement.compraId) return false;
  if (tipo.startsWith('venta') || movement.ventaId) return false;
  if (grupo === 'carga_inicial' || tipo === 'carga_inicial') return false;

  return !movement.origenId && !tipo;
}

export async function validateCashMovementDeletion(
  businessId: string,
  movementId: string,
  movement: Record<string, unknown>
): Promise<void> {
  if (!isManualCashMovement(movement)) {
    const origen = movement.pedidoId
      ? 'un pedido'
      : movement.ventaId
        ? 'una venta'
        : 'otro documento';
    throw new DeletionBlockedError(
      `Este movimiento de caja fue generado automáticamente desde ${origen} y no se puede eliminar.${CONTRA_DOCUMENT_HINT}`
    );
  }

  if (movement.movimientoAnuladoId) {
    throw new DeletionBlockedError(
      `Este movimiento es una anulación vinculada a otro registro y no se puede eliminar.${CONTRA_DOCUMENT_HINT}`
    );
  }

  if (movement.pedidoId || movement.ventaId) {
    throw new DeletionBlockedError(
      `Este movimiento está vinculado a ${movement.ventaId ? 'una venta' : 'un pedido'}.${CONTRA_DOCUMENT_HINT}`
    );
  }

  const cajaCol = db.collection(`negocios/${businessId}/movimientos_caja`);

  const reversalSnap = await cajaCol.where('movimientoAnuladoId', '==', movementId).limit(1).get();
  if (!reversalSnap.empty) {
    throw new DeletionBlockedError(
      `Hay movimientos de anulación vinculados a este registro.${CONTRA_DOCUMENT_HINT}`
    );
  }

  const seniaOrderSnap = await db
    .collection(`negocios/${businessId}/pedidos`)
    .where('movimientoSeniaId', '==', movementId)
    .limit(1)
    .get();
  if (!seniaOrderSnap.empty) {
    throw new DeletionBlockedError(
      `Este movimiento está vinculado a la seña de un pedido.${CONTRA_DOCUMENT_HINT}`
    );
  }

  const ventaSnap = await db
    .collection(`negocios/${businessId}/ventas`)
    .where('movimientoCajaId', '==', movementId)
    .limit(1)
    .get();
  if (!ventaSnap.empty) {
    throw new DeletionBlockedError(
      `Este movimiento está vinculado a una venta.${CONTRA_DOCUMENT_HINT}`
    );
  }
}

export async function validateStockMovementDeletion(
  businessId: string,
  movement: Record<string, unknown>
): Promise<void> {
  if (!isManualStockMovement(movement)) {
    const origen =
      movement.pedidoId || String(movement.origenTipo ?? '').startsWith('pedido')
        ? 'un pedido'
        : movement.compraId || movement.origenGrupo === 'compra'
          ? 'una compra'
          : movement.ventaId || String(movement.origenTipo ?? '').startsWith('venta')
            ? 'una venta'
            : movement.origenGrupo === 'carga_inicial'
              ? 'la carga inicial del producto'
              : 'otro documento';

    throw new DeletionBlockedError(
      `Este movimiento de stock fue generado desde ${origen} y no se puede eliminar.${CONTRA_DOCUMENT_HINT}`
    );
  }

  const origenId = movement.origenId ? String(movement.origenId) : '';
  if (origenId) {
    const pedidoSnap = await db.collection(`negocios/${businessId}/pedidos`).doc(origenId).get();
    if (pedidoSnap.exists) {
      throw new DeletionBlockedError(
        `Este movimiento está vinculado a un pedido.${CONTRA_DOCUMENT_HINT}`
      );
    }

    const compraSnap = await db.collection(`negocios/${businessId}/compras`).doc(origenId).get();
    if (compraSnap.exists) {
      throw new DeletionBlockedError(
        `Este movimiento está vinculado a una compra.${CONTRA_DOCUMENT_HINT}`
      );
    }
  }
}

export async function validateOrderCancellation(
  businessId: string,
  _orderId: string,
  order: Record<string, unknown>
): Promise<void> {
  if (order.ventaId) {
    throw new DeletionBlockedError(
      'Este pedido tiene una venta vinculada. Anulá la venta primero; no se puede cancelar el pedido mientras exista ese vínculo.'
    );
  }
}

export function mapDeletionError(error: unknown): { status: number; message: string } | null {
  if (error instanceof DeletionBlockedError) {
    return { status: error.statusCode, message: error.message };
  }
  return null;
}

export { isManualCashMovement, isManualStockMovement };
