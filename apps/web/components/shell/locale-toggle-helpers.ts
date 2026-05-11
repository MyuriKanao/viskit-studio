'use client';

const LOCALE_COOKIE = 'NEXT_LOCALE';
type Locale = 'zh' | 'en';

export function setLocaleCookie(locale: Locale): void {
  if (typeof document === 'undefined') return;
  // 1 year persistence
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

/**
 * Swap the leading locale segment in `pathname`. Honours
 * `localePrefix='as-needed'` (default locale `zh` may have no prefix).
 */
export function pathnameForLocale(
  pathname: string,
  nextLocale: Locale,
  defaultLocale: Locale = 'zh'
): string {
  const segments = pathname.split('/').filter(Boolean);
  const head = segments[0];
  if (head === 'zh' || head === 'en') {
    segments[0] = nextLocale === defaultLocale ? '' : nextLocale;
  } else {
    if (nextLocale !== defaultLocale) segments.unshift(nextLocale);
  }
  const clean = segments.filter(Boolean).join('/');
  return `/${clean}`;
}
