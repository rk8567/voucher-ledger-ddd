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
  company_name text NOT NULL CHECK (length(btrim(company_name)) > 0),
  official_name text,
  abbreviation text,
  legacy_uuid text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE companies IS 'Legacy 各種マスター::M会社.';

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
  period_year smallint CHECK (period_year BETWEEN 1900 AND 2200),            -- 年
  period_month smallint CHECK (period_month BETWEEN 1 AND 12),               -- 月
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

  -- FileMaker internal audit fields, if imported.
  filemaker_created_at timestamptz,
  filemaker_created_by text,
  filemaker_modified_at timestamptz,
  filemaker_modified_by text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CHECK (counterparty_branch_code IS NULL OR counterparty_branch_code <> branch_code),
  CHECK (posted_at IS NULL OR registered_at IS NOT NULL)
);

ALTER TABLE voucher_ledger_entries
  DROP CONSTRAINT IF EXISTS voucher_ledger_entries_other_amount_check;

COMMENT ON TABLE voucher_ledger_entries IS 'Source-of-truth ledger rows migrated from T切手出納台帳 / T金券管理台帳.';
COMMENT ON COLUMN voucher_ledger_entries.ledger_no IS 'Legacy 出納No. Use voucher_ledger_no_seq for new rows; reset sequence after importing legacy rows.';
COMMENT ON COLUMN voucher_ledger_entries.daily_sequence IS 'Legacy 連番. Not unique: 赤伝票/correction rows may duplicate the original legacy sequence.';
COMMENT ON COLUMN voucher_ledger_entries.posted_at IS 'When set, financial fields and denomination rows are immutable; correction must use 赤伝票.';

CREATE INDEX IF NOT EXISTS idx_voucher_entries_branch_ledger_no
  ON voucher_ledger_entries(branch_code, ledger_no);

CREATE INDEX IF NOT EXISTS idx_voucher_entries_branch_processing_date
  ON voucher_ledger_entries(branch_code, processing_date, daily_sequence, ledger_no);

CREATE INDEX IF NOT EXISTS idx_voucher_entries_period
  ON voucher_ledger_entries(branch_code, period_year, period_month, ledger_no);

CREATE INDEX IF NOT EXISTS idx_voucher_entries_red_links
  ON voucher_ledger_entries(original_ledger_no, reversal_ledger_no, correction_ledger_no);

DROP INDEX IF EXISTS uq_voucher_opening_balance_per_branch;
DROP INDEX IF EXISTS uq_voucher_opening_balance_per_branch_period;
CREATE INDEX IF NOT EXISTS idx_voucher_opening_balance_lookup
  ON voucher_ledger_entries(branch_code, period_year, period_month, ledger_no)
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

