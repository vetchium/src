import {
  type FrontendLocale,
  frontendLocaleValues,
} from "typespec/common/localization";

const supportedLocales = frontendLocaleValues.map((tag) => ({
  tag,
  locale: new Intl.Locale(tag),
  maximized: new Intl.Locale(tag).maximize(),
}));

export function languageName(locale: FrontendLocale): string {
  return (
    new Intl.DisplayNames([locale], {
      type: "language",
      languageDisplay: "standard",
    }).of(locale) ?? locale
  );
}

export function shortLanguageName(locale: FrontendLocale): string {
  return new Intl.Locale(locale).language.toUpperCase();
}

export function frontendLocaleOptions() {
  return frontendLocaleValues.map((value) => ({
    value,
    label: languageName(value),
  }));
}

export function matchFrontendLocale(
  requestedLocales: readonly string[],
): FrontendLocale | undefined {
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
