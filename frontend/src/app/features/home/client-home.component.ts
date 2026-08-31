import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../core/services/auth.service';
import { BusinessService, type ClientUsageSummary } from '../../core/services/business.service';
import { AddonsService, type AddonsSnapshot, type ClientWhatsappLine } from '../../core/services/addons.service';
import { UserService, type CreateUserPayload } from '../../core/services/user.service';
import { DEFAULT_STAFF_PERMISSIONS } from '../../core/constants/permissions';
import { DialogService } from '../../core/services/dialog.service';
import { PAGE_SHELL_CLASS } from '../../shared/components/icon-action/icon-action.component';
import { PlanStatusCardComponent } from '../../shared/components/plan-status-card/plan-status-card.component';
import { RitotechVisualGuideComponent } from '../public/ritotech-visual-guide.component';
import { riloBotManualLines, whatsappCopyForRubro } from '../../../../../shared/whatsapp-copy.ts';

type OnboardingItem = { id: string; label: string };

@Component({
  selector: 'app-home-redirect',
  standalone: true,
  template: '',
})
export class HomeRedirectComponent {
  constructor() {
    const auth = inject(AuthService);
    const router = inject(Router);
    void router.navigateByUrl(auth.homeRoute, { replaceUrl: true });
  }
}

@Component({
  selector: 'app-client-home',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    LucideAngularModule,
    PlanStatusCardComponent,
    RitotechVisualGuideComponent,
  ],
  template: `
    <div [class]="pageShellClass">
      <div class="w-full max-w-3xl mx-auto min-w-0 space-y-5">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
            Hola, {{ auth.currentUserName }}
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {{ subtitle }}
          </p>
        </div>

        <section
          *ngIf="usage && showBotQuota"
          class="rounded-2xl border border-teal-900/40 bg-gray-900 text-white shadow-sm p-4 sm:p-6 flex flex-col sm:flex-row items-center gap-5">
          <div class="relative h-28 w-28 shrink-0" aria-hidden="true">
            <svg viewBox="0 0 80 80" class="h-full w-full -rotate-90">
              <circle cx="40" cy="40" r="32" fill="none" class="stroke-gray-800" stroke-width="8" />
              <circle
                cx="40"
                cy="40"
                r="32"
                fill="none"
                class="stroke-teal-400"
                stroke-width="8"
                stroke-linecap="round"
                [attr.stroke-dasharray]="ringCircumference"
                [attr.stroke-dashoffset]="ringOffset" />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-lg font-bold tabular-nums text-white">{{ quotaPct }}%</span>
            </div>
          </div>
          <div class="min-w-0 flex-1 text-center sm:text-left">
            <p class="text-xs font-semibold uppercase tracking-wide text-teal-400">Este mes</p>
            <p class="text-base font-semibold text-white mt-0.5">
              Acciones por WhatsApp
            </p>
            <p *ngIf="usage.ai.unlimited" class="text-sm text-gray-300 mt-1">
              {{ usage.ai.used }} usadas · sin tope mensual
            </p>
            <p *ngIf="!usage.ai.unlimited" class="text-sm text-gray-300 mt-1">
              {{ usage.ai.used }} de {{ usage.ai.max }} · quedan {{ remaining }}
            </p>
            <p *ngIf="renewalLabel" class="text-xs text-gray-500 mt-1">{{ renewalLabel }}</p>
          </div>
        </section>

        <section
          *ngIf="usage && showBotQuota && last7Days.length"
          class="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 sm:p-5">
          <p class="text-xs font-semibold text-gray-800">Últimos 7 días</p>
          <p class="text-[11px] text-gray-500 mt-0.5">Acciones por WhatsApp (agregado diario)</p>
          <div class="mt-3 flex items-end gap-1.5 h-16">
            <div *ngFor="let day of last7Days" class="flex-1 flex flex-col items-center justify-end h-full gap-1">
              <div
                class="w-full rounded-sm bg-teal-600/80 min-h-[2px]"
                [style.height.%]="day.pct"
                [title]="day.date + ': ' + day.actions"></div>
              <span class="text-[9px] text-gray-400 leading-none">{{ day.label }}</span>
            </div>
          </div>
        </section>

        <section
          *ngIf="addons && auth.canAccessWhatsapp && auth.isSupervisor"
          class="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 sm:p-6 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-sm font-bold text-gray-900">WhatsApp</h2>
              <p class="text-xs text-gray-500 mt-0.5">RILO Bot · misma empresa, varios números</p>
            </div>
            <button
              type="button"
              (click)="addWhatsappNumber()"
              [disabled]="addingWa"
              class="text-sm font-semibold text-teal-700 hover:underline">
              + Agregar número
            </button>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p class="text-xs text-gray-500">Números incluidos</p>
              <p class="font-semibold">{{ addons.whatsapp.included }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Números adicionales</p>
              <p class="font-semibold">{{ addons.whatsapp.extraContracted }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Precio número adicional</p>
              <p class="font-semibold">{{ addons.currency }} {{ addons.whatsapp.extraUnit }} / mes</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Costo adicional</p>
              <p class="font-semibold">{{ addons.currency }} {{ addons.whatsapp.extraCost }} / mes</p>
            </div>
          </div>
          <div *ngFor="let line of addons.whatsapp.lines" class="rounded-lg border border-gray-100 px-3 py-2 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="font-medium text-gray-900">{{ line.phone || 'Sin número' }}</p>
                <p class="text-xs text-gray-500">
                  {{ line.kind === 'primary' ? 'Número principal' : 'Número adicional' }}
                  · {{ lineStatusLabel(line) }}
                  <span *ngIf="line.addedAt || line.createdAt"> · alta {{ (line.addedAt || line.createdAt) | date:'shortDate' }}</span>
                </p>
              </div>
              <div class="flex gap-2">
                <button
                  *ngIf="line.status === 'pending'"
                  type="button"
                  (click)="connectLine(line)"
                  class="text-xs font-semibold text-teal-700 hover:underline">
                  Conectar
                </button>
                <button
                  *ngIf="line.kind === 'primary'"
                  type="button"
                  (click)="startReplacePrimary()"
                  class="text-xs font-semibold text-gray-600 hover:underline">
                  Reemplazar principal
                </button>
                <button
                  *ngIf="line.kind !== 'primary' && line.status !== 'disconnected'"
                  type="button"
                  (click)="releaseLine(line)"
                  class="text-xs font-semibold text-red-700 hover:underline">
                  Liberar
                </button>
              </div>
            </div>
            <div *ngIf="pendingLineId === line.id" class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                [(ngModel)]="pendingPhone"
                name="pendingPhone"
                placeholder="+598 99 000 000"
                class="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              <input
                *ngIf="codeSent"
                [(ngModel)]="pendingCode"
                name="pendingCode"
                placeholder="Código"
                class="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
              <button
                type="button"
                (click)="submitPendingLine()"
                class="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white">
                {{ codeSent ? 'Verificar' : 'Enviar código' }}
              </button>
            </div>
            <div *ngIf="replacingPrimary && line.kind === 'primary'" class="mt-2 space-y-2">
              <p class="text-xs text-gray-500">Nuevo número principal. Recibís un código por WhatsApp. El historial se conserva.</p>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  [(ngModel)]="replacePhone"
                  name="replacePhone"
                  placeholder="+598 99 000 000"
                  class="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                <input
                  *ngIf="replaceCodeSent"
                  [(ngModel)]="replaceCode"
                  name="replaceCode"
                  placeholder="Código"
                  class="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                <button
                  type="button"
                  (click)="submitReplacePrimary()"
                  class="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white">
                  {{ replaceCodeSent ? 'Verificar' : 'Enviar código' }}
                </button>
              </div>
              <button type="button" class="text-xs text-gray-500 hover:underline" (click)="cancelReplacePrimary()">
                Cancelar
              </button>
            </div>
          </div>
        </section>

        <section
          *ngIf="addons && !auth.canAccessErpWeb && auth.isSupervisor"
          class="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 sm:p-6 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-sm font-bold text-gray-900">Usuarios</h2>
              <p class="text-xs text-gray-500 mt-0.5">Incluidos en el plan · extras al mismo total mensual</p>
            </div>
            <button
              type="button"
              (click)="showCreateUser = !showCreateUser"
              class="text-sm font-semibold text-teal-700 hover:underline">
              {{ showCreateUser ? 'Cancelar' : '+ Agregar usuario' }}
            </button>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p class="text-xs text-gray-500">Incluidos</p>
              <p class="font-semibold">{{ addons.erp.included }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Adicionales</p>
              <p class="font-semibold">{{ addons.erp.extraContracted }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Activos</p>
              <p class="font-semibold">{{ addons.erp.active }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Usuario adicional</p>
              <p class="font-semibold">{{ addons.currency }} {{ addons.erp.extraUnit }} / mes</p>
            </div>
          </div>
          <div *ngIf="showCreateUser" class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
            <input
              [(ngModel)]="newUser.nombre"
              name="newUserNombre"
              placeholder="Nombre *"
              class="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
            <input
              [(ngModel)]="newUser.email"
              name="newUserEmail"
              placeholder="Email"
              class="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
            <input
              [(ngModel)]="newUser.password"
              name="newUserPassword"
              type="password"
              placeholder="Contraseña"
              class="px-3 py-2 rounded-lg border border-gray-200 text-sm" />
            <button
              type="button"
              (click)="createExtraUser()"
              [disabled]="creatingUser"
              class="sm:col-span-3 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {{ creatingUser ? 'Creando…' : 'Crear usuario' }}
            </button>
          </div>
        </section>

        <section
          *ngIf="onboardingItems.length"
          class="rounded-2xl border border-gray-800 bg-gray-900 text-white shadow-sm p-4 sm:p-6">
          <h2 class="text-sm font-bold text-white">Primeros pasos</h2>
          <ul class="mt-3 space-y-2">
            <li *ngFor="let item of onboardingItems">
              <label class="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  class="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-950 text-teal-500 focus:ring-teal-500"
                  [checked]="isOnboardingDone(item.id)"
                  (change)="toggleOnboarding(item.id)" />
                <span
                  class="text-sm"
                  [class.text-gray-500]="isOnboardingDone(item.id)"
                  [class.line-through]="isOnboardingDone(item.id)"
                  [class.text-gray-200]="!isOnboardingDone(item.id)">
                  {{ item.label }}
                </span>
              </label>
            </li>
          </ul>
        </section>

        <section
          *ngIf="auth.canAccessWhatsapp"
          class="rounded-2xl border border-gray-800 bg-gray-900 text-white shadow-sm p-4 sm:p-6">
          <h2 class="text-sm font-bold text-white mb-1">Cómo usar RILO Bot</h2>
          <p class="text-sm text-gray-400 mb-3 leading-relaxed">
            Escribile como hablás. Tu agente con IA entiende lo que necesitás y trabaja sobre tu negocio. Solo guarda si respondés SÍ.
          </p>
          <ul class="space-y-1.5 text-sm text-gray-300 mb-4">
            <li *ngFor="let line of botManualLines">• {{ line }}</li>
          </ul>
          <app-ritotech-visual-guide
            triggerLabel="Cómo usarlo"
            defaultTab="whatsapp"
            [showSignupCta]="false">
          </app-ritotech-visual-guide>
        </section>

        <a
          *ngIf="auth.canAccessErpWeb"
          routerLink="/dashboard"
          class="flex items-center gap-3 bg-gray-900 text-white rounded-2xl border border-teal-900/50 px-5 py-4 hover:border-teal-700 transition-colors">
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/20 text-teal-300">
            <i-lucide name="layout-dashboard" class="w-5 h-5"></i-lucide>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-bold">Entrar a RILO Gestión</span>
            <span class="block text-xs text-gray-400 mt-0.5">Controlalo acá cuando querés ver todo</span>
          </span>
          <i-lucide name="chevron-right" class="w-5 h-5 text-gray-500"></i-lucide>
        </a>

        <a
          *ngIf="auth.isSupervisor && !auth.hasErpEntitlement"
          routerLink="/activar-suscripcion"
          [queryParams]="{ producto: 'erp' }"
          class="flex items-center gap-3 bg-gray-900 text-white rounded-2xl border border-teal-900/50 px-5 py-4 hover:border-teal-700 transition-colors">
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/20 text-teal-300">
            <i-lucide name="layout-dashboard" class="w-5 h-5"></i-lucide>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-bold">Agregar RILO Gestión</span>
            <span class="block text-xs text-gray-400 mt-0.5">Sumá el panel web a tu plan actual</span>
          </span>
          <i-lucide name="chevron-right" class="w-5 h-5 text-gray-500"></i-lucide>
        </a>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            *ngIf="auth.isSupervisor"
            routerLink="/plan"
            class="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:border-teal-700">
            Mi plan
          </a>
          <a
            *ngIf="auth.isSupervisor"
            routerLink="/activar-suscripcion"
            class="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:border-teal-700">
            Facturación
          </a>
          <a
            routerLink="/mi-cuenta"
            class="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:border-teal-700">
            Mi cuenta
          </a>
          <a
            *ngIf="auth.canAccessErpWeb && auth.canManageSettings"
            routerLink="/settings"
            class="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:border-teal-700">
            Usuarios
          </a>
        </div>

        <app-plan-status-card *ngIf="auth.isSupervisor" variant="home"></app-plan-status-card>
      </div>
    </div>
  `,
})
export class ClientHomeComponent implements OnInit {
  readonly auth = inject(AuthService);
  private router = inject(Router);
  private businessApi = inject(BusinessService);
  private addonsApi = inject(AddonsService);
  private usersApi = inject(UserService);
  private dialog = inject(DialogService);
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly ringCircumference = 2 * Math.PI * 32;

