import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  getLegalDocument,
  type LegalDocument,
  type LegalDocumentId,
} from '../../../../../shared/legal-documents.ts';

@Component({
  selector: 'app-legal-document-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950 text-gray-100">
      <header class="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div class="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <p class="text-teal-400 font-bold tracking-tight">RILO Gestión</p>
            <h1 class="text-lg sm:text-xl font-semibold text-white mt-0.5">{{ document.title }}</h1>
          </div>
          <button
            type="button"
            (click)="closePage()"
            class="text-sm text-gray-400 hover:text-white shrink-0">
            Cerrar
          </button>
        </div>
      </header>

      <main class="max-w-3xl mx-auto px-4 py-8 sm:py-10">
        <p class="text-sm text-gray-400">{{ document.subtitle }}</p>
        <p class="text-xs text-gray-500 mt-2">
          Versión {{ document.version }} · Actualizado el {{ document.lastUpdated }}
        </p>

        <article class="mt-8 space-y-8">
          <section *ngFor="let section of document.sections" class="space-y-3">
            <h2 class="text-base font-semibold text-teal-300">{{ section.title }}</h2>
            <p
              *ngFor="let paragraph of section.paragraphs"
              class="text-sm leading-relaxed text-gray-300">
              {{ paragraph }}
            </p>
          </section>
        </article>

        <footer class="mt-12 pt-6 border-t border-gray-800 flex flex-wrap gap-4 text-sm">
          <a
            *ngIf="document.id !== 'terms'"
            routerLink="/legal/terminos"
            class="text-teal-400 hover:underline">
            Ver términos de uso
          </a>
          <a
            *ngIf="document.id !== 'privacy'"
            routerLink="/legal/privacidad"
            class="text-teal-400 hover:underline">
            Ver política de privacidad
          </a>
          <a routerLink="/probar-gratis" class="text-gray-400 hover:text-white hover:underline">
            Volver al registro
          </a>
        </footer>
      </main>
    </div>
  `,
})
export class LegalDocumentPageComponent {
  private route = inject(ActivatedRoute);

  readonly document: LegalDocument = getLegalDocument(this.resolveDocumentId());

  private resolveDocumentId(): LegalDocumentId {
    const id = String(this.route.snapshot.data['doc'] ?? '');
    return id === 'privacy' ? 'privacy' : 'terms';
  }

  closePage() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.close();
  }
}
