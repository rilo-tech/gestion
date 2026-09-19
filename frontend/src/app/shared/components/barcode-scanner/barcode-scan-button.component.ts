import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconToolbarButtonComponent } from '../icon-toolbar/icon-toolbar-button.component';
import {
  BarcodeScannerModalComponent,
  type BarcodeScanMode,
} from './barcode-scanner-modal.component';
import { isBarcodeScannerEnabledForBusiness } from '../../../../../../shared/feature-flags.ts';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-barcode-scan-button',
  standalone: true,
  imports: [CommonModule, IconToolbarButtonComponent, BarcodeScannerModalComponent],
  template: `
    <ng-container *ngIf="enabled">
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
        [mode]="mode"
        [continuousFeedback]="continuousFeedback"
        (closed)="closeScanner()"
        (scanned)="onScanned($event)">
      </app-barcode-scanner-modal>
    </ng-container>
  `,
})
export class BarcodeScanButtonComponent {
  private auth = inject(AuthService);

  get enabled(): boolean {
    return isBarcodeScannerEnabledForBusiness(this.auth.currentBusinessId, {
      erpWebEnabled: this.auth.hasErpEntitlement,
    });
  }

  @Input() label = 'Escanear código';
  @Input() modalTitle = 'Escanear código de barras';
  @Input() modalHint = '';
  @Input() mode: BarcodeScanMode = 'single';
  @Input() continuousFeedback = '';
  @Input() variant:
    | 'primary'
    | 'success'
    | 'outline'
    | 'danger'
    | 'teal-outline'
    | 'orange-outline'
    | 'ghost-teal'
    | 'ghost-gray'
    | 'ghost-red' = 'teal-outline';
  @Input() size: 'row' | 'header' = 'header';
  @Input() disabled = false;

  @Output() scanned = new EventEmitter<string>();

  scannerOpen = false;

  openScanner() {
    if (!this.enabled || this.disabled) return;
    this.scannerOpen = true;
  }

  closeScanner() {
    this.scannerOpen = false;
  }

  onScanned(code: string) {
    if (this.mode === 'single') {
      this.scannerOpen = false;
    }
    this.scanned.emit(code);
  }
}
