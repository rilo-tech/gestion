import { Component, HostListener, inject, OnInit, OnDestroy } from '@angular/core';
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
  group?: 'primary' | 'more';
  section?: 'operacion' | 'admin';
  visible?: () => boolean;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, LucideAngularModule],
  host: { style: 'display: contents' },
  template: `
    <!-- Sidebar principal: solo nav core + Configuración -->
    <aside
      class="app-sidebar fixed inset-y-0 left-0 z-[80] flex h-dvh max-h-dvh w-[min(18rem,85vw)] shrink-0 flex-col bg-gray-900 text-white transition-transform duration-200 ease-out -translate-x-full lg:static lg:z-auto lg:h-screen lg:max-h-screen lg:w-56 lg:translate-x-0"
      [class.translate-x-0]="nav.mobileMenuOpen()"
      role="navigation"
      aria-label="Navegación principal"
      data-sidebar-primary>
      <div class="flex items-center justify-between px-3 py-3 sm:px-4 sm:py-4 shrink-0">
        <div class="min-w-0">
          <h1 class="text-base sm:text-lg font-bold tracking-tight text-teal-400 truncate">{{ auth.appBrandTitle }}</h1>
        </div>
        <button
          type="button"
          class="lg:hidden inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white"
          aria-label="Cerrar menú"
          (click)="nav.closeMobileMenu()">
          <i-lucide name="x" class="w-5 h-5"></i-lucide>
        </button>
      </div>

      <!-- Mobile: vista herramientas (segunda capa del drawer) -->
      <nav
        *ngIf="isMobileToolsView"
        class="flex flex-1 flex-col min-h-0 px-2 pb-3 sm:px-3 lg:hidden"
        aria-label="Herramientas"
        data-mobile-tools-view>
        <button
          type="button"
          class="mb-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800/70 hover:text-white min-h-11"
          (click)="nav.showMobileMain()">
          <i-lucide name="chevron-left" class="w-4 h-4 shrink-0"></i-lucide>
          <span>Volver</span>
        </button>
        <p class="px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          Herramientas
        </p>
        <div class="flex flex-col gap-0.5 overflow-y-auto min-h-0">
          <ng-container *ngTemplateOutlet="toolsLinks"></ng-container>
        </div>
      </nav>

      <!-- Vista principal (desktop siempre; mobile cuando no estamos en herramientas) -->
      <nav
        *ngIf="!isMobileToolsView"
        class="flex flex-1 flex-col min-h-0 px-2 pb-3 sm:px-3"
        aria-label="Módulos principales">
        <div class="flex flex-col gap-0.5 shrink-0">
          <a
            *ngFor="let item of primaryNavItems"
            [routerLink]="item.path"
            routerLinkActive="bg-gray-800/80 text-teal-400"
            [routerLinkActiveOptions]="{ exact: item.path === '/platform' || item.path === '/inicio' || item.path === '/dashboard' }"
            (click)="onModuleNavClick($event, item)"
            class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800/70 hover:text-white transition-colors min-h-10">
            <i-lucide [name]="item.icon" class="w-[1.125rem] h-[1.125rem] shrink-0 opacity-90"></i-lucide>
            <span class="truncate">{{ item.label }}</span>
          </a>

          <button
            *ngIf="moreNavItems.length"
            type="button"
            class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors min-h-10"
            [class.bg-gray-800/80]="toolsActiveHighlight"
            [class.text-teal-400]="toolsActiveHighlight"
            [class.text-gray-300]="!toolsActiveHighlight"
            [class.hover:bg-gray-800/70]="!toolsActiveHighlight"
            [class.hover:text-white]="!toolsActiveHighlight"
            [attr.aria-expanded]="toolsExpanded"
            aria-controls="tools-rail-panel"
            data-tools-toggle
            (click)="onToolsToggle($event)">
            <i-lucide name="layout-grid" class="w-[1.125rem] h-[1.125rem] shrink-0 opacity-90"></i-lucide>
            <span class="flex-1 text-left truncate">Herramientas</span>
            <i-lucide
              [name]="toolsExpanded ? 'chevron-left' : 'chevron-right'"
              class="hidden lg:block w-4 h-4 shrink-0 text-gray-500"></i-lucide>
            <i-lucide name="chevron-right" class="lg:hidden w-4 h-4 shrink-0 text-gray-500"></i-lucide>
          </button>
        </div>

        <div class="mt-auto pt-3 shrink-0">
          <div *ngIf="!auth.isPlatformAdmin && auth.canManageSettings && auth.canAccessErpWeb" class="border-t border-gray-800 pt-2">
            <a
              routerLink="/settings"
              routerLinkActive="bg-gray-800/80 text-teal-400"
              (click)="nav.closeMobileMenu()"
              class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800/70 hover:text-white transition-colors min-h-10">
              <i-lucide name="settings" class="w-[1.125rem] h-[1.125rem] shrink-0 opacity-90"></i-lucide>
              <span class="truncate">Configuración</span>
            </a>
          </div>
        </div>
      </nav>
    </aside>

    <!-- Desktop: rail acoplado (parte del layout, empuja el contenido) -->
    <aside
      *ngIf="moreNavItems.length"
      id="tools-rail-panel"
      class="app-tools-rail hidden lg:flex shrink-0 flex-col bg-gray-950 text-white overflow-hidden transition-[width,opacity] duration-200 ease-out"
      [class.border-r]="nav.toolsRailOpen()"
      [class.border-gray-800/80]="nav.toolsRailOpen()"
      [class.w-56]="nav.toolsRailOpen()"
      [class.w-0]="!nav.toolsRailOpen()"
      [class.opacity-100]="nav.toolsRailOpen()"
      [class.opacity-0]="!nav.toolsRailOpen()"
      [attr.aria-hidden]="!nav.toolsRailOpen()"
      role="navigation"
      aria-label="Herramientas"
      data-tools-rail>
      <div class="flex w-56 flex-col h-full min-h-0">
        <div class="flex items-center justify-between gap-2 px-3 py-3 sm:px-4 sm:py-4 shrink-0 border-b border-gray-800/80">
          <p class="text-sm font-semibold text-gray-100 truncate">Herramientas</p>
          <button
            type="button"
            class="inline-flex items-center justify-center min-h-10 min-w-10 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white"
            aria-label="Cerrar herramientas"
            (click)="nav.closeToolsRail()">
            <i-lucide name="x" class="w-4 h-4"></i-lucide>
          </button>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto px-2 py-3 sm:px-3 space-y-3">
          <ng-container *ngTemplateOutlet="toolsLinks"></ng-container>
        </div>
      </div>
    </aside>

    <ng-template #toolsLinks>
      <div *ngIf="operacionMoreItems.length">
        <p class="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Operación
        </p>
        <div class="flex flex-col gap-0.5">
          <a
            *ngFor="let item of operacionMoreItems"
            [routerLink]="item.path"
            routerLinkActive="bg-gray-800 text-teal-400"
            (click)="onModuleNavClick($event, item)"
            class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800/70 hover:text-white transition-colors min-h-10">
            <i-lucide [name]="item.icon" class="w-[1.125rem] h-[1.125rem] shrink-0 opacity-90"></i-lucide>
            <span class="truncate">{{ item.label }}</span>
          </a>
        </div>
      </div>
      <div *ngIf="adminMoreItems.length">
        <p class="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Administración
        </p>
        <div class="flex flex-col gap-0.5">
          <a
            *ngFor="let item of adminMoreItems"
            [routerLink]="item.path"
            routerLinkActive="bg-gray-800 text-teal-400"
            (click)="onModuleNavClick($event, item)"
            class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-gray-200 hover:bg-gray-800/70 hover:text-white transition-colors min-h-10">
            <i-lucide [name]="item.icon" class="w-[1.125rem] h-[1.125rem] shrink-0 opacity-90"></i-lucide>
            <span class="truncate">{{ item.label }}</span>
          </a>
        </div>
      </div>
    </ng-template>
  `,
})
export class SidebarComponent implements OnInit, OnDestroy {
  readonly nav = inject(LayoutNavService);
  readonly auth = inject(AuthService);
  private router = inject(Router);
  private routerSub?: Subscription;

