import { CashMovement } from '../services/cash.service';
import { StockMovement } from '../services/stock.service';

export function isDeletableCashMovement(movement: CashMovement): boolean {
  if (movement.pedidoId || movement.ventaId) return false;

  const tipo = String(movement.origenTipo ?? '');
  if (tipo.startsWith('pedido') || tipo === 'venta' || tipo.startsWith('venta')) return false;
  if (movement.origenGrupo === 'pedido' || movement.origenGrupo === 'venta') return false;

  return (
    movement.origenGrupo === 'manual' ||
    tipo.startsWith('caja_manual') ||
    !tipo
  );
}

export function isDeletableStockMovement(movement: StockMovement): boolean {
  const grupo = movement.origenGrupo;
  const tipo = String(movement.origenTipo ?? '');

  if (grupo === 'pedido' || tipo.startsWith('pedido') || movement.pedidoId) return false;
  if (grupo === 'compra' || tipo === 'compra' || movement.compraId) return false;
  if (tipo.startsWith('venta') || movement.ventaId) return false;
  if (grupo === 'carga_inicial' || tipo === 'carga_inicial') return false;

  return grupo === 'ajuste' || tipo.startsWith('ajuste');
}

export function getLinkedDocumentDeleteHint(): string {
  return 'Registrá un documento con signo contrario desde el origen, en lugar de borrar el registro.';
}
