import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import type { ClientAccountLineItem } from './client.service';
import {
  buildClientAccountDetail,
  formatAccountDate,
  formatAccountMoney,
} from '../utils/client-account-detail';

export interface ClientBalanceSummaryGroup {
  /** Referencia interna: Venta #00239 / Pedido #00226 */
  label: string;
  /** Concepto principal (ítems / descripción). */
  detail: string;
  fecha: string;
  /** Saldo pendiente REAL del comprobante (no re-sumar ítems). */
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

@Injectable({ providedIn: 'root' })
export class ClientBalancePrintService {
  private auth = inject(AuthService);

  /**
   * Estado de cuenta para el cliente: tabla compacta Fecha | Detalle | Importe.
   * Un renglón por comprobante con saldo pendiente (sin duplicar el saldo por ítem).
   */
  printSummary(
    clientName: string,
    groups: ClientBalanceSummaryGroup[],
    saldoTotal: number,
    _mode?: unknown
  ): void {
    const companyName = this.auth.currentBusiness?.nombre?.trim() || 'RILO';
    const emittedAt = formatAccountDate(new Date().toISOString());

    const rowsHtml = groups
      .map((group) => {
        const detail = buildClientAccountDetail({
          lineas: group.lineas,
          concepto: group.detail,
          referencia: group.label,
        });
        const detailHtml = escapeHtml(detail.primary.replace(/\n/g, ' · '));
        const refHtml = escapeHtml(group.label);
        return `<tr>
          <td class="date">${escapeHtml(formatAccountDate(group.fecha))}</td>
          <td class="detail">
            <span class="concept">${detailHtml}</span>
            <span class="ref"> · ${refHtml}</span>
          </td>
          <td class="num">${escapeHtml(formatAccountMoney(group.saldo))}</td>
        </tr>`;
      })
      .join('');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Estado de cuenta — ${escapeHtml(clientName)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #111827;
      font-size: 11.5px;
      line-height: 1.35;
      background: #fff;
    }
    .head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1.5px solid #d1d5db;
    }
    .brand { font-size: 18px; font-weight: 800; letter-spacing: 0.02em; margin: 0; }
    .doc-title { margin: 2px 0 0; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #4b5563; }
    .meta { text-align: right; font-size: 11px; color: #4b5563; }
    .meta strong { color: #111827; }
    .saldo-box {
      margin: 0 0 14px;
      padding: 10px 12px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      background: #f9fafb;
    }
    .saldo-box span { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #6b7280; }
    .saldo-box strong { font-size: 20px; font-weight: 800; color: #111827; }
    table.ledger {
      width: 100%;
      border-collapse: collapse;
    }
    table.ledger th,
    table.ledger td {
      padding: 5px 8px;
      border-bottom: 1px solid #e5e7eb;
      vertical-align: middle;
    }
    table.ledger th {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #6b7280;
      text-align: left;
      border-bottom: 1.5px solid #d1d5db;
      background: #fff;
    }
    table.ledger .date { width: 18%; white-space: nowrap; color: #374151; }
    table.ledger .detail { width: 57%; }
    table.ledger .num { width: 25%; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .concept { font-weight: 600; color: #111827; }
    .ref { font-size: 10px; color: #9ca3af; }
    table.ledger tfoot td {
      border-top: 1.5px solid #111827;
      border-bottom: none;
      padding-top: 10px;
      font-weight: 700;
    }
    table.ledger tfoot .label { text-align: right; }
    .empty { color: #6b7280; padding: 12px 0; }
  </style>
</head>
<body>
  <header class="head">
    <div>
      <p class="brand">${escapeHtml(companyName)}</p>
      <p class="doc-title">Estado de cuenta</p>
    </div>
    <div class="meta">
      <div><strong>Cliente:</strong> ${escapeHtml(clientName)}</div>
      <div><strong>Emisión:</strong> ${escapeHtml(emittedAt)}</div>
    </div>
  </header>

  <div class="saldo-box">
    <span>Saldo pendiente</span>
    <strong>${escapeHtml(formatAccountMoney(saldoTotal))}</strong>
  </div>

  ${
    groups.length
      ? `<table class="ledger">
          <thead>
            <tr>
              <th class="date">Fecha</th>
              <th class="detail">Detalle</th>
              <th class="num">Importe</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" class="label">TOTAL</td>
              <td class="num">${escapeHtml(formatAccountMoney(saldoTotal))}</td>
            </tr>
          </tfoot>
        </table>`
      : '<p class="empty">No hay saldos pendientes.</p>'
  }
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
