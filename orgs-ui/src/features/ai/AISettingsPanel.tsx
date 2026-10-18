import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  type IdempotencyKeyHolder,
  useIdempotencyKey,
} from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Flex,
  Modal,
  Radio,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TFunction } from "i18next";
import { useCallback, useState } from "react";
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
import { useUnsavedChangesGuard } from "../../components/common/useUnsavedChangesGuard";
import { resendablePolicies } from "./policies";
import { useSetAISettings } from "./queries";

type SaveSettings = ReturnType<typeof useSetAISettings>;

/** Saves the settings and returns a message for the user when it fails. */
async function submitSettings(
  t: TFunction,
  save: SaveSettings,
  key: IdempotencyKeyHolder,
  request: SetAISettingsRequest,
): Promise<string | undefined> {
  try {
    await save.mutateAsync({ request, key: key.current() });
    key.rotate();
    return undefined;
  } catch (cause) {
    if (isDefiniteRefusal(cause)) key.rotate();
    const problem = cause instanceof APIError ? cause.problem : undefined;
    if (problem?.type === AITermsRequiredErrorType) {
      return t("ai.settings.errors.termsRequired");
    }
    if (isAIModelNotOfferedProblem(problem)) {
      return t("ai.settings.errors.modelNotOffered", {
        models: problem.model_oids.join(", "),
      });
    }
    return problemMessage(t, cause);
  }
}

function AIAssistanceCard({ settings }: { settings: AISettingsResponse }) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const { dateTime } = useDateTimeFormat();
  const save = useSetAISettings();
  const key = useIdempotencyKey();
  const [termsOpen, setTermsOpen] = useState(false);
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string>();
  const enabled = settings.settings.enabled;
  const termsCurrent =
    settings.settings.accepted_terms_version === settings.current_terms_version;

  const apply = async (next: boolean, acceptTerms: boolean) => {
    setError(undefined);
    const failure = await submitSettings(t, save, key, {
      enabled: next,
      policies: resendablePolicies(settings),
      ...(acceptTerms
        ? { accept_terms_version: settings.current_terms_version }
        : {}),
    });
    if (failure !== undefined) {
      setError(failure);
      return false;
    }
    void message.success(
      t(next ? "ai.settings.turnedOn" : "ai.settings.turnedOff"),
    );
    return true;
  };

  const change = (next: boolean) => {
    if (next && termsCurrent) {
      void apply(true, false);
    } else if (next) {
      setAccept(false);
      setTermsOpen(true);
    } else {
      modal.confirm({
        title: t("ai.settings.turnOffTitle"),
        content: t("ai.settings.turnOffContent"),
        okText: t("ai.settings.turnOff"),
        okButtonProps: { danger: true },
        cancelText: t("common.cancel"),
        onOk: () => apply(false, false),
      });
    }
  };

  return (
    <Card title={t("ai.settings.title")}>
      <Flex vertical gap="middle">
        <Flex gap="middle" align="center">
          <Switch
            checked={enabled}
            loading={save.isPending}
            onChange={change}
            aria-label={t("ai.settings.enabled")}
          />
          <Flex vertical>
            <Typography.Text strong>
              {t(enabled ? "ai.settings.on" : "ai.settings.off")}
            </Typography.Text>
            <Typography.Text type="secondary">
              {t(enabled ? "ai.settings.onHelp" : "ai.settings.offHelp")}
            </Typography.Text>
          </Flex>
        </Flex>
        {termsCurrent && settings.settings.accepted_terms_at ? (
          <Typography.Text type="secondary">
            {t("ai.settings.termsAccepted", {
              version: settings.settings.accepted_terms_version,
              date: dateTime(settings.settings.accepted_terms_at),
            })}
          </Typography.Text>
        ) : null}
        {error === undefined ? null : (
          <Alert type="error" showIcon title={error} />
        )}
      </Flex>
      <Modal
        open={termsOpen}
        title={t("ai.terms.title")}
        okText={t("ai.terms.acceptAndTurnOn")}
        cancelText={t("common.cancel")}
        okButtonProps={{ disabled: !accept }}
        confirmLoading={save.isPending}
        onOk={async () => {
          if (await apply(true, true)) setTermsOpen(false);
        }}
        onCancel={() => setTermsOpen(false)}
      >
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
            {t("ai.terms.accept", { version: settings.current_terms_version })}
          </Checkbox>
          {error === undefined ? null : (
            <Alert type="error" showIcon title={error} />
          )}
        </Flex>
      </Modal>
    </Card>
  );
}

