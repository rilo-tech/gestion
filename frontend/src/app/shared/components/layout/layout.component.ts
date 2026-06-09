import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopbarComponent } from '../topbar/topbar.component';
import { AppDialogComponent } from '../app-dialog/app-dialog.component';
import { LayoutNavService } from '../../../core/services/layout-nav.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent, TopbarComponent, AppDialogComponent],
  template: `
    <div class="flex h-screen bg-gray-50 overflow-hidden">
      <button
        *ngIf="nav.mobileMenuOpen()"
        type="button"
        class="fixed inset-0 z-[70] bg-gray-900/50 backdrop-blur-[1px] lg:hidden"
        aria-label="Cerrar menú"
        (click)="nav.closeMobileMenu()">
      </button>

      <app-sidebar></app-sidebar>
      <app-dialog></app-dialog>

      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <app-topbar></app-topbar>
        <main class="flex-1 overflow-y-auto overflow-x-hidden">
          <router-outlet></router-outlet>
        </main>
      </div>
    </div>
  `,
})
export class LayoutComponent {
  readonly nav = inject(LayoutNavService);
}
