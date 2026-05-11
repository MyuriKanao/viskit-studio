'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

export interface SpecMarkdownProps {
  src: string;
  className?: string;
}

/**
 * Spec column renderer.
 *
 * Custom renderers map heading levels + body + code + tables to the
 * design-brief typography: Instrument Serif for h1/h2, Inter for h3/p,
 * JetBrains Mono for inline code, and a border-subtle table treatment.
 */
export function SpecMarkdown({ src, className }: SpecMarkdownProps) {
  return (
    <article aria-label="Kit specification" className={cn('flex flex-col gap-s-3', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children, ...props }) => (
            <h1 {...props} className="font-display text-2xl font-normal text-ink-primary">
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 {...props} className="mt-s-4 font-display text-xl font-normal text-ink-primary">
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 {...props} className="mt-s-3 font-sans text-base text-ink-primary">
              {children}
            </h3>
          ),
          p: ({ children, ...props }) => (
            <p {...props} className="text-sm leading-relaxed text-ink-muted">
              {children}
            </p>
          ),
          code: ({ children, ...props }) => (
            <code
              {...props}
              className="rounded-input bg-surface-02 px-s-1 font-mono text-xs text-ink-secondary"
            >
              {children}
            </code>
          ),
          table: ({ children, ...props }) => (
            <table
              {...props}
              className="w-full border-collapse border border-border-subtle text-sm text-ink-secondary"
            >
              {children}
            </table>
          ),
          th: ({ children, ...props }) => (
            <th
              {...props}
              className="border border-border-subtle bg-surface-02 px-s-3 py-s-2 text-left text-xs font-medium uppercase tracking-wider text-ink-faint"
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td {...props} className="border border-border-subtle px-s-3 py-s-2">
              {children}
            </td>
          ),
          ul: ({ children, ...props }) => (
            <ul {...props} className="list-disc pl-s-5 text-sm text-ink-muted">
              {children}
            </ul>
          ),
          li: ({ children, ...props }) => (
            <li {...props} className="mb-s-1">
              {children}
            </li>
          ),
          blockquote: ({ children, ...props }) => (
            <blockquote
              {...props}
              className="border-l-2 border-accent-soft pl-s-3 italic text-ink-secondary"
            >
              {children}
            </blockquote>
          ),
        }}
      >
        {src}
      </ReactMarkdown>
    </article>
  );
}
