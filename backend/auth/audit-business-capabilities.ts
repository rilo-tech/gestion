/**
 * Best-effort health check of business config vs product capability contract.
 * Never throws to callers — errors become warn/error issues.
 */
import { db } from '../firebase.ts';
import { getBusiness } from './business.ts';
import { loadFinanzasConfig } from '../utils/finance-config.ts';
import { normalizeOrderPedidosConfig } from '../utils/order-config.ts';
import {
  CANONICAL_ORDER_STATUS_IDS,
} from '../whatsapp/business-runtime-context.ts';
import { listAutomations } from '../automation/automation-service.ts';
import { getAutomationAction } from '../automation/automation-action-registry.ts';
import { buildToolRegistry } from '../whatsapp/agent/tool-registry.ts';
import {
  PRODUCT_CAPABILITY_CONTRACT,
  RILO_STANDARD_CONFIG_VERSION,
  landingVisibleCapabilities,
  webExperienceForProduct,
} from '../../shared/product-capability-contract.ts';
import {
  normalizePlatformAccess,
  productIdFromAccess,
  resolveWebExperience,
} from '../../shared/platform-access.ts';
import { resolveBusinessProfile } from '../../shared/business-profile.ts';

export type CapabilityAuditIssue = {
  code: string;
  severity: 'error' | 'warn';
  message: string;
};

export type CapabilityAuditResult = {
  ok: boolean;
  issues: CapabilityAuditIssue[];
  standardConfigVersion: string | null;
  productId: string | null;
  webExperience: string | null;
};

function pushIssue(
  issues: CapabilityAuditIssue[],
  code: string,
  severity: 'error' | 'warn',
  message: string
) {
  issues.push({ code, severity, message });
}

