import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import {
  SUBSCRIPTION_PAYMENT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
} from '../../../core/services/business.service';
import { formatMoneyValue } from '../../pipes/money.pipe';
import { productLabelForAccess } from '../../../../../../shared/platform-access.ts';

@Component({
  selector: 'app-plan-status-card',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  host: { class: 'block' },
  template: `
    <article
      *ngIf="business"
      class="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 sm:p-6">
      <h2 class="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">{{ heading }}</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {{ subtitle }}
      </p>

      <div class="space-y-3 text-sm">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-gray-500 dark:text-gray-400">Empresa</span>
          <span class="font-medium text-gray-900 dark:text-gray-100">{{ business.nombre }}</span>
          <span class="text-xs font-mono text-gray-400">({{ business.id }})</span>
        </div>

        <div class="rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-2">
          <p class="text-xs text-gray-500 dark:text-gray-400">Plan</p>
          <p class="font-medium text-gray-900 dark:text-gray-100">{{ productLabel }}</p>
        </div>

        <div class="rounded-lg px-3 py-2 border" [ngClass]="billingToneClass">
          <p class="text-xs text-gray-500 dark:text-gray-400">Estado y pago</p>
          <p class="font-medium text-gray-900 dark:text-gray-100">{{ billingHeadline }}</p>
          <p *ngIf="billingDetail" class="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
            {{ billingDetail }}
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div class="rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-2">
            <p class="text-xs text-gray-500 dark:text-gray-400">RILO Gestión</p>
            <p class="font-medium" [ngClass]="erpStatusClass">{{ erpStatusLabel }}</p>
          </div>
          <div class="rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-2">
            <p class="text-xs text-gray-500 dark:text-gray-400">RILO Bot</p>
            <p class="font-medium" [ngClass]="rilobotStatusClass">{{ rilobotStatusLabel }}</p>
          </div>
        </div>

        <div class="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-3 py-3 space-y-1.5">
          <p class="text-xs font-semibold text-gray-800 dark:text-gray-200">Alta y baja</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            <strong class="font-semibold text-gray-700 dark:text-gray-300">Dar de alta o sumar el otro</strong>
            se hace en Planes, con la misma cuenta. No te registres de nuevo.
          </p>
          <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            <strong class="font-semibold text-gray-700 dark:text-gray-300">Dar de baja</strong> se hace acá:
            el servicio queda inactivo. Los datos de la empresa no se borran.
          </p>
        </div>

        <div *ngIf="auth.isSupervisor" class="flex flex-wrap items-center gap-2">
          <a
            *ngIf="showAddWhatsappLink"
            routerLink="/planes"
            [queryParams]="{ sumar: 'whatsapp' }"
            class="inline-flex justify-center items-center rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 px-4 py-2 text-sm font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/50">
            {{ auth.isWhatsappPaused ? 'Reactivar RILO Bot en Planes' : 'Sumar RILO Bot en Planes' }}
          </a>
          <a
            *ngIf="showAddErpLink"
            routerLink="/planes"
            [queryParams]="{ sumar: 'erp' }"
            class="inline-flex justify-center items-center rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 px-4 py-2 text-sm font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/50">
            {{ auth.isErpPaused ? 'Reactivar RILO Gestión en Planes' : 'Sumar RILO Gestión en Planes' }}
          </a>
          <a
            routerLink="/activar-suscripcion"
            class="inline-flex justify-center items-center rounded-lg border border-teal-200 dark:border-teal-800 px-4 py-2 text-sm font-semibold text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40">
            Ver planes y pago
          </a>
        </div>

        <section
          *ngIf="auth.isSupervisor && (canPauseWhatsapp || canPauseErp)"
          class="rounded-xl border border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 px-4 py-4 space-y-3">
          <div>
            <p class="text-sm font-bold text-red-800 dark:text-red-300">Dar de baja</p>
            <p class="text-xs text-red-800/80 dark:text-red-300/80 mt-1 leading-relaxed">
              El servicio deja de funcionar y la suscripción queda inactiva.
              Los clientes, productos, ventas y el resto de la empresa no se eliminan.
            </p>
          </div>

          <div *ngIf="!pendingBaja" class="flex flex-col sm:flex-row gap-2">
            <button
              *ngIf="canPauseWhatsapp"
              type="button"
              (click)="startBaja('whatsapp')"
              [disabled]="enabling"
              class="inline-flex justify-center items-center rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
              Dar de baja RILO Bot
            </button>
            <button
              *ngIf="canPauseErp"
              type="button"
              (click)="startBaja('erp')"
              [disabled]="enabling"
              class="inline-flex justify-center items-center rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
              Dar de baja RILO Gestión
            </button>
          </div>

          <div *ngIf="pendingBaja" class="space-y-3">
            <p class="text-sm font-medium text-red-900 dark:text-red-200">
              {{ pendingBaja === 'whatsapp' ? 'Confirmar baja de RILO Bot' : 'Confirmar baja de RILO Gestión' }}
            </p>
            <p class="text-xs text-red-800/90 dark:text-red-300/90 leading-relaxed">{{ bajaHint }}</p>
            <label *ngIf="requiresPassword" class="block">
              <span class="block text-xs font-medium text-red-900 dark:text-red-200 mb-1">Tu contraseña</span>
              <input
                type="password"
                [(ngModel)]="bajaPassword"
                name="bajaPassword"
                autocomplete="current-password"
                class="w-full max-w-xs px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-gray-950 text-sm text-gray-900 dark:text-gray-100">
            </label>
            <label *ngIf="!requiresPassword" class="block">
              <span class="block text-xs font-medium text-red-900 dark:text-red-200 mb-1">
                Escribí el nombre de la empresa para confirmar ({{ business?.nombre }})
              </span>
              <input
                type="text"
                [(ngModel)]="bajaConfirmNombre"
                name="bajaConfirmNombre"
                autocomplete="off"
                class="w-full max-w-xs px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-gray-950 text-sm text-gray-900 dark:text-gray-100">
            </label>
            <p *ngIf="enableError" class="text-xs text-red-700 dark:text-red-400">{{ enableError }}</p>
            <div class="flex flex-wrap gap-3">
              <button
                type="button"
                (click)="confirmBaja()"
                [disabled]="enabling || !canSubmitBaja"
                class="inline-flex rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
                {{ enabling ? 'Dando de baja…' : 'Confirmar baja' }}
              </button>
              <button
                type="button"
                (click)="cancelBaja()"
                [disabled]="enabling"
                class="text-sm text-gray-600 dark:text-gray-400 hover:underline">
                Cancelar
              </button>
            </div>
          </div>
        </section>
      </div>
    </article>
  `,
})
export class PlanStatusCardComponent {
  readonly auth = inject(AuthService);

