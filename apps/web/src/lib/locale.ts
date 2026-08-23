import { DEFAULT_LOCALE, isLocale, type Locale } from '@mio/i18n';

const STORAGE_KEY = 'mio.locale';

/** Pre-auth choice persists on the device; the account locale wins after
 * sign-in (the API returns it with the session). */
export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && isLocale(stored)) return stored;
  } catch {
    /* storage unavailable - fall through */
  }
  const nav = navigator.language.slice(0, 2).toLowerCase();
  return isLocale(nav) ? nav : DEFAULT_LOCALE;
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* fine - the choice just does not stick on this device */
  }
}
