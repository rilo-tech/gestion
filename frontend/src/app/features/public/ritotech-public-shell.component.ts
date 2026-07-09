import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-ritotech-public-shell',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <div class="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-teal-950 text-white">
      <header class="border-b border-white/10 bg-gray-950/80 backdrop-blur sticky top-0 z-20">
        <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <a routerLink="/" class="text-lg font-bold text-teal-400 tracking-tight shrink-0">RiloTech</a>
          <nav class="hidden sm:flex items-center gap-5 text-sm text-gray-300">
            <a routerLink="/rilo-gestion" routerLinkActive="text-white" class="hover:text-white">ERP Web</a>
            <a routerLink="/whatsapp" routerLinkActive="text-white" class="hover:text-white">WhatsApp</a>
            <a routerLink="/planes" routerLinkActive="text-white" class="hover:text-white">Planes</a>
            <a routerLink="/" fragment="landing-faq" class="hover:text-white hidden md:inline">FAQ</a>
          </nav>
          <div class="flex items-center gap-2 shrink-0">
            <a
              routerLink="/login"
              class="hidden sm:inline-flex px-3 py-1.5 text-sm text-gray-300 hover:text-white">
              Ingresar
            </a>
            <a
              routerLink="/registro"
              class="inline-flex rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold hover:bg-teal-500">
              Probar gratis
            </a>
          </div>
        </div>
      </header>
      <main>
        <ng-content></ng-content>
      </main>
      <footer class="border-t border-white/10 mt-16 py-8 text-center text-xs text-gray-500">
        <p>RiloTech · RILO Gestión · Controlá tu negocio desde WhatsApp y desde el panel web.</p>
        <p class="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
          <a routerLink="/legal/terminos" class="hover:text-gray-300">Términos</a>
          <a routerLink="/legal/privacidad" class="hover:text-gray-300">Privacidad</a>
          <a routerLink="/acceso-plataforma" class="hover:text-gray-300">Acceso plataforma</a>
        </p>
      </footer>
    </div>
  `,
})
export class RitotechPublicShellComponent {}
