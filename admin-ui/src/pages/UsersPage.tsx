import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
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
import { SuperadminRequiredError } from "../../../typespec/problem/admin/authorization.ts";
import {
  AdminUserNotFoundError,
  CannotDisableCurrentAdminError,
  LastActiveSuperadminError,
} from "../../../typespec/problem/admin/users.ts";
import { problemTranslationKey } from "../api/problems";
import { intlLocale } from "../app/preferences";
import { UserAccessModal } from "../features/authorization/UserAccessModal";
import { useMyInfoQuery } from "../features/profile/queries";
import { disableUser, enableUser } from "../features/users/api";
import { InviteUserModal } from "../features/users/InviteUserModal";
import { usersQueryKey, useUsersQuery } from "../features/users/queries";

interface UserFilters {
  email?: string;
  displayName?: string;
  state?: State;
  permission?: AdminPermission;
  isSuperadmin?: boolean;
}

const stateProblems = {
  [AdminUserNotFoundError.type]: "users.errors.notFound",
  [CannotDisableCurrentAdminError.type]: "users.errors.cannotDisableSelf",
  [LastActiveSuperadminError.type]: "users.errors.lastSuperadmin",
  [SuperadminRequiredError.type]: "users.errors.superadminRequired",
};

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data: me } = useMyInfoQuery();
  const [filters, setFilters] = useState<UserFilters>({});
  const [pageKeys, setPageKeys] = useState<Array<PaginationKey | undefined>>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [accessUserID, setAccessUserID] = useState<string | null>(null);
  const request: ListUsersRequest = {
    limit: 25,
    pagination_key: pageKeys[pageIndex],
    filter_email_address: filters.email || undefined,
    filter_display_name: filters.displayName || undefined,
    filter_state: filters.state,
    filter_permission: filters.permission,
    filter_is_superadmin: filters.isSuperadmin,
  };
  const query = useUsersQuery(request);
  const stateMutation = useMutation({
    mutationFn: ({ user }: { user: AdminUserSummary }) =>
      user.state === "active"
        ? disableUser({ admin_user_id: user.admin_user_id })
        : enableUser({ admin_user_id: user.admin_user_id }),
  });
  const allowed =
    me?.is_superadmin === true ||
    me?.permissions.includes("admin:view_users") === true;

  // A direct visit starts with an empty query cache. Wait for the identity
  // request before deciding whether to redirect; `undefined` is not evidence
  // that the administrator lacks access.
  if (me === undefined) return <Spin size="large" />;
  if (!allowed) return <Navigate replace to="/" />;

  const canManageUsers =
    me?.is_superadmin === true ||
    me?.permissions.includes("admin:manage_users") === true;
  const canManageAccess = me?.is_superadmin === true;
  // Both state mutations reject a superadmin target unless the actor is one
  // too, and neither accepts the actor's own account.
  const canChangeState = (user: AdminUserSummary) =>
    canManageUsers &&
    !stateMutation.isPending &&
    user.admin_user_id !== me?.admin_user_id &&
    (!user.is_superadmin || canManageAccess);

  const setState = async (user: AdminUserSummary) => {
    const disabling = user.state === "active";
    try {
      await stateMutation.mutateAsync({ user });
      void message.success(
        t(disabling ? "users.disable.done" : "users.enable.done"),
      );
    } catch (error) {
      void message.error(t(problemTranslationKey(error, stateProblems)));
    } finally {
      // Also on failure: a state change that commits and loses its response
      // would otherwise leave the row offering the action it just performed.
      void queryClient.invalidateQueries({ queryKey: usersQueryKey });
    }
  };

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
          : new Intl.DateTimeFormat(intlLocale(i18n.language), {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(user.last_login_at)),
    },
    ...(canManageUsers || canManageAccess
      ? [
          {
            title: t("fields.actions"),
            key: "actions",
            render: (_: unknown, user: AdminUserSummary) => (
              <Space wrap>
                {canManageUsers ? (
                  <Popconfirm
                    title={t(
                      user.state === "active"
                        ? "users.disable.confirm"
                        : "users.enable.confirm",
                    )}
                    okText={t("common.confirm")}
                    cancelText={t("common.cancel")}
                    disabled={!canChangeState(user)}
                    onConfirm={() => void setState(user)}
                  >
                    <Button
                      size="small"
                      danger={user.state === "active"}
                      disabled={!canChangeState(user)}
                      loading={
                        stateMutation.isPending &&
                        stateMutation.variables?.user.admin_user_id ===
                          user.admin_user_id
                      }
                    >
                      {t(
                        user.state === "active"
                          ? "users.disable.action"
                          : "users.enable.action",
                      )}
                    </Button>
                  </Popconfirm>
                ) : null}
                {canManageAccess ? (
                  <Button
                    size="small"
                    onClick={() => setAccessUserID(user.admin_user_id)}
                  >
                    {t("users.access.action")}
                  </Button>
                ) : null}
              </Space>
            ),
          },
        ]
      : []),
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
  const users = query.data?.users ?? [];
  const accessUser =
    users.find((user) => user.admin_user_id === accessUserID) ?? null;

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <Flex align="flex-start" justify="space-between" gap="middle" wrap>
        <div>
          <Typography.Title level={1}>{t("users.title")}</Typography.Title>
          <Typography.Text type="secondary">
            {t("users.description")}
          </Typography.Text>
        </div>
        {canManageUsers ? (
          <Button type="primary" onClick={() => setInviteOpen(true)}>
            {t("users.invite.action")}
          </Button>
        ) : null}
      </Flex>
      <Card title={t("users.filters")}>
        <Form<UserFilters> layout="vertical" onFinish={applyFilters}>
          <Flex gap="middle" wrap>
            <Form.Item name="email" label={t("fields.email")}>
              <Input allowClear maxLength={320} />
            </Form.Item>
            <Form.Item name="displayName" label={t("fields.displayName")}>
              <Input allowClear maxLength={320} />
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
        dataSource={users}
        loading={query.isPending || query.isFetching}
        pagination={false}
        scroll={{ x: 1100 }}
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
      <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <UserAccessModal
        user={accessUser}
        onClose={() => setAccessUserID(null)}
      />
    </Space>
  );
}
