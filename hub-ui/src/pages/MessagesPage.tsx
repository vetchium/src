import {
  ArrowLeftOutlined,
  CompassOutlined,
  DeleteOutlined,
  ExclamationCircleFilled,
  ReloadOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Grid,
  Input,
  List,
  Popconfirm,
  Row,
  Space,
  Spin,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import type {
  ContactID,
  ConversationMessage,
  MessageText,
} from "typespec/orgs/marketplace/contacts/contacts";
import type { OpeningNumber } from "typespec/orgs/openings/types";
import type { OrgDomain } from "typespec/orgs/types";
import { OrgUnavailableError } from "typespec/problem/hub/openings";
import { isProblem } from "../api/client";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { ActionError } from "../features/applications/ActionError";
import {
  chronological,
  useConversationDeleteAction,
  useConversationDetailQuery,
  useConversationReplyAction,
  useConversationsQuery,
  useMarkConversationRead,
} from "../features/messages/queries";
import { useOrgOpeningQuery } from "../features/openings/queries";
import { useMyInfoQuery } from "../features/profile/queries";

const avatarColors = [
  "#1677ff",
  "#722ed1",
  "#13c2c2",
  "#52c41a",
  "#eb2f96",
  "#fa8c16",
  "#faad14",
  "#2f54eb",
];

function avatarColor(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return avatarColors[Math.abs(hash) % avatarColors.length] ?? "#1677ff";
}

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

function OpeningSuggestionCard({
  suggestion,
  agencyDomain,
}: {
  suggestion: { consumer_domain: OrgDomain; opening_number: OpeningNumber };
  agencyDomain: OrgDomain;
}) {
  const { t } = useTranslation();
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
    parts.push(content.employing_country);
  }
  if (content?.work_arrangement) {
    parts.push(
      t(
        `openings.arrangement.${content.work_arrangement}`,
        content.work_arrangement,
      ),
    );
  }

  const applyUrl = `/org/${encodeURIComponent(suggestion.consumer_domain)}/openings/${suggestion.opening_number}/apply?referred_by=${encodeURIComponent(agencyDomain)}`;

  return (
    <Card
      size="small"
      style={{
        maxWidth: 440,
        borderRadius: 8,
        border: "1px solid #d9d9d9",
        backgroundColor: "#ffffff",
        marginTop: 8,
      }}
    >
      <Space orientation="vertical" size="middle" className="full-width">
        <Space>
          <CompassOutlined style={{ color: "#8c8c8c" }} />
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {t("messages.openingSuggestion")}
          </Typography.Text>
        </Space>
        <Space align="start" size="middle">
          <Avatar
            shape="square"
            size={40}
            style={{
              backgroundColor: avatarColor(org.display_name),
              fontWeight: "bold",
            }}
          >
            {initials(org.display_name)}
          </Avatar>
          <Space orientation="vertical" size={2}>
            <Typography.Text strong style={{ fontSize: 15 }}>
              {title}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {parts.join(" · ")}
            </Typography.Text>
          </Space>
        </Space>
        <Button type="primary" block onClick={() => navigate(applyUrl)}>
          {t("messages.viewAndApply")}
        </Button>
      </Space>
    </Card>
  );
}

