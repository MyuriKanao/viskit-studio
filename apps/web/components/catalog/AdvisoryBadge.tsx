import { cn } from '@/lib/utils';

/**
 * Surfaces ADR-009 advisory state: en-locale kits run under
 * warning-only compliance, so the Catalog has to make that visible at a
 * glance (plan AC #3: "advisory=true kits are surfaced clearly").
 *
 * Pure presentational — the parent decides whether to render based on
 * `kit.locale` ∈ {'en', 'en-US', ...}.
 */
export function AdvisoryBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-s-1 rounded-pill border border-warning/40 bg-warning/10 px-s-2 py-px text-[10px] font-medium uppercase tracking-wide text-warning',
        className
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />
      <span>{label}</span>
    </span>
  );
}
