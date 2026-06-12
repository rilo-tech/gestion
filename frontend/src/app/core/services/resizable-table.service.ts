import { Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { bindResizableTables, unbindResizableTables } from '../utils/resizable-table';

@Injectable({ providedIn: 'root' })
export class ResizableTableService {
  private observer?: MutationObserver;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private navSub?: Subscription;
  private started = false;
  private readonly fitMediaQuery = window.matchMedia('(min-width: 640px)');
  private readonly resizeMediaQuery = window.matchMedia('(min-width: 1024px)');

  constructor(private readonly router: Router) {}

  private readonly onViewportChange = (): void => {
    if (this.fitMediaQuery.matches) {
      this.scheduleBind();
      return;
    }
    unbindResizableTables();
  };

  start(): void {
    if (this.started) {
      this.scheduleBind();
      return;
    }
    this.started = true;

    this.scheduleBind();
    this.fitMediaQuery.addEventListener('change', this.onViewportChange);
    this.resizeMediaQuery.addEventListener('change', this.onViewportChange);

    this.observer = new MutationObserver(() => this.scheduleBind());
    this.observer.observe(document.body, { childList: true, subtree: true });

    this.navSub = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.scheduleBind());
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    clearTimeout(this.debounceTimer);
    this.observer?.disconnect();
    this.observer = undefined;
    this.fitMediaQuery.removeEventListener('change', this.onViewportChange);
    this.resizeMediaQuery.removeEventListener('change', this.onViewportChange);
    this.navSub?.unsubscribe();
    this.navSub = undefined;
    unbindResizableTables();
  }

  private scheduleBind(): void {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      requestAnimationFrame(() => bindResizableTables());
    }, 60);
  }
}
