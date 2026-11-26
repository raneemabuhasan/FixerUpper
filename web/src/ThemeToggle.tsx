export type Theme = 'light' | 'dark';

export function getSavedTheme(): Theme {
  try {
    const saved = localStorage.getItem('resolve-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* Theme selection still works when storage is unavailable. */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const label = `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`;
  return <button type="button" className="theme-toggle" aria-label={label} title={label} onClick={() => onChange(theme === 'light' ? 'dark' : 'light')}>
    <svg key={theme} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {theme === 'light'
        ? <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
        : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>}
    </svg>
  </button>;
}
