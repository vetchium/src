import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  App,
  Button,
  Card,
  Flex,
  Input,
  List,
  Modal,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  type HubSendChatRequestRequest,
  maxHubChatRequestsPerDay,
  type OpeningAgency,
} from "typespec/hub/messages/messages";
import {
  maxChatRequestNoteLength,
  normalizeChatRequestNote,
} from "typespec/orgs/marketplace/contacts/contacts";
import { ActionError } from "../applications/ActionError";
import {
  useChatRequestAnswerAction,
  useOpeningAgenciesQuery,
  useSendChatRequestAction,
} from "./queries";

interface OpeningRef {
  domain: string;
  openingNumber: number;
  title: string;
  orgName: string;
}

const codePoints = (text: string) => Array.from(text).length;

function conversationPath(contactId: string): string {
  return `/messages/${encodeURIComponent(contactId)}`;
}

function AcceptRequest({ agency }: { agency: OpeningAgency }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const answer = useChatRequestAnswerAction(agency.contact_id ?? "");
  const request = agency.latest_request;
  const contactId = agency.contact_id;
  if (request === undefined || contactId === undefined) return null;
  return (
    <Flex vertical gap="small">
      <Flex gap="small" wrap="wrap">
        <Button onClick={() => navigate(conversationPath(contactId))}>
          {t("orgPage.agencies.viewRequest")}
        </Button>
        <Button
          type="primary"
          loading={answer.isPending}
          onClick={() =>
            // Accepting turns this row into "Open conversation" before
            // mutate's callbacks would run, so the toast follows the promise.
            void answer.mutateAsync({ request_id: request.request_id }).then(
              () =>
                void message.success(
                  t("orgPage.agencies.accepted", {
                    agency: agency.agency_display_name,
                  }),
                ),
              () => undefined,
            )
          }
        >
          {t("orgPage.agencies.accept")}
        </Button>
      </Flex>
      <ActionError error={answer.error} />
    </Flex>
  );
}

function AgencyState({
  agency,
  onRequest,
}: {
  agency: OpeningAgency;
  onRequest: () => void;
}) {
  const { t } = useTranslation();
  const { date, dateTime } = useDateTimeFormat();
  const navigate = useNavigate();
  const request = agency.latest_request;
  const requestButton = (
    <Button type="primary" onClick={onRequest}>
      {t("orgPage.agencies.requestChat")}
    </Button>
  );

  switch (agency.chat_state) {
    case "none":
      return requestButton;
    case "closed":
      return (
        <Flex gap="small" wrap="wrap">
          {agency.contact_id !== undefined && (
            <Button
              onClick={() =>
                navigate(conversationPath(agency.contact_id ?? ""))
              }
            >
              {t("orgPage.agencies.viewConversation")}
            </Button>
          )}
          {requestButton}
        </Flex>
      );
    case "open":
      return agency.contact_id === undefined ? null : (
        <Button
          type="primary"
          onClick={() => navigate(conversationPath(agency.contact_id ?? ""))}
        >
          {t("orgPage.agencies.openConversation")}
        </Button>
      );
    case "request_sent":
      return (
        <Flex vertical align="flex-start" gap={4}>
          <Tag color="gold">{t("orgPage.agencies.pending")}</Tag>
          {request !== undefined && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("orgPage.agencies.sentAt", {
                date: dateTime(request.sent_at),
              })}
            </Typography.Text>
          )}
        </Flex>
      );
    case "request_received":
      return <AcceptRequest agency={agency} />;
    case "declined":
      return (
        <Tag color="warning">
          {request?.decline_scope === "sender" &&
          request.blocked_until !== undefined
            ? t("orgPage.agencies.declinedSender", {
                date: date(request.blocked_until),
              })
            : t("orgPage.agencies.declinedOpening")}
        </Tag>
      );
  }
}

