import { useQuery } from "@tanstack/react-query";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
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
import { ViewAIUsage } from "typespec/admin/authorization/types";
import type { AIUsage } from "typespec/orgs/ai/types";
import { isOrgDomain, normalizeOrgDomain } from "typespec/orgs/types";
import { OrgNotFoundError } from "typespec/problem/admin/ai-usage";
import { getProblemType } from "../api/client";
import { getOrgAIUsageText, listOrgAIUsage } from "../features/ai-usage/api";
import { useMyInfoQuery } from "../features/profile/queries";

const pageSize = 25;

function UsageText({
  orgDomain,
  usageID,
  onClose,
}: {
  orgDomain: string;
  usageID: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const text = useQuery({
    queryKey: ["admin", "ai-usage-text", orgDomain, usageID],
    queryFn: () =>
      getOrgAIUsageText({ org_domain: orgDomain, usage_id: usageID ?? "" }),
    enabled: usageID !== undefined,
    retry: false,
    // Each read is audited; do not refetch behind the reader's back.
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <Modal
      open={usageID !== undefined}
      onCancel={onClose}
      footer={<Button onClick={onClose}>{t("common.close")}</Button>}
      title={t("aiUsage.textTitle")}
      width={720}
    >
      {text.isPending ? (
        <Spin />
      ) : text.isError ? (
        <Alert type="error" showIcon title={t("aiUsage.textUnavailable")} />
      ) : (
        <Flex vertical gap="middle">
          <Typography.Text type="secondary">
            {t("aiUsage.textExpires", { date: dateTime(text.data.expires_at) })}
          </Typography.Text>
          {text.data.request_messages.map((message, index) => (
            <Card
              // biome-ignore lint/suspicious/noArrayIndexKey: messages are an ordered, fixed list
              key={index}
              size="small"
              title={t(`aiUsage.roles.${message.role}`)}
            >
              <Typography.Paragraph className="ai-usage-text">
                {message.content}
              </Typography.Paragraph>
            </Card>
          ))}
          <Card size="small" title={t("aiUsage.answer")}>
            <Typography.Paragraph className="ai-usage-text">
              {text.data.response_text ?? t("aiUsage.noAnswer")}
            </Typography.Paragraph>
          </Card>
        </Flex>
      )}
    </Modal>
  );
}

export function AIUsagePage() {
  const { t, i18n } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const { data: me } = useMyInfoQuery();
  const allowed = me?.permissions.includes(ViewAIUsage) === true;
  const [domain, setDomain] = useState<string>();
  const [keys, setKeys] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const [viewing, setViewing] = useState<string>();
  const query = useQuery({
    queryKey: ["admin", "ai-usage", domain, keys[page]],
    queryFn: () =>
      listOrgAIUsage({
        org_domain: domain ?? "",
        limit: pageSize,
        ...(keys[page] === undefined ? {} : { pagination_key: keys[page] }),
      }),
    enabled: allowed && domain !== undefined,
    retry: false,
  });
  if (me === undefined) return <Spin size="large" />;
  if (!allowed) return <Navigate replace to="/" />;
  const number = new Intl.NumberFormat(i18n.language);

  const search = ({ org_domain }: { org_domain?: string }) => {
    const value = normalizeOrgDomain(org_domain ?? "");
    if (!isOrgDomain(value)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDomain(value);
    setKeys([undefined]);
    setPage(0);
  };
  const columns: ColumnsType<AIUsage> = [
    {
      title: t("aiUsage.when"),
      render: (_, entry) => dateTime(entry.created_at),
    },
    { title: t("aiUsage.operation"), dataIndex: "operation" },
    { title: t("aiUsage.model"), dataIndex: "model_oid" },
    { title: t("aiUsage.user"), dataIndex: "actor_email" },
    {
      title: t("aiUsage.outcome"),
      render: (_, entry) => (
        <Tag color={entry.state === "settled" ? "green" : "default"}>
          {entry.failure_reason ?? entry.state}
        </Tag>
      ),
    },
    {
      title: t("aiUsage.credits"),
      render: (_, entry) => number.format(entry.credits_charged),
    },
    {
      title: t("aiUsage.text"),
      render: (_, entry) =>
        entry.text_available ? (
          <Button size="small" onClick={() => setViewing(entry.usage_id)}>
            {t("aiUsage.view")}
          </Button>
        ) : (
          <Typography.Text type="secondary">
            {t("aiUsage.deleted")}
          </Typography.Text>
        ),
    },
  ];
  const notFound = getProblemType(query.error) === OrgNotFoundError.type;

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <Typography.Title level={1}>{t("aiUsage.title")}</Typography.Title>
      <Alert type="info" showIcon title={t("aiUsage.scope")} />
      <Card>
        <Form layout="vertical" onFinish={search}>
          <Flex gap="middle" wrap align="end">
            <Form.Item
              name="org_domain"
              label={t("aiUsage.orgDomain")}
              {...(invalid
                ? {
                    validateStatus: "error" as const,
                    help: t("aiUsage.invalidDomain"),
                  }
                : {})}
            >
              <Input autoComplete="off" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit">
                {t("common.search")}
              </Button>
            </Form.Item>
          </Flex>
        </Form>
      </Card>
      {domain === undefined ? (
        <Typography.Text type="secondary">
          {t("aiUsage.prompt")}
        </Typography.Text>
      ) : notFound ? (
        <Alert type="warning" showIcon title={t("aiUsage.orgNotFound")} />
      ) : query.isError ? (
        <Alert type="error" showIcon title={t("common.loadError")} />
      ) : (
        <Flex vertical gap="middle">
          <Table<AIUsage>
            rowKey="usage_id"
            columns={columns}
            dataSource={query.data?.entries ?? []}
            loading={query.isPending || query.isFetching}
            pagination={false}
            scroll={{ x: 900 }}
            locale={{ emptyText: t("aiUsage.empty") }}
          />
          <Flex justify="space-between">
            <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
              {t("common.previous")}
            </Button>
            <Button
              disabled={query.data?.next_pagination_key === undefined}
              onClick={() => {
                const next = query.data?.next_pagination_key;
                if (next === undefined) return;
                setKeys((current) => [...current.slice(0, page + 1), next]);
                setPage(page + 1);
              }}
            >
              {t("common.next")}
            </Button>
          </Flex>
        </Flex>
      )}
      {domain !== undefined ? (
        <UsageText
          orgDomain={domain}
          usageID={viewing}
          onClose={() => setViewing(undefined)}
        />
      ) : null}
    </Space>
  );
}
