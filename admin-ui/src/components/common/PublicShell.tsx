import { Flex, Layout, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router";
import { AppHeader } from "./AppHeader";

const { Content, Footer } = Layout;

export function PublicShell() {
  const { t } = useTranslation();
  return (
    <Layout className="app-layout">
      <title>{t("shell.documentTitle")}</title>
      <AppHeader homePath="/login" />
      <Flex
        component={Content}
        className="public-content"
        align="center"
        justify="center"
      >
        <Outlet />
      </Flex>
      <Footer>
        <Flex justify="center">
          <Typography.Text type="secondary">
            {t("shell.footer")}
          </Typography.Text>
        </Flex>
      </Footer>
    </Layout>
  );
}
