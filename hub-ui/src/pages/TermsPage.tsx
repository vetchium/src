import { Space, Typography } from "antd";
import { useTranslation } from "react-i18next";

export function TermsPage() {
  const { t } = useTranslation();
  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("terms.documentTitle")}</title>
      <Typography.Title level={1}>{t("terms.title")}</Typography.Title>
      <Typography.Paragraph>{t("terms.general")}</Typography.Paragraph>
      <Typography.Title level={2}>{t("terms.paymentsTitle")}</Typography.Title>
      <Typography.Paragraph>{t("terms.paymentsBody")}</Typography.Paragraph>
    </Space>
  );
}
