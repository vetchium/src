import {
  DeleteOutlined,
  EditOutlined,
  MessageOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  App,
  Avatar,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import type { CreditedApplicationSummary } from "typespec/orgs/marketplace/attribution";
import type { ContactOpeningSuggestion } from "typespec/orgs/marketplace/contacts/contacts";
import { isDefiniteRefusal } from "../api/client";
import { paths } from "../app/paths";
import { ChatRequestBanner } from "../features/marketplace/ChatRequestBanner";
import {
  getInitials,
  hubStatusColors,
  hubStatusLabel,
  referralRouteColors,
  referralRouteLabel,
} from "../features/marketplace/presentation";
import {
  useAddContactNoteMutation,
  useContactNotesQuery,
  useContactQuery,
  useConversationQuery,
  useCreditedApplicationsQuery,
  useDeleteContactNoteMutation,
  useEditContactNoteMutation,
  useMarkConversationReadMutation,
  useSendMessageMutation,
  useViewHubProfileQuery,
} from "../features/marketplace/queries";
import { SendChatRequestModal } from "../features/marketplace/SendChatRequestModal";
import {
  JobPicker,
  openingFromKey,
} from "../features/marketplace/SuggestionSelect";

export function ContactDetailPage() {
  const { t } = useTranslation();
  const { date, time } = useDateTimeFormat();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const noteKey = useIdempotencyKey("add-contact-note");
  const editNoteKey = useIdempotencyKey("edit-contact-note");
  const deleteNoteKey = useIdempotencyKey("delete-contact-note");
  const sendMsgKey = useIdempotencyKey("send-contact-msg");

  const contactQuery = useContactQuery(id);
  const contact = contactQuery.data;

  const conversationQuery = useConversationQuery(
    id,
    Boolean(contact?.has_conversation),
  );
  const conversationPages = conversationQuery.data?.pages;
  const conversation = conversationPages?.[0]?.conversation;
  const messages = (conversationPages ?? [])
    .flatMap((page) => page.messages)
    .reverse();

  const notesQuery = useContactNotesQuery(id);
  const notes = notesQuery.data?.items ?? [];

  const profileQuery = useViewHubProfileQuery(
    contact?.handle ?? "",
    Boolean(contact?.handle),
  );
  const profileData = profileQuery.data;
  const pub = profileData?.profile;
  const verifiedDomains = profileData?.verified_domains ?? [];

  const creditedQuery = useCreditedApplicationsQuery({ contact_id: id });
  const creditedApps = creditedQuery.data?.items ?? [];

  // Mutations
  const addNoteMutation = useAddContactNoteMutation(id);
  const editNoteMutation = useEditContactNoteMutation(id);
  const deleteNoteMutation = useDeleteContactNoteMutation(id);
  const sendMsgMutation = useSendMessageMutation(id);
  const markReadMutation = useMarkConversationReadMutation(id);

  // Mark conversation read if unread
  const markReadMutate = markReadMutation.mutate;
  useEffect(() => {
    if (conversation?.agency_unread) {
      markReadMutate();
    }
  }, [conversation?.agency_unread, markReadMutate]);

  // MKT-UI-008: Conversation is the default tab once a conversation or
  // request exists, Notes otherwise.
  const showConversation =
    contact === undefined
      ? undefined
      : contact.has_conversation || contact.latest_request !== undefined;
  const [activeTab, setActiveTab] = useState<string>("notes");
  useEffect(() => {
    if (showConversation !== undefined) {
      setActiveTab(showConversation ? "conversation" : "notes");
    }
  }, [showConversation]);

  // Note form state
  const [noteText, setNoteText] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  // Message form state
  const [messageText, setMessageText] = useState("");
  const [suggestOpeningModalOpen, setSuggestOpeningModalOpen] = useState(false);
  const [selectedOpeningKey, setSelectedOpeningKey] = useState<string>();

  const [requestModalOpen, setRequestModalOpen] = useState(false);

  if (contactQuery.isLoading) {
    return <Card loading style={{ width: "100%" }} />;
  }

  if (!contact) {
    return (
      <Card>
        <Typography.Text type="secondary">
          {t("marketplace.contacts.notFound")}
        </Typography.Text>
      </Card>
    );
  }

  const firstName = contact.display_name.split(/\s+/)[0];
  const isRequestsOff = contact.requests_off;
  const isPartyDeleted =
    contact.account_deleted || conversation?.read_only_reason !== undefined;
  const writableUntil = conversation?.agency_may_write_until;
  const mayWrite =
    !isPartyDeleted &&
    writableUntil !== undefined &&
    Date.parse(writableUntil) > Date.now();

  // Handlers for notes
  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    try {
      await addNoteMutation.mutateAsync({
        request: {
          contact_id: id,
          text: noteText.trim(),
        },
        key: noteKey.current(),
      });
      message.success(t("marketplace.contacts.noteAddedSuccess"));
      setNoteText("");
    } catch {
      message.error(t("marketplace.contacts.noteAddedError"));
    }
  };

  const handleEditNote = async (noteId: string) => {
    if (!editingText.trim()) return;
    try {
      await editNoteMutation.mutateAsync({
        request: {
          contact_id: id,
          note_id: noteId,
          text: editingText.trim(),
        },
        key: editNoteKey.current(),
      });
      message.success(t("marketplace.contacts.noteEditedSuccess"));
      setEditingNoteId(null);
      setEditingText("");
    } catch {
      message.error(t("marketplace.contacts.noteEditedError"));
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      const res = await deleteNoteMutation.mutateAsync({
        request: {
          contact_id: id,
          note_id: noteId,
        },
        key: deleteNoteKey.current(),
      });
      message.success(t("marketplace.contacts.noteDeletedSuccess"));
      if (res?.contact_deleted) {
        navigate(paths.contacts);
      }
    } catch {
      message.error(t("marketplace.contacts.noteDeletedError"));
    }
  };

  // Handlers for conversation
  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    try {
      await sendMsgMutation.mutateAsync({
        request: {
          contact_id: id,
          text: messageText.trim(),
        },
        key: sendMsgKey.current(),
      });
      sendMsgKey.rotate();
      setMessageText("");
    } catch (error) {
      if (isDefiniteRefusal(error)) sendMsgKey.rotate();
      message.error(t("marketplace.contacts.messageSendError"));
    }
  };

  const handleSendSuggestion = async () => {
    const suggestion = openingFromKey(selectedOpeningKey);
    if (suggestion === undefined) return;
    try {
      await sendMsgMutation.mutateAsync({
        request: { contact_id: id, suggestion },
        key: sendMsgKey.current(),
      });
      sendMsgKey.rotate();
      message.success(t("marketplace.jobs.suggestSuccess"));
      setSuggestOpeningModalOpen(false);
      setSelectedOpeningKey(undefined);
    } catch (error) {
      if (isDefiniteRefusal(error)) sendMsgKey.rotate();
      message.error(t("marketplace.jobs.suggestError"));
    }
  };

  // Suggested openings table columns
  const suggestedOpeningsColumns: ColumnsType<ContactOpeningSuggestion> = [
    {
      title: t("marketplace.jobs.tableOpening"),
      key: "opening",
      render: (_, item) => `#${item.opening_number} (${item.consumer_domain})`,
    },
    {
      title: t("marketplace.jobs.suggestedDate"),
      key: "suggested_at",
      render: (_, item) => (item.suggested_at ? date(item.suggested_at) : "—"),
    },
  ];

  // Credited applications table columns
  const creditedColumns: ColumnsType<CreditedApplicationSummary> = [
    {
      title: t("marketplace.attribution.tableApplication"),
      key: "application",
      render: (_, item) => `#${item.application_number}`,
    },
    {
      title: t("marketplace.attribution.tableClient"),
      key: "client",
      render: (_, item) => item.client.display_name || item.client.domain,
    },
    {
      title: t("marketplace.attribution.tableOpening"),
      key: "opening",
      render: (_, item) => `#${item.opening.number} ${item.opening.title}`,
    },
    {
      title: t("marketplace.attribution.tableRoute"),
      key: "route",
      render: (_, item) => (
        <Tag color={referralRouteColors[item.route] ?? "default"}>
          {referralRouteLabel(t, item.route)}
        </Tag>
      ),
    },
    {
      title: t("marketplace.attribution.tableStatus"),
      key: "status",
      render: (_, item) => (
        <Tag color={hubStatusColors[item.status] ?? "default"}>
          {hubStatusLabel(t, item.status)}
        </Tag>
      ),
    },
    {
      title: t("marketplace.attribution.tableApplied"),
      key: "applied_at",
      render: (_, item) => (item.applied_at ? date(item.applied_at) : "—"),
    },
  ];

  // Tabs definition
  const tabItems = [
    ...(showConversation
      ? [
          {
            key: "conversation",
            label: t("marketplace.contacts.tabConversation"),
            children: (
              <Flex vertical gap="middle">
                {isPartyDeleted && (
                  <Alert
                    type="warning"
                    showIcon
                    title={t("marketplace.contacts.accountDeletedBanner")}
                  />
                )}
                <ChatRequestBanner contact={contact} />

                {/* Conversation message bubbles */}
                <div
                  style={{
                    minHeight: 280,
                    maxHeight: 500,
                    overflowY: "auto",
                    padding: "16px 8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                  }}
                >
                  {conversationQuery.hasNextPage && (
                    <Button
                      type="link"
                      loading={conversationQuery.isFetchingNextPage}
                      onClick={() => void conversationQuery.fetchNextPage()}
                    >
                      {t("marketplace.contacts.loadEarlier")}
                    </Button>
                  )}
                  {messages.map((msg) => {
                    const isAgency = msg.sender_type === "agency";
                    return (
                      <div
                        key={msg.message_id}
                        style={{
                          alignSelf: isAgency ? "flex-end" : "flex-start",
                          maxWidth: "75%",
                        }}
                      >
                        <Typography.Text
                          type="secondary"
                          style={{
                            fontSize: 12,
                            display: "block",
                            textAlign: isAgency ? "right" : "left",
                            marginBottom: 4,
                          }}
                        >
                          {msg.sender_display_name}
                          {isAgency && conversation?.recorded_agency_name
                            ? ` · ${conversation.recorded_agency_name}`
                            : ""}{" "}
                          · {date(msg.sent_at)}, {time(msg.sent_at)}
                        </Typography.Text>

                        {msg.kind === "text" && msg.text && (
                          <div
                            style={{
                              backgroundColor: isAgency ? "#1677ff" : "#f0f2f5",
                              color: isAgency ? "#ffffff" : "inherit",
                              padding: "10px 16px",
                              borderRadius: 14,
                              whiteSpace: "pre-line",
                              fontSize: 14,
                              lineHeight: 1.5,
                            }}
                          >
                            {msg.text}
                          </div>
                        )}

                        {msg.kind === "request" && msg.suggestion && (
                          <Card
                            size="small"
                            style={{ borderRadius: 12, maxWidth: 380 }}
                          >
                            <Typography.Text
                              type="secondary"
                              style={{
                                fontSize: 11,
                                display: "block",
                                marginBottom: 6,
                              }}
                            >
                              {t("marketplace.chatRequests.messageLabel")}
                            </Typography.Text>
                            <Typography.Text
                              strong
                              style={{ display: "block" }}
                            >
                              {t("marketplace.chatRequests.openingLine", {
                                client: msg.suggestion.consumer_domain,
                                number: msg.suggestion.opening_number,
                              })}
                            </Typography.Text>
                            {msg.note !== undefined && (
                              <Typography.Paragraph
                                style={{
                                  whiteSpace: "pre-line",
                                  margin: "6px 0 0",
                                }}
                              >
                                {msg.note}
                              </Typography.Paragraph>
                            )}
                          </Card>
                        )}

                        {msg.kind === "suggestion" && msg.suggestion && (
                          <Card
                            size="small"
                            style={{
                              borderRadius: 12,
                              backgroundColor: "#fafafa",
                              borderColor: "#d9d9d9",
                              maxWidth: 380,
                            }}
                          >
                            <Typography.Text
                              type="secondary"
                              style={{
                                fontSize: 11,
                                display: "block",
                                marginBottom: 6,
                              }}
                            >
                              {t("marketplace.contacts.openingSuggestionLabel")}
                            </Typography.Text>
                            <Flex align="center" gap="middle">
                              <Avatar
                                shape="square"
                                size={36}
                                style={{
                                  backgroundColor: "#fa8c16",
                                  fontWeight: 600,
                                }}
                              >
                                {getInitials(msg.suggestion.consumer_domain)}
                              </Avatar>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <Typography.Text
                                  strong
                                  style={{ fontSize: 13, display: "block" }}
                                >
                                  #{msg.suggestion.opening_number}
                                </Typography.Text>
                                <Typography.Text
                                  type="secondary"
                                  style={{ fontSize: 12 }}
                                >
                                  {msg.suggestion.consumer_domain}
                                </Typography.Text>
                              </div>
                            </Flex>
                          </Card>
                        )}
                      </div>
                    );
                  })}
                </div>

                {mayWrite ? (
                  <Card size="small" style={{ borderRadius: 8 }}>
                    <Flex vertical gap="small">
                      <Input.TextArea
                        rows={3}
                        maxLength={5000}
                        showCount
                        aria-label={t(
                          "marketplace.contacts.writeMessagePlaceholder",
                        )}
                        placeholder={t(
                          "marketplace.contacts.writeMessagePlaceholder",
                        )}
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                      />

                      <Flex
                        justify="space-between"
                        align="center"
                        wrap="wrap"
                        gap="small"
                      >
                        <Button
                          onClick={() => setSuggestOpeningModalOpen(true)}
                        >
                          {t("marketplace.contacts.suggestAnOpening")}
                        </Button>

                        <Button
                          type="primary"
                          icon={<SendOutlined />}
                          disabled={!messageText.trim()}
                          loading={sendMsgMutation.isPending}
                          onClick={handleSendMessage}
                        >
                          {t("actions.send")}
                        </Button>
                      </Flex>

                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        {t("marketplace.contacts.conversationPrivacyFooter", {
                          name: firstName,
                        })}
                      </Typography.Text>
                    </Flex>
                  </Card>
                ) : (
                  !isPartyDeleted &&
                  contact.has_conversation && (
                    <Alert
                      type="info"
                      showIcon
                      title={t("marketplace.chatRequests.closedNotice", {
                        name: firstName,
                      })}
                      description={
                        contact.pending_request_direction ===
                        "to_hub_user" ? undefined : (
                          <Button
                            size="small"
                            icon={<MessageOutlined />}
                            onClick={() => setRequestModalOpen(true)}
                            style={{ marginTop: 8 }}
                          >
                            {t("marketplace.chatRequests.sendButton")}
                          </Button>
                        )
                      }
                    />
                  )
                )}
              </Flex>
            ),
          },
        ]
      : []),
    {
      key: "notes",
      label: `${t("marketplace.contacts.tabNotes")} (${notes.length})`,
      children: (
        <Flex vertical gap="large">
          {/* Add note card */}
          <Card size="small" style={{ borderRadius: 8 }}>
            <Flex vertical gap="small">
              <Input.TextArea
                rows={3}
                maxLength={5000}
                showCount
                placeholder={t("marketplace.contacts.notePlaceholder")}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <Flex
                justify="space-between"
                align="center"
                wrap="wrap"
                gap="small"
              >
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, flex: 1 }}
                >
                  {t("marketplace.contacts.notesPrivacySubtitle", {
                    name: firstName,
                  })}
                </Typography.Text>
                <Button
                  type="primary"
                  disabled={!noteText.trim()}
                  loading={addNoteMutation.isPending}
                  onClick={handleAddNote}
                >
                  {t("marketplace.contacts.addNote")}
                </Button>
              </Flex>
            </Flex>
          </Card>

          {/* Notes list */}
          <Flex vertical gap="middle">
            {notes.map((n) => (
              <Card key={n.note_id} size="small" style={{ borderRadius: 8 }}>
                <Flex
                  justify="space-between"
                  align="center"
                  style={{ marginBottom: 8 }}
                >
                  <Flex align="center" gap="small">
                    <Avatar size="small" style={{ backgroundColor: "#1677ff" }}>
                      {getInitials(n.author)}
                    </Avatar>
                    <Typography.Text strong>{n.author}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {date(n.created_at)}, {time(n.created_at)}
                      {n.edited_at
                        ? ` · ${t("marketplace.contacts.noteEdited")}`
                        : ""}
                    </Typography.Text>
                  </Flex>

                  <Space size="small">
                    {n.mine && editingNoteId !== n.note_id && (
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => {
                          setEditingNoteId(n.note_id);
                          setEditingText(n.text);
                        }}
                      >
                        {t("actions.edit")}
                      </Button>
                    )}
                    <Popconfirm
                      title={t("marketplace.contacts.deleteNoteConfirmTitle")}
                      onConfirm={() => handleDeleteNote(n.note_id)}
                      okText={t("actions.delete")}
                      cancelText={t("actions.cancel")}
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                      >
                        {t("actions.delete")}
                      </Button>
                    </Popconfirm>
                  </Space>
                </Flex>

                {editingNoteId === n.note_id ? (
                  <Flex vertical gap="small">
                    <Input.TextArea
                      rows={3}
                      maxLength={5000}
                      showCount
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                    />
                    <Flex justify="flex-end" gap="small">
                      <Button
                        size="small"
                        onClick={() => {
                          setEditingNoteId(null);
                          setEditingText("");
                        }}
                      >
                        {t("actions.cancel")}
                      </Button>
                      <Button
                        size="small"
                        type="primary"
                        disabled={!editingText.trim()}
                        loading={editNoteMutation.isPending}
                        onClick={() => handleEditNote(n.note_id)}
                      >
                        {t("actions.save")}
                      </Button>
                    </Flex>
                  </Flex>
                ) : (
                  <Typography.Paragraph
                    style={{ whiteSpace: "pre-line", margin: 0, fontSize: 14 }}
                  >
                    {n.text}
                  </Typography.Paragraph>
                )}
              </Card>
            ))}
          </Flex>
        </Flex>
      ),
    },
    {
      key: "profile",
      label: t("marketplace.contacts.tabProfile"),
      children: (
        <Row gutter={[24, 24]}>
          <Col xs={24} lg={15}>
            <Card
              title={
                <Flex justify="space-between" align="center">
                  <span>{t("marketplace.contacts.profileTabTitle")}</span>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 12, fontWeight: "normal" }}
                  >
                    {t("marketplace.contacts.liveAsHubUsersSeeIt")}
                  </Typography.Text>
                </Flex>
              }
            >
              {pub ? (
                <Flex vertical gap="large">
                  <Flex align="center" gap="middle">
                    <Avatar
                      size={56}
                      style={{ backgroundColor: "#1677ff", fontSize: 22 }}
                    >
                      {getInitials(pub.display_name)}
                    </Avatar>
                    <div>
                      <Typography.Text
                        strong
                        style={{ fontSize: 16, display: "block" }}
                      >
                        {pub.display_name}
                      </Typography.Text>
                      {pub.work_experiences[0] && (
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 14 }}
                        >
                          {pub.work_experiences[0].job_title} at{" "}
                          {pub.work_experiences[0].employer_domain}
                        </Typography.Text>
                      )}
                    </div>
                  </Flex>

                  <Descriptions column={1} size="small">
                    {pub.resident_country && (
                      <Descriptions.Item
                        label={t("marketplace.contacts.residentCountry")}
                      >
                        {t(`countries.${pub.resident_country}`, {
                          defaultValue: pub.resident_country,
                        })}
                      </Descriptions.Item>
                    )}
                    {pub.work_experiences &&
                      pub.work_experiences.length > 0 && (
                        <Descriptions.Item
                          label={t("marketplace.contacts.workExperience")}
                        >
                          <Flex vertical gap="small">
                            {pub.work_experiences.map((w) => (
                              <div key={w.id}>
                                <Typography.Text strong>
                                  {w.job_title} · {w.employer_domain}
                                </Typography.Text>
                                <div>
                                  <Typography.Text
                                    type="secondary"
                                    style={{ fontSize: 12 }}
                                  >
                                    {w.start_month} —{" "}
                                    {w.end_month ??
                                      t("marketplace.contacts.present")}
                                  </Typography.Text>
                                </div>
                              </div>
                            ))}
                          </Flex>
                        </Descriptions.Item>
                      )}
                    {pub.educational_qualifications &&
                      pub.educational_qualifications.length > 0 && (
                        <Descriptions.Item
                          label={t("marketplace.contacts.education")}
                        >
                          <Flex vertical gap="small">
                            {pub.educational_qualifications.map((e) => (
                              <div key={e.id}>
                                <Typography.Text strong>
                                  {e.degree} · {e.institution_domain}
                                </Typography.Text>
                                <div>
                                  <Typography.Text
                                    type="secondary"
                                    style={{ fontSize: 12 }}
                                  >
                                    {e.start_month ?? ""} —{" "}
                                    {e.end_month ??
                                      t("marketplace.contacts.present")}
                                  </Typography.Text>
                                </div>
                              </div>
                            ))}
                          </Flex>
                        </Descriptions.Item>
                      )}
                    {pub.language_abilities &&
                      pub.language_abilities.length > 0 && (
                        <Descriptions.Item
                          label={t("marketplace.contacts.languages")}
                        >
                          {pub.language_abilities
                            .map((l) => `${l.language_tag} (${l.ability})`)
                            .join(", ")}
                        </Descriptions.Item>
                      )}
                    {pub.websites && pub.websites.length > 0 && (
                      <Descriptions.Item
                        label={t("marketplace.contacts.websites")}
                      >
                        {pub.websites.map((ws) => (
                          <div key={ws.id}>
                            <a
                              href={ws.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {ws.url}
                            </a>
                          </div>
                        ))}
                      </Descriptions.Item>
                    )}
                  </Descriptions>
                </Flex>
              ) : (
                <Typography.Text type="secondary">
                  {t("marketplace.contacts.profileUnavailable")}
                </Typography.Text>
              )}
            </Card>
          </Col>

          <Col xs={24} lg={9}>
            <Space
              orientation="vertical"
              size="large"
              style={{ width: "100%" }}
            >
              <Card title={t("marketplace.contacts.verifiedEmailsTitle")}>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  {t("marketplace.contacts.verifiedEmailsExplainer", {
                    name: firstName,
                  })}
                </Typography.Paragraph>

                {verifiedDomains.length === 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    {t("marketplace.contacts.noVerifiedDomains")}
                  </Typography.Text>
                ) : (
                  <Table
                    size="small"
                    pagination={false}
                    dataSource={verifiedDomains}
                    rowKey={(d) => d.domain}
                    columns={[
                      {
                        title: t("marketplace.contacts.domainColumn"),
                        dataIndex: "domain",
                        key: "domain",
                      },
                      {
                        title: t("marketplace.contacts.firstVerifiedColumn"),
                        dataIndex: "first_verified_month",
                        key: "first_verified",
                      },
                      {
                        title: t("marketplace.contacts.lastVerifiedColumn"),
                        dataIndex: "last_verified_month",
                        key: "last_verified",
                      },
                    ]}
                  />
                )}
              </Card>

              <Card
                title={t("marketplace.contacts.yourNotesCardTitle")}
                extra={
                  <Button size="small" onClick={() => setActiveTab("notes")}>
                    {t("marketplace.contacts.addNote")}
                  </Button>
                }
              >
                {notes.length === 0 || !notes[0] ? (
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    {t("marketplace.contacts.noNotesYet")}
                  </Typography.Text>
                ) : (
                  <Flex vertical gap="small">
                    <Typography.Paragraph
                      ellipsis={{ rows: 3 }}
                      style={{ margin: 0, fontSize: 13 }}
                    >
                      {notes[0].text}
                    </Typography.Paragraph>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {notes[0].author} · {date(notes[0].created_at)}
                      {notes.length > 1
                        ? ` · ${t("marketplace.contacts.moreNotesCount", { count: notes.length - 1 })}`
                        : ""}
                    </Typography.Text>
                  </Flex>
                )}
              </Card>
            </Space>
          </Col>
        </Row>
      ),
    },
    {
      key: "suggested_openings",
      label: `${t("marketplace.contacts.tabSuggestedOpenings")} (${contact.suggested_openings?.length ?? 0})`,
      children: (
        <Table<ContactOpeningSuggestion>
          rowKey={(item) => `${item.consumer_domain}-${item.opening_number}`}
          columns={suggestedOpeningsColumns}
          dataSource={contact.suggested_openings ?? []}
          pagination={false}
        />
      ),
    },
    {
      key: "credited_applications",
      label: `${t("marketplace.contacts.tabCreditedApplications")} (${creditedApps.length})`,
      children: (
        <Table<CreditedApplicationSummary>
          rowKey={(item) => item.application_number}
          columns={creditedColumns}
          dataSource={creditedApps}
          pagination={false}
        />
      ),
    },
  ];

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <Breadcrumb
        items={[
          {
            title: (
              <Link to={paths.contacts}>{t("marketplace.contacts.title")}</Link>
            ),
          },
          { title: contact.display_name },
        ]}
      />

      <Flex justify="space-between" align="flex-start" wrap="wrap" gap="middle">
        <div>
          <Flex align="center" gap="small" wrap="wrap">
            <Typography.Title level={2} style={{ margin: 0 }}>
              {contact.display_name}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 18 }}>
              @{contact.handle}
            </Typography.Text>
            {contact.has_conversation ? (
              <Tag color="processing">
                {t("marketplace.contacts.statusInConversation")}
              </Tag>
            ) : (
              <Tag>{t("marketplace.contacts.statusNotContacted")}</Tag>
            )}
            {isRequestsOff && (
              <Tag color="warning">
                {t("marketplace.contacts.requestsOffReason")}
              </Tag>
            )}
            {isPartyDeleted && (
              <Tag color="default">
                {t("marketplace.contacts.statusAccountDeleted")}
              </Tag>
            )}
          </Flex>

          <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
            {[
              pub?.work_experiences?.[0]
                ? `${pub.work_experiences[0].job_title} at ${pub.work_experiences[0].employer_domain}`
                : "",
              pub?.resident_country
                ? t(`countries.${pub.resident_country}`, {
                    defaultValue: pub.resident_country,
                  })
                : "",
              t("marketplace.contacts.contactSince", {
                date: contact.created_at ? date(contact.created_at) : "",
              }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Typography.Paragraph>
        </div>

        {!mayWrite &&
          !isPartyDeleted &&
          contact.pending_request_direction !== "to_hub_user" &&
          !conversationQuery.isLoading && (
            <Button
              type="primary"
              icon={<MessageOutlined />}
              onClick={() => setRequestModalOpen(true)}
            >
              {t("marketplace.chatRequests.sendButton")}
            </Button>
          )}
      </Flex>

      <Card>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      </Card>

      {/* Suggest Opening Modal (in conversation) */}
      <Modal
        open={suggestOpeningModalOpen}
        title={t("marketplace.contacts.suggestAnOpening")}
        onCancel={() => {
          setSuggestOpeningModalOpen(false);
          setSelectedOpeningKey(undefined);
        }}
        onOk={handleSendSuggestion}
        okText={t("marketplace.jobs.sendSuggestion")}
        okButtonProps={{
          disabled: !selectedOpeningKey,
          loading: sendMsgMutation.isPending,
        }}
      >
        <Typography.Paragraph type="secondary">
          {t("marketplace.contacts.selectOpeningToSuggestExplainer")}
        </Typography.Paragraph>
        <Form.Item label={t("marketplace.jobs.tableOpening")} required>
          <JobPicker
            value={selectedOpeningKey}
            onChange={setSelectedOpeningKey}
            placeholder={t("marketplace.contacts.selectOpeningPlaceholder")}
            ariaLabel={t("marketplace.jobs.tableOpening")}
            notFound={t("marketplace.chatRequests.noJobs")}
            style={{ width: "100%" }}
          />
        </Form.Item>
      </Modal>

      <SendChatRequestModal
        open={requestModalOpen}
        onClose={() => setRequestModalOpen(false)}
        person={{ contactId: contact.contact_id }}
      />
    </Space>
  );
}
