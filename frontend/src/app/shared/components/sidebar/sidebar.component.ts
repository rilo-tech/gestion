import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { LayoutNavService } from '../../../core/services/layout-nav.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  isModuleSubRoute,
  normalizeListPath,
} from '../../../core/utils/list-page-refresh';
import { filter, Subscription } from 'rxjs';

interface NavItem {
  path: string;
  icon: string;
  label: string;
  visible?: () => boolean;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, LucideAngularModule],
  template: `
    <aside
      class="app-sidebar fixed inset-y-0 left-0 z-[80] flex h-screen w-[min(18rem,85vw)] shrink-0 flex-col bg-gray-900 text-white transition-transform duration-200 ease-out -translate-x-full lg:static lg:z-auto lg:w-64 lg:translate-x-0"
      [class.translate-x-0]="nav.mobileMenuOpen()">
      <div class="flex items-center justify-between px-4 py-4 sm:px-6 sm:py-5">
        <div class="min-w-0">
          <h1 class="text-lg sm:text-xl font-bold tracking-tight text-teal-400 truncate">{{ auth.appBrandTitle }}</h1>
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
            *ngFor="let item of visibleNavItems"
            [routerLink]="item.path"
            routerLinkActive="bg-gray-800 text-teal-400 shadow-sm"
            (click)="onModuleNavClick($event, item)"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/80 transition-colors">
            <i-lucide [name]="item.icon" class="w-5 h-5 shrink-0"></i-lucide>
            <span class="text-sm font-medium">{{ item.label }}</span>
          </a>
        </div>

        <div *ngIf="auth.canManageSettings && auth.canAccessErpWeb" class="mt-3 pt-3 border-t border-gray-800 shrink-0 space-y-0.5">
          <a
            *ngIf="auth.canManageSettings"
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
  readonly auth = inject(AuthService);
  private router = inject(Router);
  private routerSub?: Subscription;

  readonly companyNavItems: NavItem[] = [
    { path: '/dashboard', icon: 'layout-dashboard', label: 'Inicio' },
    { path: '/clients', icon: 'users', label: 'Clientes' },
    { path: '/suppliers', icon: 'building-2', label: 'Proveedores' },
    { path: '/stock', icon: 'package', label: 'Stock' },
    {
      path: '/purchases',
      icon: 'truck',
      label: 'Compras',
      visible: () => this.auth.canAccessPurchases,
    },
    {
      path: '/orders',
      icon: 'clipboard-list',
      label: 'Pedidos',
      visible: () => this.auth.canAccessOrders,
    },
    {
      path: '/cash',
      icon: 'wallet',
      label: 'Caja',
      visible: () => this.auth.canAccessCash,
    },
    {
      path: '/sales',
      icon: 'shopping-cart',
      label: 'Ventas',
      visible: () => this.auth.canAccessSales,
    },
    {
      path: '/price-catalog',
      icon: 'tags',
      label: 'Precios de venta',
      visible: () => this.auth.canViewPriceCatalog,
    },
    {
      path: '/payables',
      icon: 'calendar',
      label: 'Cuentas a pagar',
      visible: () => this.auth.canAccessPayables,
    },
    {
      path: '/collaborators',
      icon: 'id-card',
      label: 'Colaboradores',
      visible: () => this.auth.canAccessCollaborators,
    },
    {
      path: '/reports',
      icon: 'bar-chart-3',
      label: 'Reportes',
      visible: () => this.auth.canViewReports,
    },
  ];

  readonly platformNavItems: NavItem[] = [
    { path: '/platform', icon: 'building-2', label: 'Empresas y planes' },
  ];

  get navItems(): NavItem[] {
    if (this.auth.isPlatformAdmin) return this.platformNavItems;
    if (!this.auth.canAccessErpWeb) {
      return [{ path: '/mi-cuenta', icon: 'user-cog', label: 'Mi cuenta' }];
    }
    return this.companyNavItems;
  }

  get visibleNavItems(): NavItem[] {
    return this.navItems.filter((item) => !item.visible || item.visible());
  }

  ngOnInit() {
    this.routerSub = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.nav.closeMobileMenu());
  }

  /**
   * Volver a la grilla del módulo al re-tocar su ítem del menú
   * (como el botón «Volver»), incluso si venís de un formulario o detalle.
   */
  onModuleNavClick(event: MouseEvent, item: NavItem) {
    event.preventDefault();
    this.nav.closeMobileMenu();

    const target = normalizeListPath(item.path);
    const current = normalizeListPath(this.router.url);

    if (current === target) {
      this.nav.requestListRoot(target);
      return;
    }

    if (isModuleSubRoute(current, target)) {
      void this.router.navigateByUrl(target);
      return;
    }

    void this.router.navigateByUrl(target);
  }

  ngOnDestroy() {
    this.routerSub?.unsubscribe();
  }
}