export function MessagesPage() {
  const { t } = useTranslation();
  const { date, dateTime, time } = useDateTimeFormat();
  const params = useParams();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = screens.md === false;

  const selectedContactId = params.contactId;
  const conversations = useConversationsQuery();
  const me = useMyInfoQuery();

  const [replyText, setReplyText] = useState("");

  const summary = useMemo(
    () =>
      conversations.data?.items.find((c) => c.contact_id === selectedContactId),
    [conversations.data, selectedContactId],
  );

  const detailQuery = useConversationDetailQuery(
    selectedContactId,
    Boolean(selectedContactId),
  );
  const markRead = useMarkConversationRead();
  const replyAction = useConversationReplyAction(selectedContactId ?? "");
  const deleteAction = useConversationDeleteAction(selectedContactId ?? "");

  // Auto mark read when opening an unread conversation
  useEffect(() => {
    if (selectedContactId && summary?.unread) {
      markRead.mutate(selectedContactId as ContactID);
    }
  }, [selectedContactId, summary?.unread, markRead.mutate]);

  const handleSendReply = () => {
    const trimmed = replyText.trim();
    if (!trimmed || replyAction.isPending) return;
    replyAction.mutate(trimmed as MessageText, {
      onSuccess: () => {
        setReplyText("");
      },
    });
  };

  const isReadOnly =
    summary?.read_only_reason !== undefined ||
    me.data?.agencies_may_message === false;

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
      ) : conversations.data.items.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <Typography.Paragraph type="secondary">
            {t("messages.empty")}
          </Typography.Paragraph>
        </div>
      ) : (
        <List
          itemLayout="horizontal"
          dataSource={conversations.data.items}
          renderItem={(item) => {
            const isSelected = item.contact_id === selectedContactId;
            const timeLabel = isToday(item.last_activity_at)
              ? time(item.last_activity_at)
              : date(item.last_activity_at, "medium");

            return (
              <List.Item
                onClick={() =>
                  navigate(`/messages/${encodeURIComponent(item.contact_id)}`)
                }
                style={{
                  padding: "16px 20px",
                  cursor: "pointer",
                  backgroundColor: isSelected ? "#e6f4ff" : undefined,
                  borderBottom: "1px solid #f0f0f0",
                  transition: "background-color 0.2s",
                }}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar
                      shape="square"
                      size={48}
                      style={{
                        backgroundColor: avatarColor(item.agency_display_name),
                        fontWeight: "bold",
                        fontSize: 16,
                      }}
                    >
                      {initials(item.agency_display_name)}
                    </Avatar>
                  }
                  title={
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Typography.Text
                        strong
                        ellipsis
                        style={{ maxWidth: 160 }}
                      >
                        {item.agency_display_name}
                      </Typography.Text>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12, marginLeft: 8 }}
                      >
                        {timeLabel}
                      </Typography.Text>
                    </div>
                  }
                  description={
                    <div>
                      <Typography.Text
                        type="secondary"
                        ellipsis
                        style={{ display: "block", fontSize: 13 }}
                      >
                        {item.agency_domain}
                      </Typography.Text>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: 4,
                        }}
                      >
                        <Typography.Text
                          type="secondary"
                          ellipsis
                          style={{
                            maxWidth: item.unread ? 180 : 220,
                            fontSize: 13,
                          }}
                        >
                          {item.suggestions.length > 0
                            ? t("messages.snippetSuggestion")
                            : t("messages.snippetConversation")}
                        </Typography.Text>
                        {item.unread && (
                          <Badge
                            count={
                              item.unread_count > 0 ? item.unread_count : 1
                            }
                            style={{ backgroundColor: "#ff4d4f" }}
                          />
                        )}
                      </div>
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
    selectedContactId && summary ? (
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
              <Avatar
                shape="square"
                size={40}
                style={{
                  backgroundColor: avatarColor(summary.agency_display_name),
                  fontWeight: "bold",
                }}
              >
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
            <Popconfirm
              title={t("messages.deleteConfirmTitle")}
              description={t("messages.deleteConfirmBody")}
              okText={t("messages.deleteAction")}
              cancelText={t("common.cancel")}
              okButtonProps={{ danger: true }}
              onConfirm={() =>
                deleteAction.mutate(undefined, {
                  onSuccess: () => navigate("/messages"),
                })
              }
            >
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                loading={deleteAction.isPending}
              >
                {!isMobile && t("messages.delete")}
              </Button>
            </Popconfirm>
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
            icon={<ExclamationCircleFilled style={{ color: "#faad14" }} />}
            message={t("messages.unavailableTitle")}
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
            {/* Message stream */}
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

                  return (
                    <div
                      key={msg.message_id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: isCandidate ? "flex-end" : "flex-start",
                      }}
                    >
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12, marginBottom: 4 }}
                      >
                        {isCandidate
                          ? `${t("messages.you")} · ${dateTime(msg.sent_at)}`
                          : `${msg.sender_display_name} · ${dateTime(msg.sent_at)}`}
                      </Typography.Text>
                      {msg.text && (
                        <div
                          style={{
                            backgroundColor: isCandidate
                              ? "#1677ff"
                              : "#f0f2f5",
                            color: isCandidate ? "#ffffff" : "#000000",
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
                      {msg.suggestion && (
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

            {/* Reply section */}
            {isReadOnly ? (
              <Alert
                type="info"
                showIcon
                message={t("messages.readOnlyTitle")}
                description={
                  me.data?.agencies_may_message === false ? (
                    <span>
                      {t("messages.readOnlyPreferencesBody")}{" "}
                      <Link to="/settings/preferences">
                        {t("messages.preferencesLink")}
                      </Link>
                    </span>
                  ) : (
                    t("messages.readOnlyBody")
                  )
                }
              />
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
        selectedContactId ? (
          conversationView
        ) : (
          conversationsList
        )
      ) : (
        <Row gutter={[24, 24]}>
          <Col xs={24} md={8}>
            {conversationsList}
          </Col>
          <Col xs={24} md={16}>
            {conversationView}
          </Col>
        </Row>
      )}
    </Space>
  );
}
