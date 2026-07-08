import type { LedgerEntryRecord, LedgerEntrySortKey } from '@/application/repositories/VoucherLedgerRepository';
import type { LedgerFormOptions } from '@/server/ledger';

export type LedgerColumnKey = keyof LedgerEntryRecord | 'otherAmountYen';
type LedgerColumnBase = Readonly<{
  key: LedgerColumnKey;
  label: string;
  kind: 'text' | 'integer' | 'money' | 'date' | 'datetime';
  optionsKey?: keyof LedgerFormOptions;
  defaultVisible?: boolean;
  filterable?: boolean;
}>;

export type LedgerColumnDefinition = LedgerColumnBase & (
  | Readonly<{ key: LedgerEntrySortKey; sortable: true }>
  | Readonly<{ key: LedgerColumnKey; sortable?: false }>
);

type SortableLedgerColumn = Extract<LedgerColumnDefinition, Readonly<{ sortable: true }>>;

export const ledgerColumns: readonly LedgerColumnDefinition[] = [
  { key: 'ledgerNo', label: '出納No', kind: 'integer', defaultVisible: true, sortable: true },
  { key: 'processingDate', label: '処理日', kind: 'date', defaultVisible: true, sortable: true },
  { key: 'entryTypeName', label: '区分', kind: 'text', optionsKey: 'entryTypes', defaultVisible: true, sortable: true },
  { key: 'responsibleEmployeeName', label: '担当', kind: 'text', optionsKey: 'employees', defaultVisible: true, sortable: true },
  { key: 'description', label: '摘要', kind: 'text', defaultVisible: true, sortable: true },
  { key: 'otherAmountYen', label: 'その他', kind: 'money', defaultVisible: true, sortable: true },
  { key: 'applicationDate', label: '申請処理日', kind: 'date', sortable: true },
  { key: 'departmentName', label: '部門', kind: 'text', optionsKey: 'departments', sortable: true },
  { key: 'transactionCategoryName', label: '出納区分', kind: 'text', optionsKey: 'transactionCategories', sortable: true },
  { key: 'counterpartyBranchName', label: '入出拠点', kind: 'text', optionsKey: 'branches', sortable: true },
  { key: 'companyCode', label: '会社CD', kind: 'integer', sortable: true },
  { key: 'companyName', label: '会社', kind: 'text', optionsKey: 'companies', sortable: true },
  { key: 'remarks', label: '備考', kind: 'text', sortable: true },
  { key: 'otherAmountNote', label: 'その他金額備考', kind: 'text', sortable: true },
  { key: 'redVoucherStatusName', label: '赤伝票状態', kind: 'text', optionsKey: 'redVoucherStatuses', sortable: true },
  { key: 'originalLedgerNo', label: '元伝票No', kind: 'integer', sortable: true },
  { key: 'reversalLedgerNo', label: '赤伝票No', kind: 'integer', sortable: true },
  { key: 'correctionLedgerNo', label: '訂正伝票No', kind: 'integer', sortable: true },
  { key: 'registeredAt', label: '登録日時', kind: 'datetime', sortable: true },
  { key: 'registeredByEmployeeName', label: '登録者', kind: 'text', optionsKey: 'employees', sortable: true },
  { key: 'updatedAt', label: '更新日時', kind: 'datetime', sortable: true },
  { key: 'updatedByEmployeeName', label: '更新者', kind: 'text', optionsKey: 'employees', sortable: true },
  { key: 'postedAt', label: '登録済', kind: 'datetime', sortable: true },
  { key: 'createdAt', label: '作成日時', kind: 'datetime', sortable: true },
];

export const defaultLedgerColumnKeys = ledgerColumns
  .filter((column) => column.defaultVisible)
  .map((column) => column.key);

export const ledgerExportColumns: readonly LedgerColumnDefinition[] = [
  { key: 'branchCode', label: '拠点CD', kind: 'integer' },
  { key: 'branchName', label: '拠点', kind: 'text' },
  ...ledgerColumns,
];

export const defaultLedgerExportColumnKeys = [
  'branchCode',
  'branchName',
  ...defaultLedgerColumnKeys,
] as const;

export const visibleLedgerColumnCookieName = 'voucher-ledger-visible-columns';
export const exportLedgerColumnCookieName = 'voucher-ledger-export-columns';
export const columnOrderLedgerColumnCookieName = 'voucher-ledger-column-order';