  /** `home`: copy para clientes solo WhatsApp. `settings`: copy dentro del ERP. */
  @Input() variant: 'home' | 'settings' = 'settings';

  enabling = false;
  enableError = '';
  pendingBaja: 'whatsapp' | 'erp' | null = null;
  bajaPassword = '';
  bajaConfirmNombre = '';

  get business() {
    return this.auth.currentBusiness;
  }

  get productLabel(): string {
    return productLabelForAccess(this.auth.platformAccess);
  }

  get heading(): string {
    return this.variant === 'home' ? 'Tu plan' : 'Plan, pago y canales';
  }

  get subtitle(): string {
    if (this.variant === 'home') {
      return 'Estado de tu prueba o suscripción. El trabajo del día a día es por WhatsApp.';
    }
    return 'Suscripción de la empresa: qué está activo, qué se da de baja acá y qué se suma desde Planes.';
  }

  get isTrialActive(): boolean {
    return this.business?.enPrueba === true && this.business?.trialStatus === 'active';
  }

  get isTrialExpired(): boolean {
    return this.auth.isTrialExpired;
  }

  get isLitePlan(): boolean {
    return this.auth.isLitePlan;
  }

  get isPaidOk(): boolean {
    return (
      !this.isTrialActive &&
      !this.isLitePlan &&
      !this.isTrialExpired &&
      this.business?.estadoSuscripcion === 'activa' &&
      this.business?.estadoPago === 'al_dia'
    );
  }

