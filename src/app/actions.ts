'use server';

import { redirect } from 'next/navigation';
import { updateTag } from 'next/cache';

import { RegisterInventoryCheckUseCase } from '@/application/usecases/RegisterInventoryCheck';
import { RegisterVoucherMovementUseCase } from '@/application/usecases/RegisterVoucherMovement';
import { IssueRedVoucherCorrectionUseCase } from '@/application/usecases/IssueRedVoucherCorrection';
import { DENOMINATIONS, type QuantityInput } from '@/domain/denominations';
import { DomainError } from '@/domain/errors';
import { EntryTypeCode } from '@/domain/entryTypes';
import { unitOfWork } from '@/infrastructure/postgres/singletons';
import { LEDGER_DATA_CACHE_TAG } from '@/server/ledger';
import type { EntryActionState } from './entryActionState';

const movementEntryTypes = new Set<number>([
  EntryTypeCode.Incoming,
  EntryTypeCode.Outgoing,
  EntryTypeCode.IncomingAlt,
  EntryTypeCode.OutgoingAlt,
]);
const valueRequiredMessage = '切手の枚数またはその他金額を入力してください';

export async function registerVoucherMovementAction(
  _previousState: EntryActionState,
  formData: FormData,
): Promise<EntryActionState> {
  let ledgerNo: number;
  try {
    const quantities = quantityInput(formData);
    const otherAmountYen = boundedInt(formData, 'otherAmountYen', 'その他金額', 0, 999_999_999) ?? 0;
    assertAnyEnteredValue(quantities, otherAmountYen);

    const useCase = new RegisterVoucherMovementUseCase(unitOfWork);
    const result = await useCase.execute({
      branchCode: requiredInt(formData, 'branchCode', '拠点CD'),
      processingDate: requiredDate(formData, 'processingDate', '処理日'),
      applicationDate: optionalDate(formData, 'applicationDate', '申請処理日'),
      entryTypeCode: movementEntryType(requiredInt(formData, 'entryTypeCode', '入出区分')),
      transactionCategoryCode: optionalInt(formData, 'transactionCategoryCode'),
      counterpartyBranchCode: optionalInt(formData, 'counterpartyBranchCode'),
      companyCode: optionalInt(formData, 'companyCode'),
      departmentCode: optionalInt(formData, 'departmentCode'),
      responsibleEmployeeNo: optionalInt(formData, 'responsibleEmployeeNo'),
      statusCode: optionalInt(formData, 'statusCode'),
      description: requiredText(formData, 'description', '摘要'),
      remarks: optionalText(formData, 'remarks'),
      quantities,
      otherAmountYen,
      otherAmountNote: optionalText(formData, 'otherAmountNote'),
      actor: actorContext(formData),
    });
    ledgerNo = result.ledgerNo;
  } catch (error) {
    return errorState(error, formData);
  }

  redirectWithMessage('movement', ledgerNo, `新規レコードを登録しました: #${ledgerNo}`);
}

export async function registerInventoryCheckAction(
  _previousState: EntryActionState,
  formData: FormData,
): Promise<EntryActionState> {
  let ledgerNo: number;
  let discrepancyAmountYen: number;
  try {
    const quantities = quantityInput(formData);
    const otherAmountYen = boundedInt(formData, 'otherAmountYen', 'その他金額', 0, 999_999_999) ?? 0;
    assertAnyEnteredValue(quantities, otherAmountYen);

    const useCase = new RegisterInventoryCheckUseCase(unitOfWork);
    const result = await useCase.execute({
      branchCode: requiredInt(formData, 'branchCode', '拠点CD'),
      processingDate: requiredDate(formData, 'processingDate', '処理日'),
      applicationDate: optionalDate(formData, 'applicationDate', '申請処理日'),
      responsibleEmployeeNo: optionalInt(formData, 'responsibleEmployeeNo'),
      description: optionalText(formData, 'description'),
      remarks: optionalText(formData, 'remarks'),
      quantities,
      otherAmountYen,
      otherAmountNote: optionalText(formData, 'otherAmountNote'),
      actor: actorContext(formData),
    });
    ledgerNo = result.ledgerNo;
    discrepancyAmountYen = result.discrepancyAmountYen;
  } catch (error) {
    return errorState(error, formData);
  }

  redirectWithMessage(
    'inventory',
    ledgerNo,
    `現在高チェックを登録しました: #${ledgerNo} / 差異 ${discrepancyAmountYen.toLocaleString('ja-JP')}円`,
  );
}

