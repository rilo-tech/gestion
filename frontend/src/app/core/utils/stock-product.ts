import type { StockItem } from '../services/stock.service';

export function productControlsStock(
  item: Pick<StockItem, 'controlaStock'> | undefined
): boolean {
  return item?.controlaStock !== false;
}

export function productPermitsNegativeStock(
  item: Pick<StockItem, 'permitirStockNegativo'> | undefined
): boolean {
  return item?.permitirStockNegativo !== false;
}

export function itemControlsStock(
  item: Pick<StockItem, 'controlaStock' | 'categoria'> | undefined
): boolean {
  return productControlsStock(item);
}
