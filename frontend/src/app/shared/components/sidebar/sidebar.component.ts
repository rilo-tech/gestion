import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, LucideAngularModule],
  template: `
    <aside class="h-screen w-64 shrink-0 bg-gray-900 text-white flex flex-col">
      <div class="px-6 py-5">
        <h1 class="text-xl font-bold tracking-tight text-teal-400">RILO Gestión</h1>
        <p class="text-[11px] text-gray-500 mt-1">Panel de gestión</p>
      </div>

      <nav class="flex-1 px-3 pb-4 flex flex-col min-h-0">
        <div class="space-y-0.5 overflow-y-auto flex-1">
          <a
            routerLink="/dashboard"
            routerLinkActive="bg-gray-800 text-teal-400 shadow-sm"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/80 transition-colors">
            <i-lucide name="layout-dashboard" class="w-5 h-5 shrink-0"></i-lucide>
            <span class="text-sm font-medium">Dashboard</span>
          </a>
          <a
            routerLink="/clients"
            routerLinkActive="bg-gray-800 text-teal-400 shadow-sm"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/80 transition-colors">
            <i-lucide name="users" class="w-5 h-5 shrink-0"></i-lucide>
            <span class="text-sm font-medium">Clientes</span>
          </a>
          <a
            routerLink="/stock"
            routerLinkActive="bg-gray-800 text-teal-400 shadow-sm"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/80 transition-colors">
            <i-lucide name="package" class="w-5 h-5 shrink-0"></i-lucide>
            <span class="text-sm font-medium">Stock</span>
          </a>
          <a
            routerLink="/purchases"
            routerLinkActive="bg-gray-800 text-teal-400 shadow-sm"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/80 transition-colors">
            <i-lucide name="truck" class="w-5 h-5 shrink-0"></i-lucide>
            <span class="text-sm font-medium">Compras</span>
          </a>
          <a
            routerLink="/orders"
            routerLinkActive="bg-gray-800 text-teal-400 shadow-sm"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/80 transition-colors">
            <i-lucide name="clipboard-list" class="w-5 h-5 shrink-0"></i-lucide>
            <span class="text-sm font-medium">Pedidos</span>
          </a>
          <a
            routerLink="/sales"
            routerLinkActive="bg-gray-800 text-teal-400 shadow-sm"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/80 transition-colors">
            <i-lucide name="shopping-cart" class="w-5 h-5 shrink-0"></i-lucide>
            <span class="text-sm font-medium">Ventas</span>
          </a>
          <a
            routerLink="/cash"
            routerLinkActive="bg-gray-800 text-teal-400 shadow-sm"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/80 transition-colors">
            <i-lucide name="wallet" class="w-5 h-5 shrink-0"></i-lucide>
            <span class="text-sm font-medium">Caja</span>
          </a>
          <a
            routerLink="/reports"
            routerLinkActive="bg-gray-800 text-teal-400 shadow-sm"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/80 transition-colors">
            <i-lucide name="bar-chart-3" class="w-5 h-5 shrink-0"></i-lucide>
            <span class="text-sm font-medium">Reportes</span>
          </a>
        </div>

        <div class="mt-3 pt-3 border-t border-gray-800 shrink-0">
          <a
            routerLink="/settings"
            routerLinkActive="bg-gray-800 text-teal-400 shadow-sm"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/80 transition-colors">
            <i-lucide name="settings" class="w-5 h-5 shrink-0"></i-lucide>
            <span class="text-sm font-medium">Configuración</span>
          </a>
        </div>
      </nav>
    </aside>
  `,
})
export class SidebarComponent {}
