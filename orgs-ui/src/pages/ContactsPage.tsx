import { PlusOutlined } from "@ant-design/icons";
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
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import {
  type ContactFilter,
  type ContactSummary,
  contactFilters,
  isContactNameQuery,
} from "typespec/orgs/marketplace/contacts/contacts";
import { paths } from "../app/paths";
import { ListPager } from "../features/applications/ListPager";
import { useListState } from "../features/applications/listState";
import { NameSearch } from "../features/applications/NameSearch";
import { getInitials } from "../features/marketplace/presentation";
import { useContactsQuery } from "../features/marketplace/queries";

const pageSize = 25;

function isContactFilter(value: string | undefined): value is ContactFilter {
  return (
    value !== undefined && (contactFilters as readonly string[]).includes(value)
  );
}

export function ContactsPage() {
  const { t } = useTranslation();
  const { date, time } = useDateTimeFormat();
  const navigate = useNavigate();
  const list = useListState();

  const [newContactModalOpen, setNewContactModalOpen] = useState(false);
  const [handleInput, setHandleInput] = useState("");

  const tabParam = list.get("tab");
  const activeTab: ContactFilter = isContactFilter(tabParam) ? tabParam : "all";
  const nameRaw = list.get("q");
  const name =
    nameRaw !== undefined && isContactNameQuery(nameRaw) ? nameRaw : undefined;
  const contactsQuery = useContactsQuery({
    filter: activeTab,
    ...(name !== undefined && { name_query: name }),
    limit: pageSize,
    ...(list.paginationKey !== undefined && {
      pagination_key: list.paginationKey,
    }),
  });
  const contacts = contactsQuery.data?.items ?? [];
  const counts = contactsQuery.data?.counts;

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
          {c.account_deleted && (
            <Tag color="error">
              {t("marketplace.contacts.statusAccountDeleted")}
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

  const tabItems: { key: ContactFilter; label: ReactNode }[] = [
    {
      key: "all",
      label: `${t("marketplace.contacts.tabAll")} (${counts?.all ?? 0})`,
    },
    {
      key: "unread",
      label: (
        <span>
          {t("marketplace.contacts.tabUnread")}{" "}
          {(counts?.unread ?? 0) > 0 ? (
            <Badge count={counts?.unread} size="small" />
          ) : (
            "(0)"
          )}
        </span>
      ),
    },
    {
      key: "has_conversation",
      label: `${t("marketplace.contacts.tabInConversation")} (${counts?.has_conversation ?? 0})`,
    },
    {
      key: "not_contacted",
      label: `${t("marketplace.contacts.tabNotContacted")} (${counts?.not_contacted ?? 0})`,
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
              onChange={(key) =>
                list.set({ tab: key === "all" ? undefined : key })
              }
              items={tabItems}
              style={{ marginBottom: 0 }}
            />
            <NameSearch
              value={nameRaw}
              onSearch={(value) => list.set({ q: value })}
            />
          </Flex>

          <Table<ContactSummary>
            rowKey={(c) => c.contact_id}
            columns={columns}
            dataSource={contacts}
            loading={contactsQuery.isFetching}
            pagination={false}
          />
          <ListPager
            hasPrevious={list.pageIndex > 0}
            hasNext={contactsQuery.data?.next_pagination_key !== undefined}
            busy={contactsQuery.isFetching}
            onPrevious={list.previous}
            onNext={() => {
              const key = contactsQuery.data?.next_pagination_key;
              if (key !== undefined) list.next(key);
            }}
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
            placeholder={t("marketplace.contacts.handlePlaceholder")}
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
