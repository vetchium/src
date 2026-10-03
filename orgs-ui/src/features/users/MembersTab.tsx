import { MoreOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ReauthenticationAlert } from "@vetchium/portal-ui/shell";
import {
  Alert,
  App,
  Button,
  Dropdown,
  Flex,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PaginationKey } from "typespec/common/pagination";
import {
  directPermissions,
  type OrgPermissionID,
  Superadmin,
} from "typespec/orgs/authorization/types";
import { maxBulk } from "typespec/orgs/users/invitations";
import type {
  OrgUserSummary,
  UserSort,
  UserStateFilter,
} from "typespec/orgs/users/management";
import { isRecentAuthenticationRequired } from "../../api/client";
import { orgsAPI } from "../../api/orgs";
import { problemMessage } from "../../components/common/APIErrorAlert";
import { useDateTimeFormat } from "../../components/common/useDateTimeFormat";
import { CustomRoleDrawer } from "./CustomRoleDrawer";
import { ExportButton } from "./ExportButton";
import { filtersToRequest, hasFilters, type MemberFilters } from "./filters";
import { userSummaryQueryKey, usersQueryKey, useUsersQuery } from "./queries";
import {
  mayChange,
  presetGrants,
  type Role,
  type RolePreset,
  roleOf,
  rolePresets,
} from "./roles";

interface MembersTabProps {
  viewerEmail: string;
  viewerPermissions: readonly OrgPermissionID[];
  filters: MemberFilters;
  onFilters: (filters: MemberFilters) => void;
}

const pageSize = 25;

