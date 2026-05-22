import { ApplicationConfig, provideZoneChangeDetection, importProvidersFrom } from '@angular/core';
import { provideRouter, Routes } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { LucideAngularModule, LayoutDashboard, Users, Package, ShoppingCart, ClipboardList, Wallet, BarChart3, Settings, Pencil, Trash2, AlertCircle, ArrowLeft, ArrowDown, ArrowUp, Plus, Minus, Check, Truck } from 'lucide-angular';
import { LayoutComponent } from './shared/components/layout/layout.component';
import { HomeComponent } from './features/home/home.component';
import { ClientsComponent } from './features/clients/clients.component';
import { StockComponent } from './features/stock/stock.component';
import { NewProductComponent } from './features/stock/new-product.component';
import { NewOrderComponent } from './features/orders/new-order.component';
import { OrderListComponent } from './features/orders/order-list.component';
import { ComingSoonComponent } from './shared/components/coming-soon.component';
import { SettingsComponent } from './features/settings/settings.component';
import { CashComponent } from './features/cash/cash.component';
import { PurchasesComponent } from './features/purchases/purchases.component';
import { SalesComponent } from './features/sales/sales.component';

const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        component: HomeComponent
      },
      {
        path: 'clients',
        component: ClientsComponent
      },
      {
        path: 'stock/new',
        component: NewProductComponent
      },
      {
        path: 'stock/:id/edit',
        component: NewProductComponent
      },
      {
        path: 'stock',
        component: StockComponent
      },
      {
        path: 'purchases',
        component: PurchasesComponent
      },
      {
        path: 'orders/new',
        component: NewOrderComponent
      },
      {
        path: 'orders/:id/edit',
        component: NewOrderComponent
      },
      {
        path: 'orders',
        component: OrderListComponent
      },
      {
        path: 'sales',
        component: SalesComponent
      },
      {
        path: 'cash',
        component: CashComponent
      },
      {
        path: 'reports',
        data: { title: 'Reportes' },
        component: ComingSoonComponent
      },
      {
        path: 'settings',
        component: SettingsComponent
      },
      {
        path: '**',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      }
    ]
  }
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(),
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
        Truck
      })
    )
  ]
};
