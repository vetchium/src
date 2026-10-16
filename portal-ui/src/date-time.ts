import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export type DateValue = string | Date;

export interface DateTimeFormat {
  /** A moment: date, hour and minute, and the viewer's time zone. */
  dateTime: (value: DateValue) => string;
  /** A moment to the second, for logs. */
  preciseDateTime: (value: DateValue) => string;
  /** A moment's time of day and the viewer's time zone. */
  time: (value: DateValue) => string;
  /** A moment's calendar date in the viewer's time zone, without the zone. */
  date: (value: DateValue, style?: "medium" | "long") => string;
}

/**
 * The browser's first preferred locale that writes the portal language, so an
 * English portal follows en-GB or en-IN conventions for date order and the
 * hour cycle. Otherwise the portal language, so names stay in the language of
 * the surrounding text.
 */
export function dateTimeLocale(
  language: string,
  browserLocales: readonly string[],
): string {
  let portal: Intl.Locale;
  try {
    portal = new Intl.Locale(language).maximize();
  } catch {
    return language;
  }
  for (const tag of browserLocales) {
    try {
      const browser = new Intl.Locale(tag);
      const maximized = browser.maximize();
      if (
        maximized.language === portal.language &&
        maximized.script === portal.script
      )
        return browser.toString();
    } catch {
      // Skip tags the runtime cannot parse.
    }
  }
  return language;
}

export function dateTimeFormat(
  language: string,
  browserLocales: readonly string[] = globalThis.navigator?.languages ?? [],
  timeZone?: string,
): DateTimeFormat {
  const locale = dateTimeLocale(language, browserLocales);
  const zone = timeZone === undefined ? {} : { timeZone };
  // dateStyle and timeStyle cannot be combined with timeZoneName, so the
  // moment formats spell out the fields of the medium date and short time.
  const day = {
    year: "numeric",
    month: "short",
    day: "numeric",
  } as const;
  const clock = {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  } as const;
  const formats = {
    dateTime: new Intl.DateTimeFormat(locale, { ...zone, ...day, ...clock }),
    preciseDateTime: new Intl.DateTimeFormat(locale, {
      ...zone,
      ...day,
      ...clock,
      second: "2-digit",
    }),
    time: new Intl.DateTimeFormat(locale, { ...zone, ...clock }),
    medium: new Intl.DateTimeFormat(locale, { ...zone, dateStyle: "medium" }),
    long: new Intl.DateTimeFormat(locale, { ...zone, dateStyle: "long" }),
  };
  const moment = (value: DateValue) =>
    typeof value === "string" ? new Date(value) : value;
  return {
    dateTime: (value) => formats.dateTime.format(moment(value)),
    preciseDateTime: (value) => formats.preciseDateTime.format(moment(value)),
    time: (value) => formats.time.format(moment(value)),
    date: (value, style = "medium") => formats[style].format(moment(value)),
  };
}

/** Formats moments for the portal language and the viewer's browser. */
export function useDateTimeFormat(): DateTimeFormat {
  const { i18n } = useTranslation();
  return useMemo(() => dateTimeFormat(i18n.language), [i18n.language]);
}
