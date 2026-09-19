import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AutomationsService,
  type AutomationChannel,
  type AutomationPresetId,
  type AutomationPresetView,
} from '../../core/services/automations.service';
import { DialogService } from '../../core/services/dialog.service';
import { CONFIG_SETTING_DESC_CLASS } from '../../shared/components/config-editable-list/config-editable-list.constants';

@Component({
  selector: 'app-settings-automations-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="space-y-4">
      <div class="rounded-xl border border-teal-100 bg-teal-50/60 dark:border-teal-900 dark:bg-teal-950/30 px-4 py-3">
        <p class="text-sm font-semibold text-teal-900 dark:text-teal-100">RILO te avisa</p>
        <p [class]="descClass" class="mt-1">
          Activá solo lo que te sirve. RILO usa datos reales del negocio: si no hay nada que contar, no molesta.
        </p>
        <p *ngIf="channelHint" class="mt-2 text-xs text-teal-800/80 dark:text-teal-200/80">
          {{ channelHint }}
        </p>
      </div>

      <div *ngIf="loading" class="text-sm text-gray-500">Cargando avisos…</div>
      <div *ngIf="error" class="text-sm text-red-600">{{ error }}</div>

      <div *ngFor="let row of presets" class="rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <div class="flex items-start gap-3">
          <input
            type="checkbox"
            class="mt-1 h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
            [checked]="row.enabled"
            [disabled]="!row.available || savingId === row.preset.id"
            (change)="toggle(row, $any($event.target).checked)" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                <span aria-hidden="true">{{ row.preset.icon }}</span>
                {{ row.preset.label }}
              </p>
              <span
                class="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                [class.bg-teal-100]="row.enabled"
                [class.text-teal-800]="row.enabled"
                [class.bg-gray-100]="!row.enabled"
                [class.text-gray-500]="!row.enabled">
                {{ row.enabled ? 'ON' : 'OFF' }}
              </span>
              <span *ngIf="row.enabled && scheduleHint(row)" class="text-xs text-gray-500 tabular-nums">
                {{ scheduleHint(row) }}
              </span>
            </div>
            <p [class]="descClass" class="mt-0.5">{{ row.preset.blurb }}</p>

            <div *ngIf="row.enabled || draftOpen === row.preset.id" class="mt-3 flex flex-wrap items-center gap-3">
              <label *ngIf="row.preset.scheduleRequired" class="text-xs text-gray-500 flex items-center gap-1.5">
                Horario
                <input
                  type="time"
                  class="rounded-md border border-gray-200 dark:border-gray-600 px-2 py-1 text-sm bg-white dark:bg-gray-950"
                  [ngModel]="row.time || row.preset.defaultTime || '09:00'"
                  (ngModelChange)="onTime(row, $event)"
                  [name]="'time-' + row.preset.id" />
              </label>

              <label class="text-xs text-gray-500 flex items-center gap-1.5">
                <input
                  type="checkbox"
                  [checked]="row.channels.includes('whatsapp')"
                  [disabled]="!whatsappAllowed || savingId === row.preset.id"
                  (change)="toggleChannel(row, 'whatsapp', $any($event.target).checked)" />
                WhatsApp
              </label>
              <span *ngIf="!whatsappAllowed" class="text-[11px] text-gray-400">
                Disponible con RILO Completo
              </span>

              <label *ngIf="erpAllowed" class="text-xs text-gray-500 flex items-center gap-1.5">
                <input
                  type="checkbox"
                  [checked]="row.channels.includes('erp')"
                  [disabled]="savingId === row.preset.id"
                  (change)="toggleChannel(row, 'erp', $any($event.target).checked)" />
                Panel
              </label>
            </div>

            <button
              type="button"
              class="mt-2 text-xs text-gray-500 hover:text-gray-700 underline"
              (click)="never(row)">
              No volver a mostrar este aviso
            </button>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class SettingsAutomationsPanelComponent implements OnInit {
  private readonly api = inject(AutomationsService);
  private readonly dialog = inject(DialogService);

  /** Solo avisos clave para tenants Resumen RILO (Bot). */
  @Input() summaryMode = false;

  readonly descClass = CONFIG_SETTING_DESC_CLASS;
  presets: AutomationPresetView[] = [];
  allowedChannels: AutomationChannel[] = [];
  channelHint = '';
  loading = true;
  error = '';
  savingId: string | null = null;
  draftOpen: string | null = null;

  private readonly summaryPresetIds = new Set<AutomationPresetId>([
    'daily_attention',
    'daily_summary',
    'payables_due',
    'overdue_orders',
    'low_stock',
  ]);

  get whatsappAllowed(): boolean {
    return this.allowedChannels.includes('whatsapp');
  }

  get erpAllowed(): boolean {
    return this.allowedChannels.includes('erp');
  }

  ngOnInit() {
    this.reload();
  }

  scheduleHint(row: AutomationPresetView): string {
    if (row.preset.id === 'payables_due') {
      return '3 días antes';
    }
    if (!row.preset.scheduleRequired) return '';
    return row.time || row.preset.defaultTime || '';
  }

  reload() {
    this.loading = true;
    this.error = '';
    this.api.listPresets().subscribe({
      next: (res) => {
        let rows = res.presets;
        if (this.summaryMode) {
          rows = rows.filter((row) => this.summaryPresetIds.has(row.preset.id));
          const order: AutomationPresetId[] = [
            'daily_attention',
            'daily_summary',
            'payables_due',
            'overdue_orders',
            'low_stock',
          ];
          rows = [...rows].sort(
            (a, b) => order.indexOf(a.preset.id) - order.indexOf(b.preset.id)
          );
          rows = rows.map((row) => {
            if (row.preset.id === 'daily_attention') {
              return {
                ...row,
                preset: {
                  ...row.preset,
                  label: 'Qué tengo hoy',
                  blurb: '08:30 — entregas, atrasados, compromisos y vencimientos.',
                },
              };
            }
            if (row.preset.id === 'daily_summary') {
              return {
                ...row,
                preset: {
                  ...row.preset,
                  label: 'Resumen del día',
                  blurb: '19:00 — ventas y actividad del día con datos reales.',
                },
              };
            }
            if (row.preset.id === 'payables_due') {
              return {
                ...row,
                preset: {
                  ...row.preset,
                  label: 'Vencimientos',
                  blurb: 'Avisá N días antes de cuentas a pagar próximas.',
                },
              };
            }
            if (row.preset.id === 'overdue_orders') {
              return {
                ...row,
                preset: {
                  ...row.preset,
                  label: 'Pedidos atrasados',
                  blurb: 'Solo si hay pedidos con entrega vencida.',
                },
              };
            }
            if (row.preset.id === 'low_stock') {
              return {
                ...row,
                preset: {
                  ...row.preset,
                  label: 'Stock bajo',
                  blurb: 'Opcional. Productos en o bajo el mínimo configurado.',
                },
              };
            }
            return row;
          });
        }
        this.presets = rows;
        this.allowedChannels = res.allowedChannels;
        if (res.allowedChannels.includes('whatsapp') && res.allowedChannels.includes('erp')) {
          this.channelHint = 'Con RILO Completo podés elegir WhatsApp, el panel, o ambos.';
        } else if (res.allowedChannels.includes('whatsapp')) {
          this.channelHint = 'Con RILO Bot los avisos salen por WhatsApp.';
        } else if (res.allowedChannels.includes('erp')) {
          this.channelHint = 'Con RILO Gestión los avisos aparecen en el panel.';
        } else {
          this.channelHint = 'Activá RILO Bot o Gestión para recibir avisos.';
        }
        this.loading = false;
      },
      error: () => {
        this.error = 'No se pudieron cargar los avisos.';
        this.loading = false;
      },
    });
  }

  toggle(row: AutomationPresetView, enabled: boolean) {
    this.savingId = row.preset.id;
    this.api
      .setPreset(row.preset.id, {
        enabled,
        time: row.time || row.preset.defaultTime || undefined,
        channels: row.channels,
      })
      .subscribe({
        next: (res) => {
          row.enabled = res.preset.enabled;
          row.time = res.preset.time;
          row.channels = res.preset.channels;
          row.automationId = res.preset.automationId;
          this.savingId = null;
        },
        error: (err) => {
          this.savingId = null;
          this.dialog.alert({
            title: 'No se pudo guardar',
            message: err?.error?.error || 'Intentá de nuevo.',
          });
          this.reload();
        },
      });
  }

  onTime(row: AutomationPresetView, time: string) {
    row.time = time;
    if (!row.enabled) return;
    this.toggle(row, true);
  }

  toggleChannel(row: AutomationPresetView, channel: AutomationChannel, on: boolean) {
    if (channel === 'whatsapp' && !this.whatsappAllowed) return;
    if (channel === 'erp' && !this.erpAllowed) return;
    const set = new Set(row.channels);
    if (on) set.add(channel);
    else set.delete(channel);
    if (!set.size) {
      this.dialog.alert({
        title: 'Elegí un canal',
        message: 'Dejá al menos WhatsApp o el panel.',
      });
      return;
    }
    row.channels = [...set];
    if (row.enabled) this.toggle(row, true);
  }

  never(row: AutomationPresetView) {
    this.dialog
      .confirm({
        title: 'No volver a mostrar',
        message: `¿Ocultar “${row.preset.label}” de forma permanente? Podés pedirlo de nuevo a RILO por WhatsApp si lo necesitás.`,
        confirmLabel: 'No mostrar más',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.api.neverShowPreset(row.preset.id).subscribe({
          next: () => this.reload(),
        });
      });
  }
}
