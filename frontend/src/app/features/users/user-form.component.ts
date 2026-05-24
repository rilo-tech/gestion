import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-user-form',
  standalone: true,
  template: '',
})
export class UserFormComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');

    if (id) {
      this.router.navigate(['/users'], {
        queryParams: { edit: id },
        replaceUrl: true,
      });
      return;
    }

    this.router.navigate(['/users'], {
      queryParams: { new: '1' },
      replaceUrl: true,
    });
  }
}
