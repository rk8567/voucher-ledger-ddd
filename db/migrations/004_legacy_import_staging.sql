-- Optional staging table for raw FileMaker export before normalizing into the DDD tables.
-- Keep one row per T切手出納台帳 record. Populate it from FileMaker HTML table exports, then transform.

BEGIN;

CREATE TABLE IF NOT EXISTS legacy_filemaker_voucher_ledger_staging (
  staging_id bigserial PRIMARY KEY,
  imported_at timestamptz NOT NULL DEFAULT now(),
  source_file text NOT NULL DEFAULT 'DB金券管理台帳_fmp12.xml',
  raw_record jsonb,

  filemaker_login_employee_no integer,
  filemaker_login_employee_name text,
  legacy_uuid text,
  ledger_no bigint,
  department_code integer,
  branch_code integer,
  period_year smallint,
  period_month smallint,
  application_date date,
  processing_date date,
  daily_sequence integer,
  entry_type_code integer,
  transaction_category_code integer,
  counterparty_branch_code integer,
  status_code integer,
  description text,
  responsible_employee_no integer,
  company_code integer,
  other_amount bigint,
  legacy_stamp_amount_total bigint,
  legacy_total_amount bigint,
  legacy_running_total_amount bigint,
  other_amount_note text,
  remarks text,
  image_present boolean,
  is_deleted boolean,
  red_voucher_status_code integer,
  original_ledger_no bigint,
  reversal_ledger_no bigint,
  correction_ledger_no bigint,
  registered_at timestamptz,
  registered_by_employee_no integer,
  updated_at timestamptz,
  updated_by_employee_no integer,
  filemaker_created_at timestamptz,
  filemaker_created_by text,
  filemaker_modified_at timestamptz,
  filemaker_modified_by text,

  -- FileMaker repeating field 枚数N[1..16]
  quantity_rep_01 integer,
  quantity_rep_02 integer,
  quantity_rep_03 integer,
  quantity_rep_04 integer,
  quantity_rep_05 integer,
  quantity_rep_06 integer,
  quantity_rep_07 integer,
  quantity_rep_08 integer,
  quantity_rep_09 integer,
  quantity_rep_10 integer,
  quantity_rep_11 integer,
  quantity_rep_12 integer,
  quantity_rep_13 integer,
  quantity_rep_14 integer,
  quantity_rep_15 integer,
  quantity_rep_16 integer
);

ALTER TABLE legacy_filemaker_voucher_ledger_staging
  ADD COLUMN IF NOT EXISTS filemaker_login_employee_no integer,
  ADD COLUMN IF NOT EXISTS filemaker_login_employee_name text,
  ADD COLUMN IF NOT EXISTS legacy_uuid text,
  ADD COLUMN IF NOT EXISTS ledger_no bigint,
  ADD COLUMN IF NOT EXISTS department_code integer,
  ADD COLUMN IF NOT EXISTS branch_code integer,
  ADD COLUMN IF NOT EXISTS period_year smallint,
  ADD COLUMN IF NOT EXISTS period_month smallint,
  ADD COLUMN IF NOT EXISTS application_date date,
  ADD COLUMN IF NOT EXISTS processing_date date,
  ADD COLUMN IF NOT EXISTS daily_sequence integer,
  ADD COLUMN IF NOT EXISTS entry_type_code integer,
  ADD COLUMN IF NOT EXISTS transaction_category_code integer,
  ADD COLUMN IF NOT EXISTS counterparty_branch_code integer,
  ADD COLUMN IF NOT EXISTS status_code integer,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS responsible_employee_no integer,
  ADD COLUMN IF NOT EXISTS company_code integer,
  ADD COLUMN IF NOT EXISTS other_amount bigint,
  ADD COLUMN IF NOT EXISTS legacy_stamp_amount_total bigint,
  ADD COLUMN IF NOT EXISTS legacy_total_amount bigint,
  ADD COLUMN IF NOT EXISTS legacy_running_total_amount bigint,
  ADD COLUMN IF NOT EXISTS other_amount_note text,
  ADD COLUMN IF NOT EXISTS remarks text,
  ADD COLUMN IF NOT EXISTS image_present boolean,
  ADD COLUMN IF NOT EXISTS is_deleted boolean,
  ADD COLUMN IF NOT EXISTS red_voucher_status_code integer,
  ADD COLUMN IF NOT EXISTS original_ledger_no bigint,
  ADD COLUMN IF NOT EXISTS reversal_ledger_no bigint,
  ADD COLUMN IF NOT EXISTS correction_ledger_no bigint,
  ADD COLUMN IF NOT EXISTS registered_at timestamptz,
  ADD COLUMN IF NOT EXISTS registered_by_employee_no integer,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by_employee_no integer,
  ADD COLUMN IF NOT EXISTS filemaker_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS filemaker_created_by text,
  ADD COLUMN IF NOT EXISTS filemaker_modified_at timestamptz,
  ADD COLUMN IF NOT EXISTS filemaker_modified_by text,
  ADD COLUMN IF NOT EXISTS quantity_rep_01 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_02 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_03 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_04 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_05 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_06 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_07 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_08 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_09 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_10 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_11 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_12 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_13 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_14 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_15 integer,
  ADD COLUMN IF NOT EXISTS quantity_rep_16 integer;

