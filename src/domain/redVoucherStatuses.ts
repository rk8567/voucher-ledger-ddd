import { DomainError } from '@/domain/errors';

declare const redVoucherStatusBrand: unique symbol;

export type RedVoucherStatusCode = number & {
  readonly [redVoucherStatusBrand]: 'RedVoucherStatusCode';
};

export const RedVoucherStatus = {
  Normal: redVoucherStatusCodeOf(0),
  Original: redVoucherStatusCodeOf(1),
  Reversal: redVoucherStatusCodeOf(2),
  Correction: redVoucherStatusCodeOf(3),
} as const;

export function redVoucherStatusCodeOf(value: number): RedVoucherStatusCode {
  if (!Number.isInteger(value) || value < 0) {
    throw new DomainError('INVALID_RED_VOUCHER_STATUS', `Invalid 赤伝票CD: ${String(value)}`, { value });
  }
  return value as RedVoucherStatusCode;
}
