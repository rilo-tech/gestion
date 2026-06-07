/** Estilos compartidos para listas editables de configuración. */
export const CONFIG_EDITABLE_LIST_ADD_INPUT_CLASS =
  'w-full min-w-0 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-xs outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-500 bg-white dark:bg-gray-950 dark:text-gray-100';

export const CONFIG_EDITABLE_LIST_ADD_BUTTON_CLASS =
  'w-full sm:w-auto shrink-0 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed dark:disabled:bg-gray-700 dark:disabled:text-gray-500 whitespace-nowrap';

/** Fila simple (solo nombre o input + quitar): baja, una línea. */
export const CONFIG_EDITABLE_LIST_ITEM_COMPACT_CLASS =
  'flex items-center gap-1.5 px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/80 min-h-0';

/** Fila compacta con input editable: sin caja extra, misma altura que el campo Agregar. */
export const CONFIG_EDITABLE_LIST_ITEM_COMPACT_INPUT_CLASS =
  'flex items-center gap-1.5 min-h-0';

export const CONFIG_EDITABLE_LIST_REMOVE_BUTTON_COMPACT_CLASS =
  'inline-flex items-center justify-center w-6 h-6 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 border border-transparent hover:border-red-200/80 dark:text-red-400 dark:hover:border-red-900/60 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent shrink-0';

/** Fila con selects, badge arriba o índice: más alta, apilada. */
export const CONFIG_EDITABLE_LIST_ITEM_EXTENDED_CLASS =
  'flex flex-col gap-2 px-2.5 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/80 min-h-0';

/** @deprecated Usar ITEM_COMPACT o ITEM_EXTENDED según el ítem. */
export const CONFIG_EDITABLE_LIST_ITEM_CLASS = CONFIG_EDITABLE_LIST_ITEM_COMPACT_CLASS;

export const CONFIG_EDITABLE_LIST_ROW_SHELL_CLASS = 'flex items-center gap-2 min-w-0 w-full';

export const CONFIG_EDITABLE_LIST_ROW_BODY_CLASS = 'flex items-center gap-2 min-w-0 flex-1';

export const CONFIG_EDITABLE_LIST_ROW_CHIPS_CLASS =
  'flex flex-wrap items-center gap-1.5 shrink-0';

export const CONFIG_EDITABLE_LIST_ROW_FIELD_CLASS = 'min-w-0 flex-1';

export const CONFIG_EDITABLE_LIST_SELECT_ROW_CLASS = 'w-full min-w-0';

export const CONFIG_EDITABLE_LIST_SELECT_CLASS =
  'mt-0.5 w-full min-w-0 px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-600 text-xs bg-white dark:bg-gray-950 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary';

export const CONFIG_EDITABLE_LIST_ROW_INPUT_CLASS =
  CONFIG_EDITABLE_LIST_ADD_INPUT_CLASS + ' font-medium';

export const CONFIG_EDITABLE_LIST_INDEX_CLASS =
  'inline-flex items-center justify-center w-5 h-5 shrink-0 rounded border border-primary/30 bg-primary/10 text-[10px] font-bold tabular-nums text-primary';

export const CONFIG_EDITABLE_LIST_REMOVE_BUTTON_CLASS =
  'inline-flex items-center justify-center w-7 h-7 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 border border-transparent hover:border-red-200/80 dark:text-red-400 dark:hover:border-red-900/60 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent shrink-0';

export const CONFIG_EDITABLE_LIST_EMPTY_CLASS =
  'text-xs text-gray-400 dark:text-gray-500 px-1 py-3 text-center border border-dashed border-gray-200 dark:border-gray-600 rounded-lg min-h-[2.25rem] flex items-center justify-center';

export const CONFIG_EDITABLE_LIST_HINT_CLASS =
  'block text-xs text-gray-500 mt-0.5 desc-lg-only leading-snug';

export const CONFIG_EDITABLE_LIST_FOOTER_CLASS = 'text-[11px] text-gray-500 leading-snug';

export const CONFIG_EDITABLE_LIST_BADGE_CLASS =
  'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold border border-primary/35 bg-primary/15 text-primary shrink-0';

/** Fila de checkbox en listas de configuración (contraste en tema claro y oscuro). */
export const CONFIG_EDITABLE_LIST_CHECK_LABEL_CLASS =
  'flex items-center gap-2 cursor-pointer rounded-md px-1 py-0.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100/90 dark:hover:bg-gray-700/55 has-[:checked]:bg-teal-50/80 dark:has-[:checked]:bg-teal-950/45 has-[:checked]:text-teal-900 dark:has-[:checked]:text-teal-100';

export const CONFIG_EDITABLE_LIST_LABEL_TEXT_CLASS =
  'text-xs text-gray-800 dark:text-gray-200 truncate min-w-0 leading-snug';

export const CONFIG_EDITABLE_LIST_LABEL_EMPHASIS_CLASS =
  'text-xs font-medium text-gray-900 dark:text-gray-100 break-words min-w-0 leading-snug';
