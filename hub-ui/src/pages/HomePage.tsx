import { HeartOutlined, SafetyOutlined } from "@ant-design/icons";
import { Card, Col, Row, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { FreeTier } from "typespec/hub/subscriptions/plans";
import { ProfileProgressCard } from "../features/profile/ProfileProgressCard";
import { useMyInfoQuery } from "../features/profile/queries";
import { useMySubscriptionQuery } from "../features/subscriptions/queries";

export function HomePage() {
  const { t } = useTranslation();
  const { data: me } = useMyInfoQuery();
  const subscription = useMySubscriptionQuery();
  if (me === undefined) return null;
  // A failed subscription read must not invite a paying user to pay again.
  const showSupport =
    subscription.isSuccess && subscription.data.plan_oid === FreeTier;
  const showSecurity = !me.totp_enabled;
  const hasAside = showSupport || showSecurity;

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("home.documentTitle")}</title>
      <Typography.Title level={1}>
        {t("home.title", { name: me.display_name })}
      </Typography.Title>
      <Row gutter={[24, 24]} align="stretch">
        <Col xs={24} lg={hasAside ? 14 : 24}>
          <ProfileProgressCard handle={me.handle} />
        </Col>
        {hasAside ? (
          <Col xs={24} lg={10}>
            <Space orientation="vertical" size="large" className="full-width">
              {showSupport ? (
                <Card
                  title={
                    <Space>
                      <HeartOutlined />
                      {t("home.supportTitle")}
                    </Space>
                  }
                >
                  <Typography.Paragraph>
                    {t("home.supportBody")}
                  </Typography.Paragraph>
                  <Link to="/plan">{t("home.supportAction")}</Link>
                </Card>
              ) : null}
              {showSecurity ? (
                <Card
                  title={
                    <Space>
                      <SafetyOutlined />
                      {t("home.securityTitle")}
                    </Space>
                  }
                >
                  <Typography.Paragraph>
                    {t("home.securityBody")}
                  </Typography.Paragraph>
                  <Link to="/settings/security">
                    {t("home.securityAction")}
                  </Link>
                </Card>
              ) : null}
            </Space>
          </Col>
        ) : null}
      </Row>
    </Space>
  );
}
