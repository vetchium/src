import {
  HeartOutlined,
  IdcardOutlined,
  SafetyOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Card, Col, Input, Row, Space, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { FreeTier } from "typespec/hub/subscriptions/plans";
import { useMyApplicationCountsQuery } from "../features/applications/queries";
import { ProfileProgressCard } from "../features/profile/ProfileProgressCard";
import { useMyInfoQuery } from "../features/profile/queries";
import { useMySubscriptionQuery } from "../features/subscriptions/queries";

/** Starts an Opening search; the search page applies every other filter. */
function OpeningSearchCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [invalid, setInvalid] = useState(false);
  return (
    <Card
      title={
        <Space>
          <SearchOutlined />
          {t("home.searchTitle")}
        </Space>
      }
    >
      <Space orientation="vertical" className="full-width">
        <Input.Search
          aria-label={t("home.searchLabel")}
          placeholder={t("openingSearch.keywordPlaceholder")}
          enterButton={t("openingSearch.search")}
          status={invalid ? "error" : undefined}
          onChange={() => setInvalid(false)}
          onSearch={(value) => {
            const keyword = value.trim();
            const size = [...keyword].length;
            if (size === 1 || size > 200) {
              setInvalid(true);
              return;
            }
            navigate(
              size === 0
                ? "/openings"
                : `/openings?${new URLSearchParams({ q: keyword })}`,
            );
          }}
        />
        {invalid && (
          <Typography.Text type="danger">
            {t("openingSearch.keywordLength")}
          </Typography.Text>
        )}
      </Space>
    </Card>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  const { data: me } = useMyInfoQuery();
  const subscription = useMySubscriptionQuery();
  const applicationCounts = useMyApplicationCountsQuery();
  const answerNeeded = applicationCounts.data?.awaiting_answer ?? 0;
  if (me === undefined) return null;
  // A failed subscription read must not invite a paying user to pay again.
  const showSupport =
    subscription.isSuccess && subscription.data.plan_oid === FreeTier;
  const showSecurity = !me.totp_enabled;
  const showApplications = answerNeeded > 0;
  const hasAside = showSupport || showSecurity || showApplications;

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("home.documentTitle")}</title>
      <Typography.Title level={1}>
        {t("home.title", { name: me.display_name })}
      </Typography.Title>
      <OpeningSearchCard />
      <Row gutter={[24, 24]} align="stretch">
        <Col xs={24} lg={hasAside ? 14 : 24}>
          <ProfileProgressCard handle={me.handle} />
        </Col>
        {hasAside ? (
          <Col xs={24} lg={10}>
            <Space orientation="vertical" size="large" className="full-width">
              {showApplications ? (
                <Card
                  title={
                    <Space>
                      <IdcardOutlined />
                      {t("home.applicationsTitle")}
                    </Space>
                  }
                >
                  <Typography.Paragraph>
                    {t("home.applicationsBody", { count: answerNeeded })}
                  </Typography.Paragraph>
                  <Link to="/applications?awaiting=1">
                    {t("home.applicationsAction")}
                  </Link>
                </Card>
              ) : null}
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
