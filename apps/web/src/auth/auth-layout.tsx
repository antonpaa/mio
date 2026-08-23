import type { ReactElement, ReactNode } from 'react';
import { useIntl } from 'react-intl';
import { LOCALES, type Locale } from '@mio/i18n';
import { LanguageSwitcher, MioLockup } from '@mio/ui';

/** The shared frame for L1-L7: lockup, card column, pre-auth language switch. */
export function AuthLayout({
  locale,
  onLocaleChange,
  children,
}: {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  children: ReactNode;
}): ReactElement {
  const intl = useIntl();
  return (
    <div className="flex min-h-dvh flex-col items-center bg-paper px-4 py-10">
      <div className="mb-8 flex w-full max-w-sm items-center justify-between">
        <MioLockup markSize={36} />
        <LanguageSwitcher
          locales={LOCALES}
          current={locale}
          onChange={(next) => onLocaleChange(next as Locale)}
          label={intl.formatMessage({ id: 'language.label' })}
        />
      </div>
      <div className="w-full max-w-sm rounded-card border border-black/5 bg-surface p-6 shadow-resting">
        {children}
      </div>
    </div>
  );
}
