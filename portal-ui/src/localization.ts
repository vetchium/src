export interface PortalLocaleConfiguration<Locale extends string> {
  supportedLocales: readonly Locale[];
  fallbackLocale: Locale;
  isSupportedLocale: (value: unknown) => value is Locale;
}

export function languageName(locale: string): string {
  return (
    new Intl.DisplayNames([locale], {
      type: "language",
      languageDisplay: "standard",
    }).of(locale) ?? locale
  );
}

export function shortLanguageName(locale: string): string {
  return new Intl.Locale(locale).language.toUpperCase();
}

export function frontendLocaleOptions<Locale extends string>(
  supportedLocales: readonly Locale[],
) {
  return supportedLocales.map((value) => ({
    value,
    label: languageName(value),
  }));
}

export function matchFrontendLocale<Locale extends string>(
  requestedLocales: readonly string[],
  supportedLocaleTags: readonly Locale[],
): Locale | undefined {
  const supportedLocales = supportedLocaleTags.map((tag) => ({
    tag,
    locale: new Intl.Locale(tag),
    maximized: new Intl.Locale(tag).maximize(),
  }));
  for (const requested of requestedLocales) {
    let locale: Intl.Locale;
    try {
      locale = new Intl.Locale(requested);
    } catch {
      continue;
    }
    const exact = supportedLocales.find(
      ({ locale: supported }) => supported.baseName === locale.baseName,
    );
    if (exact !== undefined) return exact.tag;

    const maximized = locale.maximize();
    const compatible = supportedLocales.find(
      ({ maximized: supported }) =>
        supported.language === maximized.language &&
        supported.script === maximized.script,
    );
    if (compatible !== undefined) return compatible.tag;
  }
  return undefined;
}
