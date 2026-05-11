import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-s-2 whitespace-nowrap rounded-input text-sm font-medium ring-offset-ink-base transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-accent text-ink-base-l hover:bg-accent-soft',
        destructive: 'bg-danger text-ink-base-l hover:bg-danger/90',
        outline:
          'border border-border-strong bg-transparent text-ink-primary hover:bg-surface-02 hover:text-ink-primary',
        secondary: 'bg-surface-02 text-ink-primary hover:bg-surface-03',
        ghost: 'hover:bg-surface-02 hover:text-ink-primary',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-s-4 py-s-2',
        sm: 'h-9 rounded-input px-s-3',
        lg: 'h-11 rounded-input px-s-5',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
