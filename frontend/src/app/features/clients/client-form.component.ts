import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-client-form',
  standalone: true,
  template: '',
})
export class ClientFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    const nombre = this.route.snapshot.queryParamMap.get('nombre')?.trim();

    if (id) {
      this.router.navigate(['/clients'], {
        queryParams: { edit: id },
        replaceUrl: true,
      });
      return;
    }

    this.router.navigate(['/clients'], {
      queryParams: {
        new: '1',
        ...(nombre ? { nombre } : {}),
      },
      replaceUrl: true,
    });
  }
}
