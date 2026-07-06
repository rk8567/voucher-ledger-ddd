import { getLedgerExportEntries } from '@/server/ledger';
import type { LedgerEntryRecord } from '@/application/repositories/VoucherLedgerRepository';
import { defaultLedgerExportColumnKeys, orderedLedgerExportColumns, type LedgerColumnDefinition } from '@/app/ledgerColumns';
import { dateOnly, dateTime, delimitedText, htmlTable, tokyoTimestampForFileName, type LedgerExportFormat } from '@/app/ledgerExportFormat';
import { parseLedgerExportSearchParams, urlParam } from '@/app/ledgerSearchParams';

type ExportColumn = LedgerColumnDefinition;

function exportFormatParam(params: URLSearchParams): LedgerExportFormat {
  const raw = urlParam(params, 'format');
  return raw === 'csv-tab' || raw === 'html' ? raw : 'csv-comma';
}

function exportColumnsParam(params: URLSearchParams): readonly ExportColumn[] {
  const raw = urlParam(params, 'columns');
  return orderedLedgerExportColumns(raw?.split(',').map((key) => key.trim()).filter(Boolean), defaultLedgerExportColumnKeys);
}

function exportValue(entry: LedgerEntryRecord, column: ExportColumn): string | number | null {
  const value = entry[column.key as keyof LedgerEntryRecord];
  if (column.kind === 'date') return dateOnly(typeof value === 'string' ? value : null);
  if (column.kind === 'datetime') return dateTime(value);
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value;
}

function exportFileName(extension: 'csv' | 'tsv' | 'html'): string {
  return `voucher-ledger-${tokyoTimestampForFileName()}.${extension}`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const format = exportFormatParam(url.searchParams);
  const columns = exportColumnsParam(url.searchParams);
  const entries = await getLedgerExportEntries(parseLedgerExportSearchParams(url.searchParams));
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
  const body = delimitedText(header, rows, delimiter);

  return new Response(`\uFEFF${body}\r\n`, {
    headers: {
      'Content-Type': `${format === 'csv-tab' ? 'text/tab-separated-values' : 'text/csv'}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="${exportFileName(format === 'csv-tab' ? 'tsv' : 'csv')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
