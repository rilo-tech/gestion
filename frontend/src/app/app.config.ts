import { APP_INITIALIZER, ApplicationConfig, provideZoneChangeDetection, importProvidersFrom } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { provideRouter, Routes } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { authGuard, loginGuard, platformGuard, companyGuard } from './core/guards/auth.guard';
import { LucideAngularModule, LayoutDashboard, Users, Package, ShoppingCart, ClipboardList, Wallet, BarChart3, Settings, Pencil, Trash2, AlertCircle, ArrowLeft, ArrowDown, ArrowUp, Plus, Minus, Check, Truck, Menu, X, History, Building2, LogOut, Moon, Sun } from 'lucide-angular';
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
import { ComingSoonComponent } from './shared/components/coming-soon.component';
import { SettingsComponent } from './features/settings/settings.component';
import { CashComponent } from './features/cash/cash.component';
import { PurchasesComponent } from './features/purchases/purchases.component';
import { SalesComponent } from './features/sales/sales.component';
import { LoginComponent } from './features/auth/login.component';
import { PlatformLoginComponent } from './features/auth/platform-login.component';
import { PlatformComponent } from './features/platform/platform.component';

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
    path: 'purchases',
    component: PurchasesComponent,
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
    path: 'sales',
    component: SalesComponent,
  },
  {
    path: 'cash',
    component: CashComponent,
  },
  {
    path: 'reports',
    data: { title: 'Reportes' },
    component: ComingSoonComponent,
  },
  {
    path: 'settings',
    component: SettingsComponent,
  },
];

const routes: Routes = [
  {
    path: 'acceso-plataforma',
    component: PlatformLoginComponent,
    canActivate: [loginGuard],
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
    provideHttpClient(withInterceptors([authInterceptor])),
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
