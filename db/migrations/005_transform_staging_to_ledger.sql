-- Transform legacy_filemaker_voucher_ledger_staging into voucher_ledger_entries.
-- Run after master data and ledger HTML imports. Safe to re-run: skips ledger_no already loaded.

BEGIN;

SET LOCAL voucher_ledger.legacy_import = 'on';

INSERT INTO legacy_import_audit_log (
  operation,
  legacy_import_enabled,
  application_name,
  detail
)
SELECT
  'transform_started',
  current_setting('voucher_ledger.legacy_import', true) = 'on',
  current_setting('application_name', true),
  jsonb_build_object(
    'staging_rows', (SELECT count(*) FROM legacy_filemaker_voucher_ledger_staging),
    'existing_ledger_entries', (SELECT count(*) FROM voucher_ledger_entries)
  );

ALTER TABLE legacy_filemaker_voucher_ledger_staging
  ADD COLUMN IF NOT EXISTS filemaker_login_employee_no integer,
  ADD COLUMN IF NOT EXISTS filemaker_login_employee_name text;

ALTER TABLE voucher_ledger_entries
  ADD COLUMN IF NOT EXISTS filemaker_login_employee_no integer,
  ADD COLUMN IF NOT EXISTS filemaker_login_employee_name text;

DO $$
DECLARE
  duplicate_ledger_no bigint;
  duplicate_count integer;
  conflicting_ledger_no bigint;
  existing_branch integer;
  staging_branch integer;
BEGIN
  SELECT ledger_no, count(*)::integer
    INTO duplicate_ledger_no, duplicate_count
    FROM legacy_filemaker_voucher_ledger_staging
   WHERE ledger_no IS NOT NULL
   GROUP BY ledger_no
  HAVING count(*) > 1
   ORDER BY ledger_no
   LIMIT 1;

  IF duplicate_ledger_no IS NOT NULL THEN
    RAISE EXCEPTION 'legacy transform aborted: staging contains duplicate 出納No=% across % rows', duplicate_ledger_no, duplicate_count;
  END IF;

  SELECT s.ledger_no, e.branch_code, s.branch_code
    INTO conflicting_ledger_no, existing_branch, staging_branch
    FROM legacy_filemaker_voucher_ledger_staging s
    JOIN voucher_ledger_entries e ON e.ledger_no = s.ledger_no
   WHERE s.branch_code IS NOT NULL
     AND e.branch_code IS DISTINCT FROM s.branch_code
   ORDER BY s.ledger_no
   LIMIT 1;

  IF conflicting_ledger_no IS NOT NULL THEN
    RAISE EXCEPTION 'legacy transform aborted: 出納No=% already exists for 拠点CD=% but staging has 拠点CD=%', conflicting_ledger_no, existing_branch, staging_branch;
  END IF;
END;
$$;

-- Stub missing FK targets so legacy rows can load before full master cleanup.
INSERT INTO branches (branch_code, branch_name, active)
SELECT DISTINCT s.branch_code, 'Legacy branch ' || s.branch_code, false
FROM legacy_filemaker_voucher_ledger_staging s
WHERE s.branch_code IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.branch_code = s.branch_code)
ON CONFLICT (branch_code) DO NOTHING;

INSERT INTO branches (branch_code, branch_name, active)
SELECT DISTINCT s.counterparty_branch_code, 'Legacy branch ' || s.counterparty_branch_code, false
FROM legacy_filemaker_voucher_ledger_staging s
WHERE s.counterparty_branch_code IS NOT NULL
  AND s.counterparty_branch_code <> s.branch_code
  AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.branch_code = s.counterparty_branch_code)
ON CONFLICT (branch_code) DO NOTHING;

INSERT INTO companies (company_code, company_name)
SELECT DISTINCT s.company_code, 'Legacy company ' || s.company_code
FROM legacy_filemaker_voucher_ledger_staging s
WHERE s.company_code IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.company_code = s.company_code)
ON CONFLICT (company_code) DO NOTHING;

INSERT INTO departments (department_code, department_name, active)
SELECT DISTINCT s.department_code, 'Legacy department ' || s.department_code, false
FROM legacy_filemaker_voucher_ledger_staging s
WHERE s.department_code IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.department_code = s.department_code)
ON CONFLICT (department_code) DO NOTHING;

INSERT INTO employees (employee_no, employee_name, active)
SELECT DISTINCT e.employee_no, 'Legacy employee ' || e.employee_no, false
FROM (
  SELECT responsible_employee_no AS employee_no FROM legacy_filemaker_voucher_ledger_staging
  UNION
  SELECT registered_by_employee_no FROM legacy_filemaker_voucher_ledger_staging
  UNION
  SELECT updated_by_employee_no FROM legacy_filemaker_voucher_ledger_staging
) e
WHERE e.employee_no IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM employees emp WHERE emp.employee_no = e.employee_no)
ON CONFLICT (employee_no) DO NOTHING;

