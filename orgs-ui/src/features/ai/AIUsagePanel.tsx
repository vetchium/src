import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { Alert, Button, Card, Flex, Modal, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PaginationKey } from "typespec/common/pagination";
import type { AIUsage, AIUsageID } from "typespec/orgs/ai/types";
import { AIUsageNotFoundError } from "typespec/problem/orgs/ai";
import { APIError } from "../../api/client";
import { useAIUsageQuery, useAIUsageTextQuery } from "./queries";

const pageSize = 25;

function UsageText({
  usageID,
  onClose,
}: {
  usageID: AIUsageID | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const text = useAIUsageTextQuery(usageID);
  const notReadable =
    text.error instanceof APIError &&
    text.error.problem?.type === AIUsageNotFoundError.type;
  return (
    <Modal
      open={usageID !== undefined}
      onCancel={onClose}
      footer={<Button onClick={onClose}>{t("common.done")}</Button>}
      title={t("ai.usage.textTitle")}
      width={720}
    >
      {text.isPending ? (
        <Typography.Text type="secondary">
          {t("common.loading")}
        </Typography.Text>
      ) : notReadable ? (
        <Alert type="info" showIcon title={t("ai.usage.textUnreadable")} />
      ) : text.isError ? (
        <Alert type="error" showIcon title={t("common.loadError")} />
      ) : (
        <Flex vertical gap="middle">
          <Typography.Text type="secondary">
            {t("ai.usage.textExpires", {
              date: dateTime(text.data.expires_at),
            })}
          </Typography.Text>
          {text.data.request_messages.map((message, index) => (
            <Card
              // biome-ignore lint/suspicious/noArrayIndexKey: messages are an ordered, fixed list
              key={index}
              size="small"
              title={t(`ai.usage.roles.${message.role}`)}
            >
              <Typography.Paragraph className="ai-usage-text">
                {message.content}
              </Typography.Paragraph>
            </Card>
          ))}
          <Card size="small" title={t("ai.usage.answer")}>
            <Typography.Paragraph className="ai-usage-text">
              {text.data.response_text ?? t("ai.usage.noAnswer")}
            </Typography.Paragraph>
          </Card>
        </Flex>
      )}
    </Modal>
  );
}

export function AIUsagePanel() {
  const { t, i18n } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const [pageKeys, setPageKeys] = useState<Array<PaginationKey | undefined>>([
    undefined,
  ]);
  const [pageIndex, setPageIndex] = useState(0);
  const [viewing, setViewing] = useState<AIUsageID>();
  const usage = useAIUsageQuery(pageSize, pageKeys[pageIndex]);
  const number = new Intl.NumberFormat(i18n.language);

  const next = () => {
    const nextKey = usage.data?.next_pagination_key;
    if (nextKey === undefined) return;
    setPageKeys((keys) => [...keys.slice(0, pageIndex + 1), nextKey]);
    setPageIndex((index) => index + 1);
  };

  return (
    <Card title={t("ai.usage.title")}>
      <Flex vertical gap="middle">
        <Typography.Text type="secondary">{t("ai.usage.help")}</Typography.Text>
        {usage.isError ? (
          <Alert type="error" showIcon title={t("common.loadError")} />
        ) : null}
        <Table<AIUsage>
          rowKey="usage_id"
          dataSource={usage.data?.entries ?? []}
          loading={usage.isPending || usage.isFetching}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{ emptyText: t("ai.usage.empty") }}
          columns={[
            {
              title: t("ai.usage.when"),
              render: (_, entry) => dateTime(entry.created_at),
            },
            {
              title: t("ai.usage.operation"),
              render: (_, entry) =>
                t(`ai.operations.${entry.operation}`, {
                  defaultValue: entry.operation,
                }),
            },
            { title: t("ai.usage.model"), dataIndex: "model_oid" },
            { title: t("ai.usage.user"), dataIndex: "actor_email" },
            {
              title: t("ai.usage.outcome"),
              render: (_, entry) => (
                <Tag color={entry.state === "settled" ? "green" : "default"}>
                  {entry.failure_reason === undefined
                    ? t(`ai.usage.states.${entry.state}`, {
                        defaultValue: entry.state,
                      })
                    : t(`ai.usage.failures.${entry.failure_reason}`, {
                        defaultValue: entry.failure_reason,
                      })}
                </Tag>
              ),
            },
            {
              title: t("ai.usage.tokens"),
              render: (_, entry) =>
                entry.input_tokens === undefined ||
                entry.output_tokens === undefined
                  ? "—"
                  : t("ai.usage.tokenValue", {
                      input: number.format(entry.input_tokens),
                      output: number.format(entry.output_tokens),
                    }),
            },
            {
              title: t("ai.usage.credits"),
              render: (_, entry) => number.format(entry.credits_charged),
            },
            {
              title: t("ai.usage.text"),
              render: (_, entry) =>
                entry.text_available ? (
                  <Button
                    size="small"
                    onClick={() => setViewing(entry.usage_id)}
                    aria-label={t("ai.usage.viewFor", {
                      time: dateTime(entry.created_at),
                    })}
                  >
                    {t("ai.usage.view")}
                  </Button>
                ) : (
                  <Typography.Text type="secondary">
                    {t("ai.usage.deleted")}
                  </Typography.Text>
                ),
            },
          ]}
        />
        <Flex justify="space-between" align="center">
          <Button
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((index) => index - 1)}
          >
            {t("common.previous")}
          </Button>
          <Button
            disabled={usage.data?.next_pagination_key === undefined}
            onClick={next}
          >
            {t("common.next")}
          </Button>
        </Flex>
      </Flex>
      <UsageText usageID={viewing} onClose={() => setViewing(undefined)} />
    </Card>
  );
}
