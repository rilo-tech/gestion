import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import {
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_MODULE_LABELS,
  ActivityLogEntry,
  ActivityModule,
  ActivityService,
} from '../../../core/services/activity.service';
import { AuthService } from '../../../core/services/auth.service';
import { IconActionComponent } from '../icon-action/icon-action.component';
import { TransactionModalComponent } from '../transaction-modal/transaction-modal.component';

@Component({
  selector: 'app-activity-log-trigger',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, IconActionComponent, TransactionModalComponent],
  template: `
    <app-icon-action
      label="Actividad"
      [iconOnly]="true"
      variant="outline"
      (clicked)="openModal()">
      <i-lucide name="history" class="w-4 h-4"></i-lucide>
    </app-icon-action>

    <app-transaction-modal
      [open]="modalOpen"
      [title]="'Actividad · ' + moduleLabel"
      [subtitle]="modalSubtitle"
      maxWidthClass="max-w-2xl"
      (closed)="closeModal()">
      <div *ngIf="loading" class="py-12 text-center text-sm text-gray-400">Cargando actividad...</div>
      <div *ngIf="!loading && errorMessage" class="py-8 text-center text-sm text-red-600">{{ errorMessage }}</div>
      <div *ngIf="!loading && !errorMessage && entries.length === 0" class="py-12 text-center text-sm text-gray-400">
        Todavía no hay acciones registradas en este módulo.
      </div>
      <div *ngIf="!loading && entries.length > 0" class="space-y-2 max-h-[min(28rem,60vh)] overflow-y-auto pr-1">
        <article
          *ngFor="let entry of entries"
          class="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-gray-900">{{ entry.summary }}</p>
              <p class="text-xs text-gray-500 mt-1">
                {{ formatDate(entry.createdAt) }}
                <span *ngIf="auth.isPrivileged"> · {{ entry.userNombre }}</span>
              </p>
            </div>
            <span
              class="shrink-0 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
              [ngClass]="actionBadgeClass(entry.action)">
              {{ actionLabels[entry.action] }}
            </span>
          </div>
        </article>
      </div>
    </app-transaction-modal>
  `,
})
export class ActivityLogTriggerComponent {
  @Input({ required: true }) module!: ActivityModule;

  private activityService = inject(ActivityService);
  readonly auth = inject(AuthService);

  readonly actionLabels = ACTIVITY_ACTION_LABELS;

  modalOpen = false;
  loading = false;
  errorMessage = '';
  entries: ActivityLogEntry[] = [];

  get moduleLabel(): string {
    return ACTIVITY_MODULE_LABELS[this.module] ?? this.module;
  }

  get modalSubtitle(): string {
    return this.auth.isPrivileged
      ? 'Acciones de todos los usuarios en este módulo.'
      : 'Solo tus acciones en este módulo.';
  }

  openModal() {
    this.modalOpen = true;
    this.loadEntries();
  }

  closeModal() {
    this.modalOpen = false;
  }

  actionBadgeClass(action: ActivityLogEntry['action']): string {
    switch (action) {
      case 'create':
        return 'bg-green-100 text-green-800';
      case 'update':
        return 'bg-blue-100 text-blue-800';
      case 'delete':
      case 'cancel':
        return 'bg-red-100 text-red-800';
      case 'payment':
        return 'bg-amber-100 text-amber-800';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  }

  formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private loadEntries() {
    this.loading = true;
    this.errorMessage = '';
    this.activityService.getModuleActivity(this.module).subscribe({
      next: (entries) => {
        this.entries = entries;
        this.loading = false;
      },
      error: () => {
        this.entries = [];
        this.loading = false;
        this.errorMessage = 'No se pudo cargar el historial de actividad.';
      },
    });
  }
}
