import { Button, Flex, Layout, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Outlet, useNavigate } from "react-router";
import { HeaderControls } from "./HeaderControls";

const { Header, Content, Footer } = Layout;

export function PublicShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Layout className="app-layout">
      <title>{t("shell.documentTitle")}</title>
      <Header>
        <Flex
          className="app-header-content"
          align="center"
          justify="space-between"
        >
          <Button
            shape="round"
            size="large"
            ghost
            aria-label={t("shell.homeLabel")}
            onClick={() => navigate("/login")}
          >
            {t("shell.logo")}
          </Button>
          <HeaderControls />
        </Flex>
      </Header>
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
