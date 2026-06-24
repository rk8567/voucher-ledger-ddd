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
    ORDER BY d.processing_date, d.daily_sequence, d.ledger_no
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_quantity
FROM voucher_ledger_entry_denomination_deltas d;

COMMENT ON VIEW voucher_ledger_running_denominations IS 'Deterministic replacement for FileMaker 推定残* summary fields, ordered by 処理日, 連番, 出納No.';

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
    ORDER BY o.processing_date, o.daily_sequence, o.ledger_no
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
    processing_date,
    daily_sequence,
    SUM(running_quantity * denomination_yen)::bigint AS running_stamp_amount,
    SUM(running_quantity)::bigint AS running_stamp_quantity
  FROM voucher_ledger_running_denominations
  GROUP BY entry_id, ledger_no, branch_code, processing_date, daily_sequence
)
SELECT
  s.entry_id,
  s.ledger_no,
  s.branch_code,
  s.processing_date,
  s.daily_sequence,
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
