import { APP_INITIALIZER, ApplicationConfig, provideZoneChangeDetection, importProvidersFrom } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { provideRouter, Routes } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { apiBaseInterceptor } from './core/interceptors/api-base.interceptor';
import { authGuard, loginGuard, platformLoginGuard, platformGuard, companyGuard, requireAnyPermission, requirePermission } from './core/guards/auth.guard';
import { PERMISSIONS } from './core/constants/permissions';
import { LucideAngularModule, LayoutDashboard, Users, Package, ShoppingCart, ClipboardList, Wallet, BarChart3, Settings, Pencil, Trash2, AlertCircle, ArrowLeft, ArrowDown, ArrowUp, Plus, Minus, Check, Truck, Menu, X, History, Building2, LogOut, Moon, Sun, Tags, Calendar, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Printer, Clock, Gift, UserCog, Copy, Save, Receipt } from 'lucide-angular';
import { LayoutComponent } from './shared/components/layout/layout.component';
import { HomeComponent } from './features/home/home.component';
import { ClientFormComponent } from './features/clients/client-form.component';
import { ClientHistorialComponent } from './features/clients/client-historial.component';
import { ClientsComponent } from './features/clients/clients.component';
import { SupplierFormComponent } from './features/suppliers/supplier-form.component';
import { SuppliersComponent } from './features/suppliers/suppliers.component';
import { StockComponent } from './features/stock/stock.component';
import { NewProductComponent } from './features/stock/new-product.component';
import { NewOrderComponent } from './features/orders/new-order.component';
import { OrderListComponent } from './features/orders/order-list.component';
import { ReportsComponent } from './features/reports/reports.component';
import { SettingsComponent } from './features/settings/settings.component';
import { CashComponent } from './features/cash/cash.component';
import { PurchasesComponent } from './features/purchases/purchases.component';
import { NewPurchaseComponent } from './features/purchases/new-purchase.component';
import { SalesComponent } from './features/sales/sales.component';
import { NewSaleComponent } from './features/sales/new-sale.component';
import { LoginComponent } from './features/auth/login.component';
import { PlatformLoginComponent } from './features/auth/platform-login.component';
import { PlatformComponent } from './features/platform/platform.component';
import { AccountComponent } from './features/account/account.component';
import { AppearancePageComponent } from './features/settings/appearance-page.component';
import { PriceCatalogComponent } from './features/price-catalog/price-catalog.component';
import { PriceCatalogFormComponent } from './features/price-catalog/price-catalog-form.component';
import { PayablesComponent } from './features/payables/payables.component';
import { StockShortagesComponent } from './features/stock/stock-shortages.component';
import { CollaboratorsComponent } from './features/collaborators/collaborators.component';

