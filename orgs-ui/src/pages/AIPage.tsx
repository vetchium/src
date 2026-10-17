import { Alert, Button, Flex, Skeleton, Tabs, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { OpeningDraft } from "typespec/orgs/ai/types";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { AICreditsPanel } from "../features/ai/AICreditsPanel";
import { AISettingsPanel } from "../features/ai/AISettingsPanel";
import { AIUsagePanel } from "../features/ai/AIUsagePanel";
import { CreditSummary } from "../features/ai/CreditSummary";
import { typicalDraftCredits } from "../features/ai/estimate";
import {
  isAIUnavailable,
  useAICreditsQuery,
  useAISettingsQuery,
} from "../features/ai/queries";

const tabKeys = ["usage", "credits", "settings"] as const;
type TabKey = (typeof tabKeys)[number];

function isTabKey(value: string | null): value is TabKey {
  return tabKeys.some((key) => key === value);
}

export function AIPage() {
  const { t } = useTranslation();
  const settings = useAISettingsQuery();
  const credits = useAICreditsQuery();
  const [search, setSearch] = useSearchParams();
  const requested = search.get("tab");
  const tab: TabKey = isTabKey(requested) ? requested : "usage";
  const open = (key: TabKey) =>
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("tab", key);
        return next;
      },
      { replace: true },
    );

  const heading = (
    <div>
      <Flex gap="middle" align="center" wrap>
        <Typography.Title level={1}>{t("ai.title")}</Typography.Title>
        {settings.data === undefined ? null : (
          <Tag
            color={settings.data.settings.enabled ? "success" : "default"}
            data-testid="ai-status"
          >
            {t(settings.data.settings.enabled ? "ai.statusOn" : "ai.statusOff")}
          </Tag>
        )}
      </Flex>
      <Typography.Text type="secondary">{t("ai.description")}</Typography.Text>
    </div>
  );

  const body = (() => {
    if (settings.isPending || credits.isPending) {
      return (
        <div role="status" aria-label={t("ai.loading")}>
          <Skeleton active />
        </div>
      );
    }
    if (isAIUnavailable(settings.error)) {
      return <Alert type="info" showIcon title={t("ai.unavailable")} />;
    }
    if (settings.isError || credits.isError) {
      return (
        <Flex vertical gap="middle" align="start">
          <APIErrorAlert error={settings.error ?? credits.error} />
          <Button
            onClick={() => {
              void settings.refetch();
              void credits.refetch();
            }}
          >
            {t("common.retry")}
          </Button>
        </Flex>
      );
    }
    const draftPolicy = settings.data.settings.policies.find(
      (policy) => policy.operation === OpeningDraft,
    );
    const draftModelOID =
      draftPolicy === undefined
        ? settings.data.operation_defaults.find(
            (entry) => entry.operation === OpeningDraft,
          )?.default_model
        : draftPolicy.default_model;
    const draftModel = settings.data.models.find(
      (model) => model.model_oid === draftModelOID,
    );
    return (
      <Flex vertical gap="large">
        {settings.data.settings.enabled ? null : (
          <Alert
            type="info"
            showIcon
            title={t("ai.offNotice")}
            action={
              tab === "settings" ? undefined : (
                <Button size="small" onClick={() => open("settings")}>
                  {t("ai.openSettings")}
                </Button>
              )
            }
          />
        )}
        <CreditSummary credits={credits.data} onBuy={() => open("credits")} />
        <Tabs
          activeKey={tab}
          onChange={(key) => {
            if (isTabKey(key)) open(key);
          }}
          items={[
            {
              key: "usage",
              label: t("ai.tabs.usage"),
              children: <AIUsagePanel models={settings.data.models} />,
            },
            {
              key: "credits",
              label: t("ai.tabs.credits"),
              children: (
                <AICreditsPanel
                  credits={credits.data}
                  {...(draftModel === undefined
                    ? {}
                    : {
                        typicalDraft: {
                          credits: typicalDraftCredits(draftModel),
                          model: draftModel.display_name,
                        },
                      })}
                />
              ),
            },
            {
              key: "settings",
              label: t("ai.tabs.settings"),
              children: <AISettingsPanel settings={settings.data} />,
            },
          ]}
        />
      </Flex>
    );
  })();

  return (
    <Flex vertical gap="large" className="full-width">
      <title>{t("ai.documentTitle")}</title>
      {heading}
      {body}
    </Flex>
  );
}
