import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  PlatformService,
  type PlatformBusinessUsage,
  type PlatformUsageTotals,
} from '../../core/services/platform.service';
import { META_SERVICE_PAID_FROM, USAGE_TOOL_LABELS, type UsageToolId } from '../../../../../shared/usage-cost.ts';

@Component({
  selector: 'app-platform-usage',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Gasto por empresa</h1>
        <p class="text-sm text-gray-500 mt-1">
          Ingreso comercial vs costo de operación. El cliente no ve estos dólares.
        </p>
      </div>

      <div *ngIf="loading" class="text-sm text-gray-400 py-12 text-center">Cargando…</div>
      <p *ngIf="error" class="text-sm text-red-600">{{ error }}</p>

      <ng-container *ngIf="!loading && !error">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <article class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs text-gray-500">Ingreso (est. USD)</p>
            <p class="text-2xl font-bold text-gray-900 mt-1">US$ {{ profitTotals.incomeUsdEstimated | number:'1.2-2' }}</p>
          </article>
          <article class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs text-gray-500">Costo total</p>
            <p class="text-2xl font-bold text-gray-900 mt-1">US$ {{ profitTotals.costUsd | number:'1.2-2' }}</p>
            <p class="text-[11px] text-gray-400 mt-1">
              Real US$ {{ profitTotals.costUsdReal | number:'1.2-2' }} · Estimado US$ {{ profitTotals.costUsdEstimated | number:'1.2-2' }}
            </p>
          </article>
          <article class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs text-gray-500">Ganancia (est.)</p>
            <p class="text-2xl font-bold text-gray-900 mt-1">US$ {{ profitTotals.profitUsd | number:'1.2-2' }}</p>
            <p class="text-[11px] text-gray-400 mt-1">
              Margen {{ profitTotals.marginPct == null ? '—' : profitTotals.marginPct + '%' }}
            </p>
          </article>
          <article class="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p class="text-xs text-gray-500">WhatsApp Meta (est.)</p>
            <p class="text-2xl font-bold text-gray-900 mt-1">US$ {{ vendorUsd('whatsapp_meta') | number:'1.2-2' }}</p>
            <p class="text-[11px] text-gray-400 mt-1">{{ metaNote }}</p>
          </article>
        </div>

        <section *ngIf="chartRows.length" class="rounded-xl border border-gray-100 bg-white p-4 sm:p-5 shadow-sm space-y-3">
          <div>
            <h2 class="text-sm font-semibold text-gray-900">Gasto estimado por empresa</h2>
            <p class="text-[11px] text-gray-400 mt-0.5">US$ Meta + Gemini. El tope de burbujas corta el mes cuando se llena el cupo.</p>
          </div>
          <div class="space-y-2">
            <div *ngFor="let row of chartRows" class="flex items-center gap-3">
              <a
                [routerLink]="['/platform', 'empresas', row.businessId]"
                class="w-40 shrink-0 text-xs font-medium text-teal-800 truncate hover:underline"
                [title]="row.nombre">
                {{ row.nombre }}
              </a>
              <div class="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden flex">
                <div class="h-full bg-violet-500" [style.width.%]="row.whatsappPct"></div>
                <div class="h-full bg-teal-600" [style.width.%]="row.geminiPct"></div>
              </div>
              <span class="w-20 text-right text-xs tabular-nums text-gray-700">
                US$ {{ row.totalUsd | number:'1.2-2' }}
              </span>
            </div>
          </div>
          <p class="text-[11px] text-gray-400">
            <span class="inline-block w-2 h-2 rounded-sm bg-violet-500 align-middle"></span> WhatsApp
            <span class="inline-block w-2 h-2 rounded-sm bg-teal-600 align-middle ml-3"></span> Gemini
          </p>
        </section>

        <section *ngIf="vendorBars.length" class="rounded-xl border border-gray-100 bg-white p-4 sm:p-5 shadow-sm space-y-3">
          <h2 class="text-sm font-semibold text-gray-900">Costos por proveedor</h2>
          <div class="space-y-2">
            <div *ngFor="let row of vendorBars" class="flex items-center gap-3">
              <span class="w-36 shrink-0 text-xs text-gray-600 truncate">{{ row.label }}</span>
              <div class="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                <div class="h-full bg-teal-700" [style.width.%]="row.pct"></div>
              </div>
              <span class="w-28 text-right text-xs tabular-nums text-gray-700">
                US$ {{ row.usd | number:'1.2-2' }}
                <span class="text-[10px] text-gray-400">{{ row.source }}</span>
              </span>
            </div>
          </div>
          <p class="text-[11px] text-gray-400">{{ profitTotals.firebaseNote }}</p>
        </section>

        <section *ngIf="marginRows.length" class="rounded-xl border border-gray-100 bg-white p-4 sm:p-5 shadow-sm space-y-3">
          <h2 class="text-sm font-semibold text-gray-900">Margen por empresa</h2>
          <div class="space-y-2">
            <div *ngFor="let row of marginRows" class="flex items-center gap-3">
              <a
                [routerLink]="['/platform', 'empresas', row.businessId]"
                class="w-40 shrink-0 text-xs font-medium text-teal-800 truncate hover:underline">
                {{ row.nombre }}
              </a>
              <div class="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                <div class="h-full bg-emerald-600" [style.width.%]="row.pct"></div>
              </div>
              <span class="w-16 text-right text-xs tabular-nums text-gray-700">{{ row.margin }}%</span>
            </div>
          </div>
        </section>

        <section *ngIf="nearLimitRows.length" class="rounded-xl border border-amber-100 bg-amber-50/60 p-4 sm:p-5 shadow-sm space-y-2">
          <h2 class="text-sm font-semibold text-amber-900">Cerca del límite de acciones</h2>
          <a
            *ngFor="let row of nearLimitRows"
            [routerLink]="['/platform', 'empresas', row.businessId]"
            class="block text-sm text-amber-900 hover:underline">
            {{ row.nombre }} · {{ row.ai.used }} / {{ row.ai.max }}
          </a>
        </section>

        <section *ngIf="rows.length" class="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
          <div class="overflow-x-auto">
            <table class="w-full text-sm min-w-[720px]">
              <thead class="text-xs uppercase text-gray-500 bg-gray-50">
                <tr>
                  <th class="text-left px-4 py-2 font-semibold">Empresa</th>
                  <th class="text-right px-4 py-2 font-semibold">Ingreso / mes</th>
                  <th class="text-right px-4 py-2 font-semibold">Plan</th>
                  <th class="text-right px-4 py-2 font-semibold">Extras</th>
                  <th class="text-right px-4 py-2 font-semibold">Ganancia est.</th>
                  <th class="text-right px-4 py-2 font-semibold">Margen</th>
                  <th class="text-right px-4 py-2 font-semibold">US$ costo</th>
                  <th class="text-right px-4 py-2 font-semibold">IA</th>
                  <th class="text-right px-4 py-2 font-semibold">WhatsApp</th>
                  <th class="text-left px-4 py-2 font-semibold">Gemini por herramienta</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of rows" class="border-t border-gray-100">
                  <td class="px-4 py-3">
                    <a
                      [routerLink]="['/platform', 'empresas', row.businessId]"
                      class="font-semibold text-teal-800 hover:underline">
                      {{ row.nombre }}
                    </a>
                    <p class="text-[11px] text-gray-400">{{ row.businessId }}</p>
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    {{ row.expectedMonthly || 0 }}
                    <p class="text-[10px] text-gray-400">{{ row.profitability?.income?.currency }}</p>
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums text-xs">{{ row.incomePlan || 0 }}</td>
                  <td class="px-4 py-3 text-right tabular-nums text-xs">
                    {{ (row.extraErpCost || 0) + (row.extraWhatsappCost || 0) + (row.addonCost || 0) }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    US$ {{ (row.profitability?.result?.profitUsd || 0) | number:'1.2-2' }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    {{ row.profitability?.result?.marginPct == null ? '—' : row.profitability?.result?.marginPct + '%' }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums font-medium">
                    {{ (row.profitability?.costUsd || row.totalUsd || 0) | number:'1.2-2' }}
                    <p class="text-[10px] text-gray-400">
                      real {{ (row.profitability?.costUsdReal || 0) | number:'1.2-2' }}
                    </p>
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    {{ row.ai.used }} / {{ row.ai.max || '—' }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    {{ row.whatsapp.used }} / {{ row.whatsapp.max || '—' }}
                  </td>
                  <td class="px-4 py-3">
                    <div class="space-y-1.5 min-w-[180px]">
                      <div *ngFor="let tool of toolsOf(row)" class="flex items-center gap-2">
                        <span class="w-28 shrink-0 text-[11px] text-gray-500 truncate">{{ tool.label }}</span>
                        <div class="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            class="h-full bg-teal-600 rounded-full"
                            [style.width.%]="tool.pct"></div>
                        </div>
                        <span class="w-16 text-right text-[11px] tabular-nums text-gray-500">
                          {{ tool.tokens | number }}
                        </span>
                      </div>
                      <p *ngIf="!toolsOf(row).length" class="text-[11px] text-gray-400">Sin tokens aún</p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <p *ngIf="!rows.length" class="text-sm text-gray-400 text-center py-8">
          Todavía no hay empresas para mostrar.
        </p>
      </ng-container>
    </div>
  `,
})
export class PlatformUsageComponent implements OnInit {
  private platform = inject(PlatformService);

  loading = true;
  error = '';
  period = '';
  rows: PlatformBusinessUsage[] = [];
  totals = { total: 0, whatsapp: 0, gemini: 0 };
  profitTotals: PlatformUsageTotals = {
    incomeUsdEstimated: 0,
    costUsd: 0,
    costUsdReal: 0,
    costUsdEstimated: 0,
    profitUsd: 0,
    marginPct: null,
    byVendor: {},
    firebaseNote: 'Firebase/GCP es un estimado mensual atribuido. No es un costo exacto.',
  };

  vendorUsd(code: string): number {
    return this.profitTotals.byVendor?.[code] || 0;
  }

  get vendorBars(): { label: string; usd: number; pct: number; source: string }[] {
    const labels: Record<string, { label: string; source: string }> = {
      gemini: { label: 'Gemini', source: 'REAL' },
      whatsapp_meta: { label: 'WhatsApp Meta', source: 'EST.' },
      mercadopago: { label: 'Mercado Pago', source: 'mix' },
      firebase_gcp: { label: 'Firebase/GCP', source: 'EST.' },
      other: { label: 'Otros', source: 'EST.' },
    };
    const entries = Object.entries(this.profitTotals.byVendor || {})
      .map(([code, usd]) => ({
        label: labels[code]?.label || code,
        usd,
        pct: 0,
        source: labels[code]?.source || 'EST.',
      }))
      .filter((row) => row.usd > 0)
      .sort((a, b) => b.usd - a.usd);
    const max = Math.max(0.01, ...entries.map((row) => row.usd));
    return entries.map((row) => ({ ...row, pct: Math.round((row.usd / max) * 100) }));
  }

  get marginRows(): { businessId: string; nombre: string; margin: number; pct: number }[] {
    return [...this.rows]
      .map((row) => ({
        businessId: row.businessId || '',
        nombre: row.nombre || row.businessId || 'Empresa',
        margin: row.profitability?.result?.marginPct ?? 0,
      }))
      .filter((row) => row.margin !== 0)
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 10)
      .map((row) => ({
        ...row,
        pct: Math.max(4, Math.min(100, row.margin)),
      }));
  }

  get nearLimitRows(): PlatformBusinessUsage[] {
    return this.rows.filter((row) => {
      const max = row.ai?.max || 0;
      if (!max || row.ai?.unlimited) return false;
      return (row.ai.used || 0) / max >= 0.8;
    });
  }

  get chartRows(): {
    businessId: string;
    nombre: string;
    totalUsd: number;
    whatsappPct: number;
    geminiPct: number;
  }[] {
    const ranked = [...this.rows]
      .filter((row) => (row.totalUsd ?? 0) > 0 || (row.whatsapp?.used ?? 0) > 0 || (row.ai?.used ?? 0) > 0)
      .sort((a, b) => (b.totalUsd ?? 0) - (a.totalUsd ?? 0))
      .slice(0, 12);
    const anyUsd = ranked.some((row) => (row.totalUsd || 0) > 0.004);
    const max = anyUsd
      ? Math.max(0.01, ...ranked.map((row) => row.totalUsd || 0))
      : Math.max(1, ...ranked.map((row) => (row.whatsapp?.used || 0) + (row.ai?.used || 0)));
    return ranked.map((row) => {
      const total = row.totalUsd || 0;
      const activity = (row.whatsapp?.used || 0) + (row.ai?.used || 0);
      const bar = anyUsd ? (total / max) * 100 : (activity / max) * 100;
      const waShare = anyUsd
        ? total > 0
          ? (row.whatsappUsd || 0) / total
          : 0
        : activity > 0
          ? (row.whatsapp?.used || 0) / activity
          : 0;
      const geShare = anyUsd
        ? total > 0
          ? (row.geminiUsd || 0) / total
          : 0
        : activity > 0
          ? (row.ai?.used || 0) / activity
          : 0;
      return {
        businessId: row.businessId || '',
        nombre: row.nombre || row.businessId || 'Empresa',
        totalUsd: total,
        whatsappPct: Math.round(bar * waShare),
        geminiPct: Math.round(bar * geShare),
      };
    });
  }

  get metaNote(): string {
    const today = new Date().toISOString().slice(0, 10);
    if (today < META_SERVICE_PAID_FROM) {
      return `Service gratis hasta ${META_SERVICE_PAID_FROM}. Después, ~US$ 0,0113 por burbuja.`;
    }
    return 'Service a tarifa utility Uruguay (~US$ 0,0113 / burbuja).';
  }

  ngOnInit() {
    this.platform.getPlatformUsage().subscribe({
      next: (res) => {
        this.period = res.period;
        this.rows = [...(res.rows ?? [])].sort(
          (a, b) => (b.profitability?.result?.profitUsd ?? b.totalUsd ?? 0) - (a.profitability?.result?.profitUsd ?? a.totalUsd ?? 0)
        );
        if (res.totals) this.profitTotals = res.totals;
        this.totals = this.rows.reduce(
          (acc, row) => ({
            total: acc.total + (row.totalUsd || 0),
            whatsapp: acc.whatsapp + (row.whatsappUsd || 0),
            gemini: acc.gemini + (row.geminiUsd || 0),
          }),
          { total: 0, whatsapp: 0, gemini: 0 }
        );
        this.loading = false;
      },
      error: () => {
        this.error = 'No se pudo cargar el gasto.';
        this.loading = false;
      },
    });
  }

  toolsOf(row: PlatformBusinessUsage): { id: UsageToolId; label: string; tokens: number; pct: number }[] {
    const entries = (Object.keys(USAGE_TOOL_LABELS) as UsageToolId[])
      .map((id) => {
        const totals = row.tools?.[id];
        const tokens = (totals?.inputTokens ?? 0) + (totals?.outputTokens ?? 0);
        return { id, label: USAGE_TOOL_LABELS[id], tokens, pct: 0 };
      })
      .filter((row) => row.tokens > 0);
    const max = Math.max(1, ...entries.map((row) => row.tokens));
    return entries.map((row) => ({ ...row, pct: Math.round((row.tokens / max) * 100) }));
  }
}
