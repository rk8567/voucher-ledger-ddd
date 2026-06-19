-- Preserve FileMaker export login employee metadata without exposing raw records in the app UI.

BEGIN;

ALTER TABLE legacy_filemaker_voucher_ledger_staging
  ADD COLUMN IF NOT EXISTS filemaker_login_employee_no integer,
  ADD COLUMN IF NOT EXISTS filemaker_login_employee_name text;

ALTER TABLE voucher_ledger_entries
  ADD COLUMN IF NOT EXISTS filemaker_login_employee_no integer,
  ADD COLUMN IF NOT EXISTS filemaker_login_employee_name text;

WITH extracted AS (
  SELECT
    staging_id,
    CASE
      WHEN btrim(raw_record -> 'row' ->> 'gログイン社員番号') ~ '^\d+$'
        THEN (btrim(raw_record -> 'row' ->> 'gログイン社員番号'))::integer
      ELSE NULL
    END AS login_employee_no,
    NULLIF(btrim(raw_record -> 'row' ->> 'ログイン社員NM'), '') AS login_employee_name
  FROM legacy_filemaker_voucher_ledger_staging
  WHERE raw_record ? 'row'
)
UPDATE legacy_filemaker_voucher_ledger_staging s
SET filemaker_login_employee_no = COALESCE(s.filemaker_login_employee_no, extracted.login_employee_no),
    filemaker_login_employee_name = COALESCE(NULLIF(s.filemaker_login_employee_name, ''), extracted.login_employee_name)
FROM extracted
WHERE extracted.staging_id = s.staging_id
  AND (
    s.filemaker_login_employee_no IS NULL
    OR NULLIF(s.filemaker_login_employee_name, '') IS NULL
  );

UPDATE voucher_ledger_entries e
SET filemaker_login_employee_no = s.filemaker_login_employee_no,
    filemaker_login_employee_name = s.filemaker_login_employee_name
FROM legacy_filemaker_voucher_ledger_staging s
WHERE s.ledger_no = e.ledger_no
  AND (
    e.filemaker_login_employee_no IS DISTINCT FROM s.filemaker_login_employee_no
    OR e.filemaker_login_employee_name IS DISTINCT FROM s.filemaker_login_employee_name
  );

COMMIT;

