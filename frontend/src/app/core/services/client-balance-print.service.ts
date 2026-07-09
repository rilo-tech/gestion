import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import type { ClientAccountLineItem } from './client.service';

export type ClientBalancePrintMode = 'totals' | 'items';

export interface ClientBalanceSummaryGroup {
  label: string;
  detail: string;
  fecha: string;
  saldo: number;
  lineas: ClientAccountLineItem[];
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-AR');
}

function formatMoney(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  return '$' + amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

@Injectable({ providedIn: 'root' })
export class ClientBalancePrintService {
  private auth = inject(AuthService);

  printSummary(
    clientName: string,
    groups: ClientBalanceSummaryGroup[],
    saldoTotal: number,
    mode: ClientBalancePrintMode = 'items'
  ): void {
    const companyName = this.auth.currentBusiness?.nombre?.trim() || 'RILO Gestión';
    const generatedAt = new Date().toLocaleString('es-AR');

    const totalsTableHtml =
      mode === 'totals'
        ? `<table class="summary-table">
            <thead>
              <tr>
                <th>Comprobante</th>
                <th>Fecha</th>
                <th>Detalle</th>
                <th class="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              ${groups
                .map(
                  (group) => `<tr>
                    <td>${escapeHtml(group.label)}</td>
                    <td>${escapeHtml(formatDate(group.fecha))}</td>
                    <td>${escapeHtml(group.detail)}</td>
                    <td class="num">${escapeHtml(formatMoney(group.saldo))}</td>
                  </tr>`
                )
                .join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3"><strong>Total pendiente</strong></td>
                <td class="num"><strong>${escapeHtml(formatMoney(saldoTotal))}</strong></td>
              </tr>
            </tfoot>
          </table>`
        : '';

    const groupsHtml =
      mode === 'items'
        ? groups
            .map((group) => {
              const linesHtml =
                group.lineas.length > 0
                  ? `<table class="lines">
                      <thead>
                        <tr>
                          <th>Ítem</th>
                          <th class="num">Cant.</th>
                          <th class="num">P. unit.</th>
                          <th class="num">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${group.lineas
                          .map(
                            (line) => `<tr>
                              <td>${escapeHtml(line.nombre)}</td>
                              <td class="num">${escapeHtml(line.cantidad)}</td>
                              <td class="num">${escapeHtml(formatMoney(line.precioUnitario))}</td>
                              <td class="num">${escapeHtml(formatMoney(line.subtotal))}</td>
                            </tr>`
                          )
                          .join('')}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colspan="3"><strong>Saldo pendiente</strong></td>
                          <td class="num"><strong>${escapeHtml(formatMoney(group.saldo))}</strong></td>
                        </tr>
                      </tfoot>
                    </table>`
                  : `<div class="group-foot">
                      <span>Saldo pendiente</span>
                      <strong>${escapeHtml(formatMoney(group.saldo))}</strong>
                    </div>`;

              return `<section class="group">
                <div class="group-head">
                  <div>
                    <h2>${escapeHtml(group.label)}</h2>
                    <p class="muted">${escapeHtml(group.detail)}${group.fecha ? ` · ${escapeHtml(formatDate(group.fecha))}` : ''}</p>
                  </div>
                  <strong class="group-saldo">${escapeHtml(formatMoney(group.saldo))}</strong>
                </div>
                ${linesHtml}
              </section>`;
            })
            .join('')
        : '';

    const bodyContent =
      mode === 'totals'
        ? totalsTableHtml
        : groupsHtml || '<p class="muted">No hay saldos pendientes.</p>';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Saldo pendiente — ${escapeHtml(clientName)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #111827;
      font-size: 12px;
      line-height: 1.4;
    }
    .header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid #ea580c;
    }
    .header h1 { margin: 0; font-size: 20px; color: #9a3412; }
    .header p { margin: 4px 0 0; color: #6b7280; font-size: 11px; }
    .meta { text-align: right; font-size: 11px; color: #4b5563; }
    .total-box {
      margin: 0 0 16px;
      padding: 12px 14px;
      border: 1px solid #fdba74;
      border-radius: 8px;
      background: #fff7ed;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .total-box span { font-size: 11px; text-transform: uppercase; color: #9a3412; font-weight: 700; }
    .total-box strong { font-size: 22px; color: #c2410c; }
    .group {
      margin-bottom: 14px;
      page-break-inside: avoid;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .group-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
    }
    .group-head h2 { margin: 0; font-size: 14px; }
    .group-saldo { font-size: 14px; color: #c2410c; white-space: nowrap; }
    .muted { margin: 2px 0 0; color: #6b7280; font-size: 11px; }
    table.lines { width: 100%; border-collapse: collapse; }
    table.lines th,
    table.lines td { padding: 6px 10px; border-top: 1px solid #f3f4f6; vertical-align: top; }
    table.lines th {
      font-size: 10px;
      text-transform: uppercase;
      color: #6b7280;
      background: #fff;
      text-align: left;
    }
    table.lines .num { text-align: right; white-space: nowrap; }
    table.lines tfoot td {
      border-top: 2px solid #e5e7eb;
      background: #fff7ed;
      font-size: 11px;
    }
    table.summary-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    table.summary-table th,
    table.summary-table td { padding: 8px 10px; border: 1px solid #e5e7eb; vertical-align: top; }
    table.summary-table th {
      font-size: 10px;
      text-transform: uppercase;
      color: #6b7280;
      background: #f9fafb;
      text-align: left;
    }
    table.summary-table tfoot td {
      background: #fff7ed;
      border-top: 2px solid #fdba74;
    }
    .group-foot {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      background: #fff7ed;
      border-top: 1px solid #e5e7eb;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <header class="header">
    <div>
      <h1>Saldo pendiente de cobro</h1>
      <p>${escapeHtml(companyName)} · ${escapeHtml(clientName)}</p>
    </div>
    <div class="meta">
      <div>Generado: ${escapeHtml(generatedAt)}</div>
      <div>${groups.length} comprobante${groups.length === 1 ? '' : 's'} con saldo</div>
    </div>
  </header>
  <div class="total-box">
    <span>Total pendiente</span>
    <strong>${escapeHtml(formatMoney(saldoTotal))}</strong>
  </div>
  ${bodyContent}
</body>
</html>`;

    const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
    if (!win) return;

    win.document.open();
    win.document.write(html);
    win.document.close();

    const cleanup = () => {
      win.close();
    };
    win.onafterprint = cleanup;

    win.onload = () => {
      win.focus();
      win.print();
    };
  }
}
