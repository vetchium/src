import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router";
import type { AdminPermission } from "../../../typespec/admin/authorization/types.ts";
import type { State } from "../../../typespec/admin/user/user.ts";
import type {
  AdminUserSummary,
  ListUsersRequest,
} from "../../../typespec/admin/users/management.ts";
import type { PaginationKey } from "../../../typespec/common/pagination.ts";
import { useMyInfoQuery } from "../features/profile/queries";
import { listUsers } from "../features/users/api";

interface UserFilters {
  email?: string;
  displayName?: string;
  state?: State;
  permission?: AdminPermission;
  isSuperadmin?: boolean;
}

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const { data: me } = useMyInfoQuery();
  const [filters, setFilters] = useState<UserFilters>({});
  const [pageKeys, setPageKeys] = useState<Array<PaginationKey | undefined>>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const request: ListUsersRequest = {
    limit: 25,
    pagination_key: pageKeys[pageIndex],
    filter_email_address: filters.email || undefined,
    filter_display_name: filters.displayName || undefined,
    filter_state: filters.state,
    filter_permission: filters.permission,
    filter_is_superadmin: filters.isSuperadmin,
  };
  const query = useQuery({
    queryKey: ["admin", "users", request],
    queryFn: () => listUsers(request),
    placeholderData: (previous) => previous,
  });
  const allowed =
    me?.is_superadmin === true ||
    me?.permissions.includes("admin:view_users") === true;

  if (!allowed) return <Navigate replace to="/" />;

  const columns: ColumnsType<AdminUserSummary> = [
    {
      title: t("fields.name"),
      key: "name",
      render: (_, user) =>
        user.display_names.find(
          (name) => name.language_code === user.primary_display_name_language,
        )?.display_name ?? user.email_address,
    },
    { title: t("fields.email"), dataIndex: "email_address", key: "email" },
    {
      title: t("fields.state"),
      key: "state",
      render: (_, user) => (
        <Tag color={user.state === "active" ? "green" : "default"}>
          {t(`states.${user.state}`)}
        </Tag>
      ),
    },
    {
      title: t("fields.access"),
      key: "access",
      render: (_, user) =>
        user.is_superadmin
          ? t("home.superadmin")
          : user.permissions
              .map((permission) => t(`permissions.${permission}`))
              .join(", ") || t("home.noPermissions"),
    },
    {
      title: t("fields.lastLogin"),
      key: "lastLogin",
      render: (_, user) =>
        user.last_login_at === undefined
          ? t("common.never")
          : new Intl.DateTimeFormat(i18n.language, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(user.last_login_at)),
    },
  ];

  const applyFilters = (values: UserFilters) => {
    setFilters(values);
    setPageKeys([undefined]);
    setPageIndex(0);
  };
  const next = () => {
    const nextKey = query.data?.next_pagination_key;
    if (nextKey === undefined) return;
    setPageKeys((keys) => [...keys.slice(0, pageIndex + 1), nextKey]);
    setPageIndex((index) => index + 1);
  };

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <div>
        <Typography.Title level={1}>{t("users.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("users.description")}
        </Typography.Text>
      </div>
      <Card title={t("users.filters")}>
        <Form<UserFilters> layout="vertical" onFinish={applyFilters}>
          <Flex gap="middle" wrap>
            <Form.Item name="email" label={t("fields.email")}>
              <Input allowClear />
            </Form.Item>
            <Form.Item name="displayName" label={t("fields.displayName")}>
              <Input allowClear />
            </Form.Item>
            <Form.Item name="state" label={t("fields.state")}>
              <Select
                allowClear
                className="filter-select"
                options={[
                  { value: "active", label: t("states.active") },
                  { value: "disabled", label: t("states.disabled") },
                ]}
              />
            </Form.Item>
            <Form.Item name="permission" label={t("fields.permission")}>
              <Select
                allowClear
                className="filter-select"
                options={[
                  {
                    value: "admin:view_users",
                    label: t("permissions.admin:view_users"),
                  },
                  {
                    value: "admin:manage_users",
                    label: t("permissions.admin:manage_users"),
                  },
                ]}
              />
            </Form.Item>
            <Form.Item name="isSuperadmin" label={t("fields.accountType")}>
              <Select
                allowClear
                className="filter-select"
                options={[
                  { value: true, label: t("home.superadmin") },
                  { value: false, label: t("users.regularAdmin") },
                ]}
              />
            </Form.Item>
          </Flex>
          <Button type="primary" htmlType="submit">
            {t("users.applyFilters")}
          </Button>
        </Form>
      </Card>
      {query.isError ? (
        <Alert type="error" title={t("common.loadError")} />
      ) : null}
      <Table<AdminUserSummary>
        rowKey="admin_user_id"
        columns={columns}
        dataSource={query.data?.users ?? []}
        loading={query.isPending || query.isFetching}
        pagination={false}
        scroll={{ x: 900 }}
      />
      <Flex justify="space-between" align="center">
        <Button
          disabled={pageIndex === 0}
          onClick={() => setPageIndex((index) => index - 1)}
        >
          {t("common.previous")}
        </Button>
        <Typography.Text>
          {t("users.page", { page: pageIndex + 1 })}
        </Typography.Text>
        <Button
          disabled={query.data?.next_pagination_key === undefined}
          onClick={next}
        >
          {t("common.next")}
        </Button>
      </Flex>
    </Space>
  );
}
