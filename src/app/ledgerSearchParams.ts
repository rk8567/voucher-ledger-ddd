import { EntryTypeCode } from '@/domain/entryTypes';
import type { LedgerSearchInput } from '@/server/ledger';
import { ledgerFilterableKeys, ledgerSortableKeys } from './ledgerColumns';

type SearchParamValue = string | string[] | undefined;
type QueryParamInput = Record<string, SearchParamValue>;
export type TableSortKey = NonNullable<LedgerSearchInput['sortKey']>;
export type SortDirection = NonNullable<LedgerSearchInput['sortDirection']>;

export function firstParam(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function numberParam(value: SearchParamValue): number | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

export function positiveNumberParam(value: SearchParamValue): number | null {
  const parsed = numberParam(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

export function dateParam(value: SearchParamValue): string | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const normalized = raw.replaceAll('/', '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

export function textParam(value: SearchParamValue): string | null {
  const raw = firstParam(value)?.trim();
  return raw ? raw.slice(0, 100) : null;
}

export function sortKeyParam(value: SearchParamValue): TableSortKey | null {
  const raw = firstParam(value);
  return ledgerSortableKeys.some((sortKey) => sortKey === raw) ? raw as TableSortKey : null;
}

export function sortDirectionParam(value: SearchParamValue): SortDirection | null {
  const raw = firstParam(value);
  return raw === 'asc' || raw === 'desc' ? raw : null;
}

export function columnFiltersParam(params: Record<string, SearchParamValue>): Record<string, string> {
  return columnFiltersFromEntries(Object.entries(params));
}

export function paramsWithout(
  params: QueryParamInput,
  options: Readonly<{
    keys?: readonly string[];
    prefixes?: readonly string[];
  }>,
): URLSearchParams {
  const omittedKeys = new Set(options.keys ?? []);
  const omittedPrefixes = options.prefixes ?? [];
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (omittedKeys.has(key) || omittedPrefixes.some((prefix) => key.startsWith(prefix))) continue;
    const first = firstParam(value);
    if (first) next.set(key, first);
  }
  return next;
}

export function urlParam(params: URLSearchParams, key: string): string | undefined {
  return params.get(key)?.trim() || undefined;
}

export function columnFiltersFromUrlParams(params: URLSearchParams): Record<string, string> {
  return columnFiltersFromEntries(params.entries());
}

function columnFiltersFromEntries(entries: Iterable<readonly [string, SearchParamValue]>): Record<string, string> {
  const filters: Record<string, string> = {};
  const filterableKeys = new Set<string>(ledgerFilterableKeys);
  for (const [key, value] of entries) {
    if (!key.startsWith('filter_')) continue;
    const columnKey = key.slice('filter_'.length);
    if (!filterableKeys.has(columnKey)) continue;
    const filterValue = textParam(value);
    if (filterValue) filters[columnKey] = filterValue;
  }
  return filters;
}

export function parseLedgerSearchParams(
  params: Record<string, SearchParamValue>,
): LedgerSearchInput {
  const entryType = numberParam(params.entryTypeCode);
  return {
    branchCode: numberParam(params.branchCode),
    processingDateFrom: dateParam(params.processingDateFrom),
    processingDateTo: dateParam(params.processingDateTo),
    entryTypeCode: entryType == null ? null : (entryType as EntryTypeCode),
    columnFilters: columnFiltersParam(params),
    ledgerNo: positiveNumberParam(params.ledgerNo),
    page: positiveNumberParam(params.page),
    sortKey: sortKeyParam(params.sort),
    sortDirection: sortDirectionParam(params.dir),
    deletedOnly: firstParam(params.deleted) === '1',
    dateRangeAll: firstParam(params.dateRange) === 'all',
  };
}

export function parseLedgerExportSearchParams(params: URLSearchParams): LedgerSearchInput {
  const entryType = numberParam(urlParam(params, 'entryTypeCode'));
  return {
    branchCode: numberParam(urlParam(params, 'branchCode')),
    processingDateFrom: dateParam(urlParam(params, 'processingDateFrom')),
    processingDateTo: dateParam(urlParam(params, 'processingDateTo')),
    entryTypeCode: entryType == null ? null : (entryType as EntryTypeCode),
    columnFilters: columnFiltersFromUrlParams(params),
    sortKey: sortKeyParam(urlParam(params, 'sort')),
    sortDirection: sortDirectionParam(urlParam(params, 'dir')),
    deletedOnly: urlParam(params, 'deleted') === '1',
    dateRangeAll: urlParam(params, 'dateRange') === 'all',
  };
}
