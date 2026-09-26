import { Button, Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { paths } from "../app/paths";

export function LandingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Flex className="landing" orientation="vertical" gap="large">
      <Flex orientation="vertical" gap="small">
        <Typography.Title level={1}>{t("landing.title")}</Typography.Title>
        <Typography.Paragraph type="secondary">
          {t("landing.description")}
        </Typography.Paragraph>
      </Flex>
      <Flex gap="middle" wrap>
        <Button
          type="primary"
          size="large"
          onClick={() => navigate(paths.login)}
        >
          {t("landing.signIn")}
        </Button>
        <Button size="large" onClick={() => navigate(paths.signup)}>
          {t("landing.signUp")}
        </Button>
      </Flex>
      <Typography.Paragraph type="secondary">
        {t("landing.signUpHint")}
      </Typography.Paragraph>
    </Flex>
  );
}
