import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs';
import {
  PriceCatalogEntry,
  PriceCatalogQuantityRange,
  PriceCatalogService,
  PriceCatalogVariant,
  createEmptyPriceCatalogEntry,
  createEmptyVariant,
  ensureVariantQuantityRanges,
  getVariantBaseRange,
  getVariantExtraRanges,
  normalizePriceCatalogEntry,
} from '../../core/services/price-catalog.service';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import { FormPanelFooterComponent } from '../../shared/components/form-panel-footer/form-panel-footer.component';
import { FORM_COMPACT_FIELD_CLASS, FORM_COMPACT_LABEL_CLASS } from '../../shared/components/form-shell/form-field.constants';
import {
  TransactionSaveBannerComponent,
  TransactionSaveFeedback,
} from '../../shared/components/transaction-form';

export interface PriceCatalogFormSaveEvent {
  id: string;
  entry: PriceCatalogEntry;
  wasNew?: boolean;
}

const FIELD_CLASS = FORM_COMPACT_FIELD_CLASS + ' sm:h-9';
const QUANTITY_ROW_GRID_CLASS = 'grid grid-cols-3 gap-2 items-end';
const QUANTITY_CELL_CLASS = 'catalog-qty-cell w-full min-w-0';
const QUANTITY_CELL_STATIC_CLASS =
  QUANTITY_CELL_CLASS +
  ' flex items-center justify-center bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-semibold tabular-nums';
const QUANTITY_PRICE_CELL_CLASS =
  QUANTITY_CELL_CLASS + ' text-center font-semibold tabular-nums text-teal-900 dark:text-teal-100 bg-white dark:bg-gray-900';

