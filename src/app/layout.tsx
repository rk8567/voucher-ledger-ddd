import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '金券管理台帳',
  description: 'Voucher ledger dashboard',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  var theme = window.localStorage.getItem('voucher-ledger-theme');
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
} catch (_) {}
`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
