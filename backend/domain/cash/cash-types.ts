export type CashMovementType = 'ingreso' | 'egreso';

export type CashChannelSource = 'web' | 'whatsapp' | 'system';

export type CashActor = {
  type?: 'web_user' | 'whatsapp_user' | 'system';
  userId?: string;
  phone?: string;
};

/**
 * Comando de negocio para un alta manual de caja.
 * Sin rawMessage, Gemini, HTTP ni paths de Firestore.
 */
export type RegisterCashMovementCommand = {
  businessId: string;
  type: CashMovementType;
  amount: number;
  concept: string;
  scope?: string;
  date?: string | Date;
  medio?: string;
  categoriaId?: string | null;
  descripcion?: string | null;
  source?: CashChannelSource;
  actor?: CashActor;
  idempotencyKey?: string;
};

export type CashMovementDocument = {
  tipo: CashMovementType;
  monto: number;
  medio: string;
  concepto: string;
  categoriaId: string | null;
  descripcion: string | null;
  ambito: string;
  fecha: string;
  createdAt: string;
  origenTipo: 'caja_manual_egreso' | 'caja_manual_ingreso';
  origenGrupo: 'manual';
  origenId: null;
  pedidoId: null;
  numeroPedido: null;
  numeroPedidoLabel: null;
  clienteId: null;
  negocioId: string;
  source?: CashChannelSource;
  actor?: CashActor;
  origenWhatsapp?: boolean;
  whatsappPhone?: string;
};

export type RegisteredCashMovement = {
  movementId: string;
  amount: number;
  type: CashMovementType;
  scope: string;
  concept: string;
  date: string;
  reused?: boolean;
  resultingBalance?: number;
};

export type CashPeriodSummary = {
  mes: number;
  anio: number;
  ingreso: number;
  egreso: number;
};

export type CashAmbitoSummary = {
  ingreso: number;
  egreso: number;
  saldo: number;
  periodo: CashPeriodSummary;
};

/** Misma forma que GET /api/cash/:id/summary (el panel de RILO Gestión). */
export type CashSummary = {
  ingreso: number;
  egreso: number;
  saldo: number;
  periodo: CashPeriodSummary;
  ambitos: Record<string, CashAmbitoSummary>;
};

export type CashBalanceRow = {
  id: string;
  label: string;
  saldo: number;
};

export type CashBalance = {
  saldo: number;
  scope?: string;
  byAmbito: CashBalanceRow[];
  /** True si la colección no tiene documentos (copy vacío del Bot). */
  empty?: boolean;
};

export type CashMovementListItem = {
  id: string;
  tipo: CashMovementType | string;
  monto: number;
  concepto?: string;
  ambito?: string;
  fecha?: string;
  createdAt?: string | null;
  [key: string]: unknown;
};

export type CashMovementListPage = {
  items: CashMovementListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type CashDayTotals = {
  ingresos: number;
  egresos: number;
  neto: number;
  count: number;
};

/**
 * Campos de negocio del documento ERP. Canal (source/actor/origenWhatsapp)
 * y timestamps de alta no entran acá.
 */
export const CASH_ERP_BUSINESS_FIELDS = [
  'tipo',
  'monto',
  'medio',
  'concepto',
  'categoriaId',
  'ambito',
  'fecha',
  'origenTipo',
  'origenGrupo',
  'origenId',
  'pedidoId',
  'numeroPedido',
  'numeroPedidoLabel',
  'clienteId',
  'negocioId',
] as const;

export type CashErpBusinessField = (typeof CASH_ERP_BUSINESS_FIELDS)[number];
