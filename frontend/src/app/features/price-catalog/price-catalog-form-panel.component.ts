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
import {
  PriceCatalogEntry,
  PriceCatalogService,
  buildPriceSummary,
  createEmptyPriceCatalogEntry,
  createEmptyVariant,
  normalizePriceCatalogEntry,
} from '../../core/services/price-catalog.service';
import { DialogService } from '../../core/services/dialog.service';
import { AuthService } from '../../core/services/auth.service';
import { SelectOnFocusDirective } from '../../shared/directives/select-on-focus.directive';
import { FormPanelFooterComponent } from '../../shared/components/form-panel-footer/form-panel-footer.component';
import { FORM_COMPACT_FIELD_CLASS, FORM_COMPACT_LABEL_CLASS } from '../../shared/components/form-shell/form-field.constants';

export interface PriceCatalogFormSaveEvent {
  id: string;
  entry: PriceCatalogEntry;
  wasNew?: boolean;
}

const FIELD_CLASS = FORM_COMPACT_FIELD_CLASS + ' sm:h-9';

@Component({
  selector: 'app-price-catalog-form-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, SelectOnFocusDirective, FormPanelFooterComponent],
  template: `
    <div>
      <div *ngIf="loadingEntry" class="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
        Cargando referencia...
      </div>

      <form
        *ngIf="!loadingEntry"
        (submit)="saveEntry(); $event.preventDefault()"
        class="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)] lg:gap-5 lg:items-start">
        <fieldset [disabled]="formReadOnly" class="space-y-4 border-0 p-0 m-0 min-w-0">
          <div>
            <label [class]="labelClass">Producto *</label>
            <input
              [(ngModel)]="entryForm.nombre"
              name="catalogNombre"
              required
              placeholder="Ej. Remeras, Tazas"
              [class]="fieldClass">
          </div>

          <section class="space-y-3">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100">Detalles</h3>
              <button
                type="button"
                (click)="addVariant()"
                class="h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40 whitespace-nowrap">
                + Detalle
              </button>
            </div>

            <article
              *ngFor="let variant of entryForm.variantes; let vi = index"
              class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/80 p-3 space-y-2">
              <div class="grid grid-cols-1 sm:grid-cols-[1fr_7rem_auto] gap-2 items-end">
                <div class="min-w-0">
                  <label class="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">Detalle</label>
                  <input
                    [(ngModel)]="variant.nombre"
                    [name]="'variantNombre' + vi"
                    placeholder="Sin estampado"
                    [class]="fieldClass">
                </div>
                <div>
                  <label class="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-0.5">1 u.</label>
                  <input
                    type="number"
                    [(ngModel)]="variant.precioReferencia"
                    [name]="'variantPrecio' + vi"
                    min="0"
                    step="0.01"
                    placeholder="$"
                    [class]="fieldClass">
                </div>
                <button
                  *ngIf="entryForm.variantes.length > 1"
                  type="button"
                  (click)="removeVariant(vi)"
                  class="h-9 px-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg">
                  Quitar
                </button>
              </div>

              <div class="space-y-1.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Cantidad</span>
                  <button
                    type="button"
                    (click)="addVariantRange(vi)"
                    class="h-7 px-2 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40">
                    + Rango
                  </button>
                </div>

                <div
                  *ngFor="let range of variant.rangosCantidad; let ri = index"
                  class="grid grid-cols-[1fr_1fr_1.1fr_auto] gap-1.5 items-center">
                  <input
                    type="number"
                    [(ngModel)]="range.cantidadMin"
                    [name]="'rangeMin' + vi + ri"
                    min="1"
                    placeholder="Desde"
                    [class]="fieldClass">
                  <input
                    type="number"
                    [(ngModel)]="range.cantidadMax"
                    [name]="'rangeMax' + vi + ri"
                    min="1"
                    placeholder="Hasta"
                    [class]="fieldClass">
                  <input
                    type="number"
                    [(ngModel)]="range.precioUnitario"
                    [name]="'rangePrecio' + vi + ri"
                    min="0"
                    step="0.01"
                    placeholder="$/u"
                    [class]="fieldClass">
                  <button
                    type="button"
                    (click)="removeVariantRange(vi, ri)"
                    class="h-9 w-8 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg">
                    ×
                  </button>
                </div>
              </div>
            </article>

            <p class="text-[11px] text-gray-400 dark:text-gray-500">Hasta vacío = sin tope superior.</p>
          </section>

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

        <aside class="mt-4 lg:mt-0 lg:sticky lg:top-4 min-w-0">
          <section class="rounded-xl border border-teal-100 dark:border-teal-900/60 bg-teal-50/70 dark:bg-teal-950/30 p-3 sm:p-4">
            <h3 class="text-sm font-bold text-teal-900 dark:text-teal-200 mb-2">Vista previa</h3>

            <p *ngIf="!entryForm.nombre.trim() && !priceSummary.length" class="text-xs text-teal-800/70 dark:text-teal-300/80">
              Cargá el producto y los detalles para ver el resumen acá.
            </p>

            <p *ngIf="entryForm.nombre.trim()" class="text-xs font-semibold text-teal-900 dark:text-teal-100 mb-2 truncate">
              {{ entryForm.nombre }}
            </p>

            <div *ngIf="priceSummary.length; else emptyPreview" class="space-y-2.5">
              <div *ngFor="let row of priceSummary" class="rounded-lg bg-white/80 dark:bg-gray-900/80 border border-teal-100/80 dark:border-teal-900/50 p-2.5">
                <div class="text-xs font-semibold text-teal-900 dark:text-teal-100 mb-1.5 leading-snug">{{ row.variantNombre }}</div>
                <div class="flex flex-wrap gap-1">
                  <span
                    *ngFor="let cell of row.cells"
                    class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] bg-teal-50 dark:bg-teal-950/50 text-teal-900 dark:text-teal-100">
                    <span>{{ cell.label }}</span>
                    <span class="font-bold tabular-nums">{{ '$' + cell.precio }}</span>
                  </span>
                </div>
              </div>
            </div>
            <ng-template #emptyPreview>
              <p *ngIf="entryForm.nombre.trim()" class="text-xs text-teal-800/70 dark:text-teal-300/80">
                Agregá precios en los detalles.
              </p>
            </ng-template>
          </section>
        </aside>

        <div class="lg:col-span-2 space-y-3">
          <p
            *ngIf="saveSuccessMessage"
            [class]="saveSuccessBannerClass"
            role="status"
            aria-live="polite">
            {{ saveSuccessMessage }}
          </p>
          <app-form-panel-footer
            [saveLabel]="saveButtonLabel"
            [showSave]="auth.canManagePriceCatalog"
            [saving]="saving"
            [successMessage]="saveSuccessMessage"
            (cancelClick)="cancelled.emit()"
            (saveClick)="saveEntry()">
          </app-form-panel-footer>
        </div>
      </form>
    </div>
  `,
})
export class PriceCatalogFormPanelComponent implements OnChanges, OnDestroy {
  readonly auth = inject(AuthService);
  readonly fieldClass = FIELD_CLASS;
  readonly labelClass = FORM_COMPACT_LABEL_CLASS;
  readonly saveSuccessBannerClass =
    'rounded-lg border border-teal-300 dark:border-teal-500 bg-teal-100 dark:bg-teal-950/70 px-3 py-2.5 text-sm font-semibold text-teal-900 dark:text-teal-100';

