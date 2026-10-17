import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Flex,
  Form,
  Select,
  Space,
  Switch,
  Table,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AISettingsResponse,
  SetAISettingsRequest,
} from "typespec/orgs/ai/ai";
import {
  type AIModel,
  type AIOperation,
  type AIOperationPolicy,
  aiOperationValues,
} from "typespec/orgs/ai/types";
import {
  AITermsRequiredErrorType,
  isAIModelNotOfferedProblem,
} from "typespec/problem/orgs/ai";
import { APIError, isDefiniteRefusal } from "../../api/client";
import { problemMessage } from "../../components/common/APIErrorAlert";
import { useSetAISettings } from "./queries";

interface OperationChoice {
  allowAll: boolean;
  allowed: string[];
  defaultModel?: string;
}

type Choices = Record<AIOperation, OperationChoice>;

function initialChoices(settings: AISettingsResponse): Choices {
  const choices = {} as Choices;
  for (const operation of aiOperationValues) {
    const policy = settings.settings.policies.find(
      (entry) => entry.operation === operation,
    );
    const regionDefault = settings.operation_defaults.find(
      (entry) => entry.operation === operation,
    )?.default_model;
    choices[operation] =
      policy === undefined
        ? {
            allowAll: true,
            allowed: settings.models.map((model) => model.model_oid),
            ...(regionDefault === undefined
              ? {}
              : { defaultModel: regionDefault }),
          }
        : {
            allowAll: false,
            allowed: [...policy.allowed_models],
            defaultModel: policy.default_model,
          };
  }
  return choices;
}

function policies(choices: Choices): AIOperationPolicy[] {
  return aiOperationValues
    .filter((operation) => !choices[operation].allowAll)
    .map((operation) => ({
      operation,
      allowed_models: choices[operation].allowed,
      default_model: choices[operation].defaultModel ?? "",
    }));
}

