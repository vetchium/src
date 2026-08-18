import {
  MoreOutlined,
  SearchOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Dropdown,
  Flex,
  Input,
  Segmented,
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
import type { AdminPermissionID } from "../../../typespec/admin/authorization/types.ts";
import {
  AdminPermissions,
  ManageUsers,
  ViewUsers,
} from "../../../typespec/admin/authorization/types.ts";
import type { State } from "../../../typespec/admin/user/user.ts";
import type {
  AdminLastLoginFilter,
  AdminUserSummary,
  ListUsersRequest,
} from "../../../typespec/admin/users/management.ts";
import type { PaginationKey } from "../../../typespec/common/pagination.ts";
import {
  AdminUserNotFoundError,
  CannotDisableCurrentAdminError,
  LastAdminManagerError,
} from "../../../typespec/problem/admin/users.ts";
import { problemTranslationKey } from "../api/problems";
import { intlLocale } from "../app/preferences";
import {
  permissionNameKey,
  permissionRows,
} from "../features/authorization/permissions";
import { UserAccessModal } from "../features/authorization/UserAccessModal";
import { useMyInfoQuery } from "../features/profile/queries";
import { disableUser, enableUser } from "../features/users/api";
import { InviteUserModal } from "../features/users/InviteUserModal";
import { usersQueryKey, useUsersQuery } from "../features/users/queries";

interface UserFilters {
  search?: string;
  state?: State;
  permissions?: AdminPermissionID[];
  noPermissions?: boolean;
  totpEnabled?: boolean;
  lastLogin?: AdminLastLoginFilter;
}

const stateProblems = {
  [AdminUserNotFoundError.type]: "users.errors.notFound",
  [CannotDisableCurrentAdminError.type]: "users.errors.cannotDisableSelf",
  [LastAdminManagerError.type]: "users.errors.lastManager",
};

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { data: me } = useMyInfoQuery();
  const [filters, setFilters] = useState<UserFilters>({});
  const [search, setSearch] = useState("");
  const [pageKeys, setPageKeys] = useState<Array<PaginationKey | undefined>>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [accessUserID, setAccessUserID] = useState<string | null>(null);
  const request: ListUsersRequest = {
    limit: 25,
    pagination_key: pageKeys[pageIndex],
    filter_search: filters.search || undefined,
    filter_state: filters.state,
    filter_permissions: filters.permissions,
    filter_no_permissions: filters.noPermissions,
    filter_totp_enabled: filters.totpEnabled,
    filter_last_login: filters.lastLogin,
  };
  const query = useUsersQuery(request);
  const stateMutation = useMutation({
    mutationFn: ({ user }: { user: AdminUserSummary }) =>
      user.state === "active"
        ? disableUser({ admin_user_id: user.admin_user_id })
        : enableUser({ admin_user_id: user.admin_user_id }),
  });

  const allowed = me?.permissions.includes(ViewUsers) === true;
  if (me === undefined) return <Spin size="large" />;
  if (!allowed) return <Navigate replace to="/" />;

  const canManageUsers = me.permissions.includes(ManageUsers);
  const resetPagination = () => {
    setPageKeys([undefined]);
    setPageIndex(0);
  };
  const updateFilters = (patch: Partial<UserFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    resetPagination();
  };
  const clearFilters = () => {
    setSearch("");
    setFilters({});
    resetPagination();
  };
  const hasFilters = Object.values(filters).some(
    (value) => value !== undefined,
  );

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
      void queryClient.invalidateQueries({ queryKey: usersQueryKey });
    }
  };

  const confirmStateChange = (user: AdminUserSummary) => {
    const disabling = user.state === "active";
    modal.confirm({
      title: t(disabling ? "users.disable.confirm" : "users.enable.confirm"),
      content: disabling ? t("users.disable.effect") : t("users.enable.effect"),
      okText: t(disabling ? "users.disable.action" : "users.enable.action"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: disabling },
      onOk: () => setState(user),
    });
  };

  const displayName = (user: AdminUserSummary) =>
    user.display_names.find(
      (name) => name.language_code === user.primary_display_name_language,
    )?.display_name ?? user.email_address;

  const columns: ColumnsType<AdminUserSummary> = [
    {
      title: t("fields.administrator"),
      key: "administrator",
      render: (_, user) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{displayName(user)}</Typography.Text>
          <Typography.Text type="secondary" copyable>
            {user.email_address}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t("fields.state"),
      key: "state",
      width: 120,
      render: (_, user) => (
        <Tag color={user.state === "active" ? "green" : "default"}>
          {t(`states.${user.state}`)}
        </Tag>
      ),
    },
    {
      title: t("fields.access"),
      key: "access",
      width: 260,
      render: (_, user) =>
        user.permissions.length === 0 ? (
          <Typography.Text type="secondary">
            {t("users.access.none")}
          </Typography.Text>
        ) : (
          <Space size={[0, 4]} wrap>
            {permissionRows(user.permissions)
              .filter((row) => row.selected)
              .map((row) => (
                <Tag
                  key={row.permission}
                  color={row.impliedBy.length === 0 ? "blue" : undefined}
                >
                  {row.defined
                    ? t(permissionNameKey(row.permission))
                    : row.permission}
                </Tag>
              ))}
          </Space>
        ),
    },
    {
      title: t("fields.twoFactor"),
      key: "twoFactor",
      width: 140,
      responsive: ["md"],
      render: (_, user) => (
        <Tag color={user.totp_enabled ? "green" : "orange"}>
          {t(user.totp_enabled ? "common.enabled" : "common.notEnabled")}
        </Tag>
      ),
    },
    {
      title: t("fields.lastLogin"),
      key: "lastLogin",
      width: 190,
      responsive: ["lg"],
      render: (_, user) =>
        user.last_login_at === undefined
          ? t("common.never")
          : new Intl.DateTimeFormat(intlLocale(i18n.language), {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(user.last_login_at)),
    },
    ...(canManageUsers
      ? [
          {
            title: t("fields.actions"),
            key: "actions",
            width: 88,
            align: "center" as const,
            render: (_: unknown, user: AdminUserSummary) => (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    {
                      key: "access",
                      label: t("users.access.action"),
                    },
                    { type: "divider" },
                    {
                      key: "state",
                      danger: user.state === "active",
                      disabled: user.admin_user_id === me.admin_user_id,
                      label: t(
                        user.state === "active"
                          ? "users.disable.action"
                          : "users.enable.action",
                      ),
                    },
                  ],
                  onClick: ({ key }) => {
                    if (key === "access") setAccessUserID(user.admin_user_id);
                    if (key === "state") confirmStateChange(user);
                  },
                }}
              >
                <Button
                  type="text"
                  icon={<MoreOutlined />}
                  aria-label={t("users.actionsFor", {
                    name: displayName(user),
                  })}
                />
              </Dropdown>
            ),
          },
        ]
      : []),
  ];

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
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            onClick={() => setInviteOpen(true)}
          >
            {t("users.invite.action")}
          </Button>
        ) : null}
      </Flex>

      <Card className="administrator-toolbar">
        <Space orientation="vertical" size="middle" className="full-width">
          <Flex gap="middle" align="center" wrap>
            <Input.Search
              className="administrator-search"
              allowClear
              value={search}
              enterButton={<SearchOutlined aria-label={t("common.search")} />}
              placeholder={t("users.searchPlaceholder")}
              aria-label={t("users.searchPlaceholder")}
              onChange={(event) => {
                setSearch(event.target.value);
                if (event.target.value === "")
                  updateFilters({ search: undefined });
              }}
              onSearch={(value) =>
                updateFilters({ search: value.trim() || undefined })
              }
            />
            <Segmented
              aria-label={t("users.statusFilter")}
              value={filters.state ?? "all"}
              options={[
                { value: "all", label: t("common.all") },
                { value: "active", label: t("states.active") },
                { value: "disabled", label: t("states.disabled") },
              ]}
              onChange={(value) =>
                updateFilters({
                  state: value === "all" ? undefined : (value as State),
                })
              }
            />
          </Flex>
          <Flex gap="small" align="center" wrap>
            <Typography.Text type="secondary">
              {t("users.needsAttention")}
            </Typography.Text>
            <Button
              size="small"
              type={filters.totpEnabled === false ? "primary" : "default"}
              onClick={() =>
                updateFilters({
                  totpEnabled:
                    filters.totpEnabled === false ? undefined : false,
                })
              }
            >
              {t("users.quickFilters.noTwoFactor")}
            </Button>
            <Button
              size="small"
              type={filters.lastLogin === "never" ? "primary" : "default"}
              onClick={() =>
                updateFilters({
                  lastLogin:
                    filters.lastLogin === "never" ? undefined : "never",
                })
              }
            >
              {t("users.quickFilters.neverSignedIn")}
            </Button>
            <Button
              size="small"
              type={
                filters.lastLogin === "inactive_90_days" ? "primary" : "default"
              }
              onClick={() =>
                updateFilters({
                  lastLogin:
                    filters.lastLogin === "inactive_90_days"
                      ? undefined
                      : "inactive_90_days",
                })
              }
            >
              {t("users.quickFilters.dormant")}
            </Button>
            <Button
              size="small"
              type={filters.noPermissions === true ? "primary" : "default"}
              onClick={() =>
                updateFilters({
                  noPermissions:
                    filters.noPermissions === true ? undefined : true,
                  permissions: undefined,
                })
              }
            >
              {t("users.quickFilters.noAccess")}
            </Button>
          </Flex>
          <Flex gap="small" align="center" wrap>
            <Select<AdminPermissionID[]>
              allowClear
              mode="multiple"
              className="filter-select"
              value={filters.permissions}
              placeholder={t("users.filters.permissions")}
              aria-label={t("users.filters.permissions")}
              options={AdminPermissions.map((permission) => ({
                value: permission,
                label: t(permissionNameKey(permission)),
              }))}
              onChange={(value) =>
                updateFilters({
                  permissions: value.length === 0 ? undefined : value,
                  noPermissions: undefined,
                })
              }
            />
            <Select<AdminLastLoginFilter>
              allowClear
              className="filter-select"
              value={filters.lastLogin}
              placeholder={t("users.filters.activity")}
              aria-label={t("users.filters.activity")}
              options={[
                { value: "never", label: t("users.activity.never") },
                {
                  value: "inactive_30_days",
                  label: t("users.activity.inactive30"),
                },
                {
                  value: "inactive_90_days",
                  label: t("users.activity.inactive90"),
                },
              ]}
              onChange={(value) => updateFilters({ lastLogin: value })}
            />
            {hasFilters ? (
              <Button type="link" onClick={clearFilters}>
                {t("users.clearFilters")}
              </Button>
            ) : null}
          </Flex>
        </Space>
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
        scroll={{ x: 760 }}
        locale={{
          emptyText: hasFilters
            ? t("users.empty.filtered")
            : t("users.empty.default"),
        }}
      />
      <Flex justify="space-between" align="center">
        <Button
          disabled={pageIndex === 0}
          onClick={() => setPageIndex((index) => index - 1)}
        >
          {t("common.previous")}
        </Button>
        <Typography.Text type="secondary">
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
        key={accessUserID ?? "closed"}
        user={accessUser}
        editingSelf={accessUserID === me.admin_user_id}
        onClose={() => setAccessUserID(null)}
      />
    </Space>
  );
}
