import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Space,
  Spin,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router";
import {
  type Event,
  type ListRequest,
  validDateRange,
} from "typespec/admin/audit-logs/events";
import { ViewAuditLogs } from "typespec/admin/authorization/types";
import {
  isDomainName,
  normalizeDomainName,
} from "typespec/admin/hub-signup-domains/domains";
import { isEmailAddress, normalizeEmailAddress } from "typespec/common/common";
import { isHubHandle } from "typespec/hub/types";
import { listAuditEvents } from "../features/audit-logs/api";
import { useMyInfoQuery } from "../features/profile/queries";

interface Filters {
  start_at: string;
  end_at: string;
  hub_handle?: string;
  hub_email?: string;
  org_domain?: string;
  org_user_email?: string;
}

export function AuditLogsPage() {
  const { t, i18n } = useTranslation();
  const { data: me } = useMyInfoQuery();
  const allowed = me?.permissions.includes(ViewAuditLogs) === true;
  const [request, setRequest] = useState<ListRequest>();
  const [keys, setKeys] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState(0);
  const [searchVersion, setSearchVersion] = useState(0);
  const [validation, setValidation] = useState<string>();
  const query = useQuery({
    queryKey: ["admin", "audit-logs", request, searchVersion, keys[page]],
    queryFn: () => {
      if (request === undefined)
        throw new Error("Audit search requires filters");
      return listAuditEvents({ ...request, pagination_key: keys[page] });
    },
    enabled: allowed && request !== undefined,
  });
  if (me === undefined) return <Spin size="large" />;
  if (!allowed) return <Navigate replace to="/" />;
  const search = (values: Filters) => {
    const hubHandle = values.hub_handle?.trim().toLowerCase() || undefined;
    const hubEmail = values.hub_email?.trim()
      ? normalizeEmailAddress(values.hub_email)
      : undefined;
    const orgDomain = values.org_domain?.trim()
      ? normalizeDomainName(values.org_domain)
      : undefined;
    const orgEmail = values.org_user_email?.trim()
      ? normalizeEmailAddress(values.org_user_email)
      : undefined;
    if (!hubHandle && !hubEmail && !orgDomain && !orgEmail) {
      setValidation("auditLogs.identityRequired");
      return;
    }
    if (
      (hubHandle && !isHubHandle(hubHandle)) ||
      (hubEmail && !isEmailAddress(hubEmail)) ||
      (orgDomain && !isDomainName(orgDomain)) ||
      (orgEmail && !isEmailAddress(orgEmail))
    ) {
      setValidation("auditLogs.invalidIdentity");
      return;
    }
    if (!validDateRange(values.start_at, values.end_at)) {
      setValidation("auditLogs.invalidDates");
      return;
    }
    setValidation(undefined);
    setSearchVersion((version) => version + 1);
    setKeys([undefined]);
    setPage(0);
    setRequest({
      start_at: new Date(values.start_at).toISOString(),
      end_at: new Date(values.end_at).toISOString(),
      hub_handle: hubHandle,
      hub_email: hubEmail,
      org_domain: orgDomain,
      org_user_email: orgEmail,
      limit: 25,
    });
  };
  const columns: ColumnsType<Event> = [
    {
      title: t("auditLogs.time"),
      dataIndex: "created_at",
      render: (value: string) =>
        new Intl.DateTimeFormat(i18n.language, {
          dateStyle: "medium",
          timeStyle: "long",
        }).format(new Date(value)),
    },
    { title: t("auditLogs.action"), dataIndex: "action" },
    { title: t("auditLogs.entity"), dataIndex: "entity_type" },
    {
      title: t("auditLogs.actor"),
      key: "actor",
      render: (_: unknown, event: Event) =>
        event.actor_name
          ? `${event.actor_name} (${event.actor_type})`
          : event.actor_type,
    },
    { title: t("auditLogs.source"), dataIndex: "source" },
  ];
  return (
    <Space orientation="vertical" size="large" className="full-width">
      <Typography.Title level={1}>{t("auditLogs.title")}</Typography.Title>
      <Alert
        type="info"
        showIcon
        title={t("auditLogs.scope")}
        description={t("auditLogs.timezone", {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })}
      />
      <Card>
        <Form<Filters> layout="vertical" onFinish={search}>
          <Flex gap="middle" wrap>
            <Form.Item name="hub_handle" label={t("auditLogs.hubHandle")}>
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item name="hub_email" label={t("auditLogs.hubEmail")}>
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item name="org_domain" label={t("auditLogs.orgDomain")}>
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item
              name="org_user_email"
              label={t("auditLogs.orgUserEmail")}
            >
              <Input autoComplete="off" />
            </Form.Item>
          </Flex>
          <Flex gap="middle" wrap>
            <Form.Item
              name="start_at"
              label={t("auditLogs.start")}
              rules={[{ required: true, message: t("validation.required") }]}
            >
              <Input type="datetime-local" step="1" />
            </Form.Item>
            <Form.Item
              name="end_at"
              label={t("auditLogs.end")}
              rules={[{ required: true, message: t("validation.required") }]}
            >
              <Input type="datetime-local" step="1" />
            </Form.Item>
          </Flex>
          {validation ? (
            <Alert type="error" role="alert" title={t(validation)} />
          ) : null}
          <Button type="primary" htmlType="submit" loading={query.isFetching}>
            {t("auditLogs.search")}
          </Button>
        </Form>
      </Card>
      {query.isError ? (
        <Alert
          type="error"
          showIcon
          title={t("common.loadError")}
          action={
            <Button onClick={() => void query.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : (
        <Table<Event>
          rowKey="audit_event_id"
          columns={columns}
          dataSource={query.data?.events ?? []}
          loading={query.isFetching}
          pagination={false}
          locale={{
            emptyText: t(request ? "auditLogs.empty" : "auditLogs.prompt"),
            expand: t("auditLogs.details"),
            collapse: t("auditLogs.collapse"),
          }}
          expandable={{
            expandedRowRender: (event) => (
              <Space orientation="vertical">
                {event.details.length ? (
                  event.details.map((detail) => (
                    <Typography.Text key={detail.field}>
                      {detail.field}: {detail.value}
                    </Typography.Text>
                  ))
                ) : (
                  <Typography.Text>{t("auditLogs.noDetails")}</Typography.Text>
                )}
              </Space>
            ),
          }}
        />
      )}
      <Flex gap="middle">
        <Button
          disabled={page === 0 || query.isFetching}
          onClick={() => setPage(page - 1)}
        >
          {t("common.previous")}
        </Button>
        <Button
          disabled={
            !query.data?.next_pagination_key ||
            query.isFetching ||
            query.isError
          }
          onClick={() => {
            setKeys([
              ...keys.slice(0, page + 1),
              query.data?.next_pagination_key,
            ]);
            setPage(page + 1);
          }}
        >
          {t("common.next")}
        </Button>
      </Flex>
    </Space>
  );
}
