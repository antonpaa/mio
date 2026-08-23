import type { ReactElement } from 'react';

export interface LanguageSwitcherProps {
  locales: readonly string[];
  current: string;
  onChange: (locale: string) => void;
  /** Accessible group label, localized by the caller. */
  label: string;
}

/** EN FI SV - present pre-authentication on every login screen (L1-L7). */
export function LanguageSwitcher({
  locales,
  current,
  onChange,
  label,
}: LanguageSwitcherProps): ReactElement {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-1">
      {locales.map((locale) => {
        const active = locale === current;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => onChange(locale)}
            aria-pressed={active}
            className={
              'rounded-pill px-2.5 py-1 text-xs font-semibold uppercase transition-colors ' +
              (active
                ? 'bg-teal-tint text-teal'
                : 'text-muted hover:bg-surface-sunken hover:text-ink')
            }
          >
            {locale}
          </button>
        );
      })}
    </div>
  );
}
