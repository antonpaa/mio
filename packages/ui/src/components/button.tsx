import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import type { ReactElement } from 'react';

export type ButtonVariant = 'primary' | 'quiet' | 'danger';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-teal text-surface shadow-cta hover:bg-teal-hover ' +
    'pressed:bg-teal-hover disabled:bg-muted disabled:shadow-none',
  quiet:
    'bg-transparent text-ink border border-border hover:bg-teal-tint ' +
    'hover:border-teal-chip-border pressed:bg-teal-tint disabled:text-muted',
  danger:
    'bg-transparent text-red border border-red-chip-border hover:bg-red-tint ' +
    'pressed:bg-red-tint disabled:text-muted disabled:border-border',
};

export interface ButtonProps extends AriaButtonProps {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
}

/** Pill button - the only button shape in Mio (docs/design/design-system.md). */
export function Button({ variant = 'primary', size = 'md', ...props }: ButtonProps): ReactElement {
  return (
    <AriaButton
      {...props}
      className={
        'inline-flex items-center justify-center gap-2 rounded-pill font-medium ' +
        'transition-colors cursor-pointer disabled:cursor-not-allowed ' +
        (size === 'md' ? 'px-5 py-2.5 text-sm ' : 'px-3.5 py-1.5 text-xs ') +
        VARIANT_CLASSES[variant] +
        (typeof props.className === 'string' ? ` ${props.className}` : '')
      }
    />
  );
}
