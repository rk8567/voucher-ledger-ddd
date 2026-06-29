import { EntryTypeCode } from '@/domain/entryTypes';
import type { LedgerSearchInput } from '@/server/ledger';
import { ledgerSortableKeys } from './ledgerColumns';

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

export function booleanParam(value: SearchParamValue): boolean {
  const raw = firstParam(value);
  return raw === '1' || raw === 'true';
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
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith('filter_')) continue;
    const filterValue = textParam(value);
    if (filterValue) filters[key.slice('filter_'.length)] = filterValue;
  }
  return filters;
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
  const filters: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (!key.startsWith('filter_')) continue;
    const filterValue = textParam(value);
    if (filterValue) filters[key.slice('filter_'.length)] = filterValue;
  }
  return filters;
}

export function parseLedgerSearchParams(
  params: Record<string, SearchParamValue>,
): LedgerSearchInput {
  const entryType = numberParam(params.entryTypeCode);
  return {
    branchCode: numberParam(params.branchCode),
    periodYear: numberParam(params.periodYear),
    periodMonth: numberParam(params.periodMonth),
    processingDateFrom: dateParam(params.processingDateFrom),
    processingDateTo: dateParam(params.processingDateTo),
    entryTypeCode: entryType == null ? null : (entryType as EntryTypeCode),
    columnFilters: columnFiltersParam(params),
    ledgerNo: positiveNumberParam(params.ledgerNo),
    limit: null,
    page: positiveNumberParam(params.page),
    sortKey: sortKeyParam(params.sort),
    sortDirection: sortDirectionParam(params.dir),
    includeDeleted: booleanParam(params.includeDeleted),
  };
}

export function parseLedgerExportSearchParams(params: URLSearchParams): LedgerSearchInput {
  const entryType = numberParam(urlParam(params, 'entryTypeCode'));
  return {
    branchCode: numberParam(urlParam(params, 'branchCode')),
    periodYear: numberParam(urlParam(params, 'periodYear')),
    periodMonth: numberParam(urlParam(params, 'periodMonth')),
    processingDateFrom: dateParam(urlParam(params, 'processingDateFrom')),
    processingDateTo: dateParam(urlParam(params, 'processingDateTo')),
    entryTypeCode: entryType == null ? null : (entryType as EntryTypeCode),
    columnFilters: columnFiltersFromUrlParams(params),
    sortKey: sortKeyParam(urlParam(params, 'sort')),
    sortDirection: sortDirectionParam(urlParam(params, 'dir')),
    includeDeleted: booleanParam(urlParam(params, 'includeDeleted')),
  };
}
