/** Inputs, selects y textareas compactos en móvil; tamaño normal desde sm. */
/** Misma altura que `.form-control` (min-h-8 / sm:min-h-10) para alinear con buscadores y fechas. */
export const FORM_COMPACT_FIELD_CLASS =
  'w-full min-h-8 sm:min-h-10 box-border px-2 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs sm:text-sm leading-tight outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 dark:disabled:bg-gray-800 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

/** Valor numérico solo lectura en tarjetas móvil (detalle y formulario). */
export const FORM_COMPACT_MOBILE_NUMERIC_VALUE_CLASS =
  'txn-mobile-num-value block w-full h-4 leading-4 text-xs tabular-nums text-gray-900 dark:text-gray-100';

/** Input numérico en tarjetas móvil: una línea, alineado con el detalle. */
export const FORM_COMPACT_MOBILE_NUMERIC_INPUT_CLASS =
  'txn-mobile-num-input w-full min-w-0 h-4 max-h-4 px-0 py-0 m-0 box-border border-0 border-b border-gray-200/80 dark:border-gray-700/80 bg-transparent text-xs leading-4 tabular-nums outline-none rounded-none shadow-none focus:border-teal-500 focus:ring-0 dark:bg-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

export const FORM_COMPACT_LABEL_CLASS =
  'block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-0.5 sm:mb-1';

/** Fila de etiqueta alineada con campos en grid (proveedor + fecha, etc.). */
export const FORM_COMPACT_LABEL_ROW_CLASS =
  'min-h-[1.125rem] sm:min-h-[1.375rem] mb-0.5 sm:mb-1 flex items-center';

export const FORM_COMPACT_LABEL_INLINE_CLASS =
  'text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 leading-tight';

/** Contenedor de chips + buscador embebido (etiquetas, etc.). */
export const FORM_COMPACT_CHIP_INPUT_WRAP_CLASS =
  'flex flex-wrap items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus-within:ring-2 focus-within:ring-teal-500';

export const FORM_CARD_CLASS =
  'bg-white dark:bg-gray-900 p-3 sm:p-6 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm';
