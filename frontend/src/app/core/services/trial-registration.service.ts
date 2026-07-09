import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type { PublicBusinessInfo } from './business.service';

export interface TrialRegisterPayload {
  businessName: string;
  rubro: string;
  pais: string;
  ciudad: string;
  ownerName: string;
  email: string;
  phone: string;
  phoneCountryCode?: string;
  password?: string;
  loginUsername?: string;
  whatsappOptIn?: boolean;
  marketingEmailOptIn?: boolean;
  acceptTerms: boolean;
  website?: string;
  trialProduct?: string;
  utmSource?: string;
  utmCampaign?: string;
  campaignSource?: string;
}

export interface TrialRegistrationStatus {
  id: string;
  businessName: string;
  email: string;
  phone: string;
  phoneVerified: boolean;
  emailVerified: boolean;
  status: string;
  completedBusinessId: string | null;
}

export interface TrialCompleteResponse {
  token: string;
  user: { id: string; nombre: string; email: string; loginUsername: string; rol: string };
  businessId: string;
  business: PublicBusinessInfo;
  loginHint: { businessCode: string; loginUsername: string };
}

@Injectable({ providedIn: 'root' })
export class TrialRegistrationService {
  private http = inject(HttpClient);

  register(payload: TrialRegisterPayload): Observable<{ registrationId: string }> {
    return this.http.post<{ registrationId: string }>('/api/public/trial/register', payload);
  }

  sendPhoneCode(registrationId: string): Observable<{ ok: boolean; emailSent?: boolean; devCode?: string }> {
    return this.http.post<{ ok: boolean; emailSent?: boolean; devCode?: string }>(
      '/api/public/trial/send-phone-code',
      { registrationId }
    );
  }

  verifyPhone(registrationId: string, code: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/public/trial/verify-phone', {
      registrationId,
      code,
    });
  }

  sendEmailVerification(registrationId: string): Observable<{ ok: boolean; devVerificationUrl?: string }> {
    return this.http.post<{ ok: boolean; devVerificationUrl?: string }>(
      '/api/public/trial/send-email-verification',
      { registrationId }
    );
  }

  verifyEmail(token: string): Observable<{ ok: boolean; registrationId: string }> {
    return this.http.post<{ ok: boolean; registrationId: string }>(
      '/api/public/trial/verify-email',
      { token }
    );
  }

  complete(registrationId: string): Observable<TrialCompleteResponse> {
    return this.http.post<TrialCompleteResponse>('/api/public/trial/complete', {
      registrationId,
    });
  }

  getRegistration(registrationId: string): Observable<TrialRegistrationStatus> {
    return this.http.get<TrialRegistrationStatus>(
      `/api/public/trial/registration/${registrationId}`
    );
  }
}
