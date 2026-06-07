export interface TransactionFormSaveEvent {
  id: string;
  label?: string;
  draft?: boolean;
  /** La venta acaba de crearse/confirmarse; el formulario ya tiene los datos cargados. */
  freshSave?: boolean;
}
