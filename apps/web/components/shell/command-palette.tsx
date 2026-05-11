'use client';

import { Globe, LayoutDashboard, SunMoon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { subscribeOpenCommandPalette } from './command-palette-bus';
import { pathnameForLocale, setLocaleCookie } from './locale-toggle-helpers';
import { applyTheme, getCurrentTheme } from './theme-toggle-helpers';

type Locale = 'zh' | 'en';

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const locale = useLocale() as Locale;
  const t = useTranslations('palette');
  const [open, setOpen] = React.useState(false);

  // Global Cmd+K / Ctrl+K toggle
  React.useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // External "open" trigger from Topbar button
  React.useEffect(() => subscribeOpenCommandPalette(() => setOpen(true)), []);

  const goDashboard = React.useCallback(() => {
    setOpen(false);
    // Reuse the as-needed prefix logic instead of re-deriving it here.
    router.push(pathnameForLocale('/dashboard', locale));
  }, [locale, router]);

  const cycleLocale = React.useCallback(() => {
    setOpen(false);
    const next: Locale = locale === 'zh' ? 'en' : 'zh';
    setLocaleCookie(next);
    router.replace(pathnameForLocale(pathname, next));
  }, [locale, pathname, router]);

  const cycleTheme = React.useCallback(() => {
    setOpen(false);
    const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t('placeholder')} aria-label={t('placeholder')} />
      <CommandList>
        <CommandEmpty>{t('empty')}</CommandEmpty>
        <CommandGroup heading={t('headingGo')}>
          <CommandItem onSelect={goDashboard}>
            <LayoutDashboard aria-hidden="true" />
            <span>{t('goDashboard')}</span>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading={t('headingPrefs')}>
          <CommandItem onSelect={cycleLocale}>
            <Globe aria-hidden="true" />
            <span>{t('toggleLocale')}</span>
          </CommandItem>
          <CommandItem onSelect={cycleTheme}>
            <SunMoon aria-hidden="true" />
            <span>{t('toggleTheme')}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
