const MIN_COL_WIDTH = 48;
const HANDLE_CLASS = 'app-col-resize-handle';
const TABLE_BOUND_ATTR = 'data-resizable-table-bound';
const TABLE_FITTED_ATTR = 'data-resizable-fitted';
const TABLE_EXPANDED_ATTR = 'data-resizable-expanded';
const SCROLL_EXPANDED_ATTR = 'data-table-scroll-expanded';

/** Tablas visibles en desktop de listados. */
const TABLE_FIT_MIN_WIDTH = 640;
/** Redimensionar columnas solo en pantallas grandes. */
const RESIZE_HANDLE_MIN_WIDTH = 1024;

interface ColumnBinding {
  handle: HTMLElement;
  onMouseDown: (event: MouseEvent) => void;
}

type ResizableTableElement = HTMLTableElement & {
  __colResizeBindings?: ColumnBinding[];
  __colResizeContainerObserver?: ResizeObserver;
};

function supportsTableFit(): boolean {
  return window.matchMedia(`(min-width: ${TABLE_FIT_MIN_WIDTH}px)`).matches;
}

function supportsColumnResize(): boolean {
  return window.matchMedia(`(min-width: ${RESIZE_HANDLE_MIN_WIDTH}px)`).matches;
}

function unbindTable(table: ResizableTableElement): void {
  const bindings = table.__colResizeBindings;
  if (bindings) {
    for (const binding of bindings) {
      binding.handle.removeEventListener('mousedown', binding.onMouseDown);
      binding.handle.remove();
    }
    delete table.__colResizeBindings;
  }

  table.__colResizeContainerObserver?.disconnect();
  delete table.__colResizeContainerObserver;

  table.removeAttribute(TABLE_BOUND_ATTR);
  table.removeAttribute(TABLE_FITTED_ATTR);
  table.removeAttribute(TABLE_EXPANDED_ATTR);
  table.style.width = '';
  table.style.minWidth = '';
  table.style.maxWidth = '';
  syncScrollContainerMode(table);
}

function syncScrollContainerMode(table: ResizableTableElement): void {
  const container = getTableScrollContainer(table);
  if (!container) return;

  const expanded = table.getAttribute(TABLE_EXPANDED_ATTR) === '1';
  container.setAttribute(SCROLL_EXPANDED_ATTR, expanded ? 'true' : 'false');
}

