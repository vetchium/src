import {
  ArrowLeftOutlined,
  CompassOutlined,
  DeleteOutlined,
  ExclamationCircleFilled,
  MessageOutlined,
  ReloadOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  App,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Flex,
  Grid,
  Input,
  List,
  Popconfirm,
  Row,
  Space,
  Spin,
  Typography,
  theme,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import type {
  HubChatRequest,
  HubConversationSummary,
} from "typespec/hub/messages/messages";
import type { FrontendLocale } from "typespec/hub/types";
import type {
  ConversationMessage,
  MessageText,
} from "typespec/orgs/marketplace/contacts/contacts";
import type { OpeningNumber } from "typespec/orgs/openings/types";
import type { OrgDomain } from "typespec/orgs/types";
import { OrgUnavailableError } from "typespec/problem/hub/openings";
import { isProblem } from "../api/client";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { ActionError } from "../features/applications/ActionError";
import { conversationPath } from "../features/messages/paths";
import {
  type ChatRequestAnswer,
  chronological,
  useChatRequestAnswerAction,
  useChatRequestsQuery,
  useConversationDetailQuery,
  useConversationReplyAction,
  useConversationsQuery,
  useMarkConversationRead,
  useMessageDeleteAction,
} from "../features/messages/queries";
import { useOrgOpeningQuery } from "../features/openings/queries";
import { countryName } from "../i18n/countries";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "A";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1];
  if (!last) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase() || "A";
}