  usage: ClientUsageSummary | null = null;
  addons: AddonsSnapshot | null = null;
  doneIds = new Set<string>();
  addingWa = false;
  pendingLineId: string | null = null;
  pendingPhone = '';
  pendingCode = '';
  codeSent = false;
  replacingPrimary = false;
  replacePhone = '';
  replaceCode = '';
  replaceCodeSent = false;
  showCreateUser = false;
  creatingUser = false;
  newUser = { nombre: '', email: '', password: '' };

  ngOnInit() {
    console.info('[client-home:init]');
    this.loadOnboarding();
    queueMicrotask(() => this.loadHomeData());
  }

  private loadHomeData() {
    const businessId = this.auth.currentBusinessId;
    if (!businessId || this.auth.isPlatformAdmin) return;
    this.businessApi.getUsage(businessId).subscribe({
      next: (usage) => {
        this.usage = usage;
      },
    });
    if (this.auth.isSupervisor) {
      this.loadAddons();
    }
  }

  private loadAddons() {
    this.addonsApi.getSnapshot().subscribe({
      next: (row) => {
        this.addons = row;
      },
    });
  }

  createExtraUser() {
    const nombre = this.newUser.nombre.trim();
    if (!nombre) {
      this.dialog.alert({ title: 'Campo requerido', message: 'Ingresá el nombre.' });
      return;
    }
    const payload: CreateUserPayload = {
      nombre,
      email: this.newUser.email.trim().toLowerCase(),
      loginUsername: (this.newUser.email || this.newUser.nombre).trim().toLowerCase(),
      rol: 'staff',
      permisos: [...DEFAULT_STAFF_PERMISSIONS],
      activo: true,
      password: this.newUser.password.trim() || undefined,
    };
    this.creatingUser = true;
    this.usersApi.createUser(payload).subscribe({
      next: () => {
        this.creatingUser = false;
        this.showCreateUser = false;
        this.newUser = { nombre: '', email: '', password: '' };
        this.loadAddons();
      },
      error: (err) => {
        this.creatingUser = false;
        if (err?.error?.code === 'BILLING_CONFIRMATION_REQUIRED' && err?.error?.quote) {
          const quote = err.error.quote;
          this.dialog
            .confirm({
              title: 'Confirmar y agregar',
              message:
                `Costo: +${quote.extraUnit} / mes\n` +
                `Total anterior: ${quote.oldTotal}\n` +
                `Nuevo total mensual: ${quote.newTotal}\n` +
                `Se aplica: ${quote.appliedAt || 'próxima renovación'}\n\n` +
                (quote.policyCopy || 'Se suma a tu próxima renovación.'),
              confirmLabel: 'Confirmar y agregar',
            })
            .subscribe((ok) => {
              if (!ok) return;
              this.creatingUser = true;
              this.usersApi.createUser({ ...payload, confirmBilling: true }).subscribe({
                next: () => {
                  this.creatingUser = false;
                  this.showCreateUser = false;
                  this.newUser = { nombre: '', email: '', password: '' };
                  this.loadAddons();
                },
                error: (retryErr) => {
                  this.creatingUser = false;
                  this.dialog.alert({
                    title: 'Error',
                    message: retryErr?.error?.error || 'No se pudo crear el usuario.',
                  });
                },
              });
            });
          return;
        }
        this.dialog.alert({
          title: 'Error',
          message: err?.error?.error || 'No se pudo crear el usuario.',
        });
      },
    });
  }