function getVisibleHeaderCells(table: HTMLTableElement): HTMLTableCellElement[] {
  const row = table.querySelector('thead tr');
  if (!row) return [];

  return Array.from(row.querySelectorAll('th')).filter((cell) => {
    if (cell.colSpan > 1) return false;
    const style = window.getComputedStyle(cell);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

function ensureColgroup(table: HTMLTableElement, count: number): HTMLTableColElement[] {
  let colgroup = table.querySelector('colgroup');
  if (!colgroup) {
    colgroup = document.createElement('colgroup');
    table.insertBefore(colgroup, table.firstChild);
  }

  while (colgroup.children.length < count) {
    colgroup.appendChild(document.createElement('col'));
  }
  while (colgroup.children.length > count) {
    colgroup.removeChild(colgroup.lastChild!);
  }

  return Array.from(colgroup.querySelectorAll('col'));
}

function getTableScrollContainer(table: HTMLTableElement): HTMLElement | null {
  let element: HTMLElement | null = table.parentElement;
  while (element) {
    if (element.classList.contains('app-table-scroll-host')) {
      return element;
    }
    const style = window.getComputedStyle(element);
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
      return element;
    }
    element = element.parentElement;
  }
  return table.parentElement;
}

function getTableContainerWidth(table: HTMLTableElement): number {
  const container = getTableScrollContainer(table);
  return container?.clientWidth ?? table.parentElement?.clientWidth ?? 0;
}

function parseWidthToPx(value: string, containerWidth: number): number {
  const raw = value.trim().toLowerCase();
  if (!raw) return 0;
  if (raw.endsWith('%')) {
    return (containerWidth * parseFloat(raw)) / 100;
  }
  if (raw.endsWith('px')) {
    return parseFloat(raw) || 0;
  }
  if (raw.endsWith('rem')) {
    return (parseFloat(raw) || 0) * 16;
  }
  const numeric = parseFloat(raw);
  return Number.isFinite(numeric) ? numeric : 0;
}

function readColumnWeight(header: HTMLTableCellElement): number | null {
  const raw = header.getAttribute('data-col-weight')?.trim();
  if (!raw) return null;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getDefaultColumnWeights(headers: HTMLTableCellElement[]): number[] {
  return headers.map((header, index) => {
    const customWeight = readColumnWeight(header);
    if (customWeight) return customWeight;

    const text = header.textContent?.trim().toLowerCase() ?? '';
    if (/accion|acción|actions/.test(text)) return 7;
    if (/^$/.test(text)) return 4;
    if (/monto|saldo|total|precio|importe/.test(text)) return 10;
    if (/fecha|venc|vto/.test(text)) return 10;
    if (/estado|medio|origen|tipo/.test(text)) return 9;
    if (/detalle|descripcion|descripción|concepto|producto|nombre|item|empresa|prestamista|resumen/.test(text)) {
      return 26;
    }
    if (/cuota|cuenta|codigo|código|contacto|cant|stock|ped/.test(text)) return 11;
    if (index === 0) return 9;
    if (index === headers.length - 1) return 8;
    return 12;
  });
}

function getColumnWeights(
  table: HTMLTableElement,
  headers: HTMLTableCellElement[],
  cols: HTMLTableColElement[]
): number[] {
  const containerWidth = getTableContainerWidth(table) || table.offsetWidth || 1;
  const fromDefaults = getDefaultColumnWeights(headers);
  const hasStyledCols = cols.some((col) => col.style.width.trim());

  if (!hasStyledCols) {
    return fromDefaults;
  }

  return cols.map((col, index) => {
    const styled = col.style.width.trim();
    if (styled) {
      const parsed = parseWidthToPx(styled, containerWidth);
      if (parsed > 0) return parsed;
    }
    return fromDefaults[index] ?? 12;
  });
}

function applyFittedColumnWidths(
  table: ResizableTableElement,
  headers: HTMLTableCellElement[],
  cols: HTMLTableColElement[]
): void {
  const containerWidth = getTableContainerWidth(table);
  if (containerWidth <= 0 || headers.length === 0) return;

  table.style.tableLayout = 'fixed';
  table.style.width = '100%';
  table.style.minWidth = '0';
  table.style.maxWidth = '100%';

  void table.offsetWidth;

  const weights = getColumnWeights(table, headers, cols);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || headers.length;

  cols.forEach((col, index) => {
    col.style.width = `${(weights[index] / total) * 100}%`;
  });

  table.setAttribute(TABLE_FITTED_ATTR, '1');
  table.removeAttribute(TABLE_EXPANDED_ATTR);
  syncScrollContainerMode(table);
}

function sumColumnPixelWidths(cols: HTMLTableColElement[]): number {
  return cols.reduce((sum, col) => {
    const styled = parseFloat(col.style.width);
    if (Number.isFinite(styled) && col.style.width.includes('px')) {
      return sum + styled;
    }
    return sum + col.getBoundingClientRect().width;
  }, 0);
}

function freezeColumnsToPixels(
  table: ResizableTableElement,
  headers: HTMLTableCellElement[],
  cols: HTMLTableColElement[]
): void {
  cols.forEach((col, index) => {
    const width = headers[index]?.getBoundingClientRect().width ?? col.getBoundingClientRect().width;
    col.style.width = `${Math.max(MIN_COL_WIDTH, Math.round(width))}px`;
  });

  table.removeAttribute(TABLE_FITTED_ATTR);
  table.setAttribute(TABLE_EXPANDED_ATTR, '1');
  table.style.maxWidth = '';
  syncExpandedTableWidth(table, cols);
}

function syncExpandedTableWidth(table: ResizableTableElement, cols: HTMLTableColElement[]): void {
  const total = Math.round(sumColumnPixelWidths(cols));
  table.style.width = `${total}px`;
  table.style.minWidth = `${total}px`;
  syncScrollContainerMode(table);
}

function maybeCollapseExpandedTable(
  table: ResizableTableElement,
  headers: HTMLTableCellElement[],
  cols: HTMLTableColElement[]
): void {
  if (table.getAttribute(TABLE_EXPANDED_ATTR) !== '1') return;

  const containerWidth = getTableContainerWidth(table);
  const total = sumColumnPixelWidths(cols);
  if (containerWidth > 0 && total <= containerWidth + 1) {
    applyFittedColumnWidths(table, headers, cols);
  } else {
    syncExpandedTableWidth(table, cols);
  }
}

function attachResizeHandles(
  table: ResizableTableElement,
  headers: HTMLTableCellElement[],
  cols: HTMLTableColElement[]
): void {
  const bindings: ColumnBinding[] = [];

  headers.forEach((header, index) => {
    header.style.position = 'relative';

    const handle = document.createElement('span');
    handle.className = HANDLE_CLASS;
    handle.title = 'Arrastrá para cambiar el ancho de la columna';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Redimensionar columna');

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      if (table.getAttribute(TABLE_EXPANDED_ATTR) !== '1') {
        freezeColumnsToPixels(table, headers, cols);
      }

      const startX = event.clientX;
      const startWidth = cols[index].getBoundingClientRect().width || MIN_COL_WIDTH;

      handle.classList.add('is-active');
      document.body.classList.add('app-col-resizing');

      const onMouseMove = (moveEvent: MouseEvent) => {
        const nextWidth = Math.max(MIN_COL_WIDTH, Math.round(startWidth + moveEvent.clientX - startX));
        cols[index].style.width = `${nextWidth}px`;
        syncExpandedTableWidth(table, cols);
      };

      const onMouseUp = () => {
        handle.classList.remove('is-active');
        document.body.classList.remove('app-col-resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        maybeCollapseExpandedTable(table, headers, cols);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    handle.addEventListener('mousedown', onMouseDown);
    header.appendChild(handle);
    bindings.push({ handle, onMouseDown });
  });

  table.__colResizeBindings = bindings;
}

function observeTableContainer(
  table: ResizableTableElement,
  headers: HTMLTableCellElement[],
  cols: HTMLTableColElement[]
): void {
  const container = getTableScrollContainer(table);
  if (!container) return;

  table.__colResizeContainerObserver?.disconnect();
  const observer = new ResizeObserver(() => {
    if (table.getAttribute(TABLE_EXPANDED_ATTR) === '1') {
      maybeCollapseExpandedTable(table, headers, cols);
      return;
    }
    applyFittedColumnWidths(table, headers, cols);
  });
  observer.observe(container);
  table.__colResizeContainerObserver = observer;
}

function detachResizeHandles(table: ResizableTableElement): void {
  const bindings = table.__colResizeBindings;
  if (!bindings) return;

  for (const binding of bindings) {
    binding.handle.removeEventListener('mousedown', binding.onMouseDown);
    binding.handle.remove();
  }

  delete table.__colResizeBindings;
}

function bindResizableTable(table: ResizableTableElement): void {
  if (!supportsTableFit()) return;

  const headers = getVisibleHeaderCells(table);
  if (headers.length === 0) return;

  const columnCount = String(headers.length);
  const boundCount = table.getAttribute(TABLE_BOUND_ATTR);
  const wasExpanded = table.getAttribute(TABLE_EXPANDED_ATTR) === '1';

  if (boundCount !== columnCount) {
    unbindTable(table);
  }

  const cols = ensureColgroup(table, headers.length);
  const forceFitOnLoad = table.classList.contains('stock-products-table');

  if (forceFitOnLoad) {
    table.removeAttribute(TABLE_EXPANDED_ATTR);
    cols.forEach((col) => {
      col.style.width = '';
    });
    applyFittedColumnWidths(table, headers, cols);
  } else if (wasExpanded) {
    syncExpandedTableWidth(table, cols);
  } else {
    applyFittedColumnWidths(table, headers, cols);
  }

  if (supportsColumnResize()) {
    if (!table.__colResizeBindings?.length) {
      attachResizeHandles(table, headers, cols);
    }
  } else {
    detachResizeHandles(table);
  }

  if (!table.__colResizeContainerObserver) {
    observeTableContainer(table, headers, cols);
  }

  table.setAttribute(TABLE_BOUND_ATTR, columnCount);
  syncScrollContainerMode(table);
}

export function bindResizableTables(root: ParentNode = document): void {
  if (!supportsTableFit()) {
    unbindResizableTables(root);
    return;
  }

  root.querySelectorAll('.app-table-scroll-host').forEach((host) => {
    const expanded = host.querySelector(`table[${TABLE_EXPANDED_ATTR}='1']`);
    host.setAttribute(SCROLL_EXPANDED_ATTR, expanded ? 'true' : 'false');
  });

  root.querySelectorAll('table.app-data-table, table.module-data-table-layout').forEach((node) => {
    bindResizableTable(node as ResizableTableElement);
  });
}

export function unbindResizableTables(root: ParentNode = document): void {
  root.querySelectorAll('table.app-data-table, table.module-data-table-layout').forEach((node) => {
    unbindTable(node as ResizableTableElement);
  });
}
