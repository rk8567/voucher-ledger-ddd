-- Seed legacy code tables inferred from FileMaker calculations/scripts.
-- Replace names with exact exported FileMaker master rows when available.

BEGIN;

INSERT INTO denominations (denomination_yen, legacy_repetition_no, display_order, active) VALUES
  (1,   1,  1, true),
  (2,   2,  2, true),
  (10,  3,  3, true),
  (50,  4,  4, true),
  (84,  5,  5, false),
  (94,  6,  6, false),
  (120, 7,  7, false),
  (140, 8,  8, true),
  (210, 9,  9, false),
  (5,   10, 10, true),
  (20,  11, 11, true),
  (52,  12, 12, false),
  (110, 13, 13, true),
  (270, 14, 14, false),
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