type Mode = "all" | "selected" | "off";

interface PolicyDraft {
  mode: Mode;
  /** Kept while another mode is chosen, so switching back restores it. */
  allowed: string[];
  preselected?: string;
}

function storedDraft(
  settings: AISettingsResponse,
  operation: AIOperation,
): PolicyDraft {
  const offered = settings.models.map((model) => model.model_oid);
  const regionDefault = settings.operation_defaults.find(
    (entry) => entry.operation === operation,
  )?.default_model;
  const everything: PolicyDraft = {
    mode: "all",
    allowed: offered,
    ...(regionDefault === undefined ? {} : { preselected: regionDefault }),
  };
  const policy = resendablePolicies(settings).find(
    (entry) => entry.operation === operation,
  );
  if (policy === undefined) return everything;
  if (policy.allowed_models.length === 0) return { ...everything, mode: "off" };
  return {
    mode: "selected",
    allowed: offered.filter((oid) => policy.allowed_models.includes(oid)),
    ...(policy.default_model === undefined
      ? {}
      : { preselected: policy.default_model }),
  };
}

function sameDraft(a: PolicyDraft, b: PolicyDraft): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode !== "selected") return true;
  return (
    a.preselected === b.preselected &&
    a.allowed.length === b.allowed.length &&
    a.allowed.every((oid, index) => b.allowed[index] === oid)
  );
}

