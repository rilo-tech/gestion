import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TrialRegistrationService } from '../../core/services/trial-registration.service';

@Component({
  selector: 'app-trial-verify-email',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="min-h-screen bg-gray-950 flex items-center justify-center p-4 text-white">
      <div class="max-w-md w-full text-center space-y-4">
        <h1 class="text-xl font-bold text-teal-400">Verificación de email</h1>
        <p *ngIf="loading" class="text-gray-400">Verificando...</p>
        <p *ngIf="!loading && success" class="text-green-400">Email verificado correctamente.</p>
        <p *ngIf="!loading && error" class="text-red-400">{{ error }}</p>
        <a *ngIf="!loading" routerLink="/login" class="inline-block text-teal-400 hover:underline text-sm">
          Ir al inicio de sesión
        </a>
      </div>
    </div>
  `,
})
export class TrialVerifyEmailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private trialService = inject(TrialRegistrationService);

  loading = true;
  success = false;
  error = '';

  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!token) {
      this.loading = false;
      this.error = 'Enlace inválido.';
      return;
    }
    this.trialService.verifyEmail(token).subscribe({
      next: () => {
        this.loading = false;
        this.success = true;
      },
      error: () => {
        this.loading = false;
        this.error = 'No se pudo verificar el email. El enlace puede haber vencido.';
      },
    });
  }
}