  lineStatusLabel(line: ClientWhatsappLine): string {
    if (line.status === 'pending') return 'pendiente';
    if (line.status === 'disconnected' || !line.enabled) return 'desconectado';
    return 'activo';
  }

  addWhatsappNumber() {
    this.addingWa = true;
    this.addonsApi.quoteWhatsapp().subscribe({
      next: (quote) => {
        this.dialog
          .confirm({
            title: 'Número adicional RILO Bot',
            message:
              `Total actual: ${quote.oldTotal}\n` +
              `Adicional: +${quote.extraUnit} / mes\n` +
              `Nuevo total mensual: ${quote.newTotal}\n` +
              `Se aplica: ${quote.appliedAt || 'próxima renovación'}\n\n` +
              (quote.policyCopy || 'Se suma a tu próxima renovación.'),
            confirmLabel: 'Agregar número',
          })
          .subscribe((ok) => {
            this.addingWa = false;
            if (!ok) return;
            this.addonsApi.addWhatsappNumber(true).subscribe({
              next: (res) => {
                this.pendingLineId = res.line.id;
                this.pendingPhone = '';
                this.pendingCode = '';
                this.codeSent = false;
                this.loadAddons();
              },
              error: (err) => {
                this.dialog.alert({
                  title: 'Error',
                  message: err?.error?.error || 'No se pudo agregar el número.',
                });
              },
            });
          });
      },
      error: () => {
        this.addingWa = false;
      },
    });
  }

