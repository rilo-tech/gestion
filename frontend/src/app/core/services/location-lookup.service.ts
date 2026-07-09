import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, shareReplay } from 'rxjs';
import type { GeoCountryOption } from '../../../../../shared/geo.ts';
import type { SearchableSelectOption } from '../../shared/components/searchable-select/searchable-select.component';

@Injectable({ providedIn: 'root' })
export class LocationLookupService {
  private http = inject(HttpClient);
  private countries$?: Observable<GeoCountryOption[]>;

  listCountries(): Observable<GeoCountryOption[]> {
    if (!this.countries$) {
      this.countries$ = this.http
        .get<{ countries: GeoCountryOption[] }>('/api/public/geo/countries')
        .pipe(
          map((res) => res.countries ?? []),
          shareReplay(1)
        );
    }
    return this.countries$;
  }

  listCities(countryEs: string, countryEn?: string): Observable<string[]> {
    return this.http
      .post<{ cities: string[] }>('/api/public/geo/cities', {
        countryEs,
        countryEn,
      })
      .pipe(map((res) => res.cities ?? []));
  }

  toCountrySelectOptions(countries: GeoCountryOption[]): SearchableSelectOption[] {
    return countries.map((country) => ({
      value: country.nameEs,
      label: `${country.nameEs} (+${country.dialCode})`,
    }));
  }
}