CREATE OR REPLACE FUNCTION voucher_ledger_prevent_posted_entry_financial_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.posted_at IS NOT NULL THEN
    IF ROW(
      OLD.branch_code,
      OLD.department_code,
      OLD.period_year,
      OLD.period_month,
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
      NEW.period_year,
      NEW.period_month,
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
    RAISE EXCEPTION 'Amount or denomination quantity is required for entry_type_code=%', NEW.entry_type_code;
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
-- Seed legacy code tables inferred from FileMaker calculations/scripts.
-- Replace names with exact exported FileMaker master rows when available.

BEGIN;

INSERT INTO denominations (denomination_yen, legacy_repetition_no, display_order, active) VALUES
  (1,   1,  1, true),
  (2,   2,  2, true),
  (10,  3,  3, true),
  (50,  4,  4, true),
  (84,  5,  5, true),
  (94,  6,  6, true),
  (120, 7,  7, true),
  (140, 8,  8, true),
  (210, 9,  9, true),
  (5,   10, 10, true),
  (20,  11, 11, true),
  (52,  12, 12, true),
  (110, 13, 13, true),
  (270, 14, 14, true),
  (430, 15, 15, true),
  (600, 16, 16, true)
ON CONFLICT (denomination_yen) DO UPDATE SET
  legacy_repetition_no = EXCLUDED.legacy_repetition_no,
  display_order = EXCLUDED.display_order,
  active = EXCLUDED.active;

INSERT INTO entry_types (
  code,
  name_japanese,
  abbreviation,
  effect,
  requires_nonzero_amount,
  is_legacy_carry,
  notes
) VALUES
  (1,  '前葉より繰越',         '前繰', 'non_posting',     false, true,  '月初処理 creates this row; legacy 本日残 calculation does not count it.'),
  (2,  '入庫/補充',            '入',   'incoming',        true,  false, 'Is入金=1 in FileMaker.'),
  (3,  '出庫/使用',            '出',   'outgoing',        true,  false, 'Is出金=1 in FileMaker. New normal record defaults to this code.'),
  (4,  '入庫/補充2',           '入2',  'incoming',        true,  false, 'Included because Is入金=1 for code 4. Replace name with exported M入出区分::内容.'),
  (5,  '出庫/使用2',           '出2',  'outgoing',        true,  false, 'Included because Is出金=1 for code 5. Replace name with exported M入出区分::内容.'),
  (6,  '現在有り高チェック',   '実査', 'inventory_check', true,  false, 'Does not change running balance; compares actual vs expected.'),
  (9,  '次葉へ繰越',           '次繰', 'non_posting',     false, true,  '月初処理 creates this row; legacy 本日残 calculation does not count it.'),
  (99, '開始時残高',           '開始', 'opening_balance', true,  false, 'Legacy Get繰越データ件数 searches 拠点CD + 入出区分CD=99.')
ON CONFLICT (code) DO UPDATE SET
  name_japanese = EXCLUDED.name_japanese,
  abbreviation = EXCLUDED.abbreviation,
  effect = EXCLUDED.effect,
  requires_nonzero_amount = EXCLUDED.requires_nonzero_amount,
  is_legacy_carry = EXCLUDED.is_legacy_carry,
  notes = EXCLUDED.notes;

INSERT INTO transaction_categories (
  code,
  name_japanese,
  abbreviation,
  requires_counterparty_branch,
  selectable,
  notes
) VALUES
  (1, '拠点間移動', '移動', true,  true, 'FileMaker shows 入出拠点CD when 出納区分CD=1.'),
  (9, '通常/その他', '通常', false, true, 'New normal record script defaults 出納区分CD to 9.')
ON CONFLICT (code) DO UPDATE SET
  name_japanese = EXCLUDED.name_japanese,
  abbreviation = EXCLUDED.abbreviation,
  requires_counterparty_branch = EXCLUDED.requires_counterparty_branch,
  selectable = EXCLUDED.selectable,
  notes = EXCLUDED.notes;

INSERT INTO red_voucher_statuses (code, name_japanese, abbreviation, notes) VALUES
  (0, '通常',     '通常', 'Added for explicit representation of blank legacy value.'),
  (1, '元伝票',   '元',   'Original row marked after 赤伝票 issuance.'),
  (2, '赤伝票',   '赤',   'Compensating reversal row.'),
  (3, '訂正伝票', '訂',   'Corrected replacement row.')
ON CONFLICT (code) DO UPDATE SET
  name_japanese = EXCLUDED.name_japanese,
  abbreviation = EXCLUDED.abbreviation,
  notes = EXCLUDED.notes;

COMMIT;
-- Derived read models replacing FileMaker calculated and summary fields.

BEGIN;

CREATE OR REPLACE VIEW voucher_ledger_entry_totals AS
SELECT
  e.id AS entry_id,
  e.ledger_no,
  e.branch_code,
  COALESCE(SUM(q.quantity), 0)::bigint AS stamp_quantity_total,             -- 枚数合計
  COALESCE(SUM(q.quantity::bigint * q.denomination_yen::bigint), 0)::bigint AS stamp_amount_total, -- 切手金額合計
  e.other_amount,
  (COALESCE(SUM(q.quantity::bigint * q.denomination_yen::bigint), 0) + e.other_amount)::bigint AS total_amount -- 金額合計
FROM voucher_ledger_entries e
LEFT JOIN voucher_ledger_entry_denominations q ON q.entry_id = e.id
GROUP BY e.id, e.ledger_no, e.branch_code, e.other_amount;

COMMENT ON VIEW voucher_ledger_entry_totals IS 'Derived replacement for 枚数合計 / 切手金額合計 / 金額合計.';

CREATE OR REPLACE VIEW voucher_ledger_entry_denomination_deltas AS
SELECT
  e.id AS entry_id,
  e.ledger_no,
  e.branch_code,
  e.processing_date,
  e.daily_sequence,
  e.entry_type_code,
  et.effect,
  d.denomination_yen,
  COALESCE(q.quantity, 0)::bigint AS entered_quantity,
  CASE et.effect
    WHEN 'opening_balance' THEN COALESCE(q.quantity, 0)::bigint
    WHEN 'incoming'        THEN COALESCE(q.quantity, 0)::bigint
    WHEN 'outgoing'        THEN -COALESCE(q.quantity, 0)::bigint
    ELSE 0::bigint
  END AS delta_quantity
FROM voucher_ledger_entries e
JOIN entry_types et ON et.code = e.entry_type_code
CROSS JOIN denominations d
LEFT JOIN voucher_ledger_entry_denominations q
  ON q.entry_id = e.id
 AND q.denomination_yen = d.denomination_yen
WHERE e.is_deleted = false
  AND e.posted_at IS NOT NULL;

COMMENT ON VIEW voucher_ledger_entry_denomination_deltas IS 'Derived replacement for 補充枚数N / 使用枚数N / 本日残N.';

CREATE OR REPLACE VIEW voucher_ledger_entry_other_amount_deltas AS
SELECT
  e.id AS entry_id,
  e.ledger_no,
  e.branch_code,
  e.processing_date,
  e.daily_sequence,
  e.entry_type_code,
  et.effect,
  e.other_amount AS entered_other_amount,
  CASE et.effect
    WHEN 'opening_balance' THEN e.other_amount
    WHEN 'incoming'        THEN e.other_amount
    WHEN 'outgoing'        THEN -e.other_amount
    ELSE 0::bigint
  END AS delta_other_amount
FROM voucher_ledger_entries e
JOIN entry_types et ON et.code = e.entry_type_code
WHERE e.is_deleted = false
  AND e.posted_at IS NOT NULL;

COMMENT ON VIEW voucher_ledger_entry_other_amount_deltas IS 'Derived replacement for 補充その他金額 / 使用その他金額 / 本日残その他.';

CREATE OR REPLACE VIEW voucher_ledger_running_denominations AS
SELECT
  d.entry_id,
  d.ledger_no,
  d.branch_code,
  d.processing_date,
  d.daily_sequence,
  d.denomination_yen,
  d.entered_quantity,
  d.delta_quantity,
  SUM(d.delta_quantity) OVER (
    PARTITION BY d.branch_code, d.denomination_yen
    ORDER BY d.ledger_no
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_quantity
FROM voucher_ledger_entry_denomination_deltas d;

COMMENT ON VIEW voucher_ledger_running_denominations IS 'Deterministic replacement for FileMaker 推定残* summary fields, ordered by 出納No.';

CREATE OR REPLACE VIEW voucher_ledger_running_other_amounts AS
SELECT
  o.entry_id,
  o.ledger_no,
  o.branch_code,
  o.processing_date,
  o.daily_sequence,
  o.entered_other_amount,
  o.delta_other_amount,
  SUM(o.delta_other_amount) OVER (
    PARTITION BY o.branch_code
    ORDER BY o.ledger_no
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_other_amount
FROM voucher_ledger_entry_other_amount_deltas o;

COMMENT ON VIEW voucher_ledger_running_other_amounts IS 'Deterministic replacement for 推定残その他金額.';

CREATE OR REPLACE VIEW voucher_ledger_running_amounts AS
WITH stamp_balance AS (
  SELECT
    entry_id,
    ledger_no,
    branch_code,
    SUM(running_quantity * denomination_yen)::bigint AS running_stamp_amount,
    SUM(running_quantity)::bigint AS running_stamp_quantity
  FROM voucher_ledger_running_denominations
  GROUP BY entry_id, ledger_no, branch_code
)
SELECT
  s.entry_id,
  s.ledger_no,
  s.branch_code,
  s.running_stamp_quantity,  -- 推定残枚数合計
  s.running_stamp_amount,    -- 推定残切手金額合計
  o.running_other_amount,    -- 推定残その他金額
  (s.running_stamp_amount + o.running_other_amount)::bigint AS running_total_amount -- 残高合計
FROM stamp_balance s
JOIN voucher_ledger_running_other_amounts o
  ON o.entry_id = s.entry_id;

COMMENT ON VIEW voucher_ledger_running_amounts IS 'Derived replacement for 推定残枚数合計 / 推定残切手金額合計 / 残高合計.';

CREATE OR REPLACE VIEW voucher_inventory_check_results AS
SELECT
  e.id AS entry_id,
  e.ledger_no,
  e.branch_code,
  t.total_amount AS actual_total_amount,       -- 実残高
  r.running_total_amount AS expected_total_amount, -- 残高合計 at the inventory-check row; check row has zero delta
  (t.total_amount - r.running_total_amount)::bigint AS discrepancy_amount -- 差異
FROM voucher_ledger_entries e
JOIN voucher_ledger_entry_totals t ON t.entry_id = e.id
JOIN voucher_ledger_running_amounts r ON r.entry_id = e.id
WHERE e.entry_type_code = 6
  AND e.is_deleted = false
  AND e.posted_at IS NOT NULL;

COMMENT ON VIEW voucher_inventory_check_results IS 'Derived replacement for 実残高 / 差異 on 入出区分CD=6 rows.';

CREATE OR REPLACE VIEW voucher_inventory_check_denomination_results AS
SELECT
  e.id AS entry_id,
  e.ledger_no,
  e.branch_code,
  d.denomination_yen,
  COALESCE(q.quantity, 0)::bigint AS actual_quantity,
  r.running_quantity AS expected_quantity,
  (COALESCE(q.quantity, 0)::bigint - r.running_quantity)::bigint AS discrepancy_quantity
FROM voucher_ledger_entries e
CROSS JOIN denominations d
LEFT JOIN voucher_ledger_entry_denominations q
  ON q.entry_id = e.id
 AND q.denomination_yen = d.denomination_yen
JOIN voucher_ledger_running_denominations r
  ON r.entry_id = e.id
 AND r.denomination_yen = d.denomination_yen
WHERE e.entry_type_code = 6
  AND e.is_deleted = false
  AND e.posted_at IS NOT NULL;

COMMENT ON VIEW voucher_inventory_check_denomination_results IS 'Per-denomination inventory discrepancy, equivalent to FileMaker conditional formatting 推定残X <> 枚数N[i].';

COMMIT;
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

-- After transforming legacy rows into voucher_ledger_entries, run db/migrations/005_transform_staging_to_ledger.sql

COMMIT;
