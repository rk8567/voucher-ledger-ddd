import { dateOnlyText, tokyoDateTimeText } from './ledgerDateFormat';

export function yen(value: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(value);
}

export function dateOnly(value: string | null | undefined): string | null {
  return dateOnlyText(value);
}

export function dateTime(value: string | null | undefined): string | null {
  return tokyoDateTimeText(value);
}

export function limitText(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join('');
}

export function legacyRegistrationFlagText(value: boolean): string {
  return value ? '登録済' : '未登録';
}