  connectLine(line: ClientWhatsappLine) {
    this.pendingLineId = line.id;
    this.pendingPhone = line.phone || '';
    this.pendingCode = '';
    this.codeSent = false;
  }

  submitPendingLine() {
    if (!this.pendingLineId || !this.pendingPhone.trim()) return;
    if (!this.codeSent) {
      this.addonsApi.sendWhatsappCode(this.pendingLineId, this.pendingPhone).subscribe({
        next: () => {
          this.codeSent = true;
        },
        error: (err) => {
          this.dialog.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo enviar el código.',
          });
        },
      });
      return;
    }
    this.addonsApi.verifyWhatsapp(this.pendingLineId, this.pendingPhone, this.pendingCode).subscribe({
      next: () => {
        this.pendingLineId = null;
        this.codeSent = false;
        this.loadAddons();
      },
      error: (err) => {
        this.dialog.alert({
          title: 'Error',
          message: err?.error?.error || 'No se pudo verificar el número.',
        });
      },
    });
  }

  releaseLine(line: ClientWhatsappLine) {
    this.dialog
      .confirm({
        title: 'Liberar número',
        message: 'Se desactiva este número. El historial de la empresa se conserva.',
        confirmLabel: 'Liberar',
        variant: 'danger',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.addonsApi.releaseWhatsapp(line.id).subscribe({
          next: () => this.loadAddons(),
          error: (err) => {
            this.dialog.alert({
              title: 'Error',
              message: err?.error?.error || 'No se pudo liberar el número.',
            });
          },
        });
      });
  }

  replacePrimary() {
    this.startReplacePrimary();
  }

  startReplacePrimary() {
    this.replacingPrimary = true;
    this.replacePhone = '';
    this.replaceCode = '';
    this.replaceCodeSent = false;
  }

  cancelReplacePrimary() {
    this.replacingPrimary = false;
    this.replacePhone = '';
    this.replaceCode = '';
    this.replaceCodeSent = false;
  }

  submitReplacePrimary() {
    const phone = this.replacePhone.trim();
    if (!phone) return;
    if (!this.replaceCodeSent) {
      this.addonsApi.replacePrimary(phone).subscribe({
        next: (res) => {
          this.replaceCodeSent = true;
          if (res.devCode) this.replaceCode = res.devCode;
        },
        error: (err) => {
          this.dialog.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo iniciar el reemplazo.',
          });
        },
      });
      return;
    }
    this.addonsApi.replacePrimary(phone, this.replaceCode).subscribe({
      next: () => {
        this.cancelReplacePrimary();
        this.loadAddons();
      },
      error: (err) => {
        this.dialog.alert({
          title: 'Error',
          message: err?.error?.error || 'No se pudo reemplazar el número.',
        });
      },
    });
  }

  get last7Days(): { date: string; actions: number; pct: number; label: string }[] {
    const rows = (this.usage?.dailyUsage ?? []).slice(-7);
    const max = Math.max(1, ...rows.map((row) => row.actions || 0));
    return rows.map((row) => ({
      date: row.date,
      actions: row.actions || 0,
      pct: Math.max(8, Math.round(((row.actions || 0) / max) * 100)),
      label: row.date.slice(8),
    }));
  }

  get subtitle(): string {
    if (this.auth.canAccessWhatsapp && this.auth.canAccessErpWeb) {
      return 'Cargás por WhatsApp o en el panel. Es la misma información.';
    }
    if (this.auth.canAccessWhatsapp) {
      return 'El trabajo del día a día es por WhatsApp. Acá ves tu cupo y cómo usarlo.';
    }
    return 'Resumen de tu cuenta.';
  }

  get showBotQuota(): boolean {
    return this.auth.canAccessWhatsapp === true;
  }

  get quotaPct(): number {
    if (!this.usage || this.usage.ai.unlimited || !this.usage.ai.max) return 0;
    return Math.min(100, Math.round((Math.max(0, this.usage.ai.used) / this.usage.ai.max) * 100));
  }

  get ringOffset(): number {
    return this.ringCircumference * (1 - this.quotaPct / 100);
  }

  get remaining(): number {
    if (!this.usage || this.usage.ai.unlimited) return 0;
    return Math.max(0, this.usage.ai.max - this.usage.ai.used);
  }

  get renewalLabel(): string {
    const period = this.usage?.period;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) return '';
    const [year, month] = period.split('-').map(Number);
    const next = new Date(year, month, 1);
    const when = next.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
    return `Se renueva el ${when}`;
  }

  get botCopy() {
    return whatsappCopyForRubro(this.auth.currentBusiness?.lifecycle?.rubro);
  }

  get botManualLines(): string[] {
    return riloBotManualLines(this.botCopy);
  }

  get onboardingItems(): OnboardingItem[] {
    const items: OnboardingItem[] = [];
    if (this.auth.canAccessWhatsapp) {
      items.push({ id: 'write-bot', label: 'Escribí al número de RILO Bot con el WhatsApp que registraste' });
      items.push({ id: 'confirm-si', label: 'Confirmá con SÍ antes de guardar una operación' });
      items.push({ id: 'see-quota', label: 'Revisá tu cupo de acciones por WhatsApp de este mes' });
    }
    if (this.auth.canAccessErpWeb) {
      items.push({ id: 'open-erp', label: 'Entrá a RILO Gestión para ver pedidos, stock y caja' });
    }
    return items;
  }

  isOnboardingDone(id: string): boolean {
    return this.doneIds.has(id);
  }

  toggleOnboarding(id: string) {
    if (this.doneIds.has(id)) this.doneIds.delete(id);
    else this.doneIds.add(id);
    this.doneIds = new Set(this.doneIds);
    this.saveOnboarding();
  }

  private storageKey(): string {
    return `rilo-onboarding-v1-${this.auth.currentBusinessId || 'anon'}`;
  }

  private loadOnboarding() {
    try {
      const raw = localStorage.getItem(this.storageKey());
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      this.doneIds = new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      this.doneIds = new Set();
    }
  }

  private saveOnboarding() {
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify([...this.doneIds]));
    } catch {
      /* ignore quota / private mode */
    }
  }
}
