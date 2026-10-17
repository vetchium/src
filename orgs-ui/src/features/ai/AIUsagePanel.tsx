import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Button,
  Card,
  Flex,
  Modal,
  Progress,
  Statistic,
  Table,
  Tag,
  Typography,
  theme,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PaginationKey } from "typespec/common/pagination";
import type {
  AICreditBalance,
  AIModel,
  AIUsage,
  AIUsageID,
} from "typespec/orgs/ai/types";
import { AIUsageNotFoundError } from "typespec/problem/orgs/ai";
import { APIError } from "../../api/client";
import { creditUse } from "./creditUse";
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

function CreditUseCard({ balance }: { balance: AICreditBalance }) {
  const { t, i18n } = useTranslation();
  const { token } = theme.useToken();
  const use = creditUse(balance);
  const number = new Intl.NumberFormat(i18n.language);
  if (use === undefined) {
    return (
      <Card title={t("ai.usage.creditsUsedTitle")}>
        <Typography.Text type="secondary">
          {t("ai.usage.noUsableCredits")}
        </Typography.Text>
      </Card>
    );
  }
  const color = {
    normal: token.colorPrimary,
    warning: token.colorWarning,
    exhausted: token.colorError,
  }[use.level];
  return (
    <Card title={t("ai.usage.creditsUsedTitle")}>
      <Flex gap="large" align="center" wrap>
        <Progress
          type="dashboard"
          percent={use.percent}
          size={140}
          strokeColor={color}
          format={(percent) => (
            <Typography.Text
              strong
              type={
                {
                  normal: undefined,
                  warning: "warning" as const,
                  exhausted: "danger" as const,
                }[use.level]
              }
            >
              {percent === 0 && use.used > 0
                ? t("ai.usage.underOnePercent")
                : t("ai.usage.percentUsed", { percent })}
            </Typography.Text>
          )}
          aria-label={t("ai.usage.creditsUsedLabel")}
          data-testid="ai-credits-used"
        />
        <Flex vertical gap="middle">
          <Flex gap="large" wrap>
            <Statistic
              title={t("ai.usage.creditsUsed")}
              value={number.format(use.used)}
            />
            <Statistic
              title={t("ai.usage.creditsLeft")}
              value={number.format(balance.available)}
            />
            <Statistic
              title={t("ai.usage.creditsTotal")}
              value={number.format(use.total)}
            />
          </Flex>
          {use.level === "normal" ? null : (
            <Alert
              type={use.level === "warning" ? "warning" : "error"}
              showIcon
              title={t(`ai.usage.${use.level}`, { percent: use.percent })}
            />
          )}
        </Flex>
      </Flex>
    </Card>
  );
}

export function AIUsagePanel({
  balance,
  models,
}: {
  balance: AICreditBalance;
  models: AIModel[];
}) {
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

  const modelName = (oid: string) =>
    models.find((model) => model.model_oid === oid)?.display_name ?? oid;
  const tokens = (count: number | undefined) =>
    count === undefined ? "—" : number.format(count);

  return (
    <Flex vertical gap="large">
      <CreditUseCard balance={balance} />
      <Card title={t("ai.usage.title")}>
        <Flex vertical gap="middle">
          <Typography.Text type="secondary">
            {t("ai.usage.help")}
          </Typography.Text>
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
              {
                title: t("ai.usage.model"),
                render: (_, entry) => modelName(entry.model_oid),
              },
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
                children: [
                  {
                    title: t("ai.usage.inputTokens"),
                    align: "end",
                    render: (_, entry) => tokens(entry.input_tokens),
                  },
                  {
                    title: t("ai.usage.outputTokens"),
                    align: "end",
                    render: (_, entry) => tokens(entry.output_tokens),
                  },
                ],
              },
              {
                title: t("ai.usage.credits"),
                align: "end",
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
    </Flex>
  );
}