  readonly companyNavItems: NavItem[] = [
    {
      path: '/dashboard',
      icon: 'layout-dashboard',
      label: 'Inicio',
      group: 'primary',
      visible: () => !this.auth.isCashOnlyTenant,
    },
    {
      path: '/clients',
      icon: 'users',
      label: 'Clientes',
      group: 'primary',
      visible: () => this.auth.canAccessClientsModule,
    },
    {
      path: '/orders',
      icon: 'clipboard-list',
      label: 'Pedidos',
      group: 'primary',
      visible: () => this.auth.canAccessOrders,
    },
    {
      path: '/sales',
      icon: 'shopping-cart',
      label: 'Ventas',
      group: 'primary',
      visible: () => this.auth.canAccessSales,
    },
    {
      path: '/cash',
      icon: 'wallet',
      label: 'Caja',
      group: 'primary',
      visible: () => this.auth.canAccessCash,
    },
    {
      path: '/stock',
      icon: 'package',
      label: 'Stock',
      group: 'more',
      section: 'operacion',
      visible: () => this.auth.canAccessStockModule,
    },
    {
      path: '/purchases',
      icon: 'truck',
      label: 'Compras',
      group: 'more',
      section: 'operacion',
      visible: () => this.auth.canAccessPurchases,
    },
    {
      path: '/suppliers',
      icon: 'building-2',
      label: 'Proveedores',
      group: 'more',
      section: 'operacion',
      visible: () => this.auth.canAccessSuppliersModule,
    },
    {
      path: '/price-catalog',
      icon: 'tags',
      label: 'Precios de venta',
      group: 'more',
      section: 'admin',
      visible: () => this.auth.canViewPriceCatalog,
    },
    {
      path: '/payables',
      icon: 'calendar',
      label: 'Cuentas a pagar',
      group: 'more',
      section: 'admin',
      visible: () => this.auth.canAccessPayables,
    },
    {
      path: '/collaborators',
      icon: 'id-card',
      label: 'Colaboradores',
      group: 'more',
      section: 'admin',
      visible: () => this.auth.canAccessCollaborators,
    },
    {
      path: '/reports',
      icon: 'bar-chart-3',
      label: 'Reportes',
      group: 'more',
      section: 'admin',
      visible: () => this.auth.canViewReports,
    },
  ];

