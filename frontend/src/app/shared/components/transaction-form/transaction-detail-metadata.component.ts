import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TRANSACTION_FORM_CARD_CLASS } from './transaction-form.constants';

export interface TransactionDetailMetaItem {
  label: string;
  value: string;
  routerLink?: string | any[];
  linkClick?: () => void;
  capitalize?: boolean;
}

@Component({
  selector: 'app-transaction-detail-metadata',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section [class]="cardClass">
      <div
        class="grid gap-x-3 gap-y-2 sm:gap-4"
        [class.grid-cols-1]="columns === 1"
        [class.grid-cols-2]="columns === 2">
        <div *ngFor="let item of items" class="min-w-0">
          <p class="text-[9px] sm:text-xs font-semibold uppercase sm:normal-case text-gray-500 dark:text-gray-400 sm:font-medium sm:mb-1">
            {{ item.label }}
          </p>
          <p
            class="text-gray-900 dark:text-gray-100 leading-snug mt-0.5 sm:mt-0 break-words"
            [class.capitalize]="item.capitalize">
            <a
              *ngIf="item.routerLink; else plainValue"
              [routerLink]="item.routerLink"
              (click)="item.linkClick?.()"
              class="text-teal-700 dark:text-teal-400 hover:underline">
              {{ item.value }}
            </a>
            <ng-template #plainValue>{{ item.value }}</ng-template>
          </p>
        </div>
      </div>
    </section>
  `,
})
export class TransactionDetailMetadataComponent {
  @Input() items: TransactionDetailMetaItem[] = [];
  @Input() columns: 1 | 2 = 2;

  readonly cardClass = TRANSACTION_FORM_CARD_CLASS + ' p-3 sm:p-4';
}
