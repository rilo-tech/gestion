import { afterNextRender, Component, DestroyRef, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ResizableTableService } from './core/services/resizable-table.service';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <router-outlet></router-outlet>
  `,
  styles: []
})
export class AppComponent {
  private readonly theme = inject(ThemeService);
  private readonly resizableTables = inject(ResizableTableService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      this.resizableTables.start();
      this.destroyRef.onDestroy(() => this.resizableTables.stop());
    });
  }
}
