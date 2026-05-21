'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SIDEBAR_NAV_ITEMS } from '@/lib/nav';
import { cn } from '@/lib/utils';

function isActive(href: string, pathname: string, locale: string): boolean {
  // pathname comes from next/navigation as either '/dashboard' (default zh,
  // localePrefix='as-needed') or '/<locale>/dashboard' (en).
  // Strict equality at locale boundaries — endsWith would falsely match
  // '/templates/dashboard' against '/dashboard' when nested routes land.
  return pathname === href || pathname === `/${locale}${href}`;
}

export function Sidebar() {
  const pathname = usePathname() ?? '';
  const locale = useLocale();
  const t = useTranslations();
  return (
    <nav
      aria-label="Primary"
      className="flex h-screen w-[240px] shrink-0 flex-col gap-s-2 border-r border-border-subtle bg-surface-01 px-s-3 py-s-5"
    >
      <div className="flex items-center gap-s-2 px-s-3 pb-s-4">
        <img src="/brand/viskit-favicon.svg" alt="" aria-hidden="true" className="h-7 w-7" />
        <span className="font-display text-lg text-ink-primary">Viskit</span>
      </div>
      <TooltipProvider delayDuration={200}>
        <ul className="flex flex-col gap-s-1">
          {SIDEBAR_NAV_ITEMS.map((item) => {
            const active = item.enabled && isActive(item.href, pathname, locale);
            const label = t(item.labelKey);
            const Icon = item.icon;
            const baseCls =
              'flex w-full items-center gap-s-3 rounded-input px-s-3 py-s-2 text-sm transition-colors duration-fast';
            if (item.enabled) {
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    aria-label={label}
                    className={cn(
                      baseCls,
                      active
                        ? 'bg-surface-02 text-accent'
                        : 'text-ink-secondary hover:bg-surface-02 hover:text-ink-primary'
                    )}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                    <span>{label}</span>
                  </Link>
                </li>
              );
            }
            return (
              <li key={item.id}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-disabled="true"
                      aria-label={`${label} — Coming in EPIC-${item.comingInEpic}`}
                      disabled
                      className={cn(baseCls, 'cursor-not-allowed text-ink-faint opacity-50')}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4" />
                      <span>{label}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {`Coming in EPIC-${item.comingInEpic}`}
                  </TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </TooltipProvider>
    </nav>
  );
}
