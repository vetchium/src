import { SendOutlined } from "@ant-design/icons";
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
  Spin,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  type ChatRequest,
  type Contact,
  type ConversationSummary,
  isChatRequestNote,
  maxChatRequestNoteLength,
  type OpeningSuggestion,
} from "typespec/orgs/marketplace/contacts/contacts";
import { isDefiniteRefusal } from "../../api/client";
import { paths } from "../../app/paths";
import { chatRequestProblem } from "./problems";
import {
  useAcceptChatRequestMutation,
  useContactQuery,
  useConversationQuery,
  useSendChatRequestMutation,
  useViewHubProfileQuery,
} from "./queries";
import { JobPicker, openingFromKey } from "./SuggestionSelect";

const debounceMs = 300;

/** The Opening a request is about, as the dialog shows it when fixed. */
export interface FixedOpening {
  suggestion: OpeningSuggestion;
  title: string;
  client: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** The person, fixed when opened from a Contact or the profile view. */
  person?: { contactId: string } | { address: string };
  /** The Opening, fixed when opened from Job detail. */
  opening?: FixedOpening;
}

/**
 * Why the agency may not send a request now (MKT-REQ-003 in its order, then
 * MKT-REQ-008), as far as its own records show; the API decides the rest.
 */
export type Refusal =
  | { kind: "party-deleted" }
  | { kind: "incoming"; request: ChatRequest }
  | { kind: "exists"; sentAt?: string }
  | { kind: "conversation-open" }
  | { kind: "blocked-opening" }
  | { kind: "blocked-sender"; until: string }
  | { kind: "requests-off" };

export function chatRequestRefusal(
  contact: Contact,
  conversation: ConversationSummary | undefined,
  opening: OpeningSuggestion | undefined,
  now: number,
): Refusal | undefined {
  if (contact.account_deleted) return { kind: "party-deleted" };
  const latest = contact.latest_request;
  if (contact.pending_request_direction === "to_agency") {
    if (latest?.direction === "to_agency" && latest.state === "pending") {
      return { kind: "incoming", request: latest };
    }
    return { kind: "exists" };
  }
  if (contact.pending_request_direction === "to_hub_user") {
    return { kind: "exists", sentAt: latest?.sent_at };
  }
  const writableUntil = conversation?.agency_may_write_until;
  if (writableUntil !== undefined && Date.parse(writableUntil) > now) {
    return { kind: "conversation-open" };
  }
  if (latest?.direction === "to_hub_user" && latest.state === "declined") {
    if (
      latest.decline_scope === "sender" &&
      latest.blocked_until !== undefined &&
      Date.parse(latest.blocked_until) > now
    ) {
      return { kind: "blocked-sender", until: latest.blocked_until };
    }
    if (
      latest.decline_scope === "opening" &&
      opening !== undefined &&
      latest.opening.consumer_domain === opening.consumer_domain &&
      latest.opening.opening_number === opening.opening_number
    ) {
      return { kind: "blocked-opening" };
    }
  }
  if (contact.requests_off) return { kind: "requests-off" };
  return undefined;
}

function useSettled(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), debounceMs);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

const codePoints = (value: string) => Array.from(value).length;

