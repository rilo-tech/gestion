import { Injectable, inject } from '@angular/core';
import { Client } from './client.service';
import { Order, OrderLineItem, OrderPayment, formatOrderNumber } from './order.service';
import { AuthService } from './auth.service';
import { getOrderStatusLabel } from '../constants/order-status';

export interface OrderPrintOptions {
  companyName: string;
  showPrices: boolean;
  showBalance: boolean;
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
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-AR');
}

function formatMoney(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  return '$' + amount.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

function paymentLabel(pago: OrderPayment): string {
  if (pago.tipo === 'seña') return 'Seña';
  if (pago.notas === 'Pago total') return 'Pago total';
  if (pago.tipo === 'cuota') return 'Cuota';
  if (pago.tipo === 'extra') return 'Pago extra';
  return 'Pago';
}

function paymentLineLabel(pago: OrderPayment): string {
  const match = pago.notas?.match(/venta\s*#(\S+)/i);
  if (match) return `Cobro venta #${match[1]}`;
  return paymentLabel(pago);
}

function shouldShowPaymentNotas(pago: OrderPayment): boolean {
  if (!pago.notas?.trim()) return false;
  if (pago.notas === 'Pago total') return false;
  if (/venta\s*#\S+/i.test(pago.notas)) return false;
  return true;
}

function lineSubtotal(line: OrderLineItem, showPrices: boolean): number {
  if (!showPrices) return 0;
  const unit = line.precioVenta ?? 0;
  return unit * (line.cantidad ?? 0);
}

function personalizationSummary(line: OrderLineItem): string {
  const extras = line.costosExtra ?? [];
  if (extras.length === 0) {
    const legacy = line.costoPersonalizacion ?? 0;
    return legacy > 0 ? `Personalización (${formatMoney(legacy)})` : '';
  }
  return extras.map((extra) => `${extra.nombre} (${formatMoney(extra.costo)})`).join(' · ');
}

function renderClientBlock(client: Client | null, fallbackName: string): string {
  const name = client?.nombre?.trim() || fallbackName;
  const rows: string[] = [`<div class="block-name">${escapeHtml(name)}</div>`];

  if (client?.telefono?.trim()) {
    rows.push(`<div class="block-row"><span>Teléfono</span><strong>${escapeHtml(client.telefono)}</strong></div>`);
  }
  if (client?.email?.trim()) {
    rows.push(`<div class="block-row"><span>Email</span><strong>${escapeHtml(client.email)}</strong></div>`);
  }
  if (client?.direccion?.trim()) {
    rows.push(`<div class="block-row"><span>Dirección</span><strong>${escapeHtml(client.direccion)}</strong></div>`);
  }
  const ig = client?.redes?.instagram?.trim() || client?.redes?.igWeb?.trim();
  if (ig) {
    rows.push(`<div class="block-row"><span>Instagram</span><strong>${escapeHtml(ig)}</strong></div>`);
  }

  return rows.join('');
}

function renderItemsTable(order: Order, options: OrderPrintOptions): string {
  const lines = order.items ?? [];
  if (lines.length === 0) {
    return '<p class="empty-note">Sin productos cargados.</p>';
  }

  const head = options.showPrices
    ? `<tr>
        <th>Producto</th>
        <th class="num">Cant.</th>
        <th class="num">P. unit.</th>
        <th class="num">Subtotal</th>
      </tr>`
    : `<tr>
        <th>Producto</th>
        <th class="num">Cant.</th>
        <th>Detalle</th>
      </tr>`;

  const body = lines
    .map((line) => {
      const personalization = personalizationSummary(line);
      const detailCell = options.showPrices
        ? `<td class="num">${formatMoney(line.precioVenta)}</td>
           <td class="num">${formatMoney(lineSubtotal(line, true))}</td>`
        : `<td>${personalization ? escapeHtml(personalization) : '—'}</td>`;

      const extraRow =
        options.showPrices && personalization
          ? `<tr class="extra-row">
              <td colspan="4"><span class="extra-label">Personalización:</span> ${escapeHtml(personalization)}</td>
            </tr>`
          : '';

      return `<tr>
        <td><strong>${escapeHtml(line.nombre)}</strong></td>
        <td class="num">${escapeHtml(line.cantidad)}</td>
        ${detailCell}
      </tr>${extraRow}`;
    })
    .join('');

  return `<table class="items-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderPayments(order: Order, options: OrderPrintOptions): string {
  if (!options.showBalance) return '';
  const pagos = order.pagos ?? [];
  if (pagos.length === 0 && !(order.senia ?? 0)) return '';

  const rows = pagos
    .map((pago) => {
      const notas = shouldShowPaymentNotas(pago) ? ` · ${escapeHtml(pago.notas)}` : '';
      return `<tr>
        <td>${escapeHtml(paymentLineLabel(pago))}${notas}</td>
        <td>${formatDate(pago.fecha)}</td>
        <td class="num">${formatMoney(pago.monto)}</td>
      </tr>`;
    })
    .join('');

  const totalPagado = pagos.reduce((sum, pago) => sum + (pago.monto ?? 0), 0);

  return `
    <section class="section">
      <h2>Pagos</h2>
      <table class="payments-table">
        <thead>
          <tr>
            <th>Concepto</th>
            <th>Fecha</th>
            <th class="num">Monto</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals-inline">
        <div><span>Total pagado</span><strong>${formatMoney(totalPagado)}</strong></div>
        <div><span>Saldo pendiente</span><strong class="saldo">${formatMoney(order.saldo)}</strong></div>
      </div>
    </section>`;
}

function renderOrderSheet(
  order: Order,
  client: Client | null,
  clientName: string,
  options: OrderPrintOptions
): string {
  const orderNumber = formatOrderNumber(order);
  const orderRef = orderNumber ? `#${orderNumber}` : 'Sin número';
  const status = getOrderStatusLabel(order.estado);

  const totalsBlock = options.showPrices
    ? `<div class="totals-box">
        <div class="total-main">
          <span>Total del pedido</span>
          <strong>${formatMoney(order.total)}</strong>
        </div>
        ${
          options.showBalance
            ? `<div class="total-secondary">
                <span>Seña / pagos</span>
                <strong>${formatMoney(order.totalPagado ?? order.senia ?? 0)}</strong>
              </div>
              <div class="total-secondary saldo">
                <span>Saldo</span>
                <strong>${formatMoney(order.saldo)}</strong>
              </div>`
            : ''
        }
      </div>`
    : '';

  return `
    <article class="sheet">
      <header class="sheet-header">
        <div class="brand">
          <p class="brand-label">Pedido personalizado</p>
          <h1>${escapeHtml(options.companyName)}</h1>
        </div>
        <div class="order-badge">
          <div class="order-number">${escapeHtml(orderRef)}</div>
          <div class="order-status">${escapeHtml(status)}</div>
        </div>
      </header>

      <div class="meta-grid">
        <div class="meta-card">
          <span>Fecha pedido</span>
          <strong>${formatDate(order.createdAt)}</strong>
        </div>
        <div class="meta-card">
          <span>Fecha entrega</span>
          <strong>${formatDate(order.fechaEntrega)}</strong>
        </div>
        ${
          order.entregadoAt
            ? `<div class="meta-card">
                <span>Entregado</span>
                <strong>${formatDate(order.entregadoAt)}</strong>
              </div>`
            : ''
        }
        ${
          order.ventaId
            ? `<div class="meta-card">
                <span>Venta vinculada</span>
                <strong>Sí</strong>
              </div>`
            : ''
        }
      </div>

      <div class="two-cols">
        <section class="info-block">
          <h2>Empresa</h2>
          <div class="block-name">${escapeHtml(options.companyName)}</div>
        </section>
        <section class="info-block">
          <h2>Cliente</h2>
          ${renderClientBlock(client, clientName)}
        </section>
      </div>

      ${
        order.descripcion?.trim()
          ? `<section class="section description-box">
              <h2>Descripción del pedido</h2>
              <p>${escapeHtml(order.descripcion).replace(/\n/g, '<br>')}</p>
            </section>`
          : ''
      }

      <section class="section">
        <h2>Productos</h2>
        ${renderItemsTable(order, options)}
      </section>

      ${renderPayments(order, options)}

      ${totalsBlock}

      <footer class="sheet-footer">
        <span>Impreso ${formatDate(new Date().toISOString())}</span>
        <span>${escapeHtml(orderRef)} · ${escapeHtml(client?.nombre || clientName)}</span>
      </footer>
    </article>`;
}

function buildPrintStyles(): string {
  return `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      color: #111827;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @page { size: A4; margin: 14mm; }
    .sheet {
      page-break-after: always;
      min-height: calc(297mm - 28mm);
      display: flex;
      flex-direction: column;
      gap: 18px;
      padding: 4mm 0 8mm;
    }
    .sheet:last-child { page-break-after: auto; }
    .sheet-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding-bottom: 16px;
      border-bottom: 3px solid #0d9488;
    }
    .brand-label {
      margin: 0 0 4px;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6b7280;
      font-weight: 700;
    }
    .brand h1 {
      margin: 0;
      font-size: 26px;
      line-height: 1.15;
      color: #0f766e;
    }
    .order-badge { text-align: right; }
    .order-number {
      font-size: 28px;
      font-weight: 800;
      color: #111827;
      letter-spacing: 0.02em;
    }
    .order-status {
      margin-top: 6px;
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      background: #ecfdf5;
      color: #047857;
      font-size: 12px;
      font-weight: 700;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
    }
    .meta-card {
      padding: 10px 12px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #f9fafb;
    }
    .meta-card span {
      display: block;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .meta-card strong { font-size: 14px; }
    .two-cols {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .info-block, .section {
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 14px 16px;
    }
    .info-block h2, .section h2 {
      margin: 0 0 10px;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6b7280;
    }
    .block-name {
      font-size: 18px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 6px;
    }
    .block-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 13px;
      padding: 4px 0;
      border-top: 1px solid #f3f4f6;
    }
    .block-row span { color: #6b7280; }
    .description-box p {
      margin: 0;
      font-size: 14px;
      line-height: 1.55;
      white-space: pre-wrap;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 8px 10px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
    }
    th {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      background: #f9fafb;
    }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .extra-row td {
      background: #f9fafb;
      font-size: 12px;
      color: #374151;
      border-bottom: 1px solid #e5e7eb;
    }
    .extra-label { color: #6b7280; font-weight: 700; }
    .empty-note { margin: 0; color: #6b7280; font-size: 13px; }
    .totals-inline {
      margin-top: 10px;
      display: flex;
      justify-content: flex-end;
      gap: 24px;
      font-size: 13px;
    }
    .totals-inline span { display: block; color: #6b7280; font-size: 11px; }
    .totals-inline strong { font-size: 15px; }
    .totals-inline .saldo strong { color: #c2410c; }
    .totals-box {
      margin-top: auto;
      padding: 16px;
      border-radius: 12px;
      background: linear-gradient(135deg, #ecfdf5, #f0fdfa);
      border: 1px solid #99f6e4;
      display: grid;
      gap: 8px;
    }
    .total-main, .total-secondary {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 16px;
    }
    .total-main span, .total-secondary span {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #047857;
      font-weight: 700;
    }
    .total-main strong { font-size: 24px; color: #065f46; }
    .total-secondary strong { font-size: 16px; color: #047857; }
    .total-secondary.saldo strong { color: #c2410c; }
    .sheet-footer {
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px dashed #d1d5db;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 11px;
      color: #9ca3af;
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

export function buildOrdersPrintDocument(
  orders: Order[],
  clientsById: Map<string, Client>,
  options: OrderPrintOptions
): string {
  const sheets = orders
    .map((order) => {
      const client = clientsById.get(order.clienteId) ?? null;
      const clientName = client?.nombre ?? 'Cliente sin nombre';
      return renderOrderSheet(order, client, clientName, options);
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Pedidos · ${escapeHtml(options.companyName)}</title>
  <style>${buildPrintStyles()}</style>
</head>
<body>${sheets}</body>
</html>`;
}

@Injectable({ providedIn: 'root' })
export class OrderPrintService {
  private auth = inject(AuthService);

  printOrders(orders: Order[], clientsById: Map<string, Client>): void {
    if (!orders.length || !this.auth.canPrintOrders) return;

    const html = buildOrdersPrintDocument(orders, clientsById, {
      companyName: this.auth.appBrandTitle,
      showPrices: this.auth.canViewOrderSalePrice,
      showBalance: this.auth.canViewAccountBalance,
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
      window.setTimeout(cleanup, 1500);
    }, 250);
  }
}
