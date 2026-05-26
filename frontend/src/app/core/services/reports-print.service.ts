import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import {
  REPORT_GROUP_BY_OPTIONS,
  ReportGroupBy,
  ReportResult,
} from './reports.service';

export interface ReportsPrintOptions {
  companyName: string;
  showEconomics: boolean;
  showCollaborators: boolean;
  groupByLabel: string;
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
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-AR');
}

function formatMoney(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  return '$' + amount.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

function formatNumber(value: number | null | undefined, digits = 1): string {
  const amount = Number(value ?? 0);
  return amount.toLocaleString('es-AR', { maximumFractionDigits: digits });
}

function buildPrintStyles(): string {
  return `
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #111827;
      font-size: 12px;
      line-height: 1.45;
    }
    .sheet { page-break-after: always; }
    .sheet:last-child { page-break-after: auto; }
    .header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid #0d9488;
    }
    .header h1 { margin: 0; font-size: 20px; color: #0f766e; }
    .header p { margin: 4px 0 0; color: #6b7280; font-size: 11px; }
    .meta { text-align: right; font-size: 11px; color: #4b5563; }
    .kpis {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 16px;
    }
    .kpi {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 10px;
      background: #f9fafb;
    }
    .kpi span {
      display: block;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #9ca3af;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .kpi strong { font-size: 16px; color: #111827; }
    h2 {
      margin: 18px 0 8px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #374151;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    th, td {
      border: 1px solid #e5e7eb;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f3f4f6;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #6b7280;
    }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .footer {
      margin-top: 16px;
      padding-top: 8px;
      border-top: 1px dashed #d1d5db;
      font-size: 10px;
      color: #9ca3af;
      display: flex;
      justify-content: space-between;
    }
    @media screen {
      body { padding: 16px; background: #f3f4f6; }
      .sheet {
        max-width: 210mm;
        margin: 0 auto 24px;
        background: #fff;
        box-shadow: 0 10px 30px rgba(0,0,0,0.08);
        padding: 18mm 16mm;
        border-radius: 8px;
      }
    }
  `;
}

function filterSummaryLines(report: ReportResult): string[] {
  const f = report.filters;
  const lines: string[] = [
    `Período: ${formatDate(report.period.from)} – ${formatDate(report.period.to)} (${report.period.days} días)`,
    `Agrupado por: ${escapeHtml(
      REPORT_GROUP_BY_OPTIONS.find((o) => o.value === f.groupBy)?.label ?? f.groupBy
    )}`,
  ];
  if (f.clienteId) lines.push('Filtro: cliente seleccionado');
  if (f.productoId) lines.push('Filtro: producto seleccionado');
  if (f.categoria) lines.push(`Categoría: ${escapeHtml(f.categoria)}`);
  if (f.tipo) lines.push(`Tipo: ${escapeHtml(f.tipo)}`);
  if (f.talle) lines.push(`Talle: ${escapeHtml(f.talle)}`);
  if (f.color) lines.push(`Color: ${escapeHtml(f.color)}`);
  return lines;
}

export function buildReportsPrintDocument(
  report: ReportResult,
  options: ReportsPrintOptions
): string {
  const s = report.summary;
  const showStock = report.filters.groupBy === 'product';
  const showEconomics = options.showEconomics;

  const kpiHtml = `
    <div class="kpis">
      <div class="kpi"><span>Ventas</span><strong>${s.ventasCount}</strong></div>
      <div class="kpi"><span>Unidades</span><strong>${formatNumber(s.unidadesVendidas, 0)}</strong></div>
      <div class="kpi"><span>Facturado</span><strong>${formatMoney(s.facturado)}</strong></div>
      <div class="kpi"><span>Cobrado</span><strong>${formatMoney(s.cobrado)}</strong></div>
      <div class="kpi"><span>Ticket prom.</span><strong>${formatMoney(s.ticketPromedio)}</strong></div>
      ${
        showEconomics
          ? `<div class="kpi"><span>Ganancia</span><strong>${formatMoney(s.ganancia)}</strong></div>`
          : ''
      }
    </div>`;

  const groupRows = report.groups
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.label)}</td>
        <td class="num">${formatNumber(row.cantidad, 0)}</td>
        <td class="num">${formatMoney(row.facturado)}</td>
        ${showEconomics ? `<td class="num">${formatMoney(row.ganancia)}</td>` : ''}
        ${
          showStock
            ? `<td class="num">${formatNumber(row.stockActual ?? 0, 0)}</td>
               <td class="num">${formatNumber(row.stockSugeridoMes ?? 0, 1)}</td>
               <td class="num">${formatNumber(row.faltanteMes ?? 0, 1)}</td>`
            : ''
        }
      </tr>`
    )
    .join('');

  const monthlyRows = report.monthlyTrend
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.label)}</td>
        <td class="num">${formatNumber(row.cantidad, 0)}</td>
        <td class="num">${formatMoney(row.facturado)}</td>
        ${showEconomics ? `<td class="num">${formatMoney(row.ganancia)}</td>` : ''}
        <td class="num">${row.ventasCount}</td>
      </tr>`
    )
    .join('');

  const inactiveRows = report.inactiveClients
    .slice(0, 25)
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.nombre)}</td>
        <td>${formatDate(row.ultimaCompra)}</td>
        <td class="num">${row.diasSinComprar ?? '—'}</td>
        <td class="num">${formatMoney(row.totalHistorico)}</td>
      </tr>`
    )
    .join('');

  const clientBlock = report.clientDetail
    ? `<h2>Detalle del cliente · ${escapeHtml(report.clientDetail.clienteNombre)}</h2>
       <table>
         <thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Facturado</th></tr></thead>
         <tbody>
           ${report.clientDetail.productos
             .map(
               (p) => `<tr>
                 <td>${escapeHtml(p.nombre)}</td>
                 <td class="num">${formatNumber(p.cantidad, 0)}</td>
                 <td class="num">${formatMoney(p.facturado)}</td>
               </tr>`
             )
             .join('')}
         </tbody>
       </table>`
    : '';

  const collab = report.collaboratorsSummary;
  const collaboratorsBlock =
    options.showCollaborators && collab
      ? `<h2>Colaboradores · costo de personal</h2>
         <p>Horas: ${formatNumber(collab.totalHoras, 1)} · Devengado: ${formatMoney(collab.totalDevengado)} · Pagado: ${formatMoney(collab.totalPagado)} · Pendiente: ${formatMoney(collab.totalPendientePeriodo)}</p>
         <table>
           <thead><tr><th>Colaborador</th><th class="num">Horas</th><th class="num">Devengado</th><th class="num">Pagado</th><th class="num">Pendiente</th></tr></thead>
           <tbody>
             ${collab.colaboradores
               .map(
                 (row) => `<tr>
                   <td>${escapeHtml(row.nombre)}</td>
                   <td class="num">${formatNumber(row.horas, 1)}</td>
                   <td class="num">${formatMoney(row.devengado)}</td>
                   <td class="num">${formatMoney(row.pagado)}</td>
                   <td class="num">${formatMoney(row.pendientePeriodo)}</td>
                 </tr>`
               )
               .join('') || '<tr><td colspan="5">Sin datos.</td></tr>'}
           </tbody>
         </table>`
      : '';

  const metaLines = filterSummaryLines(report)
    .map((line) => `<div>${line}</div>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Reportes · ${escapeHtml(options.companyName)}</title>
  <style>${buildPrintStyles()}</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <h1>Reporte de ventas</h1>
        <p>${escapeHtml(options.companyName)}</p>
      </div>
      <div class="meta">
        ${metaLines}
        <div>Impreso: ${formatDate(new Date().toISOString())}</div>
      </div>
    </div>

    ${kpiHtml}

    <h2>Resultado · ${escapeHtml(options.groupByLabel)}</h2>
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(options.groupByLabel)}</th>
          <th class="num">Cant.</th>
          <th class="num">Facturado</th>
          ${showEconomics ? '<th class="num">Ganancia</th>' : ''}
          ${
            showStock
              ? '<th class="num">Stock</th><th class="num">Sug. 30 d</th><th class="num">Faltante</th>'
              : ''
          }
        </tr>
      </thead>
      <tbody>${groupRows || '<tr><td colspan="8">Sin datos en el período.</td></tr>'}</tbody>
    </table>

    ${clientBlock}

    ${collaboratorsBlock}

    <h2>Tendencia mensual del período</h2>
    <table>
      <thead>
        <tr>
          <th>Mes</th>
          <th class="num">Unidades</th>
          <th class="num">Facturado</th>
          ${showEconomics ? '<th class="num">Ganancia</th>' : ''}
          <th class="num">Ventas</th>
        </tr>
      </thead>
      <tbody>${monthlyRows || '<tr><td colspan="5">Sin datos.</td></tr>'}</tbody>
    </table>

    <p><strong>Promedio mensual en el período:</strong>
      ${formatNumber(report.promedioMensual.cantidad, 1)} u. ·
      ${formatMoney(report.promedioMensual.facturado)}
      ${showEconomics ? ` · ${formatMoney(report.promedioMensual.ganancia)} ganancia` : ''}
    </p>

    <h2>Clientes · días sin comprar (top 25)</h2>
    <table>
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Última compra</th>
          <th class="num">Días</th>
          <th class="num">Total histórico</th>
        </tr>
      </thead>
      <tbody>${inactiveRows || '<tr><td colspan="4">Sin clientes con ventas.</td></tr>'}</tbody>
    </table>

    <div class="footer">
      <span>RILO Gestión · Reportes</span>
      <span>${escapeHtml(options.companyName)}</span>
    </div>
  </div>
</body>
</html>`;
}

@Injectable({ providedIn: 'root' })
export class ReportsPrintService {
  private auth = inject(AuthService);

  print(report: ReportResult, groupBy: ReportGroupBy): void {
    const groupByLabel =
      REPORT_GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label ?? 'Detalle';

    const html = buildReportsPrintDocument(report, {
      companyName: this.auth.appBrandTitle,
      showEconomics: this.auth.canViewEconomics,
      showCollaborators: this.auth.canAccessCollaborators,
      groupByLabel,
    });

    this.openPrintDialog(html);
  }

  private openPrintDialog(html: string): void {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText =
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const doc = win?.document;
    if (!doc || !win) {
      document.body.removeChild(iframe);
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    const cleanup = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    win.onafterprint = cleanup;

    window.setTimeout(() => {
      win.focus();
      win.print();
      window.setTimeout(cleanup, 1000);
    }, 250);
  }
}
