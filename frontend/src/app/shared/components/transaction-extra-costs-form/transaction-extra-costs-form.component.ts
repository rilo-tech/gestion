import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { DialogService } from '../../../core/services/dialog.service';
import type { OrderExtraCostPreset } from '../../../core/services/catalog-config.service';

export interface TransactionExtraCost {
  nombre: string;
  costo: number;
}

@Component({
  selector: 'app-transaction-extra-costs-form',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    <div *ngIf="presets.length > 0" class="mb-3 sm:mb-4">
      <p class="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5 sm:mb-2">
        Precargados
      </p>
      <div class="space-y-1 sm:space-y-2">
        <label
          *ngFor="let preset of presets"
          class="flex items-center gap-2 sm:gap-3 rounded-lg border border-gray-100 px-2 py-1.5 sm:px-3 sm:py-2 hover:bg-gray-50 cursor-pointer min-h-0">
          <input
            type="checkbox"
            [checked]="isPresetSelected(preset)"
            (change)="togglePreset(preset, $any($event.target).checked)"
            class="h-3.5 w-3.5 sm:h-4 sm:w-4 rounded border-gray-300 text-primary focus:ring-primary shrink-0">
          <span class="flex-1 min-w-0 text-xs sm:text-sm text-gray-900 truncate leading-tight">{{ preset.nombre }}</span>
          <span class="text-xs sm:text-sm font-semibold text-gray-700 tabular-nums shrink-0">{{ '$' + preset.costo }}</span>
        </label>
      </div>
    </div>

    <p
      *ngIf="presets.length > 0"
      class="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5 sm:mb-2">
      Agregar otro concepto
    </p>

    <div class="flex gap-1.5 sm:gap-2 items-end mb-3 sm:mb-4">
      <div class="flex-1 min-w-0">
        <label class="block text-[10px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">Concepto</label>
        <input
          [(ngModel)]="inputNombre"
          [name]="inputNamePrefix + 'Nombre'"
          placeholder="Ej. Estampado"
          (keydown.enter)="confirmInput()"
          [class]="fieldInputClass">
      </div>
      <div class="w-20 sm:w-28 shrink-0">
        <label class="block text-[10px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">{{ priceLabel }}</label>
        <input
          type="number"
          [(ngModel)]="inputCosto"
          [name]="inputNamePrefix + 'Costo'"
          (keydown.enter)="confirmInput()"
          min="0"
          placeholder="0"
          [class]="fieldInputClass + ' text-right'">
      </div>
      <button
        type="button"
        (click)="confirmInput()"
        class="inline-flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 shrink-0"
        title="Agregar a la lista">
        <i-lucide name="check" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i-lucide>
      </button>
    </div>

    <div
      *ngIf="draft.length === 0"
      class="text-xs sm:text-sm text-gray-400 text-center py-3 sm:py-4 border border-dashed border-gray-200 rounded-lg leading-snug">
      {{
        presets.length > 0
          ? 'Tildá conceptos precargados o agregá uno nuevo.'
          : 'Completá concepto y precio, y confirmá con el tilde.'
      }}
    </div>

    <div *ngIf="draft.length > 0" class="rounded-lg border border-gray-100 overflow-hidden">
      <div
        class="grid grid-cols-[minmax(0,1fr)_5rem_1.75rem] sm:grid-cols-[minmax(0,1fr)_6.5rem_2.25rem] gap-1.5 sm:gap-2 px-2 py-1 sm:px-3 sm:py-2 bg-gray-50 border-b border-gray-100 text-[10px] sm:text-xs font-medium text-gray-400 uppercase tracking-wide items-center">
        <span>Concepto</span>
        <span class="text-right">{{ priceLabel }}</span>
        <span></span>
      </div>

      <div
        *ngFor="let extra of draft; let j = index"
        class="grid grid-cols-[minmax(0,1fr)_5rem_1.75rem] sm:grid-cols-[minmax(0,1fr)_6.5rem_2.25rem] gap-1.5 sm:gap-2 px-2 py-1.5 sm:px-3 sm:py-2 border-b border-gray-100 last:border-b-0 items-center"
        [class.bg-teal-50/40]="editingIndex === j">
        <ng-container *ngIf="editingIndex !== j">
          <button
            type="button"
            (click)="startEditing(j)"
            class="min-w-0 text-left text-xs sm:text-sm text-gray-900 truncate hover:text-teal-700 leading-tight">
            {{ extra.nombre }}
          </button>
          <button
            type="button"
            (click)="startEditing(j)"
            class="text-right text-xs sm:text-sm font-semibold text-gray-900 tabular-nums hover:text-teal-700 leading-tight">
            {{ '$' + extra.costo }}
          </button>
        </ng-container>

        <ng-container *ngIf="editingIndex === j">
          <input
            [(ngModel)]="extra.nombre"
            [name]="inputNamePrefix + 'EditNombre' + j"
            (keydown.enter)="focusPriceInput(j)"
            [class]="editInputClass">
          <input
            type="number"
            [(ngModel)]="extra.costo"
            [name]="inputNamePrefix + 'EditCosto' + j"
            [attr.data-extra-index]="j"
            (keydown.enter)="finishEditing(j)"
            min="0"
            [class]="editInputClass + ' text-right'">
        </ng-container>

        <button
          type="button"
          (click)="removeAt(j)"
          class="inline-flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 text-sm sm:text-base text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md sm:rounded-lg justify-self-end"
          title="Quitar costo">
          ×
        </button>
      </div>
    </div>

    <div class="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <span class="text-xs sm:text-sm text-gray-500">{{ totalLabel }}</span>
        <span class="ml-1.5 sm:ml-2 text-sm sm:text-base font-bold tabular-nums">{{ '$' + draftTotal }}</span>
      </div>
      <button
        type="button"
        (click)="accept()"
        class="rounded-xl bg-teal-600 px-3 py-1.5 sm:px-5 sm:py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-teal-700 shrink-0">
        Listo
      </button>
    </div>
  `,
})
export class TransactionExtraCostsFormComponent implements OnChanges {
  private dialogService = inject(DialogService);

  @Input() presets: OrderExtraCostPreset[] = [];
  @Input() initialCosts: TransactionExtraCost[] = [];
  @Input() inputNamePrefix = 'extraCost';
  @Input() priceLabel = 'Precio';
  @Input() totalLabel = 'Total personalización';

  @Output() accepted = new EventEmitter<TransactionExtraCost[]>();

  readonly fieldInputClass =
    'w-full min-w-0 px-2 py-1 sm:px-3 sm:py-2 rounded-lg border border-gray-200 text-[11px] sm:text-sm leading-tight outline-none focus:ring-2 focus:ring-teal-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  readonly editInputClass =
    'w-full min-w-0 px-1.5 py-0.5 sm:px-2 sm:py-1.5 h-7 sm:h-auto rounded border border-teal-200 text-[10px] sm:text-sm leading-tight outline-none focus:ring-2 focus:ring-teal-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  draft: TransactionExtraCost[] = [];
  inputNombre = '';
  inputCosto: number | null = null;
  editingIndex: number | null = null;

  get draftTotal(): number {
    return this.draft.reduce((acc, extra) => acc + (Number(extra.costo) || 0), 0);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialCosts']) {
      this.draft = (this.initialCosts ?? []).map((extra) => ({
        nombre: extra.nombre,
        costo: Number(extra.costo) || 0,
      }));
      this.resetInput();
      this.editingIndex = null;
    }
  }

  isPresetSelected(preset: OrderExtraCostPreset): boolean {
    const key = preset.nombre.trim().toLowerCase();
    return this.draft.some((extra) => extra.nombre.trim().toLowerCase() === key);
  }

  togglePreset(preset: OrderExtraCostPreset, selected: boolean): void {
    const key = preset.nombre.trim().toLowerCase();
    if (selected) {
      if (!this.isPresetSelected(preset)) {
        this.draft.push({ nombre: preset.nombre, costo: preset.costo });
      }
    } else {
      this.draft = this.draft.filter((extra) => extra.nombre.trim().toLowerCase() !== key);
    }
    this.editingIndex = null;
  }

  confirmInput(): void {
    const nombre = this.inputNombre.trim();
    const costo = Number(this.inputCosto);

    if (!nombre) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá el concepto del costo.',
      });
      return;
    }

    if (this.inputCosto === null || this.inputCosto === undefined || Number.isNaN(costo) || costo < 0) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá un precio válido.',
      });
      return;
    }

    this.draft.push({ nombre, costo });
    this.resetInput();
    this.editingIndex = null;
  }

  startEditing(index: number): void {
    this.editingIndex = index;
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(
        `input[name="${this.inputNamePrefix}EditNombre${index}"]`
      );
      input?.focus();
      input?.select();
    });
  }

  focusPriceInput(index: number): void {
    const input = document.querySelector<HTMLInputElement>(`input[data-extra-index="${index}"]`);
    input?.focus();
    input?.select();
  }

  finishEditing(index: number): boolean {
    const extra = this.draft[index];
    if (!extra) return true;

    const nombre = extra.nombre.trim();
    const costo = Number(extra.costo);

    if (!nombre) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'El concepto no puede quedar vacío.',
      });
      return false;
    }

    if (Number.isNaN(costo) || costo < 0) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá un precio válido.',
      });
      return false;
    }

    extra.nombre = nombre;
    extra.costo = costo;
    this.editingIndex = null;
    return true;
  }

  removeAt(index: number): void {
    if (this.editingIndex === index) {
      this.editingIndex = null;
    } else if (this.editingIndex !== null && this.editingIndex > index) {
      this.editingIndex--;
    }
    this.draft.splice(index, 1);
  }

  accept(): void {
    if (this.editingIndex !== null && !this.finishEditing(this.editingIndex)) {
      return;
    }
    this.accepted.emit(
      this.draft.map((extra) => ({
        nombre: extra.nombre,
        costo: Number(extra.costo) || 0,
      }))
    );
  }

  private resetInput(): void {
    this.inputNombre = '';
    this.inputCosto = null;
  }
}