  @Input() entryId: string | null = null;
  @Output() saved = new EventEmitter<PriceCatalogFormSaveEvent>();
  @Output() cancelled = new EventEmitter<void>();

  private priceCatalogService = inject(PriceCatalogService);
  private dialogService = inject(DialogService);

  entryForm: PriceCatalogEntry = createEmptyPriceCatalogEntry();
  loadingEntry = false;
  saving = false;
  saveSuccessMessage = '';
  private saveSuccessTimeout: ReturnType<typeof setTimeout> | null = null;

  get isEditing(): boolean {
    return !!this.entryId;
  }

  get formReadOnly(): boolean {
    return !this.auth.canManagePriceCatalog;
  }

  get priceSummary() {
    return buildPriceSummary(this.entryForm);
  }

  get saveButtonLabel(): string {
    if (this.saving) return 'Guardando...';
    if (this.saveSuccessMessage) {
      return this.isEditing ? 'Guardado' : 'Referencia creada';
    }
    return this.isEditing ? 'Guardar' : 'Crear referencia';
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['entryId']) {
      this.loadEntry();
    }
  }

  addVariant() {
    this.entryForm.variantes.push(createEmptyVariant(''));
  }

  removeVariant(index: number) {
    this.entryForm.variantes.splice(index, 1);
  }

  addVariantRange(variantIndex: number) {
    const variant = this.entryForm.variantes[variantIndex];
    if (!variant) return;
    const last = variant.rangosCantidad[variant.rangosCantidad.length - 1];
    const cantidadMin = last?.cantidadMax ? last.cantidadMax + 1 : last ? last.cantidadMin + 1 : 1;
    variant.rangosCantidad.push({
      cantidadMin,
      cantidadMax: null,
      precioUnitario: 0,
    });
  }

  removeVariantRange(variantIndex: number, rangeIndex: number) {
    this.entryForm.variantes[variantIndex]?.rangosCantidad.splice(rangeIndex, 1);
  }

  saveEntry() {
    if (!this.auth.canManagePriceCatalog || this.saving) return;

    const payload = normalizePriceCatalogEntry(this.entryForm);
    if (!payload.nombre) {
      this.dialogService.alert({
        title: 'Falta el nombre',
        message: 'Indicá a qué producto corresponde esta referencia.',
      });
      return;
    }

    this.saving = true;
    const request$ = this.entryId
      ? this.priceCatalogService.updateEntry(this.entryId, payload)
      : this.priceCatalogService.createEntry(payload);

    request$.subscribe({
      next: ({ id }) => {
        this.saving = false;
        const wasNew = !this.entryId;
        this.entryForm = { ...payload, id };
        this.showSaveSuccess(
          wasNew
            ? 'Referencia creada correctamente. Ya podés usarla en pedidos.'
            : 'Cambios guardados correctamente.'
        );
        this.saved.emit({ id, entry: { ...payload, id }, wasNew });
      },
      error: () => {
        this.saving = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo guardar la referencia de precio.',
        });
      },
    });
  }

  ngOnDestroy() {
    if (this.saveSuccessTimeout) clearTimeout(this.saveSuccessTimeout);
  }

  private showSaveSuccess(message: string) {
    this.saveSuccessMessage = message;
    if (this.saveSuccessTimeout) clearTimeout(this.saveSuccessTimeout);
    this.saveSuccessTimeout = setTimeout(() => {
      this.saveSuccessMessage = '';
      this.saveSuccessTimeout = null;
    }, 5000);
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
        this.entryForm = {
          ...createEmptyPriceCatalogEntry(),
          ...entry,
          variantes: (entry.variantes ?? []).map((variant) => ({
            ...variant,
            rangosCantidad: [...(variant.rangosCantidad ?? [])],
          })),
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
