-- Drop FileMaker traceability fields that are not used by the current domain model.
-- The source exports use stable business codes such as 出納No, 拠点CD, 会社CD, 部門CD,
-- and 社員番号, so the FileMaker 主キー UUID values are not needed after import.

BEGIN;

ALTER TABLE branches
  DROP COLUMN IF EXISTS opening_balance_amount_legacy,
  DROP COLUMN IF EXISTS legacy_uuid;

ALTER TABLE companies
  DROP COLUMN IF EXISTS legacy_uuid;

ALTER TABLE departments
  DROP COLUMN IF EXISTS legacy_uuid;

ALTER TABLE employees
  DROP COLUMN IF EXISTS legacy_uuid;

ALTER TABLE voucher_ledger_entries
  DROP COLUMN IF EXISTS legacy_uuid,
  DROP COLUMN IF EXISTS legacy_registered_button_clicked;

ALTER TABLE legacy_filemaker_voucher_ledger_staging
  DROP COLUMN IF EXISTS legacy_uuid;

COMMIT;
