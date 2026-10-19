import { dateTimeFormat } from "@vetchium/portal-ui/date-time";
import type { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CountryCode } from "typespec/common/localization";
import type {
  ApplicationState,
  CalendarDate,
} from "typespec/orgs/applications/applications";
import type { PipelineStage } from "typespec/orgs/hiring/pipelines";

/** Candidacies in the pipeline, which the Candidates tab lists by default. */
export const activeStates = [
  "in_pipeline",
  "offered",
  "offer_accepted",
] as const satisfies readonly ApplicationState[];

/** Finished candidacies, each under its own tab of the Candidates view. */
export const finishedStates = [
  "joined",
  "not_progressing",
  "withdrawn",
  "offer_declined",
  "did_not_join",
] as const satisfies readonly ApplicationState[];

export const stateColors: Readonly<
  Record<ApplicationState, string | undefined>
> = {
  submitted: "processing",
  in_pipeline: "blue",
  offered: "gold",
  offer_accepted: "lime",
  joined: "success",
  offer_declined: undefined,
  did_not_join: undefined,
  not_progressing: undefined,
  withdrawn: undefined,
};

export function stateLabel(t: TFunction, state: string): string {
  return t(`applications.states.${state}`, { defaultValue: state });
}

export function stageKindLabel(t: TFunction, kind: string): string {
  return t(`applications.stageKinds.${kind}`, { defaultValue: kind });
}

/** Retention replaces the stored name; the portal writes its own wording. */
export function applicantName(
  t: TFunction,
  application: { display_name: string; removed: boolean },
): string {
  return application.removed
    ? t("applications.removedApplicant")
    : application.display_name;
}

export function stageText(t: TFunction, stage: PipelineStage): string {
  return `${stage.name} · ${stageKindLabel(t, stage.kind)}`;
}

export function countryName(
  language: string,
  code: CountryCode | string,
): string {
  try {
    return new Intl.DisplayNames(language, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A calendar date has no zone, so it formats in UTC, never the viewer's. */
export function useCalendarDate(): (value: CalendarDate) => string {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const format = dateTimeFormat(i18n.language, undefined, "UTC");
    return (value) => format.date(`${value}T00:00:00Z`);
  }, [i18n.language]);
}

/** Today's UTC date, which the API judges joining dates against. */
export function utcToday(): CalendarDate {
  return new Date().toISOString().slice(0, 10);
}

/** A `YYYY-MM` profile month in UTC, never shifted by the viewer's zone. */
export function useMonthFormat(): (value: string) => string {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language, {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return (value) => format.format(new Date(`${value}-01T00:00:00Z`));
  }, [i18n.language]);
}

export function languageName(language: string, tag: string): string {
  try {
    return new Intl.DisplayNames(language, { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** The `datetime-local` text for a moment, in the viewer's zone. */
export function toLocalInput(iso: string): string {
  const moment = new Date(iso);
  const shifted = new Date(
    moment.getTime() - moment.getTimezoneOffset() * 60000,
  );
  return shifted.toISOString().slice(0, 16);
}

/** The moment a `datetime-local` value names in the viewer's zone, as the
 * UTC instant the API takes; `undefined` while the field is incomplete. */
export function fromLocalInput(value: string): string | undefined {
  const moment = new Date(value);
  return Number.isNaN(moment.getTime()) ? undefined : moment.toISOString();
}

/** The viewer's time zone name, shown beside time inputs. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
