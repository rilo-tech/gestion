import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { LayoutNavService } from '../../../core/services/layout-nav.service';
import { filter, Subscription } from 'rxjs';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, LucideAngularModule],
  template: `
    <aside
      class="fixed inset-y-0 left-0 z-50 flex h-screen w-[min(18rem,85vw)] shrink-0 flex-col bg-gray-900 text-white transition-transform duration-200 ease-out -translate-x-full lg:static lg:z-auto lg:w-64 lg:translate-x-0"
      [class.translate-x-0]="nav.mobileMenuOpen()">
      <div class="flex items-center justify-between px-4 py-4 sm:px-6 sm:py-5">
        <div class="min-w-0">
          <h1 class="text-lg sm:text-xl font-bold tracking-tight text-teal-400 truncate">RILO Gestión</h1>
          <p class="text-[11px] text-gray-500 mt-1">Panel de gestión</p>
        </div>
        <button
          type="button"
          class="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white"
          aria-label="Cerrar menú"
          (click)="nav.closeMobileMenu()">
          <i-lucide name="x" class="w-5 h-5"></i-lucide>
        </button>
      </div>

      <nav class="flex-1 px-3 pb-4 flex flex-col min-h-0">
        <div class="space-y-0.5 overflow-y-auto flex-1">
          <a
            *ngFor="let item of navItems"
            [routerLink]="item.path"
            routerLinkActive="bg-gray-800 text-teal-400 shadow-sm"
            (click)="nav.closeMobileMenu()"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/80 transition-colors">
            <i-lucide [name]="item.icon" class="w-5 h-5 shrink-0"></i-lucide>
            <span class="text-sm font-medium">{{ item.label }}</span>
          </a>
        </div>

        <div class="mt-3 pt-3 border-t border-gray-800 shrink-0">
          <a
            routerLink="/settings"
            routerLinkActive="bg-gray-800 text-teal-400 shadow-sm"
            (click)="nav.closeMobileMenu()"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/80 transition-colors">
            <i-lucide name="settings" class="w-5 h-5 shrink-0"></i-lucide>
            <span class="text-sm font-medium">Configuración</span>
          </a>
        </div>
      </nav>
    </aside>
  `,
})
export class SidebarComponent implements OnInit, OnDestroy {
  readonly nav = inject(LayoutNavService);
  private router = inject(Router);
  private routerSub?: Subscription;

  readonly navItems = [
    { path: '/dashboard', icon: 'layout-dashboard', label: 'Dashboard' },
    { path: '/clients', icon: 'users', label: 'Clientes' },
    { path: '/stock', icon: 'package', label: 'Stock' },
    { path: '/purchases', icon: 'truck', label: 'Compras' },
    { path: '/orders', icon: 'clipboard-list', label: 'Pedidos' },
    { path: '/sales', icon: 'shopping-cart', label: 'Ventas' },
    { path: '/cash', icon: 'wallet', label: 'Caja' },
    { path: '/reports', icon: 'bar-chart-3', label: 'Reportes' },
  ] as const;

  ngOnInit() {
    this.routerSub = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.nav.closeMobileMenu());
  }

  ngOnDestroy() {
    this.routerSub?.unsubscribe();
  }
}
