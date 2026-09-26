import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/** Formats an RFC 3339 wire timestamp in the portal's current language. */
export function useDateTimeFormat(): (value: string) => string {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return (value: string) => format.format(new Date(value));
  }, [i18n.language]);
}