export async function auditBusinessCapabilities(
  businessId: string
): Promise<CapabilityAuditResult> {
  const issues: CapabilityAuditIssue[] = [];
  let standardConfigVersion: string | null = null;
  let productId: string | null = null;
  let webExperience: string | null = null;

  try {
    const business = await getBusiness(businessId);
    if (!business) {
      return {
        ok: false,
        issues: [
          {
            code: 'business_not_found',
            severity: 'error',
            message: `Negocio ${businessId} no encontrado.`,
          },
        ],
        standardConfigVersion: null,
        productId: null,
        webExperience: null,
      };
    }

    const access = normalizePlatformAccess(business.platformAccess);
    const resolvedProduct = productIdFromAccess(access);
    productId = resolvedProduct;
    webExperience = resolveWebExperience(access, resolvedProduct);

    try {
      const expected = resolvedProduct ? webExperienceForProduct(resolvedProduct) : null;
      if (
        resolvedProduct === 'whatsapp' &&
        access.whatsappEnabled === true &&
        webExperience !== 'summary'
      ) {
        pushIssue(
          issues,
          'web_experience_mismatch',
          'error',
          `Producto Bot (whatsapp) debería tener webExperience=summary; actual=${webExperience}.`
        );
      }
      if (
        (resolvedProduct === 'erp' || resolvedProduct === 'completo') &&
        access.erpWebEnabled === true &&
        expected === 'full' &&
        webExperience !== 'full'
      ) {
        pushIssue(
          issues,
          'web_experience_full_mismatch',
          'error',
          `Producto ${resolvedProduct} con ERP web debería tener webExperience=full; actual=${webExperience}.`
        );
      }
      if (
        resolvedProduct === 'whatsapp' &&
        access.whatsappEnabled !== true &&
        access.erpWebEnabled === true &&
        webExperience === 'full'
      ) {
        pushIssue(
          issues,
          'plan_web_contradiction',
          'warn',
          'Acceso Bot no habilitado pero webExperience=full (posible contradicción plan/experiencia).'
        );
      }
    } catch (err) {
      pushIssue(
        issues,
        'web_experience_check_failed',
        'warn',
        `No se pudo validar webExperience: ${err instanceof Error ? err.message : 'error'}`
      );
    }

    const profile = resolveBusinessProfile(business.businessProfile);
    try {
      const appSnap = await db.doc(`negocios/${businessId}/config/app`).get();
      const app = (appSnap.data() ?? {}) as Record<string, unknown>;
      const rawVersion = app.standardConfigVersion;
      standardConfigVersion =
        typeof rawVersion === 'string' && rawVersion.trim()
          ? rawVersion.trim()
          : null;

      const pedidos = normalizeOrderPedidosConfig(
        (app.pedidos ?? {}) as Record<string, unknown>
      );
      const estados = Array.isArray(pedidos.estados) ? pedidos.estados : [];
      const labelCounts = new Map<string, number>();
      for (const row of estados) {
        const label = String(row.label ?? '')
          .trim()
          .toLowerCase();
        if (!label) continue;
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
        const id = String(row.value ?? '').trim();
        if (
          id &&
          !(CANONICAL_ORDER_STATUS_IDS as readonly string[]).includes(id)
        ) {
          pushIssue(
            issues,
            'invalid_order_status_id',
            'error',
            `Estado de pedido con id no canónico: "${id}" (label="${row.label}").`
          );
        }
      }
      for (const [label, count] of labelCounts) {
        if (count > 1) {
          pushIssue(
            issues,
            'duplicate_order_estado_label',
            'warn',
            `Label de estado duplicado: "${label}" (${count} veces).`
          );
        }
      }

      const caja = (app.caja as Record<string, unknown>) ?? {};
      const ambitosRaw = Array.isArray(caja.ambitos) ? caja.ambitos : [];
      const cashIds = new Set(
        ambitosRaw
          .map((row) => {
            if (!row || typeof row !== 'object') return '';
            return String((row as Record<string, unknown>).id ?? '').trim();
          })
          .filter(Boolean)
      );
      const defaultCash =
        profile.defaults?.defaultCashAccountId?.trim() || null;
      if (!defaultCash && cashIds.size > 0) {
        pushIssue(
          issues,
          'default_cash_account_missing',
          'warn',
          'No hay defaultCashAccountId en el perfil (se usará el primero disponible en runtime).'
        );
      } else if (defaultCash && cashIds.size > 0 && !cashIds.has(defaultCash)) {
        pushIssue(
          issues,
          'default_cash_account_invalid',
          'error',
          `defaultCashAccountId="${defaultCash}" no está en los ámbitos de caja activos.`
        );
      }
    } catch (err) {
      pushIssue(
        issues,
        'app_config_check_failed',
        'warn',
        `No se pudo auditar config/app: ${err instanceof Error ? err.message : 'error'}`
      );
    }

    try {
      const finanzas = await loadFinanzasConfig(businessId);
      const activeMedios = finanzas.mediosPago.filter((m) => m.activo !== false);
      const activeIds = new Set(activeMedios.map((m) => m.id));
      const defaultPayment =
        profile.defaults?.defaultPaymentMethod ||
        profile.defaults?.sales?.defaultPaymentMethod ||
        null;
      if (!defaultPayment) {
        pushIssue(
          issues,
          'default_payment_method_missing',
          'warn',
          'No hay defaultPaymentMethod en el perfil.'
        );
      } else if (!activeIds.has(defaultPayment)) {
        pushIssue(
          issues,
          'default_payment_method_inactive',
          'error',
          `defaultPaymentMethod="${defaultPayment}" no está entre los medios activos.`
        );
      }
    } catch (err) {
      pushIssue(
        issues,
        'finance_config_check_failed',
        'warn',
        `No se pudo auditar medios de pago: ${err instanceof Error ? err.message : 'error'}`
      );
    }

    try {
      const active = await listAutomations(businessId, { status: 'active' });
      for (const row of active) {
        const action = getAutomationAction(row.actionId);
        if (!action) {
          pushIssue(
            issues,
            'automation_action_missing',
            'error',
            `Automatización activa "${row.id}" referencia actionId desconocido: ${row.actionId}.`
          );
        }
      }
    } catch (err) {
      pushIssue(
        issues,
        'automations_check_failed',
        'warn',
        `No se pudieron auditar automatizaciones: ${err instanceof Error ? err.message : 'error'}`
      );
    }

    try {
      const tools = buildToolRegistry({ includeRequiresAdapter: true });
      const caps = new Set(
        tools.flatMap((t) => [t.capability, t.name].filter(Boolean) as string[])
      );
      for (const row of PRODUCT_CAPABILITY_CONTRACT) {
        const botCap = row.botCapability?.trim();
        if (!botCap) continue;
        if (!caps.has(botCap)) {
          pushIssue(
            issues,
            'bot_capability_without_tool',
            'warn',
            `Contrato ${row.id}: botCapability="${botCap}" sin tool coincidente.`
          );
        }
      }
    } catch (err) {
      pushIssue(
        issues,
        'tool_registry_check_failed',
        'warn',
        `No se pudo auditar tools del bot: ${err instanceof Error ? err.message : 'error'}`
      );
    }

    try {
      for (const cap of landingVisibleCapabilities()) {
        if (cap.status !== 'operational') {
          pushIssue(
            issues,
            'landing_capability_not_operational',
            'error',
            `Landing visible "${cap.id}" tiene status=${cap.status} (debe ser operational).`
          );
        }
      }
    } catch (err) {
      pushIssue(
        issues,
        'landing_contract_check_failed',
        'warn',
        `No se pudo auditar landing: ${err instanceof Error ? err.message : 'error'}`
      );
    }

  } catch (err) {
    pushIssue(
      issues,
      'audit_failed',
      'error',
      `Auditoría falló: ${err instanceof Error ? err.message : 'error'}`
    );
  }

  const ok = !issues.some((i) => i.severity === 'error');
  return {
    ok,
    issues,
    standardConfigVersion:
      standardConfigVersion === RILO_STANDARD_CONFIG_VERSION
        ? RILO_STANDARD_CONFIG_VERSION
        : standardConfigVersion,
    productId,
    webExperience,
  };
}
