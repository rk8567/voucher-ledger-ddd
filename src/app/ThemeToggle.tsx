'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'voucher-ledger-theme';

type Theme = 'light' | 'dark';

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

function storedTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const nextTheme = storedTheme();
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }, []);

  const dark = theme === 'dark';

  return (
    <button
      type="button"
      className="themeToggle"
      aria-pressed={dark}
      aria-label={dark ? 'ライトテーマに切り替え' : 'ダークテーマに切り替え'}
      title={dark ? 'ライトテーマに切り替え' : 'ダークテーマに切り替え'}
      onClick={() => {
        const nextTheme: Theme = dark ? 'light' : 'dark';
        window.localStorage.setItem(STORAGE_KEY, nextTheme);
        applyTheme(nextTheme);
        setTheme(nextTheme);
      }}
    >
      <span className="themeToggleIcon" aria-hidden="true">
        {dark ? '☾' : '☀'}
      </span>
    </button>
  );
}