export const ledgerColumnKeys = ledgerColumns.map((column) => column.key);
export const ledgerExportColumnKeys = ledgerExportColumns.map((column) => column.key);
const ledgerColumnByKey = new Map<string, LedgerColumnDefinition>(ledgerColumns.map((column) => [String(column.key), column]));
const ledgerExportColumnByKey = new Map<string, LedgerColumnDefinition>(ledgerExportColumns.map((column) => [String(column.key), column]));

export function normalizeLedgerColumnKeys(
  keys: readonly string[] | null | undefined,
  fallback: readonly string[] = defaultLedgerColumnKeys,
): readonly string[] {
  const normalized = orderedValidColumnKeys(keys ?? [], ledgerColumnKeys);
  return normalized.length > 0 ? normalized : orderedValidColumnKeys(fallback, ledgerColumnKeys);
}

export function orderedLedgerColumns(
  keys: readonly string[] | null | undefined,
  fallback: readonly string[] = defaultLedgerColumnKeys,
): readonly LedgerColumnDefinition[] {
  return normalizeLedgerColumnKeys(keys, fallback)
    .map((key) => ledgerColumnByKey.get(key))
    .filter((column): column is LedgerColumnDefinition => column != null);
}

export function normalizeLedgerExportColumnKeys(
  keys: readonly string[] | null | undefined,
  fallback: readonly string[] = defaultLedgerExportColumnKeys,
): readonly string[] {
  const normalized = orderedValidColumnKeys(keys ?? [], ledgerExportColumnKeys);
  return normalized.length > 0 ? normalized : orderedValidColumnKeys(fallback, ledgerExportColumnKeys);
}

export function orderedLedgerExportColumns(
  keys: readonly string[] | null | undefined,
  fallback: readonly string[] = defaultLedgerExportColumnKeys,
): readonly LedgerColumnDefinition[] {
  return normalizeLedgerExportColumnKeys(keys, fallback)
    .map((key) => ledgerExportColumnByKey.get(key))
    .filter((column): column is LedgerColumnDefinition => column != null);
}

export function normalizeLedgerColumnOrder(keys: readonly string[] | null | undefined): readonly string[] {
  const ordered = [...orderedValidColumnKeys(keys ?? [], ledgerColumnKeys)];
  const seen = new Set(ordered);
  for (const key of ledgerColumnKeys.map(String)) {
    if (seen.has(key)) continue;
    ordered.push(key);
    seen.add(key);
  }
  return ordered;
}

function orderedValidColumnKeys(keys: readonly string[], validColumnKeys: readonly string[]): readonly string[] {
  const validKeys = new Set(validColumnKeys.map(String));
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const key of keys) {
    if (!validKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  return ordered;
}

export function parseLedgerColumnCookie(value: string | undefined, fallback: readonly string[] = defaultLedgerColumnKeys): readonly string[] {
  if (!value) return fallback;
  try {
    return normalizeLedgerColumnKeys(value.split(',').map((key) => decodeURIComponent(key)), fallback);
  } catch {
    return fallback;
  }
}

export function parseLedgerExportColumnCookie(value: string | undefined, fallback: readonly string[] = defaultLedgerExportColumnKeys): readonly string[] {
  if (!value) return fallback;
  try {
    return normalizeLedgerExportColumnKeys(value.split(',').map((key) => decodeURIComponent(key)), fallback);
  } catch {
    return fallback;
  }
}

export function parseLedgerColumnOrderCookie(value: string | undefined): readonly string[] {
  if (!value) return normalizeLedgerColumnOrder(ledgerColumnKeys);
  try {
    return normalizeLedgerColumnOrder(value.split(',').map((key) => decodeURIComponent(key)));
  } catch {
    return normalizeLedgerColumnOrder(ledgerColumnKeys);
  }
}

export function serializeLedgerColumnCookie(keys: readonly string[]): string {
  return keys.map((key) => encodeURIComponent(key)).join(',');
}

export const ledgerFilterableKeys = ledgerColumns
  .filter((column) => column.filterable !== false)
  .map((column) => column.key);

export const ledgerSortableKeys = ledgerColumns
  .filter((column): column is SortableLedgerColumn => column.sortable === true)
  .map((column) => column.key);
