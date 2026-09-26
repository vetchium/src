import { Card, Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router";
import { paths } from "../app/paths";
import { useAuth } from "../auth/AuthContext";
import { SignupRequestForm } from "../features/signup/SignupRequestForm";

export function SignupPage() {
  const { t } = useTranslation();
  const { authenticated } = useAuth();
  if (authenticated) return <Navigate replace to={paths.home} />;

  return (
    <Card className="setup-card">
      <title>{t("signup.documentTitle")}</title>
      <Flex orientation="vertical" gap="large">
        <div>
          <Typography.Title level={1}>{t("signup.title")}</Typography.Title>
          <Typography.Paragraph type="secondary">
            {t("signup.description")}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">
            {t("signup.requester")}
          </Typography.Paragraph>
        </div>
        <SignupRequestForm />
        <Typography.Text>
          {t("signup.haveAccount")}{" "}
          <Link to={paths.login}>{t("signup.signIn")}</Link>
        </Typography.Text>
      </Flex>
    </Card>
  );
}
