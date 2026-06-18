/** M拠点L from 金券管理台帳.fmp12 → branches */
export const BRANCH_HTML_COLUMNS: Record<string, string> = {
  主キー: 'legacy_uuid',
  拠点CD: 'branch_code',
  拠点NM: 'branch_name',
  省略形: 'abbreviation',
  有効: 'active',
  開始残高S: 'opening_balance_amount_legacy',
  備考: 'notes',
};

/** M会社 from 各種マスター.fmp12 → companies */
export const COMPANY_HTML_COLUMNS: Record<string, string> = {
  主キー: 'legacy_uuid',
  会社CD: 'company_code',
  会社NM: 'company_name',
  正式名称: 'official_name',
  省略形: 'abbreviation',
};

/** M部門 from 各種マスター.fmp12 → departments */
export const DEPARTMENT_HTML_COLUMNS: Record<string, string> = {
  主キー: 'legacy_uuid',
  部門CD: 'department_code',
  部門NM: 'department_name',
};

/** M社員 from 各種マスター.fmp12 → employees */
export const EMPLOYEE_HTML_COLUMNS: Record<string, string> = {
  主キー: 'legacy_uuid',
  社員番号: 'employee_no',
  会社CD: 'company_code',
  会社NM: 'company_name',
  部門CD: 'department_code',
  部門NM: 'department_name',
  拠点CD: 'branch_code',
  拠点NM: 'branch_name',
  氏名: 'employee_name',
  アカウント名: 'account_name',
  Is承認者: 'is_approver',
  Is管理者: 'is_admin',
  退職日: 'retired_on',
};

/** M入出区分 from 金券管理台帳.fmp12 → entry_types (code tables only; effect inferred in seed). */
export const ENTRY_TYPE_HTML_COLUMNS: Record<string, string> = {
  コード: 'code',
  内容: 'name_japanese',
  省略形: 'abbreviation',
};

export const TRANSACTION_CATEGORY_HTML_COLUMNS: Record<string, string> = {
  コード: 'code',
  内容: 'name_japanese',
  省略形: 'abbreviation',
  選択有効: 'selectable',
};

export const RED_VOUCHER_HTML_COLUMNS: Record<string, string> = {
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
  branches: BRANCH_HTML_COLUMNS,
  companies: COMPANY_HTML_COLUMNS,
  departments: DEPARTMENT_HTML_COLUMNS,
  employees: EMPLOYEE_HTML_COLUMNS,
  entry_types: ENTRY_TYPE_HTML_COLUMNS,
  transaction_categories: TRANSACTION_CATEGORY_HTML_COLUMNS,
  red_voucher_statuses: RED_VOUCHER_HTML_COLUMNS,
};
