import {
  Directive,
  Input,
  OnChanges,
  SimpleChanges,
  TemplateRef,
  ViewContainerRef,
  inject,
} from '@angular/core';
import { Permission } from '../../core/constants/permissions';
import { AuthService } from '../../core/services/auth.service';

@Directive({
  selector: '[appHasPermission]',
  standalone: true,
})
export class HasPermissionDirective implements OnChanges {
  private templateRef = inject(TemplateRef<unknown>);
  private viewContainer = inject(ViewContainerRef);
  private auth = inject(AuthService);

  @Input('appHasPermission') permission!: Permission;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['permission']) {
      this.updateView();
    }
  }

  private updateView() {
    this.viewContainer.clear();

    if (this.permission && this.auth.hasPermission(this.permission)) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    }
  }
}
