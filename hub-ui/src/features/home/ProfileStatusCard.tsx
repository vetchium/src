import { CheckCircleFilled, PlusCircleOutlined } from "@ant-design/icons";
import { Card, Flex, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { PublicProfile } from "typespec/hub/profile/public";
import type { MyInfoResponse } from "typespec/hub/users/profile";
import { completedSteps, setupSteps } from "./setupSteps";

export function ProfileStatusCard({
  me,
  profile,
}: {
  me: MyInfoResponse;
  profile: PublicProfile;
}) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const completed = completedSteps(me, profile);
  // The ideal job is not on the profile; the matches card asks for it.
  const lacking = setupSteps.flatMap((step) =>
    step === "idealJob" || completed[step] ? [] : [step],
  );
  return (
    <Card title={t("home.profileTitle")}>
      <Flex vertical gap="small" align="flex-start">
        {lacking.length === 0 ? (
          <Flex gap="small">
            <CheckCircleFilled
              aria-hidden
              style={{ color: token.colorSuccess }}
            />
            <Typography.Text>{t("home.profileReady")}</Typography.Text>
          </Flex>
        ) : (
          lacking.map((step) => (
            <Link key={step} to="/settings/profile">
              <Flex component="span" gap="small" align="baseline">
                <PlusCircleOutlined aria-hidden />
                {t(`home.checklist.${step}`)}
              </Flex>
            </Link>
          ))
        )}
        <Link to={`/u/${profile.handle}`}>{t("home.viewProfile")}</Link>
      </Flex>
    </Card>
  );
}
