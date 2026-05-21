import { match } from '@formatjs/intl-localematcher';
import createMiddleware from 'next-intl/middleware';
import { type NextRequest, NextResponse } from 'next/server';

import { routing } from './app/i18n/routing';

const intlMiddleware = createMiddleware(routing);

const BARE_ROOT_PATHS = new Set(['/', '/zh', '/en']);
const SUPPORTED_LOCALES = ['zh', 'en'] as const;
const DEFAULT_LOCALE = 'zh';
const API_BASE =
  process.env.NEXT_SERVER_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:8000';

function resolveLocale(request: NextRequest): string {
  const localeCookie = request.cookies.get('NEXT_LOCALE')?.value;
  if (localeCookie === 'zh' || localeCookie === 'en') {
    return localeCookie;
  }

  const acceptLanguage = request.headers.get('accept-language') ?? '';
  const languages = acceptLanguage
    .split(',')
    .map((l) => l.split(';')[0].trim())
    .filter(Boolean);

  try {
    return match(languages, [...SUPPORTED_LOCALES], DEFAULT_LOCALE);
  } catch {
    return DEFAULT_LOCALE;
  }
}

function rewriteUrl(request: NextRequest, locale: string, page: string): NextResponse {
  // Internal rewrite targets must include the [locale] segment to resolve to
  // app/[locale]/<page>/page.tsx. next-intl's localePrefix='as-needed' only
  // governs the public/canonical URL form, not internal rewrites.
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}/${page}`;
  return NextResponse.rewrite(url);
}

export default async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (!BARE_ROOT_PATHS.has(pathname)) {
    return intlMiddleware(request);
  }

  // Bare-root path: resolve locale then check onboarding gate
  const locale = resolveLocale(request);

  let needsOnboarding = true; // safe default
  try {
    const response = await fetch(`${API_BASE}/api/onboarding/needed`, { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as { needs_onboarding: boolean };
      needsOnboarding = data.needs_onboarding;
    }
    // 5xx or non-ok: keep safe default (needsOnboarding = true)
  } catch {
    // Network error or unreachable host: keep safe default (needsOnboarding = true)
    console.warn('[middleware] /api/onboarding/needed unreachable — defaulting to onboarding');
  }

  const destination = needsOnboarding ? 'onboarding' : 'dashboard';
  return rewriteUrl(request, locale, destination);
}

export const config = {
  matcher: ['/((?!api|health|openapi\\.json|_next|_vercel|.*\\..*).*)'],
};
