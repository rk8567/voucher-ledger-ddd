-- Optional staging table for raw FileMaker export before normalizing into the DDD tables.
-- Keep one row per T切手出納台帳 record. Populate it from FileMaker HTML table exports, then transform.

BEGIN;

CREATE TABLE IF NOT EXISTS legacy_filemaker_voucher_ledger_staging (
  staging_id bigserial PRIMARY KEY,
  imported_at timestamptz NOT NULL DEFAULT now(),
  source_file text NOT NULL DEFAULT 'DB金券管理台帳_fmp12.xml',
  raw_record jsonb,

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

COMMENT ON TABLE legacy_filemaker_voucher_ledger_staging IS 'Raw import staging for legacy T切手出納台帳. Not used by the application layer.';

CREATE INDEX IF NOT EXISTS idx_legacy_voucher_staging_ledger_no
  ON legacy_filemaker_voucher_ledger_staging(ledger_no);

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