@Component({
  selector: 'app-price-catalog-form-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FormPanelFooterComponent,
    TransactionSaveBannerComponent,
  ],
  styles: [
    `
      :host .catalog-qty-cell {
        box-sizing: border-box;
        height: 2rem;
        min-height: 2rem;
        max-height: 2rem;
        margin: 0;
        padding: 0 0.5rem;
        border-radius: 0.5rem;
        border: 1px solid rgb(229 231 235);
        background-color: rgb(255 255 255);
        font-size: 0.75rem;
        line-height: 2rem;
        outline: none;
        appearance: textfield;
        -webkit-appearance: textfield;
      }

      :host .catalog-qty-cell:focus {
        box-shadow: 0 0 0 2px rgb(13 148 136 / 0.35);
        border-color: rgb(13 148 136);
      }

      :host .catalog-qty-cell::-webkit-outer-spin-button,
      :host .catalog-qty-cell::-webkit-inner-spin-button {
        appearance: none;
        margin: 0;
      }

      :host-context(html.dark) .catalog-qty-cell {
        background-color: rgb(3 7 18);
        border-color: rgb(55 65 81);
        color: rgb(243 244 246);
      }
    `,
  ],
  template: `
    <div>
      <div *ngIf="loadingEntry" class="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
        Cargando referencia...
      </div>

      <form
        *ngIf="!loadingEntry"
        (submit)="saveEntry(); $event.preventDefault()"
        class="space-y-4">
        <fieldset [disabled]="formReadOnly" class="space-y-4 border-0 p-0 m-0 min-w-0">
          <app-transaction-save-banner [message]="saveFeedback.successMessage"></app-transaction-save-banner>

          <div>
            <label [class]="labelClass">Producto *</label>
            <input
              [(ngModel)]="entryForm.nombre"
              name="catalogNombre"
              required
              placeholder="Ej. Remeras, Tazas"
              [class]="fieldClass">
          </div>

          <div>
            <label [class]="labelClass">Detalle</label>
            <input
              [(ngModel)]="primaryVariant.nombre"
              name="variantNombre"
              placeholder="Sin estampado"
              [class]="fieldClass">
          </div>

          <div class="rounded-lg border border-teal-100 dark:border-teal-900/50 bg-white dark:bg-gray-900/60 p-3 space-y-2">
            <p class="text-xs font-bold text-teal-800 dark:text-teal-200">Precio por unidad</p>
            <div [class]="quantityRowGridClass">
              <div class="min-w-0">
                <label class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">Desde</label>
                <div [class]="quantityCellStaticClass">
                  1
                </div>
              </div>
              <div class="min-w-0">
                <label class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">Hasta</label>
                <input
                  type="number"
                  [(ngModel)]="baseRange(primaryVariant).cantidadMax"
                  name="baseMax"
                  min="1"
                  placeholder="—"
                  [class]="quantityCellClass + ' text-center'">
              </div>
              <div class="min-w-0">
                <label class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">Precio u</label>
                <input
                  type="number"
                  [(ngModel)]="baseRange(primaryVariant).precioUnitario"
                  name="basePrecio"
                  min="0"
                  step="0.01"
                  placeholder="$"
                  [class]="quantityPriceCellClass">
              </div>
            </div>
            <p class="text-[10px] text-gray-400 dark:text-gray-500 leading-snug">
              Ej: desde 1 hasta 3 con el mismo precio. Dejá «Hasta» vacío si aplica a cualquier cantidad.
            </p>
          </div>

          <div *ngIf="extraRanges(primaryVariant).length" class="space-y-2">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Otros rangos por cantidad
            </p>
            <div
              *ngFor="let range of extraRanges(primaryVariant); let ri = index"
              class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2 items-end">
              <div class="min-w-0">
                <label class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">Desde</label>
                <input
                  type="number"
                  [(ngModel)]="range.cantidadMin"
                  [name]="'rangeMin' + ri"
                  min="1"
                  placeholder="—"
                  [class]="quantityCellClass + ' text-center'">
              </div>
              <div class="min-w-0">
                <label class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">Hasta</label>
                <input
                  type="number"
                  [(ngModel)]="range.cantidadMax"
                  [name]="'rangeMax' + ri"
                  min="1"
                  placeholder="—"
                  [class]="quantityCellClass + ' text-center'">
              </div>
              <div class="min-w-0">
                <label class="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">Precio u</label>
                <input
                  type="number"
                  [(ngModel)]="range.precioUnitario"
                  [name]="'rangePrecio' + ri"
                  min="0"
                  step="0.01"
                  placeholder="$"
                  [class]="quantityPriceCellClass">
              </div>
              <button
                type="button"
                (click)="removeExtraRange(ri)"
                [class]="quantityCellClass + ' w-9 shrink-0 px-0 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'">
                ×
              </button>
            </div>
          </div>

          <button
            type="button"
            (click)="addExtraRange()"
            class="h-8 px-2.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40">
            + Rango por cantidad
          </button>

          <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 sm:items-end">
            <div>
              <label [class]="labelClass">Notas</label>
              <textarea
                [(ngModel)]="entryForm.notas"
                name="catalogNotas"
                rows="2"
                placeholder="Opcional"
                [class]="fieldClass + ' resize-none'"></textarea>
            </div>
            <label class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-1 sm:pb-2">
              <input
                type="checkbox"
                [(ngModel)]="entryForm.activo"
                name="catalogActivo"
                class="rounded border-gray-300 dark:border-gray-600 text-primary focus:ring-primary dark:bg-gray-900">
              Activa
            </label>
          </div>
        </fieldset>

        <app-form-panel-footer
          [saveLabel]="saveButtonLabel"
          [showSave]="auth.canManagePriceCatalog"
          [saving]="saveFeedback.saving"
          [saveDisabled]="saveFeedback.saving"
          [successMessage]="saveFeedback.successMessage"
          (cancelClick)="cancelled.emit()"
          (saveClick)="saveEntry()">
        </app-form-panel-footer>
      </form>
    </div>
  `,
})
export class PriceCatalogFormPanelComponent implements OnChanges, OnDestroy {
  readonly auth = inject(AuthService);
  readonly fieldClass = FIELD_CLASS;
  readonly quantityRowGridClass = QUANTITY_ROW_GRID_CLASS;
  readonly quantityCellClass = QUANTITY_CELL_CLASS;
  readonly quantityCellStaticClass = QUANTITY_CELL_STATIC_CLASS;
  readonly quantityPriceCellClass = QUANTITY_PRICE_CELL_CLASS;
  readonly labelClass = FORM_COMPACT_LABEL_CLASS;
  readonly saveFeedback = new TransactionSaveFeedback();

  @Input() entryId: string | null = null;
  @Output() saved = new EventEmitter<PriceCatalogFormSaveEvent>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() savingChange = new EventEmitter<boolean>();

  private priceCatalogService = inject(PriceCatalogService);
  private dialogService = inject(DialogService);

  entryForm: PriceCatalogEntry = createEmptyPriceCatalogEntry();
  loadingEntry = false;

  get isEditing(): boolean {
    return !!this.entryId;
  }

  get formReadOnly(): boolean {
    return !this.auth.canManagePriceCatalog;
  }

  get primaryVariant(): PriceCatalogVariant {
    if (!this.entryForm.variantes.length) {
      this.entryForm.variantes = [createEmptyVariant('')];
    }
    return this.entryForm.variantes[0];
  }

