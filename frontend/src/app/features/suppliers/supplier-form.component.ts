import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-supplier-form',
  standalone: true,
  template: '',
})
export class SupplierFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    const nombre = this.route.snapshot.queryParamMap.get('nombre')?.trim();

    if (id) {
      this.router.navigate(['/suppliers'], {
        queryParams: { edit: id },
        replaceUrl: true,
      });
      return;
    }

    this.router.navigate(['/suppliers'], {
      queryParams: {
        new: '1',
        ...(nombre ? { nombre } : {}),
      },
      replaceUrl: true,
    });
  }
}