function RequestChatModal({
  agency,
  opening,
  onClose,
}: {
  agency: OpeningAgency | undefined;
  opening: OpeningRef;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const send = useSendChatRequestAction();
  const [note, setNote] = useState("");
  const trimmed = normalizeChatRequestNote(note);
  const tooLong = codePoints(trimmed) > maxChatRequestNoteLength;

  const close = () => {
    setNote("");
    send.reset();
    onClose();
  };

  const submit = () => {
    if (agency === undefined || tooLong) return;
    const request: HubSendChatRequestRequest = {
      domain: opening.domain,
      opening_number: opening.openingNumber,
      agency_domain: agency.agency_domain,
      ...(trimmed !== "" && { note: trimmed }),
    };
    send.mutate(request, {
      onSuccess: () => {
        void message.success(
          t("orgPage.agencies.sent", { agency: agency.agency_display_name }),
        );
        close();
      },
    });
  };

  return (
    <Modal
      open={agency !== undefined}
      onCancel={close}
      title={t("orgPage.agencies.dialogTitle", {
        agency: agency?.agency_display_name ?? "",
      })}
      okText={t("orgPage.agencies.send")}
      cancelText={t("common.cancel")}
      onOk={submit}
      okButtonProps={{ loading: send.isPending, disabled: tooLong }}
      destroyOnHidden
    >
      <Flex vertical gap="middle">
        <div>
          <Typography.Text type="secondary" style={{ display: "block" }}>
            {t("orgPage.agencies.openingLabel")}
          </Typography.Text>
          <Typography.Text strong>{opening.title}</Typography.Text>
          <Typography.Text type="secondary" style={{ display: "block" }}>
            {opening.orgName}
          </Typography.Text>
        </div>
        <div>
          <label htmlFor="chat-request-note">
            <Typography.Text>{t("orgPage.agencies.noteLabel")}</Typography.Text>
          </label>
          <Input.TextArea
            id="chat-request-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            autoSize={{ minRows: 3, maxRows: 8 }}
            count={{
              show: true,
              max: maxChatRequestNoteLength,
              strategy: codePoints,
            }}
            status={tooLong ? "error" : undefined}
            style={{ marginTop: 4 }}
          />
          <Typography.Text
            type="secondary"
            style={{ display: "block", marginTop: 20 }}
          >
            {t("orgPage.agencies.noteHelp")}
          </Typography.Text>
        </div>
        <Typography.Text type="secondary">
          {t("orgPage.agencies.dialogHelp", {
            agency: agency?.agency_display_name ?? "",
            count: maxHubChatRequestsPerDay,
          })}
        </Typography.Text>
        <ActionError error={send.error} />
      </Flex>
    </Modal>
  );
}

/** The agencies recruiting for a `published` Opening and the user's chat
 * with each (MKT-HUB-005); hidden when there are none. */
export function OpeningAgencies({ opening }: { opening: OpeningRef }) {
  const { t } = useTranslation();
  const query = useOpeningAgenciesQuery(
    opening.domain,
    opening.openingNumber,
    true,
  );
  const [requestTo, setRequestTo] = useState<OpeningAgency>();

  if (query.isPending) return null;
  if (query.isError) {
    return (
      <Card title={t("orgPage.agencies.title")}>
        <ActionError error={query.error} />
      </Card>
    );
  }
  if (query.data.items.length === 0) return null;

  return (
    <Card title={t("orgPage.agencies.title")}>
      <Typography.Paragraph type="secondary">
        {t("orgPage.agencies.intro")}
      </Typography.Paragraph>
      <List
        dataSource={query.data.items}
        rowKey={(agency) => agency.agency_domain}
        renderItem={(agency) => (
          <List.Item>
            <Flex
              justify="space-between"
              align="center"
              gap="middle"
              wrap="wrap"
              style={{ width: "100%" }}
            >
              <div style={{ minWidth: 0 }}>
                <Typography.Text strong style={{ display: "block" }}>
                  {agency.agency_display_name}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {agency.agency_domain}
                </Typography.Text>
              </div>
              <AgencyState
                agency={agency}
                onRequest={() => setRequestTo(agency)}
              />
            </Flex>
          </List.Item>
        )}
      />
      <RequestChatModal
        agency={requestTo}
        opening={opening}
        onClose={() => setRequestTo(undefined)}
      />
    </Card>
  );
}
