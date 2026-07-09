import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { RitotechChatMessage } from '../../../../../shared/ritotech-marketing.ts';

@Component({
  selector: 'app-ritotech-chat-demo',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-2xl border border-gray-800 bg-gray-950/80 p-4 sm:p-5 max-w-md mx-auto shadow-xl">
      <div class="flex items-center gap-2 pb-3 mb-3 border-b border-gray-800">
        <span class="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center text-xs font-bold">R</span>
        <div>
          <p class="text-sm font-semibold text-white">RiloBot</p>
          <p class="text-[10px] text-gray-500">WhatsApp · en línea</p>
        </div>
      </div>
      <div class="space-y-2.5">
        <div
          *ngFor="let msg of messages; let i = index"
          class="flex"
          [class.justify-end]="msg.from === 'user'">
          <div
            class="max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug"
            [class.bg-teal-700]="msg.from === 'user'"
            [class.text-white]="msg.from === 'user'"
            [class.rounded-br-md]="msg.from === 'user'"
            [class.bg-gray-800]="msg.from === 'bot'"
            [class.text-gray-200]="msg.from === 'bot'"
            [class.rounded-bl-md]="msg.from === 'bot'">
            {{ msg.text }}
          </div>
        </div>
      </div>
      <p *ngIf="caption" class="mt-4 text-[11px] text-gray-500 text-center leading-relaxed">{{ caption }}</p>
    </div>
  `,
})
export class RitotechChatDemoComponent {
  @Input() messages: RitotechChatMessage[] = [];
  @Input() caption = '';
}