  get isPaymentIssue(): boolean {
    if (this.isTrialActive || this.isLitePlan || this.isTrialExpired) return false;
    return (
      this.auth.isPaymentOverdue ||
      this.auth.isPaymentPending ||
      this.auth.isPaymentDueSoon ||
      this.business?.estadoSuscripcion === 'suspendida' ||
      this.business?.estadoSuscripcion === 'vencida'
    );
  }

  get billingToneClass(): string {
    if (this.isTrialActive) {
      return 'bg-violet-50 border-violet-100 dark:bg-violet-950/40 dark:border-violet-900';
    }
    if (this.isLitePlan || this.isTrialExpired) {
      return 'bg-amber-50 border-amber-100 dark:bg-amber-950/40 dark:border-amber-900';
    }
    if (this.isPaidOk) {
      return 'bg-teal-50 border-teal-100 dark:bg-teal-950/40 dark:border-teal-900';
    }
    if (this.isPaymentIssue) {
      return 'bg-orange-50 border-orange-100 dark:bg-orange-950/40 dark:border-orange-900';
    }
    return 'border-gray-100 dark:border-gray-700';
  }

  get billingHeadline(): string {
    if (this.isTrialActive) return 'Prueba gratuita activa';
    if (this.isLitePlan || this.isTrialExpired) return 'Prueba vencida';
    const status = this.business?.estadoSuscripcion;
    if (status && status !== 'activa') {
      return SUBSCRIPTION_STATUS_LABELS[status];
    }
    const pago = this.business?.estadoPago;
    return pago ? `Suscripción activa · ${SUBSCRIPTION_PAYMENT_STATUS_LABELS[pago]}` : 'Suscripción activa';
  }

  get billingDetail(): string {
    const parts: string[] = [];
    if (this.isTrialActive) {
      const days = this.auth.trialDaysRemaining;
      if (days != null) {
        parts.push(`Quedan ${days} día${days === 1 ? '' : 's'}`);
      }
      const end = this.formatDate(this.business?.trialEndDate);
      if (end) parts.push(`vence ${end}`);
    } else if (this.isLitePlan || this.isTrialExpired) {
      const end = this.formatDate(this.business?.trialEndDate);
      parts.push(
        end
          ? `Venció el ${end}. Tus datos siguen. Activá un plan para continuar usando RILO.`
          : 'Tus datos siguen. Activá un plan para continuar usando RILO.'
      );
    } else {
      const until = this.formatDate(this.business?.paidUntil);
      if (until) {
        const days = this.auth.paymentDaysRemaining;
        if (days != null && days >= 0) {
          parts.push(`Cubierto hasta ${until} (${days} día${days === 1 ? '' : 's'})`);
        } else if (days != null && days < 0) {
          parts.push(`Cobertura venció el ${until}`);
        } else {
          parts.push(`Cubierto hasta ${until}`);
        }
      }
      const interval = this.business?.billingInterval;
      if (interval === 'year') parts.push('Facturación anual');
      else if (interval === 'month') parts.push('Facturación mensual');
      const amount = this.business?.montoMensualEsperado;
      if (typeof amount === 'number' && amount > 0) {
        parts.push(`Cuota ${formatMoneyValue(amount)} / mes`);
      }
      if (this.business?.ultimoPagoFecha) {
        const paidOn = this.formatDate(this.business.ultimoPagoFecha);
        const paidAmount =
          typeof this.business.ultimoPagoMonto === 'number'
            ? formatMoneyValue(this.business.ultimoPagoMonto)
            : '';
        parts.push(
          paidAmount && paidOn ? `Último pago ${paidAmount} el ${paidOn}` : `Último pago ${paidOn || paidAmount}`
        );
      }
    }
    return parts.join(' · ');
  }

