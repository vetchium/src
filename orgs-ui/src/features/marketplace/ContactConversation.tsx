import {
  DeleteOutlined,
  MessageOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Typography,
  theme,
} from "antd";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type Contact,
  type ConversationMessage,
  isMessageText,
  maxMessageLength,
} from "typespec/orgs/marketplace/contacts/contacts";
import { isDefiniteRefusal } from "../../api/client";
import { ChatRequestBanner } from "./ChatRequestBanner";
import { chatRequestProblem } from "./problems";
import {
  useConversationQuery,
  useDeleteMessageMutation,
  useMarkConversationReadMutation,
  useSendMessageMutation,
} from "./queries";
import { JobPicker, openingFromKey } from "./SuggestionSelect";

const codePoints = (value: string) => Array.from(value).length;

function MessageItem({
  message,
  agencyName,
  onDelete,
  deleting,
}: {
  message: ConversationMessage;
  agencyName: string;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const { token } = theme.useToken();
  const fromAgency = message.sender_type === "agency";
  const deletable = fromAgency && message.kind === "text" && !message.deleted;
  const opening =
    message.suggestion === undefined
      ? ""
      : t("marketplace.chatRequests.openingLine", {
          client: message.suggestion.consumer_domain,
          number: message.suggestion.opening_number,
        });

  let body: ReactNode;
  if (message.deleted) {
    body = (
      <Typography.Text type="secondary" italic>
        {t("marketplace.contacts.messageDeleted")}
      </Typography.Text>
    );
  } else if (message.kind === "text") {
    body = (
      <div
        style={{
          background: fromAgency
            ? token.colorPrimaryBg
            : token.colorFillTertiary,
          padding: `${token.paddingXS}px ${token.padding}px`,
          borderRadius: token.borderRadiusLG,
          whiteSpace: "pre-line",
        }}
      >
        {message.text}
      </div>
    );
  } else {
    body = (
      <Card size="small" style={{ maxWidth: 380 }}>
        <Typography.Text type="secondary" style={{ display: "block" }}>
          {t(
            message.kind === "request"
              ? "marketplace.chatRequests.messageLabel"
              : "marketplace.contacts.openingSuggestionLabel",
          )}
        </Typography.Text>
        <Typography.Text strong style={{ display: "block" }}>
          {opening}
        </Typography.Text>
        {message.note !== undefined && (
          <Typography.Paragraph style={{ whiteSpace: "pre-line", margin: 0 }}>
            {message.note}
          </Typography.Paragraph>
        )}
      </Card>
    );
  }

  return (
    <Flex
      vertical
      gap={4}
      align={fromAgency ? "flex-end" : "flex-start"}
      style={{
        alignSelf: fromAgency ? "flex-end" : "flex-start",
        maxWidth: "80%",
      }}
    >
      <Flex align="center" gap="small">
        <Typography.Text type="secondary" style={{ minWidth: 0 }}>
          {fromAgency && agencyName !== ""
            ? t("marketplace.contacts.agencySender", {
                sender: message.sender_display_name,
                agency: agencyName,
              })
            : message.sender_display_name}{" "}
          · {dateTime(message.sent_at)}
        </Typography.Text>
        {deletable && (
          <Popconfirm
            title={t("marketplace.contacts.deleteMessageConfirm")}
            onConfirm={onDelete}
            okText={t("actions.delete")}
            cancelText={t("actions.cancel")}
            okButtonProps={{ danger: true }}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deleting}
              aria-label={t("marketplace.contacts.deleteMessage")}
            />
          </Popconfirm>
        )}
      </Flex>
      {body}
    </Flex>
  );
}

/** The conversation with a Contact and its latest chat request
 * (MKT-UI-008). */