const companyRoutes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: 'dashboard',
    component: HomeComponent,
  },
  {
    path: 'clients/new',
    component: ClientFormComponent,
  },
  {
    path: 'clients/:id/historial',
    component: ClientHistorialComponent,
  },
  {
    path: 'clients/:id/edit',
    component: ClientFormComponent,
  },
  {
    path: 'clients',
    component: ClientsComponent,
  },
  {
    path: 'suppliers/new',
    component: SupplierFormComponent,
  },
  {
    path: 'suppliers/:id/edit',
    component: SupplierFormComponent,
  },
  {
    path: 'suppliers',
    component: SuppliersComponent,
  },
  {
    path: 'stock/faltantes',
    component: StockShortagesComponent,
  },
  {
    path: 'stock/new',
    component: NewProductComponent,
  },
  {
    path: 'stock/:id/edit',
    component: NewProductComponent,
  },
  {
    path: 'stock',
    component: StockComponent,
  },
  {
    path: 'purchases/new',
    component: NewPurchaseComponent,
    canActivate: [requirePermission(PERMISSIONS.PURCHASES_ACCESS)],
  },
  {
    path: 'purchases',
    component: PurchasesComponent,
    canActivate: [requirePermission(PERMISSIONS.PURCHASES_ACCESS)],
  },
  {
    path: 'orders/new',
    component: NewOrderComponent,
  },
  {
    path: 'orders/:id/edit',
    component: NewOrderComponent,
  },
  {
    path: 'orders',
    component: OrderListComponent,
  },
  {
    path: 'sales/new',
    component: NewSaleComponent,
    canActivate: [
      requireAnyPermission(PERMISSIONS.SALES_CREATE, PERMISSIONS.SALES_VIEW_HISTORY),
    ],
  },
  {
    path: 'sales/:id/edit',
    component: NewSaleComponent,
    canActivate: [
      requireAnyPermission(PERMISSIONS.SALES_CREATE, PERMISSIONS.SALES_VIEW_HISTORY),
    ],
  },
  {
    path: 'sales',
    component: SalesComponent,
    canActivate: [
      requireAnyPermission(PERMISSIONS.SALES_CREATE, PERMISSIONS.SALES_VIEW_HISTORY),
    ],
  },
  {
    path: 'price-catalog/new',
    component: PriceCatalogFormComponent,
    canActivate: [requirePermission(PERMISSIONS.PRICES_VIEW)],
  },
  {
    path: 'price-catalog/:id/edit',
    component: PriceCatalogFormComponent,
    canActivate: [requirePermission(PERMISSIONS.PRICES_VIEW)],
  },
  {
    path: 'price-catalog',
    component: PriceCatalogComponent,
    canActivate: [requirePermission(PERMISSIONS.PRICES_VIEW)],
  },
  {
    path: 'cash',
    component: CashComponent,
  },
  {
    path: 'payables',
    component: PayablesComponent,
    canActivate: [requirePermission(PERMISSIONS.PAYABLES_ACCESS)],
  },
  {
    path: 'collaborators',
    component: CollaboratorsComponent,
    canActivate: [requirePermission(PERMISSIONS.COLLABORATORS_ACCESS)],
  },
  {
    path: 'reports',
    data: { title: 'Reportes' },
    component: ReportsComponent,
    canActivate: [requirePermission(PERMISSIONS.REPORTS_VIEW)],
  },
  {
    path: 'settings',
    component: SettingsComponent,
  },
  {
    path: 'mi-cuenta',
    component: AccountComponent,
  },
  {
    path: 'apariencia',
    component: AppearancePageComponent,
  },
];

const routes: Routes = [
  {
    path: 'acceso-plataforma',
    component: PlatformLoginComponent,
    canActivate: [platformLoginGuard],
  },
  {
    path: '',
    component: LoginComponent,
    canActivate: [loginGuard],
    pathMatch: 'full',
  },
  {
    path: 'login',
    redirectTo: '',
    pathMatch: 'full',
  },
  {
    path: 'platform',
    component: LayoutComponent,
    canActivate: [authGuard, platformGuard],
    children: [
      {
        path: '',
        component: PlatformComponent,
      },
      {
        path: 'mi-cuenta',
        component: AccountComponent,
      },
      {
        path: 'apariencia',
        component: AppearancePageComponent,
      },
    ],
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard, companyGuard],
    children: [
      ...companyRoutes,
      {
        path: '**',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
    ],
  },
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor, apiBaseInterceptor])),
    importProvidersFrom(
      LucideAngularModule.pick({
        LayoutDashboard,
        Users,
        Package,
        ShoppingCart,
        ClipboardList,
        Wallet,
        BarChart3,
        Settings,
        Pencil,
        Trash2,
        AlertCircle,
        ArrowLeft,
        ArrowDown,
        ArrowUp,
        Plus,
        Minus,
        Check,
        Truck,
        Menu,
        X,
        History,
        Building2,
        LogOut,
        Moon,
        Sun,
        Tags,
        Calendar,
        ChevronDown,
        ChevronUp,
        ChevronLeft,
        ChevronRight,
        Printer,
        Clock,
        Gift,
        UserCog,
        Copy,
        Save,
        Receipt,
      })
    ),
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: (auth: AuthService) => () => firstValueFrom(auth.initialize()),
      deps: [AuthService],
    },
  ],
};





