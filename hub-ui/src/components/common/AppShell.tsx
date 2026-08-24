import { HomeOutlined, SettingOutlined } from "@ant-design/icons";
import { Drawer, Flex, Grid, Layout, Menu, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router";
import { usePreferences } from "../../app/PreferencesContext";
import { useAuth } from "../../auth/AuthContext";
import { AppHeader } from "./AppHeader";

const { Content, Footer, Sider } = Layout;

export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const preferences = usePreferences();
  const auth = useAuth();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const selectedKey = location.pathname.startsWith("/settings")
    ? "/settings"
    : "/";
  const navigationItems = [
    { key: "/", icon: <HomeOutlined />, label: t("navigation.home") },
    {
      key: "/settings",
      icon: <SettingOutlined />,
      label: t("navigation.settings"),
    },
  ];

  const navigateFromMenu = (path: string) => {
    setNavigationOpen(false);
    navigate(path);
  };

  return (
    <Layout className="app-layout">
      <title>{t("shell.documentTitle")}</title>
      <AppHeader
        onOpenNavigation={() => setNavigationOpen(true)}
        onSignOut={() => {
          void auth.signOut();
          navigate("/login", { replace: true });
        }}
      />
      <Drawer
        title={t("navigation.menu")}
        placement="left"
        size={280}
        open={screens.lg !== true && navigationOpen}
        styles={{ body: { padding: 0 } }}
        onClose={() => setNavigationOpen(false)}
      >
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={navigationItems}
          onClick={({ key }) => navigateFromMenu(key)}
        />
      </Drawer>
      <Layout>
        {screens.lg === true ? (
          <Sider theme={preferences.themeMode} width={232}>
            <Menu
              mode="inline"
              selectedKeys={[selectedKey]}
              items={navigationItems}
              onClick={({ key }) => navigateFromMenu(key)}
            />
          </Sider>
        ) : null}
        <Flex
          component={Content}
          className="app-content"
          orientation="vertical"
        >
          <Outlet />
        </Flex>
      </Layout>
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