  get erpStatusLabel(): string {
    if (this.auth.canAccessErpWeb) return 'Activo';
    if (this.auth.isErpPaused) return 'Inactivo';
    return 'No incluido';
  }

  get erpStatusClass(): string {
    if (this.auth.canAccessErpWeb) return 'text-teal-700 dark:text-teal-400';
    if (this.auth.isErpPaused) return 'text-amber-700 dark:text-amber-400';
    return 'text-gray-400';
  }

  get rilobotStatusLabel(): string {
    if (this.auth.canAccessWhatsapp) return 'Activo';
    if (this.auth.isWhatsappPaused) return 'Inactivo';
    return 'No incluido';
  }

  get rilobotStatusClass(): string {
    if (this.auth.canAccessWhatsapp) return 'text-teal-700 dark:text-teal-400';
    if (this.auth.isWhatsappPaused) return 'text-amber-700 dark:text-amber-400';
    return 'text-gray-400';
  }

  get canPauseWhatsapp(): boolean {
    return this.auth.canAccessWhatsapp;
  }

  get canPauseErp(): boolean {
    return this.auth.canAccessErpWeb;
  }

  get showAddWhatsappLink(): boolean {
    return !this.auth.canAccessWhatsapp;
  }

  get showAddErpLink(): boolean {
    return !this.auth.canAccessErpWeb;
  }

  get requiresPassword(): boolean {
    return this.auth.currentUser?.hasPassword !== false;
  }

  get canSubmitBaja(): boolean {
    if (this.requiresPassword) return this.bajaPassword.trim().length > 0;
    return this.bajaConfirmNombre.trim().length > 0;
  }

  get bajaHint(): string {
    const onlyChannel =
      (this.pendingBaja === 'whatsapp' && !this.auth.canAccessErpWeb) ||
      (this.pendingBaja === 'erp' && !this.auth.canAccessWhatsapp);
    if (onlyChannel) {
      return 'Vas a quedar sin este servicio. La suscripción queda inactiva. Los datos de la empresa no se borran. Para volver, entrá a Planes con la misma cuenta.';
    }
    if (this.pendingBaja === 'whatsapp') {
      return 'RILO Bot deja de responder. RILO Gestión sigue. Los datos no se borran. Para reactivarlo, andá a Planes.';
    }
    return 'Dejás de entrar a RILO Gestión. Si tenés RILO Bot, seguís por WhatsApp. Los datos no se borran. Para reactivar RILO Gestión, andá a Planes.';
  }

  startBaja(product: 'whatsapp' | 'erp') {
    this.pendingBaja = product;
    this.enableError = '';
    this.bajaPassword = '';
    this.bajaConfirmNombre = '';
  }

  cancelBaja() {
    this.pendingBaja = null;
    this.enableError = '';
    this.bajaPassword = '';
    this.bajaConfirmNombre = '';
  }

  confirmBaja() {
    const product = this.pendingBaja;
    if (!product || this.enabling || !this.canSubmitBaja) return;
    this.enabling = true;
    this.enableError = '';
    this.auth
      .disableProduct(product, {
        password: this.requiresPassword ? this.bajaPassword : undefined,
        confirmNombre: this.requiresPassword ? undefined : this.bajaConfirmNombre,
      })
      .subscribe({
        next: () => {
          this.enabling = false;
          this.cancelBaja();
        },
        error: (err: { error?: { error?: string } }) => {
          this.enabling = false;
          this.enableError = err?.error?.error || 'No se pudo dar de baja.';
        },
      });
  }

  private formatDate(value?: string | null): string {
    if (!value) return '';
    const iso = value.includes('T') ? value : `${value.slice(0, 10)}T12:00:00`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return value.slice(0, 10);
    return date.toLocaleDateString('es-AR');
  }
}
