// Light/dark theme, persisted per browser. The whole design system is driven
// by CSS custom properties, so switching themes is just flipping a data-attr
// on <html> — every component follows automatically.
import { useEffect, useState } from 'react';

const KEY = 'mems.theme';
const THEMES = ['light', 'dark'];

export function storedTheme() {
  try {
    const v = localStorage.getItem(KEY);
    if (THEMES.includes(v)) return v;
  } catch { /* ignore */ }
  // No explicit choice yet → follow the OS preference once.
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

export function applyTheme(theme) {
  const t = THEMES.includes(theme) ? theme : 'light';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
}

// Apply as early as possible to avoid a flash of the wrong theme.
export function initTheme() {
  document.documentElement.setAttribute('data-theme', storedTheme());
}

export function useTheme() {
  const [theme, setTheme] = useState(storedTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return { theme, setTheme, toggle };
}
