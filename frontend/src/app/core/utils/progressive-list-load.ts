/** Filas visibles en el primer request (pintado rápido). */
export const PROGRESSIVE_LIST_FIRST_PAGE_SIZE = 30;

/** Tamaño de página para completar el resto en segundo plano. */
export const PROGRESSIVE_LIST_BACKGROUND_PAGE_SIZE = 120;

export interface ProgressiveListPage<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

/** Invalida cargas en curso cuando el usuario refresca o cambia filtros. */
export class ProgressiveListSession {
  private token = 0;

  next(): number {
    this.token += 1;
    return this.token;
  }

  isActive(token: number): boolean {
    return token === this.token;
  }
}
