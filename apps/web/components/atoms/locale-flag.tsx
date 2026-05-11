import * as React from 'react';

import { cn } from '@/lib/utils';

export interface LocaleFlagProps {
  locale: 'zh' | 'en';
  size?: number;
  className?: string;
}

export function LocaleFlag({ locale, size = 16, className }: LocaleFlagProps) {
  const label = locale === 'zh' ? 'Chinese' : 'English';
  const text = locale === 'zh' ? '中' : 'EN';
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'inline-flex items-center justify-center rounded-input bg-surface-03 font-medium text-ink-secondary',
        className
      )}
      style={{ width: size + 8, height: size + 4, fontSize: size * 0.65 }}
    >
      {text}
    </span>
  );
}
