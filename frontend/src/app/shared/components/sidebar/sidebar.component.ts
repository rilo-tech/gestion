import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, LucideAngularModule],
  template: `
    <div class="h-screen w-64 bg-gray-900 text-white flex flex-col">
      <div class="p-6">
        <h1 class="text-xl font-bold tracking-tight text-teal-400">RILO Gestión</h1>
      </div>
      
      <nav class="flex-1 px-4 space-y-1">
        <a routerLink="/dashboard" routerLinkActive="bg-gray-800 text-teal-400" 
           class="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 transition-colors">
          <i-lucide name="layout-dashboard" class="w-5 h-5"></i-lucide>
          <span>Dashboard</span>
        </a>
        <a routerLink="/clients" routerLinkActive="bg-gray-800 text-teal-400"
           class="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 transition-colors">
          <i-lucide name="users" class="w-5 h-5"></i-lucide>
          <span>Clientes</span>
        </a>
        <a routerLink="/stock" routerLinkActive="bg-gray-800 text-teal-400"
           class="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 transition-colors">
          <i-lucide name="package" class="w-5 h-5"></i-lucide>
          <span>Stock</span>
        </a>
        <a routerLink="/orders" routerLinkActive="bg-gray-800 text-teal-400"
           class="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 transition-colors">
          <i-lucide name="clipboard-list" class="w-5 h-5"></i-lucide>
          <span>Pedidos</span>
        </a>
        <a routerLink="/sales" routerLinkActive="bg-gray-800 text-teal-400"
           class="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 transition-colors">
          <i-lucide name="shopping-cart" class="w-5 h-5"></i-lucide>
          <span>Ventas</span>
        </a>
        <a routerLink="/cash" routerLinkActive="bg-gray-800 text-teal-400"
           class="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 transition-colors">
          <i-lucide name="wallet" class="w-5 h-5"></i-lucide>
          <span>Caja</span>
        </a>
        <a routerLink="/reports" routerLinkActive="bg-gray-800 text-teal-400"
           class="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 transition-colors">
          <i-lucide name="bar-chart-3" class="w-5 h-5"></i-lucide>
          <span>Reportes</span>
        </a>
      </nav>

      <div class="p-6 border-t border-gray-800">
        <a routerLink="/settings" routerLinkActive="bg-gray-800 text-teal-400"
           class="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 transition-colors">
          <i-lucide name="settings" class="w-5 h-5"></i-lucide>
          <span>Configuración</span>
        </a>
      </div>
    </div>
  `,
  styles: []
})
export class SidebarComponent {}
