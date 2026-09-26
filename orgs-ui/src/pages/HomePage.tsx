import { Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";

export function HomePage() {
  const { t } = useTranslation();

  return (
    <Flex className="home-intro" orientation="vertical" gap="small">
      <Typography.Title level={1}>{t("home.title")}</Typography.Title>
      <Typography.Paragraph type="secondary">
        {t("home.description")}
      </Typography.Paragraph>
    </Flex>
  );
}
