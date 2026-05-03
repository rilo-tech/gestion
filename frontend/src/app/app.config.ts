import { ApplicationConfig, provideZoneChangeDetection, importProvidersFrom } from '@angular/core';
import { provideRouter, Routes } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { LucideAngularModule, LayoutDashboard, Users, Package, ShoppingCart, ClipboardList, Wallet, BarChart3, Settings } from 'lucide-angular';
import { LayoutComponent } from './shared/components/layout/layout.component';
import { HomeComponent } from './features/home/home.component';
import { ClientsComponent } from './features/clients/clients.component';
import { StockComponent } from './features/stock/stock.component';
import { NewOrderComponent } from './features/orders/new-order.component';
import { OrderListComponent } from './features/orders/order-list.component';
import { ComingSoonComponent } from './shared/components/coming-soon.component';

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
        path: 'stock',
        component: StockComponent
      },
      {
        path: 'orders/new',
        component: NewOrderComponent
      },
      {
        path: 'orders',
        component: OrderListComponent
      },
      {
        path: 'sales',
        data: { title: 'Ventas' },
        component: ComingSoonComponent
      },
      {
        path: 'cash',
        data: { title: 'Caja' },
        component: ComingSoonComponent
      },
      {
        path: 'reports',
        data: { title: 'Reportes' },
        component: ComingSoonComponent
      },
      {
        path: 'settings',
        data: { title: 'Configuración' },
        component: ComingSoonComponent
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
        Settings 
      })
    )
  ]
};
