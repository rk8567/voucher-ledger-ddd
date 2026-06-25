import { EntryTypeCode } from '@/domain/entryTypes';
import { getLedgerExportEntries, type LedgerSearchInput } from '@/server/ledger';
import type { LedgerEntryRecord } from '@/application/repositories/VoucherLedgerRepository';

const SORT_KEYS = [
  'ledgerNo',
  'processingDate',
  'branchName',
  'entryTypeName',
  'responsibleEmployeeName',
  'description',
  'otherAmountYen',
] as const;

type TableSortKey = NonNullable<LedgerSearchInput['sortKey']>;
type SortDirection = NonNullable<LedgerSearchInput['sortDirection']>;
type ExportFormat = 'csv-comma' | 'csv-tab' | 'html';
type ExportColumn = Readonly<{
  key: keyof LedgerEntryRecord | 'otherAmountYen';
  label: string;
  kind?: 'date' | 'datetime' | 'boolean';
}>;

const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: 'ledgerNo', label: '出納No' },
  { key: 'processingDate', label: '処理日', kind: 'date' },
  { key: 'branchName', label: '拠点' },
  { key: 'entryTypeName', label: '区分' },
  { key: 'responsibleEmployeeName', label: '担当' },
  { key: 'description', label: '摘要' },
  { key: 'otherAmountYen', label: 'その他' },
  { key: 'applicationDate', label: '申請処理日', kind: 'date' },
  { key: 'branchCode', label: '拠点CD' },
  { key: 'departmentCode', label: '部門CD' },
  { key: 'departmentName', label: '部門' },
  { key: 'periodYear', label: '年' },
  { key: 'periodMonth', label: '月' },
  { key: 'entryTypeCode', label: '入出区分CD' },
  { key: 'transactionCategoryCode', label: '出納区分CD' },
  { key: 'transactionCategoryName', label: '出納区分' },
  { key: 'counterpartyBranchCode', label: '入出拠点CD' },
  { key: 'counterpartyBranchName', label: '入出拠点' },
  { key: 'companyCode', label: '会社CD' },
  { key: 'companyName', label: '会社' },
  { key: 'responsibleEmployeeNo', label: '担当者CD' },
  { key: 'remarks', label: '備考' },
  { key: 'otherAmountNote', label: 'その他金額備考' },
  { key: 'redVoucherStatusCode', label: '赤伝票CD' },
  { key: 'redVoucherStatusName', label: '赤伝票状態' },
  { key: 'isDeleted', label: '削除', kind: 'boolean' },
  { key: 'originalLedgerNo', label: '元伝票No' },
  { key: 'reversalLedgerNo', label: '赤伝票No' },
  { key: 'correctionLedgerNo', label: '訂正伝票No' },
  { key: 'registeredAt', label: '登録日時', kind: 'datetime' },
  { key: 'registeredByEmployeeNo', label: '登録者CD' },
  { key: 'registeredByEmployeeName', label: '登録者' },
  { key: 'updatedAt', label: '更新日時', kind: 'datetime' },
  { key: 'updatedByEmployeeNo', label: '更新者CD' },
  { key: 'updatedByEmployeeName', label: '更新者' },
  { key: 'postedAt', label: '登録済', kind: 'datetime' },
  { key: 'filemakerCreatedAt', label: 'FM作成日時', kind: 'datetime' },
  { key: 'filemakerCreatedBy', label: 'FM作成者' },
  { key: 'filemakerModifiedAt', label: 'FM修正日時', kind: 'datetime' },
  { key: 'filemakerModifiedBy', label: 'FM修正者' },
  { key: 'filemakerLoginEmployeeNo', label: 'ログイン社員番号' },
  { key: 'filemakerLoginEmployeeName', label: 'ログイン社員名' },
  { key: 'createdAt', label: '作成日時', kind: 'datetime' },
];

const DEFAULT_EXPORT_COLUMN_KEYS = new Set([
  'ledgerNo',
  'processingDate',
  'branchName',
  'entryTypeName',
  'responsibleEmployeeName',
  'description',
  'otherAmountYen',
]);

function firstParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)?.trim();
  return value || null;
}

