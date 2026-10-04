import { MoreOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Dropdown,
  Flex,
  Input,
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
  type InvitationSummary,
  maxBulk,
} from "typespec/orgs/users/invitations";
import { orgsAPI } from "../../api/orgs";
import { problemMessage } from "../../components/common/APIErrorAlert";
import { useDateTimeFormat } from "../../components/common/useDateTimeFormat";
import {
  invitationsQueryKey,
  useInvitationsQuery,
  userSummaryQueryKey,
} from "./queries";
import { roleOf } from "./roles";

const pageSize = 25;

export function InvitationsTab() {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const formatDateTime = useDateTimeFormat();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [pageKeys, setPageKeys] = useState<Array<PaginationKey | undefined>>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const next = search.trim().toLowerCase();
    const value = next.length >= 2 ? next : "";
    if (value === applied) return;
    const timer = setTimeout(() => {
      setApplied(value);
      setPageKeys([undefined]);
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, applied]);

  const query = useInvitationsQuery({
    limit: pageSize,
    ...(applied === "" ? {} : { filter_search: applied }),
    ...(pageKeys[pageIndex] === undefined
      ? {}
      : { pagination_key: pageKeys[pageIndex] }),
  });
  const invitations = query.data?.invitations ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: invitationsQueryKey });
    void queryClient.invalidateQueries({ queryKey: userSummaryQueryKey });
  };
  const resend = useMutation({
    mutationFn: (emailAddress: string) =>
      orgsAPI.resendInvitation(
        { email_address: emailAddress },
        crypto.randomUUID(),
      ),
    onSuccess: () => void message.success(t("invitations.resent")),
    onError: (error) => void message.error(problemMessage(t, error)),
    onSettled: refresh,
  });
  const cancel = useMutation({
    mutationFn: (emails: string[]) =>
      orgsAPI.cancelInvitations({ email_addresses: emails }),
    onSuccess: () => {
      setSelected([]);
      void message.success(t("invitations.cancelled"));
    },
    onError: (error) => void message.error(problemMessage(t, error)),
    onSettled: refresh,
  });
  const confirmCancel = (emails: string[]) =>
    modal.confirm({
      title: t("invitations.cancelConfirm", { count: emails.length }),
      content: t("invitations.cancelEffect"),
      okText: t("invitations.cancelAction"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: () => cancel.mutateAsync(emails).catch(() => {}),
    });

  const columns: ColumnsType<InvitationSummary> = [
    { title: t("fields.email"), dataIndex: "email_address", key: "email" },
    {
      title: t("users.role"),
      key: "role",
      width: 160,
      render: (_, invitation) => (
        <Tag>{t(`roles.${roleOf(invitation.permissions)}`)}</Tag>
      ),
    },
    {
      title: t("invitations.invitedBy"),
      dataIndex: "invited_by",
      key: "invitedBy",
      responsive: ["lg"],
    },
    {
      title: t("invitations.expires"),
      key: "expires",
      width: 230,
      render: (_, invitation) =>
        Date.parse(invitation.expires_at) <= Date.now() ? (
          <Tag color="orange">{t("invitations.expired")}</Tag>
        ) : (
          formatDateTime(invitation.expires_at)
        ),
    },
    {
      title: t("users.columns.actions"),
      key: "actions",
      width: 100,
      render: (_, invitation) => (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              { key: "resend", label: t("invitations.resend") },
              {
                key: "cancel",
                label: t("invitations.cancelAction"),
                danger: true,
              },
            ],
            onClick: ({ key }) => {
              if (key === "resend") resend.mutate(invitation.email_address);
              else confirmCancel([invitation.email_address]);
            },
          }}
        >
          <Button
            icon={<MoreOutlined />}
            disabled={resend.isPending || cancel.isPending}
            aria-label={t("users.actionsFor", {
              email: invitation.email_address,
            })}
          />
        </Dropdown>
      ),
    },
  ];

  const next = () => {
    const key = query.data?.next_pagination_key;
    if (key === undefined) return;
    setPageKeys((keys) => [...keys.slice(0, pageIndex + 1), key]);
    setPageIndex((index) => index + 1);
  };

  return (
    <Space orientation="vertical" size="middle" className="full-width">
      <Flex gap="middle" wrap align="center">
        <Input
          className="member-search"
          allowClear
          value={search}
          prefix={<SearchOutlined aria-hidden />}
          placeholder={t("users.searchPlaceholder")}
          aria-label={t("invitations.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
        {selected.length > 0 ? (
          <>
            <Typography.Text strong>
              {t("users.bulk.selected", { count: selected.length })}
            </Typography.Text>
            <Button danger onClick={() => confirmCancel(selected)}>
              {t("invitations.cancelSelected")}
            </Button>
          </>
        ) : null}
      </Flex>
      {selected.length > 0 ? (
        <Typography.Text type="secondary">
          {t("people.selection", { count: maxBulk })}
        </Typography.Text>
      ) : null}
      {query.isError ? (
        <Alert type="error" title={t("common.loadError")} />
      ) : null}
      <Table<InvitationSummary>
        rowKey="email_address"
        columns={columns}
        dataSource={invitations}
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
          getCheckboxProps: (invitation) => ({
            disabled:
              !selected.includes(invitation.email_address) &&
              selected.length >= maxBulk,
          }),
        }}
        locale={{ emptyText: t("invitations.empty") }}
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
    </Space>
  );
}
