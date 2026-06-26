export type ExportCell = string | number | boolean | null | undefined;
export type LedgerExportFormat = 'csv-comma' | 'csv-tab' | 'html';

export function csvCell(value: ExportCell): string {
  if (value == null) return '';
  const raw = String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function htmlCell(value: ExportCell): string {
  if (value == null) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function delimitedText(
  header: readonly ExportCell[],
  rows: readonly (readonly ExportCell[])[],
  delimiter: ',' | '\t',
): string {
  return [
    header.map(csvCell).join(delimiter),
    ...rows.map((row) => row.map(csvCell).join(delimiter)),
  ].join('\r\n');
}

export function htmlTable(
  header: readonly ExportCell[],
  rows: readonly (readonly ExportCell[])[],
): string {
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

export function dateOnly(value: string | null | undefined): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return `${match[1]}/${match[2]}/${match[3]}`;
  return value.replaceAll('-', '/');
}

export function dateTime(value: ExportCell): string | number | null {
  if (value == null || typeof value === 'number') return value ?? null;
  return String(value).replace('T', ' ').replace(/\.\d{3}Z$/, '').replace(/Z$/, '');
}

export function tokyoTimestampForFileName(): string {
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
  return `${byType.year}${byType.month}${byType.day}-${byType.hour}${byType.minute}`;
}
