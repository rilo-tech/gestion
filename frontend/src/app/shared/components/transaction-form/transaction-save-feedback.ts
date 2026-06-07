/**
 * Estado compartido para guardar transacciones (ventas, compras, pedidos, etc.):
 * - evita doble envío mientras `saving` es true
 * - mensaje de éxito visible con timeout
 * - opcional: omitir recarga del formulario tras crear (mismo id que acaba de guardarse)
 */
export class TransactionSaveFeedback {
  saving = false;
  successMessage = '';
  private successTimeout?: ReturnType<typeof setTimeout>;
  private skipReloadId: string | null = null;

  constructor(private readonly successDurationMs = 6000) {}

  /** Devuelve false si ya hay un guardado en curso (no iniciar otro). */
  tryBeginSave(): boolean {
    if (this.saving) return false;
    this.saving = true;
    this.clearSuccess();
    return true;
  }

  endSave(): void {
    this.saving = false;
  }

  showSuccess(message: string, durationMs = this.successDurationMs): void {
    this.successMessage = message;
    if (this.successTimeout) {
      clearTimeout(this.successTimeout);
    }
    this.successTimeout = setTimeout(() => {
      this.successMessage = '';
      this.successTimeout = undefined;
    }, durationMs);
  }

  /** Mensaje con detalle opcional (ej. número de venta). */
  showSuccessWithDetail(base: string, detail?: string): void {
    const message = detail?.trim() ? `${base} · ${detail.trim()}` : base;
    this.showSuccess(message);
  }

  clearSuccess(): void {
    this.successMessage = '';
    if (this.successTimeout) {
      clearTimeout(this.successTimeout);
      this.successTimeout = undefined;
    }
  }

  /** Tras crear: el padre pasará este id y no hace falta recargar el formulario. */
  markSkipReload(id: string): void {
    this.skipReloadId = id;
  }

  /** En ngOnChanges del id de edición: si coincide, no llamar a load*. */
  consumeSkipReload(id: string | null): boolean {
    if (!id || this.skipReloadId !== id) return false;
    this.skipReloadId = null;
    return true;
  }

  destroy(): void {
    this.clearSuccess();
    this.endSave();
    this.skipReloadId = null;
  }
}

export type TransactionSaveHeaderVariant = 'primary' | 'success';

export interface TransactionSaveHeaderState {
  icon: string;
  label: string;
  variant: TransactionSaveHeaderVariant;
  disabled: boolean;
  loading: boolean;
}

/** Botón de guardar en la barra móvil (icon-toolbar). */
export function buildTransactionSaveHeaderState(options: {
  saving: boolean;
  successMessage: string;
  idleLabel: string;
  savingLabel?: string;
}): TransactionSaveHeaderState {
  const { saving, idleLabel, savingLabel } = options;

  if (saving) {
    return {
      icon: 'clock',
      label: savingLabel ?? 'Guardando...',
      variant: 'primary',
      disabled: true,
      loading: true,
    };
  }

  return {
    icon: 'save',
    label: idleLabel,
    variant: 'primary',
    disabled: false,
    loading: false,
  };
}
