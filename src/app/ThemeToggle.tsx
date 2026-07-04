'use client';

const STORAGE_KEY = 'voucher-ledger-theme';
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

type Theme = 'light' | 'dark';

function applyTheme(theme: Theme) {
  if (theme === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function persistTheme(theme: Theme) {
  window.localStorage.setItem(STORAGE_KEY, theme);
  document.cookie = `${STORAGE_KEY}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function ThemeToggle() {
  return (
    <button
      type="button"
      className="themeToggle"
      aria-label="テーマ切り替え"
      title="テーマ切り替え"
      onClick={() => {
        const nextTheme: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
        persistTheme(nextTheme);
        applyTheme(nextTheme);
      }}
    >
      <span className="themeToggleIcon" aria-hidden="true" />
    </button>
  );
}
