import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../../core/services/auth.service';
import {
  AddonsService,
  type AddonsSnapshot,
  type ClientWhatsappLine,
} from '../../../core/services/addons.service';
import {
  BusinessService,
  type ClientUsageSummary,
} from '../../../core/services/business.service';
import { PlanStatusCardComponent } from '../plan-status-card/plan-status-card.component';

@Component({
  selector: 'app-account-commercial-hub',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, PlanStatusCardComponent],
  template: `
    <section *ngIf="!auth.isPlatformAdmin" class="space-y-4 mb-4">
      <article
        *ngIf="showAddBotCta || showAddErpCta"
        class="bg-white dark:bg-gray-900 rounded-xl border border-dashed border-teal-300 dark:border-teal-800 p-4 sm:p-5 space-y-3">
        <h2 class="text-sm font-bold text-gray-900 dark:text-gray-100">Sumar productos</h2>
        <div class="flex flex-wrap gap-2">
          <a
            *ngIf="showAddBotCta"
            routerLink="/activar-suscripcion"
            [queryParams]="{ producto: 'whatsapp' }"
            class="inline-flex rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700">
            Agregar RILO Bot
          </a>
          <a
            *ngIf="showAddErpCta"
            routerLink="/activar-suscripcion"
            [queryParams]="{ producto: 'erp' }"
            class="inline-flex rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700">
            Agregar RILO Gestión
          </a>
        </div>
      </article>

      <article
        *ngIf="addons && auth.canAccessErpWeb && auth.isSupervisor"
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 sm:p-6 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-sm font-bold text-gray-900 dark:text-gray-100">Usuarios ERP</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Incluidos y adicionales en tu plan</p>
          </div>
          <a
            *ngIf="auth.canManageUsers"
            routerLink="/settings"
            class="text-sm font-semibold text-teal-700 dark:text-teal-400 hover:underline">
            Administrar usuarios
          </a>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">Incluidos</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ addons.erp.included }}</p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">Adicionales</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ addons.erp.extraContracted }}</p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">Activos</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ addons.erp.active }}</p>
          </div>
          <div *ngIf="auth.isSupervisor">
            <p class="text-xs text-gray-500 dark:text-gray-400">Precio extra</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ addons.currency }} {{ addons.erp.extraUnit }}/mes</p>
          </div>
        </div>
      </article>

      <article
        *ngIf="addons && hasWhatsappProduct"
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 sm:p-6 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-sm font-bold text-gray-900 dark:text-gray-100">WhatsApp · RILO Bot</h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Números incluidos y líneas activas</p>
          </div>
          <a
            *ngIf="auth.isSupervisor && auth.canAccessWhatsapp"
            routerLink="/inicio"
            class="text-sm font-semibold text-teal-700 dark:text-teal-400 hover:underline">
            Administrar números
          </a>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">Incluidos</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ addons.whatsapp.included }}</p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">Adicionales</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ addons.whatsapp.extraContracted }}</p>
          </div>
          <div *ngIf="auth.isSupervisor">
            <p class="text-xs text-gray-500 dark:text-gray-400">Precio extra</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ addons.currency }} {{ addons.whatsapp.extraUnit }}/mes</p>
          </div>
          <div *ngIf="auth.isSupervisor">
            <p class="text-xs text-gray-500 dark:text-gray-400">Costo adicional</p>
            <p class="font-semibold text-gray-900 dark:text-gray-100">{{ addons.currency }} {{ addons.whatsapp.extraCost }}/mes</p>
          </div>
        </div>
        <div *ngFor="let line of addons.whatsapp.lines" class="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2 text-sm">
          <p class="font-medium text-gray-900 dark:text-gray-100">{{ line.phone || 'Sin número' }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            {{ line.kind === 'primary' ? 'Principal' : 'Adicional' }} · {{ lineStatusLabel(line) }}
          </p>
        </div>
      </article>

      <article
        *ngIf="usage && hasWhatsappProduct"
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 sm:px-6 sm:py-5">
        <p class="text-sm font-bold text-gray-900 dark:text-gray-100">Consumo RILO Bot · este mes</p>
        <div class="mt-3 space-y-3">
          <div *ngIf="usage.ai.max > 0 || usage.ai.used > 0">
            <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>Acciones por WhatsApp</span>
              <span class="tabular-nums">{{ usage.ai.used }} / {{ usage.ai.max || '∞' }}</span>
            </div>
            <div class="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div class="h-full bg-teal-600 rounded-full" [style.width.%]="usagePct(usage.ai.used, usage.ai.max)"></div>
            </div>
          </div>
        </div>
      </article>

      <div *ngIf="auth.isSupervisor" class="space-y-3">
        <app-plan-status-card variant="home"></app-plan-status-card>
        <div class="flex flex-wrap gap-2">
          <a
            routerLink="/plan"
            class="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800">
            Ver plan y facturación
          </a>
          <a
            routerLink="/activar-suscripcion"
            class="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800">
            Activar o cambiar plan
          </a>
        </div>
      </div>
    </section>
  `,
})
export class AccountCommercialHubComponent implements OnInit {
  readonly auth = inject(AuthService);
  private addonsApi = inject(AddonsService);
  private businessApi = inject(BusinessService);

  addons: AddonsSnapshot | null = null;
  usage: ClientUsageSummary | null = null;

  ngOnInit() {
    if (this.auth.isPlatformAdmin) return;
    if (this.auth.isSupervisor) {
      this.addonsApi.getSnapshot().subscribe({ next: (row) => (this.addons = row) });
    }
    this.loadUsage();
  }

  get hasWhatsappProduct(): boolean {
    return this.auth.canAccessWhatsapp || this.auth.hasWhatsappEntitlement;
  }

  get showAddBotCta(): boolean {
    return this.auth.isSupervisor && this.auth.canAccessErpWeb && !this.auth.hasWhatsappEntitlement;
  }

  get showAddErpCta(): boolean {
    return this.auth.isSupervisor && this.auth.canAccessWhatsapp && !this.auth.hasErpEntitlement;
  }

  lineStatusLabel(line: ClientWhatsappLine): string {
    if (line.status === 'pending') return 'pendiente';
    if (line.status === 'disconnected' || !line.enabled) return 'desconectado';
    return 'activo';
  }

  usagePct(used: number, max: number): number {
    if (!max) return 0;
    return Math.min(100, Math.round((Math.max(0, used) / max) * 100));
  }

  private loadUsage() {
    const businessId = this.auth.currentBusinessId;
    if (!businessId || !this.hasWhatsappProduct) return;
    this.businessApi.getUsage(businessId).subscribe({ next: (usage) => (this.usage = usage) });
  }
}
