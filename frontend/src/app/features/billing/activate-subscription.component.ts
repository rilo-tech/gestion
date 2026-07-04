import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-activate-subscription',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div class="max-w-lg w-full rounded-2xl border border-amber-200 bg-white shadow-sm p-6 sm:p-8 text-center space-y-4">
        <div class="inline-flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-2xl">⏱</div>
        <h1 class="text-xl font-bold text-gray-900">Tu prueba gratuita finalizó</h1>
        <p class="text-sm text-gray-600 leading-relaxed">
          Tus datos están guardados. Para seguir usando Rilo Gestión, activá tu suscripción o escribinos si necesitás ayuda.
        </p>
        <div class="rounded-xl bg-gray-50 border border-gray-100 p-4 text-sm text-gray-700">
          <p class="font-medium text-gray-900 mb-1">Próximo paso: pago con Mercado Pago</p>
          <p>La activación online se habilitará en breve. Mientras tanto, contactá a RILO para convertir tu cuenta.</p>
        </div>
        <a
          *ngIf="whatsappUrl"
          [href]="whatsappUrl"
          target="_blank"
          rel="noopener"
          class="block w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700">
          Escribir por WhatsApp
        </a>
        <a routerLink="/mi-cuenta" class="block text-sm text-teal-700 hover:underline">Mi cuenta</a>
        <button type="button" (click)="logout()" class="block w-full text-sm text-gray-500 hover:text-gray-800">
          Cerrar sesión
        </button>
      </div>
    </div>
  `,
})
export class ActivateSubscriptionComponent {
  private auth = inject(AuthService);
  readonly whatsappUrl =
    (import.meta as { env?: Record<string, string> }).env?.['VITE_SUPPORT_WHATSAPP_URL'] ?? '';

  logout() {
    this.auth.logout();
  }
}
