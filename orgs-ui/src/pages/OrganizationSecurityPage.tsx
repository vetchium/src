import { Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { GoogleSignInCard } from "../features/sso/GoogleSignInCard";
export function OrganizationSecurityPage() {
  const { t } = useTranslation();
  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("company.securityTitle")}</title>
      <Typography.Title level={1}>
        {t("navigation.organizationSecurity")}
      </Typography.Title>
      <GoogleSignInCard />
    </Space>
  );
}
