import { Injectable } from '@angular/core';
import { getStoredBusinessId } from '../constants/auth-storage';

@Injectable({
  providedIn: 'root',
})
export class TenantService {
  get businessId(): string {
    return getStoredBusinessId();
  }
}
