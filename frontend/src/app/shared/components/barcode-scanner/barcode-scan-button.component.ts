import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconToolbarButtonComponent } from '../icon-toolbar/icon-toolbar-button.component';
import { BarcodeScannerModalComponent } from './barcode-scanner-modal.component';

@Component({
  selector: 'app-barcode-scan-button',
  standalone: true,
  imports: [CommonModule, IconToolbarButtonComponent, BarcodeScannerModalComponent],
  template: `
    <app-icon-toolbar-button
      icon="scan-barcode"
      [label]="label"
      [variant]="variant"
      [size]="size"
      [disabled]="disabled"
      (clicked)="openScanner()">
    </app-icon-toolbar-button>

    <app-barcode-scanner-modal
      [open]="scannerOpen"
      [title]="modalTitle"
      [hint]="modalHint"
      (closed)="closeScanner()"
      (scanned)="onScanned($event)">
    </app-barcode-scanner-modal>
  `,
})
export class BarcodeScanButtonComponent {
  @Input() label = 'Escanear código';
  @Input() modalTitle = 'Escanear código de barras';
  @Input() modalHint = '';
  @Input() variant: 'primary' | 'success' | 'outline' | 'danger' | 'teal-outline' | 'orange-outline' | 'ghost-teal' | 'ghost-gray' | 'ghost-red' = 'teal-outline';
  @Input() size: 'row' | 'header' = 'header';
  @Input() disabled = false;

  @Output() scanned = new EventEmitter<string>();

  scannerOpen = false;

  openScanner() {
    if (this.disabled) return;
    this.scannerOpen = true;
  }

  closeScanner() {
    this.scannerOpen = false;
  }

  onScanned(code: string) {
    this.scannerOpen = false;
    this.scanned.emit(code);
  }
}
