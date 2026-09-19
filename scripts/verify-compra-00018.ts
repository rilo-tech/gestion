import dotenv from 'dotenv';
dotenv.config();
import { db } from '../backend/firebase.ts';
import { parsePurchaseInput, repairPurchasePayables } from '../backend/utils/purchase-finance.ts';
import { purchaseFinancialGrossTotal, payablesTotalsByAmbito } from '../backend/utils/purchase-document-totals.ts';
import { loadFinanzasConfig } from '../backend/utils/finance-config.ts';
import { buildInstallmentMontos } from '../backend/utils/card-statements.ts';

const compraId = '9TQp2niMsT5J0HezLmKC';
const snap = await db.doc(`negocios/rilo/compras/${compraId}`).get();
const data = snap.data() ?? {};
console.log('Purchase total:', data.total);
console.log('documentGrossTotal:', data.documentGrossTotal);
console.log('documentNetTotal:', data.documentNetTotal);
console.log('documentTaxTotal:', data.documentTaxTotal);
console.log('Items:', (data.items as unknown[]).length);

const fin = await loadFinanzasConfig('rilo');
const parsed = await parsePurchaseInput('rilo', data, { skipSupplierLookup: true, finanzas: fin, relaxed: true });
if (!parsed.input) throw new Error('parse failed');
console.log('Parsed financial gross:', purchaseFinancialGrossTotal(parsed.input));
console.log('Payables ambito:', [...payablesTotalsByAmbito(parsed.input.items, purchaseFinancialGrossTotal(parsed.input)).entries()]);

await repairPurchasePayables('rilo', compraId);

const cuotas = await db.collection('negocios/rilo/cuentas_pagar_cuotas').where('compraId', '==', compraId).get();
const montos = cuotas.docs.map((d) => Number(d.data().monto) || 0).sort((a, b) => a - b);
console.log('Cuotas:', cuotas.docs.map((d) => `${d.data().numeroCuota}/${d.data().cuotaTotal}=$${d.data().monto}`).join(', '));
console.log('Cuota sum:', montos.reduce((a, b) => a + b, 0));
console.log('Expected:', buildInstallmentMontos(4357, 3));
