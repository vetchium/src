import { Alert, Button, Skeleton, Space, Tabs, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { AICreditsPanel } from "../features/ai/AICreditsPanel";
import { AISettingsPanel } from "../features/ai/AISettingsPanel";
import { AIUsagePanel } from "../features/ai/AIUsagePanel";
import {
  isAIUnavailable,
  useAICreditsQuery,
  useAISettingsQuery,
} from "../features/ai/queries";

export function AIPage() {
  const { t } = useTranslation();
  const settings = useAISettingsQuery();
  const credits = useAICreditsQuery();

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
        <Space orientation="vertical">
          <APIErrorAlert error={settings.error ?? credits.error} />
          <Button
            onClick={() => {
              void settings.refetch();
              void credits.refetch();
            }}
          >
            {t("common.retry")}
          </Button>
        </Space>
      );
    }
    return (
      <Tabs
        items={[
          {
            key: "settings",
            label: t("ai.tabs.settings"),
            children: <AISettingsPanel settings={settings.data} />,
          },
          {
            key: "credits",
            label: t("ai.tabs.credits"),
            children: <AICreditsPanel credits={credits.data} />,
          },
          {
            key: "usage",
            label: t("ai.tabs.usage"),
            children: <AIUsagePanel />,
          },
        ]}
      />
    );
  })();

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("ai.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("ai.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("ai.description")}
        </Typography.Text>
      </div>
      {body}
    </Space>
  );
}
