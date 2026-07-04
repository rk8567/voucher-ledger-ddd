import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: '金券管理台帳',
  description: 'Voucher ledger dashboard',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = (await cookies()).get('voucher-ledger-theme')?.value === 'dark' ? 'dark' : undefined;

  return (
    <html lang="ja" data-theme={theme} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  var key = 'voucher-ledger-theme';
  var cookieTheme = document.cookie.split('; ').find(function (row) {
    return row.indexOf(key + '=') === 0;
  });
  var theme = cookieTheme ? cookieTheme.slice(key.length + 1) : window.localStorage.getItem(key);
  theme = theme === 'dark' ? 'dark' : 'light';
  if (theme === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  } else {
    delete document.documentElement.dataset.theme;
  }
  window.localStorage.setItem(key, theme);
  document.cookie = key + '=' + theme + '; Path=/; Max-Age=31536000; SameSite=Lax';
} catch (_) {}
`,
          }}
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
