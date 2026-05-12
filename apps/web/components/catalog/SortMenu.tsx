'use client';

import { ArrowDownUp, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { CatalogSortKey, CatalogSortOrder } from '@/hooks/use-kits-catalog';

export interface SortMenuLabels {
  triggerAria: string;
  groupKey: string;
  groupOrder: string;
  optionCreated: string;
  optionUpdated: string;
  optionScore: string;
  optionAsc: string;
  optionDesc: string;
}

export interface SortMenuProps {
  sort: CatalogSortKey;
  order: CatalogSortOrder;
  onChange: (next: { sort: CatalogSortKey; order: CatalogSortOrder }) => void;
  labels: SortMenuLabels;
}

const KEY_LABEL: Record<CatalogSortKey, keyof SortMenuLabels> = {
  created_at: 'optionCreated',
  updated_at: 'optionUpdated',
  score: 'optionScore',
};

export function SortMenu({ sort, order, onChange, labels }: SortMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={labels.triggerAria}
          data-testid="sort-menu-trigger"
          className="gap-s-2"
        >
          <ArrowDownUp aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="text-xs">{labels[KEY_LABEL[sort]]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        <DropdownMenuLabel>{labels.groupKey}</DropdownMenuLabel>
        {(['created_at', 'updated_at', 'score'] satisfies CatalogSortKey[]).map((key) => (
          <DropdownMenuItem
            key={key}
            data-testid={`sort-key-${key}`}
            onSelect={() => onChange({ sort: key, order })}
          >
            <span className="flex-1">{labels[KEY_LABEL[key]]}</span>
            {sort === key ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-accent" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{labels.groupOrder}</DropdownMenuLabel>
        {(['desc', 'asc'] satisfies CatalogSortOrder[]).map((dir) => (
          <DropdownMenuItem
            key={dir}
            data-testid={`sort-order-${dir}`}
            onSelect={() => onChange({ sort, order: dir })}
          >
            <span className="flex-1">{dir === 'asc' ? labels.optionAsc : labels.optionDesc}</span>
            {order === dir ? (
              <Check aria-hidden="true" className="h-3.5 w-3.5 text-accent" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
