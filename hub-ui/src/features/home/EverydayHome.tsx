import { HeartOutlined, SafetyOutlined } from "@ant-design/icons";
import { Card, Col, Flex, Row, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { PublicProfile } from "typespec/hub/profile/public";
import { FreeTier } from "typespec/hub/subscriptions/plans";
import type { MyInfoResponse } from "typespec/hub/users/profile";
import { useMySubscriptionQuery } from "../subscriptions/queries";
import { IdealJobMatches } from "./IdealJobMatches";
import { OpeningSearchBox } from "./OpeningSearchBox";
import { ProfileStatusCard } from "./ProfileStatusCard";

/** Home once setup is over (PROF-JOB-006). */
export function EverydayHome({
  me,
  profile,
}: {
  me: MyInfoResponse;
  profile: PublicProfile;
}) {
  const { t } = useTranslation();
  const subscription = useMySubscriptionQuery();
  // A failed subscription read must not invite a paying user to pay again.
  const showSupport =
    subscription.isSuccess && subscription.data.plan_oid === FreeTier;
  return (
    <>
      <OpeningSearchBox size="large" />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          <IdealJobMatches hasIdealJob={me.ideal_job !== undefined} />
        </Col>
        <Col xs={24} lg={8}>
          <Flex vertical gap="large">
            <ProfileStatusCard me={me} profile={profile} />
            {me.totp_enabled ? null : (
              <Card size="small">
                <Flex gap="small" align="center" wrap>
                  <SafetyOutlined aria-hidden />
                  <Typography.Text>{t("home.securityTitle")}</Typography.Text>
                  <Link to="/settings/security">
                    {t("home.securityAction")}
                  </Link>
                </Flex>
              </Card>
            )}
            {showSupport ? (
              <Card size="small">
                <Flex gap="small" align="baseline">
                  <HeartOutlined aria-hidden />
                  <Typography.Text>
                    {t("home.supportBody")}{" "}
                    <Link to="/plan">{t("home.supportAction")}</Link>
                  </Typography.Text>
                </Flex>
              </Card>
            ) : null}
          </Flex>
        </Col>
      </Row>
    </>
  );
}
