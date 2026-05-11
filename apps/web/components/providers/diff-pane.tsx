'use client';

import * as React from 'react';
import { Diff, Hunk, parseDiff } from 'react-diff-view';

import { cn } from '@/lib/utils';

import 'react-diff-view/style/index.css';

export interface DiffPaneProps {
  title: string;
  yaml: string;
  /** Optional yaml to diff *against*. When provided, the unified diff renders. */
  compareTo?: string;
  /** When true, render an editable textarea over the YAML for "Save merged". */
  editable?: boolean;
  onChange?: (next: string) => void;
  className?: string;
}

function buildUnifiedDiff(left: string, right: string): string {
  // Minimal-overhead diff fabricator: produces a unified-diff-shaped string
  // by treating every line in `left` as removed and every line in `right`
  // as added.  Acceptable for our 3-pane UX — left pane is small (<1KB
  // typical) and we never need a *real* diff algorithm for the wire shape
  // since react-diff-view only parses, not computes.
  const lhs = left.split('\n');
  const rhs = right.split('\n');
  const header = `--- a/config.yaml\n+++ b/config.yaml\n@@ -1,${lhs.length} +1,${rhs.length} @@`;
  const removed = lhs.map((l) => `-${l}`).join('\n');
  const added = rhs.map((l) => `+${l}`).join('\n');
  return `${header}\n${removed}\n${added}`;
}

export function DiffPane({ title, yaml, compareTo, editable, onChange, className }: DiffPaneProps) {
  const files = React.useMemo(() => {
    if (!compareTo) return null;
    const raw = buildUnifiedDiff(compareTo, yaml);
    try {
      return parseDiff(raw, { nearbySequences: 'zip' });
    } catch {
      return null;
    }
  }, [compareTo, yaml]);

  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col gap-s-2 rounded-card border border-border-subtle bg-surface-01 p-s-3',
        className
      )}
    >
      <header className="font-mono text-xs uppercase tracking-wider text-ink-faint">{title}</header>
      {editable ? (
        <textarea
          aria-label={`Edit ${title}`}
          value={yaml}
          onChange={(e) => onChange?.(e.target.value)}
          className="min-h-[260px] w-full resize-y rounded-input border border-border-subtle bg-ink-base p-s-2 font-mono text-xs text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      ) : files && files.length > 0 ? (
        <div className="max-h-[260px] overflow-auto rounded-input border border-border-subtle bg-ink-base font-mono text-xs">
          {files.map((file) => (
            <Diff
              key={`${file.oldRevision ?? 'a'}-${file.newRevision ?? 'b'}`}
              viewType="unified"
              diffType={file.type}
              hunks={file.hunks}
            >
              {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
            </Diff>
          ))}
        </div>
      ) : (
        <pre className="max-h-[260px] overflow-auto rounded-input border border-border-subtle bg-ink-base p-s-2 font-mono text-xs text-ink-secondary">
          {yaml}
        </pre>
      )}
    </section>
  );
}
