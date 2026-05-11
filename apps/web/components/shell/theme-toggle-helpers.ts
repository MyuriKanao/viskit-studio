'use client';

const THEME_STORAGE_KEY = 'aishop:theme';
type Theme = 'dark' | 'light';

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
}

export function toggleTheme(): Theme {
  const next: Theme = readStoredTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

export function getCurrentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' ? 'light' : 'dark';
}