export function ContactConversation({
  contact,
  onRequestChat,
}: {
  contact: Contact;
  onRequestChat: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const handle = contact.handle;
  const sendKey = useIdempotencyKey("send-contact-msg");
  const deleteKey = useIdempotencyKey("delete-message");

  const conversationQuery = useConversationQuery(
    handle,
    contact.has_conversation,
    true,
  );
  const conversation = conversationQuery.data?.pages[0]?.conversation;
  const messages = (conversationQuery.data?.pages ?? [])
    .flatMap((page) => page.messages)
    .reverse();

  const send = useSendMessageMutation(handle);
  const remove = useDeleteMessageMutation(handle);
  const markRead = useMarkConversationReadMutation(handle);
  const [text, setText] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [openingKey, setOpeningKey] = useState<string>();
  const [deleting, setDeleting] = useState<number>();

  const markReadMutate = markRead.mutate;
  useEffect(() => {
    if (conversation?.agency_unread) markReadMutate();
  }, [conversation?.agency_unread, markReadMutate]);

  const firstName = contact.display_name.split(/\s+/)[0] ?? "";
  const partyDeleted =
    contact.account_deleted || conversation?.read_only_reason !== undefined;
  const writableUntil = conversation?.agency_may_write_until;
  const mayWrite =
    !partyDeleted &&
    writableUntil !== undefined &&
    Date.parse(writableUntil) > Date.now();

  const showProblem = (error: unknown, fallback: string) => {
    const problem = chatRequestProblem(error);
    message.error(
      problem === undefined
        ? fallback
        : t(`marketplace.chatRequests.problems.${problem}`),
    );
  };

  const sendText = async () => {
    if (!isMessageText(text)) return;
    try {
      await send.mutateAsync({
        request: { handle, text: text.trim() },
        key: sendKey.current(),
      });
      sendKey.rotate();
      setText("");
    } catch (error) {
      if (isDefiniteRefusal(error)) sendKey.rotate();
      showProblem(error, t("marketplace.contacts.messageSendError"));
    }
  };

  const sendSuggestion = async () => {
    const suggestion = openingFromKey(openingKey);
    if (suggestion === undefined) return;
    try {
      await send.mutateAsync({
        request: { handle, suggestion },
        key: sendKey.current(),
      });
      sendKey.rotate();
      message.success(t("marketplace.jobs.suggestSuccess"));
      setSuggesting(false);
      setOpeningKey(undefined);
    } catch (error) {
      if (isDefiniteRefusal(error)) sendKey.rotate();
      showProblem(error, t("marketplace.jobs.suggestError"));
    }
  };

  const deleteMessage = async (number: number) => {
    setDeleting(number);
    try {
      await remove.mutateAsync({
        request: { handle, message_number: number },
        key: deleteKey.current(),
      });
      deleteKey.rotate();
      message.success(t("marketplace.contacts.messageDeletedSuccess"));
    } catch (error) {
      if (isDefiniteRefusal(error)) deleteKey.rotate();
      message.error(t("marketplace.contacts.messageDeleteError"));
    } finally {
      setDeleting(undefined);
    }
  };

  return (
    <Flex vertical gap="middle">
      {partyDeleted && (
        <Alert
          type="warning"
          showIcon
          title={t("marketplace.contacts.accountDeletedBanner")}
        />
      )}
      <ChatRequestBanner contact={contact} />

      {contact.has_conversation && (
        <Flex
          vertical
          gap="middle"
          style={{ maxHeight: 520, overflowY: "auto", padding: "8px 4px" }}
        >
          {conversationQuery.hasNextPage && (
            <Button
              type="link"
              loading={conversationQuery.isFetchingNextPage}
              onClick={() => void conversationQuery.fetchNextPage()}
              style={{ alignSelf: "center" }}
            >
              {t("marketplace.contacts.loadEarlier")}
            </Button>
          )}
          {messages.map((item) => (
            <MessageItem
              key={item.message_number}
              message={item}
              agencyName={conversation?.recorded_agency_name ?? ""}
              deleting={deleting === item.message_number}
              onDelete={() => void deleteMessage(item.message_number)}
            />
          ))}
        </Flex>
      )}

      {mayWrite ? (
        <Card size="small">
          <Flex vertical gap="small">
            <Input.TextArea
              rows={3}
              aria-label={t("marketplace.contacts.writeMessagePlaceholder")}
              placeholder={t("marketplace.contacts.writeMessagePlaceholder")}
              value={text}
              onChange={(event) => setText(event.target.value)}
              count={{
                show: true,
                max: maxMessageLength,
                strategy: codePoints,
              }}
            />
            {/* The code-point count sits under the text area. */}
            <Flex
              justify="space-between"
              align="center"
              wrap="wrap"
              gap="small"
              style={{ marginTop: token.marginMD }}
            >
              <Button onClick={() => setSuggesting(true)}>
                {t("marketplace.contacts.suggestAnOpening")}
              </Button>
              <Button
                type="primary"
                icon={<SendOutlined />}
                disabled={!isMessageText(text)}
                loading={send.isPending && !suggesting}
                onClick={() => void sendText()}
              >
                {t("actions.send")}
              </Button>
            </Flex>
            <Typography.Text type="secondary">
              {t("marketplace.contacts.conversationPrivacyFooter", {
                name: firstName,
              })}
            </Typography.Text>
          </Flex>
        </Card>
      ) : (
        !partyDeleted &&
        contact.has_conversation &&
        contact.status === "conversation_closed" && (
          <Alert
            type="info"
            showIcon
            title={t("marketplace.chatRequests.closedNotice", {
              name: firstName,
            })}
            description={
              <Button
                size="small"
                icon={<MessageOutlined />}
                onClick={onRequestChat}
                style={{ marginTop: 8 }}
              >
                {t("marketplace.chatRequests.sendButton")}
              </Button>
            }
          />
        )
      )}

      <Modal
        open={suggesting}
        title={t("marketplace.contacts.suggestAnOpening")}
        onCancel={() => {
          setSuggesting(false);
          setOpeningKey(undefined);
        }}
        onOk={() => void sendSuggestion()}
        okText={t("marketplace.jobs.sendSuggestion")}
        okButtonProps={{
          disabled: openingKey === undefined,
          loading: send.isPending,
        }}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          {t("marketplace.contacts.selectOpeningToSuggestExplainer")}
        </Typography.Paragraph>
        <Form.Item label={t("marketplace.jobs.tableOpening")} required>
          <JobPicker
            value={openingKey}
            onChange={setOpeningKey}
            placeholder={t("marketplace.contacts.selectOpeningPlaceholder")}
            ariaLabel={t("marketplace.jobs.tableOpening")}
            notFound={t("marketplace.chatRequests.noJobs")}
            style={{ width: "100%" }}
          />
        </Form.Item>
      </Modal>
    </Flex>
  );
}
