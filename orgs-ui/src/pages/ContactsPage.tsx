import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import type { ContactSummary } from "typespec/orgs/marketplace/contacts/contacts";
import { paths } from "../app/paths";
import { getInitials } from "../features/marketplace/presentation";
import { useContactsQuery } from "../features/marketplace/queries";

type TabKey = "all" | "unread" | "in_conversation" | "not_contacted";

export function ContactsPage() {
  const { t } = useTranslation();
  const { date, time } = useDateTimeFormat();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [newContactModalOpen, setNewContactModalOpen] = useState(false);
  const [handleInput, setHandleInput] = useState("");

  const contactsQuery = useContactsQuery();
  const contacts = contactsQuery.data?.items ?? [];

  // Filter contacts by tab and search
  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      // Tab filter
      if (activeTab === "unread" && c.unread_messages_count === 0) {
        return false;
      }
      if (activeTab === "in_conversation" && !c.has_conversation) {
        return false;
      }
      if (activeTab === "not_contacted" && c.has_conversation) {
        return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesName = c.display_name.toLowerCase().includes(q);
        const matchesHandle = c.handle.toLowerCase().includes(q);
        if (!matchesName && !matchesHandle) return false;
      }

      return true;
    });
  }, [contacts, activeTab, searchQuery]);

  // Counts for tabs
  const unreadCount = useMemo(
    () => contacts.filter((c) => c.unread_messages_count > 0).length,
    [contacts],
  );
  const convCount = useMemo(
    () => contacts.filter((c) => c.has_conversation).length,
    [contacts],
  );
  const notContactedCount = useMemo(
    () => contacts.filter((c) => !c.has_conversation).length,
    [contacts],
  );

  const formatActivityTime = (iso: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();

    if (isToday) {
      return `${t("date.today")}, ${time(iso)}`;
    }
    if (isYesterday) {
      return t("date.yesterday");
    }
    return date(iso);
  };

  const columns: ColumnsType<ContactSummary> = [
    {
      title: t("marketplace.contacts.tableName"),
      key: "name",
      render: (_, c) => (
        <Flex align="center" gap="middle">
          <Avatar
            style={{
              backgroundColor: c.messages_off ? "#d9d9d9" : "#1677ff",
              color: "#fff",
              fontWeight: 600,
            }}
          >
            {getInitials(c.display_name)}
          </Avatar>
          <div>
            <Link
              to={paths.contactDetail(c.contact_id)}
              style={{ fontWeight: 500 }}
            >
              {c.display_name}
            </Link>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                @{c.handle}
              </Typography.Text>
            </div>
          </div>
        </Flex>
      ),
    },
    {
      title: t("marketplace.contacts.tableStatus"),
      key: "status",
      render: (_, c) => (
        <Space size="small" wrap>
          {c.has_conversation ? (
            <Tag color="processing">
              {t("marketplace.contacts.statusInConversation")}
            </Tag>
          ) : (
            <Tag>{t("marketplace.contacts.statusNotContacted")}</Tag>
          )}
          {c.messages_off && (
            <Tag color="warning">
              {t("marketplace.contacts.statusMessagesOff")}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: t("marketplace.contacts.tableLastActivity"),
      key: "last_activity",
      render: (_, c) => formatActivityTime(c.last_activity_at),
    },
    {
      title: t("marketplace.contacts.tableUnread"),
      key: "unread",
      align: "center",
      render: (_, c) =>
        c.unread_messages_count > 0 ? (
          <Badge count={c.unread_messages_count} />
        ) : null,
    },
    {
      title: t("marketplace.contacts.tableNotes"),
      key: "notes",
      align: "center",
      render: (_, c) => c.note_count ?? 0,
    },
    {
      title: t("marketplace.contacts.tableCredited"),
      key: "credited",
      align: "center",
      render: (_, c) => c.credited_count ?? 0,
    },
  ];

  const handleOpenNewContact = () => {
    let clean = handleInput.trim();
    if (!clean) return;
    if (clean.startsWith("@")) {
      clean = clean.slice(1);
    }
    setNewContactModalOpen(false);
    setHandleInput("");
    navigate(`${paths.newContact}?address=${encodeURIComponent(clean)}`);
  };

  const tabItems = [
    {
      key: "all",
      label: `${t("marketplace.contacts.tabAll")} (${contacts.length})`,
    },
    {
      key: "unread",
      label: (
        <span>
          {t("marketplace.contacts.tabUnread")}{" "}
          {unreadCount > 0 ? <Badge count={unreadCount} size="small" /> : `(0)`}
        </span>
      ),
    },
    {
      key: "in_conversation",
      label: `${t("marketplace.contacts.tabInConversation")} (${convCount})`,
    },
    {
      key: "not_contacted",
      label: `${t("marketplace.contacts.tabNotContacted")} (${notContactedCount})`,
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Flex justify="space-between" align="flex-start" wrap="wrap" gap="middle">
        <div>
          <Typography.Title level={2} style={{ marginBottom: 4 }}>
            {t("marketplace.contacts.title")}
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {t("marketplace.contacts.subtitle")}
          </Typography.Paragraph>
        </div>

        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setNewContactModalOpen(true)}
        >
          {t("marketplace.contacts.newContactButton")}
        </Button>
      </Flex>

      <Card>
        <Flex vertical gap="middle">
          <Flex justify="space-between" align="center" wrap="wrap" gap="middle">
            <Tabs
              activeKey={activeTab}
              onChange={(k) => setActiveTab(k as TabKey)}
              items={tabItems}
              style={{ marginBottom: 0 }}
            />
            <Input
              prefix={<SearchOutlined />}
              placeholder={t("marketplace.contacts.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              allowClear
              style={{ maxWidth: 240 }}
            />
          </Flex>

          <Table<ContactSummary>
            rowKey={(c) => c.contact_id}
            columns={columns}
            dataSource={filteredContacts}
            loading={contactsQuery.isLoading}
            pagination={{ pageSize: 25 }}
          />

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("marketplace.contacts.dailyLimitsNotice")}
          </Typography.Text>
        </Flex>
      </Card>

      <Modal
        open={newContactModalOpen}
        title={t("marketplace.contacts.findPersonModalTitle")}
        onCancel={() => {
          setNewContactModalOpen(false);
          setHandleInput("");
        }}
        onOk={handleOpenNewContact}
        okText={t("marketplace.contacts.viewProfile")}
        okButtonProps={{ disabled: !handleInput.trim() }}
      >
        <Typography.Paragraph type="secondary">
          {t("marketplace.contacts.findPersonExplainer")}
        </Typography.Paragraph>
        <Form.Item
          label={t("marketplace.contacts.handleOrAliasLabel")}
          required
        >
          <Input
            prefix="@"
            placeholder="handle"
            value={handleInput}
            onChange={(e) => setHandleInput(e.target.value)}
            onPressEnter={handleOpenNewContact}
            autoFocus
          />
        </Form.Item>
      </Modal>
    </Space>
  );
}
