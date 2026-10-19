import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { Alert, Button, Card, Flex, Timeline } from "antd";
import { useTranslation } from "react-i18next";
import type { ApplicationHistoryEntry } from "typespec/orgs/applications/applications";
import { stageKindLabel, stateLabel, useCalendarDate } from "./presentation";
import { useApplicationHistoryQuery } from "./queries";

interface Props {
  openingNumber: number;
  applicationNumber: number;
}

export function HistoryCard({ openingNumber, applicationNumber }: Props) {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const calendarDate = useCalendarDate();
  const query = useApplicationHistoryQuery(openingNumber, applicationNumber);
  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];

  const actor = (entry: ApplicationHistoryEntry) =>
    entry.actor_email ?? t(`applications.history.actors.${entry.actor}`);
  const describe = (entry: ApplicationHistoryEntry) => {
    const parts = [
      t(`applications.history.actions.${entry.action}`, {
        defaultValue: entry.action,
        state: stateLabel(t, entry.state),
      }),
    ];
    if (entry.stage) {
      parts.push(
        `${entry.stage.name} (${stageKindLabel(t, entry.stage.kind)})`,
      );
    }
    if (entry.interview_number !== undefined) {
      parts.push(
        t("applications.history.interview", { number: entry.interview_number }),
      );
    }
    if (entry.joined_on) parts.push(calendarDate(entry.joined_on));
    if (entry.separated_on) parts.push(calendarDate(entry.separated_on));
    parts.push(actor(entry));
    return parts.join(" · ");
  };

  return (
    <Card title={t("applications.history.title")} loading={query.isLoading}>
      {query.isError && (
        <Alert
          type="error"
          showIcon
          title={t("common.loadError")}
          action={
            <Button onClick={() => void query.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      )}
      <Timeline
        orientation="vertical"
        items={entries.map((entry) => ({
          key: `${entry.created_at}-${entry.version}-${entry.action}-${entry.interview_number ?? ""}`,
          title: dateTime(entry.created_at),
          content: describe(entry),
        }))}
      />
      {query.hasNextPage && (
        <Flex justify="center">
          <Button
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t("applications.history.more")}
          </Button>
        </Flex>
      )}
    </Card>
  );
}