  get saveButtonLabel(): string {
    if (this.saveFeedback.saving) return 'Guardando...';
    if (this.saveFeedback.successMessage) {
      return this.isEditing ? 'Guardado' : 'Referencia creada';
    }
    return this.isEditing ? 'Guardar' : 'Crear referencia';
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['entryId']) {
      this.loadEntry();
    }
  }

  baseRange(variant: PriceCatalogVariant): PriceCatalogQuantityRange {
    ensureVariantQuantityRanges(variant);
    return getVariantBaseRange(variant);
  }

  extraRanges(variant: PriceCatalogVariant): PriceCatalogQuantityRange[] {
    ensureVariantQuantityRanges(variant);
    return getVariantExtraRanges(variant);
  }

  addExtraRange() {
    const variant = this.primaryVariant;
    ensureVariantQuantityRanges(variant);
    const base = getVariantBaseRange(variant);
    const extras = getVariantExtraRanges(variant);
    const last = extras[extras.length - 1] ?? base;
    const cantidadMin = last.cantidadMax
      ? last.cantidadMax + 1
      : Math.max((last.cantidadMin || 1) + 1, (base.cantidadMax ?? 1) + 1);
    variant.rangosCantidad.push({
      cantidadMin,
      cantidadMax: null,
      precioUnitario: 0,
    });
  }

  removeExtraRange(extraIndex: number) {
    const variant = this.primaryVariant;
    variant.rangosCantidad.splice(extraIndex + 1, 1);
  }

  saveEntry() {
    if (!this.auth.canManagePriceCatalog || !this.saveFeedback.tryBeginSave()) return;
    this.emitSaving(true);
    this.saveFeedback.clearSuccess();

    const variant = ensureVariantQuantityRanges({ ...this.primaryVariant });
    this.entryForm.variantes = [variant];
    const payload = normalizePriceCatalogEntry(this.entryForm);

    if (!payload.nombre) {
      this.saveFeedback.endSave();
      this.emitSaving(false);
      this.dialogService.alert({
        title: 'Falta el nombre',
        message: 'Indicá a qué producto corresponde esta referencia.',
      });
      return;
    }

    const hasPrice = payload.variantes.some(
      (variant) =>
        variant.rangosCantidad.some((range) => range.precioUnitario > 0) ||
        (variant.precioReferencia ?? 0) > 0
    );
    if (!hasPrice) {
      this.saveFeedback.endSave();
      this.emitSaving(false);
      this.dialogService.alert({
        title: 'Falta el precio',
        message: 'Indicá al menos un precio por unidad.',
      });
      return;
    }

    const request$ = this.entryId
      ? this.priceCatalogService.updateEntry(this.entryId, payload)
      : this.priceCatalogService.createEntry(payload);

    request$.pipe(finalize(() => {
      this.saveFeedback.endSave();
      this.emitSaving(false);
    })).subscribe({
      next: ({ id }) => {
        const wasNew = !this.entryId;
        this.entryForm = {
          ...payload,
          id,
          variantes: payload.variantes.map((variant) => ensureVariantQuantityRanges({ ...variant })),
        };
        this.saveFeedback.showSuccess(
          wasNew
            ? 'Referencia creada correctamente. Ya podés usarla en pedidos.'
            : 'Cambios guardados correctamente.'
        );
        this.saved.emit({ id, entry: { ...payload, id }, wasNew });
      },
      error: (err: HttpErrorResponse) => {
        const message =
          typeof err.error?.error === 'string'
            ? err.error.error
            : 'No se pudo guardar la referencia de precio.';
        this.dialogService.alert({
          title: 'Error',
          message,
        });
      },
    });
  }

  ngOnDestroy() {
    this.saveFeedback.destroy();
  }

  private emitSaving(saving: boolean) {
    queueMicrotask(() => this.savingChange.emit(saving));
  }

  private loadEntry() {
    if (!this.entryId) {
      this.entryForm = createEmptyPriceCatalogEntry();
      this.loadingEntry = false;
      return;
    }

    this.loadingEntry = true;
    this.priceCatalogService.getEntry(this.entryId).subscribe({
      next: (entry) => {
        const firstVariant = entry.variantes?.[0] ?? createEmptyVariant('');
        this.entryForm = {
          ...createEmptyPriceCatalogEntry(),
          ...entry,
          variantes: [
            ensureVariantQuantityRanges({
              ...firstVariant,
              rangosCantidad: [...(firstVariant.rangosCantidad ?? [])],
            }),
          ],
        };
        this.loadingEntry = false;
      },
      error: () => {
        this.loadingEntry = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar la referencia de precio.',
        });
        this.cancelled.emit();
      },
    });
  }
}
