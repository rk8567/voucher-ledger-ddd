import { DomainError } from '@/domain/errors';

export const DENOMINATIONS = [
  1, 2, 10, 50, 84, 94, 120, 140, 210, 5, 20, 52, 110, 270, 430, 600,
] as const;

export type DenominationYen = (typeof DENOMINATIONS)[number];
export type QuantityInput = Record<number, number | undefined | null>;
export type QuantitySnapshot = Record<number, number>;

const DENOMINATION_SET = new Set<number>(DENOMINATIONS);

export function isKnownDenomination(yen: number): yen is DenominationYen {
  return DENOMINATION_SET.has(yen);
}

export function normalizeQuantities(input: QuantityInput = {}): QuantitySnapshot {
  const normalized: QuantitySnapshot = {};

  for (const [rawDenomination, rawQuantity] of Object.entries(input)) {
    const denomination = Number(rawDenomination);
    if (!Number.isInteger(denomination) || !isKnownDenomination(denomination)) {
      throw new DomainError('INVALID_DENOMINATION', `Unsupported denomination: ${rawDenomination}`, {
        denomination: rawDenomination,
      });
    }

    const quantity = rawQuantity ?? 0;
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new DomainError('INVALID_QUANTITY', `${denomination}円の枚数は0以上の整数で入力してください`, {
        denomination,
        quantity,
      });
    }

    if (quantity > 0) normalized[denomination] = quantity;
  }

  return normalized;
}

export function zeroQuantities(): QuantitySnapshot {
  return Object.fromEntries(DENOMINATIONS.map((yen) => [yen, 0]));
}

export function quantityOf(snapshot: QuantitySnapshot, denomination: number): number {
  return snapshot[denomination] ?? 0;
}

export function stampAmountYen(snapshot: QuantitySnapshot): number {
  return Object.entries(snapshot).reduce(
    (sum, [denomination, quantity]) => sum + Number(denomination) * quantity,
    0,
  );
}

export function stampQuantityCount(snapshot: QuantitySnapshot): number {
  return Object.values(snapshot).reduce((sum, quantity) => sum + quantity, 0);
}
