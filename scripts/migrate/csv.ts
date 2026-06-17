import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';

export type CsvRow = Record<string, string>;

/** Minimal RFC4180-ish CSV parser for FileMaker UTF-8 exports. */
export function parseCsv(content: string): CsvRow[] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(current);
      current = '';
      continue;
    }

    if (char === '\n') {
      row.push(current);
      current = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    if (char === '\r') continue;

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell.length > 0)) rows.push(row);

  if (rows.length === 0) return [];

  const headers = rows[0]!.map((header) => header.replace(/^\uFEFF/, '').trim());
  return rows.slice(1).map((cells) => {
    const record: CsvRow = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? '').trim();
    });
    return record;
  });
}

export function readCsvFile(path: string): CsvRow[] {
  const content = readTextFile(path);
  return parseCsv(content);
}

function readTextFile(path: string): string {
  const buffer = readFileSync(path);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);

  if (!utf8.includes('\uFFFD')) return utf8;

  return new TextDecoder('shift_jis').decode(buffer);
}

export function mapRow(row: CsvRow, columnMap: Record<string, string>): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [source, target] of Object.entries(columnMap)) {
    if (source in row) mapped[target] = row[source] ?? '';
  }
  return mapped;
}

export function asNullableInt(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function asRequiredInt(value: string | undefined, field: string): number {
  const parsed = asNullableInt(value);
  if (parsed == null) throw new Error(`${field} is required`);
  return parsed;
}

export function asNullableBigInt(value: string | undefined): bigint | null {
  if (value == null || value === '') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function asNullableBoolean(value: string | undefined): boolean | null {
  if (value == null || value === '') return null;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  return null;
}

export function asNullableDate(value: string | undefined): string | null {
  if (value == null || value === '') return null;
  const slashMatch = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
  if (slashMatch) {
    const [, year, month, day] = slashMatch;
    return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

export function asNullableTimestamp(value: string | undefined): string | null {
  if (value == null || value === '') return null;
  const normalized = value.replace(/\//g, '-').replace(' ', 'T');
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}