UPDATE voucher_ledger_entries e
SET branch_code = s.branch_code,
    counterparty_branch_code = CASE
      WHEN s.counterparty_branch_code IS NOT NULL AND s.counterparty_branch_code <> s.branch_code
        THEN s.counterparty_branch_code
      ELSE NULL
    END,
    responsible_employee_no = s.responsible_employee_no,
    registered_by_employee_no = s.registered_by_employee_no,
    updated_by_employee_no = s.updated_by_employee_no,
    correction_ledger_no = CASE
      WHEN s.correction_ledger_no IS NOT NULL
       AND (
         EXISTS (
           SELECT 1
             FROM legacy_filemaker_voucher_ledger_staging linked_staging
            WHERE linked_staging.ledger_no = s.correction_ledger_no
              AND linked_staging.branch_code IS NOT NULL
              AND linked_staging.processing_date IS NOT NULL
              AND linked_staging.entry_type_code IS NOT NULL
         )
         OR EXISTS (
           SELECT 1
             FROM voucher_ledger_entries linked_entry
            WHERE linked_entry.ledger_no = s.correction_ledger_no
         )
       )
        THEN s.correction_ledger_no
      ELSE NULL
    END,
    registered_at = COALESCE(s.registered_at, e.registered_at),
    updated_at = COALESCE(s.updated_at, e.updated_at),
    filemaker_login_employee_no = s.filemaker_login_employee_no,
    filemaker_login_employee_name = s.filemaker_login_employee_name
FROM legacy_filemaker_voucher_ledger_staging s
WHERE s.ledger_no = e.ledger_no
  AND (
    e.branch_code IS DISTINCT FROM s.branch_code
    OR e.counterparty_branch_code IS DISTINCT FROM CASE
      WHEN s.counterparty_branch_code IS NOT NULL AND s.counterparty_branch_code <> s.branch_code
        THEN s.counterparty_branch_code
      ELSE NULL
    END
    OR e.responsible_employee_no IS DISTINCT FROM s.responsible_employee_no
    OR e.registered_by_employee_no IS DISTINCT FROM s.registered_by_employee_no
    OR e.updated_by_employee_no IS DISTINCT FROM s.updated_by_employee_no
    OR e.correction_ledger_no IS DISTINCT FROM CASE
      WHEN s.correction_ledger_no IS NOT NULL
       AND (
         EXISTS (
           SELECT 1
             FROM legacy_filemaker_voucher_ledger_staging linked_staging
            WHERE linked_staging.ledger_no = s.correction_ledger_no
              AND linked_staging.branch_code IS NOT NULL
              AND linked_staging.processing_date IS NOT NULL
              AND linked_staging.entry_type_code IS NOT NULL
         )
         OR EXISTS (
           SELECT 1
             FROM voucher_ledger_entries linked_entry
            WHERE linked_entry.ledger_no = s.correction_ledger_no
         )
       )
        THEN s.correction_ledger_no
      ELSE NULL
    END
    OR (s.registered_at IS NOT NULL AND e.registered_at IS DISTINCT FROM s.registered_at)
    OR (s.updated_at IS NOT NULL AND e.updated_at IS DISTINCT FROM s.updated_at)
    OR e.filemaker_login_employee_no IS DISTINCT FROM s.filemaker_login_employee_no
    OR e.filemaker_login_employee_name IS DISTINCT FROM s.filemaker_login_employee_name
  );

