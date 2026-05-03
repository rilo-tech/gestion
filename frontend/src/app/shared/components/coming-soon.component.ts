import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-coming-soon',
  standalone: true,
  template: `
    <div class="p-8 max-w-2xl">
      <h1 class="text-2xl font-bold text-gray-900 mb-2">{{ title }}</h1>
      <p class="text-gray-500">Este módulo todavía no está implementado.</p>
    </div>
  `,
  styles: [],
})
export class ComingSoonComponent {
  private route = inject(ActivatedRoute);
  title = (this.route.snapshot.data['title'] as string) || 'Próximamente';
}
