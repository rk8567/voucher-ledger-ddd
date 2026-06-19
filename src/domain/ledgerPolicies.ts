import { Balance } from '@/domain/balance';
import { DomainError } from '@/domain/errors';
import { EntryTypeCode, assertPostableEntryType, isMovementEntryType } from '@/domain/entryTypes';

export type PostingPolicyInput = {
  entryTypeCode: EntryTypeCode;
  transactionCategoryCode?: number | null;
  branchCode: number;
  counterpartyBranchCode?: number | null;
  description: string;
  value: Balance;
};

export function assertCanPost(input: PostingPolicyInput): void {
  assertPostableEntryType(input.entryTypeCode);

  if (input.description.trim().length === 0) {
    throw new DomainError('DESCRIPTION_REQUIRED', '摘要を入力してください');
  }

  const requiresValue =
    input.entryTypeCode === EntryTypeCode.OpeningBalance ||
    input.entryTypeCode === EntryTypeCode.InventoryCheck ||
    isMovementEntryType(input.entryTypeCode);

  if (requiresValue && !input.value.hasAnyValue()) {
    throw new DomainError('VALUE_REQUIRED', '切手の枚数またはその他金額を入力してください');
  }

  if (input.transactionCategoryCode === 1 && !input.counterpartyBranchCode) {
    throw new DomainError('COUNTERPARTY_BRANCH_REQUIRED', '入出拠点を入力してください');
  }

  if (input.counterpartyBranchCode && input.counterpartyBranchCode === input.branchCode) {
    throw new DomainError('COUNTERPARTY_BRANCH_MUST_DIFFER', '入出拠点は拠点と別の拠点を選択してください');
  }
}
