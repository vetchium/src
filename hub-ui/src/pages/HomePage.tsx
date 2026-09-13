import { Card, Flex, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { FreeTier } from "typespec/hub/subscriptions/plans";
import { useMySubscriptionQuery } from "../features/subscriptions/queries";

export function HomePage() {
  const { t } = useTranslation();
  const subscription = useMySubscriptionQuery();
  const showPaidPlanInvitation =
    subscription.isSuccess && subscription.data.plan_oid === FreeTier;

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("home.documentTitle")}</title>
      <Typography.Title level={1}>{t("home.title")}</Typography.Title>
      <Flex gap="middle" wrap>
        <Card title={t("home.planInvitationTitle")}>
          <Typography.Paragraph>
            {t("home.planInvitationBody")}
          </Typography.Paragraph>
          <Link to="/plan">{t("home.planInvitationAction")}</Link>
          {showPaidPlanInvitation ? (
            <Typography.Paragraph type="secondary">
              {t("home.considerPaidPlan")}
            </Typography.Paragraph>
          ) : null}
        </Card>
        <Card title={t("home.profileInvitationTitle")}>
          <Typography.Paragraph>
            {t("home.profileInvitationBody")}
          </Typography.Paragraph>
          <Link to="/settings/profile">
            {t("home.profileInvitationAction")}
          </Link>
        </Card>
      </Flex>
    </Space>
  );
}