COMMENT ON TABLE legacy_filemaker_voucher_ledger_staging IS 'Raw import staging for legacy T切手出納台帳. Not used by the application layer.';

CREATE OR REPLACE VIEW legacy_filemaker_running_balance_reconciliation AS
WITH legacy_deltas AS (
  SELECT
    e.ledger_no,
    e.branch_code,
    e.daily_sequence,
    CASE et.effect
      WHEN 'opening_balance' THEN t.total_amount
      WHEN 'incoming'        THEN t.total_amount
      WHEN 'outgoing'        THEN -t.total_amount
      ELSE 0::bigint
    END AS legacy_delta_amount
  FROM voucher_ledger_entries e
  JOIN entry_types et ON et.code = e.entry_type_code
  JOIN voucher_ledger_entry_totals t ON t.entry_id = e.id
  WHERE e.posted_at IS NOT NULL
),
legacy_running_totals AS (
  SELECT
    ledger_no,
    (SUM(legacy_delta_amount) OVER (
      PARTITION BY branch_code
      ORDER BY daily_sequence, ledger_no
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ))::bigint AS running_total_amount
  FROM legacy_deltas
)
SELECT
  s.ledger_no,
  s.branch_code,
  s.processing_date,
  s.daily_sequence,
  s.legacy_running_total_amount,
  r.running_total_amount AS computed_running_total_amount,
  CASE
    WHEN s.legacy_running_total_amount IS NULL THEN NULL
    WHEN r.running_total_amount IS NULL THEN NULL
    ELSE (r.running_total_amount - s.legacy_running_total_amount)::bigint
  END AS running_total_difference,
  CASE
    WHEN s.legacy_running_total_amount IS NULL THEN NULL
    ELSE r.running_total_amount IS NOT NULL
     AND r.running_total_amount = s.legacy_running_total_amount
  END AS running_total_matches
FROM legacy_filemaker_voucher_ledger_staging s
LEFT JOIN legacy_running_totals r
  ON r.ledger_no = s.ledger_no
WHERE s.ledger_no IS NOT NULL;

COMMENT ON VIEW legacy_filemaker_running_balance_reconciliation IS 'Golden-master comparison between FileMaker 残高合計 and FileMaker-compatible running totals ordered by 連番/出納No, including deleted legacy rows.';

CREATE TABLE IF NOT EXISTS legacy_import_audit_log (
  audit_id bigserial PRIMARY KEY,
  event_at timestamptz NOT NULL DEFAULT now(),
  operation text NOT NULL CHECK (length(btrim(operation)) > 0),
  legacy_import_enabled boolean NOT NULL,
  database_user_name text NOT NULL DEFAULT current_user,
  application_name text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE legacy_import_audit_log IS 'Operational audit log for migration SQL that enables voucher_ledger.legacy_import.';

CREATE INDEX IF NOT EXISTS idx_legacy_voucher_staging_ledger_no
  ON legacy_filemaker_voucher_ledger_staging(ledger_no);

CREATE INDEX IF NOT EXISTS idx_legacy_import_audit_event_at
  ON legacy_import_audit_log(event_at DESC);

CREATE INDEX IF NOT EXISTS idx_legacy_voucher_staging_branch
  ON legacy_filemaker_voucher_ledger_staging(branch_code, processing_date, ledger_no);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legacy_voucher_staging_ledger_no
  ON legacy_filemaker_voucher_ledger_staging(ledger_no)
  WHERE ledger_no IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_legacy_filemaker_voucher_ledger_staging_ledger_no'
  ) THEN
    ALTER TABLE legacy_filemaker_voucher_ledger_staging
      ADD CONSTRAINT uq_legacy_filemaker_voucher_ledger_staging_ledger_no UNIQUE (ledger_no);
  END IF;
END;
$$;

-- After transforming legacy rows into voucher_ledger_entries, reset the sequence:
-- SELECT setval(
--   'voucher_ledger_no_seq',
--   COALESCE((SELECT max(ledger_no) FROM voucher_ledger_entries), 0) + 1,
--   false
-- );

COMMIT;
