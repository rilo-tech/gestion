import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import {
  PlatformService,
  SubscriptionStatus,
  type BillingCatalogProduct,
  type PlatformWhatsappUser,
  type SubscriptionHistoryEntry,
} from '../../core/services/platform.service';
import {
  PublicBusinessInfo,
  PublicPlanInfo,
  SubscriptionPayment,
  SUBSCRIPTION_PAYMENT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
} from '../../core/services/business.service';
import { DialogService } from '../../core/services/dialog.service';
import { FormScreenHeaderComponent } from '../../shared/components/form-shell/form-screen-header.component';
import {
  PlatformSubscriptionEditorComponent,
  businessSubscriptionDraftFromPublic,
  emptyBusinessSubscriptionDraft,
  subscriptionDraftToPayload,
  type BusinessSubscriptionDraft,
} from './platform-subscription-editor.component';
import {
  DEFAULT_TRIAL_DAYS,
  TRIAL_STATUS_LABELS,
  type TrialStatus,
} from '../../../../../shared/trial-state.ts';
import {
  normalizePlatformAccess,
  platformAccessForTrialProduct,
  TRIAL_PRODUCT_IDS,
  TRIAL_PRODUCT_LABELS,
  type ClientPlatformAccess,
  type TrialProductId,
} from '../../../../../shared/platform-access.ts';
import {
  DEFAULT_EXTRA_USER_MONTHLY,
  getBillingProduct,
} from '../../../../../shared/billing-catalog.ts';

