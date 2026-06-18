import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';
import type { CsvRow } from './csv.js';

export function readHtmlTableFile(path: string): CsvRow[] {
  const html = readHtmlTextFile(path);
  const rows = parseFirstHtmlTable(html);
  if (rows.length === 0) return [];

  const headers = normalizeDuplicateHeaders(rows[0]!.map((header) => header.trim()));
  return rows.slice(1).map((cells) => {
    const record: CsvRow = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? '').trim();
    });
    return record;
  });
}

function readHtmlTextFile(path: string): string {
  const buffer = readFileSync(path);
  const asciiHead = new TextDecoder('ascii').decode(buffer.subarray(0, 512)).toLowerCase();
  const charset = /charset\s*=\s*["']?([^"'>\s]+)/i.exec(asciiHead)?.[1];
  const encoding = charset === 'x-sjis' || charset === 'shift_jis' || charset === 'shift-jis' ? 'shift_jis' : 'utf-8';
  return new TextDecoder(encoding).decode(buffer);
}

function normalizeDuplicateHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header) => {
    const count = (seen.get(header) ?? 0) + 1;
    seen.set(header, count);
    return count === 1 ? header : `${header}[${count}]`;
  });
}

function parseFirstHtmlTable(html: string): string[][] {
  const tableStart = html.search(/<table\b/i);
  if (tableStart === -1) return [];

  const tableEnd = findMatchingTagEnd(html, 'table', tableStart);
  const tableHtml = html.slice(tableStart, tableEnd);
  return extractTopLevelRows(tableHtml).map(extractTopLevelCells).filter((row) => row.length > 0);
}

function extractTopLevelRows(tableHtml: string): string[] {
  const rows: string[] = [];
  const tagPattern = /<\/?tr\b[^>]*>/gi;
  let depth = 0;
  let rowStart = -1;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(tableHtml))) {
    const tag = match[0].toLowerCase();
    if (!tag.startsWith('</')) {
      if (depth === 0) rowStart = tagPattern.lastIndex;
      depth += 1;
      continue;
    }

    depth -= 1;
    if (depth === 0 && rowStart !== -1) {
      rows.push(tableHtml.slice(rowStart, match.index));
      rowStart = -1;
    }
  }

  return rows;
}

function extractTopLevelCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const tagPattern = /<\/?(?:td|th)\b[^>]*>/gi;
  let depth = 0;
  let cellStart = -1;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(rowHtml))) {
    const tag = match[0].toLowerCase();
    if (!tag.startsWith('</')) {
      if (depth === 0) cellStart = tagPattern.lastIndex;
      depth += 1;
      continue;
    }

    depth -= 1;
    if (depth === 0 && cellStart !== -1) {
      cells.push(cleanCellText(rowHtml.slice(cellStart, match.index)));
      cellStart = -1;
    }
  }

  return cells;
}

function cleanCellText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<\/(?:td|th)>\s*<(?:td|th)\b[^>]*>/gi, '\x1d')
      .replace(/<[^>]+>/g, '')
      .replace(/\r?\n/g, ' ')
      .trim(),
  );
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function findMatchingTagEnd(html: string, tagName: string, startIndex: number): number {
  const tagPattern = new RegExp(`</?${tagName}\\b[^>]*>`, 'gi');
  tagPattern.lastIndex = startIndex;
  let depth = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html))) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return tagPattern.lastIndex;
    } else {
      depth += 1;
    }
  }

  return html.length;
}
