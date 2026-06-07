export type TransactionTableColumnId =
  | 'product'
  | 'quantity'
  | 'unitCost'
  | 'personalization'
  | 'unitSale'
  | 'subtotal'
  | 'actions';

export type TransactionTableFieldId = 'quantity' | 'unitCost' | 'unitSale' | 'personalization';

export interface TransactionTableColumn {
  id: TransactionTableColumnId;
  header: string;
  headerShort?: string;
  widthClass?: string;
  align?: 'left' | 'center' | 'right';
  visible?: boolean;
}

export interface TransactionTableMetaItem {
  kind: 'text' | 'button';
  text: string;
  action?: string;
  textClass?: string;
  buttonClass?: string;
}

export interface TransactionTableLine {
  productName: string;
  productId?: string;
  productClickable?: boolean;
  quantity?: number | null;
  unitCost?: number | null;
  unitSale?: number | null;
  personalization?: number | null;
  subtotal?: number | null;
  extrasSummary?: string;
  metaItems?: TransactionTableMetaItem[];
  quantityEditable?: boolean;
  unitCostEditable?: boolean;
  unitSaleEditable?: boolean;
  personalizationEditable?: boolean;
  removable?: boolean;
}

export interface TransactionTableFieldChange {
  index: number;
  field: TransactionTableFieldId;
  value: number;
}

export const COLUMN_DEFAULTS: Record<
  TransactionTableColumnId,
  Omit<TransactionTableColumn, 'visible'>
> = {
  product: { id: 'product', header: 'Producto' },
  quantity: {
    id: 'quantity',
    header: 'Cant.',
    widthClass: 'w-[12%]',
    align: 'center',
  },
  unitCost: {
    id: 'unitCost',
    header: 'Costo u.',
    headerShort: 'Costo',
    widthClass: 'w-[16%]',
    align: 'center',
  },
  personalization: {
    id: 'personalization',
    header: 'Pers. u.',
    headerShort: 'Pers.',
    widthClass: 'w-[16%]',
    align: 'center',
  },
  unitSale: {
    id: 'unitSale',
    header: 'Venta u.',
    headerShort: 'Venta',
    widthClass: 'w-[16%]',
    align: 'center',
  },
  subtotal: {
    id: 'subtotal',
    header: 'Subtotal',
    widthClass: 'w-[18%]',
    align: 'right',
  },
  actions: { id: 'actions', header: '', widthClass: 'w-[10%]', align: 'center' },
};

export function buildTransactionTableColumns(
  ids: TransactionTableColumnId[],
  visibility: Partial<Record<TransactionTableColumnId, boolean>> = {}
): TransactionTableColumn[] {
  return ids
    .map((id) => ({
      ...COLUMN_DEFAULTS[id],
      visible: visibility[id] !== false,
    }))
    .filter((column) => column.visible !== false);
}

export const SALE_FORM_TABLE_COLUMNS: TransactionTableColumnId[] = [
  'product',
  'quantity',
  'personalization',
  'unitSale',
  'actions',
];

export const SALE_DETAIL_TABLE_COLUMNS: TransactionTableColumnId[] = [
  'product',
  'quantity',
  'unitSale',
  'subtotal',
];

export const ORDER_FORM_TABLE_COLUMNS: TransactionTableColumnId[] = [
  'product',
  'quantity',
  'unitCost',
  'personalization',
  'unitSale',
  'actions',
];

export const PURCHASE_STOCK_TABLE_COLUMNS: TransactionTableColumnId[] = [
  'product',
  'quantity',
  'unitCost',
  'actions',
];

export const PURCHASE_DETAIL_TABLE_COLUMNS: TransactionTableColumnId[] = [
  'product',
  'quantity',
  'unitCost',
  'subtotal',
];