export function MembersTab({
  viewerEmail,
  viewerPermissions,
  filters,
  onFilters,
}: MembersTabProps) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const formatDateTime = useDateTimeFormat();
  const [search, setSearch] = useState(filters.search);
  const [pageKeys, setPageKeys] = useState<Array<PaginationKey | undefined>>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [customUser, setCustomUser] = useState<OrgUserSummary | null>(null);
  const [stepUp, setStepUp] = useState(false);

  // The search box follows the applied filter, such as when a summary link
  // clears it, and applies itself once it holds enough to search for.
  useEffect(() => setSearch(filters.search), [filters.search]);
  useEffect(() => {
    const next = search.trim().toLowerCase();
    const applied = next.length >= 2 ? next : "";
    if (applied === filters.search) return;
    const timer = setTimeout(
      () => onFilters({ ...filters, search: applied }),
      300,
    );
    return () => clearTimeout(timer);
  }, [search, filters, onFilters]);

  // A new filter or sort starts again from the first page.
  const filterKey = JSON.stringify(filters);
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey);
    setPageKeys([undefined]);
    setPageIndex(0);
  }

  const query = useUsersQuery({
    ...filtersToRequest(filters),
    limit: pageSize,
    ...(pageKeys[pageIndex] === undefined
      ? {}
      : { pagination_key: pageKeys[pageIndex] }),
  });
  const users = query.data?.users ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: usersQueryKey });
    void queryClient.invalidateQueries({ queryKey: userSummaryQueryKey });
  };
  const report = (error: unknown) => {
    if (isRecentAuthenticationRequired(error)) {
      setStepUp(true);
      return;
    }
    void message.error(problemMessage(t, error));
  };

  const setRole = useMutation({
    mutationFn: (change: { emails: string[]; grants: OrgPermissionID[] }) =>
      change.emails.length === 1 && change.emails[0] !== undefined
        ? orgsAPI.setUserPermissions({
            email_address: change.emails[0],
            permissions: directPermissions(change.grants),
          })
        : orgsAPI.bulkSetUserPermissions({
            email_addresses: change.emails,
            permissions: directPermissions(change.grants),
          }),
    onSuccess: () => {
      setStepUp(false);
      setSelected([]);
      void message.success(t("users.roleChange.saved"));
    },
    onError: report,
    onSettled: refresh,
  });
  const setState = useMutation({
    mutationFn: (change: { emails: string[]; enable: boolean }) => {
      const [only] = change.emails;
      if (change.emails.length === 1 && only !== undefined) {
        return change.enable
          ? orgsAPI.enableUser({ email_address: only })
          : orgsAPI.disableUser({ email_address: only });
      }
      return change.enable
        ? orgsAPI.bulkEnableUsers({ email_addresses: change.emails })
        : orgsAPI.bulkDisableUsers({ email_addresses: change.emails });
    },
    onSuccess: (_, change) => {
      setSelected([]);
      void message.success(
        t(change.enable ? "users.enable.done" : "users.disable.done"),
      );
    },
    onError: report,
    onSettled: refresh,
  });

  const confirmState = (emails: string[], enable: boolean) =>
    modal.confirm({
      title: t(enable ? "users.enable.confirm" : "users.disable.confirm", {
        count: emails.length,
      }),
      content: t(enable ? "users.enable.effect" : "users.disable.effect"),
      okText: t(enable ? "users.enable.action" : "users.disable.action"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: !enable },
      onOk: () => setState.mutateAsync({ emails, enable }).catch(() => {}),
    });
  const confirmRole = (emails: string[], preset: RolePreset) =>
    modal.confirm({
      title: t("users.roleChange.confirm", {
        count: emails.length,
        role: t(`roles.${preset}`),
      }),
      content: t("users.roleChange.effect"),
      okText: t("users.roleChange.action"),
      cancelText: t("common.cancel"),
      onOk: () =>
        setRole
          .mutateAsync({ emails, grants: presetGrants(preset) })
          .catch(() => {}),
    });

  const isViewer = (user: OrgUserSummary) => user.email_address === viewerEmail;
  const holdsSuperadmin = (user: OrgUserSummary) =>
    user.granted_permissions.includes(Superadmin);
  const viewerIsSuperadmin = viewerPermissions.includes(Superadmin);

  const columns: ColumnsType<OrgUserSummary> = [
    {
      title: t("fields.email"),
      key: "email",
      render: (_, user) => (
        <Typography.Text strong={isViewer(user)}>
          {user.email_address}
          {isViewer(user) ? ` (${t("users.you")})` : null}
        </Typography.Text>
      ),
    },
    {
      title: t("users.role"),
      key: "role",
      width: 220,
      render: (_, user) => {
        const role: Role = roleOf(user.granted_permissions);
        return (
          <Select<Role>
            className="full-width"
            value={role}
            aria-label={t("users.roleOf", { email: user.email_address })}
            disabled={
              isViewer(user) ||
              setRole.isPending ||
              (!viewerIsSuperadmin && holdsSuperadmin(user))
            }
            options={[
              ...rolePresets.map(({ preset, grants }) => ({
                value: preset as Role,
                label: t(`roles.${preset}`),
                disabled: !mayChange(
                  viewerPermissions,
                  user.granted_permissions,
                  grants,
                ),
              })),
              { value: "custom" as Role, label: t("users.custom.option") },
            ]}
            // onSelect, not onChange: choosing "Custom…" again for a user who
            // already has a custom role changes no value but must still open
            // the editor.
            onSelect={(next) => {
              if (next === "custom") setCustomUser(user);
              else if (next !== role) confirmRole([user.email_address], next);
            }}
          />
        );
      },
    },
    {
      title: t("users.columns.state"),
      key: "state",
      width: 190,
      render: (_, user) =>
        user.state === "active" ? (
          <Tag color="green">{t("users.state.active")}</Tag>
        ) : (
          <Tag>
            {t(
              user.disabled_reason === "nonpayment"
                ? "users.state.disabledNonpayment"
                : "users.state.disabledManual",
            )}
          </Tag>
        ),
    },
    {
      title: t("users.columns.joined"),
      key: "joined",
      width: 190,
      responsive: ["lg"],
      render: (_, user) => formatDateTime(user.joined_at),
    },
    {
      title: t("users.columns.lastSignIn"),
      key: "lastSignIn",
      width: 190,
      responsive: ["xl"],
      render: (_, user) =>
        user.last_login_at === undefined
          ? t("users.never")
          : formatDateTime(user.last_login_at),
    },
    {
      title: t("users.columns.actions"),
      key: "actions",
      width: 88,
      align: "center",
      render: (_, user) => {
        const active = user.state === "active";
        return (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "permissions",
                  disabled:
                    isViewer(user) ||
                    (!viewerIsSuperadmin && holdsSuperadmin(user)),
                  label: t("users.custom.edit"),
                },
                {
                  key: "state",
                  danger: active,
                  disabled:
                    (active && isViewer(user)) ||
                    (!viewerIsSuperadmin && holdsSuperadmin(user)),
                  label: t(
                    active ? "users.disable.action" : "users.enable.action",
                  ),
                },
              ],
              onClick: ({ key }) => {
                if (key === "permissions") setCustomUser(user);
                else confirmState([user.email_address], !active);
              },
            }}
          >
            <Button
              type="text"
              icon={<MoreOutlined />}
              aria-label={t("users.actionsFor", { email: user.email_address })}
            />
          </Dropdown>
        );
      },
    },
  ];

  const next = () => {
    const key = query.data?.next_pagination_key;
    if (key === undefined) return;
    setPageKeys((keys) => [...keys.slice(0, pageIndex + 1), key]);
    setPageIndex((index) => index + 1);
  };
  const reset = () =>
    onFilters({ ...filters, search: "", state: undefined, role: undefined });

  return (
    <Space orientation="vertical" size="middle" className="full-width">
      <Flex gap="middle" wrap align="center">
        <Input
          className="member-search"
          allowClear
          value={search}
          prefix={<SearchOutlined aria-hidden />}
          placeholder={t("users.searchPlaceholder")}
          aria-label={t("users.searchPlaceholder")}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select<UserStateFilter>
          allowClear
          className="filter-select"
          value={filters.state}
          placeholder={t("users.filters.state")}
          aria-label={t("users.filters.state")}
          options={(
            ["active", "disabled-manual", "disabled-nonpayment"] as const
          ).map((value) => ({
            value,
            label: t(`users.filterState.${value}`),
          }))}
          onChange={(state) => onFilters({ ...filters, state })}
        />
        <Select<RolePreset>
          allowClear
          className="filter-select"
          value={filters.role}
          placeholder={t("users.filters.role")}
          aria-label={t("users.filters.role")}
          options={rolePresets.map(({ preset }) => ({
            value: preset,
            label: t(`roles.${preset}`),
          }))}
          onChange={(role) => onFilters({ ...filters, role })}
        />
        <Select<UserSort>
          className="filter-select"
          value={filters.sort}
          aria-label={t("users.sort.label")}
          options={[
            { value: "email", label: t("users.sort.email") },
            { value: "joined", label: t("users.sort.joined") },
          ]}
          onChange={(sort) => onFilters({ ...filters, sort })}
        />
        <Button
          aria-pressed={filters.descending}
          onClick={() =>
            onFilters({ ...filters, descending: !filters.descending })
          }
        >
          {t(
            filters.descending
              ? "users.sort.descending"
              : "users.sort.ascending",
          )}
        </Button>
        {hasFilters(filters) ? (
          <Button type="link" onClick={reset}>
            {t("users.clearFilters")}
          </Button>
        ) : null}
        <ExportButton filters={filters} />
      </Flex>

      {stepUp ? <ReauthenticationAlert /> : null}
      {selected.length > 0 ? (
        <Flex gap="small" wrap align="center" data-testid="bulk-bar">
          <Typography.Text strong>
            {t("users.bulk.selected", { count: selected.length })}
          </Typography.Text>
          {selected.length >= maxBulk ? (
            <Typography.Text type="secondary">
              {t("users.bulk.limit", { count: maxBulk })}
            </Typography.Text>
          ) : null}
          <Select<RolePreset>
            className="filter-select"
            value={null}
            placeholder={t("users.bulk.setRole")}
            aria-label={t("users.bulk.setRole")}
            options={rolePresets.map(({ preset, grants }) => ({
              value: preset,
              label: t(`roles.${preset}`),
              disabled: !mayChange(viewerPermissions, [], grants),
            }))}
            onChange={(preset) => confirmRole(selected, preset)}
          />
          <Button danger onClick={() => confirmState(selected, false)}>
            {t("users.bulk.disable")}
          </Button>
          <Button onClick={() => confirmState(selected, true)}>
            {t("users.bulk.enable")}
          </Button>
          <Button type="link" onClick={() => setSelected([])}>
            {t("users.bulk.clear")}
          </Button>
        </Flex>
      ) : null}

      {query.isError ? (
        <Alert type="error" title={t("common.loadError")} />
      ) : null}
      <Table<OrgUserSummary>
        rowKey="email_address"
        columns={columns}
        dataSource={users}
        loading={query.isPending || query.isFetching}
        pagination={false}
        scroll={{ x: 760 }}
        rowSelection={{
          selectedRowKeys: selected,
          preserveSelectedRowKeys: true,
          onChange: (keys) => {
            const emails = keys.map(String);
            if (emails.length > maxBulk) {
              void message.warning(t("users.bulk.limit", { count: maxBulk }));
              return;
            }
            setSelected(emails);
          },
          getCheckboxProps: (user) => ({
            disabled:
              !selected.includes(user.email_address) &&
              selected.length >= maxBulk,
          }),
        }}
        locale={{
          emptyText: hasFilters(filters)
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
      <CustomRoleDrawer
        key={customUser?.email_address ?? "closed"}
        user={customUser}
        viewerPermissions={viewerPermissions}
        onClose={() => setCustomUser(null)}
      />
    </Space>
  );
}
