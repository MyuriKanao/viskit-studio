import { cn } from '@/lib/utils';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-card bg-surface-02', className)}
      {...props}
    />
  );
}

export { Skeleton };
