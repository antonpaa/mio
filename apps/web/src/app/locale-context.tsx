import { createContext, useContext } from 'react';
import type { Locale } from '@mio/i18n';

/** The active UI locale + setter, provided by the router root. Lives in
 * its own module so feature pages can consume it without importing the
 * route tree (no cycles - dependency-cruiser enforces this). */

export interface LocaleControls {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const LocaleContext = createContext<LocaleControls | null>(null);

export function useLocaleControls(): LocaleControls {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('locale context missing');
  return value;
}
