'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TagFrequency } from '@/hooks/use-vault-tags';

/**
 * Tag combobox with explicit a11y contract (ADR-EPIC10-002).
 *
 * Root:  <div role="combobox" aria-haspopup="listbox" aria-expanded aria-controls>
 * Input: plain <input> (NOT cmdk CommandInput) so aria-autocomplete/aria-controls
 *        apply unambiguously to a single element.
 * List:  CommandList wrapped to carry role="listbox".
 * Multi-select: selecting a suggestion appends to value without closing the popover.
 * Create-new:   when inputValue has no match, shows a synthetic "+ Create" item.
 */

export interface TagComboboxProps {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions: TagFrequency[];
}

export function TagCombobox({ value, onChange, suggestions }: TagComboboxProps) {
  const t = useTranslations('vault.bulk');
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');

  const listId = React.useId();
  const inputId = React.useId();

  const normalizedInput = inputValue.toLowerCase().trim();

  const filteredSuggestions = React.useMemo(
    () =>
      normalizedInput ? suggestions.filter((s) => s.tag.includes(normalizedInput)) : suggestions,
    [suggestions, normalizedInput]
  );

  const showCreate =
    normalizedInput.length > 0 && !suggestions.some((s) => s.tag === normalizedInput);

  function selectTag(tag: string) {
    const lower = tag.toLowerCase();
    if (!value.includes(lower)) {
      onChange([...value, lower]);
    }
    // Do NOT close popover — multi-select persistence.
    setInputValue('');
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    // Backspace on empty input removes last chip
    if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* PopoverTrigger wraps the outer div (not the input) so the div serves as
          the Radix anchor for positioning. The inner <input> is a free element. */}
      <PopoverTrigger asChild>
        {/* a11y contract root — role="combobox" on a div is intentional per ADR-EPIC10-002.
            The focusable <input> child provides keyboard access; tabIndex on the wrapper
            is not needed because the input itself receives focus. */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: input child provides focus target */}
        {/* biome-ignore lint/a11y/useSemanticElements: div+role="combobox" is the ADR-EPIC10-002 contract */}
        <div
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          className="flex min-h-[36px] w-56 flex-wrap items-center gap-1 rounded-input border border-border-subtle bg-surface-01 px-2 py-1"
        >
          {/* Selected tag chips */}
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 rounded-sm bg-accent/20 px-1.5 py-0.5 text-xs text-ink-primary"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => removeTag(tag)}
                className="ml-0.5 text-ink-muted hover:text-ink-primary"
              >
                ×
              </button>
            </span>
          ))}

          {/* Plain input for a11y — NOT cmdk CommandInput, NOT PopoverTrigger asChild
            (asChild converts input→button, breaking fireEvent.change in tests and
             aria-autocomplete semantics in screen readers). Open state is controlled
             directly via onFocus / onChange. */}
          <input
            id={inputId}
            role="searchbox"
            aria-autocomplete="list"
            aria-controls={listId}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? t('combobox_placeholder') : ''}
            className="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-ink-muted"
          />
        </div>
      </PopoverTrigger>

      <PopoverContent
        className="w-56 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={() => setOpen(false)}
      >
        {/* role="listbox" on CommandList is intentional per ADR-EPIC10-002:
            cmdk defaults to role="menu"; we override to role="listbox" for
            combobox a11y contract. */}
        <Command shouldFilter={false}>
          {/* biome-ignore lint/a11y/useSemanticElements: role="listbox" on CommandList required by ADR-EPIC10-002 combobox contract */}
          <CommandList id={listId} role="listbox" aria-label="Tag suggestions">
            {showCreate && (
              <CommandItem
                key="__create__"
                value={`__create__${normalizedInput}`}
                onSelect={() => selectTag(normalizedInput)}
                className="text-accent"
              >
                {t('combobox_create_pattern', { input: normalizedInput })}
              </CommandItem>
            )}

            {filteredSuggestions.length === 0 && !showCreate ? (
              <CommandEmpty>No tags found</CommandEmpty>
            ) : null}

            {filteredSuggestions.length > 0 && (
              <>
                {showCreate && (
                  <div className="mx-2 my-1 border-t border-border-subtle" aria-hidden="true" />
                )}
                <CommandGroup>
                  {filteredSuggestions.map((s) => (
                    <CommandItem
                      key={s.tag}
                      value={s.tag}
                      onSelect={() => selectTag(s.tag)}
                      data-selected={value.includes(s.tag) ? 'true' : undefined}
                    >
                      <span className="flex-1">{s.tag}</span>
                      <span className="text-xs text-ink-muted">{s.count}</span>
                      {value.includes(s.tag) && (
                        <span className="ml-1 text-xs text-accent" aria-label="selected">
                          ✓
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
