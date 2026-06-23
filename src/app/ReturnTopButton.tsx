'use client';

import { useEffect, useState } from 'react';

export function ReturnTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > 120);
    }

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (!visible) return null;

  return <a className="returnTopButton" href="#top" aria-label="ページ上部へ戻る">↑</a>;
}
