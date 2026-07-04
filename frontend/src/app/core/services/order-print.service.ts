import { Injectable, inject } from '@angular/core';
import { forkJoin, of, Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Client } from './client.service';
import {
  Order,
  OrderLineItem,
  OrderService,
  formatOrderNumber,
  normalizeOrderForPrint,
  orderLineItemsForPrint,
} from './order.service';
import { AuthService } from './auth.service';
import { CatalogConfigService, type OrderPedidosConfigShape } from './catalog-config.service';
import { getOrderStatusLabel } from '../constants/order-status';
import { StockService, getStockDisponible, itemControlsStock } from './stock.service';

export interface OrderPrintOptions {
  companyName: string;
  showPrices: boolean;
  showBalance: boolean;
  dualCopy: boolean;
  /** A4 apaisado solo con una vía y la opción activada en configuración. */
  landscapeSheet: boolean;
  /** Casilla vacía imprimible junto a cada producto. */
  lineCheckboxes: boolean;
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
  const lines = orderLineItemsForPrint(order);
  if (lines.length === 0) {
    return '<p class="empty-note">Sin productos cargados.</p>';
  }

  const withChecks = options.lineCheckboxes;
  const colCount = (options.showPrices ? 4 : 2) + (withChecks ? 1 : 0);
  const checkHead = withChecks ? '<th class="check-col" title="Marcar">✓</th>' : '';
  const checkCell = withChecks
    ? '<td class="check-col"><span class="line-check" aria-hidden="true"></span></td>'
    : '';

  const head = options.showPrices
    ? `<tr>
        ${checkHead}
        <th>Producto</th>
        <th class="num">Cant.</th>
        <th class="num">P. unit.</th>
        <th class="num">Subtotal</th>
      </tr>`
    : `<tr>
        ${checkHead}
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
        ${checkCell}
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

  return `<div class="balance-footer">${señaRow}${saldoRow}${totalRow}</div>`;
}

function orderReferencePhotosPrintEnabled(options?: OrderPrintOptions): boolean {
  if (options?.pedidos?.fotosReferenciaHabilitadas === false) return false;
  return options?.pedidos?.fotosReferenciaEnImpresion !== false;
}

function renderOrderPhotosSection(
  order: Order,
  client: Client | null,
  clientName: string,
  options: OrderPrintOptions,
  layout: 'full' | 'dual-right' = 'full'
): string {
  if (!orderReferencePhotosPrintEnabled(options)) return '';

  const fotos = (order.fotos ?? []).filter((foto) => String(foto.url ?? '').trim());
  if (!fotos.length) return '';

  const items = fotos
    .map(
      (foto) => `<figure class="print-photo-item">
        <div class="print-photo-item__frame">
          <img src="${escapeHtml(foto.url)}" alt="${escapeHtml(foto.name || 'Referencia')}" loading="eager" />
        </div>
        ${foto.name?.trim() ? `<figcaption>${escapeHtml(foto.name)}</figcaption>` : ''}
      </figure>`
    )
    .join('');

  const layoutClass = layout === 'dual-right' ? ' print-photos-below--dual-right' : '';
  const orderNumber = formatOrderNumber(order);
  const orderRef = orderNumber ? `#${orderNumber}` : 'Sin número';
  const clientLabel = (client?.nombre || clientName || '').trim() || 'Sin cliente';

  return `<section class="print-photos-below${layoutClass}" aria-label="Fotos de referencia">
    <div class="print-photos-below__header">
      <h2>Fotos de referencia</h2>
      <span class="print-photos-below__meta">${escapeHtml(orderRef)} · ${escapeHtml(clientLabel)}</span>
    </div>
    <div class="print-photo-grid">${items}</div>
  </section>`;
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
          <h1>${escapeHtml(options.companyName)}</h1>
        </div>
        <div class="order-badge">
          <div class="order-number">${escapeHtml(orderRef)}</div>
          <div class="order-status">${escapeHtml(status)}</div>
        </div>
      </header>

      ${renderMetaStrip(order, client, clientName)}

      <section class="section products-section">
        <h2>Productos</h2>
        ${renderItemsTable(order, options)}
      </section>

      ${renderBalanceFooter(order, options)}

      ${
        order.descripcion?.trim()
          ? `<section class="section description-box">
              <h2>Descripción del pedido</h2>
              <p>${escapeHtml(order.descripcion).replace(/\n/g, '<br>')}</p>
            </section>`
          : ''
      }

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
  const photosSection = renderOrderPhotosSection(
    order,
    client,
    clientName,
    options,
    options.dualCopy ? 'dual-right' : 'full'
  );
  const withPhotos = !!photosSection;
  const pageClass = withPhotos ? ' print-page--with-photos' : '';

