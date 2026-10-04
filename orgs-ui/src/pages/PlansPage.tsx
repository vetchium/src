import { Button, Flex, Skeleton, Space, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OrgSuspended } from "typespec/orgs/account/account";
import { usePreferences } from "../app/preferences";
import { orgRegionSettings } from "../app/regions";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { useMyInfoQuery } from "../features/account/queries";
import { CurrentSubscriptionCard } from "../features/subscriptions/CurrentSubscriptionCard";
import { PlanOptions } from "../features/subscriptions/PlanOptions";
import { useMySubscriptionQuery } from "../features/subscriptions/queries";

export function PlansPage() {
  const { t } = useTranslation();
  const [changing, setChanging] = useState(false);
  const { language } = usePreferences();
  const subscription = useMySubscriptionQuery();
  const { data: me } = useMyInfoQuery();
  // The plans are those the session's own region offers.
  const tenantID = useAuth().session?.tenantId;
  if (tenantID === undefined || me === undefined) return null;

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("plans.documentTitle")}</title>
      <Flex orientation="vertical" align="center" gap="small">
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
      ) : !changing ? (
        <CurrentSubscriptionCard
          subscription={subscription.data}
          locked={me.org.org_state === OrgSuspended}
          onChange={() => setChanging(true)}
        />
      ) : (
        <PlanOptions
          subscription={subscription.data}
          tenantID={tenantID}
          configuredPlans={orgRegionSettings(tenantID).orgPlans}
          locale={language}
          changesLocked={me.org.org_state === OrgSuspended}
          onDone={() => setChanging(false)}
        />
      )}
    </Space>
  );
}
