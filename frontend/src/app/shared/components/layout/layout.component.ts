import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar.component';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent],
  template: `
    <div class="flex h-screen bg-gray-50 overflow-hidden">
      <app-sidebar></app-sidebar>
      
      <main class="flex-1 overflow-y-auto">
        <header class="h-16 bg-white border-b border-gray-200 flex items-center px-8">
          <div class="flex-1">
            <h2 class="text-sm font-medium text-gray-400 uppercase tracking-wider">Módulo actual</h2>
          </div>
          <div class="flex items-center gap-4">
            <div class="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-semibold">
              R
            </div>
            <span class="text-sm font-medium">RILO Admin</span>
          </div>
        </header>
        
        <div class="p-0">
          <router-outlet></router-outlet>
        </div>
      </main>
    </div>
  `,
  styles: []
})
export class LayoutComponent {}
