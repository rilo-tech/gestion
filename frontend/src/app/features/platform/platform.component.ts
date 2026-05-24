import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PlatformService,
  SubscriptionStatus,
} from '../../core/services/platform.service';
import {
  PublicBusinessInfo,
  PublicPlanInfo,
  SUBSCRIPTION_STATUS_LABELS,
} from '../../core/services/business.service';
import { DialogService } from '../../core/services/dialog.service';

type PlatformTab = 'empresas' | 'planes';

@Component({
  selector: 'app-platform',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Administración de plataforma</h1>
        <p class="text-sm text-gray-500 mt-1">
          Gestioná empresas, suscripciones y planes desde un solo lugar.
        </p>
      </div>

      <div class="flex gap-2 border-b border-gray-200">
        <button
          type="button"
          (click)="activeTab = 'empresas'"
          class="px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors"
          [class.border-teal-600]="activeTab === 'empresas'"
          [class.text-teal-700]="activeTab === 'empresas'"
          [class.border-transparent]="activeTab !== 'empresas'"
          [class.text-gray-500]="activeTab !== 'empresas'">
          Empresas
        </button>
        <button
          type="button"
          (click)="activeTab = 'planes'"
          class="px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors"
          [class.border-teal-600]="activeTab === 'planes'"
          [class.text-teal-700]="activeTab === 'planes'"
          [class.border-transparent]="activeTab !== 'planes'"
          [class.text-gray-500]="activeTab !== 'planes'">
          Planes
        </button>
      </div>

      <!-- EMPRESAS -->
      <section *ngIf="activeTab === 'empresas'" class="space-y-6">
        <article class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6">
          <h2 class="text-lg font-bold text-gray-900 mb-4">Nueva empresa / suscripción</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input [(ngModel)]="businessDraft.id" placeholder="Código empresa * (ej: rilo, fs)"
                     class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
            <input [(ngModel)]="businessDraft.nombre" placeholder="Nombre comercial *"
                     class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
            <select [(ngModel)]="businessDraft.planId"
                    class="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm md:col-span-2">
              <option *ngFor="let plan of plans" [value]="plan.id">{{ plan.nombre }}</option>
            </select>
            <input [(ngModel)]="businessDraft.supervisorNombre" placeholder="Nombre admin *"
                     class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
            <input [(ngModel)]="businessDraft.supervisorEmail" placeholder="Email admin (para Google)"
                     class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
            <input [(ngModel)]="businessDraft.supervisorLogin" placeholder="Usuario admin *"
                     class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
            <input [(ngModel)]="businessDraft.supervisorPassword" type="password"
                     placeholder="Contraseña inicial"
                     class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
          </div>
          <button type="button" (click)="createBusiness()" [disabled]="creatingBusiness"
                  class="mt-4 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
            {{ creatingBusiness ? 'Creando...' : 'Crear empresa y admin' }}
          </button>
        </article>

        <div *ngIf="loadingBusinesses" class="text-sm text-gray-400 py-8 text-center">Cargando empresas...</div>

        <div class="space-y-4">
          <article *ngFor="let business of businesses"
                   class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6">
            <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div>
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="font-bold text-gray-900">{{ business.nombre }}</h3>
                  <span class="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded">{{ business.id }}</span>
                </div>
                <p class="text-sm text-gray-500 mt-1">
                  Plan: {{ business.plan.nombre }} ·
                  Admins {{ business.administradoresActivos }}/{{ business.plan.limiteAdministradores }} ·
                  Ops {{ business.operadoresActivos }}/{{ business.plan.limiteOperadores }}
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <select [(ngModel)]="business.planId" [name]="'plan' + business.id"
                        class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                  <option *ngFor="let plan of plans" [value]="plan.id">{{ plan.nombre }}</option>
                </select>
                <select [(ngModel)]="business.estadoSuscripcion" [name]="'status' + business.id"
                        class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm">
                  <option value="activa">Activa</option>
                  <option value="suspendida">Suspendida</option>
                  <option value="vencida">Vencida</option>
                </select>
                <button type="button" (click)="saveBusiness(business)" [disabled]="savingBusinessId === business.id"
                        class="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
                  {{ savingBusinessId === business.id ? 'Guardando...' : 'Guardar' }}
                </button>
              </div>
            </div>
          </article>
        </div>
      </section>

      <!-- PLANES -->
      <section *ngIf="activeTab === 'planes'" class="space-y-6">
        <article class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6">
          <h2 class="text-lg font-bold text-gray-900 mb-4">Nuevo plan</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input [(ngModel)]="planDraft.id" placeholder="Id plan * (ej: plan_basico)"
                     class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
            <input [(ngModel)]="planDraft.nombre" placeholder="Nombre *"
                     class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
            <input [(ngModel)]="planDraft.limiteAdministradores" type="number" min="1"
                     placeholder="Límite administradores"
                     class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
            <input [(ngModel)]="planDraft.limiteOperadores" type="number" min="0"
                     placeholder="Límite operadores"
                     class="px-4 py-2 rounded-lg border border-gray-200 text-sm">
            <input [(ngModel)]="planDraft.limiteUsuariosTotal" type="number" min="1"
                     placeholder="Límite total (opcional)"
                     class="px-4 py-2 rounded-lg border border-gray-200 text-sm md:col-span-2">
          </div>
          <button type="button" (click)="createPlan()" [disabled]="creatingPlan"
                  class="mt-4 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
            {{ creatingPlan ? 'Creando...' : 'Crear plan' }}
          </button>
        </article>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <article *ngFor="let plan of plans"
                   class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-6">
            <div class="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 class="font-bold text-gray-900">{{ plan.nombre }}</h3>
                <p class="text-xs font-mono text-gray-400">{{ plan.id }}</p>
              </div>
              <label class="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" [(ngModel)]="plan.activo" [name]="'activo' + plan.id"
                       class="rounded border-gray-300 text-teal-600">
                Activo
              </label>
            </div>
            <div class="grid grid-cols-3 gap-2 text-sm mb-4">
              <div><span class="text-gray-500">Admins</span><p class="font-semibold">{{ plan.limiteAdministradores }}</p></div>
              <div><span class="text-gray-500">Ops</span><p class="font-semibold">{{ plan.limiteOperadores }}</p></div>
              <div><span class="text-gray-500">Total</span><p class="font-semibold">{{ plan.limiteUsuariosTotal }}</p></div>
            </div>
            <button type="button" (click)="savePlan(plan)" [disabled]="savingPlanId === plan.id"
                    class="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
              {{ savingPlanId === plan.id ? 'Guardando...' : 'Guardar plan' }}
            </button>
          </article>
        </div>
      </section>
    </div>
  `,
})
export class PlatformComponent implements OnInit {
  private platformService = inject(PlatformService);
  private dialogService = inject(DialogService);

  readonly statusLabels = SUBSCRIPTION_STATUS_LABELS;

  activeTab: PlatformTab = 'empresas';
  businesses: (PublicBusinessInfo & { planId?: string })[] = [];
  plans: PublicPlanInfo[] = [];
  loadingBusinesses = false;
  creatingBusiness = false;
  creatingPlan = false;
  savingBusinessId: string | null = null;
  savingPlanId: string | null = null;

  businessDraft = {
    id: '',
    nombre: '',
    planId: 'plan_basico',
    supervisorNombre: '',
    supervisorEmail: '',
    supervisorLogin: '',
    supervisorPassword: '',
  };

  planDraft = {
    id: '',
    nombre: '',
    limiteAdministradores: 1,
    limiteOperadores: 2,
    limiteUsuariosTotal: 3,
  };

  ngOnInit() {
    this.loadPlans();
    this.loadBusinesses();
  }

  createBusiness() {
    const id = this.businessDraft.id.trim().toLowerCase();
    const nombre = this.businessDraft.nombre.trim();
    const supervisorLogin = (
      this.businessDraft.supervisorLogin ||
      this.businessDraft.supervisorEmail ||
      this.businessDraft.supervisorNombre
    )
      .trim()
      .toLowerCase();

    if (!id || !nombre || !this.businessDraft.supervisorNombre.trim() || !supervisorLogin) {
      this.dialogService.alert({
        title: 'Campos requeridos',
        message: 'Completá código, nombre, admin y usuario de acceso.',
      });
      return;
    }

    this.creatingBusiness = true;
    this.platformService
      .createBusiness({
        id,
        nombre,
        planId: this.businessDraft.planId,
        supervisor: {
          nombre: this.businessDraft.supervisorNombre.trim(),
          email: this.businessDraft.supervisorEmail.trim().toLowerCase(),
          loginUsername: supervisorLogin,
          password: this.businessDraft.supervisorPassword.trim() || undefined,
        },
      })
      .subscribe({
        next: () => {
          this.creatingBusiness = false;
          this.businessDraft = {
            id: '',
            nombre: '',
            planId: this.plans[0]?.id ?? 'plan_basico',
            supervisorNombre: '',
            supervisorEmail: '',
            supervisorLogin: '',
            supervisorPassword: '',
          };
          this.loadBusinesses();
        },
        error: (err) => {
          this.creatingBusiness = false;
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo crear la empresa.',
          });
        },
      });
  }

  saveBusiness(business: PublicBusinessInfo & { planId?: string }) {
    this.savingBusinessId = business.id;
    this.platformService
      .updateBusiness(business.id, {
        planId: business.planId ?? business.plan.id,
        estadoSuscripcion: business.estadoSuscripcion as SubscriptionStatus,
      })
      .subscribe({
        next: () => {
          this.savingBusinessId = null;
          this.loadBusinesses();
        },
        error: (err) => {
          this.savingBusinessId = null;
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo actualizar la empresa.',
          });
        },
      });
  }

  createPlan() {
    const id = this.planDraft.id.trim();
    const nombre = this.planDraft.nombre.trim();
    if (!id || !nombre) {
      this.dialogService.alert({ title: 'Campos requeridos', message: 'Id y nombre son obligatorios.' });
      return;
    }

    this.creatingPlan = true;
    this.platformService
      .createPlan({
        id,
        nombre,
        limiteAdministradores: Number(this.planDraft.limiteAdministradores),
        limiteOperadores: Number(this.planDraft.limiteOperadores),
        limiteUsuariosTotal: Number(this.planDraft.limiteUsuariosTotal) || undefined,
        activo: true,
      })
      .subscribe({
        next: () => {
          this.creatingPlan = false;
          this.planDraft = {
            id: '',
            nombre: '',
            limiteAdministradores: 1,
            limiteOperadores: 2,
            limiteUsuariosTotal: 3,
          };
          this.loadPlans();
        },
        error: (err) => {
          this.creatingPlan = false;
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo crear el plan.',
          });
        },
      });
  }

  savePlan(plan: PublicPlanInfo) {
    this.savingPlanId = plan.id;
    this.platformService
      .updatePlan(plan.id, {
        nombre: plan.nombre,
        limiteAdministradores: plan.limiteAdministradores,
        limiteOperadores: plan.limiteOperadores,
        limiteUsuariosTotal: plan.limiteUsuariosTotal,
        activo: plan.activo,
      })
      .subscribe({
        next: () => {
          this.savingPlanId = null;
          this.loadPlans();
        },
        error: (err) => {
          this.savingPlanId = null;
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo actualizar el plan.',
          });
        },
      });
  }

  private loadBusinesses() {
    this.loadingBusinesses = true;
    this.platformService.getBusinesses().subscribe({
      next: (businesses) => {
        this.businesses = businesses.map((business) => ({
          ...business,
          planId: business.planId,
        }));
        this.loadingBusinesses = false;
      },
      error: () => {
        this.loadingBusinesses = false;
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar las empresas.',
        });
      },
    });
  }

  private loadPlans() {
    this.platformService.getPlans().subscribe({
      next: (plans) => {
        this.plans = plans;
        if (!this.businessDraft.planId && plans.length) {
          this.businessDraft.planId = plans[0].id;
        }
      },
      error: () => {
        this.dialogService.alert({
          title: 'Error',
          message: 'No se pudieron cargar los planes.',
        });
      },
    });
  }
}