INSERT INTO voucher_ledger_entries (
  legacy_uuid,
  ledger_no,
  branch_code,
  department_code,
  period_year,
  period_month,
  application_date,
  processing_date,
  daily_sequence,
  entry_type_code,
  transaction_category_code,
  counterparty_branch_code,
  status_code,
  company_code,
  responsible_employee_no,
  description,
  remarks,
  other_amount,
  other_amount_note,
  red_voucher_status_code,
  original_ledger_no,
  reversal_ledger_no,
  correction_ledger_no,
  is_deleted,
  registered_at,
  registered_by_employee_no,
  updated_at,
  updated_by_employee_no,
  posted_at,
  filemaker_created_at,
  filemaker_created_by,
  filemaker_modified_at,
  filemaker_modified_by,
  filemaker_login_employee_no,
  filemaker_login_employee_name
)
SELECT
  s.legacy_uuid,
  s.ledger_no,
  s.branch_code,
  s.department_code,
  s.period_year,
  s.period_month,
  s.application_date,
  s.processing_date,
  COALESCE(s.daily_sequence, 0),
  s.entry_type_code,
  s.transaction_category_code,
  CASE
    WHEN s.counterparty_branch_code IS NOT NULL AND s.counterparty_branch_code <> s.branch_code
      THEN s.counterparty_branch_code
    ELSE NULL
  END,
  s.status_code,
  s.company_code,
  s.responsible_employee_no,
  COALESCE(NULLIF(btrim(s.description), ''), '(legacy import)'),
  s.remarks,
  COALESCE(s.other_amount, 0),
  s.other_amount_note,
  COALESCE(s.red_voucher_status_code, 0),
  s.original_ledger_no,
  s.reversal_ledger_no,
  CASE
    WHEN s.correction_ledger_no IS NOT NULL
     AND (
       EXISTS (
         SELECT 1
           FROM legacy_filemaker_voucher_ledger_staging linked_staging
          WHERE linked_staging.ledger_no = s.correction_ledger_no
            AND linked_staging.branch_code IS NOT NULL
            AND linked_staging.processing_date IS NOT NULL
            AND linked_staging.entry_type_code IS NOT NULL
       )
       OR EXISTS (
         SELECT 1
           FROM voucher_ledger_entries linked_entry
          WHERE linked_entry.ledger_no = s.correction_ledger_no
       )
     )
      THEN s.correction_ledger_no
    ELSE NULL
  END,
  COALESCE(s.is_deleted, false),
  COALESCE(s.registered_at, s.imported_at, now()),
  s.registered_by_employee_no,
  COALESCE(s.updated_at, s.registered_at, s.imported_at, now()),
  s.updated_by_employee_no,
  COALESCE(s.registered_at, s.imported_at, now()),
  s.filemaker_created_at,
  s.filemaker_created_by,
  s.filemaker_modified_at,
  s.filemaker_modified_by,
  s.filemaker_login_employee_no,
  s.filemaker_login_employee_name
FROM legacy_filemaker_voucher_ledger_staging s
WHERE s.ledger_no IS NOT NULL
  AND s.branch_code IS NOT NULL
  AND s.processing_date IS NOT NULL
  AND s.entry_type_code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM voucher_ledger_entries e WHERE e.ledger_no = s.ledger_no
  );

INSERT INTO voucher_ledger_entry_denominations (entry_id, denomination_yen, quantity)
SELECT
  e.id,
  d.denomination_yen,
  COALESCE(q.quantity, 0)
FROM voucher_ledger_entries e
JOIN legacy_filemaker_voucher_ledger_staging s ON s.ledger_no = e.ledger_no
JOIN LATERAL (
  VALUES
    (1,  s.quantity_rep_01),
    (2,  s.quantity_rep_02),
    (3,  s.quantity_rep_03),
    (4,  s.quantity_rep_04),
    (5,  s.quantity_rep_05),
    (6,  s.quantity_rep_06),
    (7,  s.quantity_rep_07),
    (8,  s.quantity_rep_08),
    (9,  s.quantity_rep_09),
    (10, s.quantity_rep_10),
    (11, s.quantity_rep_11),
    (12, s.quantity_rep_12),
    (13, s.quantity_rep_13),
    (14, s.quantity_rep_14),
    (15, s.quantity_rep_15),
    (16, s.quantity_rep_16)
) AS q(rep_no, quantity) ON true
JOIN denominations d ON d.legacy_repetition_no = q.rep_no
WHERE COALESCE(q.quantity, 0) <> 0
  AND NOT EXISTS (
    SELECT 1
    FROM voucher_ledger_entry_denominations existing
    WHERE existing.entry_id = e.id
      AND existing.denomination_yen = d.denomination_yen
  );

SELECT setval(
  'voucher_ledger_no_seq',
  COALESCE((SELECT max(ledger_no) FROM voucher_ledger_entries), 0) + 1,
  false
);

INSERT INTO legacy_import_audit_log (
  operation,
  legacy_import_enabled,
  application_name,
  detail
)
SELECT
  'transform_completed',
  current_setting('voucher_ledger.legacy_import', true) = 'on',
  current_setting('application_name', true),
  jsonb_build_object(
    'staging_rows', (SELECT count(*) FROM legacy_filemaker_voucher_ledger_staging),
    'ledger_entries', (SELECT count(*) FROM voucher_ledger_entries),
    'denomination_rows', (SELECT count(*) FROM voucher_ledger_entry_denominations),
    'next_ledger_no', COALESCE((SELECT max(ledger_no) FROM voucher_ledger_entries), 0) + 1
  );

COMMIT;
