import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Client, ClientService } from '../../core/services/client.service';
import { formatMoneyValue } from '../../shared/pipes/money.pipe';
import { DialogService } from '../../core/services/dialog.service';
import {
  AppConfig,
  CatalogConfigService,
  DEFAULT_APP_CONFIG,
} from '../../core/services/catalog-config.service';
import {
  SearchableSelectComponent,
  SearchableSelectOption,
} from '../../shared/components/searchable-select/searchable-select.component';
import {
  FORM_CONTROL_CLASS,
  FORM_LABEL_CLASS,
} from '../../shared/components/icon-action/icon-action.component';
import {
  FORM_COMPACT_CHIP_INPUT_WRAP_CLASS,
} from '../../shared/components/form-shell/form-field.constants';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';
import { Subscription } from 'rxjs';
import { confirmClientDeletion } from '../../core/utils/client-delete-flow';
import { switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { SelectOnFocusDirective } from '../../shared/directives/select-on-focus.directive';
import { FormPanelFooterComponent } from '../../shared/components/form-panel-footer/form-panel-footer.component';

export interface ClientFormSaveEvent {
  id: string;
  client: Client;
}

@Component({
  selector: 'app-client-form-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    SearchableSelectComponent,
    RouterLink,
    SelectOnFocusDirective,
    FormPanelFooterComponent,
  ],
  template: `
    <div class="space-y-4">
      <a
        *ngIf="isEditing && clientId && showHistorialLink"
        [routerLink]="['/clients', clientId, 'historial']"
        class="flex items-center justify-between gap-4 rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 hover:bg-teal-100/80 transition-colors">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-teal-900">Historial y cuenta corriente</p>
          <p class="text-xs text-teal-800 mt-0.5">Ver pedidos, ventas y registrar cobros.</p>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <span *ngIf="auth.canViewAccountBalance && clientSaldo > 0" class="text-sm font-bold tabular-nums text-orange-700">
            {{ formatMoney(clientSaldo) }}
          </span>
          <i-lucide name="history" class="w-5 h-5 text-teal-700"></i-lucide>
        </div>
      </a>

      <div *ngIf="loadingClient" class="py-8 text-center text-sm text-gray-400">
        Cargando cliente...
      </div>

      <form
        *ngIf="!loadingClient"
        (submit)="saveClient(); $event.preventDefault()"
        class="space-y-4">
        <fieldset
          [disabled]="formReadOnly"
          [class]="wideLayout
            ? 'border-0 p-0 m-0 min-w-0 space-y-4 md:space-y-0 md:grid md:grid-cols-2 md:gap-x-6 md:gap-y-4'
            : 'space-y-4 border-0 p-0 m-0 min-w-0'">
        <div [class.md:col-span-2]="wideLayout">
          <label [class]="formLabelClass">Nombre completo</label>
          <input
            [(ngModel)]="clientForm.nombre"
            name="clientNombre"
            required
            [class]="formControlClass">
        </div>
        <div>
          <label [class]="formLabelClass">WhatsApp / Teléfono</label>
          <input
            [(ngModel)]="clientForm.telefono"
            name="clientTelefono"
            [class]="formControlClass">
        </div>
        <div>
          <label [class]="formLabelClass">IG / Web</label>
          <input
            [(ngModel)]="clientForm.redes!.igWeb"
            name="clientIgWeb"
            placeholder="@usuario o https://..."
            [class]="formControlClass">
        </div>
        <div>
          <label [class]="formLabelClass">Dirección</label>
          <input
            [(ngModel)]="clientForm.direccion"
            name="clientDireccion"
            [class]="formControlClass">
        </div>
        <div>
          <label [class]="formLabelClass">Email</label>
          <input
            [(ngModel)]="clientForm.email"
            name="clientEmail"
            type="email"
            [class]="formControlClass">
        </div>
        <div>
          <label [class]="formLabelClass">Etiquetas</label>

          <div *ngIf="useEtiquetaList; else freeEtiquetas">
            <div
              [class]="chipInputWrapClass">
              <span
                *ngFor="let tag of selectedEtiquetas"
                class="inline-flex items-center gap-1 rounded-full border border-teal-100 bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-800">
                {{ tag }}
                <button
                  type="button"
                  (click)="removeEtiqueta(tag)"
                  class="inline-flex h-4 w-4 items-center justify-center rounded-full text-teal-600 hover:bg-teal-100 hover:text-teal-900"
                  [attr.aria-label]="'Quitar ' + tag">
                  ×
                </button>
              </span>
              <app-searchable-select
                [(ngModel)]="etiquetaPicker"
                (ngModelChange)="onEtiquetaSelected($event)"
                name="etiquetaPicker"
                [labeledOptions]="etiquetaSelectOptions"
                [creatable]="true"
                [embedded]="true"
                createLabelPrefix="Agregar etiqueta"
                (createRequested)="onCreateEtiqueta($event)"
                placeholder="Buscar etiqueta..."
                emptyOptionsMessage="No hay etiquetas configuradas"
                listHint="">
              </app-searchable-select>
            </div>
            <p class="mt-1 text-xs text-gray-400">
              Podés agregar varias. Elegí una existente o escribí una nueva.
            </p>
          </div>

          <ng-template #freeEtiquetas>
            <input
              [(ngModel)]="etiquetasText"
              name="etiquetasText"
              placeholder="Ej. VIP, Mayorista"
              [class]="formControlClass">
            <p class="mt-1 text-xs text-gray-400">Separá varias etiquetas con coma.</p>
          </ng-template>
        </div>
        </fieldset>

        <div
          *ngIf="isEditing && clientForm.activo === false"
          class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
          <p class="m-0">Este cliente está inactivo y no aparece al crear ventas o pedidos nuevos.</p>
          <button
            *ngIf="auth.canEditRecords"
            type="button"
            class="mt-2 text-sm font-semibold text-teal-700 hover:underline dark:text-teal-300"
            (click)="reactivateClient()">
            Reactivar cliente
          </button>
        </div>

        <app-form-panel-footer
          [deleteLabel]="isEditing && auth.canDeleteRecords ? 'Eliminar cliente' : ''"
          [cancelLabel]="formReadOnly ? 'Cerrar' : 'Cancelar'"
          [saveLabel]="isEditing ? 'Guardar' : 'Crear cliente'"
          [showSave]="!formReadOnly"
          [saving]="savingClient"
          (cancelClick)="cancelled.emit()"
          (saveClick)="saveClient()"
          (deleteClick)="confirmDeleteClient()">
        </app-form-panel-footer>
      </form>
    </div>
  `,
})
export class ClientFormPanelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() clientId: string | null = null;
  @Input() prefillNombre = '';
  @Input() showHistorialLink = true;
  @Input() wideLayout = false;
  @Output() saved = new EventEmitter<ClientFormSaveEvent>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() deleted = new EventEmitter<void>();

  private clientService = inject(ClientService);
  private catalogConfigService = inject(CatalogConfigService);
  private dialogService = inject(DialogService);
  readonly auth = inject(AuthService);
  readonly formControlClass = FORM_CONTROL_CLASS;
  readonly formLabelClass = FORM_LABEL_CLASS;
  readonly chipInputWrapClass = FORM_COMPACT_CHIP_INPUT_WRAP_CLASS;
  private configSub?: Subscription;

  appConfig: AppConfig = structuredClone(DEFAULT_APP_CONFIG);
  clientSaldo = 0;

  formatMoney(value?: number | null): string {
    return formatMoneyValue(value);
  }
  savingClient = false;
  loadingClient = false;
  clientForm: Partial<Client> = this.emptyClientForm();
  etiquetaPicker = '';
  etiquetasText = '';
  private readonly emptyEtiquetas: string[] = [];
  etiquetaSelectOptionsCache: SearchableSelectOption[] = [];
  private etiquetaSelectOptionsKey = '';

  get isEditing(): boolean {
    return !!this.clientId;
  }

  get formReadOnly(): boolean {
    return this.isEditing && !this.auth.canEditRecords;
  }

  get useEtiquetaList(): boolean {
    return this.catalogConfigService.usesConfigurableList(this.appConfig, 'clientes.etiquetas');
  }

  get etiquetaSelectOptions(): SearchableSelectOption[] {
    const selectedTags = this.clientForm.etiquetas ?? this.emptyEtiquetas;
    const tagsKey = selectedTags.join('\u0001');
    const optionsKey = JSON.stringify(this.catalogConfigService.getFieldOptions(this.appConfig, 'clientes.etiquetas'));
    const key = `${tagsKey}\u0002${optionsKey}`;
    if (key === this.etiquetaSelectOptionsKey) {
      return this.etiquetaSelectOptionsCache;
    }
    this.etiquetaSelectOptionsKey = key;
    const selected = new Set(selectedTags.map((tag) => tag.toLowerCase()));
    this.etiquetaSelectOptionsCache = this.catalogConfigService
      .getFieldOptions(this.appConfig, 'clientes.etiquetas')
      .filter((tag) => !selected.has(tag.toLowerCase()))
      .map((tag) => ({
        value: tag,
        label: tag,
      }));
    return this.etiquetaSelectOptionsCache;
  }

  get selectedEtiquetas(): string[] {
    return this.clientForm.etiquetas ?? this.emptyEtiquetas;
  }

  ngOnInit() {
    this.configSub = this.catalogConfigService.appConfig$.subscribe((config) => {
      if (config === this.appConfig) return;
      this.appConfig = config;
      this.etiquetaSelectOptionsKey = '';
    });
    this.catalogConfigService.getAppConfig().subscribe();
    this.resetForm();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['clientId'] || changes['prefillNombre']) {
      this.resetForm();
    }
  }

  ngOnDestroy() {
    this.configSub?.unsubscribe();
  }

  private resetForm() {
    this.clientSaldo = 0;

    if (this.clientId) {
      this.loadClient(this.clientId);
      return;
    }

    this.loadingClient = false;
    this.clientForm = this.emptyClientForm();
    if (this.prefillNombre.trim()) {
      this.clientForm.nombre = this.prefillNombre.trim();
    }
    this.etiquetasText = '';
    this.etiquetaPicker = '';
  }

  private loadClient(id: string) {
    this.loadingClient = true;
    this.clientService.getClient(id).subscribe({
      next: (client) => {
        this.clientForm = {
          nombre: client.nombre ?? '',
          telefono: client.telefono ?? '',
          email: client.email ?? '',
          direccion: client.direccion ?? '',
          redes: {
            igWeb: client.redes?.igWeb ?? client.redes?.instagram ?? '',
          },
          etiquetas: [...(client.etiquetas ?? [])],
        };
        this.clientSaldo = client.saldoPendiente ?? 0;
        this.etiquetasText = (client.etiquetas ?? []).join(', ');
        this.etiquetaPicker = '';
        this.loadingClient = false;
      },
      error: () => {
        this.loadingClient = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo cargar el cliente.',
        });
        this.cancelled.emit();
      },
    });
  }

  onEtiquetaSelected(value: string) {
    const tag = value.trim();
    if (!tag) return;

    this.addEtiqueta(tag);
    window.setTimeout(() => {
      this.etiquetaPicker = '';
    });
  }

  onCreateEtiqueta(name: string) {
    const tag = name.trim();
    if (!tag) return;

    this.addEtiqueta(tag);
    this.etiquetaPicker = '';
    this.catalogConfigService.ensureFieldOptions('clientes.etiquetas', [tag]).subscribe();
  }

  addEtiqueta(tag: string) {
    if (!tag) return;

    const current = this.clientForm.etiquetas ?? [];
    const exists = current.some((item) => item.toLowerCase() === tag.toLowerCase());
    if (exists) return;

    this.clientForm.etiquetas = [...current, tag];
  }

  removeEtiqueta(tag: string) {
    this.clientForm.etiquetas = (this.clientForm.etiquetas ?? []).filter((item) => item !== tag);
  }

  resolveEtiquetas(): string[] {
    if (this.useEtiquetaList) {
      return [...(this.clientForm.etiquetas ?? [])];
    }

    return this.etiquetasText
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  saveClient() {
    if (!this.clientForm.nombre?.trim()) {
      this.dialogService.alert({
        title: 'Campo requerido',
        message: 'Ingresá el nombre del cliente.',
      });
      return;
    }

    const etiquetas = this.resolveEtiquetas();

    const payload: Client = {
      nombre: this.clientForm.nombre!.trim(),
      telefono: this.clientForm.telefono?.trim() ?? '',
      email: this.clientForm.email?.trim() ?? '',
      direccion: this.clientForm.direccion?.trim() ?? '',
      redes: { igWeb: this.clientForm.redes?.igWeb?.trim() ?? '' },
      etiquetas,
    };

    this.savingClient = true;

    const request = this.clientId
      ? this.clientService.updateClient(this.clientId, payload)
      : this.clientService.createClient(payload);

    request
      .pipe(
        switchMap((response) =>
          this.catalogConfigService.ensureFieldOptions('clientes.etiquetas', etiquetas).pipe(
            catchError(() => of(null)),
            switchMap(() => of(response))
          )
        )
      )
      .subscribe({
        next: (response) => {
          this.savingClient = false;
          const id = this.clientId ?? response.id;
          if (!id) return;

          this.saved.emit({
            id,
            client: { ...payload, id },
          });
        },
        error: () => {
          this.savingClient = false;
          this.dialogService.alert({
            title: 'Error',
            message: this.clientId
              ? 'No se pudo actualizar el cliente.'
              : 'No se pudo guardar el cliente.',
          });
        },
      });
  }

  confirmDeleteClient() {
    if (!this.clientId) return;
    const name = this.clientForm.nombre?.trim() || 'este cliente';

    confirmClientDeletion(
      this.clientId,
      name,
      this.clientService,
      this.dialogService,
      () => this.deleted.emit()
    );
  }

  reactivateClient() {
    if (!this.clientId || !this.auth.canEditRecords) return;
    this.clientService.setClientActive(this.clientId, true).subscribe({
      next: () => {
        this.clientForm.activo = true;
        this.dialogService.alert({
          title: 'Cliente reactivado',
          message: 'El cliente volvió a estar disponible para ventas y pedidos.',
        });
      },
      error: () =>
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudo reactivar el cliente.',
        }),
    });
  }

  private emptyClientForm(): Partial<Client> {
    return {
      nombre: '',
      telefono: '',
      email: '',
      direccion: '',
      redes: { igWeb: '' },
      etiquetas: [],
    };
  }
}
