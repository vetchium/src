import { App, Flex, Layout, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Outlet, useNavigate } from "react-router";
import { usePendingOperations } from "../../app/PendingOperationContext";
import { AppHeader } from "./AppHeader";

const { Content, Footer } = Layout;

export function PublicShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { pending } = usePendingOperations();

  const navigateHome = () => {
    if (pending) {
      void message.warning(t("shell.operationInProgress"));
      return;
    }
    navigate("/login");
  };

  return (
    <Layout className="app-layout">
      <title>{t("shell.documentTitle")}</title>
      <AppHeader homePath="/login" onNavigateHome={navigateHome} />
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
