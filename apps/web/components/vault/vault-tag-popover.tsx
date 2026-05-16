'use client';

import * as React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TagCombobox } from '@/components/vault/tag-combobox';
import { useVaultTags } from '@/hooks/use-vault-tags';

interface VaultTagChipProps {
  activeTag: string | undefined;
  labelTag: string;
  labelAll: string;
  tooltipAnd: string;
  onChange: (next: string | undefined) => void;
}

/**
 * Lazy-loaded tag filter chip + popover.
 *
 * Owns Popover, TagCombobox, and useVaultTags so those modules are excluded
 * from the /vault First Load JS bundle. Dynamic-imported by vault-filters.tsx.
 */
export function VaultTagChip({
  activeTag,
  labelTag,
  labelAll,
  tooltipAnd,
  onChange,
}: VaultTagChipProps) {
  const tagsQuery = useVaultTags();
  const suggestions = tagsQuery.data ?? [];
  const [open, setOpen] = React.useState(false);

  function handleChange(next: string[]) {
    const picked = next.length > 0 ? next[next.length - 1] : undefined;
    onChange(picked);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {activeTag ? (
        // Chip is a non-interactive <span> wrapper holding two sibling
        // <button>s: the tag-name button opens the popover, the × button
        // clears the filter. Nesting two <button>s (the previous shape)
        // was invalid HTML.
        <span className="inline-flex items-center gap-s-1 rounded-input border border-accent bg-accent/10 px-s-2 py-s-1 text-sm text-accent">
          <PopoverTrigger asChild>
            <button
              type="button"
              title={tooltipAnd}
              className="cursor-pointer border-0 bg-transparent p-0 text-inherit"
            >
              {activeTag}
            </button>
          </PopoverTrigger>
          <button
            type="button"
            aria-label={labelAll}
            onClick={() => onChange(undefined)}
            className="ml-0.5 cursor-pointer border-0 bg-transparent p-0 text-accent hover:text-ink-primary"
          >
            ×
          </button>
        </span>
      ) : (
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={labelTag}
            className="rounded-input border border-border-subtle bg-surface-01 px-s-2 py-s-1 text-sm text-ink-muted hover:text-ink-primary"
          >
            {labelTag}
          </button>
        </PopoverTrigger>
      )}
      <PopoverContent className="w-64 p-2" align="start">
        {open && (
          <TagCombobox
            value={activeTag ? [activeTag] : []}
            onChange={handleChange}
            suggestions={suggestions}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
