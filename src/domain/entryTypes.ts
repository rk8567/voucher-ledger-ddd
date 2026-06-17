import { DomainError } from '@/domain/errors';

export enum EntryTypeCode {
  CarryIn = 1,
  Incoming = 2,
  Outgoing = 3,
  IncomingAlt = 4,
  OutgoingAlt = 5,
  InventoryCheck = 6,
  CarryOut = 9,
  OpeningBalance = 99,
}

export type BalanceSign = -1 | 0 | 1;

export function signOfEntryType(code: EntryTypeCode): BalanceSign {
  switch (code) {
    case EntryTypeCode.OpeningBalance:
    case EntryTypeCode.Incoming:
    case EntryTypeCode.IncomingAlt:
      return 1;
    case EntryTypeCode.Outgoing:
    case EntryTypeCode.OutgoingAlt:
      return -1;
    case EntryTypeCode.InventoryCheck:
    case EntryTypeCode.CarryIn:
    case EntryTypeCode.CarryOut:
      return 0;
    default:
      throw new DomainError('INVALID_ENTRY_TYPE', `Unsupported 入出区分CD: ${String(code)}`, { code });
  }
}

export function affectsBalance(code: EntryTypeCode): boolean {
  return signOfEntryType(code) !== 0;
}

export function isMovementEntryType(code: EntryTypeCode): boolean {
  return [
    EntryTypeCode.Incoming,
    EntryTypeCode.Outgoing,
    EntryTypeCode.IncomingAlt,
    EntryTypeCode.OutgoingAlt,
  ].includes(code);
}

export function reverseMovementEntryType(code: EntryTypeCode): EntryTypeCode {
  switch (code) {
    case EntryTypeCode.Incoming:
      return EntryTypeCode.Outgoing;
    case EntryTypeCode.Outgoing:
      return EntryTypeCode.Incoming;
    case EntryTypeCode.IncomingAlt:
      return EntryTypeCode.OutgoingAlt;
    case EntryTypeCode.OutgoingAlt:
      return EntryTypeCode.IncomingAlt;
    default:
      throw new DomainError('LEDGER_ENTRY_NOT_CORRECTABLE', `入出区分CD ${code} cannot be reversed by 赤伝票`, {
        code,
      });
  }
}

export function assertPostableEntryType(code: EntryTypeCode): void {
  const allowed = [
    EntryTypeCode.OpeningBalance,
    EntryTypeCode.Incoming,
    EntryTypeCode.Outgoing,
    EntryTypeCode.IncomingAlt,
    EntryTypeCode.OutgoingAlt,
    EntryTypeCode.InventoryCheck,
  ];

  if (!allowed.includes(code)) {
    throw new DomainError('INVALID_ENTRY_TYPE', `入出区分CD ${code} is not postable`, { code });
  }
}
