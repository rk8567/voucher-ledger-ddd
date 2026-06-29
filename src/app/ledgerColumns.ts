import type { LedgerEntryRecord, LedgerEntrySortKey } from '@/application/repositories/VoucherLedgerRepository';
import type { LedgerFormOptions } from '@/server/ledger';

type LedgerColumnKey = keyof LedgerEntryRecord | 'otherAmountYen';
type LedgerColumnBase = Readonly<{
  key: LedgerColumnKey;
  label: string;
  kind: 'text' | 'integer' | 'money' | 'date' | 'year' | 'month' | 'datetime';
  optionsKey?: keyof LedgerFormOptions | 'deleted';
  defaultVisible?: boolean;
}>;

export type LedgerColumnDefinition = LedgerColumnBase & (
  | Readonly<{ key: LedgerEntrySortKey; sortable: true }>
  | Readonly<{ key: LedgerColumnKey; sortable?: false }>
);

type SortableLedgerColumn = Extract<LedgerColumnDefinition, Readonly<{ sortable: true }>>;

export const ledgerColumns: readonly LedgerColumnDefinition[] = [
  { key: 'ledgerNo', label: '出納No', kind: 'integer', defaultVisible: true, sortable: true },
  { key: 'processingDate', label: '処理日', kind: 'date', defaultVisible: true, sortable: true },
  { key: 'branchName', label: '拠点', kind: 'text', optionsKey: 'branches', defaultVisible: true, sortable: true },
  { key: 'entryTypeName', label: '区分', kind: 'text', optionsKey: 'entryTypes', defaultVisible: true, sortable: true },
  { key: 'responsibleEmployeeName', label: '担当', kind: 'text', optionsKey: 'employees', defaultVisible: true, sortable: true },
  { key: 'description', label: '摘要', kind: 'text', defaultVisible: true, sortable: true },
  { key: 'otherAmountYen', label: 'その他', kind: 'money', defaultVisible: true, sortable: true },
  { key: 'applicationDate', label: '申請処理日', kind: 'date' },
  { key: 'departmentName', label: '部門', kind: 'text', optionsKey: 'departments' },
  { key: 'periodYear', label: '年', kind: 'year' },
  { key: 'periodMonth', label: '月', kind: 'month' },
  { key: 'transactionCategoryName', label: '出納区分', kind: 'text', optionsKey: 'transactionCategories' },
  { key: 'counterpartyBranchName', label: '入出拠点', kind: 'text', optionsKey: 'branches' },
  { key: 'companyName', label: '会社', kind: 'text', optionsKey: 'companies' },
  { key: 'remarks', label: '備考', kind: 'text' },
  { key: 'otherAmountNote', label: 'その他金額備考', kind: 'text' },
  { key: 'redVoucherStatusName', label: '赤伝票状態', kind: 'text', optionsKey: 'redVoucherStatuses' },
  { key: 'isDeleted', label: '削除', kind: 'text', optionsKey: 'deleted' },
  { key: 'originalLedgerNo', label: '元伝票No', kind: 'integer' },
  { key: 'reversalLedgerNo', label: '赤伝票No', kind: 'integer' },
  { key: 'correctionLedgerNo', label: '訂正伝票No', kind: 'integer' },
  { key: 'registeredAt', label: '登録日時', kind: 'datetime' },
  { key: 'registeredByEmployeeName', label: '登録者', kind: 'text', optionsKey: 'employees' },
  { key: 'updatedAt', label: '更新日時', kind: 'datetime' },
  { key: 'updatedByEmployeeName', label: '更新者', kind: 'text', optionsKey: 'employees' },
  { key: 'postedAt', label: '登録済', kind: 'datetime' },
  { key: 'createdAt', label: '作成日時', kind: 'datetime' },
];

export const defaultLedgerColumnKeys = ledgerColumns
  .filter((column) => column.defaultVisible)
  .map((column) => column.key);

export const ledgerSortableKeys = ledgerColumns
  .filter((column): column is SortableLedgerColumn => column.sortable === true)
  .map((column) => column.key);
