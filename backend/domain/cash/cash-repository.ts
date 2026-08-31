export type CashMovementRecord = {
  id: string;
  tipo?: string;
  monto?: number;
  ambito?: unknown;
  fecha?: string;
  createdAt?: string | null;
  [key: string]: unknown;
};

export type CashPagedListOptions = {
  limit: number;
  cursor?: string;
  startIso?: string;
  endIso?: string;
};

export type CashPagedListResult = {
  items: CashMovementRecord[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type CashRepository = {
  loadCajaConfig(businessId: string): Promise<Record<string, unknown>>;
  insertMovement(businessId: string, data: Record<string, unknown>): Promise<string>;
  getMovement(businessId: string, movementId: string): Promise<CashMovementRecord | null>;
  insertMovementIdempotent(
    businessId: string,
    idempotencyKey: string,
    data: Record<string, unknown>
  ): Promise<{ movementId: string; reused: boolean }>;
  listAllMovements(businessId: string): Promise<CashMovementRecord[]>;
  listMovementsPaged(
    businessId: string,
    opts: CashPagedListOptions
  ): Promise<CashPagedListResult>;
};