/** "Send chat request" (MKT-UI-012). */
export function SendChatRequestModal({
  open,
  onClose,
  person,
  opening,
}: Props) {
  const { t } = useTranslation();
  const { date, dateTime } = useDateTimeFormat();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const sendKey = useIdempotencyKey("send-chat-request");
  const acceptKey = useIdempotencyKey("accept-chat-request");

  const [typed, setTyped] = useState("");
  const [chosenOpening, setChosenOpening] = useState<string>();
  const [note, setNote] = useState("");
  const typedAddress = useSettled(typed.trim().replace(/^@/, ""));

  const fixedContactId =
    person !== undefined && "contactId" in person ? person.contactId : "";
  const address =
    person === undefined
      ? typedAddress
      : "address" in person
        ? person.address
        : "";
  const profileQuery = useViewHubProfileQuery(address, open && address !== "");
  const contactId = fixedContactId || profileQuery.data?.contact?.contact_id;
  const contactQuery = useContactQuery(
    contactId ?? "",
    open && contactId !== undefined,
  );
  const contact = contactId === undefined ? undefined : contactQuery.data;
  const conversationQuery = useConversationQuery(
    contactId ?? "",
    open && contact?.has_conversation === true,
  );
  const conversation = conversationQuery.data?.pages[0]?.conversation;

  const send = useSendChatRequestMutation();
  const accept = useAcceptChatRequestMutation();

  const suggestion = opening?.suggestion ?? openingFromKey(chosenOpening);
  const name =
    contact?.display_name ?? profileQuery.data?.profile.display_name ?? "";
  const handle = contact?.handle ?? profileQuery.data?.profile.handle;
  const refusal =
    contact === undefined
      ? undefined
      : chatRequestRefusal(contact, conversation, suggestion, Date.now());
  const noteValid = note.trim() === "" || isChatRequestNote(note);
  const lookingUp =
    profileQuery.isFetching ||
    contactQuery.isFetching ||
    conversationQuery.isFetching;
  const personKnown = contact !== undefined || profileQuery.data !== undefined;

  const close = () => {
    setTyped("");
    setChosenOpening(undefined);
    setNote("");
    onClose();
  };

  const refusalText = (current: Refusal): string => {
    switch (current.kind) {
      case "incoming":
        return t("marketplace.chatRequests.refusal.incoming", { name });
      case "exists":
        return current.sentAt === undefined
          ? t("marketplace.chatRequests.refusal.existsIncoming", { name })
          : t("marketplace.chatRequests.refusal.exists", {
              name,
              date: dateTime(current.sentAt),
            });
      case "blocked-sender":
        return t("marketplace.chatRequests.refusal.blockedSender", {
          name,
          date: date(current.until),
        });
      case "conversation-open":
        return t("marketplace.chatRequests.refusal.conversationOpen", { name });
      case "blocked-opening":
        return t("marketplace.chatRequests.refusal.blockedOpening", { name });
      case "party-deleted":
        return t("marketplace.chatRequests.refusal.partyDeleted");
      case "requests-off":
        return t("marketplace.contacts.requestsOffReason");
    }
  };

  const showProblem = (error: unknown, fallback: string) => {
    const problem = chatRequestProblem(error);
    message.error(
      problem === undefined
        ? fallback
        : t(`marketplace.chatRequests.problems.${problem}`),
    );
  };

  const handleSend = async () => {
    if (suggestion === undefined || !noteValid) return;
    const trimmed = note.trim();
    try {
      const sent = await send.mutateAsync({
        request: {
          ...(contactId !== undefined
            ? { contact_id: contactId }
            : { address }),
          suggestion,
          ...(trimmed !== "" && { note: trimmed }),
        },
        key: sendKey.current(),
      });
      sendKey.rotate();
      message.success(
        t("marketplace.chatRequests.sent", { name: sent.hub_user_name }),
      );
      close();
      navigate(paths.contactDetail(sent.contact_id));
    } catch (error) {
      if (isDefiniteRefusal(error)) sendKey.rotate();
      showProblem(error, t("marketplace.chatRequests.sendError"));
    }
  };

  const handleAccept = async (request: ChatRequest) => {
    try {
      await accept.mutateAsync({
        request: { request_id: request.request_id },
        key: acceptKey.current(),
      });
      acceptKey.rotate();
      message.success(t("marketplace.chatRequests.accepted", { name }));
      close();
      navigate(paths.contactDetail(request.contact_id));
    } catch (error) {
      if (isDefiniteRefusal(error)) acceptKey.rotate();
      showProblem(error, t("marketplace.chatRequests.answerError"));
    }
  };

  const incoming = refusal?.kind === "incoming" ? refusal.request : undefined;
  const primary =
    incoming !== undefined ? (
      <Button
        key="accept"
        type="primary"
        loading={accept.isPending}
        onClick={() => void handleAccept(incoming)}
      >
        {t("marketplace.chatRequests.accept")}
      </Button>
    ) : (
      <Button
        key="send"
        type="primary"
        icon={<SendOutlined />}
        loading={send.isPending}
        disabled={
          !personKnown ||
          suggestion === undefined ||
          !noteValid ||
          refusal !== undefined ||
          lookingUp
        }
        onClick={() => void handleSend()}
      >
        {t("marketplace.chatRequests.send")}
      </Button>
    );

  return (
    <Modal
      open={open}
      onCancel={close}
      title={t("marketplace.chatRequests.dialogTitle")}
      width={560}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={close}>
          {t("actions.cancel")}
        </Button>,
        primary,
      ]}
    >
      <Form layout="vertical" component={false}>
        <Flex vertical gap="middle" style={{ marginTop: 8 }}>
          <Form.Item
            label={t("marketplace.chatRequests.personLabel")}
            required
            style={{ marginBottom: 0 }}
            {...(person === undefined && {
              extra: t("marketplace.chatRequests.personHelp"),
            })}
          >
            {person === undefined ? (
              <Input
                prefix="@"
                aria-label={t("marketplace.chatRequests.personLabel")}
                placeholder={t("marketplace.contacts.handlePlaceholder")}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                suffix={profileQuery.isFetching ? <Spin size="small" /> : null}
              />
            ) : (
              <Typography.Text strong>
                {name}
                {handle !== undefined && (
                  <Typography.Text type="secondary"> @{handle}</Typography.Text>
                )}
              </Typography.Text>
            )}
            {person === undefined &&
              profileQuery.isError &&
              typedAddress !== "" && (
                <Typography.Text type="danger" style={{ display: "block" }}>
                  {t("marketplace.chatRequests.problems.hub-user-not-found")}
                </Typography.Text>
              )}
            {person === undefined && profileQuery.data !== undefined && (
              <Typography.Text type="secondary" style={{ display: "block" }}>
                {profileQuery.data.profile.display_name}
              </Typography.Text>
            )}
          </Form.Item>

          <Form.Item
            label={t("marketplace.chatRequests.openingLabel")}
            required
            style={{ marginBottom: 0 }}
          >
            {opening !== undefined ? (
              <Card size="small">
                <Typography.Text strong style={{ display: "block" }}>
                  {opening.title}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {opening.client} · #{opening.suggestion.opening_number}
                </Typography.Text>
              </Card>
            ) : (
              <JobPicker
                value={chosenOpening}
                onChange={setChosenOpening}
                placeholder={t("marketplace.chatRequests.openingPlaceholder")}
                ariaLabel={t("marketplace.chatRequests.openingLabel")}
                notFound={t("marketplace.chatRequests.noJobs")}
                style={{ width: "100%" }}
              />
            )}
          </Form.Item>

          {incoming === undefined && (
            <Form.Item
              label={t("marketplace.chatRequests.noteLabel")}
              extra={t("marketplace.chatRequests.noteHelp")}
              validateStatus={noteValid ? undefined : "error"}
              style={{ marginBottom: 0 }}
            >
              <Input.TextArea
                rows={4}
                aria-label={t("marketplace.chatRequests.noteLabel")}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                count={{
                  show: true,
                  max: maxChatRequestNoteLength,
                  strategy: codePoints,
                }}
              />
            </Form.Item>
          )}

          {incoming !== undefined && (
            <Alert
              type="info"
              showIcon
              title={refusalText(refusal as Refusal)}
              description={
                incoming.note === undefined ? undefined : (
                  <Typography.Paragraph
                    style={{ whiteSpace: "pre-line", margin: 0 }}
                  >
                    {incoming.note}
                  </Typography.Paragraph>
                )
              }
            />
          )}
          {refusal !== undefined && refusal.kind !== "incoming" && (
            <Alert
              type="warning"
              showIcon
              title={refusalText(refusal)}
              {...(refusal.kind === "conversation-open" &&
                contactId !== undefined && {
                  description: (
                    <Button
                      size="small"
                      onClick={() => {
                        close();
                        navigate(paths.contactDetail(contactId));
                      }}
                    >
                      {t("marketplace.chatRequests.openConversation")}
                    </Button>
                  ),
                })}
            />
          )}
          {refusal === undefined && personKnown && (
            <Typography.Text type="secondary">
              {t("marketplace.chatRequests.explainer", {
                name: name || t("marketplace.contacts.personFallback"),
              })}
            </Typography.Text>
          )}
        </Flex>
      </Form>
    </Modal>
  );
}
