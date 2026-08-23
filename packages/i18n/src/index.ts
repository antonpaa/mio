/**
 * The three product locales (docs/glossary.md). UI strings resolve through
 * react-intl per ADR-0004; survey content is data and never passes through
 * this package.
 */

export const LOCALES = ['en', 'fi', 'sv'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
