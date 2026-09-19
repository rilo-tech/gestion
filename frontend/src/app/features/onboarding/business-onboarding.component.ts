import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { BusinessService } from '../../core/services/business.service';
import { AutomationsService } from '../../core/services/automations.service';
import {
  defaultFeaturesForMode,
  type BusinessMode,
} from '../../../../../shared/business-profile.ts';
import {
  profileModeFromOnboarding,
  type StandardOnboardingAnswers,
} from '../../../../../shared/rilo-standard-config.ts';

@Component({
  selector: 'app-business-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-screen bg-gradient-to-b from-teal-50 to-white px-4 py-10">
      <div class="max-w-lg mx-auto">
        <div class="text-center mb-8">
          <h1 class="text-2xl font-bold text-gray-900">Empezá con RILO</h1>
          <p class="text-sm text-gray-600 mt-2">Pocas decisiones. El resto lo dejamos listo.</p>
        </div>

        <div *ngIf="auth.isCashOnlyTenant" class="rounded-xl border border-teal-200 bg-white p-5 space-y-3">
          <p class="text-sm text-gray-700">Registrá ingresos y gastos por WhatsApp o en Caja.</p>
          <button
            type="button"
            class="w-full rounded-xl bg-teal-600 text-white py-3 font-medium disabled:opacity-50"
            [disabled]="saving"
            (click)="completeCashOnly()">
            {{ saving ? 'Guardando…' : 'Ir a Caja' }}
          </button>
        </div>

        <ng-container *ngIf="!auth.isCashOnlyTenant">
          <div *ngIf="step === 1" class="space-y-3">
            <h2 class="font-semibold text-gray-900">¿Qué vendés?</h2>
            <button type="button" *ngFor="let opt of sellsOptions" (click)="answers.sells = opt.id; step = 2"
              class="w-full text-left rounded-xl border px-4 py-3 border-gray-200 hover:border-teal-500">
              <div class="font-medium">{{ opt.title }}</div>
              <div class="text-xs text-gray-500 mt-0.5">{{ opt.description }}</div>
            </button>
          </div>

          <div *ngIf="step === 2 && answers.sells !== 'services'" class="space-y-3">
            <h2 class="font-semibold text-gray-900">¿Manejás stock?</h2>
            <button type="button" (click)="answers.managesStock = true; step = 3"
              class="w-full rounded-xl border px-4 py-3 border-gray-200 hover:border-teal-500 text-left font-medium">Sí</button>
            <button type="button" (click)="answers.managesStock = false; step = 3"
              class="w-full rounded-xl border px-4 py-3 border-gray-200 hover:border-teal-500 text-left font-medium">No</button>
          </div>

          <div *ngIf="step === 2 && answers.sells === 'services'" class="space-y-3">
            <ng-container *ngIf="goToPaymentStep()"></ng-container>
          </div>

          <div *ngIf="step === 3" class="space-y-3">
            <h2 class="font-semibold text-gray-900">¿Cómo cobrás normalmente?</h2>
            <button type="button" *ngFor="let m of paymentOptions" (click)="answers.defaultPaymentMethod = m.id; step = 4"
              class="w-full rounded-xl border px-4 py-3 border-gray-200 hover:border-teal-500 text-left font-medium">{{ m.label }}</button>
          </div>

          <div *ngIf="step === 4" class="space-y-4">
            <h2 class="font-semibold text-gray-900">¿Querés que RILO te avise lo importante?</h2>
            <p class="text-sm text-gray-600">Pedidos de hoy, vencimientos, saldos y un resumen del día. Podés cambiarlo después.</p>
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" [(ngModel)]="answers.enableRecommendedAlerts" name="alerts" />
              Activar avisos recomendados
            </label>
            <button type="button" class="w-full rounded-xl bg-teal-600 text-white py-3 font-medium disabled:opacity-50"
              [disabled]="saving" (click)="finish()">
              {{ saving ? 'Guardando…' : 'Empezar con RILO' }}
            </button>
          </div>
        </ng-container>

        <p *ngIf="error" class="text-sm text-red-600 mt-4">{{ error }}</p>
      </div>
    </div>
  `,
})
export class BusinessOnboardingComponent implements OnInit {
  readonly auth = inject(AuthService);
  private business = inject(BusinessService);
  private automations = inject(AutomationsService);
  private router = inject(Router);

  step = 1;
  saving = false;
  error = '';
  answers: StandardOnboardingAnswers = {
    sells: 'both',
    managesStock: true,
    defaultPaymentMethod: 'efectivo',
    enableRecommendedAlerts: true,
  };

  sellsOptions = [
    { id: 'products' as const, title: 'Productos', description: 'Vendés cosas físicas.' },
    { id: 'services' as const, title: 'Servicios', description: 'Trabajos, turnos, honorarios.' },
    { id: 'both' as const, title: 'Ambos', description: 'Productos y servicios.' },
  ];

  paymentOptions = [
    { id: 'efectivo', label: 'Efectivo' },
    { id: 'transferencia', label: 'Transferencia' },
    { id: 'mercado_pago', label: 'Mercado Pago' },
    { id: 'otro', label: 'Otro' },
  ];

  ngOnInit() {
    if (this.auth.businessProfile.onboarding.completed) {
      void this.router.navigateByUrl(this.auth.homeRoute);
    }
  }

  goToPaymentStep() {
    this.answers.managesStock = false;
    this.step = 3;
    return true;
  }

  async completeCashOnly() {
    await this.persistProfile('cash_only', true);
  }

  async finish() {
    const mode = profileModeFromOnboarding(this.answers);
    await this.persistProfile(mode, true);
  }

  private async persistProfile(mode: BusinessMode, completed: boolean) {
    this.saving = true;
    this.error = '';
    try {
      const features = defaultFeaturesForMode(mode);
      if (mode !== 'cash_only' && this.answers.managesStock === false) {
        features.stock = false;
      }
      if (mode === 'services') {
        features.stock = false;
        features.products = false;
      }
      await this.business.updateProfile({
        version: 1,
        mode,
        enabledFeatures: features,
        defaults: {
          defaultPaymentMethod:
            this.answers.defaultPaymentMethod === 'otro'
              ? 'efectivo'
              : this.answers.defaultPaymentMethod || 'efectivo',
        },
        onboarding: {
          completed,
          step: completed ? 'done' : 'sells',
          completedAt: completed ? new Date().toISOString() : null,
        },
      });
      if (completed && mode !== 'cash_only' && this.answers.enableRecommendedAlerts) {
        try {
          await firstValueFrom(this.automations.enableRecommended());
        } catch {
          // Soft-fail: el perfil ya quedó listo; avisos se pueden activar después.
        }
      }
      await this.auth.refreshSession?.();
      void this.router.navigateByUrl(this.auth.homeRoute);
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'No se pudo guardar.';
    } finally {
      this.saving = false;
    }
  }
}