export function AISettingsPanel({
  settings,
}: {
  settings: AISettingsResponse;
}) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const { dateTime } = useDateTimeFormat();
  const save = useSetAISettings();
  const key = useIdempotencyKey();
  const [enabled, setEnabled] = useState(settings.settings.enabled);
  const [accept, setAccept] = useState(false);
  const [choices, setChoices] = useState<Choices>(() =>
    initialChoices(settings),
  );
  const [error, setError] = useState<string>();
  useEffect(() => {
    setEnabled(settings.settings.enabled);
    setChoices(initialChoices(settings));
    setAccept(false);
  }, [settings]);

  const number = new Intl.NumberFormat(i18n.language);
  const termsCurrent =
    settings.settings.accepted_terms_version === settings.current_terms_version;
  const needsTerms = enabled && !termsCurrent;
  const modelName = (oid: string) =>
    settings.models.find((model) => model.model_oid === oid)?.display_name ??
    oid;
  const invalidChoice = aiOperationValues.some((operation) => {
    const choice = choices[operation];
    return (
      !choice.allowAll &&
      (choice.allowed.length === 0 ||
        choice.defaultModel === undefined ||
        !choice.allowed.includes(choice.defaultModel))
    );
  });

  const submit = async () => {
    setError(undefined);
    const request: SetAISettingsRequest = {
      enabled,
      policies: policies(choices),
      ...(needsTerms && accept
        ? { accept_terms_version: settings.current_terms_version }
        : {}),
    };
    try {
      await save.mutateAsync({ request, key: key.current() });
      key.rotate();
      void message.success(t("ai.settings.saved"));
    } catch (cause) {
      if (isDefiniteRefusal(cause)) key.rotate();
      const problem = cause instanceof APIError ? cause.problem : undefined;
      if (problem?.type === AITermsRequiredErrorType) {
        setError(t("ai.settings.errors.termsRequired"));
      } else if (isAIModelNotOfferedProblem(problem)) {
        setError(
          t("ai.settings.errors.modelNotOffered", {
            models: problem.model_oids.join(", "),
          }),
        );
      } else {
        setError(problemMessage(t, cause));
      }
    }
  };

  const update = (operation: AIOperation, change: Partial<OperationChoice>) =>
    setChoices((current) => ({
      ...current,
      [operation]: { ...current[operation], ...change },
    }));

  return (
    <Flex vertical gap="large">
      {!settings.plan_allows_ai ? (
        <Alert type="info" showIcon title={t("ai.settings.planNotice")} />
      ) : null}
      {settings.unavailable_models.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={t("ai.settings.unavailableModels", {
            models: settings.unavailable_models.join(", "),
          })}
        />
      ) : null}
      <Card title={t("ai.settings.title")}>
        <Form layout="vertical" onFinish={() => void submit()}>
          <Flex vertical gap="middle">
            <Form.Item label={t("ai.settings.enabled")}>
              <Space>
                <Switch
                  checked={enabled}
                  onChange={setEnabled}
                  aria-label={t("ai.settings.enabled")}
                />
                <Typography.Text type="secondary">
                  {t(enabled ? "ai.settings.on" : "ai.settings.off")}
                </Typography.Text>
              </Space>
            </Form.Item>
            {termsCurrent && settings.settings.accepted_terms_at ? (
              <Typography.Paragraph type="secondary">
                {t("ai.settings.termsAccepted", {
                  version: settings.settings.accepted_terms_version,
                  date: dateTime(settings.settings.accepted_terms_at),
                })}
              </Typography.Paragraph>
            ) : null}
            {needsTerms ? (
              <Card size="small" title={t("ai.terms.title")}>
                <Flex vertical gap="small">
                  {(["p1", "p2", "p3", "p4"] as const).map((paragraph) => (
                    <Typography.Paragraph key={paragraph}>
                      {t(`ai.terms.${paragraph}`)}
                    </Typography.Paragraph>
                  ))}
                  <Checkbox
                    checked={accept}
                    onChange={(event) => setAccept(event.target.checked)}
                  >
                    {t("ai.terms.accept", {
                      version: settings.current_terms_version,
                    })}
                  </Checkbox>
                </Flex>
              </Card>
            ) : null}
            <Typography.Title level={4}>
              {t("ai.settings.modelsTitle")}
            </Typography.Title>
            {aiOperationValues.map((operation) => {
              const choice = choices[operation];
              return (
                <Card
                  key={operation}
                  size="small"
                  title={t(`ai.operations.${operation}`)}
                >
                  <Flex vertical gap="middle">
                    <Checkbox
                      checked={choice.allowAll}
                      onChange={(event) =>
                        update(operation, { allowAll: event.target.checked })
                      }
                    >
                      {t("ai.settings.allowAll")}
                    </Checkbox>
                    {!choice.allowAll ? (
                      <Flex vertical gap="small">
                        <Form.Item label={t("ai.settings.allowedModels")}>
                          <Select
                            mode="multiple"
                            aria-label={t("ai.settings.allowedModels")}
                            value={choice.allowed}
                            onChange={(allowed: string[]) =>
                              update(operation, {
                                allowed,
                                ...(choice.defaultModel !== undefined &&
                                !allowed.includes(choice.defaultModel)
                                  ? { defaultModel: allowed[0] }
                                  : {}),
                              })
                            }
                            options={settings.models.map((model) => ({
                              value: model.model_oid,
                              label: model.display_name,
                            }))}
                          />
                        </Form.Item>
                        <Form.Item label={t("ai.settings.defaultModel")}>
                          <Select
                            aria-label={t("ai.settings.defaultModel")}
                            value={choice.defaultModel}
                            onChange={(defaultModel: string) =>
                              update(operation, { defaultModel })
                            }
                            options={choice.allowed.map((oid) => ({
                              value: oid,
                              label: modelName(oid),
                            }))}
                          />
                        </Form.Item>
                      </Flex>
                    ) : null}
                  </Flex>
                </Card>
              );
            })}
            {error !== undefined ? (
              <Alert type="error" showIcon title={error} />
            ) : null}
            <Button
              type="primary"
              htmlType="submit"
              loading={save.isPending}
              disabled={(needsTerms && !accept) || invalidChoice}
            >
              {t("common.save")}
            </Button>
          </Flex>
        </Form>
      </Card>
      <Card title={t("ai.models.title")}>
        <Flex vertical gap="middle">
          <Typography.Text type="secondary">
            {t("ai.models.tokensHelp")}
          </Typography.Text>
          <Table<AIModel>
            rowKey="model_oid"
            pagination={false}
            dataSource={settings.models}
            scroll={{ x: 640 }}
            columns={[
              {
                title: t("ai.models.name"),
                dataIndex: "display_name",
              },
              { title: t("ai.models.vendor"), dataIndex: "vendor" },
              { title: t("ai.models.licence"), dataIndex: "licence" },
              {
                title: t("ai.models.rates"),
                children: [
                  {
                    title: t("ai.models.inputRate"),
                    align: "end",
                    render: (_, model) =>
                      number.format(model.input_credits_per_million_tokens),
                  },
                  {
                    title: t("ai.models.outputRate"),
                    align: "end",
                    render: (_, model) =>
                      number.format(model.output_credits_per_million_tokens),
                  },
                ],
              },
              {
                title: t("ai.models.status"),
                render: (_, model) =>
                  model.withdraws_at === undefined
                    ? t("ai.models.offered")
                    : t("ai.models.withdraws", {
                        date: dateTime(model.withdraws_at),
                      }),
              },
            ]}
          />
        </Flex>
      </Card>
    </Flex>
  );
}
