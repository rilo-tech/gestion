/**
 * E2E release gate — Firestore emulator only.
 * Run via: npm run test:e2e  (starts emulator with emulators:exec)
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  assertEmulatorOrThrow,
  countCashMovements,
  createStockProduct,
  getClientBalance,
  getProductStock,
  listOpenNotices,
  seedStandardTenant,
  sumCashByTipo,
  todayIso,
  tomorrowIso,
} from './harness.ts';
import { createSaleFromCommand, saleDomainEffectsSnapshot } from '../domain/sales/create-mostrador-sale.ts';
import { createOrder, finalizeOrder } from '../domain/orders/orders-application-service.ts';
import {
  createPayable,
  payPayable,
} from '../domain/payables/payables-application-service.ts';
import { syncAttentionNotices } from '../automation/attention-sync.ts';
import {
  countUnreadOpenNotices,
  markNoticeReadForUser,
  listErpNotices,
} from '../automation/erp-notices.ts';
import { executeDailyAttentionDigest, executeDailyBusinessSummary } from '../automation/action-handlers.ts';
import { setPresetEnabled, listPresetViews } from '../automation/automation-presets-service.ts';
import { loadAutomationUserPrefs, saveAutomationUserPrefs } from '../automation/automation-prefs.ts';
import { auditBusinessCapabilities } from '../auth/audit-business-capabilities.ts';
import { allowedAutomationChannels } from '../../shared/automation-channels.ts';
import { normalizePlatformAccess } from '../../shared/platform-access.ts';
import { landingVisibleCapabilities } from '../../shared/product-capability-contract.ts';
import { db } from '../firebase.ts';

before(() => {
  assertEmulatorOrThrow();
});

describe('E2E release — Completo standard_v1', () => {
  let businessId = '';
  let clientId = '';
  let productId = '';
  let userIdA = '';

  before(async () => {
    const seeded = await seedStandardTenant({
      product: 'completo',
      defaultPaymentMethod: 'transferencia',
    });
    businessId = seeded.businessId;
    clientId = seeded.clientId;
    productId = seeded.productId;
    userIdA = seeded.userIdA;
  });

  it('venta parcial ERP+WA misma contabilidad', async () => {
    const fechaIso = new Date().toISOString();
    const cashBefore = await sumCashByTipo(businessId, 'ingreso');
    const stockBefore = await getProductStock(businessId, productId);
    const balBefore = await getClientBalance(businessId, clientId);

    const erp = await createSaleFromCommand({
      businessId,
      clienteId: clientId,
      items: [
        {
          stockItemId: productId,
          nombre: 'Producto A',
          cantidad: 1,
          precioUnitario: 1500,
          subtotal: 1500,
          tipoLinea: 'producto',
          mueveStock: true,
        },
      ],
      total: 1500,
      amountPaid: 800,
      paymentMethod: 'transferencia',
      fechaIso,
      source: 'erp',
    });

    assert.equal(erp.total, 1500);
    assert.equal(erp.montoCobrado, 800);
    assert.equal(erp.saldoPendiente, 700);
    assert.equal(erp.medioPago, 'transferencia');
    assert.ok(erp.movimientoCajaId);

    const cashAfterErp = await sumCashByTipo(businessId, 'ingreso');
    assert.equal(Math.round((cashAfterErp - cashBefore) * 100) / 100, 800);
    assert.equal(await getClientBalance(businessId, clientId), balBefore + 700);
    assert.equal(await getProductStock(businessId, productId), stockBefore - 1);

    // Segunda venta parcial vía path WhatsApp (mismo servicio)
    const stock2 = await getProductStock(businessId, productId);
    const wa = await createSaleFromCommand({
      businessId,
      clienteId: clientId,
      items: [
        {
          stockItemId: productId,
          nombre: 'Producto A',
          cantidad: 1,
          precioUnitario: 1500,
          subtotal: 1500,
          tipoLinea: 'producto',
          mueveStock: true,
        },
      ],
      total: 1500,
      amountPaid: 800,
      paymentMethod: 'transferencia',
      fechaIso: new Date().toISOString(),
      source: 'whatsapp',
    });
    assert.deepEqual(saleDomainEffectsSnapshot(erp), saleDomainEffectsSnapshot(wa));
    assert.equal(await getProductStock(businessId, productId), stock2 - 1);
  });

  it('venta a cuenta no mueve caja', async () => {
    const cashBefore = await sumCashByTipo(businessId, 'ingreso');
    const balBefore = await getClientBalance(businessId, clientId);
    const sale = await createSaleFromCommand({
      businessId,
      clienteId: clientId,
      items: [
        {
          stockItemId: productId,
          nombre: 'Producto A',
          cantidad: 1,
          precioUnitario: 2000,
          subtotal: 2000,
          tipoLinea: 'producto',
          mueveStock: true,
        },
      ],
      total: 2000,
      amountPaid: 0,
      paymentMethod: 'transferencia',
      fechaIso: new Date().toISOString(),
      source: 'erp',
    });
    assert.equal(sale.saldoPendiente, 2000);
    assert.equal(sale.movimientoCajaId, null);
    assert.equal(await sumCashByTipo(businessId, 'ingreso'), cashBefore);
    assert.equal(await getClientBalance(businessId, clientId), balBefore + 2000);
  });

  it('pedido seña + aviso hoy + estados + finalize resuelve aviso', async () => {
    const today = await todayIso();
    const cashBefore = await sumCashByTipo(businessId, 'ingreso');
    const created = await createOrder({
      businessId,
      source: 'erp',
      clientId,
      clientName: 'Ana',
      items: [
        {
          stockItemId: productId,
          nombre: 'Producto A',
          cantidad: 2,
          precioVenta: 1500,
          controlaStock: true,
        } as never,
      ],
      total: 3000,
      costoReal: 1000,
      estado: 'pendiente',
      fechaEntrega: `${today}T15:00:00.000Z`,
      seniaAmount: 500,
      paymentMethod: 'transferencia',
    });

    assert.equal(created.estado, 'pendiente');
    assert.equal(created.totalPagado, 500);
    assert.equal(created.saldo, 2500);
    assert.equal(Math.round((await sumCashByTipo(businessId, 'ingreso') - cashBefore) * 100) / 100, 500);

    await syncAttentionNotices(businessId);
    let notices = await listOpenNotices(businessId);
    const due = notices.filter((n) => n.dedupeKey === `order_due_today:${created.orderId}`);
    assert.equal(due.length, 1);

    // Dedupe: sync 5 veces
    for (let i = 0; i < 5; i++) await syncAttentionNotices(businessId);
    notices = await listOpenNotices(businessId);
    assert.equal(
      notices.filter((n) => n.dedupeKey === `order_due_today:${created.orderId}`).length,
      1
    );

    // pendiente → en_produccion → listo (update directo + sync)
    const orderRef = db.doc(`negocios/${businessId}/pedidos/${created.orderId}`);
    await orderRef.update({ estado: 'en_produccion' });
    await orderRef.update({ estado: 'listo' });
    await syncAttentionNotices(businessId);
    notices = await listOpenNotices(businessId);
    const ready = notices.filter((n) => n.dedupeKey === `order_ready:${created.orderId}`);
    assert.ok(ready.length >= 1);

    const fin = await finalizeOrder({
      businessId,
      orderId: created.orderId,
      source: 'erp',
      mode: 'full',
      amountPaid: 2500,
      paymentMethod: 'transferencia',
    });
    assert.equal(fin.estado, 'entregado');
    assert.equal(fin.saldo, 0);
    assert.ok(fin.ventaId);

    await syncAttentionNotices(businessId);
    notices = await listOpenNotices(businessId);
    assert.equal(
      notices.filter((n) => n.dedupeKey.includes(created.orderId)).length,
      0
    );
  });

  it('payable create → notice → pay resolves + cash egreso', async () => {
    const tomorrow = await tomorrowIso();
    const egresoBefore = await sumCashByTipo(businessId, 'egreso');
    const created = await createPayable({
      businessId,
      source: 'erp',
      beneficiario: 'UTE',
      monto: 7500,
      fechaVencimiento: tomorrow,
      tipo: 'unico',
    });
    assert.ok(created.obligation.id);

    await syncAttentionNotices(businessId);
    let notices = await listOpenNotices(businessId);
    const dueNotices = notices.filter(
      (n) => n.type === 'payable_due_soon' || n.dedupeKey.startsWith('payable_due:')
    );
    assert.ok(dueNotices.length >= 1);

    const { listPayableInstallments } = await import('../utils/payables.ts');
    const { items } = await listPayableInstallments(businessId, { scope: 'all' });
    const cuota = items.find(
      (row) => row.obligacionId === created.obligation.id && row.estado !== 'pagada'
    );
    assert.ok(cuota);

    await payPayable({
      businessId,
      source: 'erp',
      cuotaId: cuota!.id,
      medioPagoId: 'transferencia',
    });

    assert.equal(
      Math.round((await sumCashByTipo(businessId, 'egreso') - egresoBefore) * 100) / 100,
      7500
    );

    await syncAttentionNotices(businessId);
    notices = await listOpenNotices(businessId);
    assert.equal(
      notices.filter((n) => n.entityId === cuota!.id || n.dedupeKey.includes(cuota!.id)).length,
      0
    );
  });

  it('stock bajo: un aviso; reposición resuelve', async () => {
    const lowId = await createStockProduct(businessId, {
      nombre: 'Coca-Cola',
      stock: 2,
      stockMinimo: 3,
      precioVenta: 100,
    });
    await syncAttentionNotices(businessId);
    let notices = await listOpenNotices(businessId);
    const low = notices.filter((n) => n.dedupeKey === `stock_low:${lowId}`);
    assert.equal(low.length, 1);

    for (let i = 0; i < 3; i++) await syncAttentionNotices(businessId);
    notices = await listOpenNotices(businessId);
    assert.equal(notices.filter((n) => n.dedupeKey === `stock_low:${lowId}`).length, 1);

    await db.doc(`negocios/${businessId}/stock/${lowId}`).update({
      cantidad: 10,
      stock: 10,
      stockActual: 10,
    });
    await syncAttentionNotices(businessId);
    notices = await listOpenNotices(businessId);
    assert.equal(notices.filter((n) => n.dedupeKey === `stock_low:${lowId}`).length, 0);
  });

  it('read vs resolved + badge', async () => {
    // Force an open notice via attention item style upsert
    const { upsertAttentionNotice } = await import('../automation/erp-notices.ts');
    const n1 = await upsertAttentionNotice(businessId, {
      type: 'order_due_today',
      severity: 'attention',
      title: 'Aviso test 1',
      body: 'body',
      dedupeKey: `test_read:1:${Date.now()}`,
      actionId: 'orders_due_today',
    });
    const n2 = await upsertAttentionNotice(businessId, {
      type: 'order_due_today',
      severity: 'attention',
      title: 'Aviso test 2',
      body: 'body',
      dedupeKey: `test_read:2:${Date.now()}`,
      actionId: 'orders_due_today',
    });
    const n3 = await upsertAttentionNotice(businessId, {
      type: 'order_due_today',
      severity: 'attention',
      title: 'Aviso test 3',
      body: 'body',
      dedupeKey: `test_read:3:${Date.now()}`,
      actionId: 'orders_due_today',
    });
    assert.ok(n1 && n2 && n3);

    const unread3 = await countUnreadOpenNotices(businessId, userIdA);
    assert.ok(unread3 >= 3);

    await markNoticeReadForUser(businessId, userIdA, n1!.id);
    await markNoticeReadForUser(businessId, userIdA, n2!.id);

    const withUser = await listErpNotices(businessId, {
      status: 'open',
      userId: userIdA,
      limit: 80,
    });
    const row1 = withUser.find((r) => r.id === n1!.id);
    assert.ok(row1?.userReadAt);
    assert.equal(row1?.status, 'open');
    assert.equal(row1?.resolvedAt ?? null, null);

    const unreadAfter = await countUnreadOpenNotices(businessId, userIdA);
    assert.ok(unreadAfter <= unread3 - 2);
  });

  it('digest mañana omite bloques vacíos', async () => {
    const result = await executeDailyAttentionDigest({
      businessId,
      automation: {
        id: 'test',
        businessId,
        type: 'recurring',
        actionId: 'daily_attention_digest',
        status: 'active',
        parameters: {},
        schedule: { time: '08:30' },
        channels: ['erp'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never,
      timezone: 'America/Argentina/Buenos_Aires',
    });
    // May or may not have data depending on leftover open orders; never include empty stock line
    assert.ok(!result.lines.some((l) => /0 producto|stock bajo.*0/i.test(l)));
    if (result.empty) assert.equal(result.shouldDeliver, false);
  });

  it('resumen noche usa métricas reales', async () => {
    const result = await executeDailyBusinessSummary({
      businessId,
      automation: {
        id: 'test-summary',
        businessId,
        type: 'recurring',
        actionId: 'daily_business_summary',
        status: 'active',
        parameters: {},
        schedule: { time: '19:00' },
        channels: ['erp'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never,
      timezone: 'America/Argentina/Buenos_Aires',
    });
    assert.ok(result.title.includes('cerró') || result.title.includes('día'));
    assert.ok(result.lines.length > 0);
  });

  it('auditBusinessCapabilities sin errores críticos', async () => {
    const audit = await auditBusinessCapabilities(businessId);
    const errors = audit.issues.filter((i) => i.severity === 'error');
    assert.equal(errors.length, 0, JSON.stringify(errors));
  });
});

describe('E2E release — planes / canales / settings', () => {
  it('Bot: summary + WA channels; Gestión: sin WA; Completo: ambos', async () => {
    const bot = await seedStandardTenant({ product: 'whatsapp', name: 'E2E Bot' });
    const gestion = await seedStandardTenant({ product: 'erp', name: 'E2E Gestión' });
    const completo = await seedStandardTenant({ product: 'completo', name: 'E2E Completo B' });

    const botBiz = (await db.doc(`negocios/${bot.businessId}`).get()).data()!;
    const gestBiz = (await db.doc(`negocios/${gestion.businessId}`).get()).data()!;
    const compBiz = (await db.doc(`negocios/${completo.businessId}`).get()).data()!;

    const botCh = allowedAutomationChannels(normalizePlatformAccess(botBiz.platformAccess));
    const gestCh = allowedAutomationChannels(normalizePlatformAccess(gestBiz.platformAccess));
    const compCh = allowedAutomationChannels(normalizePlatformAccess(compBiz.platformAccess));

    assert.ok(botCh.includes('whatsapp') && botCh.includes('erp'));
    assert.ok(gestCh.includes('erp') && !gestCh.includes('whatsapp'));
    assert.ok(compCh.includes('whatsapp') && compCh.includes('erp'));

    assert.equal(normalizePlatformAccess(botBiz.platformAccess).webExperience, 'summary');
    assert.equal(normalizePlatformAccess(gestBiz.platformAccess).webExperience, 'full');
    assert.equal(normalizePlatformAccess(compBiz.platformAccess).webExperience, 'full');

    for (const id of [bot.businessId, gestion.businessId, completo.businessId]) {
      const audit = await auditBusinessCapabilities(id);
      const errors = audit.issues.filter((i) => i.severity === 'error');
      assert.equal(errors.length, 0, `${id}: ${JSON.stringify(errors)}`);
    }
  });

  it('settings ERP ↔ Bot misma fuente (hora resumen)', async () => {
    const seeded = await seedStandardTenant({ product: 'completo', name: 'E2E Settings' });
    await setPresetEnabled({
      businessId: seeded.businessId,
      presetId: 'daily_summary',
      enabled: true,
      time: '20:00',
      actor: 'e2e',
    });
    let views = await listPresetViews(seeded.businessId);
    let summary = views.presets.find((p) => p.preset.id === 'daily_summary');
    assert.equal(summary?.time, '20:00');
    assert.equal(summary?.enabled, true);

    await setPresetEnabled({
      businessId: seeded.businessId,
      presetId: 'daily_summary',
      enabled: true,
      time: '21:00',
      actor: 'whatsapp:e2e',
    });
    views = await listPresetViews(seeded.businessId);
    summary = views.presets.find((p) => p.preset.id === 'daily_summary');
    assert.equal(summary?.time, '21:00');

    await setPresetEnabled({
      businessId: seeded.businessId,
      presetId: 'low_stock',
      enabled: false,
      actor: 'whatsapp:e2e',
    });
    views = await listPresetViews(seeded.businessId);
    const stock = views.presets.find((p) => p.preset.id === 'low_stock');
    assert.equal(stock?.enabled, false);
  });

  it('tenant isolation: A no lee notices de B', async () => {
    const a = await seedStandardTenant({ product: 'completo', name: 'Tenant A' });
    const b = await seedStandardTenant({ product: 'completo', name: 'Tenant B' });
    const { upsertAttentionNotice } = await import('../automation/erp-notices.ts');
    await upsertAttentionNotice(b.businessId, {
      type: 'payable_overdue',
      severity: 'urgent',
      title: 'Secreto B',
      body: 'no filtrar',
      dedupeKey: `secret_b:${Date.now()}`,
      actionId: 'payables_due_reminder',
    });
    const noticesA = await listErpNotices(a.businessId, { status: 'open', limit: 80 });
    assert.ok(!noticesA.some((n) => n.title === 'Secreto B'));
  });

  it('legacy config no se pisa al seedear otro tenant standard_v1', async () => {
    const legacyId = `e2e_legacy_${Date.now()}`;
    await db.doc(`negocios/${legacyId}`).set({
      nombre: 'Legacy Shop',
      activo: true,
      platformAccess: {
        whatsappEnabled: true,
        erpWebEnabled: true,
        webExperience: 'full',
        trialProduct: 'completo',
      },
    });
    await db.doc(`negocios/${legacyId}/config/app`).set({
      finanzas: {
        categoriasGasto: [{ id: 'dtf', label: 'DTF Legacy', ambitoDefault: 'negocio' }],
        mediosPago: [{ id: 'efectivo', label: 'Efectivo', activo: true }],
      },
      legacySpecial: true,
    });

    await seedStandardTenant({ product: 'completo', name: 'Nuevo standard' });

    const legacyCfg = (await db.doc(`negocios/${legacyId}/config/app`).get()).data()!;
    assert.equal(legacyCfg.legacySpecial, true);
    assert.equal((legacyCfg.finanzas as { categoriasGasto: unknown[] }).categoriasGasto[0].id, 'dtf');
  });
});

describe('E2E release — capability contract landing', () => {
  it('toda capability visibleLanding es operational', () => {
    for (const cap of landingVisibleCapabilities()) {
      assert.equal(cap.status, 'operational', cap.id);
    }
  });
});
