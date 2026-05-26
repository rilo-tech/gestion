import { Directive, ElementRef, HostListener, inject } from '@angular/core';

/** Al enfocar, selecciona todo el texto para que la primera tecla lo reemplace. */
@Directive({
  selector:
    'input:not([type=checkbox]):not([type=radio]):not([readonly]):not([appSelectOnFocusDisabled]), textarea:not([readonly]):not([appSelectOnFocusDisabled])',
  standalone: true,
})
export class SelectOnFocusDirective {
  private elementRef = inject(ElementRef<HTMLInputElement | HTMLTextAreaElement>);

  @HostListener('focus')
  onFocus() {
    const el = this.elementRef.nativeElement;
    if (el.disabled || el.readOnly) return;
    setTimeout(() => el.select(), 0);
  }
}
