'use client';

// Flips between light and dark and remembers the choice. Which icon shows is
// decided in CSS from the same rules as the theme itself, so the server HTML
// never disagrees with the browser.

import { useEffect, useState } from 'react';

function effective(): 'light' | 'dark' {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function ThemeToggle() {
  // Only known in the browser: the label says which way the button goes once it is.
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setTheme(effective());
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const flip = () => {
    const next = effective() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  };
  return (
    <button type="button" className="theme-toggle" onClick={flip} aria-label={theme ? `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode` : 'Switch between light and dark mode'}>
      <svg className="moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="currentColor" />
      </svg>
      <svg className="sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
        <circle cx="12" cy="12" r="4.5" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </g>
      </svg>
    </button>
  );
}
