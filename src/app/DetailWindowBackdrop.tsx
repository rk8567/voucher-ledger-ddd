'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

type DetailWindowBackdropProps = Readonly<{
  closeHref: string;
  children: ReactNode;
}>;

export function DetailWindowBackdrop({ closeHref, children }: DetailWindowBackdropProps) {
  const router = useRouter();

  return (
    <div
      className="modalBackdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        router.push(closeHref, { scroll: false });
      }}
    >
      {children}
    </div>
  );
}
