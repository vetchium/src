import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { Button, Card, Flex, List, Spin, Typography } from "antd";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { HubConversationSummary } from "typespec/hub/messages/messages";
import { APIErrorAlert } from "../../components/common/APIErrorAlert";
import { useConversationsQuery } from "./queries";

/**
 * What waits on the Hub user (MKT-HUB-001): chat requests to answer, then
 * conversations with unread messages, each opening its conversation. Shown
 * where no conversation is open.
 */
export function WaitingPanel({
  onOpen,
  hideWhenEmpty = false,
}: {
  onOpen: (agencyDomain: string) => void;
  hideWhenEmpty?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  const { date } = useDateTimeFormat();
  const requests = useConversationsQuery("requests_received", true, true);
  const unread = useConversationsQuery("unread", true, true);
  const requestItems = requests.data?.items ?? [];
  const unreadItems = unread.data?.items ?? [];
  const loading = requests.isPending || unread.isPending;
  const nothing =
    !loading && requestItems.length === 0 && unreadItems.length === 0;
  if (hideWhenEmpty && (loading || nothing)) return null;

  const section = (
    testId: string,
    title: string,
    items: HubConversationSummary[],
    detail: (item: HubConversationSummary) => string,
    action: string,
  ) =>
    items.length === 0 ? null : (
      <div data-testid={testId}>
        <List
          header={<Typography.Text strong>{title}</Typography.Text>}
          dataSource={items}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button
                  key="open"
                  type={action === "answer" ? "primary" : "default"}
                  aria-label={`${
                    action === "answer"
                      ? t("messages.answerRequest")
                      : t("messages.openConversation")
                  }: ${item.agency_display_name}`}
                  onClick={() => onOpen(item.agency_domain)}
                >
                  {action === "answer"
                    ? t("messages.answerRequest")
                    : t("messages.openConversation")}
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={item.agency_display_name}
                description={[item.agency_domain, detail(item)]
                  .filter((part) => part !== "")
                  .join(" · ")}
              />
            </List.Item>
          )}
        />
      </div>
    );

  return (
    <Card title={t("messages.waitingTitle")} data-testid="messages-waiting">
      {loading ? (
        <Flex justify="center">
          <Spin aria-label={t("messages.loading")} />
        </Flex>
      ) : (
        <Flex vertical gap="large">
          {requests.isError && <APIErrorAlert error={requests.error} />}
          {unread.isError && <APIErrorAlert error={unread.error} />}
          {nothing ? (
            <Typography.Text type="secondary">
              {t("messages.waitingNothing")} {t("messages.selectPrompt")}
            </Typography.Text>
          ) : null}
          {section(
            "messages-waiting-requests",
            t("messages.waitingRequests"),
            requestItems,
            (item) =>
              item.latest_request === undefined
                ? ""
                : t("messages.sentAt", {
                    date: date(item.latest_request.sent_at, "medium"),
                  }),
            "answer",
          )}
          {section(
            "messages-waiting-unread",
            t("messages.waitingUnread"),
            unreadItems,
            (item) => t("messages.unreadCount", { count: item.unread_count }),
            "open",
          )}
        </Flex>
      )}
    </Card>
  );
}