@Component({
  selector: 'app-platform-business-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    RouterLink,
    FormScreenHeaderComponent,
    PlatformSubscriptionEditorComponent,
  ],
  template: `
    <div class="min-h-full flex flex-col bg-gray-50">
      <div
        class="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8 py-3">
        <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <app-form-screen-header
            class="flex-1 min-w-0"
            [title]="business?.nombre ?? 'Empresa'"
            [subtitle]="business ? 'Código ' + business.id + ' · ' + productLabel(selectedProductId) : ''"
            backRouterLink="/platform"
            backLabel="Volver a empresas"
            [hideSubtitleOnMobile]="false">
          </app-form-screen-header>
          <button
            *ngIf="business"
            type="button"
            (click)="save()"
            [disabled]="saving"
            class="shrink-0 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
            {{ saving ? 'Guardando...' : 'Guardar cambios' }}
          </button>
        </div>
      </div>

      <div *ngIf="loading" class="flex-1 flex items-center justify-center text-gray-400 py-24">
        Cargando empresa...
      </div>

      <div *ngIf="!loading && !business" class="flex-1 flex flex-col items-center justify-center gap-3 py-24">
        <p class="text-gray-500">Empresa no encontrada.</p>
        <a routerLink="/platform" class="text-teal-700 font-semibold hover:underline">Volver al listado</a>
      </div>

      <div *ngIf="business" class="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Cuota mensual</p>
            <p class="text-xl font-bold text-gray-900 tabular-nums mt-1">{{ formatMoney(business.montoMensualEsperado) }}</p>
            <div *ngIf="business.cuotaDesglose?.lineas?.length" class="mt-3 space-y-1 border-t border-gray-100 pt-2">
              <div
                *ngFor="let line of business.cuotaDesglose!.lineas"
                class="flex justify-between gap-2 text-[11px] text-gray-600">
                <span class="min-w-0 truncate">
                  {{ line.concepto }}
                  <span *ngIf="line.cantidad && line.cantidad > 1">×{{ line.cantidad }}</span>
                </span>
                <span class="shrink-0 tabular-nums font-medium text-gray-800">{{ formatMoney(line.monto) }}</span>
              </div>
              <div
                *ngIf="(business.cuotaDesglose?.descuento ?? 0) > 0"
                class="flex justify-between gap-2 text-[11px] text-emerald-700">
                <span>Descuento</span>
                <span class="tabular-nums">-{{ formatMoney(business.cuotaDesglose!.descuento) }}</span>
              </div>
            </div>
          </div>
          <div class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Estado cobro</p>
            <span class="inline-flex mt-2 px-2.5 py-1 rounded-full text-xs font-semibold" [ngClass]="billingStatusClass">
              {{ billingStatusLabel }}
            </span>
            <p class="text-xs text-gray-400 mt-1">{{ formatPeriodo(business.periodoPagoActual) }}</p>
          </div>
          <div class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Usuarios</p>
            <p class="text-sm font-semibold text-gray-900 mt-2">
              Admins {{ business.administradoresActivos }}/{{ business.limitesEfectivos?.limiteAdministradores ?? business.plan.limiteAdministradores }}
            </p>
            <p class="text-sm text-gray-600">
              Ops {{ business.operadoresActivos }}/{{ business.limitesEfectivos?.limiteOperadores ?? business.plan.limiteOperadores }}
            </p>
          </div>
          <div class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Suscripción</p>
            <span class="inline-flex mt-2 px-2.5 py-1 rounded-full text-xs font-semibold" [ngClass]="subscriptionStatusClass">
              {{ statusLabels[business.estadoSuscripcion] }}
            </span>
          </div>
        </div>

        <div class="flex flex-wrap gap-2 border-b border-gray-200 pb-1">
          <button
            type="button"
            *ngFor="let tab of detailTabs"
            (click)="detailTab = tab.id"
            class="rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
            [class.bg-teal-600]="detailTab === tab.id"
            [class.text-white]="detailTab === tab.id"
            [class.text-gray-600]="detailTab !== tab.id"
            [class.hover:bg-gray-100]="detailTab !== tab.id">
            {{ tab.label }}
          </button>
        </div>

        <div *ngIf="detailTab === 'resumen'" class="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          <section class="xl:col-span-2 rounded-xl border border-sky-200 bg-sky-50 p-5 shadow-sm space-y-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold text-sky-950">Contacto del responsable</h2>
                <p class="text-xs text-sky-800 mt-1">
                  Completá estos datos si la empresa no se registró por la landing.
                </p>
              </div>
              <button
                type="button"
                (click)="saveContact()"
                [disabled]="savingContact"
                class="rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60">
                {{ savingContact ? 'Guardando...' : 'Guardar contacto' }}
              </button>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-sky-900 mb-1">Responsable</label>
                <input
                  [(ngModel)]="contactDraft.ownerName"
                  name="contactOwner"
                  class="w-full px-3 py-2 rounded-lg border border-sky-200 bg-white text-sm"
                  placeholder="Nombre y apellido">
              </div>
              <div>
                <label class="block text-xs font-medium text-sky-900 mb-1">Email</label>
                <input
                  [(ngModel)]="contactDraft.email"
                  name="contactEmail"
                  type="email"
                  class="w-full px-3 py-2 rounded-lg border border-sky-200 bg-white text-sm"
                  placeholder="correo@empresa.com">
                <p *ngIf="emailVerified" class="mt-1 text-[11px] text-green-700">Email verificado</p>
              </div>
              <div>
                <label class="block text-xs font-medium text-sky-900 mb-1">Teléfono / WhatsApp</label>
                <input
                  [(ngModel)]="contactDraft.phone"
                  name="contactPhone"
                  class="w-full px-3 py-2 rounded-lg border border-sky-200 bg-white text-sm"
                  placeholder="+59899123456">
              </div>
              <div>
                <label class="block text-xs font-medium text-sky-900 mb-1">País</label>
                <input
                  [(ngModel)]="contactDraft.pais"
                  name="contactPais"
                  class="w-full px-3 py-2 rounded-lg border border-sky-200 bg-white text-sm"
                  placeholder="Uruguay">
              </div>
              <div>
                <label class="block text-xs font-medium text-sky-900 mb-1">Ciudad</label>
                <input
                  [(ngModel)]="contactDraft.ciudad"
                  name="contactCiudad"
                  class="w-full px-3 py-2 rounded-lg border border-sky-200 bg-white text-sm"
                  placeholder="Montevideo">
              </div>
              <div class="flex items-end">
                <label class="inline-flex items-center gap-2 cursor-pointer pb-2">
                  <input
                    type="checkbox"
                    [(ngModel)]="contactDraft.whatsappOptIn"
                    name="contactWa"
                    class="h-4 w-4 rounded border-sky-300 text-sky-700">
                  <span class="text-sm text-sky-900">Ayuda por WhatsApp</span>
                </label>
              </div>
            </div>
            <div class="flex flex-wrap gap-3" *ngIf="contactDraft.email || contactDraft.phone">
              <button
                *ngIf="contactDraft.email"
                type="button"
                (click)="releaseContact('email', contactDraft.email)"
                [disabled]="releasingContact === 'email'"
                class="text-xs font-semibold text-amber-800 hover:underline disabled:opacity-60">
                {{ releasingContact === 'email' ? 'Liberando...' : 'Liberar email (landing)' }}
              </button>
              <button
                *ngIf="contactDraft.phone"
                type="button"
                (click)="releaseContact('phone', contactDraft.phone)"
                [disabled]="releasingContact === 'phone'"
                class="text-xs font-semibold text-amber-800 hover:underline disabled:opacity-60">
                {{ releasingContact === 'phone' ? 'Liberando...' : 'Liberar teléfono (landing)' }}
              </button>
            </div>
            <p class="text-xs text-sky-800/80">
              Si el producto es RiloBot o Completo, al guardar un teléfono se habilita WhatsApp con ese número.
              Liberar email o teléfono permite reutilizarlo en /probar-gratis
              (si la suscripción está activa, primero desactivála en Producto).
            </p>
          </section>

          <section class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm space-y-3">
            <h2 class="text-base font-semibold text-gray-900">Actividad</h2>
            <p class="text-sm text-gray-600">Último ingreso: <span class="font-medium text-gray-900">{{ formatDateTime(lastLoginAt) }}</span></p>
            <p class="text-sm text-gray-600">Origen: <span class="font-medium text-gray-900">{{ sourceLabel }}</span></p>
            <div class="grid grid-cols-2 gap-2 text-center text-xs">
              <div class="rounded-lg bg-gray-50 py-2"><span class="block font-bold text-gray-900">{{ usage.ordersCount }}</span>Pedidos</div>
              <div class="rounded-lg bg-gray-50 py-2"><span class="block font-bold text-gray-900">{{ usage.salesCount }}</span>Ventas</div>
              <div class="rounded-lg bg-gray-50 py-2"><span class="block font-bold text-gray-900">{{ usage.productsCount }}</span>Productos</div>
              <div class="rounded-lg bg-gray-50 py-2"><span class="block font-bold text-gray-900">{{ usage.cashMovementsCount }}</span>Caja</div>
            </div>
          </section>
        </div>

        <div *ngIf="detailTab === 'usuarios'" class="space-y-6 max-w-3xl">
          <section class="rounded-xl border border-teal-100 bg-white p-5 shadow-sm space-y-4">
            <div>
              <h2 class="text-base font-semibold text-gray-900">Usuarios del ERP</h2>
              <p class="text-sm text-gray-500 mt-1">
                Alta y baja de administradores y operadores. La baja desactiva el acceso sin borrar el historial.
              </p>
            </div>

            <div *ngIf="loadingErpUsers" class="text-sm text-gray-400 py-4">Cargando usuarios...</div>

            <div *ngIf="!loadingErpUsers" class="space-y-2">
              <article
                *ngFor="let user of erpUsers"
                class="rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="font-semibold text-gray-900">{{ user.nombre }}</p>
                    <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white border border-gray-200 text-gray-700">
                      {{ erpRoleLabels[$any(user.rol)] || user.rol }}
                    </span>
                    <span
                      class="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                      [class.bg-green-100]="user.activo !== false"
                      [class.text-green-800]="user.activo !== false"
                      [class.bg-gray-200]="user.activo === false"
                      [class.text-gray-600]="user.activo === false">
                      {{ user.activo !== false ? 'Activo' : 'Baja' }}
                    </span>
                  </div>
                  <p class="text-xs text-gray-500 mt-1 truncate">
                    {{ user.email || 'Sin email' }}
                    <span *ngIf="user.loginUsername"> · {{ user.loginUsername }}</span>
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    (click)="toggleErpUserActive(user)"
                    [disabled]="savingErpUser"
                    class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                    {{ user.activo !== false ? 'Dar de baja' : 'Reactivar' }}
                  </button>
                  <button
                    type="button"
                    (click)="deleteErpUser(user)"
                    [disabled]="savingErpUser"
                    class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                    Eliminar
                  </button>
                </div>
              </article>
              <p *ngIf="!erpUsers.length" class="text-sm text-gray-500 py-2">Todavía no hay usuarios en esta empresa.</p>
            </div>
          </section>

          <section class="rounded-xl border border-teal-100 bg-teal-50/50 p-5 shadow-sm space-y-4">
            <h3 class="text-sm font-semibold text-teal-950">Crear usuario</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label class="block sm:col-span-2">
                <span class="block text-xs font-medium text-teal-900 mb-1">Nombre</span>
                <input
                  type="text"
                  [(ngModel)]="erpUserDraft.nombre"
                  name="erpUserNombre"
                  class="w-full rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm" />
              </label>
              <label class="block">
                <span class="block text-xs font-medium text-teal-900 mb-1">Email</span>
                <input
                  type="email"
                  [(ngModel)]="erpUserDraft.email"
                  name="erpUserEmail"
                  class="w-full rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm" />
              </label>
              <label class="block">
                <span class="block text-xs font-medium text-teal-900 mb-1">Usuario de acceso</span>
                <input
                  type="text"
                  [(ngModel)]="erpUserDraft.loginUsername"
                  name="erpUserLogin"
                  class="w-full rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm" />
              </label>
              <label class="block">
                <span class="block text-xs font-medium text-teal-900 mb-1">Contraseña</span>
                <input
                  type="password"
                  [(ngModel)]="erpUserDraft.password"
                  name="erpUserPassword"
                  class="w-full rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm" />
              </label>
              <label class="block">
                <span class="block text-xs font-medium text-teal-900 mb-1">Rol</span>
                <select
                  [(ngModel)]="erpUserDraft.rol"
                  name="erpUserRol"
                  class="w-full rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm">
                  <option value="supervisor">Administrador principal</option>
                  <option value="admin">Administrador delegado</option>
                  <option value="staff">Operador</option>
                </select>
              </label>
            </div>
            <button
              type="button"
              (click)="createErpUser()"
              [disabled]="savingErpUser"
              class="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60">
              {{ savingErpUser ? 'Creando...' : 'Crear usuario' }}
            </button>
          </section>
        </div>

        <div *ngIf="detailTab === 'plan'" class="space-y-6 max-w-4xl">
          <section class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm space-y-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold text-gray-900">Producto</h2>
                <p class="text-sm text-gray-500 mt-1">
                  El mismo de la landing: Bot, Panel o ambos. Define canales y precio base.
                </p>
              </div>
              <label class="inline-flex items-center gap-2 cursor-pointer shrink-0 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <input
                  type="checkbox"
                  [checked]="business.estadoSuscripcion === 'activa'"
                  [disabled]="togglingSubscription"
                  (change)="toggleSubscription($any($event.target).checked)"
                  class="h-4 w-4 rounded border-gray-300 text-teal-600">
                <span>
                  <span class="block text-sm font-semibold text-gray-900">Suscripción activa</span>
                  <span class="block text-[11px] text-gray-500">Desactivá para bloquear el ingreso</span>
                </span>
              </label>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                *ngFor="let option of productOptions"
                (click)="selectProduct(option.id)"
                class="text-left rounded-xl border px-4 py-3 transition-colors"
                [class.border-teal-500]="selectedProductId === option.id"
                [class.bg-teal-50]="selectedProductId === option.id"
                [class.ring-2]="selectedProductId === option.id"
                [class.ring-teal-200]="selectedProductId === option.id"
                [class.border-gray-200]="selectedProductId !== option.id"
                [class.bg-white]="selectedProductId !== option.id">
                <span class="block text-sm font-bold text-gray-900">{{ option.label }}</span>
                <span class="block text-xs text-gray-500 mt-1">{{ option.hint }}</span>
                <span class="block text-xs font-semibold text-teal-800 mt-2" *ngIf="priceLabelFor(option.id) as price">
                  {{ price }}
                </span>
              </button>
            </div>

            <p class="text-xs text-gray-500" *ngIf="platformAccessDraft.trialProduct">
              Registro: {{ trialProductLabel }}
              <span *ngIf="selectedProductId !== platformAccessDraft.trialProduct">
                · ahora: {{ productLabel(selectedProductId) }}
              </span>
            </p>
          </section>

          <section *ngIf="activePlan as plan" class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <h2 class="text-base font-semibold text-gray-900">Usuarios, precio y qué ve el cliente</h2>
            <p class="text-sm text-gray-500 mt-1 mb-4">
              Cupos, cuota y módulos visibles del Panel para {{ business.nombre }}.
            </p>
            <app-platform-subscription-editor
              [plan]="plan"
              [draft]="subscriptionDraft"
              [showErpPacks]="showsErpPacks"
              namePrefix="bizDetail"
              (draftChange)="subscriptionDraft = $event">
            </app-platform-subscription-editor>
          </section>

          <section
            *ngIf="platformAccessDraft.whatsappEnabled"
            class="rounded-xl border border-violet-100 bg-white p-5 shadow-sm space-y-4">
            <div>
              <h2 class="text-base font-semibold text-violet-950">WhatsApp autorizados</h2>
              <p class="text-sm text-violet-800 mt-1">
                1 número incluido en el plan. Cada WhatsApp extra se asocia a un admin u operador y se cobra aparte
                (mismo precio que usuario extra).
              </p>
            </div>

            <div *ngIf="loadingWhatsappUsers" class="text-sm text-gray-400 py-4">Cargando...</div>

            <div *ngIf="!loadingWhatsappUsers" class="space-y-2">
              <div
                *ngFor="let wa of whatsappUsers"
                class="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-semibold text-gray-900">{{ wa.phone }}</p>
                  <p class="text-xs text-gray-600">
                    {{ wa.name }} · {{ wa.role }}
                    <span *ngIf="wa.erpUserId" class="text-violet-800">
                      · usuario {{ erpUserLabel(wa.erpUserId) }}
                    </span>
                  </p>
                </div>
                <label class="inline-flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    [checked]="wa.enabled"
                    (change)="toggleWhatsappUser(wa, $any($event.target).checked)"
                    class="h-4 w-4 rounded border-violet-300 text-violet-700">
                  Activo
                </label>
                <button
                  type="button"
                  (click)="removeWhatsappUser(wa)"
                  class="text-xs font-semibold text-red-700 hover:underline">
                  Quitar
                </button>
              </div>
              <p *ngIf="whatsappUsers.length === 0" class="text-sm text-gray-500">
                Todavía no hay números autorizados.
              </p>
              <p class="text-xs text-violet-800">
                Activos: {{ whatsappEnabledCount }} ·
                Extras cobrables: {{ whatsappExtraCount }}
              </p>
            </div>

            <div class="rounded-lg border border-violet-200 bg-violet-50/60 p-3 space-y-3">
              <h3 class="text-sm font-semibold text-violet-950">Agregar WhatsApp</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  [(ngModel)]="whatsappDraft.phone"
                  name="waPhone"
                  placeholder="Teléfono +598…"
                  class="px-3 py-2 rounded-lg border border-violet-200 bg-white text-sm">
                <input
                  [(ngModel)]="whatsappDraft.name"
                  name="waName"
                  placeholder="Nombre"
                  class="px-3 py-2 rounded-lg border border-violet-200 bg-white text-sm">
                <select
                  [(ngModel)]="whatsappDraft.role"
                  name="waRole"
                  class="px-3 py-2 rounded-lg border border-violet-200 bg-white text-sm">
                  <option value="supervisor">Admin / supervisor</option>
                  <option value="admin">Admin</option>
                  <option value="operador">Operador</option>
                </select>
                <select
                  [(ngModel)]="whatsappDraft.erpUserId"
                  name="waErpUser"
                  class="px-3 py-2 rounded-lg border border-violet-200 bg-white text-sm">
                  <option value="">Sin usuario ERP</option>
                  <option *ngFor="let u of activeErpUsers" [value]="u.id">
                    {{ u.nombre }} ({{ u.rol }})
                  </option>
                </select>
              </div>
              <div class="flex flex-wrap items-center gap-3">
                <div>
                  <label class="block text-[11px] text-violet-800 mb-1">$/WhatsApp extra / mes</label>
                  <input
                    type="number"
                    min="0"
                    [(ngModel)]="subscriptionDraft.precioPorWhatsappOverride"
                    name="precioWa"
                    class="w-32 px-3 py-2 rounded-lg border border-violet-200 bg-white text-sm tabular-nums">
                </div>
                <button
                  type="button"
                  (click)="addWhatsappUser()"
                  [disabled]="savingWhatsappUser || !whatsappDraft.phone.trim()"
                  class="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-60">
                  {{ savingWhatsappUser ? 'Guardando...' : 'Agregar número' }}
                </button>
              </div>
            </div>
          </section>

          <section
            *ngIf="platformAccessDraft.whatsappEnabled"
            class="rounded-xl border border-violet-100 bg-violet-50/50 p-5 shadow-sm space-y-3">
            <div>
              <h2 class="text-base font-semibold text-violet-950">Simulador RiloBot</h2>
              <p class="text-sm text-violet-800 mt-1">
                Probá mensajes como si llegaran por WhatsApp.
              </p>
            </div>
            <div>
              <label class="block text-xs font-medium text-violet-900 mb-1">Teléfono (opcional)</label>
              <input
                [(ngModel)]="botSimPhone"
                name="botSimPhone"
                placeholder="+59899123456"
                class="w-full px-3 py-2 rounded-lg border border-violet-200 bg-white text-sm">
            </div>
            <div>
              <label class="block text-xs font-medium text-violet-900 mb-1">Mensaje</label>
              <textarea
                [(ngModel)]="botSimMessage"
                name="botSimMessage"
                rows="3"
                placeholder="Ej: nuevo pedido para Juan"
                class="w-full px-3 py-2 rounded-lg border border-violet-200 bg-white text-sm"></textarea>
            </div>
            <button
              type="button"
              (click)="runBotSimulation()"
              [disabled]="botSimulating || !botSimMessage.trim()"
              class="rounded-xl bg-violet-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-60">
              {{ botSimulating ? 'Simulando...' : 'Simular mensaje' }}
            </button>
            <div *ngIf="botSimResult" class="rounded-lg border border-violet-200 bg-white p-3 text-sm space-y-1">
              <p><span class="font-semibold text-gray-700">Intent:</span> {{ botSimResult.intent }}</p>
              <p><span class="font-semibold text-gray-700">Ejecutado:</span> {{ botSimResult.executed ? 'Sí' : 'No' }}</p>
              <p class="text-gray-800 whitespace-pre-wrap">{{ botSimResult.reply }}</p>
            </div>
          </section>
        </div>

        <div *ngIf="detailTab === 'prueba'" class="max-w-3xl space-y-6">
          <section class="rounded-xl border border-violet-100 bg-violet-50/80 p-5 shadow-sm space-y-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="text-base font-semibold text-violet-950">Período de prueba / acceso gratuito</h2>
                <p class="text-sm text-violet-800 mt-1">
                  Extendé días gratis o marcá la empresa como paga para que pueda seguir operando.
                </p>
              </div>
              <label class="inline-flex items-center gap-2 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  [checked]="business.enPrueba"
                  [disabled]="togglingTrial"
                  (change)="toggleTrial($any($event.target).checked)"
                  class="h-4 w-4 rounded border-violet-300 text-violet-600">
                <span class="text-sm font-medium text-violet-900">En prueba</span>
              </label>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <span class="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold" [ngClass]="trialStatusClass">
                {{ trialStatusLabel }}
              </span>
              <span *ngIf="business.trialDaysRemaining != null && business.trialStatus === 'active'" class="text-sm text-violet-800">
                Vence en {{ business.trialDaysRemaining }} día{{ business.trialDaysRemaining === 1 ? '' : 's' }}
              </span>
              <span *ngIf="business.trialStatus === 'expired'" class="text-sm text-amber-800 font-medium">
                Prueba vencida — el cliente no puede operar hasta que extendás o marques como pago.
              </span>
            </div>

            <div *ngIf="business.enPrueba" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-medium text-violet-800 mb-1">Inicio</label>
                <input [(ngModel)]="business.trialStartDate" name="trialStart" type="date"
                  class="w-full px-3 py-2 rounded-lg border border-violet-200 bg-white text-sm">
              </div>
              <div>
                <label class="block text-xs font-medium text-violet-800 mb-1">Fin</label>
                <input [(ngModel)]="business.trialEndDate" name="trialEnd" type="date"
                  class="w-full px-3 py-2 rounded-lg border border-violet-200 bg-white text-sm">
              </div>
            </div>

            <div class="rounded-lg border border-violet-200 bg-white/80 p-4 space-y-3">
              <h3 class="text-sm font-semibold text-violet-950">Dar más días gratis</h3>
              <div class="flex flex-wrap items-end gap-2">
                <div>
                  <label class="block text-xs font-medium text-violet-800 mb-1">Días a agregar</label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    [(ngModel)]="extendDays"
                    name="extendDays"
                    class="w-28 px-3 py-2 rounded-lg border border-violet-200 bg-white text-sm tabular-nums">
                </div>
                <button
                  type="button"
                  *ngFor="let quick of quickExtendDays"
                  (click)="extendDays = quick"
                  class="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-100">
                  +{{ quick }}
                </button>
                <button
                  type="button"
                  (click)="extendTrial()"
                  [disabled]="extendingTrial"
                  class="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-60">
                  {{ extendingTrial ? 'Extendiendo...' : 'Extender prueba' }}
                </button>
              </div>
              <p class="text-xs text-violet-700">
                Si ya venció, los días se cuentan desde hoy y se reactiva el acceso.
              </p>
            </div>
          </section>

          <section class="rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-sm space-y-4">
            <div>
              <h2 class="text-base font-semibold text-emerald-950">Marcar como pago</h2>
              <p class="text-sm text-emerald-800 mt-1">
                Saca a la empresa de prueba, deja la suscripción activa y aplica el precio de la landing.
              </p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-emerald-900 mb-1">Producto (landing)</label>
                <select
                  [(ngModel)]="markPaidDraft.productId"
                  (ngModelChange)="onMarkPaidProductChange()"
                  name="markPaidProduct"
                  class="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm">
                  <option *ngFor="let product of billingProducts" [value]="product.id">
                    {{ product.name }} · {{ product.priceLabel }}
                  </option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-emerald-900 mb-1">País / moneda</label>
                <select
                  [(ngModel)]="markPaidDraft.country"
                  (ngModelChange)="loadBillingCatalog()"
                  name="markPaidCountry"
                  class="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm">
                  <option value="UY">Uruguay (UYU)</option>
                  <option value="AR">Argentina (ARS)</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-emerald-900 mb-1">
                  {{ markPaidDraft.billingInterval === 'year' ? 'Monto anual' : 'Monto mensual' }}
                </label>
                <input
                  type="number"
                  min="0"
                  [(ngModel)]="markPaidDraft.amount"
                  name="markPaidAmount"
                  class="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm tabular-nums">
              </div>
              <div>
                <label class="block text-xs font-medium text-emerald-900 mb-1">Período de cobro</label>
                <select
                  [(ngModel)]="markPaidDraft.billingInterval"
                  (ngModelChange)="onMarkPaidIntervalChange()"
                  name="markPaidInterval"
                  class="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm">
                  <option value="month">Mensual</option>
                  <option value="year">Anual (12 meses · 10 cuotas)</option>
                </select>
              </div>
              <div class="flex items-end">
                <label class="inline-flex items-center gap-2 cursor-pointer pb-2">
                  <input
                    type="checkbox"
                    [(ngModel)]="markPaidDraft.registerPayment"
                    name="markPaidRegister"
                    class="h-4 w-4 rounded border-emerald-300 text-emerald-700">
                  <span class="text-sm text-emerald-900">
                    {{ markPaidDraft.billingInterval === 'year' ? 'Registrar cobertura anual' : 'Registrar pago del mes actual' }}
                  </span>
                </label>
              </div>
            </div>

            <div class="rounded-lg border border-emerald-200 bg-white/80 p-3 space-y-3">
              <label class="inline-flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  [(ngModel)]="markPaidDraft.enablePerUserPricing"
                  name="markPaidPerUser"
                  class="mt-0.5 h-4 w-4 rounded border-emerald-300 text-emerald-700">
                <span>
                  <span class="block text-sm font-semibold text-emerald-950">Cobrar usuarios extra del ERP</span>
                  <span class="block text-xs text-emerald-800 mt-0.5">
                    Activa el precio por operador/usuario adicional (además del incluido en el plan).
                  </span>
                </span>
              </label>
              <div *ngIf="markPaidDraft.enablePerUserPricing">
                <label class="block text-xs font-medium text-emerald-900 mb-1">$/usuario extra / mes</label>
                <input
                  type="number"
                  min="0"
                  [(ngModel)]="markPaidDraft.precioPorOperador"
                  name="markPaidUserPrice"
                  class="w-full max-w-xs px-3 py-2 rounded-lg border border-emerald-200 bg-white text-sm tabular-nums">
              </div>
            </div>

            <button
              type="button"
              (click)="markAsPaid()"
              [disabled]="markingPaid"
              class="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
              {{ markingPaid ? 'Activando...' : 'Marcar como pago y reactivar' }}
            </button>
          </section>
        </div>

        <div *ngIf="detailTab === 'pagos'" class="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <div class="space-y-6">
          <section id="pagos" class="rounded-xl border border-emerald-100 bg-white p-5 shadow-sm space-y-4">
            <h2 class="text-base font-semibold text-gray-900">Registrar pago</h2>
            <p *ngIf="business.enPrueba" class="text-xs text-violet-700 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
              Cuenta en prueba: el pago es opcional mientras dure el período.
            </p>
            <p *ngIf="business.paidUntil" class="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
              Cobertura registrada hasta {{ formatDateTime(business.paidUntil) }}
              <span *ngIf="business.billingInterval === 'year'"> · plan anual</span>.
            </p>
            <div class="space-y-3">
              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">Tipo</label>
                <select
                  [(ngModel)]="paymentDraft.coverageMonths"
                  (ngModelChange)="onPaymentCoverageChange()"
                  name="payCoverage"
                  class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                  <option [ngValue]="1">Mensual (1 mes)</option>
                  <option [ngValue]="12">Anual (12 meses)</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">Período inicio (AAAA-MM)</label>
                <input [(ngModel)]="paymentDraft.periodo" name="payPeriodo" placeholder="2026-06"
                  class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">
                  {{ paymentDraft.coverageMonths > 1 ? 'Monto total anual ($)' : 'Monto ($)' }}
                </label>
                <input [(ngModel)]="paymentDraft.monto" name="payMonto" type="number" min="0" step="1"
                  class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">Fecha de pago</label>
                <input [(ngModel)]="paymentDraft.fechaPago" name="payFecha" type="date"
                  class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">Notas</label>
                <input [(ngModel)]="paymentDraft.notas" name="payNotas" placeholder="Transferencia..."
                  class="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
              </div>
            </div>
            <button type="button" (click)="registerPayment()" [disabled]="registeringPayment"
              class="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
              {{ registeringPayment ? 'Registrando...' : (paymentDraft.coverageMonths > 1 ? 'Registrar pago anual' : 'Registrar pago') }}
            </button>
          </section>

          <section class="rounded-xl border border-sky-100 bg-sky-50 p-5 shadow-sm space-y-4">
            <div>
              <h2 class="text-base font-semibold text-sky-950">Enviar detalle por email</h2>
              <p class="text-sm text-sky-800 mt-1">
                Arma el desglose de cuota (conceptos, cantidades e importes) y lo manda al responsable.
              </p>
            </div>
            <div class="space-y-3">
              <div>
                <label class="block text-xs font-medium text-sky-900 mb-1">Destino</label>
                <input
                  [(ngModel)]="invoiceEmailDraft.to"
                  name="invoiceTo"
                  type="email"
                  placeholder="mail del cliente"
                  class="w-full px-3 py-2 rounded-lg border border-sky-200 bg-white text-sm">
              </div>
              <div>
                <label class="block text-xs font-medium text-sky-900 mb-1">Período (AAAA-MM)</label>
                <input
                  [(ngModel)]="invoiceEmailDraft.periodo"
                  name="invoicePeriodo"
                  placeholder="2026-07"
                  class="w-full px-3 py-2 rounded-lg border border-sky-200 bg-white text-sm">
              </div>
              <div>
                <label class="block text-xs font-medium text-sky-900 mb-1">Nota (opcional)</label>
                <input
                  [(ngModel)]="invoiceEmailDraft.notes"
                  name="invoiceNotes"
                  placeholder="Ej: vencimiento día 10 · transferencia..."
                  class="w-full px-3 py-2 rounded-lg border border-sky-200 bg-white text-sm">
              </div>
            </div>
            <div *ngIf="business.cuotaDesglose?.lineas?.length" class="rounded-lg border border-sky-100 bg-white px-3 py-2 text-xs text-gray-600 space-y-1">
              <p class="font-semibold text-sky-900">Se enviará:</p>
              <p *ngFor="let line of business.cuotaDesglose!.lineas">
                {{ line.concepto }}
                <span *ngIf="line.cantidad">×{{ line.cantidad }}</span>
                — {{ formatMoney(line.monto) }}
              </p>
              <p class="font-semibold text-gray-900 pt-1">Total {{ formatMoney(business.montoMensualEsperado) }}</p>
            </div>
            <button
              type="button"
              (click)="sendInvoiceEmail()"
              [disabled]="sendingInvoiceEmail"
              class="w-full rounded-xl bg-sky-700 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60">
              {{ sendingInvoiceEmail ? 'Enviando...' : 'Enviar detalle de cuota' }}
            </button>
          </section>
          </div>

          <div class="space-y-6">
            <section class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
              <h2 class="text-base font-semibold text-gray-900 mb-3">Historial comercial</h2>
              <div *ngIf="loadingHistory" class="text-sm text-gray-400 py-6 text-center">Cargando...</div>
              <div *ngIf="!loadingHistory && history.length === 0" class="text-sm text-gray-400 py-6 text-center">
                Sin cambios registrados.
              </div>
              <div *ngIf="!loadingHistory && history.length > 0" class="space-y-2 max-h-72 overflow-y-auto">
                <div *ngFor="let entry of history" class="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm">
                  <div class="flex justify-between gap-2">
                    <span class="font-medium text-gray-900">{{ formatHistoryEntry(entry) }}</span>
                    <span class="text-xs text-gray-500 shrink-0">{{ formatDateTime(entry.date) }}</span>
                  </div>
                  <p *ngIf="entry.note" class="text-xs text-gray-600 mt-1">{{ entry.note }}</p>
                </div>
              </div>
            </section>

            <section class="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
              <h2 class="text-base font-semibold text-gray-900 mb-3">Historial de pagos</h2>
              <div *ngIf="loadingPayments" class="text-sm text-gray-400 py-6 text-center">Cargando...</div>
              <div *ngIf="!loadingPayments && payments.length === 0" class="text-sm text-gray-400 py-6 text-center">
                Sin pagos registrados.
              </div>
              <div *ngIf="!loadingPayments && payments.length > 0" class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                  <thead>
                    <tr class="text-xs uppercase text-gray-400 border-b border-gray-100">
                      <th class="py-2 pr-2">Período</th>
                      <th class="py-2 pr-2 text-right">Monto</th>
                      <th class="py-2">Fecha</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-50">
                    <tr *ngFor="let payment of payments">
                      <td class="py-2.5 pr-2 font-medium">{{ formatPeriodo(payment.periodo) }}</td>
                      <td class="py-2.5 pr-2 text-right tabular-nums">{{ formatMoney(payment.monto) }}</td>
                      <td class="py-2.5 text-gray-600">{{ formatDate(payment.fechaPago) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class PlatformBusinessDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private platformService = inject(PlatformService);
  private dialogService = inject(DialogService);

  readonly statusLabels = SUBSCRIPTION_STATUS_LABELS;
  readonly paymentStatusLabels = SUBSCRIPTION_PAYMENT_STATUS_LABELS;
  readonly defaultTrialDays = DEFAULT_TRIAL_DAYS;
  readonly quickExtendDays = [7, 10, 20, 30];
  readonly trialStatusLabels = TRIAL_STATUS_LABELS;
  readonly detailTabs = [
    { id: 'resumen' as const, label: 'Resumen' },
    { id: 'usuarios' as const, label: 'Usuarios' },
    { id: 'plan' as const, label: 'Producto' },
    { id: 'prueba' as const, label: 'Prueba / Pago' },
    { id: 'pagos' as const, label: 'Pagos' },
  ];

  detailTab: 'resumen' | 'usuarios' | 'plan' | 'prueba' | 'pagos' = 'resumen';

  readonly erpRoleLabels: Record<'supervisor' | 'admin' | 'staff', string> = {
    supervisor: 'Administrador principal',
    admin: 'Administrador delegado',
    staff: 'Operador',
  };

  readonly productOptions: { id: TrialProductId; label: string; hint: string }[] = [
    { id: 'whatsapp', label: 'RiloBot', hint: 'WhatsApp + IA' },
    { id: 'erp', label: 'Panel', hint: 'Panel web con stock' },
    { id: 'completo', label: 'RiloBot + Panel', hint: 'Bot + Panel' },
  ];

  selectedProductId: TrialProductId = 'completo';

  platformAccessDraft: ClientPlatformAccess = normalizePlatformAccess(null);
  botSimPhone = '';
  botSimMessage = '';
  botSimulating = false;
  botSimResult: { reply: string; intent: string; executed: boolean } | null = null;

  whatsappUsers: PlatformWhatsappUser[] = [];
  whatsappEnabledCount = 0;
  loadingWhatsappUsers = false;
  savingWhatsappUser = false;
  erpUsers: Array<{
    id: string;
    nombre: string;
    rol: string;
    email: string;
    loginUsername?: string;
    activo: boolean;
  }> = [];
  loadingErpUsers = false;
  savingErpUser = false;
  erpUserDraft = {
    nombre: '',
    email: '',
    loginUsername: '',
    password: '',
    rol: 'staff' as 'supervisor' | 'admin' | 'staff',
  };
  whatsappDraft = {
    phone: '',
    name: '',
    role: 'operador' as 'supervisor' | 'admin' | 'operador',
    erpUserId: '',
  };

  business: (PublicBusinessInfo & { planId?: string }) | null = null;
  plans: PublicPlanInfo[] = [];
  subscriptionDraft: BusinessSubscriptionDraft = emptyBusinessSubscriptionDraft();
  payments: SubscriptionPayment[] = [];
  history: SubscriptionHistoryEntry[] = [];
  paymentDraft = { periodo: '', monto: 0, fechaPago: '', notas: '', coverageMonths: 1 };
  contactDraft = {
    ownerName: '',
    email: '',
    phone: '',
    pais: '',
    ciudad: '',
    whatsappOptIn: false,
  };
  savingContact = false;
  invoiceEmailDraft = { to: '', periodo: '', notes: '' };
  sendingInvoiceEmail = false;

  extendDays = DEFAULT_TRIAL_DAYS;
  extendingTrial = false;
  markingPaid = false;
  releasingContact: 'email' | 'phone' | null = null;
  billingProducts: BillingCatalogProduct[] = [];
  markPaidDraft = {
    productId: 'completo',
    country: 'UY' as 'UY' | 'AR',
    amount: 3490,
    billingInterval: 'month' as 'month' | 'year',
    registerPayment: true,
    enablePerUserPricing: false,
    precioPorOperador: DEFAULT_EXTRA_USER_MONTHLY.UY,
  };

  loading = true;
  saving = false;
  togglingTrial = false;
  togglingSubscription = false;
  registeringPayment = false;
  loadingPayments = false;
  loadingHistory = false;

  get activePlan(): PublicPlanInfo | null {
    if (!this.business) return null;
    const planId = this.business.planId ?? this.business.plan.id;
    return this.plans.find((p) => p.id === planId) ?? this.business.plan;
  }

  get billingStatusLabel(): string {
    if (!this.business) return '';
    if (this.business.enPrueba && this.business.trialStatus === 'expired') return 'Prueba vencida';
    if (this.business.trialBillingActive || (this.business.enPrueba && this.business.trialStatus === 'active')) {
      if (this.business.trialExpiringSoon && this.business.trialDaysRemaining != null) {
        return `Prueba · vence en ${this.business.trialDaysRemaining} d`;
      }
      return 'En prueba';
    }
    return this.paymentStatusLabels[this.business.estadoPago];
  }

  get billingStatusClass(): string {
    if (!this.business) return '';
    if (this.business.enPrueba && this.business.trialStatus === 'expired') return 'bg-amber-100 text-amber-900';
    if (this.business.trialBillingActive || (this.business.enPrueba && this.business.trialStatus === 'active')) {
      return this.business.trialExpiringSoon ? 'bg-orange-100 text-orange-900' : 'bg-violet-100 text-violet-800';
    }
    return this.paymentClass(this.business.estadoPago);
  }

  get subscriptionStatusClass(): string {
    if (!this.business) return '';
    return this.business.estadoSuscripcion === 'activa'
      ? 'bg-green-100 text-green-800'
      : 'bg-red-100 text-red-800';
  }

  get trialStatusLabel(): string {
    if (!this.business) return '';
    const s = this.business.trialStatus as TrialStatus | null | undefined;
    if (s && this.trialStatusLabels[s]) return this.trialStatusLabels[s];
    return this.business.enPrueba ? 'Prueba activa' : 'Sin prueba';
  }

  get trialStatusClass(): string {
    switch (this.business?.trialStatus) {
      case 'expired':
        return 'bg-amber-100 text-amber-900';
      case 'converted':
        return 'bg-emerald-100 text-emerald-800';
      default:
        return 'bg-violet-100 text-violet-800';
    }
  }

  get contactEmail(): string {
    return this.business?.contactVerification?.email?.trim() || '—';
  }

  get contactPhone(): string {
    return this.business?.contactVerification?.phone?.trim() || '—';
  }

  get ownerName(): string {
    return (
      this.business?.lifecycle?.ownerName?.trim() ||
      this.business?.contactVerification?.email?.trim() ||
      '—'
    );
  }

  get locationLabel(): string {
    const city = this.business?.lifecycle?.ciudad?.trim();
    const country = this.business?.lifecycle?.pais?.trim();
    if (city && country) return `${city}, ${country}`;
    return city || country || '—';
  }

  get emailVerified(): boolean {
    return this.business?.contactVerification?.emailVerified === true;
  }

  get whatsappOptIn(): boolean {
    return this.business?.contactVerification?.whatsappOptIn === true;
  }

  get lastLoginAt(): string | null | undefined {
    return this.business?.lifecycle?.lastLoginAt;
  }

  get sourceLabel(): string {
    return this.business?.source || this.business?.lifecycle?.source || '—';
  }

  get trialProductLabel(): string {
    const product = this.platformAccessDraft.trialProduct;
    return product ? TRIAL_PRODUCT_LABELS[product] : '—';
  }

  get showsErpPacks(): boolean {
    return this.selectedProductId === 'erp' || this.selectedProductId === 'completo';
  }

  get whatsappExtraCount(): number {
    return Math.max(0, this.whatsappEnabledCount - 1);
  }

  get usage() {
    return (
      this.business?.lifecycle?.usageSummary ?? {
        ordersCount: 0,
        salesCount: 0,
        productsCount: 0,
        cashMovementsCount: 0,
      }
    );
  }

  ngOnInit() {
    this.platformService.getPlans().subscribe({
      next: (plans) => {
        this.plans = plans.filter((plan) => plan.activo);
      },
    });
    this.loadBillingCatalog();

    this.route.paramMap.subscribe((params) => {
      const businessId = params.get('businessId');
      if (!businessId) {
        void this.router.navigate(['/platform']);
        return;
      }
      this.loadBusiness(businessId);
    });

    this.route.fragment.subscribe((fragment) => {
      if (fragment === 'pagos') {
        this.detailTab = 'pagos';
        setTimeout(() => document.getElementById('pagos')?.scrollIntoView({ behavior: 'smooth' }), 200);
      }
      if (fragment === 'prueba') {
        this.detailTab = 'prueba';
      }
    });
  }

  loadBillingCatalog() {
    this.platformService.getBillingCatalog(this.markPaidDraft.country).subscribe({
      next: (res) => {
        this.billingProducts = res.products;
        this.onMarkPaidProductChange();
        this.ensureSubscriptionDraftPricing();
      },
    });
  }

  /** Completa precio base / extras desde el catálogo si la empresa aún no los tiene. */
  private ensureSubscriptionDraftPricing() {
    if (!this.business) return;
    const price = this.billingProducts.find((p) => p.id === this.selectedProductId);
    const planBase = Number(this.activePlan?.precioBaseMensual ?? this.business.plan.precioBaseMensual) || 0;
    const nextBase =
      (Number(this.subscriptionDraft.precioBaseOverride) > 0
        ? Number(this.subscriptionDraft.precioBaseOverride)
        : null) ??
      price?.amountMonthly ??
      (planBase > 0 ? planBase : null);
    if (nextBase == null) return;

    const extra =
      this.subscriptionDraft.precioPorOperadorOverride ??
      price?.extraUserMonthly ??
      DEFAULT_EXTRA_USER_MONTHLY.UY;

    this.subscriptionDraft = {
      ...this.subscriptionDraft,
      precioBaseOverride: nextBase,
      precioPorOperadorOverride: this.subscriptionDraft.precioPorOperadorOverride ?? extra,
      precioPorAdministradorOverride:
        this.subscriptionDraft.precioPorAdministradorOverride ?? extra,
      precioPorWhatsappOverride: this.subscriptionDraft.precioPorWhatsappOverride ?? extra,
    };
  }

  onMarkPaidProductChange() {
    const product =
      this.billingProducts.find((p) => p.id === this.markPaidDraft.productId) ??
      this.billingProducts[0];
    if (!product) return;
    this.markPaidDraft.productId = product.id;
    this.markPaidDraft.amount =
      this.markPaidDraft.billingInterval === 'year'
        ? product.amountYearly ?? Math.round(product.amountMonthly * 10)
        : product.amountMonthly;
    if (!this.markPaidDraft.enablePerUserPricing || !this.markPaidDraft.precioPorOperador) {
      this.markPaidDraft.precioPorOperador = product.extraUserMonthly;
    }
  }

  onMarkPaidIntervalChange() {
    this.onMarkPaidProductChange();
  }

  onPaymentCoverageChange() {
    if (!this.business) return;
    const monthly = this.business.montoMensualEsperado || this.business.plan.precioMensual || 0;
    this.paymentDraft.monto =
      this.paymentDraft.coverageMonths > 1 ? Math.round(monthly * 10) : monthly;
  }

  private loadBusiness(businessId: string) {
    this.loading = true;
    this.platformService.getBusiness(businessId).subscribe({
      next: (business) => {
        this.business = { ...business, planId: business.planId };
        this.subscriptionDraft = businessSubscriptionDraftFromPublic(this.business);
        this.platformAccessDraft = normalizePlatformAccess(business.platformAccess);
        this.selectedProductId = this.resolveProductFromBusiness(business);
        this.ensureSubscriptionDraftPricing();
        this.botSimPhone = business.contactVerification?.phone?.trim() ?? '';
        this.botSimResult = null;
        const productId = this.selectedProductId;
        this.markPaidDraft.productId = productId;
        this.onMarkPaidProductChange();
        this.resetPaymentDraft(business);
        this.resetContactDraft(business);
        this.loading = false;
        this.loadPayments(businessId);
        this.loadHistory(businessId);
        this.loadWhatsappUsers(businessId);
        this.loadErpUsers(businessId);
      },
      error: () => {
        this.business = null;
        this.loading = false;
      },
    });
  }

  productLabel(id: TrialProductId): string {
    return TRIAL_PRODUCT_LABELS[id];
  }

  priceLabelFor(id: TrialProductId): string {
    return this.billingProducts.find((p) => p.id === id)?.priceLabel ?? '';
  }

  private resolveProductFromBusiness(business: PublicBusinessInfo): TrialProductId {
    const fromAccess = business.platformAccess?.trialProduct;
    if (fromAccess && TRIAL_PRODUCT_IDS.includes(fromAccess)) return fromAccess;
    const access = normalizePlatformAccess(business.platformAccess);
    if (access.whatsappEnabled && access.erpWebEnabled) return 'completo';
    if (access.whatsappEnabled) return 'whatsapp';
    return 'erp';
  }

  erpUserLabel(userId: string): string {
    return this.erpUsers.find((u) => u.id === userId)?.nombre ?? userId.slice(0, 6);
  }

  get activeErpUsers() {
    return this.erpUsers.filter((u) => u.activo !== false);
  }

  loadErpUsers(businessId: string) {
    this.loadingErpUsers = true;
    this.platformService.getBusinessUsers(businessId, { includeInactive: true }).subscribe({
      next: (users) => {
        this.erpUsers = users.map((u) => ({
          id: u.id,
          nombre: u.nombre,
          rol: u.rol,
          email: u.email,
          loginUsername: u.loginUsername,
          activo: u.activo !== false,
        }));
        this.loadingErpUsers = false;
      },
      error: () => {
        this.erpUsers = [];
        this.loadingErpUsers = false;
      },
    });
  }

  createErpUser() {
    if (!this.business) return;
    const nombre = this.erpUserDraft.nombre.trim();
    if (!nombre) {
      this.dialogService.alert({ title: 'Campo requerido', message: 'Ingresá el nombre.' });
      return;
    }

    this.savingErpUser = true;
    this.platformService
      .createBusinessUser(this.business.id, {
        nombre,
        email: this.erpUserDraft.email.trim().toLowerCase(),
        loginUsername: (
          this.erpUserDraft.loginUsername ||
          this.erpUserDraft.email ||
          this.erpUserDraft.nombre
        )
          .trim()
          .toLowerCase(),
        password: this.erpUserDraft.password.trim() || undefined,
        rol: this.erpUserDraft.rol,
        activo: true,
        permisos: [],
      })
      .subscribe({
        next: () => {
          this.savingErpUser = false;
          this.erpUserDraft = {
            nombre: '',
            email: '',
            loginUsername: '',
            password: '',
            rol: 'staff',
          };
          this.loadErpUsers(this.business!.id);
          this.reloadBusinessAfterUserChange();
        },
        error: (err) => {
          this.savingErpUser = false;
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo crear el usuario.',
          });
        },
      });
  }

  toggleErpUserActive(user: { id: string; nombre: string; activo: boolean; rol: string }) {
    if (!this.business) return;
    const nextActive = user.activo === false;
    const action = nextActive ? 'Reactivar' : 'Dar de baja';
    this.dialogService
      .confirm({
        title: `${action} usuario`,
        message: nextActive
          ? `¿Reactivar a ${user.nombre}?`
          : `¿Dar de baja a ${user.nombre}? No podrá ingresar hasta que lo reactives.`,
        confirmLabel: action,
        variant: nextActive ? 'default' : 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed || !this.business) return;
        this.savingErpUser = true;
        this.platformService
          .updateBusinessUser(this.business.id, user.id, { activo: nextActive })
          .subscribe({
            next: () => {
              this.savingErpUser = false;
              this.loadErpUsers(this.business!.id);
              this.reloadBusinessAfterUserChange();
            },
            error: (err) => {
              this.savingErpUser = false;
              this.dialogService.alert({
                title: 'Error',
                message: err?.error?.error || 'No se pudo actualizar el usuario.',
              });
            },
          });
      });
  }

  deleteErpUser(user: { id: string; nombre: string }) {
    if (!this.business) return;
    this.dialogService
      .confirm({
        title: 'Eliminar usuario',
        message: `¿Eliminar a ${user.nombre}? Esta acción no se puede deshacer.`,
        confirmLabel: 'Eliminar',
        variant: 'danger',
      })
      .subscribe((confirmed) => {
        if (!confirmed || !this.business) return;
        this.savingErpUser = true;
        this.platformService.deleteBusinessUser(this.business.id, user.id).subscribe({
          next: () => {
            this.savingErpUser = false;
            this.loadErpUsers(this.business!.id);
            this.reloadBusinessAfterUserChange();
          },
          error: (err) => {
            this.savingErpUser = false;
            this.dialogService.alert({
              title: 'Error',
              message: err?.error?.error || 'No se pudo eliminar el usuario.',
            });
          },
        });
      });
  }

  private reloadBusinessAfterUserChange() {
    if (!this.business) return;
    this.platformService.getBusiness(this.business.id).subscribe({
      next: (business) => {
        this.business = business;
      },
    });
  }

  loadWhatsappUsers(businessId: string) {
    this.loadingWhatsappUsers = true;
    this.platformService.getWhatsappUsers(businessId).subscribe({
      next: (res) => {
        this.whatsappUsers = res.users;
        this.whatsappEnabledCount = res.enabledCount;
        this.loadingWhatsappUsers = false;
      },
      error: () => {
        this.whatsappUsers = [];
        this.whatsappEnabledCount = 0;
        this.loadingWhatsappUsers = false;
      },
    });
  }

  addWhatsappUser() {
    if (!this.business || !this.whatsappDraft.phone.trim()) return;
    this.savingWhatsappUser = true;
    this.platformService
      .addWhatsappUser(this.business.id, {
        phone: this.whatsappDraft.phone.trim(),
        name: this.whatsappDraft.name.trim() || this.whatsappDraft.phone.trim(),
        role: this.whatsappDraft.role,
        enabled: true,
        erpUserId: this.whatsappDraft.erpUserId || null,
      })
      .subscribe({
        next: () => {
          this.savingWhatsappUser = false;
          this.whatsappDraft = { phone: '', name: '', role: 'operador', erpUserId: '' };
          this.loadWhatsappUsers(this.business!.id);
          this.platformService.getBusiness(this.business!.id).subscribe({
            next: (updated) => this.applyBusinessUpdate(updated),
          });
        },
        error: (err) => {
          this.savingWhatsappUser = false;
          this.dialogService.alert({
            title: 'No se pudo agregar',
            message: err?.error?.error || 'Revisá el teléfono e intentá de nuevo.',
          });
        },
      });
  }

  toggleWhatsappUser(wa: PlatformWhatsappUser, enabled: boolean) {
    if (!this.business) return;
    this.platformService.updateWhatsappUser(this.business.id, wa.id, { enabled }).subscribe({
      next: () => {
        this.loadWhatsappUsers(this.business!.id);
        this.platformService.getBusiness(this.business!.id).subscribe({
          next: (updated) => this.applyBusinessUpdate(updated),
        });
      },
      error: (err) => {
        this.dialogService.alert({
          title: 'Error',
          message: err?.error?.error || 'No se pudo actualizar.',
        });
      },
    });
  }

  removeWhatsappUser(wa: PlatformWhatsappUser) {
    if (!this.business) return;
    this.dialogService
      .confirm({
        title: 'Quitar WhatsApp',
        message: `¿Quitar ${wa.phone}? Dejará de poder usar RiloBot con ese número.`,
        confirmLabel: 'Quitar',
        variant: 'danger',
      })
      .subscribe((ok) => {
        if (!ok || !this.business) return;
        this.platformService.deleteWhatsappUser(this.business.id, wa.id).subscribe({
          next: () => {
            this.loadWhatsappUsers(this.business!.id);
            this.platformService.getBusiness(this.business!.id).subscribe({
              next: (updated) => this.applyBusinessUpdate(updated),
            });
          },
          error: (err) => {
            this.dialogService.alert({
              title: 'Error',
              message: err?.error?.error || 'No se pudo quitar.',
            });
          },
        });
      });
  }

  selectProduct(productId: TrialProductId) {
    if (!this.business) return;
    this.selectedProductId = productId;
    this.platformAccessDraft = normalizePlatformAccess(platformAccessForTrialProduct(productId));
    const catalog = getBillingProduct(productId);
    const price = this.billingProducts.find((p) => p.id === productId);
    if (catalog) {
      this.business = { ...this.business, planId: catalog.erpPlanId };
    }

    const currentAdmins = Math.max(1, Number(this.subscriptionDraft.limiteAdministradores) || 1);
    const currentOps = Math.max(0, Number(this.subscriptionDraft.limiteOperadores) || 0);
    this.subscriptionDraft = {
      ...this.subscriptionDraft,
      limiteAdministradores: currentAdmins,
      limiteOperadores: currentOps,
      limiteUsuariosTotal: currentAdmins + currentOps,
      precioBaseOverride: price?.amountMonthly ?? this.subscriptionDraft.precioBaseOverride,
      precioPorOperadorOverride:
        this.subscriptionDraft.precioPorOperadorOverride ??
        price?.extraUserMonthly ??
        DEFAULT_EXTRA_USER_MONTHLY.UY,
      precioPorAdministradorOverride:
        this.subscriptionDraft.precioPorAdministradorOverride ??
        price?.extraUserMonthly ??
        DEFAULT_EXTRA_USER_MONTHLY.UY,
    };
  }

  save(historyNote?: string) {
    if (!this.business) return;
    this.saving = true;
    const access = platformAccessForTrialProduct(this.selectedProductId);
    this.platformService
      .updateBusiness(this.business.id, {
        planId: this.business.planId ?? this.business.plan.id,
        estadoSuscripcion: this.business.estadoSuscripcion as SubscriptionStatus,
        enPrueba: this.business.enPrueba,
        trialStartDate: this.business.trialStartDate || undefined,
        trialEndDate: this.business.trialEndDate || undefined,
        trialStatus: this.business.trialStatus ?? undefined,
        historyNote,
        ...subscriptionDraftToPayload(this.subscriptionDraft),
      })
      .subscribe({
        next: (updated) => {
          this.platformService
            .updatePlatformAccess(updated.id, {
              erpWebEnabled: access.erpWebEnabled,
              whatsappEnabled: access.whatsappEnabled,
              aiEnabled: access.aiEnabled,
              trialProduct: this.selectedProductId,
            })
            .subscribe({
              next: (platformAccess) => {
                this.saving = false;
                this.business = {
                  ...updated,
                  planId: updated.planId,
                  platformAccess: normalizePlatformAccess({
                    ...platformAccess,
                    trialProduct: this.selectedProductId,
                  }),
                };
                this.platformAccessDraft = normalizePlatformAccess(this.business.platformAccess);
                this.subscriptionDraft = businessSubscriptionDraftFromPublic(this.business);
                this.loadHistory(this.business.id);
              },
              error: () => {
                this.saving = false;
                this.business = { ...updated, planId: updated.planId };
                this.subscriptionDraft = businessSubscriptionDraftFromPublic(this.business);
                this.dialogService.alert({
                  title: 'Parcial',
                  message: 'Se guardó el plan, pero no se pudieron actualizar los canales (Bot/Panel).',
                });
              },
            });
        },
        error: (err) => {
          this.saving = false;
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo guardar.',
          });
        },
      });
  }

  runBotSimulation() {
    if (!this.business || !this.botSimMessage.trim()) return;
    this.botSimulating = true;
    this.botSimResult = null;
    this.platformService
      .simulateWhatsappMessage({
        businessId: this.business.id,
        message: this.botSimMessage.trim(),
        phone: this.botSimPhone.trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.botSimulating = false;
          this.botSimResult = res.result;
        },
        error: (err) => {
          this.botSimulating = false;
          this.dialogService.alert({
            title: 'Simulación fallida',
            message: err?.error?.error || 'No se pudo simular el mensaje.',
          });
        },
      });
  }

  releaseContact(type: 'email' | 'phone', value: string) {
    if (!value || value === '—') return;
    if (this.business?.estadoSuscripcion === 'activa') {
      this.dialogService.alert({
        title: 'Suscripción activa',
        message:
          'No podés liberar el contacto mientras la suscripción esté activa. Desactivála en Producto y después liberá el email o teléfono.',
      });
      return;
    }
    this.dialogService
      .confirm({
        title: type === 'email' ? 'Liberar email' : 'Liberar teléfono',
        message: `¿Liberar ${value} para que se pueda usar de nuevo en el registro de la landing? La empresa no se elimina.`,
        confirmLabel: 'Liberar',
        variant: 'danger',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.releasingContact = type;
        this.platformService.releaseTrialContactClaim(type, value, { force: true }).subscribe({
          next: (res) => {
            this.releasingContact = null;
            this.dialogService.alert({
              title: res.released ? 'Liberado' : 'Sin reserva',
              message: res.released
                ? 'Ya puede usarse otra vez en /probar-gratis.'
                : 'No había una reserva activa para ese valor.',
            });
          },
          error: (err) => {
            this.releasingContact = null;
            this.dialogService.alert({
              title: 'No se pudo liberar',
              message: err?.error?.error || 'No se pudo liberar el contacto.',
            });
          },
        });
      });
  }

  extendTrial() {
    if (!this.business) return;
    const days = Math.floor(Number(this.extendDays));
    if (!Number.isFinite(days) || days < 1) {
      this.dialogService.alert({
        title: 'Días inválidos',
        message: 'Indicá cuántos días gratis querés agregar (mínimo 1).',
      });
      return;
    }
    this.extendingTrial = true;
    this.platformService.extendBusinessTrial(this.business.id, days).subscribe({
      next: (updated) => {
        this.extendingTrial = false;
        this.applyBusinessUpdate(updated);
      },
      error: (err) => {
        this.extendingTrial = false;
        this.dialogService.alert({
          title: 'Error',
          message: err?.error?.error || 'No se pudo extender la prueba.',
        });
      },
    });
  }

  markAsPaid() {
    if (!this.business) return;
    this.dialogService
      .confirm({
        title: 'Marcar como pago',
        message:
          'La empresa saldrá de prueba, quedará con suscripción activa y se aplicará el precio del producto elegido.',
        confirmLabel: 'Marcar como pago',
      })
      .subscribe((ok) => {
        if (!ok || !this.business) return;
        this.markingPaid = true;
        this.platformService
          .markBusinessAsPaid(this.business.id, {
            productId: this.markPaidDraft.productId,
            country: this.markPaidDraft.country,
            amount: Number(this.markPaidDraft.amount) || 0,
            billingInterval: this.markPaidDraft.billingInterval,
            registerPayment: this.markPaidDraft.registerPayment,
            enablePerUserPricing: this.markPaidDraft.enablePerUserPricing,
            precioPorOperador: Number(this.markPaidDraft.precioPorOperador) || 0,
          })
          .subscribe({
            next: (updated) => {
              this.markingPaid = false;
              this.applyBusinessUpdate(updated);
              this.loadPayments(updated.id);
              this.loadHistory(updated.id);
            },
            error: (err) => {
              this.markingPaid = false;
              this.dialogService.alert({
                title: 'Error',
                message: err?.error?.error || 'No se pudo marcar como pago.',
              });
            },
          });
      });
  }

  private applyBusinessUpdate(updated: PublicBusinessInfo) {
    this.business = { ...updated, planId: updated.planId };
    this.subscriptionDraft = businessSubscriptionDraftFromPublic(this.business);
    this.platformAccessDraft = normalizePlatformAccess(updated.platformAccess);
    this.resetPaymentDraft(updated);
    this.resetContactDraft(updated);
  }

  saveContact() {
    if (!this.business) return;
    this.savingContact = true;
    this.platformService
      .updateBusinessContact(this.business.id, {
        ownerName: this.contactDraft.ownerName.trim(),
        email: this.contactDraft.email.trim(),
        phone: this.contactDraft.phone.trim(),
        pais: this.contactDraft.pais.trim(),
        ciudad: this.contactDraft.ciudad.trim(),
        whatsappOptIn: this.contactDraft.whatsappOptIn,
      })
      .subscribe({
        next: (updated) => {
          this.savingContact = false;
          this.applyBusinessUpdate(updated);
          this.dialogService.alert({
            title: 'Contacto guardado',
            message: 'Los datos del responsable quedaron registrados en la empresa.',
          });
        },
        error: (err) => {
          this.savingContact = false;
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo guardar el contacto.',
          });
        },
      });
  }

  private resetContactDraft(business: PublicBusinessInfo) {
    this.contactDraft = {
      ownerName: business.lifecycle?.ownerName?.trim() || '',
      email: business.contactVerification?.email?.trim() || '',
      phone: business.contactVerification?.phone?.trim() || '',
      pais: business.lifecycle?.pais?.trim() || '',
      ciudad: business.lifecycle?.ciudad?.trim() || '',
      whatsappOptIn: business.contactVerification?.whatsappOptIn === true,
    };
    this.invoiceEmailDraft = {
      to: business.contactVerification?.email?.trim() || '',
      periodo: business.periodoPagoActual || this.currentPeriodo(),
      notes: this.invoiceEmailDraft.notes || '',
    };
  }

  sendInvoiceEmail() {
    if (!this.business) return;
    const to = this.invoiceEmailDraft.to.trim();
    if (!to) {
      this.dialogService.alert({
        title: 'Email requerido',
        message: 'Cargá el email del responsable o escribí un destino.',
      });
      return;
    }
    this.sendingInvoiceEmail = true;
    this.platformService
      .sendBusinessInvoiceEmail(this.business.id, {
        to,
        periodo: this.invoiceEmailDraft.periodo.trim() || undefined,
        notes: this.invoiceEmailDraft.notes.trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.sendingInvoiceEmail = false;
          this.dialogService.alert({
            title: res.sent ? 'Detalle enviado' : 'Aviso registrado',
            message: res.message,
          });
        },
        error: (err) => {
          this.sendingInvoiceEmail = false;
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo enviar el detalle.',
          });
        },
      });
  }

  toggleTrial(enPrueba: boolean) {
    if (!this.business || enPrueba === this.business.enPrueba) return;
    this.togglingTrial = true;
    this.platformService.updateBusiness(this.business.id, { enPrueba }).subscribe({
      next: (updated) => {
        this.togglingTrial = false;
        this.business = { ...updated, planId: updated.planId };
      },
      error: () => {
        this.togglingTrial = false;
        this.dialogService.alert({ title: 'Error', message: 'No se pudo actualizar la prueba.' });
      },
    });
  }

  toggleSubscription(activa: boolean) {
    if (!this.business) return;
    const estado: SubscriptionStatus = activa ? 'activa' : 'suspendida';
    if (!activa) {
      this.dialogService
        .confirm({
          title: 'Desactivar suscripción',
          message: 'Los usuarios no podrán ingresar hasta reactivarla.',
          confirmLabel: 'Desactivar',
          variant: 'danger',
        })
        .subscribe((ok) => {
          if (ok) this.applySubscriptionStatus(estado);
        });
      return;
    }
    this.applySubscriptionStatus(estado);
  }

  private applySubscriptionStatus(estado: SubscriptionStatus) {
    if (!this.business) return;
    this.togglingSubscription = true;
    this.platformService.updateBusiness(this.business.id, { estadoSuscripcion: estado }).subscribe({
      next: (updated) => {
        this.togglingSubscription = false;
        this.business = { ...updated, planId: updated.planId };
      },
      error: () => {
        this.togglingSubscription = false;
        this.dialogService.alert({ title: 'Error', message: 'No se pudo actualizar la suscripción.' });
      },
    });
  }

  registerPayment() {
    if (!this.business) return;
    const periodo = this.paymentDraft.periodo.trim();
    const monto = Number(this.paymentDraft.monto);
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo)) {
      this.dialogService.alert({ title: 'Período inválido', message: 'Usá formato AAAA-MM.' });
      return;
    }
    if (!Number.isFinite(monto) || monto <= 0) {
      this.dialogService.alert({ title: 'Monto inválido', message: 'Ingresá un monto mayor a cero.' });
      return;
    }
    this.registeringPayment = true;
    this.platformService
      .registerBusinessPayment(this.business.id, {
        periodo,
        monto,
        fechaPago: this.paymentDraft.fechaPago || undefined,
        notas: this.paymentDraft.notas.trim() || undefined,
        coverageMonths: this.paymentDraft.coverageMonths,
      })
      .subscribe({
        next: () => {
          this.registeringPayment = false;
          this.loadPayments(this.business!.id);
          this.platformService.getBusiness(this.business!.id).subscribe({
            next: (updated) => {
              this.business = { ...updated, planId: updated.planId };
              this.resetPaymentDraft(updated);
            },
          });
        },
        error: (err) => {
          this.registeringPayment = false;
          this.dialogService.alert({
            title: 'Error',
            message: err?.error?.error || 'No se pudo registrar el pago.',
          });
        },
      });
  }

  private loadPayments(businessId: string) {
    this.loadingPayments = true;
    this.platformService.getBusinessPayments(businessId).subscribe({
      next: (payments) => {
        this.payments = payments;
        this.loadingPayments = false;
      },
      error: () => {
        this.payments = [];
        this.loadingPayments = false;
      },
    });
  }

  private loadHistory(businessId: string) {
    this.loadingHistory = true;
    this.platformService.getSubscriptionHistory(businessId).subscribe({
      next: (history) => {
        this.history = history;
        this.loadingHistory = false;
      },
      error: () => {
        this.history = [];
        this.loadingHistory = false;
      },
    });
  }

  private resetPaymentDraft(business: PublicBusinessInfo) {
    const today = new Date();
    const monthly = business.montoMensualEsperado || business.plan.precioMensual || 0;
    const coverageMonths = this.paymentDraft.coverageMonths > 1 ? 12 : 1;
    this.paymentDraft = {
      periodo: business.periodoPagoActual || this.currentPeriodo(today),
      monto: coverageMonths > 1 ? Math.round(monthly * 10) : monthly,
      fechaPago: today.toISOString().slice(0, 10),
      notas: '',
      coverageMonths,
    };
  }

  private currentPeriodo(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  formatMoney(value: number | undefined): string {
    return new Intl.NumberFormat('es-UY', {
      style: 'currency',
      currency: 'UYU',
      maximumFractionDigits: 0,
    }).format(value ?? 0);
  }

  formatPeriodo(periodo: string | undefined): string {
    if (!periodo) return '—';
    const [year, month] = periodo.split('-');
    const names = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${names[Number(month) - 1] ?? month} ${year}`;
  }

  formatDate(value: string | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('es-AR');
  }

  formatDateTime(value: string | undefined | null): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  }

  formatHistoryEntry(entry: SubscriptionHistoryEntry): string {
    const parts: string[] = [];
    if (entry.previousPlanId !== entry.newPlanId && entry.newPlanId) {
      parts.push(`Plan ${entry.previousPlanId ?? '—'} → ${entry.newPlanId}`);
    }
    if (entry.previousEnPrueba !== entry.newEnPrueba) {
      parts.push(entry.newEnPrueba ? 'Prueba activada' : 'Prueba finalizada');
    }
    if (!parts.length) parts.push(entry.changeType || 'Cambio comercial');
    return parts.join(' · ');
  }

  private paymentClass(status: PublicBusinessInfo['estadoPago']): string {
    switch (status) {
      case 'al_dia':
        return 'bg-green-100 text-green-800';
      case 'pendiente':
        return 'bg-amber-100 text-amber-800';
      case 'vencido':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }
}
