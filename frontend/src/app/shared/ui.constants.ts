/**
 * Tokens de layout / tipografía / formularios / tablas compartidos.
 * Preferí importar desde aquí; `icon-action` reexporta por compatibilidad.
 */
import { NATIVE_COMPACT_TABLE_CLASS } from './components/compact-list/compact-list.constants';
import {
  LIST_SEARCH_DESKTOP_WRAP_CLASS,
  LIST_SEARCH_INPUT_CLASS,
  LIST_SEARCH_MOBILE_HEADER_CLASS,
  LIST_TOOLBAR_CONTROL_HEIGHT,
  LIST_TOOLBAR_ROW_CLASS,
} from './components/list-search-field/list-search-field.component';

/** Padding de página de módulo (listados y formularios). */
export const PAGE_SHELL_CLASS = 'p-4 sm:p-6 lg:p-8 w-full min-w-0';

/** Contenedor de contenido: ancho completo del main, tope amplio por legibilidad. */
export const PAGE_CONTENT_MAX_CLASS = 'w-full max-w-[1500px] min-w-0';

/** Subtítulo bajo el título de página: oculto en celular, visible desde sm. */
export const PAGE_DESC_CLASS = 'text-sm sm:text-base text-gray-500 desc-lg-only';

/** Título de listado de módulo (misma escala que form-screen en sm+). */
export const PAGE_TITLE_CLASS =
  'text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 leading-snug truncate sm:truncate-none';

/** Título compacto en móvil (toolbars densas). */
export const PAGE_TITLE_COMPACT_CLASS =
  'text-base sm:text-2xl font-bold text-gray-900 dark:text-gray-100 leading-snug truncate sm:truncate-none';

export {
  LIST_SEARCH_INPUT_CLASS as TABLE_SEARCH_INPUT_CLASS,
  LIST_SEARCH_MOBILE_HEADER_CLASS as MOBILE_HEADER_SEARCH_INPUT_CLASS,
  LIST_SEARCH_DESKTOP_WRAP_CLASS as DESKTOP_LIST_SEARCH_WRAP_CLASS,
  LIST_TOOLBAR_CONTROL_HEIGHT,
  LIST_TOOLBAR_ROW_CLASS,
};

/** Standard clickable table row (open edit/detail on click). */
export const LIST_TABLE_ROW_CLASS =
  'hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors cursor-pointer';

/** Oculto en celular (<640px); usar junto con `grid` en filas de KPIs/resumen. */
export const MODULE_SUMMARY_KPIS_CLASS = 'module-summary-kpis';

export const TABLE_SCROLL_CLASS = 'app-table-scroll-host -mx-4 sm:mx-0 px-4 sm:px-0';

export { NATIVE_COMPACT_TABLE_CLASS };

export const TABLE_MIN_WIDTH_CLASS = NATIVE_COMPACT_TABLE_CLASS + ' w-full max-w-full';

export const FORM_CONTROL_CLASS =
  'form-control w-full outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 dark:disabled:bg-gray-800 disabled:text-gray-400';

export const FORM_LABEL_CLASS = 'form-label';

export const FORM_SUBMIT_CLASS =
  'form-btn-primary rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60 min-h-[44px] sm:min-h-0';

export const FORM_CANCEL_CLASS =
  'form-btn-secondary rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 min-h-[44px] sm:min-h-0';

export const FORM_DANGER_CLASS =
  'rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60 min-h-[44px] sm:min-h-0';
