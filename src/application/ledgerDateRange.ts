export type ProcessingDateRange = Readonly<{
  from: string;
  to: string;
}>;

export function defaultProcessingDateRange(now = new Date()): ProcessingDateRange {
  const today = todayInTokyo(now);
  return {
    from: subtractMonths(today, 1),
    to: today,
  };
}

export function todayInTokyo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function subtractMonths(dateText: string, months: number): string {
  const [year, month, day] = dateText.split('-').map(Number);
  const targetMonthIndex = (month ?? 1) - 1 - months;
  const targetYear = (year ?? 1970) + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(day ?? 1, daysInMonth(targetYear, normalizedMonthIndex));
  return formatDate(targetYear, normalizedMonthIndex + 1, targetDay);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
