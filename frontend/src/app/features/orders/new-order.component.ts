import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ClientService, Client } from '../../core/services/client.service';
import { StockService, StockItem } from '../../core/services/stock.service';
import { OrderService, Order } from '../../core/services/order.service';
import { LucideAngularModule } from 'lucide-angular';

interface ExtraCost {
  tipo: string;
  nombre: string;
  cantidad: number;
  costoUnitario: number;
  total: number;
}

@Component({
  selector: 'app-new-order',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    <div class="p-8 pb-32">
      <div class="mb-8">
        <h1 class="text-2xl font-bold text-gray-900">Nuevo Pedido Personalizado</h1>
        <p class="text-gray-500">Completa los detalles para calcular costos y ganancia.</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <!-- Main Form -->
        <div class="lg:col-span-2 space-y-8">
          
          <!-- Cliente -->
          <section class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-lg font-bold mb-4 flex items-center gap-2">
              <i-lucide name="users" class="w-5 h-5 text-teal-600"></i-lucide>
              Cliente
            </h2>
            <select [(ngModel)]="order.clienteId" class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none">
              <option value="">Seleccionar cliente...</option>
              <option *ngFor="let client of clients" [value]="client.id">{{client.nombre}}</option>
            </select>
          </section>

          <!-- Producto Base -->
          <section class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-lg font-bold mb-4 flex items-center gap-2">
              <i-lucide name="package" class="w-5 h-5 text-teal-600"></i-lucide>
              Producto Base
            </h2>
            <div class="grid grid-cols-2 gap-4">
              <select [(ngModel)]="selectedStockId" (change)="onStockChange()" 
                      class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none">
                <option value="">Seleccionar producto base...</option>
                <option *ngFor="let item of stock" [value]="item.id">{{item.nombre}}</option>
              </select>
              <input type="number" [(ngModel)]="orderQuantity" (change)="calculateTotals()" placeholder="Cantidad"
                     class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none">
            </div>
          </section>

          <!-- Costos Extra / Personalización -->
          <section class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
            <div class="flex justify-between items-center mb-4">
              <h2 class="text-lg font-bold flex items-center gap-2">
                <i-lucide name="clipboard-list" class="w-5 h-5 text-teal-600"></i-lucide>
                Costos de Personalización
              </h2>
              <button (click)="addExtraCost()" class="text-teal-600 text-sm font-bold">+ Agregar costo</button>
            </div>
            
            <div class="space-y-3">
              <div *ngFor="let cost of extraCosts; let i = index" class="flex gap-2 items-center">
                <input [(ngModel)]="cost.nombre" placeholder="Concepto (ej. Estampado)" 
                       class="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm">
                <input type="number" [(ngModel)]="cost.costoUnitario" (change)="calculateTotals()" placeholder="Costo" 
                       class="w-24 px-3 py-2 rounded-lg border border-gray-200 text-sm">
                <button (click)="removeExtraCost(i)" class="text-red-400 p-2">×</button>
              </div>
            </div>
          </section>

          <!-- Descripción -->
          <section class="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
            <h2 class="text-lg font-bold mb-4">Descripción del Trabajo</h2>
            <textarea [(ngModel)]="order.descripcion" rows="4" placeholder="Detalles del diseño, colores, medidas..."
                      class="w-full px-4 py-2 rounded-lg border border-gray-200 outline-none"></textarea>
          </section>
        </div>

        <!-- Sidebar Summary -->
        <div class="space-y-6">
          <div class="bg-gray-900 text-white p-8 rounded-2xl shadow-xl sticky top-8">
            <h2 class="text-xl font-bold mb-6 text-teal-400">Resumen Económico</h2>
            
            <div class="space-y-4 mb-8">
              <div class="flex justify-between text-sm">
                <span class="text-gray-400">Costo Base</span>
                <span>{{ '$' + baseProductCost }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-400">Costos Extra</span>
                <span>{{ '$' + extraCostsTotal }}</span>
              </div>
              <div class="border-t border-gray-800 pt-4 flex justify-between font-bold text-lg">
                <span>Costo Total</span>
                <span>{{ '$' + totalCost }}</span>
              </div>
            </div>

            <div class="mb-8 p-4 bg-teal-900/30 rounded-xl border border-teal-500/30">
              <label class="block text-xs font-bold text-teal-400 uppercase mb-2">Precio de Venta Sugerido</label>
              <input type="number" [(ngModel)]="order.total" (change)="calculateTotals()"
                     class="w-full bg-transparent text-2xl font-bold outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none">
            </div>

            <div class="space-y-4 mb-8">
              <div class="flex justify-between">
                <span class="text-gray-400">Ganancia Est.</span>
                <span class="text-green-400 font-bold">{{ '$' + order.gananciaEstimada }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">Margen</span>
                <span class="text-teal-400">{{(order.margen * 100).toFixed(1)}}%</span>
              </div>
            </div>

            <button (click)="submitOrder()" class="w-full bg-teal-500 text-gray-900 font-bold py-4 rounded-xl hover:bg-teal-400 transition-all">
              Confirmar Pedido
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: []
})
export class NewOrderComponent implements OnInit {
  private clientService = inject(ClientService);
  private stockService = inject(StockService);
  private orderService = inject(OrderService);
  private router = inject(Router);

  clients: Client[] = [];
  stock: StockItem[] = [];
  
  order: Partial<Order> = {
    clienteId: '',
    descripcion: '',
    estado: 'pendiente',
    fechaEntrega: new Date().toISOString(),
    total: 0,
    costoReal: 0,
    gananciaEstimada: 0,
    margen: 0,
    senia: 0,
    saldo: 0,
    items: []
  };

  selectedStockId = '';
  orderQuantity = 1;
  extraCosts: ExtraCost[] = [];

  baseProductCost = 0;
  extraCostsTotal = 0;
  totalCost = 0;

  ngOnInit() {
    this.clientService.getClients().subscribe(c => this.clients = c);
    this.stockService.getStock().subscribe(s => this.stock = s);
  }

  onStockChange() {
    const item = this.stock.find(i => i.id === this.selectedStockId);
    if (item) {
      this.baseProductCost = (item.costo || 0) * this.orderQuantity;
      // Suggested price: 100% markup
      if (this.order.total === 0) {
        this.order.total = this.baseProductCost * 2;
      }
    }
    this.calculateTotals();
  }

  addExtraCost() {
    this.extraCosts.push({ tipo: 'extra', nombre: '', cantidad: 1, costoUnitario: 0, total: 0 });
  }

  removeExtraCost(i: number) {
    this.extraCosts.splice(i, 1);
    this.calculateTotals();
  }

  calculateTotals() {
    // Refresh base cost if quantity changed
    const item = this.stock.find(i => i.id === this.selectedStockId);
    if (item) {
      this.baseProductCost = (item.costo || 0) * this.orderQuantity;
    }

    this.extraCostsTotal = this.extraCosts.reduce((acc, cost) => acc + (cost.costoUnitario || 0), 0);
    this.totalCost = this.baseProductCost + this.extraCostsTotal;
    
    this.order.costoReal = this.totalCost;
    this.order.gananciaEstimada = (this.order.total || 0) - this.totalCost;
    this.order.margen = this.order.total ? this.order.gananciaEstimada / this.order.total : 0;
    this.order.saldo = (this.order.total || 0) - (this.order.senia || 0);
  }

  submitOrder() {
    if (!this.order.clienteId) return alert('Selecciona un cliente');
    this.orderService.createOrder(this.order as Order).subscribe(() => {
      this.router.navigate(['/orders']);
    });
  }
}
