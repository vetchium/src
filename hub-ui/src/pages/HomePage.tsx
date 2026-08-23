import { Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";

export function HomePage() {
  const { t } = useTranslation();
  return (
    <Flex component="main" flex={1} justify="center" align="center">
      <title>{t("home.documentTitle")}</title>
      <Typography.Title level={1}>{t("home.placeholder")}</Typography.Title>
    </Flex>
  );
}
