'use client';

import { Moon, Sun } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import { LocaleFlag } from '@/components/atoms/locale-flag';
import { StatusChip } from '@/components/atoms/status-chip';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useHealth } from '@/hooks/use-health';
import { openCommandPalette } from './command-palette-bus';
import { pathnameForLocale, setLocaleCookie } from './locale-toggle-helpers';
import { applyTheme, getCurrentTheme, readStoredTheme } from './theme-toggle-helpers';

type Locale = 'zh' | 'en';

function HealthChip() {
  const t = useTranslations('topbar');
  const { data, isLoading, isError } = useHealth();
  const status = isLoading ? 'pending' : isError ? 'error' : data?.status === 'ok' ? 'ok' : 'warn';
  const labelMap = {
    pending: t('healthLoading'),
    ok: t('healthOk'),
    warn: t('healthWarn'),
    error: t('healthError'),
  } as const;
  return (
    <StatusChip
      status={status}
      label={labelMap[status]}
      ariaLabel={`${t('health')}: ${labelMap[status]}`}
    />
  );
}

export function Topbar() {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const locale = useLocale() as Locale;
  const t = useTranslations('topbar');
  const [theme, setTheme] = React.useState<'dark' | 'light'>('dark');

  // Hydrate theme from storage on mount + reflect data-theme attribute
  React.useEffect(() => {
    const stored = readStoredTheme();
    applyTheme(stored);
    setTheme(stored);
  }, []);

  const handleToggleTheme = React.useCallback(() => {
    const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  }, []);

  const handleSelectLocale = React.useCallback(
    (next: Locale) => {
      if (next === locale) return;
      setLocaleCookie(next);
      const target = pathnameForLocale(pathname, next);
      router.replace(target);
    },
    [locale, pathname, router]
  );

  const handleOpenPalette = React.useCallback(() => {
    openCommandPalette();
  }, []);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-subtle bg-surface-01 px-s-5">
      <div className="flex items-center gap-s-3">
        <span className="font-display text-lg text-ink-primary">{t('title')}</span>
      </div>
      <div className="flex items-center gap-s-3">
        <HealthChip />
      </div>
      <div className="flex items-center gap-s-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t('palette')}
          onClick={handleOpenPalette}
          className="gap-s-2"
        >
          <span>{t('palette')}</span>
          <kbd className="rounded-input bg-surface-03 px-s-2 py-0.5 text-xs text-ink-muted">⌘K</kbd>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={t('locale')}>
              <LocaleFlag locale={locale} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => handleSelectLocale('zh')}
              aria-label="Switch to Chinese"
            >
              <LocaleFlag locale="zh" />
              <span>中文</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => handleSelectLocale('en')}
              aria-label="Switch to English"
            >
              <LocaleFlag locale="en" />
              <span>English</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('theme')}
          onClick={handleToggleTheme}
        >
          {theme === 'dark' ? (
            <Moon aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Sun aria-hidden="true" className="h-4 w-4" />
          )}
        </Button>
      </div>
    </header>
  );
}
