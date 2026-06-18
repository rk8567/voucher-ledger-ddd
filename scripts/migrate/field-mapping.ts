/** FileMaker T切手出納台帳 CSV column names → staging columns (from DB金券管理台帳_fmp12.xml). */
export const LEDGER_CSV_COLUMNS: Record<string, string> = {
  主キー: 'legacy_uuid',
  出納No: 'ledger_no',
  部門CD: 'department_code',
  拠点CD: 'branch_code',
  年: 'period_year',
  月: 'period_month',
  申請処理日: 'application_date',
  処理日: 'processing_date',
  連番: 'daily_sequence',
  入出区分CD: 'entry_type_code',
  出納区分CD: 'transaction_category_code',
  入出拠点CD: 'counterparty_branch_code',
  状態CD: 'status_code',
  摘要: 'description',
  担当者CD: 'responsible_employee_no',
  出納帰属先会社CD: 'company_code',
  その他金額: 'other_amount',
  その他金額備考: 'other_amount_note',
  備考: 'remarks',
  Is削除: 'is_deleted',
  赤伝票CD: 'red_voucher_status_code',
  元伝票No: 'original_ledger_no',
  赤伝票No: 'reversal_ledger_no',
  訂正伝票No: 'correction_ledger_no',
  登録日時: 'registered_at',
  登録担当CD: 'registered_by_employee_no',
  更新日時: 'updated_at',
  更新担当CD: 'updated_by_employee_no',
  作成情報タイムスタンプ: 'filemaker_created_at',
  作成者: 'filemaker_created_by',
  修正情報タイムスタンプ: 'filemaker_modified_at',
  修正者: 'filemaker_modified_by',
};

export const LEDGER_QUANTITY_COLUMNS: Record<string, string> = Object.fromEntries(
  Array.from({ length: 16 }, (_, index) => {
    const rep = index + 1;
    return [`枚数N[${rep}]`, `quantity_rep_${String(rep).padStart(2, '0')}`];
  }),
);

/** M拠点L from 金券管理台帳.fmp12 → branches */
export const BRANCH_CSV_COLUMNS: Record<string, string> = {
  主キー: 'legacy_uuid',
  拠点CD: 'branch_code',
  拠点NM: 'branch_name',
  省略形: 'abbreviation',
  有効: 'active',
  開始残高S: 'opening_balance_amount_legacy',
  備考: 'notes',
};

/** M会社 from 各種マスター.fmp12 → companies */
export const COMPANY_CSV_COLUMNS: Record<string, string> = {
  主キー: 'legacy_uuid',
  会社CD: 'company_code',
  会社NM: 'company_name',
  正式名称: 'official_name',
  省略形: 'abbreviation',
};

/** M部門 from 各種マスター.fmp12 → departments */
export const DEPARTMENT_CSV_COLUMNS: Record<string, string> = {
  主キー: 'legacy_uuid',
  部門CD: 'department_code',
  部門NM: 'department_name',
};

/** M社員 from 各種マスター.fmp12 → employees */
export const EMPLOYEE_CSV_COLUMNS: Record<string, string> = {
  主キー: 'legacy_uuid',
  社員番号: 'employee_no',
  会社CD: 'company_code',
  部門CD: 'department_code',
  部門NM: 'department_name',
  拠点CD: 'branch_code',
  氏名: 'employee_name',
  アカウント名: 'account_name',
  Is承認者: 'is_approver',
  Is管理者: 'is_admin',
  退職日: 'retired_on',
};

/** M入出区分 from 金券管理台帳.fmp12 → entry_types (code tables only; effect inferred in seed). */
export const ENTRY_TYPE_CSV_COLUMNS: Record<string, string> = {
  コード: 'code',
  内容: 'name_japanese',
  省略形: 'abbreviation',
};

export const TRANSACTION_CATEGORY_CSV_COLUMNS: Record<string, string> = {
  コード: 'code',
  内容: 'name_japanese',
  省略形: 'abbreviation',
  選択有効: 'selectable',
};

export const RED_VOUCHER_CSV_COLUMNS: Record<string, string> = {
  コード: 'code',
  内容: 'name_japanese',
  省略形: 'abbreviation',
};

export type MasterImportTarget =
  | 'branches'
  | 'companies'
  | 'departments'
  | 'employees'
  | 'entry_types'
  | 'transaction_categories'
  | 'red_voucher_statuses';

export const MASTER_COLUMN_MAP: Record<MasterImportTarget, Record<string, string>> = {
  branches: BRANCH_CSV_COLUMNS,
  companies: COMPANY_CSV_COLUMNS,
  departments: DEPARTMENT_CSV_COLUMNS,
  employees: EMPLOYEE_CSV_COLUMNS,
  entry_types: ENTRY_TYPE_CSV_COLUMNS,
  transaction_categories: TRANSACTION_CATEGORY_CSV_COLUMNS,
  red_voucher_statuses: RED_VOUCHER_CSV_COLUMNS,
};
