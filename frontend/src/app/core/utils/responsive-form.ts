/** Pantallas grandes: formulario en ruta (sidebar visible). Móvil: modal. */
export const INLINE_FORM_PAGE_MIN_WIDTH_PX = 1024;

export function prefersInlineFormPage(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia(`(min-width: ${INLINE_FORM_PAGE_MIN_WIDTH_PX}px)`).matches;
}
