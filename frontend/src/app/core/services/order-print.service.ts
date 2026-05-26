import { Injectable, inject } from '@angular/core';
import { forkJoin } from 'rxjs';
import { Client } from './client.service';
import { Order, OrderLineItem, formatOrderNumber, normalizeOrderForPrint } from './order.service';
import { AuthService } from './auth.service';
import { CatalogConfigService, type OrderPedidosConfigShape } from './catalog-config.service';
import { getOrderStatusLabel } from '../constants/order-status';
import { StockService, getStockDisponible, itemControlsStock } from './stock.service';

export interface OrderPrintOptions {
  companyName: string;
  showPrices: boolean;
  showBalance: boolean;
  dualCopy: boolean;
  pedidos?: OrderPedidosConfigShape;
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

function lineSubtotal(line: OrderLineItem, showPrices: boolean): number {
  if (!showPrices) return 0;
  const unit = line.precioVenta ?? 0;
  return unit * (line.cantidad ?? 0);
}

function lineStockPrintNote(line: OrderLineItem, order: Order): string {
  if (!line.stockItemId || line.controlaStock === false) return '';

  if (order.stockPreparado) {
    const reservada = Math.max(0, Number(line.cantidadReservada) || 0);
    const faltante = Math.max(0, Number(line.cantidadFaltante) || 0);
    if (faltante > 0) {
      return `Reservado ${reservada} u. · Faltan ${faltante} para comprar`;
    }
    return `Reservado ${reservada} u. · Stock alcanza`;
  }

  if (line.stockDisponible === undefined) return '';
  const qty = Number(line.cantidad) || 0;
  const disponible = Math.max(0, Number(line.stockDisponible) || 0);
  const shortage = Math.max(0, qty - disponible);
  if (shortage > 0) {
    return `Libre ${disponible} u. (sin reservar acá) · Faltarían ${shortage} para comprar`;
  }
  return `Libre ${disponible} u. (sin reservar acá) · Stock alcanza`;
}

function stockPrintLines(order: Order): OrderLineItem[] {
  return (order.items ?? []).filter(
    (line) => line.stockItemId && line.controlaStock !== false && (Number(line.cantidad) || 0) > 0
  );
}

function orderHasStockPrint(order: Order): boolean {
  return !!order.stockPreparado && stockPrintLines(order).length > 0;
}

function renderStockCompactSection(order: Order): string {
  if (!orderHasStockPrint(order)) return '';

  const rows = stockPrintLines(order)
    .map((line) => {
      const reservada = Math.max(0, Number(line.cantidadReservada) || 0);
      const faltante = Math.max(0, Number(line.cantidadFaltante) || 0);
      return `<tr>
        <td>${escapeHtml(line.nombre)}</td>
        <td class="num">${escapeHtml(line.cantidad)}</td>
        <td class="num stock-ok">${reservada}</td>
        <td class="num stock-missing">${faltante > 0 ? faltante : '—'}</td>
      </tr>`;
    })
    .join('');

  return `
    <section class="section stock-compact-section">
      <h2>Stock para armado</h2>
      <table class="stock-table">
        <thead>
          <tr>
            <th>Producto</th>
            <th class="num">Pedido</th>
            <th class="num">Reservado</th>
            <th class="num">Falta comprar</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderStockAssemblySheet(
  order: Order,
  client: Client | null,
  clientName: string,
  options: OrderPrintOptions
): string {
  if (!orderHasStockPrint(order)) return '';

  const orderNumber = formatOrderNumber(order);
  const orderRef = orderNumber ? `#${orderNumber}` : 'Sin número';
  const lines = stockPrintLines(order);

  const rows = lines
    .map((line) => {
      const reservada = Math.max(0, Number(line.cantidadReservada) || 0);
      const faltante = Math.max(0, Number(line.cantidadFaltante) || 0);
      return `<tr>
        <td><strong>${escapeHtml(line.nombre)}</strong></td>
        <td class="num">${escapeHtml(line.cantidad)}</td>
        <td class="num stock-ok">${reservada}</td>
        <td class="num stock-missing">${faltante}</td>
      </tr>`;
    })
    .join('');

  const purchaseLines = lines.filter((line) => (Number(line.cantidadFaltante) || 0) > 0);
  const purchaseList =
    purchaseLines.length > 0
      ? `<section class="section purchase-box">
          <h2>Lista para comprar</h2>
          <ul class="purchase-list">
            ${purchaseLines
              .map(
                (line) =>
                  `<li><strong>${escapeHtml(line.nombre)}</strong> · ${Math.max(0, Number(line.cantidadFaltante) || 0)} u.</li>`
              )
              .join('')}
          </ul>
        </section>`
      : `<p class="complete-note">Todo el stock necesario está reservado. No hay compras pendientes para este pedido.</p>`;

  const reservedLines = lines.filter((line) => (Number(line.cantidadReservada) || 0) > 0);
  const reservedList =
    reservedLines.length > 0
      ? `<section class="section reserve-box">
          <h2>En reserva (depósito)</h2>
          <ul class="reserve-list">
            ${reservedLines
              .map(
                (line) =>
                  `<li><strong>${escapeHtml(line.nombre)}</strong> · ${Math.max(0, Number(line.cantidadReservada) || 0)} u.</li>`
              )
              .join('')}
          </ul>
        </section>`
      : '';

  return `
    <article class="sheet sheet--stock">
      <header class="sheet-header">
        <div class="brand">
          <p class="brand-label">Armado y compras</p>
          <h1>${escapeHtml(options.companyName)}</h1>
        </div>
        <div class="order-badge">
          <div class="order-number">${escapeHtml(orderRef)}</div>
          <div class="order-status">Revisión de stock</div>
        </div>
      </header>

      ${renderClientLine(client, clientName)}

      <section class="section">
        <h2>Detalle por producto</h2>
        <table class="stock-table stock-table--full">
          <thead>
            <tr>
              <th>Producto</th>
              <th class="num">Pedido</th>
              <th class="num">Reservado</th>
              <th class="num">Falta comprar</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>

      <div class="stock-columns">
        ${reservedList}
        ${purchaseList}
      </div>

      <footer class="sheet-footer">
        <span>Impreso ${formatDate(new Date().toISOString())}</span>
        <span>${escapeHtml(orderRef)} · Armado</span>
      </footer>
    </article>`;
}

function renderClientLine(client: Client | null, fallbackName: string): string {
  const name = client?.nombre?.trim() || fallbackName;
  const phone = client?.telefono?.trim();
  const extras: string[] = [];

  if (phone) {
    extras.push(`<span class="client-phone">${escapeHtml(phone)}</span>`);
  }
  if (client?.email?.trim()) {
    extras.push(`<span class="client-extra">${escapeHtml(client.email)}</span>`);
  }
  if (client?.direccion?.trim()) {
    extras.push(`<span class="client-extra">${escapeHtml(client.direccion)}</span>`);
  }

  const ig = client?.redes?.instagram?.trim() || client?.redes?.igWeb?.trim();
  if (ig) {
    extras.push(`<span class="client-extra">${escapeHtml(ig)}</span>`);
  }

  const suffix = extras.length ? `<span class="client-meta">${extras.join('')}</span>` : '';

  return `<div class="client-line">
    <span class="client-label">Cliente</span>
    <span class="client-value"><strong>${escapeHtml(name)}</strong>${suffix}</span>
  </div>`;
}

function renderMetaStrip(order: Order, client: Client | null, clientName: string): string {
  const name = client?.nombre?.trim() || clientName;
  const phone = client?.telefono?.trim();
  let clientItem = `<span class="meta-item meta-item--client"><em>Cliente</em> <strong>${escapeHtml(name)}</strong>`;
  if (phone) {
    clientItem += `<span class="meta-phone">${escapeHtml(phone)}</span>`;
  }
  clientItem += '</span>';

  const items = [
    clientItem,
    `<span class="meta-item"><em>Pedido</em> <strong>${formatDate(order.createdAt)}</strong></span>`,
    `<span class="meta-item"><em>Entrega</em> <strong>${formatDate(order.fechaEntrega)}</strong></span>`,
  ];

  if (order.entregadoAt) {
    items.push(
      `<span class="meta-item"><em>Entregado</em> <strong>${formatDate(order.entregadoAt)}</strong></span>`
    );
  }

  return `<div class="meta-strip">${items.join('')}</div>`;
}

function renderItemsTable(order: Order, options: OrderPrintOptions): string {
  const lines = order.items ?? [];
  if (lines.length === 0) {
    return '<p class="empty-note">Sin productos cargados.</p>';
  }

  const colCount = options.showPrices ? 4 : 2;

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
      </tr>`;

  const body = lines
    .map((line) => {
      const stockNote = lineStockPrintNote(line, order);
      const detailCell = options.showPrices
        ? `<td class="num">${formatMoney(line.precioVenta)}</td>
           <td class="num">${formatMoney(lineSubtotal(line, true))}</td>`
        : '';

      const stockRow = stockNote
        ? `<tr class="extra-row">
              <td colspan="${colCount}"><span class="stock-note">${escapeHtml(stockNote)}</span></td>
            </tr>`
        : '';

      return `<tr>
        <td><strong>${escapeHtml(line.nombre)}</strong></td>
        <td class="num">${escapeHtml(line.cantidad)}</td>
        ${detailCell}
      </tr>${stockRow}`;
    })
    .join('');

  return `<table class="items-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderBalanceFooter(order: Order, options: OrderPrintOptions): string {
  if (!options.showPrices && !options.showBalance) return '';

  const { saldo, senia } = normalizeOrderForPrint(order);

  const totalRow = options.showPrices
    ? `<div class="balance-item balance-item--total">
        <span>Total</span>
        <strong>${formatMoney(order.total)}</strong>
      </div>`
    : '';

  const señaRow = options.showBalance
    ? `<div class="balance-item">
        <span>Seña</span>
        <strong>${formatMoney(senia)}</strong>
      </div>`
    : '';

  const saldoRow = options.showBalance
    ? `<div class="balance-item balance-item--saldo">
        <span>Saldo</span>
        <strong>${formatMoney(saldo)}</strong>
      </div>`
    : '';

  if (!totalRow && !señaRow && !saldoRow) return '';

  return `<div class="balance-footer">${totalRow}${señaRow}${saldoRow}</div>`;
}

function renderOrderSheet(
  order: Order,
  client: Client | null,
  clientName: string,
  options: OrderPrintOptions,
  viaLabel?: string
): string {
  const orderNumber = formatOrderNumber(order);
  const orderRef = orderNumber ? `#${orderNumber}` : 'Sin número';
  const status = getOrderStatusLabel(order.estado, options.pedidos);

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

      ${renderMetaStrip(order, client, clientName)}

      ${
        order.descripcion?.trim()
          ? `<section class="section description-box">
              <h2>Descripción del pedido</h2>
              <p>${escapeHtml(order.descripcion).replace(/\n/g, '<br>')}</p>
            </section>`
          : ''
      }

      <section class="section products-section">
        <h2>Productos</h2>
        ${renderItemsTable(order, options)}
      </section>

      ${renderStockCompactSection(order)}

      ${renderBalanceFooter(order, options)}

      <footer class="sheet-footer">
        <span>Impreso ${formatDate(new Date().toISOString())}</span>
        <span>${escapeHtml(orderRef)} · ${escapeHtml(client?.nombre || clientName)}</span>
        ${viaLabel ? `<span class="via-label">${escapeHtml(viaLabel)}</span>` : ''}
      </footer>
    </article>`;
}

function renderOrderPage(
  order: Order,
  client: Client | null,
  clientName: string,
  options: OrderPrintOptions
): string {
  const orderPage = options.dualCopy
    ? `
    <div class="print-page print-page--dual">
      ${renderOrderSheet(order, client, clientName, options, '1ª vía')}
      <div class="via-divider" aria-hidden="true"></div>
      ${renderOrderSheet(order, client, clientName, options, '2ª vía')}
    </div>`
    : renderOrderSheet(order, client, clientName, options);

  const stockPage = renderStockAssemblySheet(order, client, clientName, options);

  return `${orderPage}${stockPage}`;
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
    @page { size: A4; margin: 12mm; }
    .sheet {
      page-break-after: always;
      min-height: calc(297mm - 24mm);
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 2mm 0 4mm;
    }
    .sheet:last-child { page-break-after: auto; }
    .print-page--dual {
      page-break-after: always;
      height: calc(297mm - 24mm);
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 0;
    }
    .print-page--dual:last-child { page-break-after: auto; }
    .print-page--dual .sheet {
      page-break-after: auto;
      min-height: 0;
      flex: 1 1 0;
      overflow: hidden;
      padding: 1mm 0 2mm;
      gap: 5px;
    }
    .via-divider {
      flex-shrink: 0;
      height: 12mm;
      margin: 1mm 0;
      border: none;
      background:
        linear-gradient(#fff, #fff) padding-box,
        repeating-linear-gradient(90deg, #9ca3af 0 6px, transparent 6px 12px) border-box;
      border-top: 2px dashed #6b7280;
      border-bottom: 2px dashed #6b7280;
      position: relative;
    }
    .via-divider::after {
      content: 'Corte';
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      background: #fff;
      padding: 0 5mm;
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #6b7280;
    }
    .via-label {
      font-weight: 700;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .sheet-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #0d9488;
    }
    .brand-label {
      margin: 0 0 2px;
      font-size: 9px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6b7280;
      font-weight: 700;
    }
    .brand h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.1;
      color: #0f766e;
    }
    .order-badge { text-align: right; }
    .order-number {
      font-size: 20px;
      font-weight: 800;
      color: #111827;
      letter-spacing: 0.02em;
      line-height: 1;
    }
    .order-status {
      margin-top: 4px;
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      background: #ecfdf5;
      color: #047857;
      font-size: 10px;
      font-weight: 700;
    }
    .meta-strip {
      display: flex;
      flex-wrap: nowrap;
      align-items: baseline;
      gap: 8px 14px;
      padding: 4px 8px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f9fafb;
      font-size: 11px;
    }
    .meta-item {
      display: inline-flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0 4px;
      min-width: 0;
    }
    .meta-item--client { flex: 1 1 auto; }
    .meta-item em {
      font-style: normal;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      font-weight: 700;
      margin-right: 4px;
    }
    .meta-item strong { font-size: 11px; }
    .meta-phone {
      color: #374151;
      font-weight: 600;
    }
    .meta-phone::before {
      content: '·';
      margin: 0 6px;
      color: #9ca3af;
      font-weight: 400;
    }
    .client-line {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 6px 10px;
      padding: 4px 8px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      font-size: 11px;
    }
    .client-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      font-weight: 700;
      flex-shrink: 0;
    }
    .client-value strong { font-size: 12px; }
    .client-meta {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0 8px;
      margin-left: 6px;
      color: #374151;
    }
    .client-phone::before {
      content: '·';
      margin-right: 8px;
      color: #9ca3af;
    }
    .client-extra::before {
      content: '·';
      margin-right: 8px;
      color: #9ca3af;
    }
    .section {
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 8px 10px;
    }
    .section h2 {
      margin: 0 0 6px;
      font-size: 9px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6b7280;
    }
    .description-box {
      flex: 1 1 auto;
      min-height: 48px;
      display: flex;
      flex-direction: column;
    }
    .description-box p {
      margin: 0;
      flex: 1 1 auto;
      font-size: 18px;
      line-height: 1.45;
      font-weight: 500;
      white-space: pre-wrap;
    }
    .products-section {
      flex-shrink: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    th, td {
      padding: 4px 6px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
    }
    th {
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      background: #f9fafb;
    }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .extra-row td {
      background: #f9fafb;
      font-size: 10px;
      color: #374151;
      border-bottom: 1px solid #e5e7eb;
    }
    .stock-note { color: #9a3412; font-weight: 600; }
    .empty-note { margin: 0; color: #6b7280; font-size: 11px; }
    .complete-note {
      margin: 0;
      padding: 8px 10px;
      border-radius: 8px;
      background: #ecfdf5;
      border: 1px solid #99f6e4;
      color: #047857;
      font-size: 11px;
      font-weight: 600;
    }
    .stock-compact-section {
      flex-shrink: 0;
    }
    .stock-table th.num,
    .stock-table td.num { text-align: right; }
    .stock-ok { color: #047857; font-weight: 700; }
    .stock-missing { color: #c2410c; font-weight: 700; }
    .sheet--stock .order-status {
      background: #fff7ed;
      color: #c2410c;
    }
    .stock-columns {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .purchase-box,
    .reserve-box {
      min-height: 80px;
    }
    .purchase-list,
    .reserve-list {
      margin: 0;
      padding-left: 18px;
      font-size: 12px;
      line-height: 1.5;
    }
    .purchase-list li { color: #9a3412; }
    .reserve-list li { color: #047857; }
    .print-page--dual .stock-compact-section table { font-size: 8px; }
    .print-page--dual .stock-compact-section th,
    .print-page--dual .stock-compact-section td { padding: 1px 3px; }
    .print-page--dual .stock-compact-section h2 { font-size: 7px; }
    .balance-footer {
      margin-top: auto;
      flex-shrink: 0;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      padding: 8px 10px;
      border-radius: 10px;
      background: linear-gradient(135deg, #ecfdf5, #f0fdfa);
      border: 1px solid #99f6e4;
    }
    .balance-item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      min-width: 0;
    }
    .balance-item span {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #047857;
      font-weight: 700;
    }
    .balance-item strong {
      font-size: 15px;
      color: #065f46;
    }
    .balance-item--total strong { font-size: 17px; }
    .balance-item--saldo strong { color: #c2410c; }
    .sheet-footer {
      flex-shrink: 0;
      padding-top: 4px;
      border-top: 1px dashed #d1d5db;
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 9px;
      color: #9ca3af;
    }
    .print-page--dual .brand h1 { font-size: 13px; }
    .print-page--dual .brand-label { font-size: 7px; }
    .print-page--dual .order-number { font-size: 15px; }
    .print-page--dual .order-status { font-size: 8px; padding: 1px 6px; }
    .print-page--dual .sheet-header {
      padding-bottom: 4px;
      border-bottom-width: 1px;
    }
    .print-page--dual .meta-strip {
      padding: 2px 6px;
      gap: 4px 10px;
      font-size: 9px;
    }
    .print-page--dual .meta-item em { font-size: 7px; }
    .print-page--dual .meta-item strong { font-size: 9px; }
    .print-page--dual .client-line {
      padding: 2px 6px;
      font-size: 9px;
    }
    .print-page--dual .client-label { font-size: 7px; }
    .print-page--dual .client-value strong { font-size: 10px; }
    .print-page--dual .section {
      padding: 4px 6px;
      border-radius: 6px;
    }
    .print-page--dual .section h2 {
      margin-bottom: 3px;
      font-size: 7px;
    }
    .print-page--dual .description-box {
      min-height: 28px;
    }
    .print-page--dual .description-box p {
      font-size: 12px;
      line-height: 1.35;
      font-weight: 600;
    }
    .print-page--dual table { font-size: 9px; }
    .print-page--dual th,
    .print-page--dual td { padding: 2px 4px; }
    .print-page--dual th { font-size: 7px; }
    .print-page--dual .extra-row td { font-size: 8px; }
    .print-page--dual .balance-footer {
      padding: 4px 6px;
      gap: 4px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .print-page--dual .balance-item span { font-size: 7px; }
    .print-page--dual .balance-item strong { font-size: 11px; }
    .print-page--dual .balance-item--total strong { font-size: 12px; }
    .print-page--dual .sheet-footer {
      padding-top: 2px;
      font-size: 7px;
    }
    @media screen {
      body { padding: 16px; background: #f3f4f6; }
      .sheet,
      .print-page--dual {
        max-width: 210mm;
        margin: 0 auto 24px;
        background: #fff;
        box-shadow: 0 10px 30px rgba(0,0,0,0.08);
        border-radius: 8px;
      }
      .sheet {
        padding: 14mm 14mm;
      }
      .print-page--dual {
        padding: 10mm 14mm;
        min-height: calc(297mm - 20mm);
      }
    }
  `;
}

function enrichOrdersForPrint(orders: Order[], stockById: Map<string, { stockActual: number; stockReservado?: number; controlaStock?: boolean }>): Order[] {
  return orders.map((order) => ({
    ...order,
    items: (order.items ?? []).map((line) => {
      if (line.stockDisponible !== undefined) return line;
      const stockItem = stockById.get(line.stockItemId);
      if (!stockItem) return line;
      return {
        ...line,
        controlaStock: itemControlsStock(stockItem),
        stockDisponible: getStockDisponible(stockItem),
      };
    }),
  }));
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
      return renderOrderPage(order, client, clientName, options);
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
  private catalogConfig = inject(CatalogConfigService);
  private stockService = inject(StockService);

  printOrders(orders: Order[], clientsById: Map<string, Client>): void {
    if (!orders.length || !this.auth.canPrintOrders) return;

    forkJoin({
      config: this.catalogConfig.getAppConfig(),
      stock: this.stockService.getStock(),
    }).subscribe({
      next: ({ config, stock }) => {
        const stockById = new Map(
          stock.filter((item) => item.id).map((item) => [item.id!, item])
        );
        this.openPrintWithOptions(
          enrichOrdersForPrint(
            orders.map((order) => normalizeOrderForPrint(order)),
            stockById
          ),
          clientsById,
          {
            companyName: this.auth.appBrandTitle,
            showPrices: this.auth.canViewOrderSalePrice,
            showBalance: this.auth.canViewAccountBalance,
            dualCopy: this.catalogConfig.usesOrderPrintDualCopy(config),
            pedidos: config.pedidos,
          }
        );
      },
      error: () => {
        this.openPrintWithOptions(
          orders.map((order) => normalizeOrderForPrint(order)),
          clientsById,
          {
            companyName: this.auth.appBrandTitle,
            showPrices: this.auth.canViewOrderSalePrice,
            showBalance: this.auth.canViewAccountBalance,
            dualCopy: this.catalogConfig.usesOrderPrintDualCopy(),
            pedidos: this.catalogConfig.appConfig.pedidos,
          }
        );
      },
    });
  }

  private openPrintWithOptions(
    orders: Order[],
    clientsById: Map<string, Client>,
    options: OrderPrintOptions
  ): void {
    const html = buildOrdersPrintDocument(orders, clientsById, options);
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
