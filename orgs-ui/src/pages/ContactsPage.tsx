import { SearchOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Avatar,
  Button,
  Card,
  Empty,
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
import { useState } from "react";
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
import {
  contactStatusColors,
  contactStatusLabel,
  getInitials,
} from "../features/marketplace/presentation";
import { useContactsQuery } from "../features/marketplace/queries";

const pageSize = 25;

function waitsOnAgency(contact: ContactSummary): boolean {
  return (
    contact.status === "request_received" || contact.unread_messages_count > 0
  );
}

function isContactFilter(value: string | undefined): value is ContactFilter {
  return (
    value !== undefined && (contactFilters as readonly string[]).includes(value)
  );
}

// What waits on the agency comes first (MKT-UI-007); All stays the default.
const tabOrder: readonly ContactFilter[] = [
  "requests_received",
  "unread",
  "requests_sent",
  "has_conversation",
  "all",
];

const tabLabels: Record<ContactFilter, string> = {
  all: "marketplace.contacts.tabAll",
  requests_received: "marketplace.contacts.tabRequestsReceived",
  unread: "marketplace.contacts.tabUnread",
  requests_sent: "marketplace.contacts.tabRequestsSent",
  has_conversation: "marketplace.contacts.tabConversations",
};

const emptyTexts: Record<ContactFilter, string> = {
  all: "marketplace.contacts.emptyAll",
  requests_received: "marketplace.contacts.emptyRequestsReceived",
  unread: "marketplace.contacts.emptyUnread",
  requests_sent: "marketplace.contacts.emptyRequestsSent",
  has_conversation: "marketplace.contacts.emptyConversations",
};

/** Contacts, also the agency's shared inbox (MKT-UI-007). */
export function ContactsPage() {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const navigate = useNavigate();
  const list = useListState();

  const [findOpen, setFindOpen] = useState(false);
  const [address, setAddress] = useState("");

  const tabParam = list.get("tab");
  const activeTab: ContactFilter = isContactFilter(tabParam) ? tabParam : "all";
  const nameRaw = list.get("q");
  const name =
    nameRaw !== undefined && isContactNameQuery(nameRaw) ? nameRaw : undefined;
  const contactsQuery = useContactsQuery(
    {
      filter: activeTab,
      ...(name !== undefined && { name_query: name }),
      limit: pageSize,
      ...(list.paginationKey !== undefined && {
        pagination_key: list.paginationKey,
      }),
    },
    true,
    true,
  );
  const contacts = contactsQuery.data?.items ?? [];
  const counts = contactsQuery.data?.counts;

  const columns: ColumnsType<ContactSummary> = [
    {
      title: t("marketplace.contacts.tableName"),
      key: "name",
      render: (_, c) => (
        <Flex align="center" gap="middle">
          <Avatar>{getInitials(c.display_name)}</Avatar>
          <div>
            <Link to={paths.contactDetail(c.handle)}>
              <Typography.Text strong={waitsOnAgency(c)}>
                {c.display_name}
              </Typography.Text>
            </Link>
            <Typography.Text type="secondary" style={{ display: "block" }}>
              @{c.handle}
            </Typography.Text>
          </div>
        </Flex>
      ),
    },
    {
      title: t("marketplace.contacts.tableStatus"),
      key: "status",
      render: (_, c) => (
        <Space size={[0, 4]} wrap>
          {c.account_deleted ? (
            <Tag color="error">
              {t("marketplace.contacts.statusAccountDeleted")}
            </Tag>
          ) : (
            <Tag color={contactStatusColors[c.status]}>
              {contactStatusLabel(t, c.status)}
            </Tag>
          )}
          {c.requests_off && !c.account_deleted && (
            <Tag color="warning">
              {t("marketplace.contacts.statusRequestsOff")}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: t("marketplace.contacts.tableLastActivity"),
      key: "last_activity",
      render: (_, c) => dateTime(c.last_activity_at),
    },
    {
      title: t("marketplace.contacts.tableAction"),
      key: "action",
      render: (_, c) => (
        <Space orientation="vertical" size={0}>
          {c.status === "request_received" && (
            <Link to={paths.contactDetail(c.handle)}>
              {t("marketplace.contacts.actionAnswerRequest")}
            </Link>
          )}
          {c.unread_messages_count > 0 && (
            <Typography.Text strong>
              {t("marketplace.contacts.actionUnread", {
                count: c.unread_messages_count,
              })}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: t("marketplace.contacts.tableNotes"),
      key: "notes",
      align: "end",
      render: (_, c) => c.note_count,
    },
    {
      title: t("marketplace.contacts.tableCredited"),
      key: "credited",
      align: "end",
      render: (_, c) => c.credited_count,
    },
  ];

  const closeFind = () => {
    setFindOpen(false);
    setAddress("");
  };
  const openPerson = () => {
    const clean = address.trim().replace(/^@/, "");
    if (clean === "") return;
    closeFind();
    navigate(paths.contactDetail(clean));
  };

  const tabItems = tabOrder.map((filter) => ({
    key: filter,
    label: t("marketplace.contacts.tabWithCount", {
      tab: t(tabLabels[filter]),
      count: counts?.[filter] ?? 0,
    }),
  }));

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
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
          icon={<SearchOutlined />}
          onClick={() => setFindOpen(true)}
        >
          {t("marketplace.contacts.findPersonButton")}
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
            rowKey={(c) => c.handle}
            columns={columns}
            dataSource={contacts}
            loading={contactsQuery.isFetching}
            pagination={false}
            scroll={{ x: "max-content" }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t(
                    name === undefined
                      ? emptyTexts[activeTab]
                      : "marketplace.contacts.emptySearch",
                  )}
                >
                  {activeTab === "all" && name === undefined && (
                    <Button onClick={() => setFindOpen(true)}>
                      {t("marketplace.contacts.findPersonButton")}
                    </Button>
                  )}
                </Empty>
              ),
            }}
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
          <Typography.Text type="secondary">
            {t("marketplace.contacts.dailyLimitsNotice")}
          </Typography.Text>
        </Flex>
      </Card>

      <Modal
        open={findOpen}
        title={t("marketplace.contacts.findPersonModalTitle")}
        onCancel={closeFind}
        onOk={openPerson}
        okText={t("marketplace.contacts.viewProfile")}
        okButtonProps={{ disabled: address.trim() === "" }}
        destroyOnHidden
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
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onPressEnter={openPerson}
            autoFocus
          />
        </Form.Item>
      </Modal>
    </Space>
  );
}
