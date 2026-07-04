import {
  Component,
  ContentChild,
  EventEmitter,
  Input,
  Output,
  TemplateRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  TransactionTableColumn,
  TransactionTableColumnId,
  TransactionTableFieldChange,
  TransactionTableFieldId,
  TransactionTableLine,
  TransactionTableMetaItem,
  buildTransactionTableColumns,
  SALE_FORM_TABLE_COLUMNS,
  SALE_DETAIL_TABLE_COLUMNS,
  ORDER_FORM_TABLE_COLUMNS,
  ORDER_FORM_COLUMN_WEIGHTS,
  ORDER_LINES_LAYOUT_ID,
  ORDER_LINES_LAYOUT_VERSION,
  PURCHASE_STOCK_TABLE_COLUMNS,
  PURCHASE_DETAIL_TABLE_COLUMNS,
  COLUMN_DEFAULTS,
} from './transaction-lines-table.types';

const MOBILE_NUMERIC_COLUMN_IDS = new Set<TransactionTableColumnId>([
  'quantity',
  'unitCost',
  'personalization',
  'unitSale',
  'subtotal',
]);

@Component({
  selector: 'app-transaction-lines-table',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      *ngIf="!hideWhenEmpty || lines.length > 0"
      class="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden -mx-0">
      <!-- Móvil: tarjetas apiladas -->
      <div class="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
        <article
          *ngFor="let line of lines; let i = index; trackBy: trackByIndex"
          class="p-2 bg-white dark:bg-gray-900/40">
          <div class="flex items-start justify-between gap-1.5">
            <div class="min-w-0 flex-1">
              <button
                *ngIf="line.productClickable && line.productId; else mobileProductPlain"
                type="button"
                (click)="productClick.emit({ index: i, productId: line.productId })"
                class="font-medium text-xs text-gray-900 dark:text-gray-100 leading-snug text-left break-words hover:text-teal-700 dark:hover:text-teal-400 hover:underline"
                [title]="'Abrir producto: ' + line.productName">
                {{ line.productName || 'Producto' }}
              </button>
              <ng-template #mobileProductPlain>
                <p class="font-medium text-xs text-gray-900 dark:text-gray-100 leading-snug break-words">
                  {{ line.productName || 'Producto' }}
                </p>
              </ng-template>
              <p
                *ngIf="line.extrasSummary"
                class="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">
                {{ line.extrasSummary }}
              </p>
              <div
                *ngIf="metaRowTpl || line.metaItems?.length"
                class="mt-0.5 text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 leading-snug flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <ng-container *ngIf="metaRowTpl; else mobileDefaultMeta">
                  <ng-container
                    *ngTemplateOutlet="metaRowTpl; context: { $implicit: line, index: i }">
                  </ng-container>
                </ng-container>
                <ng-template #mobileDefaultMeta>
                  <ng-container *ngFor="let item of line.metaItems">
                    <span *ngIf="item.kind === 'text'" [ngClass]="item.textClass || 'tabular-nums'">
                      {{ item.text }}
                    </span>
                    <button
                      *ngIf="item.kind === 'button' && !readOnly"
                      type="button"
                      (click)="metaAction.emit({ index: i, action: item.action || item.text })"
                      [ngClass]="item.buttonClass || 'text-teal-600 dark:text-teal-400 font-medium hover:text-teal-800 dark:hover:text-teal-300'">
                      {{ item.text }}
                    </button>
                  </ng-container>
                </ng-template>
              </div>
            </div>
            <button
              *ngIf="showRemoveAction(line)"
              type="button"
              (click)="removeLine.emit(i)"
              class="shrink-0 inline-flex items-center justify-center w-6 h-6 -mr-0.5 text-sm text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded touch-manipulation"
              title="Quitar producto"
              aria-label="Quitar producto">
              ×
            </button>
          </div>

          <div
            *ngIf="mobileNumericColumns.length"
            class="mt-2 grid gap-x-1.5 gap-y-0"
            [ngClass]="mobileNumericGridClass">
            <div
              *ngFor="let column of mobileNumericColumns"
              class="min-w-0">
              <div
                class="txn-mobile-num-cell rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 overflow-hidden">
                <div
                  class="txn-mobile-num-label bg-gray-50 dark:bg-gray-800/80 border-b border-gray-100 dark:border-gray-700/80">
                  <span
                    class="block w-full text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 leading-none truncate text-center">
                    {{ mobileColumnLabel(column) }}
                  </span>
                </div>
                <div class="txn-mobile-num-body min-w-0 w-full">
                <ng-container [ngSwitch]="column.id">
                  <ng-container *ngSwitchCase="'quantity'">
                    <input
                      *ngIf="isEditable(line, 'quantity'); else mobileQuantityReadonly"
                      type="text"
                      inputmode="numeric"
                      [ngModel]="numericModel('quantity', i, line.quantity)"
                      (ngModelChange)="onNumericInput('quantity', i, $event)"
                      [name]="fieldName('quantity', i)"
                      (focus)="onNumericFocus('quantity', i, line.quantity, $event)"
                      (blur)="onNumericBlur('quantity', i, line.quantity)"
                      [class]="mobileLineNumericInputClass">
                    <ng-template #mobileQuantityReadonly>
                      <span [class]="mobileLineNumericValueClass">
                        {{ formatReadonlyNumber(line.quantity) }}
                      </span>
                    </ng-template>
                  </ng-container>

                  <ng-container *ngSwitchCase="'unitCost'">
                    <input
                      *ngIf="isEditable(line, 'unitCost'); else mobileUnitCostReadonly"
                      type="text"
                      inputmode="numeric"
                      [ngModel]="numericModel('unitCost', i, line.unitCost)"
                      (ngModelChange)="onNumericInput('unitCost', i, $event)"
                      [name]="fieldName('unitCost', i)"
                      (focus)="onNumericFocus('unitCost', i, line.unitCost, $event)"
                      (blur)="onNumericBlur('unitCost', i, line.unitCost)"
                      [class]="mobileLineNumericInputClass">
                    <ng-template #mobileUnitCostReadonly>
                      <span [class]="mobileLineNumericValueClass + ' text-gray-600 dark:text-gray-300'">
                        {{ formatReadonlyNumber(line.unitCost) }}
                      </span>
                    </ng-template>
                  </ng-container>

                  <ng-container *ngSwitchCase="'personalization'">
                    <input
                      *ngIf="isEditable(line, 'personalization'); else mobilePersonalizationReadonly"
                      type="text"
                      inputmode="numeric"
                      [ngModel]="numericModel('personalization', i, line.personalization)"
                      (ngModelChange)="onNumericInput('personalization', i, $event)"
                      [name]="fieldName('personalization', i)"
                      (focus)="onNumericFocus('personalization', i, line.personalization, $event)"
                      (blur)="onNumericBlur('personalization', i, line.personalization)"
                      [class]="mobileLineNumericInputClass">
                    <ng-template #mobilePersonalizationReadonly>
                      <span [class]="mobileLineNumericValueClass + ' text-gray-600 dark:text-gray-300'">
                        {{ formatReadonlyNumber(line.personalization) }}
                      </span>
                    </ng-template>
                  </ng-container>

                  <ng-container *ngSwitchCase="'unitSale'">
                    <input
                      *ngIf="isEditable(line, 'unitSale'); else mobileUnitSaleReadonly"
                      type="text"
                      inputmode="numeric"
                      [ngModel]="numericModel('unitSale', i, line.unitSale)"
                      (ngModelChange)="onNumericInput('unitSale', i, $event)"
                      [name]="fieldName('unitSale', i)"
                      (focus)="onNumericFocus('unitSale', i, line.unitSale, $event)"
                      (blur)="onNumericBlur('unitSale', i, line.unitSale)"
                      [class]="mobileLineNumericInputClass">
                    <ng-template #mobileUnitSaleReadonly>
                      <span [class]="mobileLineNumericValueClass">
                        {{ formatReadonlyCurrency(line.unitSale) }}
                      </span>
                    </ng-template>
                  </ng-container>

                  <ng-container *ngSwitchCase="'subtotal'">
                    <span [class]="mobileLineNumericValueClass + ' font-semibold justify-center truncate'">
                      {{ formatReadonlyCurrency(line.subtotal) }}
                    </span>
                  </ng-container>
                </ng-container>
                </div>
              </div>
            </div>
          </div>
        </article>

        <p
          *ngIf="lines.length === 0 && showEmptyPlaceholder && emptyMessage"
          class="px-3 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
          {{ emptyMessage }}
        </p>
      </div>

      <!-- Desktop: tabla -->
      <div class="hidden sm:block" [class.app-table-scroll-host]="isCompact">
      <table
        class="app-data-table w-full table-fixed text-left"
        [class.order-lines-table]="isCompact"
        [attr.data-col-layout-id]="isCompact ? orderLinesLayoutId : null"
        [attr.data-col-layout-version]="isCompact ? orderLinesLayoutVersion : null"
        [ngClass]="isCompact ? 'text-xs' : 'text-sm'">
        <colgroup *ngIf="isCompact">
          <col *ngFor="let column of visibleColumns" [style.width.%]="columnColPercent(column)" />
        </colgroup>
        <thead
          class="bg-gray-50 dark:bg-gray-800/80 uppercase text-gray-400 dark:text-gray-500"
          [ngClass]="isCompact ? 'text-[10px]' : 'text-xs'">
          <tr>
            <th
              *ngFor="let column of visibleColumns"
              class="whitespace-nowrap"
              [ngClass]="desktopHeaderCellClass(column)"
              [class.text-center]="column.align === 'center'"
              [class.text-right]="column.align === 'right'"
              [attr.data-col-weight]="column.colWeight ?? null"
              [class.order-lines-num-col]="isCompact && isCompactNumericColumn(column)"
              [class.order-lines-actions-col]="isCompact && column.id === 'actions'">
              {{ column.headerShort || column.header }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50 dark:divide-gray-800">
          <tr *ngFor="let line of lines; let i = index; trackBy: trackByIndex">
            <td
              *ngFor="let column of visibleColumns"
              [ngClass]="desktopBodyCellClass(column)"
              [class.text-center]="column.align === 'center'"
              [class.text-right]="column.align === 'right'"
              [class.min-w-0]="column.id === 'product'"
              [class.order-lines-num-col]="isCompact && isCompactNumericColumn(column)"
              [class.order-lines-actions-col]="isCompact && column.id === 'actions'">
              <ng-container [ngSwitch]="column.id">
                <ng-container *ngSwitchCase="'product'">
                  <button
                    *ngIf="line.productClickable && line.productId; else productPlain"
                    type="button"
                    (click)="productClick.emit({ index: i, productId: line.productId })"
                    [class]="desktopProductButtonClass"
                    [title]="'Abrir producto: ' + line.productName">
                    {{ line.productName || 'Producto' }}
                  </button>
                  <ng-template #productPlain>
                    <p
                      [class]="desktopProductTextClass"
                      [title]="isCompact ? (line.productName || 'Producto') : null">
                      {{ line.productName || 'Producto' }}
                    </p>
                  </ng-template>
                  <p
                    *ngIf="line.extrasSummary"
                    class="text-gray-500 dark:text-gray-400 mt-0.5 leading-snug"
                    [ngClass]="isCompact ? 'text-[10px]' : 'text-xs'">
                    {{ line.extrasSummary }}
                  </p>
                  <div
                    *ngIf="metaRowTpl || line.metaItems?.length"
                    class="mt-1 text-gray-500 dark:text-gray-400 leading-snug flex flex-wrap items-center gap-x-2 gap-y-0.5"
                    [ngClass]="isCompact ? 'text-[10px]' : 'text-xs'">
                    <ng-container *ngIf="metaRowTpl; else defaultMeta">
                      <ng-container
                        *ngTemplateOutlet="metaRowTpl; context: { $implicit: line, index: i }">
                      </ng-container>
                    </ng-container>
                    <ng-template #defaultMeta>
                      <ng-container *ngFor="let item of line.metaItems">
                        <span *ngIf="item.kind === 'text'" [ngClass]="item.textClass || 'tabular-nums'">
                          {{ item.text }}
                        </span>
                        <button
                          *ngIf="item.kind === 'button' && !readOnly"
                          type="button"
                          (click)="metaAction.emit({ index: i, action: item.action || item.text })"
                          [ngClass]="item.buttonClass || 'text-teal-600 dark:text-teal-400 font-medium hover:text-teal-800 dark:hover:text-teal-300'">
                          {{ item.text }}
                        </button>
                      </ng-container>
                    </ng-template>
                  </div>
                </ng-container>

                <ng-container *ngSwitchCase="'quantity'">
                  <input
                    *ngIf="isEditable(line, 'quantity'); else quantityReadonly"
                    type="text"
                    inputmode="numeric"
                    [ngModel]="numericModel('quantity', i, line.quantity)"
                    (ngModelChange)="onNumericInput('quantity', i, $event)"
                    [name]="fieldName('quantity', i)"
                    (focus)="onNumericFocus('quantity', i, line.quantity, $event)"
                    (blur)="onNumericBlur('quantity', i, line.quantity)"
                    [class]="lineNumericInputClass + ' text-center'">
                  <ng-template #quantityReadonly>
                    <span [class]="lineNumericValueClass + ' text-center'">{{ formatReadonlyNumber(line.quantity) }}</span>
                  </ng-template>
                </ng-container>

                <ng-container *ngSwitchCase="'unitCost'">
                  <input
                    *ngIf="isEditable(line, 'unitCost'); else unitCostReadonly"
                    type="text"
                    inputmode="numeric"
                    [ngModel]="numericModel('unitCost', i, line.unitCost)"
                    (ngModelChange)="onNumericInput('unitCost', i, $event)"
                    [name]="fieldName('unitCost', i)"
                    (focus)="onNumericFocus('unitCost', i, line.unitCost, $event)"
                    (blur)="onNumericBlur('unitCost', i, line.unitCost)"
                    [class]="lineNumericInputClass + ' text-center'">
                  <ng-template #unitCostReadonly>
                    <span [class]="lineNumericValueClass + ' text-center text-gray-600 dark:text-gray-300'">{{ formatReadonlyNumber(line.unitCost) }}</span>
                  </ng-template>
                </ng-container>

                <ng-container *ngSwitchCase="'personalization'">
                  <input
                    *ngIf="isEditable(line, 'personalization'); else personalizationReadonly"
                    type="text"
                    inputmode="numeric"
                    [ngModel]="numericModel('personalization', i, line.personalization)"
                    (ngModelChange)="onNumericInput('personalization', i, $event)"
                    [name]="fieldName('personalization', i)"
                    (focus)="onNumericFocus('personalization', i, line.personalization, $event)"
                    (blur)="onNumericBlur('personalization', i, line.personalization)"
                    [class]="lineNumericInputClass + ' text-center'">
                  <ng-template #personalizationReadonly>
                    <span [class]="lineNumericValueClass + ' text-center text-gray-600 dark:text-gray-300'">{{ formatReadonlyNumber(line.personalization) }}</span>
                  </ng-template>
                </ng-container>

                <ng-container *ngSwitchCase="'unitSale'">
                  <input
                    *ngIf="isEditable(line, 'unitSale'); else unitSaleReadonly"
                    type="text"
                    inputmode="numeric"
                    [ngModel]="numericModel('unitSale', i, line.unitSale)"
                    (ngModelChange)="onNumericInput('unitSale', i, $event)"
                    [name]="fieldName('unitSale', i)"
                    (focus)="onNumericFocus('unitSale', i, line.unitSale, $event)"
                    (blur)="onNumericBlur('unitSale', i, line.unitSale)"
                    [class]="lineNumericInputClass + ' text-center'">
                  <ng-template #unitSaleReadonly>
                    <span [class]="lineNumericValueClass + ' text-center'">{{ formatReadonlyCurrency(line.unitSale) }}</span>
                  </ng-template>
                </ng-container>

                <ng-container *ngSwitchCase="'subtotal'">
                  <span [class]="lineNumericValueClass + ' font-semibold whitespace-nowrap'">
                    {{ formatReadonlyCurrency(line.subtotal) }}
                  </span>
                </ng-container>

                <ng-container *ngSwitchCase="'actions'">
                  <button
                    *ngIf="showRemoveAction(line)"
                    type="button"
                    (click)="removeLine.emit(i)"
                    [class]="removeButtonClass"
                    title="Quitar producto"
                    aria-label="Quitar producto">
                    ×
                  </button>
                </ng-container>
              </ng-container>
            </td>
          </tr>
          <tr *ngIf="lines.length === 0 && showEmptyPlaceholder && emptyMessage">
            <td [attr.colspan]="visibleColumns.length" class="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              {{ emptyMessage }}
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  `,
})
export class TransactionLinesTableComponent {
  readonly orderLinesLayoutId = ORDER_LINES_LAYOUT_ID;
  readonly orderLinesLayoutVersion = ORDER_LINES_LAYOUT_VERSION;

  readonly numericInputClass =
    'w-full min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-sm leading-tight tabular-nums outline-none focus:ring-2 focus:ring-teal-500';

  readonly mobileLineNumericInputClass =
    'txn-mobile-num-input w-full min-w-0 m-0 border-0 rounded-none bg-transparent text-xs text-center tabular-nums outline-none focus:ring-0 focus:bg-teal-50/40 dark:focus:bg-teal-950/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  readonly mobileLineNumericValueClass =
    'flex w-full h-full min-h-0 items-center justify-center px-1 text-xs text-center leading-none tabular-nums text-gray-900 dark:text-gray-100';

  @Input() lines: TransactionTableLine[] = [];
  @Input() columns: TransactionTableColumn[] = buildTransactionTableColumns(['product', 'quantity', 'unitSale']);
  @Input() readOnly = false;
  @Input() emptyMessage = 'Sin productos.';
  @Input() showEmptyPlaceholder = false;
  /** Oculta la tabla (encabezados incluidos) hasta que haya al menos una línea. */
  @Input() hideWhenEmpty = false;
  @Input() fieldNamePrefix = 'txnLine';
  /** Tabla desktop más densa: columnas numéricas angostas y nombre en una línea. */
  @Input() density: 'default' | 'compact' = 'default';

  @Output() fieldChange = new EventEmitter<TransactionTableFieldChange>();
  @Output() removeLine = new EventEmitter<number>();
  @Output() metaAction = new EventEmitter<{ index: number; action: string }>();
  @Output() productClick = new EventEmitter<{ index: number; productId?: string }>();

  @ContentChild('metaRow') metaRowTpl?: TemplateRef<{
    $implicit: TransactionTableLine;
    index: number;
  }>;

  private editingNumericFields = new Map<string, string>();
  private pendingBlur: Array<{
    field: TransactionTableFieldId;
    index: number;
    fallback: number | null | undefined;
  }> | null = null;

  get isCompact(): boolean {
    return this.density === 'compact';
  }

  get desktopHeaderCellClass(): (column: TransactionTableColumn) => string {
    return (column) => this.desktopCellPaddingClass(column, true);
  }

  get desktopBodyCellClass(): (column: TransactionTableColumn) => string {
    return (column) => this.desktopCellPaddingClass(column, false);
  }

  private desktopCellPaddingClass(column: TransactionTableColumn, isHeader: boolean): string {
    const vertical = isHeader
      ? this.isCompact
        ? 'py-2'
        : 'py-2.5'
      : this.isCompact
        ? 'py-2'
        : 'py-2.5';
    if (!this.isCompact) {
      return `px-3 sm:px-4 ${vertical} align-top`;
    }
    if (column.id === 'product') {
      return `px-2 sm:px-3 ${vertical} align-top`;
    }
    if (column.id === 'actions') {
      return `px-0.5 ${vertical} align-top`;
    }
    return `px-1 ${vertical} align-top`;
  }

  get desktopProductButtonClass(): string {
    const base =
      'block max-w-full font-medium text-gray-900 dark:text-gray-100 leading-snug text-left hover:text-teal-700 dark:hover:text-teal-400 hover:underline';
    return this.isCompact
      ? `${base} text-xs truncate`
      : `${base} text-sm break-words`;
  }

  get desktopProductTextClass(): string {
    const base = 'font-medium text-gray-900 dark:text-gray-100 leading-snug';
    return this.isCompact
      ? `${base} text-xs truncate max-w-full`
      : `${base} text-sm break-words`;
  }

  get lineNumericInputClass(): string {
    return this.isCompact
      ? 'w-full max-w-[4.25rem] mx-auto min-w-0 px-1 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-xs leading-tight tabular-nums outline-none focus:ring-2 focus:ring-teal-500'
      : this.numericInputClass;
  }

  get lineNumericValueClass(): string {
    return this.isCompact
      ? 'block tabular-nums text-xs'
      : 'block tabular-nums text-sm';
  }

  get removeButtonClass(): string {
    return this.isCompact
      ? 'inline-flex items-center justify-center w-6 h-6 text-sm text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-md'
      : 'inline-flex items-center justify-center w-7 h-7 text-base text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg';
  }

  isCompactNumericColumn(column: TransactionTableColumn): boolean {
    return (
      column.id === 'quantity' ||
      column.id === 'unitCost' ||
      column.id === 'personalization' ||
      column.id === 'unitSale' ||
      column.id === 'subtotal'
    );
  }

  columnColPercent(column: TransactionTableColumn): number {
    const weights = this.visibleColumns.map((col) => this.columnLayoutWeight(col));
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const index = this.visibleColumns.findIndex((col) => col.id === column.id);
    return index < 0 ? 0 : (weights[index] / total) * 100;
  }

  private columnLayoutWeight(column: TransactionTableColumn): number {
    if (column.colWeight != null) return column.colWeight;
    if (column.id === 'product') return ORDER_FORM_COLUMN_WEIGHTS.product ?? 69;
    if (column.id === 'actions') return ORDER_FORM_COLUMN_WEIGHTS.actions ?? 3;
    if (this.isCompactNumericColumn(column)) return 7;
    return 10;
  }

  get visibleColumns(): TransactionTableColumn[] {
    return this.columns.filter((column) => column.visible !== false);
  }

  get mobileNumericColumns(): TransactionTableColumn[] {
    let cols = this.visibleColumns.filter((column) => MOBILE_NUMERIC_COLUMN_IDS.has(column.id));

    if (
      !this.readOnly &&
      cols.some((column) => column.id === 'personalization') &&
      !this.lines.some((line) => line.personalizationEditable === true)
    ) {
      cols = cols.filter((column) => column.id !== 'personalization');
    }

    if (this.readOnly || cols.some((column) => column.id === 'subtotal')) {
      return cols;
    }

    const hasQty = cols.some((column) => column.id === 'quantity');
    const hasPriceColumn = cols.some(
      (column) => column.id === 'unitSale' || column.id === 'unitCost'
    );
    if (hasQty && hasPriceColumn) {
      return [...cols, { ...COLUMN_DEFAULTS.subtotal, visible: true }];
    }

    return cols;
  }

  get mobileNumericGridClass(): string {
    switch (this.mobileNumericColumns.length) {
      case 1:
        return 'grid-cols-1';
      case 2:
        return 'grid-cols-2';
      case 3:
        return 'grid-cols-3';
      case 4:
        return 'grid-cols-4';
      case 5:
        return 'grid-cols-5';
      default:
        return 'grid-cols-4';
    }
  }

  trackByIndex(index: number): number {
    return index;
  }

  mobileColumnLabel(column: TransactionTableColumn): string {
    return column.headerShort || column.header;
  }

  mobileColumnAlign(column: TransactionTableColumn): 'left' | 'center' | 'right' {
    return column.align || 'left';
  }

  showRemoveAction(line: TransactionTableLine): boolean {
    return !this.readOnly && line.removable !== false && this.visibleColumns.some((column) => column.id === 'actions');
  }

  isEditable(line: TransactionTableLine, field: TransactionTableFieldId): boolean {
    if (this.readOnly) return false;
    switch (field) {
      case 'quantity':
        return line.quantityEditable !== false;
      case 'unitCost':
        return line.unitCostEditable === true;
      case 'unitSale':
        return line.unitSaleEditable !== false;
      case 'personalization':
        return line.personalizationEditable === true;
      default:
        return false;
    }
  }

  numericModel(field: TransactionTableFieldId, index: number, value: number | null | undefined): string {
    const key = this.numericKey(field, index);
    if (this.editingNumericFields.has(key)) {
      return this.editingNumericFields.get(key)!;
    }
    const num = Number(value);
    if (Number.isFinite(num)) return String(num);
    return field === 'quantity' ? '1' : '0';
  }

  onNumericFocus(
    field: TransactionTableFieldId,
    index: number,
    value: number | null | undefined,
    event: FocusEvent
  ): void {
    const key = this.numericKey(field, index);
    const num = Number(value) || 0;
    const input = event.target as HTMLInputElement;

    if (num === 0) {
      this.editingNumericFields.set(key, '');
      return;
    }

    this.editingNumericFields.set(key, String(num));
    window.setTimeout(() => input.select());
  }

  onNumericInput(field: TransactionTableFieldId, index: number, raw: string): void {
    this.editingNumericFields.set(this.numericKey(field, index), raw);
  }

  onNumericBlur(field: TransactionTableFieldId, index: number, fallback: number | null | undefined): void {
    this.pendingBlur = [{ field, index, fallback }];
    window.setTimeout(() => this.flushPendingBlur(), 0);
  }

  fieldName(field: TransactionTableFieldId, index: number): string {
    return `${this.fieldNamePrefix}_${field}_${index}`;
  }

  formatReadonlyNumber(value: number | null | undefined): string {
    const num = Number(value);
    return Number.isFinite(num) ? String(num) : '—';
  }

  formatReadonlyCurrency(value: number | null | undefined): string {
    const num = Number(value);
    return Number.isFinite(num) ? `$${num}` : '—';
  }

  clearNumericDraftsForIndex(index: number): void {
    for (const field of ['quantity', 'unitCost', 'unitSale', 'personalization'] as TransactionTableFieldId[]) {
      this.editingNumericFields.delete(this.numericKey(field, index));
    }
  }

  private flushPendingBlur(): void {
    const pending = this.pendingBlur;
    this.pendingBlur = null;
    if (!pending?.length) return;

    for (const entry of pending) {
      const key = this.numericKey(entry.field, entry.index);
      const raw = this.editingNumericFields.get(key) ?? String(entry.fallback ?? (entry.field === 'quantity' ? 1 : 0));
      this.editingNumericFields.delete(key);

      let value = this.parseNumericInput(raw, entry.field === 'quantity' ? 1 : 0);
      if (entry.field === 'quantity') {
        value = Math.max(1, Math.floor(value));
      } else {
        value = Math.max(0, value);
      }

      const previous = Number(entry.fallback);
      if (Number.isFinite(previous) && previous === value) {
        continue;
      }

      this.fieldChange.emit({
        index: entry.index,
        field: entry.field,
        value,
      });
    }
  }

  private numericKey(field: TransactionTableFieldId, index: number): string {
    return `${field}:${index}`;
  }

  private parseNumericInput(raw: string, fallback: number): number {
    const normalized = String(raw ?? '').trim().replace(',', '.');
    if (!normalized) return fallback;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}

export {
  buildTransactionTableColumns,
  SALE_FORM_TABLE_COLUMNS,
  SALE_DETAIL_TABLE_COLUMNS,
  ORDER_FORM_TABLE_COLUMNS,
  ORDER_FORM_COLUMN_WEIGHTS,
  ORDER_LINES_LAYOUT_ID,
  ORDER_LINES_LAYOUT_VERSION,
  PURCHASE_STOCK_TABLE_COLUMNS,
  PURCHASE_DETAIL_TABLE_COLUMNS,
};
export type { TransactionTableColumnId, TransactionTableMetaItem, TransactionTableLine };
