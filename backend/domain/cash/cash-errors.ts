export type CashDomainErrorCode =
  | 'INVALID_CASH_AMOUNT'
  | 'INVALID_CASH_TYPE'
  | 'INVALID_CASH_SCOPE'
  | 'MISSING_CASH_CONCEPT'
  | 'INVALID_CASH_DATE'
  | 'INVALID_BUSINESS';

export class CashDomainError extends Error {
  readonly code: CashDomainErrorCode;
  readonly field?: string;

  constructor(code: CashDomainErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'CashDomainError';
    this.code = code;
    this.field = field;
  }
}

export function isCashDomainError(error: unknown): error is CashDomainError {
  return error instanceof CashDomainError;
}
