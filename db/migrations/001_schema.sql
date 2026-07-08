-- Voucher / stamp ledger schema migrated from FileMaker 金券管理台帳.fmp12
-- Source DDR files:
--   filemaker/金券管理台帳_fmp12.xml
--   filemaker/DB金券管理台帳_fmp12.xml
--
-- Design intent:
--   * Store only source-of-truth facts in tables.
--   * Calculate 金額合計, 本日残, 推定残, 実残高, 差異 via views/application code.
--   * Keep FileMaker legacy codes for traceability during migration.
--   * Represent correction by compensating 赤伝票, not by in-place amount changes.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SEQUENCE IF NOT EXISTS voucher_ledger_no_seq AS bigint START WITH 1 INCREMENT BY 1;

-- -----------------------------------------------------------------------------
-- Master data
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS branches (
  branch_code integer PRIMARY KEY CHECK (branch_code > 0),
  branch_name text NOT NULL CHECK (length(btrim(branch_name)) > 0),
  abbreviation text,
  active boolean NOT NULL DEFAULT true,
  opening_balance_amount_legacy bigint,
  notes text,
  legacy_uuid text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE branches IS 'Legacy M拠点L / M拠点. 新規登録では active=true の拠点のみ使用する。';
COMMENT ON COLUMN branches.opening_balance_amount_legacy IS 'Legacy M拠点L::開始残高S, preserved for migration/reference only.';

CREATE TABLE IF NOT EXISTS companies (
  company_code integer PRIMARY KEY CHECK (company_code > 0),
  company_name text CHECK (company_name IS NULL OR length(btrim(company_name)) > 0),
  official_name text,
  abbreviation text,
  legacy_uuid text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE companies IS 'Legacy 各種マスター::M会社.';

ALTER TABLE companies
  ALTER COLUMN company_name DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS companies_company_name_check,
  DROP CONSTRAINT IF EXISTS companies_company_name_not_blank;

ALTER TABLE companies
  ADD CONSTRAINT companies_company_name_not_blank
  CHECK (company_name IS NULL OR length(btrim(company_name)) > 0)
  NOT VALID;

ALTER TABLE companies
  VALIDATE CONSTRAINT companies_company_name_not_blank;

CREATE TABLE IF NOT EXISTS departments (
  department_code integer PRIMARY KEY CHECK (department_code > 0),
  department_name text NOT NULL CHECK (length(btrim(department_name)) > 0),
  active boolean NOT NULL DEFAULT true,
  legacy_uuid text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE departments IS 'Legacy M部門. Optional in this bounded context but kept because T切手出納台帳 has 部門CD.';

CREATE TABLE IF NOT EXISTS employees (
  employee_no integer PRIMARY KEY CHECK (employee_no > 0),
  employee_name text NOT NULL CHECK (length(btrim(employee_name)) > 0),
  company_code integer REFERENCES companies(company_code),
  department_code integer REFERENCES departments(department_code),
  branch_code integer REFERENCES branches(branch_code),
  account_name text,
  is_approver boolean NOT NULL DEFAULT false,
  is_admin boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  retired_on date,
  legacy_uuid text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE employees IS 'Legacy 各種マスター::M社員. Referenced by 担当者CD / 登録担当CD / 更新担当CD.';

CREATE TABLE IF NOT EXISTS entry_types (
  code integer PRIMARY KEY,
  name_japanese text NOT NULL CHECK (length(btrim(name_japanese)) > 0),
  abbreviation text,
  effect text NOT NULL CHECK (effect IN (
    'opening_balance',
    'incoming',
    'outgoing',
    'inventory_check',
    'non_posting'
  )),
  requires_nonzero_amount boolean NOT NULL DEFAULT false,
  is_legacy_carry boolean NOT NULL DEFAULT false,
  notes text
);

COMMENT ON TABLE entry_types IS 'Legacy M入出区分. effect determines the ledger delta sign.';
COMMENT ON COLUMN entry_types.effect IS 'opening_balance/incoming/outgoing add to or subtract from balance; inventory_check/non_posting do not affect balance.';

CREATE TABLE IF NOT EXISTS transaction_categories (
  code integer PRIMARY KEY,
  name_japanese text NOT NULL CHECK (length(btrim(name_japanese)) > 0),
  abbreviation text,
  requires_counterparty_branch boolean NOT NULL DEFAULT false,
  selectable boolean NOT NULL DEFAULT true,
  notes text
);

COMMENT ON TABLE transaction_categories IS 'Legacy M出納区分. FileMaker shows 入出拠点CD only when 出納区分CD = 1.';

CREATE TABLE IF NOT EXISTS red_voucher_statuses (
  code integer PRIMARY KEY,
  name_japanese text NOT NULL CHECK (length(btrim(name_japanese)) > 0),
  abbreviation text,
  notes text
);

COMMENT ON TABLE red_voucher_statuses IS 'Legacy M赤伝票. 0 is added for normal rows; FileMaker normal value may be blank.';

CREATE TABLE IF NOT EXISTS denominations (
  denomination_yen integer PRIMARY KEY CHECK (denomination_yen > 0),
  legacy_repetition_no integer NOT NULL UNIQUE CHECK (legacy_repetition_no BETWEEN 1 AND 16),
  display_order integer NOT NULL UNIQUE CHECK (display_order > 0),
  active boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE denominations IS 'Stamp/voucher denominations. legacy_repetition_no maps FileMaker 枚数N[1..16].';

-- -----------------------------------------------------------------------------
-- Ledger entries
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS voucher_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Legacy identifiers
  legacy_uuid text UNIQUE,
  ledger_no bigint NOT NULL UNIQUE DEFAULT nextval('voucher_ledger_no_seq'), -- 出納No

  -- Scope/date
  branch_code integer NOT NULL REFERENCES branches(branch_code),             -- 拠点CD
  department_code integer REFERENCES departments(department_code),           -- 部門CD
  application_date date,                                                     -- 申請処理日
  processing_date date NOT NULL,                                             -- 処理日
  daily_sequence integer NOT NULL CHECK (daily_sequence >= 0),               -- 連番

  -- Classification
  entry_type_code integer NOT NULL REFERENCES entry_types(code),             -- 入出区分CD
  transaction_category_code integer REFERENCES transaction_categories(code),  -- 出納区分CD
  counterparty_branch_code integer REFERENCES branches(branch_code),         -- 入出拠点CD
  status_code integer,                                                       -- 状態CD

  -- Party/content
  company_code integer REFERENCES companies(company_code),                   -- 出納帰属先会社CD
  responsible_employee_no integer REFERENCES employees(employee_no),          -- 担当者CD
  description text NOT NULL CHECK (length(btrim(description)) > 0),           -- 摘要
  remarks text,                                                              -- 備考

  -- Amount/other value. Denomination quantities are in voucher_ledger_entry_denominations.
  other_amount bigint NOT NULL DEFAULT 0,                                    -- その他金額
  other_amount_note text,                                                    -- その他金額備考

  -- 赤伝票 / 訂正 links
  red_voucher_status_code integer NOT NULL DEFAULT 0 REFERENCES red_voucher_statuses(code),
  original_ledger_no bigint REFERENCES voucher_ledger_entries(ledger_no) DEFERRABLE INITIALLY DEFERRED,
  reversal_ledger_no bigint REFERENCES voucher_ledger_entries(ledger_no) DEFERRABLE INITIALLY DEFERRED,
  correction_ledger_no bigint REFERENCES voucher_ledger_entries(ledger_no) DEFERRABLE INITIALLY DEFERRED,

  -- Deletion/commit/audit
  is_deleted boolean NOT NULL DEFAULT false,                                  -- Is削除
  legacy_registered_button_clicked boolean NOT NULL DEFAULT true,             -- 登録ボタンクリックフラグ

  -- registered_at/by preserve FileMaker 登録日時/登録担当CD semantics.
  registered_at timestamptz NOT NULL DEFAULT now(),
  registered_by_employee_no integer REFERENCES employees(employee_no),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_employee_no integer REFERENCES employees(employee_no),

  -- posted_at is the domain immutability boundary. Insert draft -> insert quantities -> set posted_at.
  posted_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),

  CHECK (counterparty_branch_code IS NULL OR counterparty_branch_code <> branch_code),
  CHECK (posted_at IS NULL OR registered_at IS NOT NULL)
);

ALTER TABLE voucher_ledger_entries
  DROP CONSTRAINT IF EXISTS voucher_ledger_entries_other_amount_check;

ALTER TABLE voucher_ledger_entries
  DROP COLUMN IF EXISTS period_year,
  DROP COLUMN IF EXISTS period_month,
  DROP COLUMN IF EXISTS filemaker_login_employee_no,
  DROP COLUMN IF EXISTS filemaker_login_employee_name,
  DROP COLUMN IF EXISTS filemaker_created_at,
  DROP COLUMN IF EXISTS filemaker_created_by,
  DROP COLUMN IF EXISTS filemaker_modified_at,
  DROP COLUMN IF EXISTS filemaker_modified_by;

COMMENT ON TABLE voucher_ledger_entries IS 'Source-of-truth ledger rows migrated from T切手出納台帳 / T金券管理台帳.';
COMMENT ON COLUMN voucher_ledger_entries.ledger_no IS 'Legacy 出納No. Currently treated as globally unique. (branch_code, ledger_no) is also indexed to make the branch-scoped legacy identity explicit.';
COMMENT ON COLUMN voucher_ledger_entries.daily_sequence IS 'Legacy 連番. Not unique: 赤伝票/correction rows may duplicate the original legacy sequence.';
COMMENT ON COLUMN voucher_ledger_entries.posted_at IS 'When set, financial fields and denomination rows are immutable; correction must use 赤伝票.';

CREATE INDEX IF NOT EXISTS idx_voucher_entries_branch_ledger_no
  ON voucher_ledger_entries(branch_code, ledger_no);

CREATE UNIQUE INDEX IF NOT EXISTS uq_voucher_entries_branch_ledger_no
  ON voucher_ledger_entries(branch_code, ledger_no);

CREATE INDEX IF NOT EXISTS idx_voucher_entries_branch_processing_date
  ON voucher_ledger_entries(branch_code, processing_date, daily_sequence, ledger_no);

DROP INDEX IF EXISTS idx_voucher_entries_period;

CREATE INDEX IF NOT EXISTS idx_voucher_entries_red_links
  ON voucher_ledger_entries(original_ledger_no, reversal_ledger_no, correction_ledger_no);

DROP INDEX IF EXISTS uq_voucher_opening_balance_per_branch;
DROP INDEX IF EXISTS uq_voucher_opening_balance_per_branch_period;
CREATE INDEX IF NOT EXISTS idx_voucher_opening_balance_lookup
  ON voucher_ledger_entries(branch_code, ledger_no)
  WHERE entry_type_code = 99 AND is_deleted = false;

CREATE TABLE IF NOT EXISTS voucher_ledger_entry_denominations (
  entry_id uuid NOT NULL REFERENCES voucher_ledger_entries(id) ON DELETE CASCADE,
  denomination_yen integer NOT NULL REFERENCES denominations(denomination_yen),
  quantity integer NOT NULL DEFAULT 0,
  PRIMARY KEY (entry_id, denomination_yen)
);

ALTER TABLE voucher_ledger_entry_denominations
  DROP CONSTRAINT IF EXISTS voucher_ledger_entry_denominations_quantity_check;

COMMENT ON TABLE voucher_ledger_entry_denominations IS 'Normalized replacement for FileMaker repeating field 枚数N[1..16].';

CREATE INDEX IF NOT EXISTS idx_voucher_entry_denominations_denomination
  ON voucher_ledger_entry_denominations(denomination_yen);

CREATE TABLE IF NOT EXISTS voucher_ledger_entry_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES voucher_ledger_entries(id) ON DELETE CASCADE,
  file_name text,
  mime_type text,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE voucher_ledger_entry_attachments IS 'Optional replacement for FileMaker T切手出納台帳::画像.';

-- -----------------------------------------------------------------------------
-- Generic audit trigger
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('voucher_ledger.legacy_import', true) = 'on' THEN
    RETURN NEW;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branches_updated_at ON branches;
CREATE TRIGGER trg_branches_updated_at
BEFORE UPDATE ON branches
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
BEFORE UPDATE ON companies
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_departments_updated_at ON departments;
CREATE TRIGGER trg_departments_updated_at
BEFORE UPDATE ON departments
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_employees_updated_at ON employees;
CREATE TRIGGER trg_employees_updated_at
BEFORE UPDATE ON employees
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_voucher_entries_updated_at ON voucher_ledger_entries;
CREATE TRIGGER trg_voucher_entries_updated_at
BEFORE UPDATE ON voucher_ledger_entries
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

-- -----------------------------------------------------------------------------
-- Business-rule triggers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION voucher_ledger_validate_entry_master_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  category_requires_counterparty boolean;
BEGIN
  IF NEW.transaction_category_code IS NOT NULL THEN
    SELECT requires_counterparty_branch
      INTO category_requires_counterparty
      FROM transaction_categories
     WHERE code = NEW.transaction_category_code;

    IF category_requires_counterparty IS NULL THEN
      RAISE EXCEPTION 'Unknown transaction_category_code: %', NEW.transaction_category_code;
    END IF;

    IF category_requires_counterparty AND NEW.counterparty_branch_code IS NULL THEN
      RAISE EXCEPTION 'counterparty_branch_code is required when transaction_category_code=%', NEW.transaction_category_code;
    END IF;
  END IF;

  IF NEW.red_voucher_status_code = 0 THEN
    IF NEW.original_ledger_no IS NOT NULL THEN
      RAISE EXCEPTION 'Normal rows must not have original_ledger_no';
    END IF;
  ELSIF NEW.red_voucher_status_code IN (2, 3) THEN
    IF NEW.original_ledger_no IS NULL THEN
      RAISE EXCEPTION '赤伝票 / 訂正伝票 rows must have original_ledger_no';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_entries_validate_master_rules ON voucher_ledger_entries;
CREATE TRIGGER trg_voucher_entries_validate_master_rules
BEFORE INSERT OR UPDATE ON voucher_ledger_entries
FOR EACH ROW EXECUTE FUNCTION voucher_ledger_validate_entry_master_rules();

CREATE OR REPLACE FUNCTION voucher_ledger_validate_entry_amount()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.other_amount >= 0
     OR NEW.entry_type_code = 6
     OR current_setting('voucher_ledger.legacy_import', true) = 'on' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'other_amount must be non-negative except for inventory-check observations and legacy import.';
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_entries_validate_amount ON voucher_ledger_entries;
CREATE TRIGGER trg_voucher_entries_validate_amount
BEFORE INSERT OR UPDATE ON voucher_ledger_entries
FOR EACH ROW EXECUTE FUNCTION voucher_ledger_validate_entry_amount();

CREATE OR REPLACE FUNCTION voucher_ledger_prevent_posted_entry_financial_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('voucher_ledger.legacy_import', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF OLD.posted_at IS NOT NULL THEN
    IF ROW(
      OLD.branch_code,
      OLD.department_code,
      OLD.application_date,
      OLD.processing_date,
      OLD.daily_sequence,
      OLD.entry_type_code,
      OLD.transaction_category_code,
      OLD.counterparty_branch_code,
      OLD.status_code,
      OLD.company_code,
      OLD.responsible_employee_no,
      OLD.description,
      OLD.remarks,
      OLD.other_amount,
      OLD.other_amount_note
    ) IS DISTINCT FROM ROW(
      NEW.branch_code,
      NEW.department_code,
      NEW.application_date,
      NEW.processing_date,
      NEW.daily_sequence,
      NEW.entry_type_code,
      NEW.transaction_category_code,
      NEW.counterparty_branch_code,
      NEW.status_code,
      NEW.company_code,
      NEW.responsible_employee_no,
      NEW.description,
      NEW.remarks,
      NEW.other_amount,
      NEW.other_amount_note
    ) THEN
      RAISE EXCEPTION 'Posted voucher ledger entries are immutable. Use 赤伝票/correction instead.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_entries_prevent_posted_financial_mutation ON voucher_ledger_entries;
CREATE TRIGGER trg_voucher_entries_prevent_posted_financial_mutation
BEFORE UPDATE ON voucher_ledger_entries
FOR EACH ROW EXECUTE FUNCTION voucher_ledger_prevent_posted_entry_financial_mutation();

CREATE OR REPLACE FUNCTION voucher_ledger_prevent_posted_denomination_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_posted_at timestamptz;
  parent_id uuid;
BEGIN
  parent_id := COALESCE(NEW.entry_id, OLD.entry_id);

  SELECT posted_at
    INTO parent_posted_at
    FROM voucher_ledger_entries
   WHERE id = parent_id;

  IF parent_posted_at IS NOT NULL
     AND current_setting('voucher_ledger.legacy_import', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Posted voucher ledger denomination rows are immutable. Use 赤伝票/correction instead.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_denominations_prevent_posted_mutation ON voucher_ledger_entry_denominations;
CREATE TRIGGER trg_voucher_denominations_prevent_posted_mutation
BEFORE INSERT OR UPDATE OR DELETE ON voucher_ledger_entry_denominations
FOR EACH ROW EXECUTE FUNCTION voucher_ledger_prevent_posted_denomination_mutation();

CREATE OR REPLACE FUNCTION voucher_ledger_validate_denomination_quantity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_entry_type_code integer;
BEGIN
  IF NEW.quantity >= 0
     OR current_setting('voucher_ledger.legacy_import', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT entry_type_code
    INTO parent_entry_type_code
    FROM voucher_ledger_entries
   WHERE id = NEW.entry_id;

  IF parent_entry_type_code IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'Denomination quantity must be non-negative except for inventory-check observations.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_denominations_validate_quantity ON voucher_ledger_entry_denominations;
CREATE TRIGGER trg_voucher_denominations_validate_quantity
BEFORE INSERT OR UPDATE ON voucher_ledger_entry_denominations
FOR EACH ROW EXECUTE FUNCTION voucher_ledger_validate_denomination_quantity();

CREATE OR REPLACE FUNCTION voucher_ledger_validate_before_posting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entry_effect text;
  amount_required boolean;
  entered_total_amount bigint;
  existing_opening_count integer;
BEGIN
  -- Only validate when transitioning from draft to posted.
  IF NEW.posted_at IS NULL OR OLD.posted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT effect, requires_nonzero_amount
    INTO entry_effect, amount_required
    FROM entry_types
   WHERE code = NEW.entry_type_code;

  IF entry_effect IS NULL THEN
    RAISE EXCEPTION 'Unknown entry_type_code: %', NEW.entry_type_code;
  END IF;

  SELECT COALESCE(SUM(d.quantity::bigint * d.denomination_yen::bigint), 0)
    INTO entered_total_amount
    FROM voucher_ledger_entry_denominations d
   WHERE d.entry_id = NEW.id;

  entered_total_amount := entered_total_amount + NEW.other_amount;

  IF amount_required AND entered_total_amount <= 0 THEN
    RAISE EXCEPTION '切手の枚数またはその他金額を入力してください (entry_type_code=%)', NEW.entry_type_code;
  END IF;

  IF entry_effect IN ('incoming', 'outgoing', 'inventory_check') THEN
    SELECT count(*)
      INTO existing_opening_count
      FROM voucher_ledger_entries e
     WHERE e.branch_code = NEW.branch_code
       AND e.entry_type_code = 99
       AND e.is_deleted = false
       AND e.posted_at IS NOT NULL;

    IF existing_opening_count = 0 THEN
      RAISE EXCEPTION 'Opening balance must be posted before entry_type_code=% for branch_code=%', NEW.entry_type_code, NEW.branch_code;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voucher_entries_validate_before_posting ON voucher_ledger_entries;
CREATE TRIGGER trg_voucher_entries_validate_before_posting
BEFORE UPDATE OF posted_at ON voucher_ledger_entries
FOR EACH ROW EXECUTE FUNCTION voucher_ledger_validate_before_posting();

COMMIT;
