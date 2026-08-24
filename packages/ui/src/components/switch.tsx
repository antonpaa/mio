import type { ReactElement, ReactNode } from 'react';
import { Switch as AriaSwitch, type SwitchProps as AriaSwitchProps } from 'react-aria-components';

/** The canvas toggle switch: pill track, teal when on. React Aria carries
 * the keyboard and switch-role semantics; the label is the accessible
 * name and always visible. */
export function Switch({
  label,
  ...props
}: Omit<AriaSwitchProps, 'children' | 'className'> & { label: ReactNode }): ReactElement {
  return (
    <AriaSwitch {...props} className="flex cursor-pointer items-center gap-3 text-sm text-ink">
      {({ isSelected }) => (
        <>
          <span
            aria-hidden
            className={`flex h-6 w-10 shrink-0 items-center rounded-pill border p-0.5 transition-colors ${
              isSelected
                ? 'justify-end border-teal bg-teal'
                : 'justify-start border-border bg-surface-sunken'
            }`}
          >
            <span className="h-4.5 w-4.5 rounded-pill bg-surface shadow-resting" />
          </span>
          {label}
        </>
      )}
    </AriaSwitch>
  );
}