function FeaturePolicyCard({
  settings,
  operation,
  onDirtyChange,
}: {
  settings: AISettingsResponse;
  operation: AIOperation;
  onDirtyChange: (operation: AIOperation, dirty: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const save = useSetAISettings();
  const key = useIdempotencyKey();
  const stored = storedDraft(settings, operation);
  const [draft, setDraft] = useState<PolicyDraft>(stored);
  const [error, setError] = useState<string>();
  const number = new Intl.NumberFormat(i18n.language);
  const feature = t(`ai.operations.${operation}`);
  const modelName = (oid: string | undefined) =>
    settings.models.find((model) => model.model_oid === oid)?.display_name ??
    oid;
  const dirty = !sameDraft(draft, stored);
  const invalid = draft.mode === "selected" && draft.allowed.length === 0;

  const edit = (next: PolicyDraft) => {
    setDraft(next);
    onDirtyChange(operation, !sameDraft(next, stored));
  };

  const toggle = (oid: string, allowed: boolean) => {
    const offered = settings.models.map((model) => model.model_oid);
    const next = offered.filter((candidate) =>
      candidate === oid ? allowed : draft.allowed.includes(candidate),
    );
    const preselected =
      draft.preselected !== undefined && next.includes(draft.preselected)
        ? draft.preselected
        : next[0];
    edit({
      mode: "selected",
      allowed: next,
      ...(preselected === undefined ? {} : { preselected }),
    });
  };

  const submit = async () => {
    setError(undefined);
    const others = resendablePolicies(settings).filter(
      (policy) => policy.operation !== operation,
    );
    const policy: AIOperationPolicy[] =
      draft.mode === "all"
        ? []
        : draft.mode === "off"
          ? [{ operation, allowed_models: [] }]
          : [
              {
                operation,
                allowed_models: draft.allowed,
                ...(draft.preselected === undefined
                  ? {}
                  : { default_model: draft.preselected }),
              },
            ];
    const failure = await submitSettings(t, save, key, {
      enabled: settings.settings.enabled,
      policies: [...others, ...policy],
    });
    if (failure === undefined) {
      onDirtyChange(operation, false);
      void message.success(t("ai.settings.saved", { feature }));
    } else {
      setError(failure);
    }
  };

  return (
    <Card
      size="small"
      title={feature}
      extra={
        dirty ? <Tag color="warning">{t("ai.settings.unsaved")}</Tag> : null
      }
    >
      <Flex vertical gap="middle">
        <Radio.Group
          aria-label={t("ai.settings.modelsFor", { feature })}
          value={draft.mode}
          onChange={(event) => edit({ ...draft, mode: event.target.value })}
        >
          <Flex vertical gap="small">
            <Radio value="all">
              <Flex vertical>
                <Typography.Text>{t("ai.settings.modeAll")}</Typography.Text>
                <Typography.Text type="secondary">
                  {t("ai.settings.modeAllHelp", {
                    model: modelName(stored.preselected ?? draft.preselected),
                  })}
                </Typography.Text>
              </Flex>
            </Radio>
            <Radio value="selected">
              <Flex vertical>
                <Typography.Text>
                  {t("ai.settings.modeSelected")}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {t("ai.settings.modeSelectedHelp")}
                </Typography.Text>
              </Flex>
            </Radio>
            <Radio value="off">
              <Flex vertical>
                <Typography.Text>{t("ai.settings.modeOff")}</Typography.Text>
                <Typography.Text type="secondary">
                  {t("ai.settings.modeOffHelp", { feature })}
                </Typography.Text>
              </Flex>
            </Radio>
          </Flex>
        </Radio.Group>
        {draft.mode === "selected" ? (
          <Table<AIModel>
            rowKey="model_oid"
            size="small"
            pagination={false}
            dataSource={settings.models}
            scroll={{ x: 560 }}
            columns={[
              {
                title: t("ai.settings.allow"),
                width: 80,
                render: (_, model) => (
                  <Checkbox
                    checked={draft.allowed.includes(model.model_oid)}
                    onChange={(event) =>
                      toggle(model.model_oid, event.target.checked)
                    }
                    aria-label={t("ai.settings.allowModel", {
                      model: model.display_name,
                    })}
                  />
                ),
              },
              { title: t("ai.models.name"), dataIndex: "display_name" },
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
                title: t("ai.settings.preselected"),
                width: 120,
                render: (_, model) => (
                  <Radio
                    checked={draft.preselected === model.model_oid}
                    disabled={!draft.allowed.includes(model.model_oid)}
                    onChange={() =>
                      edit({ ...draft, preselected: model.model_oid })
                    }
                    aria-label={t("ai.settings.preselectModel", {
                      model: model.display_name,
                    })}
                  />
                ),
              },
            ]}
          />
        ) : null}
        {invalid ? (
          <Alert type="error" showIcon title={t("ai.settings.chooseModel")} />
        ) : null}
        {error === undefined ? null : (
          <Alert type="error" showIcon title={error} />
        )}
        {dirty ? (
          <Flex gap="small">
            <Button
              type="primary"
              loading={save.isPending}
              disabled={invalid}
              onClick={() => void submit()}
            >
              {t("ai.settings.save", { feature })}
            </Button>
            <Button
              onClick={() => {
                setError(undefined);
                edit(stored);
              }}
            >
              {t("ai.settings.discard")}
            </Button>
          </Flex>
        ) : null}
      </Flex>
    </Card>
  );
}

export function AISettingsPanel({
  settings,
}: {
  settings: AISettingsResponse;
}) {
  const { t, i18n } = useTranslation();
  const { dateTime } = useDateTimeFormat();
  const [dirty, setDirty] = useState<ReadonlySet<AIOperation>>(new Set());
  useUnsavedChangesGuard(dirty.size > 0);
  const onDirtyChange = useCallback(
    (operation: AIOperation, changed: boolean) =>
      setDirty((current) => {
        if (current.has(operation) === changed) return current;
        const next = new Set(current);
        if (changed) next.add(operation);
        else next.delete(operation);
        return next;
      }),
    [],
  );
  const number = new Intl.NumberFormat(i18n.language);

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
      <AIAssistanceCard settings={settings} />
      <Card title={t("ai.settings.modelsTitle")}>
        <Flex vertical gap="middle">
          <Typography.Text type="secondary">
            {t("ai.settings.modelsHelp")}
          </Typography.Text>
          {aiOperationValues.map((operation) => (
            <FeaturePolicyCard
              // A saved policy remounts its card, so the card starts from
              // what is stored while other cards keep their edits.
              key={`${operation}:${JSON.stringify(
                settings.settings.policies.find(
                  (policy) => policy.operation === operation,
                ) ?? null,
              )}`}
              settings={settings}
              operation={operation}
              onDirtyChange={onDirtyChange}
            />
          ))}
        </Flex>
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
              { title: t("ai.models.name"), dataIndex: "display_name" },
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