function isToday(isoString: string): boolean {
  const d = new Date(isoString);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

type OpeningRef = { consumer_domain: OrgDomain; opening_number: OpeningNumber };

const openingPath = (opening: OpeningRef) =>
  `/org/${encodeURIComponent(opening.consumer_domain)}/openings/${opening.opening_number}`;

/** An Opening by its title, linking to its page. */
function OpeningLink({ opening }: { opening: OpeningRef }) {
  const query = useOrgOpeningQuery(
    opening.consumer_domain,
    opening.opening_number,
  );
  const data = query.data?.opening;
  const title =
    data === undefined
      ? `#${opening.opening_number} · ${opening.consumer_domain}`
      : data.state === "published"
        ? (data.content.title ?? "")
        : data.title;
  return <Link to={openingPath(opening)}>{title}</Link>;
}

/**
 * An Opening suggested or requested in a conversation. Only an agency's card
 * offers to apply, crediting that agency; the Hub user's own request links to
 * the Opening.
 */
function OpeningSuggestionCard({
  suggestion,
  agencyDomain,
  label,
  note,
  apply = true,
}: {
  suggestion: OpeningRef;
  agencyDomain: OrgDomain;
  label?: string;
  note?: string;
  apply?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const opening = useOrgOpeningQuery(
    suggestion.consumer_domain,
    suggestion.opening_number,
    true,
  );

  if (opening.isPending) {
    return (
      <Card
        size="small"
        style={{ maxWidth: 440, borderRadius: 8, marginTop: 8 }}
      >
        <Spin aria-label={t("messages.loading")} />
      </Card>
    );
  }

  if (opening.isError || !opening.data) {
    return (
      <Card
        size="small"
        style={{ maxWidth: 440, borderRadius: 8, marginTop: 8 }}
      >
        <Typography.Text type="secondary">
          {t("messages.openingUnavailable")}
        </Typography.Text>
      </Card>
    );
  }

  const { org } = opening.data;
  const openingData = opening.data.opening;
  const title =
    openingData.state === "published"
      ? (openingData.content.title ?? "")
      : openingData.title;
  const content =
    openingData.state === "published" ? openingData.content : null;

  const parts: string[] = [org.display_name];
  if (content?.location_details) {
    parts.push(content.location_details);
  } else if (content?.employing_country) {
    parts.push(
      countryName(content.employing_country, i18n.language as FrontendLocale),
    );
  }
  if (content?.work_arrangement) {
    parts.push(t(`orgPage.workArrangements.${content.work_arrangement}`));
  }

  const applyUrl = `/org/${encodeURIComponent(suggestion.consumer_domain)}/openings/${suggestion.opening_number}/apply?referred_by=${encodeURIComponent(agencyDomain)}`;

  return (
    <Card size="small" style={{ maxWidth: 440, borderRadius: 8, marginTop: 8 }}>
      <Space orientation="vertical" size="middle" className="full-width">
        <Space>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            <CompassOutlined /> {label ?? t("messages.openingSuggestion")}
          </Typography.Text>
        </Space>
        <Space align="start" size="middle">
          <Avatar shape="square" size={40}>
            {initials(org.display_name)}
          </Avatar>
          <Space orientation="vertical" size={2}>
            <Link to={openingPath(suggestion)} style={{ fontSize: 15 }}>
              {title}
            </Link>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {parts.join(" · ")}
            </Typography.Text>
          </Space>
        </Space>
        {note !== undefined && (
          <Typography.Paragraph style={{ whiteSpace: "pre-wrap", margin: 0 }}>
            {note}
          </Typography.Paragraph>
        )}
        {apply ? (
          <Button type="primary" block onClick={() => navigate(applyUrl)}>
            {t("messages.viewAndApply")}
          </Button>
        ) : (
          <Button block onClick={() => navigate(openingPath(suggestion))}>
            {t("messages.viewOpening")}
          </Button>
        )}
      </Space>
    </Card>
  );
}

/** A pending request from the agency, with its answers (MKT-REQ-007). */
function IncomingRequest({
  summary,
  request,
  note,
}: {
  summary: HubConversationSummary;
  request: HubChatRequest;
  note?: string;
}) {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const { message } = App.useApp();
  const answer = useChatRequestAnswerAction(summary.agency_domain);
  const agency = summary.agency_display_name;
  const days = request.window_days;

  // An answer removes this notice before mutate's callbacks would run, so
  // the toast follows the promise; the hook keeps the error for retries.
  const respond = (value: ChatRequestAnswer, done: string) =>
    answer.mutateAsync(value).then(
      () => void message.success(done),
      () => undefined,
    );

  return (
    <Alert
      type="info"
      showIcon
      icon={<MessageOutlined />}
      title={t("messages.incomingTitle", { agency })}
      description={
        <Space orientation="vertical" size="middle" className="full-width">
          <Typography.Text type="secondary">
            {t("messages.sentAt", { date: dateTime(request.sent_at) })}
          </Typography.Text>
          <OpeningSuggestionCard
            suggestion={request.opening}
            agencyDomain={summary.agency_domain}
            label={t("messages.chatRequest")}
            {...(note !== undefined && { note })}
            apply={false}
          />
          <Typography.Text type="secondary">
            {t("messages.incomingHelp", { agency })}
          </Typography.Text>
          <Space wrap>
            <Button
              type="primary"
              loading={
                answer.isPending && answer.variables?.decline === undefined
              }
              disabled={answer.isPending}
              onClick={() =>
                respond(
                  { request_number: request.request_number },
                  t("messages.acceptedToast", { agency }),
                )
              }
            >
              {t("messages.accept")}
            </Button>
            <Popconfirm
              title={t("messages.declineOpeningConfirm", { agency })}
              okText={t("messages.declineOpening")}
              cancelText={t("common.cancel")}
              onConfirm={() =>
                respond(
                  {
                    request_number: request.request_number,
                    decline: "opening",
                  },
                  t("messages.declinedToast"),
                )
              }
            >
              <Button disabled={answer.isPending}>
                {t("messages.declineOpening")}
              </Button>
            </Popconfirm>
            <Popconfirm
              title={t("messages.declineSenderConfirm", {
                agency,
                count: days,
              })}
              okText={t("messages.declineSender", { count: days })}
              cancelText={t("common.cancel")}
              onConfirm={() =>
                respond(
                  { request_number: request.request_number, decline: "sender" },
                  t("messages.declinedToast"),
                )
              }
            >
              <Button disabled={answer.isPending}>
                {t("messages.declineSender", { count: days })}
              </Button>
            </Popconfirm>
          </Space>
          <ActionError error={answer.error} />
        </Space>
      }
    />
  );
}

/** The state of the Hub user's own latest request to the agency. */
function SentRequest({
  summary,
  request,
}: {
  summary: HubConversationSummary;
  request: HubChatRequest;
}) {
  const { t } = useTranslation();
  const { date, dateTime } = useDateTimeFormat();
  const agency = summary.agency_display_name;
  let title: string;
  switch (request.state) {
    case "pending":
      title = t("messages.sentPending", {
        agency,
        date: dateTime(request.sent_at),
      });
      break;
    case "declined":
      title =
        request.decline_scope === "sender" &&
        request.blocked_until !== undefined
          ? t("messages.sentDeclinedSender", {
              agency,
              date: date(request.blocked_until),
            })
          : t("messages.sentDeclinedOpening", { agency });
      break;
    case "expired":
      title = t("messages.sentExpired", {
        agency,
        date: dateTime(request.sent_at),
      });
      break;
    case "accepted":
      return null;
  }
  return (
    <Alert
      type={request.state === "pending" ? "info" : "warning"}
      showIcon
      title={title}
      description={<OpeningLink opening={request.opening} />}
    />
  );
}

/**
 * Why the Hub user may not write (MKT-CNV-010). A Hub user's request goes
 * only from an Opening page, so it links the Openings the agency suggested.
 */
function ClosedNotice({ summary }: { summary: HubConversationSummary }) {
  const { t } = useTranslation();
  const agency = summary.agency_display_name;
  const seen = new Set<string>();
  const openings = summary.suggestions.filter((suggestion) => {
    const key = `${suggestion.consumer_domain}/${suggestion.opening_number}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <Alert
      type="info"
      showIcon
      title={t("messages.closedTitle", { agency })}
      description={
        <Space orientation="vertical" size="small">
          <Typography.Text>
            {openings.length > 0
              ? t("messages.closedBody", { agency })
              : t("messages.closedBodyNoOpenings", { agency })}
          </Typography.Text>
          {openings.map((opening) => (
            <OpeningLink
              key={`${opening.consumer_domain}/${opening.opening_number}`}
              opening={opening}
            />
          ))}
        </Space>
      }
    />
  );
}

function hasIncoming(summary: HubConversationSummary): boolean {
  const request = summary.latest_request;
  return request?.direction === "to_hub_user" && request.state === "pending";
}

function listSnippet(
  summary: HubConversationSummary,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const request = summary.latest_request;
  if (hasIncoming(summary)) return t("messages.snippetIncoming");
  if (request?.direction === "to_agency" && request.state !== "accepted") {
    return t(`messages.snippetSent.${request.state}`);
  }
  return summary.suggestions.length > 0
    ? t("messages.snippetSuggestion")
    : t("messages.snippetConversation");
}

export function MessagesPage() {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const { date, dateTime, time } = useDateTimeFormat();
  const params = useParams();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;

  const selectedDomain = params.domain;
  const conversations = useConversationsQuery();
  const incoming = useChatRequestsQuery("to_hub_user");

  // MKT-HUB-001: requests awaiting the Hub user first, oldest first; then
  // conversations and sent requests by last activity.
  const items = useMemo(() => {
    const all = conversations.data?.items ?? [];
    const order = (incoming.data?.items ?? [])
      .filter((request) => request.state === "pending")
      .map((request) => request.agency_domain);
    const waiting = all
      .filter(hasIncoming)
      .sort(
        (a, b) =>
          (order.indexOf(a.agency_domain) + 1 || Number.MAX_SAFE_INTEGER) -
          (order.indexOf(b.agency_domain) + 1 || Number.MAX_SAFE_INTEGER),
      );
    return [...waiting, ...all.filter((item) => !hasIncoming(item))];
  }, [conversations.data, incoming.data]);

  const [replyText, setReplyText] = useState("");

  const summary = useMemo(
    () =>
      conversations.data?.items.find((c) => c.agency_domain === selectedDomain),
    [conversations.data, selectedDomain],
  );

  const detailQuery = useConversationDetailQuery(
    selectedDomain,
    Boolean(selectedDomain),
  );
  const markRead = useMarkConversationRead();
  const replyAction = useConversationReplyAction(selectedDomain ?? "");
  const deleteAction = useMessageDeleteAction(selectedDomain ?? "");

  // Auto mark read when opening an unread conversation
  useEffect(() => {
    if (selectedDomain && summary?.has_conversation && summary.unread) {
      markRead.mutate(selectedDomain);
    }
  }, [
    selectedDomain,
    summary?.has_conversation,
    summary?.unread,
    markRead.mutate,
  ]);

  const handleSendReply = () => {
    const trimmed = replyText.trim();
    if (!trimmed || replyAction.isPending) return;
    replyAction.mutate(trimmed as MessageText, {
      onSuccess: () => {
        setReplyText("");
      },
    });
  };

  const isReadOnly = summary?.read_only_reason !== undefined;
  // The list's window waits for the agency's pointer event; the conversation
  // read is live and omits the window once it has closed, so it wins once
  // loaded.
  const liveConversation = detailQuery.data?.pages[0]?.conversation;
  const writableUntil =
    liveConversation === undefined
      ? summary?.hub_may_write_until
      : liveConversation.hub_may_write_until;
  const mayWrite =
    writableUntil !== undefined && Date.parse(writableUntil) > Date.now();
  const latestRequest = summary?.latest_request;

  const isOrgUnavailable =
    detailQuery.isError &&
    isProblem(detailQuery.error, OrgUnavailableError.type);

  // Left column: list of conversations
  const conversationsList = (
    <Card styles={{ body: { padding: 0 } }} style={{ overflow: "hidden" }}>
      {conversations.isPending ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <Spin aria-label={t("messages.loading")} />
        </div>
      ) : conversations.isError ? (
        <div style={{ padding: 16 }}>
          <APIErrorAlert error={conversations.error} />
          <Button
            style={{ marginTop: 8 }}
            onClick={() => void conversations.refetch()}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <Typography.Paragraph type="secondary">
            {t("messages.empty")}
          </Typography.Paragraph>
        </div>
      ) : (
        <List
          itemLayout="horizontal"
          dataSource={items}
          renderItem={(item) => {
            const isSelected = item.agency_domain === selectedDomain;
            const timeLabel = isToday(item.last_activity_at)
              ? time(item.last_activity_at)
              : date(item.last_activity_at, "medium");

            return (
              <List.Item
                onClick={() => navigate(conversationPath(item.agency_domain))}
                style={{
                  padding: "16px 20px",
                  cursor: "pointer",
                  backgroundColor: isSelected
                    ? token.colorPrimaryBg
                    : undefined,
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  transition: "background-color 0.2s",
                }}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar shape="square" size={48}>
                      {initials(item.agency_display_name)}
                    </Avatar>
                  }
                  title={
                    <Typography.Text strong ellipsis>
                      {item.agency_display_name}
                    </Typography.Text>
                  }
                  description={
                    <div>
                      <Flex justify="space-between" align="center" gap="small">
                        <Typography.Text
                          type="secondary"
                          ellipsis
                          style={{ minWidth: 0, fontSize: 13 }}
                        >
                          {item.agency_domain}
                        </Typography.Text>
                        <Typography.Text
                          type="secondary"
                          style={{
                            fontSize: 12,
                            flexShrink: 0,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {timeLabel}
                        </Typography.Text>
                      </Flex>
                      <Flex
                        justify="space-between"
                        align="center"
                        gap="small"
                        style={{ marginTop: 4 }}
                      >
                        <Typography.Text
                          type="secondary"
                          ellipsis
                          style={{ minWidth: 0, fontSize: 13 }}
                        >
                          {listSnippet(item, t)}
                        </Typography.Text>
                        {(item.unread || hasIncoming(item)) && (
                          <Badge
                            count={
                              item.unread_count > 0 ? item.unread_count : 1
                            }
                            {...(!item.unread && { dot: true })}
                            style={{ backgroundColor: token.colorError }}
                          />
                        )}
                      </Flex>
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );

  // Right column / view: conversation detail
  const conversationView =
    selectedDomain && summary ? (
      <Card
        styles={{
          header: { padding: "12px 20px" },
          body: { padding: "20px 24px" },
        }}
        title={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
            }}
          >
            <Space align="center" size="middle">
              {isMobile && (
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => navigate("/messages")}
                  aria-label={t("common.back")}
                />
              )}
              <Avatar shape="square" size={40}>
                {initials(summary.agency_display_name)}
              </Avatar>
              <Space orientation="vertical" size={0}>
                <Typography.Text strong style={{ fontSize: 16 }}>
                  {summary.agency_display_name}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  {summary.agency_domain} · {t("messages.agency")}
                </Typography.Text>
              </Space>
            </Space>
          </div>
        }
      >
        {detailQuery.isPending ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <Spin aria-label={t("messages.loading")} />
          </div>
        ) : isOrgUnavailable ? (
          <Alert
            type="warning"
            showIcon
            icon={
              <ExclamationCircleFilled style={{ color: token.colorWarning }} />
            }
            title={t("messages.unavailableTitle")}
            description={t("messages.unavailableBody", {
              agency: summary.agency_display_name,
            })}
            action={
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void detailQuery.refetch()}
              >
                {t("messages.tryAgain")}
              </Button>
            }
          />
        ) : detailQuery.isError ? (
          <Space orientation="vertical" className="full-width">
            <APIErrorAlert error={detailQuery.error} />
            <Button onClick={() => void detailQuery.refetch()}>
              {t("common.retry")}
            </Button>
          </Space>
        ) : (
          <Space orientation="vertical" size="large" className="full-width">
            {latestRequest !== undefined && hasIncoming(summary) && (
              <IncomingRequest
                summary={summary}
                request={latestRequest}
                {...(detailQuery.data.pages[0]?.pending_request_note !==
                  undefined && {
                  note: detailQuery.data.pages[0].pending_request_note,
                })}
              />
            )}
            {latestRequest?.direction === "to_agency" && (
              <SentRequest summary={summary} request={latestRequest} />
            )}
            {summary.has_conversation && (
              <div
                style={{
                  minHeight: 280,
                  maxHeight: 520,
                  overflowY: "auto",
                  paddingRight: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                {detailQuery.hasNextPage && (
                  <Button
                    type="link"
                    loading={detailQuery.isFetchingNextPage}
                    onClick={() => void detailQuery.fetchNextPage()}
                    style={{ alignSelf: "center" }}
                  >
                    {t("messages.loadEarlier")}
                  </Button>
                )}
                {chronological(detailQuery.data.pages).map(
                  (msg: ConversationMessage) => {
                    const isCandidate = msg.sender_type === "hub_user";
                    const deletable =
                      isCandidate && msg.kind === "text" && !msg.deleted;

                    return (
                      <div
                        key={msg.message_number}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: isCandidate ? "flex-end" : "flex-start",
                        }}
                      >
                        <Space size={4} align="center">
                          <Typography.Text
                            type="secondary"
                            style={{ fontSize: 12 }}
                          >
                            {isCandidate
                              ? `${t("messages.you")} · ${dateTime(msg.sent_at)}`
                              : `${msg.sender_display_name} · ${dateTime(msg.sent_at)}`}
                          </Typography.Text>
                          {deletable && (
                            <Popconfirm
                              title={t("messages.deleteMessageConfirm", {
                                agency: summary.agency_display_name,
                              })}
                              okText={t("messages.deleteAction")}
                              cancelText={t("common.cancel")}
                              okButtonProps={{ danger: true }}
                              onConfirm={() =>
                                deleteAction.mutate(msg.message_number)
                              }
                            >
                              <Button
                                type="text"
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                loading={
                                  deleteAction.isPending &&
                                  deleteAction.variables === msg.message_number
                                }
                                aria-label={t("messages.deleteMessage")}
                              />
                            </Popconfirm>
                          )}
                        </Space>
                        {msg.deleted && (
                          <Typography.Text type="secondary" italic>
                            {t("messages.messageDeleted")}
                          </Typography.Text>
                        )}
                        {msg.text && (
                          <div
                            style={{
                              backgroundColor: isCandidate
                                ? token.colorPrimary
                                : token.colorFillSecondary,
                              color: isCandidate
                                ? token.colorTextLightSolid
                                : token.colorText,
                              padding: "10px 16px",
                              borderRadius: 12,
                              maxWidth: "80%",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              fontSize: 14,
                              lineHeight: 1.5,
                            }}
                          >
                            {msg.text}
                          </div>
                        )}
                        {msg.suggestion && msg.kind === "request" && (
                          <OpeningSuggestionCard
                            suggestion={msg.suggestion}
                            agencyDomain={summary.agency_domain}
                            label={t("messages.chatRequest")}
                            {...(msg.note !== undefined && { note: msg.note })}
                            apply={msg.sender_type === "agency"}
                          />
                        )}
                        {msg.suggestion && msg.kind === "suggestion" && (
                          <OpeningSuggestionCard
                            suggestion={msg.suggestion}
                            agencyDomain={summary.agency_domain}
                          />
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            )}

            {/* Reply section */}
            {isReadOnly ? (
              <Space orientation="vertical" className="full-width">
                <Alert
                  type="info"
                  showIcon
                  title={t("messages.readOnlyTitle")}
                  description={t("messages.readOnlyBody")}
                />
                <ActionError error={deleteAction.error} />
              </Space>
            ) : !mayWrite ? (
              <Space orientation="vertical" className="full-width">
                {summary.has_conversation && !hasIncoming(summary) && (
                  <ClosedNotice summary={summary} />
                )}
                <ActionError error={deleteAction.error} />
              </Space>
            ) : (
              <Space
                orientation="vertical"
                size="middle"
                className="full-width"
              >
                <Input.TextArea
                  rows={4}
                  maxLength={5000}
                  placeholder={t("messages.replyPlaceholder")}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    {t("messages.emailPrivateNotice")}
                  </Typography.Text>
                  <Space align="center" size="middle">
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      {replyText.length} / 5000
                    </Typography.Text>
                    <Button
                      type="primary"
                      icon={<SendOutlined />}
                      disabled={!replyText.trim() || replyAction.isPending}
                      loading={replyAction.isPending}
                      onClick={handleSendReply}
                    >
                      {t("messages.send")}
                    </Button>
                  </Space>
                </div>
                <ActionError error={replyAction.error} />
                <ActionError error={deleteAction.error} />
              </Space>
            )}
          </Space>
        )}
      </Card>
    ) : (
      <Card
        style={{
          minHeight: 400,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Typography.Paragraph
          type="secondary"
          style={{ margin: 0, textAlign: "center" }}
        >
          {t("messages.selectPrompt")}
        </Typography.Paragraph>
      </Card>
    );

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("messages.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("messages.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("messages.subtitle")}
        </Typography.Text>
      </div>

      {isMobile ? (
        selectedDomain ? (
          conversationView
        ) : (
          conversationsList
        )
      ) : (
        <Row gutter={[24, 24]}>
          <Col xs={24} md={10} xl={8}>
            {conversationsList}
          </Col>
          <Col xs={24} md={14} xl={16}>
            {conversationView}
          </Col>
        </Row>
      )}
    </Space>
  );
}
