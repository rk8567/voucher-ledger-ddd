-- FileMaker global/session fields and empty internal audit metadata are not
-- ledger row facts in the current import. Drop them from existing schemas.

BEGIN;

ALTER TABLE legacy_filemaker_voucher_ledger_staging
  DROP COLUMN IF EXISTS filemaker_login_employee_no,
  DROP COLUMN IF EXISTS filemaker_login_employee_name,
  DROP COLUMN IF EXISTS filemaker_created_at,
  DROP COLUMN IF EXISTS filemaker_created_by,
  DROP COLUMN IF EXISTS filemaker_modified_at,
  DROP COLUMN IF EXISTS filemaker_modified_by;

ALTER TABLE voucher_ledger_entries
  DROP COLUMN IF EXISTS filemaker_login_employee_no,
  DROP COLUMN IF EXISTS filemaker_login_employee_name,
  DROP COLUMN IF EXISTS filemaker_created_at,
  DROP COLUMN IF EXISTS filemaker_created_by,
  DROP COLUMN IF EXISTS filemaker_modified_at,
  DROP COLUMN IF EXISTS filemaker_modified_by;

COMMIT;