  if (options.dualCopy) {
    return `
    <div class="print-page print-page--dual${pageClass}">
      <div class="print-page__sheets">
        ${renderOrderSheet(order, client, clientName, options, '1ª vía')}
        <div class="via-divider via-divider--vertical" aria-hidden="true"></div>
        ${renderOrderSheet(order, client, clientName, options, '2ª vía')}
      </div>
      ${photosSection}
    </div>`;
  }

  const singleClass = options.landscapeSheet
    ? 'print-page print-page--single print-page--single-landscape'
    : 'print-page print-page--single';

  return `
    <div class="${singleClass}${pageClass}">
      <div class="print-page__sheets">
        ${renderOrderSheet(order, client, clientName, options)}
      </div>
      ${photosSection}
    </div>`;
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
    @page sheet-portrait-dual { size: A4; margin: 8mm 5mm; }
    @page sheet-landscape { size: A4 landscape; margin: 10mm; }
    .print-page {
      page-break-after: always;
      page-break-inside: avoid;
    }
    .print-page:last-child { page-break-after: auto; }
    .print-page--single {
      min-height: calc(297mm - 24mm);
    }
    .print-page--single .sheet {
      min-height: calc(297mm - 24mm);
    }
    .print-page--single-landscape {
      page: sheet-landscape;
      width: calc(297mm - 20mm);
      min-height: calc(210mm - 20mm);
    }
    .print-page--single-landscape .sheet {
      min-height: calc(210mm - 20mm);
    }
    .sheet {
      page-break-after: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 2mm 0 4mm;
    }
    .print-page--dual {
      page: sheet-portrait-dual;
      page-break-inside: auto;
      width: 200mm;
      max-width: 200mm;
      margin-left: auto;
      margin-right: auto;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      gap: 0;
      padding: 0;
      height: auto;
      min-height: 0;
    }
    .print-page--dual::before {
      content: '';
      position: absolute;
      left: 100mm;
      top: 0;
      bottom: 0;
      border-left: 2px dashed #6b7280;
      transform: translateX(-50%);
      pointer-events: none;
      z-index: 0;
    }
    .print-page--dual > * {
      position: relative;
      z-index: 1;
    }
    .print-page__sheets {
      display: flex;
      flex-direction: row;
      align-items: stretch;
      justify-content: flex-start;
      gap: 0;
      flex-shrink: 0;
      width: 100%;
    }
    .print-page--dual.print-page--with-photos .print-page__sheets {
      padding-bottom: 4mm;
      border-bottom: 2px dashed #9ca3af;
    }
    .print-page--single .print-page__sheets {
      flex: 1 1 auto;
      display: block;
      min-height: inherit;
    }
    .print-page--with-photos.print-page--single,
    .print-page--with-photos.print-page--single .print-page__sheets,
    .print-page--with-photos.print-page--single .sheet {
      min-height: 0;
    }
    .print-page--with-photos {
      page-break-inside: avoid;
    }
    .print-photos-below {
      flex-shrink: 0;
      margin-top: 6mm;
      padding-top: 4mm;
      border-top: 2px dashed #9ca3af;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .print-page--dual.print-page--with-photos .print-photos-below {
      margin-top: 4mm;
      padding-top: 0;
      border-top: none;
    }
    .print-photos-below h2 {
      margin: 0;
      font-size: 9px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6b7280;
    }
    .print-photos-below__header {
      display: flex;
      flex-wrap: nowrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 3mm;
      margin: 0 0 4mm;
      min-width: 0;
    }
    .print-photos-below__meta {
      font-size: 9px;
      font-weight: 600;
      color: #374151;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      flex-shrink: 1;
      text-align: right;
    }
    .print-photo-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 2mm;
      align-items: start;
    }
    .print-photo-item {
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 1.5mm;
      min-width: 0;
    }
    .print-photo-item__frame {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 42mm;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      background: #fff;
      overflow: hidden;
    }
    .print-photo-item__frame img {
      display: block;
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      object-fit: contain;
    }
    .print-photo-item--wide {
      grid-column: 1 / -1;
    }
    .print-photo-item figcaption {
      font-size: 8px;
      color: #6b7280;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }
    .print-photos-below--dual-right {
      margin-left: 105mm;
      width: 95mm;
      max-width: 95mm;
      box-sizing: border-box;
    }
    .print-photos-below--dual-right .print-photo-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 2mm;
    }
    .print-page--dual .print-page__sheets .sheet {
      width: 95mm;
      max-width: 95mm;
      flex: 0 0 95mm;
      min-width: 0;
      min-height: 0;
      height: auto;
      overflow: visible;
      padding: 1mm 1.5mm 2mm;
      gap: 3px;
    }
    .via-divider--vertical {
      flex-shrink: 0;
      position: relative;
      width: 10mm;
      margin: 0;
      padding: 0;
      height: auto;
      align-self: stretch;
      border: none;
      background: none;
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
    .via-divider--vertical::after {
      writing-mode: vertical-rl;
      transform: translate(-50%, -50%) rotate(180deg);
      padding: 5mm 0;
    }
    .check-col {
      width: 6mm;
      padding-left: 2px !important;
      padding-right: 2px !important;
      text-align: center;
      vertical-align: middle;
    }
    th.check-col {
      font-size: 7px;
      color: #9ca3af;
    }
    .line-check {
      display: inline-block;
      width: 3.8mm;
      height: 3.8mm;
      border: 1.5px solid #374151;
      border-radius: 1px;
      background: #fff;
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
      margin-top: auto;
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
      overflow-wrap: anywhere;
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
    .balance-footer {
      flex-shrink: 0;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, auto));
      justify-content: end;
      gap: 6px;
      padding: 8px 10px;
      border-radius: 10px;
      background: linear-gradient(135deg, #ecfdf5, #f0fdfa);
      border: 1px solid #99f6e4;
    }
    .balance-item {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      min-width: 0;
      text-align: right;
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
    .print-page--dual .order-number { font-size: 15px; }
    .print-page--dual .order-status { font-size: 8px; padding: 1px 6px; }
    .print-page--dual .sheet-header {
      padding-bottom: 4px;
      border-bottom-width: 1px;
    }
    .print-page--dual .meta-strip {
      padding: 2px 6px;
      gap: 4px 8px;
      font-size: 9px;
      flex-wrap: wrap;
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
      padding: 3px 5px;
      border-radius: 6px;
    }
    .print-page--dual .section h2 {
      margin-bottom: 2px;
      font-size: 7px;
    }
    .print-page--dual .description-box {
      flex: 1 1 auto;
      min-height: 0;
      page-break-inside: auto;
    }
    .print-page--dual .description-box p {
      font-size: 10px;
      line-height: 1.22;
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .print-page--dual table { font-size: 9px; }
    .print-page--dual th,
    .print-page--dual td { padding: 2px 4px; }
    .print-page--dual th { font-size: 7px; }
    .print-page--dual .extra-row td { font-size: 8px; }
    .print-page--dual .balance-footer {
      padding: 3px 5px;
      gap: 3px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .print-page--dual .balance-item span { font-size: 7px; }
    .print-page--dual .balance-item strong { font-size: 10px; }
    .print-page--dual .balance-item--total strong { font-size: 11px; }
    .print-page--dual .products-section {
      padding-bottom: 2px;
    }
    .print-page--dual .sheet-footer {
      padding-top: 2px;
      font-size: 7px;
    }
    .print-page--dual .line-check {
      width: 3.2mm;
      height: 3.2mm;
    }
    @media screen {
      body { padding: 16px; background: #f3f4f6; }
      .print-page {
        max-width: 210mm;
        margin: 0 auto 24px;
        background: #fff;
        box-shadow: 0 10px 30px rgba(0,0,0,0.08);
        border-radius: 8px;
      }
      .print-page--single .sheet {
        padding: 14mm 14mm;
      }
      .print-page--dual {
        max-width: 210mm;
        width: auto;
        min-height: auto;
        padding: 12mm 5mm;
      }
      .print-page--single-landscape {
        max-width: calc(297mm - 8mm);
        min-height: calc(210mm - 8mm);
        padding: 10mm 12mm;
      }
    }
  `;
}

function enrichOrdersForPrint(orders: Order[], stockById: Map<string, { stockActual: number; stockReservado?: number; controlaStock?: boolean }>): Order[] {
  return orders.map((order) => ({
    ...order,
    items: orderLineItemsForPrint(order).map((line) => {
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

function sanitizePrintFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function resolveOrderClientName(order: Order, clientsById: Map<string, Client>): string {
  return (
    order.clienteNombre?.trim() ||
    clientsById.get(order.clienteId)?.nombre?.trim() ||
    'Cliente sin nombre'
  );
}

function buildOrdersPrintTitle(
  orders: Order[],
  clientsById: Map<string, Client>,
  fallback: string
): string {
  if (orders.length === 1) {
    const order = orders[0];
    const clientName = resolveOrderClientName(order, clientsById);
    const orderNumber = formatOrderNumber(order) || 'Pedido';
    return sanitizePrintFilename(`${orderNumber} - ${clientName}`);
  }

  const parts = orders.slice(0, 5).map((order) => {
    const clientName = resolveOrderClientName(order, clientsById);
    return `${formatOrderNumber(order) || 'Pedido'} - ${clientName}`;
  });
  const suffix = orders.length > 5 ? ` (+${orders.length - 5})` : '';
  return sanitizePrintFilename(parts.join(', ') + suffix) || fallback;
}

export function buildOrdersPrintDocument(
  orders: Order[],
  clientsById: Map<string, Client>,
  options: OrderPrintOptions
): string {
  const sheets = orders
    .map((order) => {
      const client = clientsById.get(order.clienteId) ?? null;
      const clientName = resolveOrderClientName(order, clientsById);
      return renderOrderPage(order, client, clientName, options);
    })
    .join('');

  const title = buildOrdersPrintTitle(orders, clientsById, `Pedidos · ${options.companyName}`);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
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
  private orderService = inject(OrderService);

  printOrders(orders: Order[], clientsById: Map<string, Client>): void {
    if (!orders.length || !this.auth.canPrintOrders) return;

    this.ensureOrdersWithLineItems(orders).subscribe({
      next: (resolvedOrders) => {
        forkJoin({
          config: this.catalogConfig.getAppConfig(),
          stock: this.stockService.getStock().pipe(catchError(() => of([]))),
        }).subscribe({
          next: ({ config, stock }) => {
            const stockList = Array.isArray(stock) ? stock : [];
            const stockById = new Map(
              stockList.filter((item) => item.id).map((item) => [item.id!, item])
            );
            this.openPrintWithOptions(
              enrichOrdersForPrint(
                resolvedOrders.map((order) => normalizeOrderForPrint(order)),
                stockById
              ),
              clientsById,
              {
                companyName: this.auth.appBrandTitle,
                showPrices: this.auth.canViewOrderSalePrice,
                showBalance: this.auth.canViewAccountBalance,
                dualCopy: this.catalogConfig.usesOrderPrintDualCopy(config),
                landscapeSheet: this.catalogConfig.usesOrderPrintLandscapeSheet(config),
                lineCheckboxes: this.catalogConfig.usesOrderPrintLineCheckboxes(config),
                pedidos: config.pedidos,
              }
            );
          },
          error: () => {
            this.openPrintWithOptions(
              resolvedOrders.map((order) => normalizeOrderForPrint(order)),
              clientsById,
              {
                companyName: this.auth.appBrandTitle,
                showPrices: this.auth.canViewOrderSalePrice,
                showBalance: this.auth.canViewAccountBalance,
                dualCopy: this.catalogConfig.usesOrderPrintDualCopy(),
                landscapeSheet: this.catalogConfig.usesOrderPrintLandscapeSheet(),
                lineCheckboxes: this.catalogConfig.usesOrderPrintLineCheckboxes(),
                pedidos: this.catalogConfig.appConfig.pedidos,
              }
            );
          },
        });
      },
    });
  }

  private ensureOrdersWithLineItems(orders: Order[]): Observable<Order[]> {
    const prepared = orders.map((order) => ({
      ...order,
      items: orderLineItemsForPrint(order),
    }));

    const missing = prepared
      .map((order, index) => ({ order, index }))
      .filter(({ order }) => !order.items.length && !!order.id);

    if (!missing.length) {
      return of(prepared);
    }

    return forkJoin(
      missing.map(({ order }) => this.orderService.getOrder(order.id!, { includePhotoUrls: true }))
    ).pipe(
      map((fetchedOrders) => {
        const result = prepared.map((order) => ({ ...order }));
        missing.forEach(({ index }, fetchedIndex) => {
          const full = fetchedOrders[fetchedIndex];
          result[index] = {
            ...result[index],
            ...full,
            items: orderLineItemsForPrint(full),
          };
        });
        return result;
      })
    );
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

    const waitForImages = (): Promise<void> => {
      const images = Array.from(doc.images ?? []);
      if (!images.length) return Promise.resolve();
      return Promise.all(
        images.map(
          (image) =>
            new Promise<void>((resolve) => {
              if (image.complete) {
                resolve();
                return;
              }
              image.onload = () => resolve();
              image.onerror = () => resolve();
            })
        )
      ).then(() => undefined);
    };

    const classifyPrintPhotos = (): void => {
      const wideRatio = 1.45;
      const photoItems = Array.from(doc.querySelectorAll('.print-photo-item img'));
      for (const node of photoItems) {
        const img = node as HTMLImageElement;
        if (!img.naturalWidth || !img.naturalHeight) continue;
        if (img.naturalWidth / img.naturalHeight >= wideRatio) {
          img.closest('.print-photo-item')?.classList.add('print-photo-item--wide');
        }
      }
    };

    void waitForImages().then(() => {
      classifyPrintPhotos();
      window.setTimeout(() => {
        win.focus();
        win.print();
        window.setTimeout(cleanup, 1500);
      }, 150);
    });
  }
}
