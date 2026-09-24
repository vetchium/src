import { Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { ProfessionalEmailsCard } from "../features/profile/ProfessionalEmailsCard";
import { useMyInfoQuery } from "../features/profile/queries";

export function WorkEmailsPage() {
  const { t } = useTranslation();
  const { data: me } = useMyInfoQuery();
  if (me === undefined) return null;
  return (
    <Space orientation="vertical" size="large" className="full-width">
      <title>{t("workEmails.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>{t("workEmails.title")}</Typography.Title>
        <Typography.Text type="secondary">
          {t("workEmails.description")}
        </Typography.Text>
      </div>
      <ProfessionalEmailsCard ownerHandle={me.handle} />
    </Space>
  );
}