function numberParam(params: URLSearchParams, key: string): number | null {
  const raw = firstParam(params, key);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function dateParam(params: URLSearchParams, key: string): string | null {
  const raw = firstParam(params, key);
  if (!raw) return null;
  const normalized = raw.replaceAll('/', '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function textParam(params: URLSearchParams, key: string): string | null {
  return firstParam(params, key)?.slice(0, 100) ?? null;
}

function booleanParam(params: URLSearchParams, key: string): boolean {
  const raw = firstParam(params, key);
  return raw === '1' || raw === 'true';
}

function sortKeyParam(params: URLSearchParams): TableSortKey | null {
  const raw = firstParam(params, 'sort');
  return SORT_KEYS.some((sortKey) => sortKey === raw) ? raw as TableSortKey : null;
}

function sortDirectionParam(params: URLSearchParams): SortDirection | null {
  const raw = firstParam(params, 'dir');
  return raw === 'asc' || raw === 'desc' ? raw : null;
}

function exportFormatParam(params: URLSearchParams): ExportFormat {
  const raw = firstParam(params, 'format');
  return raw === 'csv-tab' || raw === 'html' ? raw : 'csv-comma';
}

function exportColumnsParam(params: URLSearchParams): readonly ExportColumn[] {
  const raw = firstParam(params, 'columns');
  if (!raw) return EXPORT_COLUMNS.filter((column) => DEFAULT_EXPORT_COLUMN_KEYS.has(String(column.key)));
  const requested = new Set(raw.split(',').map((key) => key.trim()).filter(Boolean));
  const selected = EXPORT_COLUMNS.filter((column) => requested.has(String(column.key)));
  return selected.length > 0 ? selected : EXPORT_COLUMNS.filter((column) => DEFAULT_EXPORT_COLUMN_KEYS.has(String(column.key)));
}

function parseExportParams(params: URLSearchParams): LedgerSearchInput {
  const entryType = numberParam(params, 'entryTypeCode');
  return {
    branchCode: numberParam(params, 'branchCode'),
    periodYear: numberParam(params, 'periodYear'),
    periodMonth: numberParam(params, 'periodMonth'),
    processingDateFrom: dateParam(params, 'processingDateFrom'),
    processingDateTo: dateParam(params, 'processingDateTo'),
    entryTypeCode: entryType == null ? null : (entryType as EntryTypeCode),
    columnFilters: columnFiltersParam(params),
    sortKey: sortKeyParam(params),
    sortDirection: sortDirectionParam(params),
    includeDeleted: booleanParam(params, 'includeDeleted'),
  };
}

function columnFiltersParam(params: URLSearchParams): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (!key.startsWith('filter_')) continue;
    const trimmed = value.trim();
    if (trimmed) filters[key.slice('filter_'.length)] = trimmed.slice(0, 100);
  }
  return filters;
}

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const raw = String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function htmlCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return `${match[1]}/${match[2]}/${match[3]}`;
  return value.replaceAll('-', '/');
}

function dateTime(value: string | number | boolean | null | undefined): string | number | null {
  if (value == null || typeof value === 'number') return value ?? null;
  return String(value).replace('T', ' ').replace(/\.\d{3}Z$/, '').replace(/Z$/, '');
}

function exportValue(entry: LedgerEntryRecord, column: ExportColumn): string | number | null {
  const value = entry[column.key as keyof LedgerEntryRecord];
  if (column.kind === 'date') return dateOnly(typeof value === 'string' ? value : null);
  if (column.kind === 'datetime') return dateTime(value);
  if (column.kind === 'boolean') return value === true ? 'true' : 'false';
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value;
}

function exportFileName(extension: 'csv' | 'tsv' | 'html'): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `voucher-ledger-${byType.year}${byType.month}${byType.day}-${byType.hour}${byType.minute}.${extension}`;
}

function htmlTable(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const head = header.map((cell) => `<th>${htmlCell(cell)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${htmlCell(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>金券管理台帳</title>
  <style>
    body { font-family: Arial, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif; }
    table { border-collapse: collapse; }
    th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; white-space: nowrap; }
    th { background: #f0f0f0; }
  </style>
</head>
<body>
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const format = exportFormatParam(url.searchParams);
  const columns = exportColumnsParam(url.searchParams);
  const entries = await getLedgerExportEntries(parseExportParams(url.searchParams));
  const header = columns.map((column) => column.label);
  const rows = entries.map((entry) => columns.map((column) => exportValue(entry, column)));
  if (format === 'html') {
    return new Response(htmlTable(header, rows), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFileName('html')}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const delimiter = format === 'csv-tab' ? '\t' : ',';
  const body = [
    header.map(csvCell).join(delimiter),
    ...rows.map((row) => row.map(csvCell).join(delimiter)),
  ].join('\r\n');

  return new Response(`\uFEFF${body}\r\n`, {
    headers: {
      'Content-Type': `${format === 'csv-tab' ? 'text/tab-separated-values' : 'text/csv'}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${exportFileName(format === 'csv-tab' ? 'tsv' : 'csv')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
