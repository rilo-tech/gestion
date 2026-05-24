import {
  Directive,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  TemplateRef,
  ViewContainerRef,
  inject,
} from '@angular/core';
import { Permission } from '../../core/constants/permissions';
import { AuthService } from '../../core/services/auth.service';
import { Subscription } from 'rxjs';

@Directive({
  selector: '[appHasPermission]',
  standalone: true,
})
export class HasPermissionDirective implements OnChanges, OnInit, OnDestroy {
  private templateRef = inject(TemplateRef<unknown>);
  private viewContainer = inject(ViewContainerRef);
  private auth = inject(AuthService);
  private authSub?: Subscription;

  @Input('appHasPermission') permission!: Permission;

  ngOnInit() {
    this.authSub = this.auth.currentUser$.subscribe(() => this.updateView());
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['permission']) {
      this.updateView();
    }
  }

  ngOnDestroy() {
    this.authSub?.unsubscribe();
  }

  private updateView() {
    this.viewContainer.clear();

    if (this.permission && this.auth.hasPermission(this.permission)) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    }
  }
}
