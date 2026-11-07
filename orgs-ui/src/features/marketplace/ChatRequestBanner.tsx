import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import { Alert, App, Button, Flex, Popconfirm, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type {
  ChatRequest,
  ChatRequestDeclineScope,
  Contact,
} from "typespec/orgs/marketplace/contacts/contacts";
import { isDefiniteRefusal } from "../../api/client";
import { chatRequestProblem } from "./problems";
import {
  useAcceptChatRequestMutation,
  useDeclineChatRequestMutation,
} from "./queries";

function OpeningLine({ request }: { request: ChatRequest }) {
  const { t } = useTranslation();
  return (
    <Typography.Text style={{ display: "block" }}>
      {t("marketplace.chatRequests.openingLine", {
        client: request.opening.consumer_domain,
        number: request.opening.opening_number,
      })}
    </Typography.Text>
  );
}

/** A request from the person awaiting the agency's answer (MKT-UI-008). */
function IncomingRequest({ request }: { request: ChatRequest }) {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const { message } = App.useApp();
  const acceptKey = useIdempotencyKey("accept-chat-request");
  const declineKey = useIdempotencyKey("decline-chat-request");
  const accept = useAcceptChatRequestMutation();
  const decline = useDeclineChatRequestMutation();
  const busy = accept.isPending || decline.isPending;

  const showProblem = (error: unknown) => {
    const problem = chatRequestProblem(error);
    message.error(
      problem === undefined
        ? t("marketplace.chatRequests.answerError")
        : t(`marketplace.chatRequests.problems.${problem}`),
    );
  };

  const handleAccept = async () => {
    try {
      await accept.mutateAsync({
        request: { request_id: request.request_id },
        key: acceptKey.current(),
      });
      acceptKey.rotate();
      message.success(
        t("marketplace.chatRequests.accepted", { name: request.hub_user_name }),
      );
    } catch (error) {
      if (isDefiniteRefusal(error)) acceptKey.rotate();
      showProblem(error);
    }
  };

  const handleDecline = async (scope: ChatRequestDeclineScope) => {
    try {
      await decline.mutateAsync({
        request: { request_id: request.request_id, scope },
        key: declineKey.current(),
      });
      declineKey.rotate();
      message.success(t("marketplace.chatRequests.declined"));
    } catch (error) {
      if (isDefiniteRefusal(error)) declineKey.rotate();
      showProblem(error);
    }
  };

  const days = request.window_days ?? 0;
  return (
    <Alert
      type="info"
      showIcon
      title={t("marketplace.chatRequests.incomingTitle", {
        name: request.hub_user_name,
        date: dateTime(request.sent_at),
      })}
      description={
        <Flex vertical gap="small">
          <OpeningLine request={request} />
          {request.note !== undefined && (
            <Typography.Paragraph style={{ whiteSpace: "pre-line", margin: 0 }}>
              {request.note}
            </Typography.Paragraph>
          )}
          <Flex gap="small" wrap="wrap">
            <Button
              type="primary"
              loading={accept.isPending}
              disabled={busy}
              onClick={() => void handleAccept()}
            >
              {t("marketplace.chatRequests.accept")}
            </Button>
            <Popconfirm
              title={t("marketplace.chatRequests.declineOpeningConfirm")}
              onConfirm={() => handleDecline("opening")}
              okText={t("marketplace.chatRequests.declineOpening")}
              cancelText={t("actions.cancel")}
            >
              <Button disabled={busy}>
                {t("marketplace.chatRequests.declineOpening")}
              </Button>
            </Popconfirm>
            <Popconfirm
              title={t("marketplace.chatRequests.declineSenderConfirm", {
                count: days,
              })}
              onConfirm={() => handleDecline("sender")}
              okText={t("marketplace.chatRequests.declineSender", {
                count: days,
              })}
              cancelText={t("actions.cancel")}
            >
              <Button disabled={busy}>
                {t("marketplace.chatRequests.declineSender", { count: days })}
              </Button>
            </Popconfirm>
          </Flex>
        </Flex>
      }
    />
  );
}

/** The state of the agency's latest request to the person (MKT-REQ-007). */
function SentRequest({ request }: { request: ChatRequest }) {
  const { t } = useTranslation();
  const { date, dateTime } = useDateTimeFormat();
  const sentBy =
    request.sent_by === undefined
      ? ""
      : t("marketplace.chatRequests.sentByLine", { email: request.sent_by });
  let title: string;
  let type: "info" | "warning" = "info";
  switch (request.state) {
    case "pending":
      title = t("marketplace.chatRequests.sentPending", {
        name: request.hub_user_name,
        date: dateTime(request.sent_at),
      });
      break;
    case "declined":
      type = "warning";
      title =
        request.decline_scope === "sender" &&
        request.blocked_until !== undefined
          ? t("marketplace.chatRequests.sentDeclinedSender", {
              name: request.hub_user_name,
              date: date(request.blocked_until),
            })
          : t("marketplace.chatRequests.sentDeclinedOpening", {
              name: request.hub_user_name,
            });
      break;
    case "expired":
      type = "warning";
      title = t("marketplace.chatRequests.sentExpired", {
        name: request.hub_user_name,
        date: dateTime(request.sent_at),
      });
      break;
    case "accepted":
      return null;
  }
  return (
    <Alert
      type={type}
      showIcon
      title={title}
      description={
        <>
          <OpeningLine request={request} />
          {sentBy !== "" && (
            <Typography.Text type="secondary">{sentBy}</Typography.Text>
          )}
        </>
      }
    />
  );
}

/** The Contact's latest chat request, above the conversation. */
export function ChatRequestBanner({ contact }: { contact: Contact }) {
  const request = contact.latest_request;
  if (request === undefined) return null;
  if (request.direction === "to_agency") {
    return request.state === "pending" ? (
      <IncomingRequest request={request} />
    ) : null;
  }
  return <SentRequest request={request} />;
}
