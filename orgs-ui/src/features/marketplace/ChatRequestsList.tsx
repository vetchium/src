import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { Button, Flex, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type {
  ChatRequest,
  ChatRequestDirection,
  ChatRequestState,
} from "typespec/orgs/marketplace/contacts/contacts";
import { paths } from "../../app/paths";
import { useChatRequestsQuery } from "./queries";

const stateColors: Record<ChatRequestState, string> = {
  pending: "gold",
  accepted: "success",
  declined: "error",
  expired: "default",
};

export function ChatRequestStateTag({ state }: { state: ChatRequestState }) {
  const { t } = useTranslation();
  return (
    <Tag color={stateColors[state]}>
      {t(`marketplace.chatRequests.states.${state}`)}
    </Tag>
  );
}

/** One direction of the agency's chat requests, pending oldest first. */
function ChatRequestsTable({ direction }: { direction: ChatRequestDirection }) {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const query = useChatRequestsQuery(direction);
  const items = (query.data?.pages ?? []).flatMap((page) => page.items);

  const columns: ColumnsType<ChatRequest> = [
    {
      title: t("marketplace.contacts.tableName"),
      key: "person",
      render: (_, request) => (
        <div>
          <Link to={paths.contactDetail(request.contact_id)}>
            {request.hub_user_name}
          </Link>
          <Typography.Text
            type="secondary"
            style={{ display: "block", fontSize: 12 }}
          >
            @{request.hub_user_handle}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t("marketplace.chatRequests.openingLabel"),
      key: "opening",
      render: (_, request) =>
        `${request.opening.consumer_domain} · #${request.opening.opening_number}`,
    },
    {
      title: t("marketplace.chatRequests.noteColumn"),
      key: "note",
      ellipsis: true,
      render: (_, request) => request.note ?? "—",
    },
    ...(direction === "to_hub_user"
      ? [
          {
            title: t("marketplace.chatRequests.sentBy"),
            key: "sent_by",
            render: (_: unknown, request: ChatRequest) =>
              request.sent_by ?? "—",
          },
        ]
      : []),
    {
      title: t("marketplace.chatRequests.sentAt"),
      key: "sent_at",
      render: (_, request) => dateTime(request.sent_at),
    },
    {
      title: t("marketplace.chatRequests.state"),
      key: "state",
      render: (_, request) => <ChatRequestStateTag state={request.state} />,
    },
  ];

  return (
    <Flex vertical gap="small">
      <Typography.Title level={5} style={{ margin: 0 }}>
        {t(
          direction === "to_agency"
            ? "marketplace.chatRequests.toAgencyTitle"
            : "marketplace.chatRequests.toHubUserTitle",
        )}
      </Typography.Title>
      <Table<ChatRequest>
        rowKey={(request) => request.request_id}
        columns={columns}
        dataSource={items}
        loading={query.isFetching}
        pagination={false}
        scroll={{ x: "max-content" }}
        locale={{
          emptyText: t(
            direction === "to_agency"
              ? "marketplace.chatRequests.noneToAgency"
              : "marketplace.chatRequests.noneToHubUser",
          ),
        }}
      />
      {query.hasNextPage && (
        <Button
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
          style={{ alignSelf: "center" }}
        >
          {t("marketplace.chatRequests.showMore")}
        </Button>
      )}
    </Flex>
  );
}

/** The Contacts Requests tab (MKT-UI-007): requests to the agency, then
 * those it sent. */
export function ChatRequestsList() {
  return (
    <Flex vertical gap="large">
      <ChatRequestsTable direction="to_agency" />
      <ChatRequestsTable direction="to_hub_user" />
    </Flex>
  );
}
