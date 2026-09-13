import { Button, Flex, Skeleton, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { usePreferences } from "../app/PreferencesContext";
import { configuredPlans, configuredTenantID } from "../app/runtime-config";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { CurrentSubscriptionCard } from "../features/subscriptions/CurrentSubscriptionCard";
import { PlanOptions } from "../features/subscriptions/PlanOptions";
import { useMySubscriptionQuery } from "../features/subscriptions/queries";

export function PlanPage() {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const subscription = useMySubscriptionQuery();
  const tenantID = configuredTenantID() ?? "";

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("plans.documentTitle")}</title>
      <Flex vertical align="center" gap="small" style={{ textAlign: "center" }}>
        <Typography.Title level={1}>{t("plans.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("plans.description")}
        </Typography.Text>
      </Flex>
      {subscription.isPending ? (
        <div role="status" aria-label={t("plans.loadingLabel")}>
          <Skeleton active />
        </div>
      ) : subscription.isError ? (
        <Space orientation="vertical">
          <APIErrorAlert error={subscription.error} />
          <Button onClick={() => void subscription.refetch()}>
            {t("common.retry")}
          </Button>
        </Space>
      ) : (
        <>
          <PlanOptions
            subscription={subscription.data}
            tenantID={tenantID}
            configuredPlans={configuredPlans()}
            locale={preferences.language}
          />
          <CurrentSubscriptionCard
            subscription={subscription.data}
            locale={preferences.language}
          />
        </>
      )}
    </Space>
  );
}