  readonly platformNavItems: NavItem[] = [
    { path: '/platform', icon: 'building-2', label: 'Empresas y planes', group: 'primary' },
    { path: '/platform/gastos', icon: 'bar-chart-3', label: 'Gastos', group: 'primary' },
  ];

  get navItems(): NavItem[] {
    if (this.auth.isPlatformAdmin) return this.platformNavItems;
    if (this.auth.isSummaryWebTenant || !this.auth.canAccessErpWeb) {
      return [
        { path: '/inicio', icon: 'home', label: 'Inicio', group: 'primary' },
        { path: '/mi-cuenta', icon: 'user-cog', label: 'Mi cuenta', group: 'primary' },
      ];
    }
    return this.companyNavItems;
  }

  get visibleNavItems(): NavItem[] {
    return this.navItems.filter((item) => !item.visible || item.visible());
  }

  get primaryNavItems(): NavItem[] {
    return this.visibleNavItems.filter((item) => item.group !== 'more');
  }

  get moreNavItems(): NavItem[] {
    return this.visibleNavItems.filter((item) => item.group === 'more');
  }

  get operacionMoreItems(): NavItem[] {
    return this.moreNavItems.filter((item) => item.section !== 'admin');
  }

  get adminMoreItems(): NavItem[] {
    return this.moreNavItems.filter((item) => item.section === 'admin');
  }

  get isMobileToolsView(): boolean {
    return this.nav.mobileDrawerView() === 'tools';
  }

  get toolsExpanded(): boolean {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      return this.nav.toolsRailOpen();
    }
    return this.isMobileToolsView;
  }

  get toolsActiveHighlight(): boolean {
    return this.toolsExpanded || this.isOnSecondaryRoute();
  }

  ngOnInit() {
    this.routerSub = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        this.nav.closeToolsRail();
        this.nav.closeMobileMenu();
      });
  }

  onToolsToggle(event: MouseEvent) {
    event.stopPropagation();
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      this.nav.toggleToolsRail();
      return;
    }
    this.nav.showMobileTools();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.nav.toolsRailOpen()) this.nav.closeToolsRail();
  }

  /**
   * Volver a la grilla del módulo al re-tocar su ítem del menú
   * (como el botón «Volver»), incluso si venís de un formulario o detalle.
   */
  onModuleNavClick(event: MouseEvent, item: NavItem) {
    event.preventDefault();
    this.nav.closeToolsRail();
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

  private isOnSecondaryRoute(): boolean {
    const current = normalizeListPath(this.router.url);
    return this.moreNavItems.some((item) => {
      const target = normalizeListPath(item.path);
      return current === target || isModuleSubRoute(current, target);
    });
  }
}
