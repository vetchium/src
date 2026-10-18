import { Alert, Button, Flex, Skeleton, Tabs, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { AICreditsPanel } from "../features/ai/AICreditsPanel";
import { AISettingsPanel } from "../features/ai/AISettingsPanel";
import { AIUpgradeCard, SeePlansButton } from "../features/ai/AIUpgrade";
import { AIUsagePanel, usagePageSize } from "../features/ai/AIUsagePanel";
import { CreditSummary } from "../features/ai/CreditSummary";
import {
  isAIUnavailable,
  useAICreditsQuery,
  useAISettingsQuery,
  useAIUsageQuery,
} from "../features/ai/queries";

const tabKeys = ["usage", "credits", "settings"] as const;
type TabKey = (typeof tabKeys)[number];

function isTabKey(value: string | null): value is TabKey {
  return tabKeys.some((key) => key === value);
}

export function AIPage() {
  const { t, i18n } = useTranslation();
  const settings = useAISettingsQuery();
  const credits = useAICreditsQuery();
  const number = new Intl.NumberFormat(i18n.language);
  const entitled =
    settings.data === undefined || credits.data === undefined
      ? undefined
      : settings.data.plan_allows_ai ||
        credits.data.balance.purchased_remaining > 0;
  // The usage list's first page, read only to know whether an Org without AI
  // has history worth showing.
  const usage = useAIUsageQuery(usagePageSize, undefined, entitled === false);
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
        {settings.data === undefined || entitled === undefined ? null : (
          <Tag
            color={
              entitled && settings.data.settings.enabled ? "success" : "default"
            }
            data-testid="ai-status"
          >
            {t(
              !entitled
                ? "ai.statusNotInPlan"
                : settings.data.settings.enabled
                  ? "ai.statusOn"
                  : "ai.statusOff",
            )}
          </Tag>
        )}
      </Flex>
      <Typography.Text type="secondary">
        {t(entitled === false ? "ai.descriptionNotInPlan" : "ai.description")}
      </Typography.Text>
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
    if (entitled === false) {
      return (
        <Flex vertical gap="large">
          <AIUpgradeCard />
          {usage.data !== undefined && usage.data.entries.length > 0 ? (
            <AIUsagePanel models={settings.data.models} />
          ) : null}
        </Flex>
      );
    }
    return (
      <Flex vertical gap="large">
        {settings.data.plan_allows_ai ? null : (
          <Alert
            type="warning"
            showIcon
            data-testid="ai-purchased-only"
            title={t("ai.purchasedOnly", {
              credits: number.format(credits.data.balance.purchased_remaining),
            })}
            action={<SeePlansButton small />}
          />
        )}
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
              children: <AICreditsPanel credits={credits.data} />,
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
