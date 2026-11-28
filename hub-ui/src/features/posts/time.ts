import { editWindowMinutes } from "./constants";

const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** Formats a past moment as "3 hours ago" in the portal language. */
export function relativeTime(
  language: string,
  value: string,
  now: number = Date.now(),
): string {
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return format.format(Math.trunc(seconds / size), unit);
    }
  }
  return format.format(Math.min(seconds, 0), "second");
}

/** Reports whether the author can still edit the words (PST-POS-006). */
export function insideEditWindow(
  createdAt: string,
  now: number = Date.now(),
): boolean {
  return now - new Date(createdAt).getTime() < editWindowMinutes * 60_000;
}
