import { EntryTypeCode } from '@/domain/entryTypes';
import { getLedgerExportEntries, type LedgerSearchInput } from '@/server/ledger';

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

function sortKeyParam(params: URLSearchParams): TableSortKey | null {
  const raw = firstParam(params, 'sort');
  return SORT_KEYS.some((sortKey) => sortKey === raw) ? raw as TableSortKey : null;
}

function sortDirectionParam(params: URLSearchParams): SortDirection | null {
  const raw = firstParam(params, 'dir');
  return raw === 'asc' || raw === 'desc' ? raw : null;
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

function dateOnly(value: string | null | undefined): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return `${match[1]}/${match[2]}/${match[3]}`;
  return value.replaceAll('-', '/');
}

function csvFileName(): string {
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
  return `voucher-ledger-${byType.year}${byType.month}${byType.day}-${byType.hour}${byType.minute}.csv`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const entries = await getLedgerExportEntries(parseExportParams(url.searchParams));
  const header = ['出納No', '処理日', '拠点', '区分', '担当', '摘要', 'その他'];
  const rows = entries.map((entry) => [
    entry.ledgerNo,
    dateOnly(entry.processingDate),
    entry.branchName,
    entry.entryTypeName,
    entry.responsibleEmployeeName,
    entry.description,
    entry.otherAmountYen,
  ]);
  const body = [
    header.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\r\n');

  return new Response(`\uFEFF${body}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFileName()}"`,
      'Cache-Control': 'no-store',
    },
  });
}
