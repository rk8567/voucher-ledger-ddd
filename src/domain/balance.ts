import {
  DENOMINATIONS,
  type QuantityInput,
  type QuantitySnapshot,
  normalizeQuantities,
  quantityOf,
  stampAmountYen,
  zeroQuantities,
} from '@/domain/denominations';
import { DomainError } from '@/domain/errors';

export type BalanceSnapshot = {
  quantities: QuantitySnapshot;
  otherAmountYen: number;
  stampAmountYen: number;
  totalAmountYen: number;
};

export type BalanceDifference = {
  quantities: QuantitySnapshot;
  otherAmountYen: number;
  stampAmountYen: number;
  totalAmountYen: number;
};

export class Balance {
  private readonly quantities: QuantitySnapshot;
  readonly otherAmountYen: number;

  private constructor(quantities: QuantitySnapshot, otherAmountYen: number) {
    if (!Number.isInteger(otherAmountYen) || otherAmountYen < 0) {
      throw new DomainError('INVALID_AMOUNT', 'その他金額は0以上の整数で入力してください', { otherAmountYen });
    }

    this.quantities = quantities;
    this.otherAmountYen = otherAmountYen;
  }

  static from(input: { quantities?: QuantityInput; otherAmountYen?: number }): Balance {
    return new Balance(normalizeQuantities(input.quantities ?? {}), input.otherAmountYen ?? 0);
  }

  quantityOf(denominationYen: number): number {
    return quantityOf(this.quantities, denominationYen);
  }

  getQuantities(): QuantitySnapshot {
    return { ...this.quantities };
  }

  stampAmountYen(): number {
    return stampAmountYen(this.quantities);
  }

  totalAmountYen(): number {
    return this.stampAmountYen() + this.otherAmountYen;
  }

  hasAnyValue(): boolean {
    return this.totalAmountYen() > 0;
  }

  toSnapshot(): BalanceSnapshot {
    return {
      quantities: this.getQuantities(),
      otherAmountYen: this.otherAmountYen,
      stampAmountYen: this.stampAmountYen(),
      totalAmountYen: this.totalAmountYen(),
    };
  }
}

export function emptyBalanceSnapshot(): BalanceSnapshot {
  return {
    quantities: zeroQuantities(),
    otherAmountYen: 0,
    stampAmountYen: 0,
    totalAmountYen: 0,
  };
}

export function calculateDifference(actual: BalanceSnapshot, expected: BalanceSnapshot): BalanceDifference {
  const quantities: QuantitySnapshot = {};
  for (const denomination of DENOMINATIONS) {
    const diff = (actual.quantities[denomination] ?? 0) - (expected.quantities[denomination] ?? 0);
    if (diff !== 0) quantities[denomination] = diff;
  }

  const stampDiff = Object.entries(quantities).reduce(
    (sum, [denomination, quantity]) => sum + Number(denomination) * quantity,
    0,
  );
  const otherDiff = actual.otherAmountYen - expected.otherAmountYen;

  return {
    quantities,
    otherAmountYen: otherDiff,
    stampAmountYen: stampDiff,
    totalAmountYen: stampDiff + otherDiff,
  };
}
