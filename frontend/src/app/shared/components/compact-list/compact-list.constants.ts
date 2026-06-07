/** Listas tipo app nativa en pantallas pequeñas (<640px). */
export const NATIVE_COMPACT_LIST_CLASS = 'native-compact-list divide-y divide-gray-100';

/** Tablas de listado: filas compactas en desktop; en móvil usar `native-compact-list` aparte. */
export const NATIVE_COMPACT_TABLE_CLASS =
  'native-compact-table app-data-table w-full text-left border-collapse';

/** Encabezado de tabla de módulo (mayúsculas, mismo peso visual en todas las columnas). */
export const MODULE_TABLE_HEAD_CELL_CLASS =
  'px-4 sm:px-6 py-3 text-[11px] leading-tight font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 align-middle';

/** Celda de encabezado en desktop (alias del estilo unificado de módulos). */
export const DESKTOP_TABLE_TH_CLASS = MODULE_TABLE_HEAD_CELL_CLASS;

/** Encabezados en tablas anidadas (detalle por compra, etc.). */
export const MODULE_TABLE_HEAD_CELL_NESTED_CLASS =
  'px-3 py-2 text-[10px] leading-tight font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 align-middle';

/** Celda de cuerpo en desktop. */
export const DESKTOP_TABLE_TD_CLASS = 'px-4 sm:px-6 py-3 text-sm';

export const DESKTOP_TABLE_TD_CLASS_CENTER = `${DESKTOP_TABLE_TD_CLASS} text-center`;

export const DESKTOP_TABLE_TD_CLASS_RIGHT = `${DESKTOP_TABLE_TD_CLASS} text-right`;

export const COMPACT_LIST_ROW_CLASS =
  'w-full flex items-center gap-2 px-3 py-2 text-left border-0 bg-transparent hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer min-h-[40px]';

/** Contenedor derecho de fila compacta: monto + acción en fila, sin apilar. */
export const COMPACT_LIST_TRAILING_ROW_CLASS =
  'shrink-0 pl-2 self-center flex flex-row flex-nowrap items-center justify-end gap-1.5';

export const COMPACT_LIST_TITLE_CLASS = 'text-sm font-medium text-gray-900 leading-snug truncate';

export const COMPACT_LIST_SUBTITLE_CLASS = 'text-[11px] text-gray-500 leading-snug truncate mt-0.5';

export const COMPACT_LIST_EMPTY_CLASS = 'px-3 py-8 text-center text-xs text-gray-400';

export const COMPACT_LIST_SEARCH_WRAP_CLASS =
  'px-3 py-2 sm:px-6 sm:py-4 border-b border-gray-100 bg-gray-50';

/** Contenedor indentado bajo fila expandible (nivel 1). */
export const EXPANDED_NESTED_WRAP_CLASS =
  'ml-5 sm:ml-8 border-l-2 border-teal-100/90 dark:border-teal-800/60 pl-4 sm:pl-5 py-1';

/** Indentación adicional para sub-niveles expandibles (nivel 2). */
export const EXPANDED_NESTED_WRAP_LEVEL2_CLASS =
  'ml-4 sm:ml-5 border-l-2 border-teal-100/80 dark:border-teal-800/50 pl-3 sm:pl-4 py-1';