export async function issueRedVoucherCorrectionAction(
  _previousState: EntryActionState,
  formData: FormData,
): Promise<EntryActionState> {
  let reversalLedgerNo: number;
  let correctedLedgerNo: number | undefined;
  try {
    const quantities = quantityInput(formData);
    const otherAmountYen = boundedInt(formData, 'otherAmountYen', 'その他金額', 0, 999_999_999) ?? 0;
    assertAnyEnteredValue(quantities, otherAmountYen);

    const useCase = new IssueRedVoucherCorrectionUseCase(unitOfWork);
    const result = await useCase.execute({
      originalLedgerNo: requiredInt(formData, 'originalLedgerNo', '元伝票No'),
      reversalProcessingDate: requiredDate(formData, 'reversalProcessingDate', '赤伝票処理日'),
      reversalApplicationDate: optionalDate(formData, 'reversalApplicationDate', '赤伝票申請処理日'),
      reversalDescription: optionalText(formData, 'reversalDescription'),
      reversalRemarks: optionalText(formData, 'reversalRemarks'),
      correctedEntry: {
        processingDate: requiredDate(formData, 'processingDate', '訂正処理日'),
        applicationDate: optionalDate(formData, 'applicationDate', '訂正申請処理日'),
        entryTypeCode: movementEntryType(requiredInt(formData, 'entryTypeCode', '訂正入出区分')),
        transactionCategoryCode: optionalInt(formData, 'transactionCategoryCode'),
        counterpartyBranchCode: optionalInt(formData, 'counterpartyBranchCode'),
        companyCode: optionalInt(formData, 'companyCode'),
        departmentCode: optionalInt(formData, 'departmentCode'),
        responsibleEmployeeNo: optionalInt(formData, 'responsibleEmployeeNo'),
        statusCode: optionalInt(formData, 'statusCode'),
        description: requiredText(formData, 'description', '訂正摘要'),
        remarks: optionalText(formData, 'remarks'),
        quantities,
        otherAmountYen,
        otherAmountNote: optionalText(formData, 'otherAmountNote'),
      },
      actor: actorContext(formData),
    });
    reversalLedgerNo = result.reversalLedgerNo;
    correctedLedgerNo = result.correctedLedgerNo;
  } catch (error) {
    if (isDatabaseValueRequiredError(error)) {
      return errorState(new DomainError(
        'ORIGINAL_VALUE_REQUIRED',
        '元伝票に切手の枚数またはその他金額がないため、赤伝票を登録できません',
      ), formData);
    }
    return errorState(error, formData);
  }

  redirectWithMessage(
    'correction',
    correctedLedgerNo ?? reversalLedgerNo,
    `赤伝票を登録しました: 赤伝票 #${reversalLedgerNo}${correctedLedgerNo ? ` / 訂正伝票 #${correctedLedgerNo}` : ''}`,
  );
}

function redirectWithMessage(clearDraft: WorkflowDraft, ledgerNo: number, message: string): never {
  updateTag(LEDGER_DATA_CACHE_TAG);
  redirect(`/?ledgerNo=${ledgerNo}&actionMessage=${encodeURIComponent(message)}&clearDraft=${clearDraft}`);
}

type WorkflowDraft = 'movement' | 'inventory' | 'correction';

function errorMessage(error: unknown): string {
  if (error instanceof DomainError && error.code === 'OPENING_BALANCE_REQUIRED') {
    return 'この拠点は開始時残高が未登録です。新規レコードまたは現在高チェックの前に、開始時残高を登録してください。';
  }
  if (isDatabaseValueRequiredError(error)) return valueRequiredMessage;

  return error instanceof DomainError || error instanceof Error
    ? error.message
    : '登録に失敗しました';
}

function errorState(error: unknown, formData: FormData): EntryActionState {
  return {
    error: errorMessage(error),
    values: formValues(formData),
    fieldErrors: fieldErrors(error),
  };
}

function fieldErrors(error: unknown): Record<string, string> {
  if (isDatabaseValueRequiredError(error)) {
    return {
      otherAmountYen: valueRequiredMessage,
      quantities: valueRequiredMessage,
    };
  }

  if (!(error instanceof DomainError)) return {};

  if (error.code === 'VALUE_REQUIRED') {
    return {
      otherAmountYen: error.message,
      quantities: error.message,
    };
  }

  const field = error.details
    && typeof error.details === 'object'
    && 'field' in error.details
    && typeof error.details.field === 'string'
    ? error.details.field
    : null;

  return field ? { [field]: error.message } : {};
}

function actorContext(formData: FormData): { employeeNo?: number | null } | undefined {
  const employeeNo = optionalInt(formData, 'actorEmployeeNo');
  return employeeNo == null ? undefined : { employeeNo };
}

function movementEntryType(value: number): EntryTypeCode.Incoming | EntryTypeCode.Outgoing | EntryTypeCode.IncomingAlt | EntryTypeCode.OutgoingAlt {
  if (!movementEntryTypes.has(value)) {
    throw new DomainError('INVALID_ENTRY_TYPE', `新規レコードでは入金/出金系の入出区分を選択してください: ${value}`, {
      field: 'entryTypeCode',
    });
  }
  return value as EntryTypeCode.Incoming | EntryTypeCode.Outgoing | EntryTypeCode.IncomingAlt | EntryTypeCode.OutgoingAlt;
}

function quantityInput(formData: FormData): QuantityInput {
  return Object.fromEntries(
    DENOMINATIONS.map((denomination) => [
      denomination,
      boundedInt(formData, `quantity_${denomination}`, `${denomination}円の枚数`, 0, 9999) ?? 0,
    ]),
  );
}

function assertAnyEnteredValue(quantities: QuantityInput, otherAmountYen: number): void {
  const hasQuantity = Object.values(quantities).some((quantity) => (quantity ?? 0) > 0);
  if (otherAmountYen > 0 || hasQuantity) return;

  throw new DomainError('VALUE_REQUIRED', valueRequiredMessage);
}

function isDatabaseValueRequiredError(error: unknown): boolean {
  return error instanceof Error
    && (
      error.message.includes('Amount or denomination quantity is required for entry_type_code=')
      || error.message.includes('切手の枚数またはその他金額を入力してください (entry_type_code=')
    );
}

function requiredDate(formData: FormData, name: string, label: string): string {
  const value = optionalDate(formData, name, label);
  if (!value) throw new DomainError('REQUIRED_FIELD', `${label}を入力してください`, { field: name });
  return value;
}

function optionalDate(formData: FormData, name: string, label: string): string | null {
  const text = optionalText(formData, name);
  if (text == null) return null;
  const normalized = text.replaceAll('/', '-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new DomainError('INVALID_DATE', `${label}はyyyy/mm/dd形式で入力してください`, { field: name });
  }
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month! - 1
    || date.getUTCDate() !== day
  ) {
    throw new DomainError('INVALID_DATE', `${label}は有効な日付で入力してください`, { field: name });
  }
  return normalized;
}

function requiredText(formData: FormData, name: string, label: string): string {
  const value = optionalText(formData, name);
  if (!value) throw new DomainError('REQUIRED_FIELD', `${label}を入力してください`, { field: name });
  return value;
}

function optionalText(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function requiredInt(formData: FormData, name: string, label: string): number {
  const value = optionalInt(formData, name);
  if (value == null) throw new DomainError('REQUIRED_FIELD', `${label}を入力してください`, { field: name });
  return value;
}

function boundedInt(formData: FormData, name: string, label: string, min: number, max: number): number | null {
  const value = optionalInt(formData, name);
  if (value == null) return null;
  if (value < min || value > max) {
    throw new DomainError('INVALID_NUMBER', `${label}は${min}以上${max}以下で入力してください`, { field: name });
  }
  return value;
}

function optionalInt(formData: FormData, name: string): number | null {
  const text = optionalText(formData, name);
  if (text == null) return null;
  const value = Number(text.replaceAll(',', ''));
  if (!Number.isInteger(value)) throw new DomainError('INVALID_NUMBER', `${name}は整数で入力してください`, { field: name });
  return value;
}

function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === 'string') values[key] = value;
  });
  return values;
}
