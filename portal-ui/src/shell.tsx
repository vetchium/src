import {
  GlobalOutlined,
  LogoutOutlined,
  MenuOutlined,
  MoonOutlined,
  SunOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Avatar,
  Button,
  Drawer,
  Flex,
  Grid,
  Layout,
  Menu,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { ItemType } from "antd/es/menu/interface.js";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import type { FrontendLocale } from "typespec/common/localization";
import { isFrontendLocale } from "typespec/common/localization";
import { usePendingOperations } from "./pending-operations";
import { usePreferences } from "./preferences";

const { Content, Footer, Header, Sider } = Layout;
const languages: FrontendLocale[] = ["en-US", "ta", "de-DE"];

export function HeaderControls({
  onSignOut,
  onSelectLanguage,
  languagePending = false,
}: {
  onSignOut?: () => void;
  onSelectLanguage?: (language: FrontendLocale) => Promise<void>;
  languagePending?: boolean;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const preferences = usePreferences();
  const compact = screens.sm !== true;

  const selectLanguage = async (language: FrontendLocale) => {
    if (!isFrontendLocale(language) || language === preferences.language)
      return;
    try {
      await onSelectLanguage?.(language);
      preferences.setLanguage(language);
    } catch {
      void message.error(t("language.changeError"));
    }
  };

  return (
    <Flex gap="small" align="center" wrap={false}>
      <Select<FrontendLocale>
        value={preferences.language}
        aria-label={t("language.selectorLabel")}
        loading={languagePending}
        prefix={<GlobalOutlined />}
        placement="bottomRight"
        popupMatchSelectWidth={false}
        style={{ width: compact ? 88 : 160 }}
        options={languages.map((language) => ({
          value: language,
          label: t(`languages.${language}`),
        }))}
        labelRender={({ value }) =>
          t(
            compact
              ? `languageShort.${value as FrontendLocale}`
              : `languages.${value as FrontendLocale}`,
          )
        }
        onChange={(language) => void selectLanguage(language)}
      />
      <Tooltip title={t("theme.toggleLabel")}>
        <Switch
          checked={preferences.themeMode === "dark"}
          checkedChildren={<MoonOutlined />}
          unCheckedChildren={<SunOutlined />}
          aria-label={t("theme.toggleLabel")}
          onChange={preferences.toggleTheme}
        />
      </Tooltip>
      {onSignOut === undefined ? null : (
        <Tooltip title={t("shell.logout")}>
          <Button
            type="text"
            shape={compact ? "circle" : undefined}
            icon={<LogoutOutlined />}
            aria-label={t("shell.logout")}
            onClick={onSignOut}
          >
            {compact ? null : t("shell.logout")}
          </Button>
        </Tooltip>
      )}
    </Flex>
  );
}

export function AppHeader({
  homePath = "/",
  onNavigateHome,
  onOpenNavigation,
  onSignOut,
  portalTag = false,
  onSelectLanguage,
  languagePending,
}: {
  homePath?: string;
  onNavigateHome?: () => void;
  onOpenNavigation?: () => void;
  onSignOut?: () => void;
  portalTag?: boolean;
  onSelectLanguage?: (language: FrontendLocale) => Promise<void>;
  languagePending?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const { token } = theme.useToken();
  const compactBrand = screens.sm !== true;
  return (
    <Header
      style={{
        height: 64,
        paddingInline: compactBrand ? 12 : 24,
        lineHeight: "normal",
        background: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Flex
        align="center"
        justify="space-between"
        gap="small"
        wrap={false}
        style={{
          width: "100%",
          maxWidth: 1440,
          height: "100%",
          margin: "0 auto",
        }}
      >
        <Flex align="center" gap={4} wrap={false}>
          {screens.lg !== true && onOpenNavigation !== undefined ? (
            <Tooltip title={t("navigation.openMenu")}>
              <Button
                type="text"
                shape="circle"
                icon={<MenuOutlined />}
                aria-label={t("navigation.openMenu")}
                onClick={onOpenNavigation}
              />
            </Tooltip>
          ) : null}
          <Button
            type="text"
            size="large"
            aria-label={t("shell.homeLabel")}
            style={{ height: 48, paddingInline: compactBrand ? 4 : 8 }}
            onClick={() =>
              onNavigateHome === undefined
                ? navigate(homePath)
                : onNavigateHome()
            }
          >
            <Flex align="center" gap="small" wrap={false}>
              <Avatar
                shape="square"
                size={32}
                style={{
                  background: token.colorPrimary,
                  color: token.colorTextLightSolid,
                  fontWeight: token.fontWeightStrong,
                }}
              >
                {t("shell.monogram")}
              </Avatar>
              {compactBrand ? null : (
                <>
                  <Typography.Text
                    strong
                    style={{ fontSize: token.fontSizeLG }}
                  >
                    {t("shell.brand")}
                  </Typography.Text>
                  {portalTag ? (
                    <Tag
                      color={token.colorPrimary}
                      variant="filled"
                      style={{ marginInlineEnd: 0 }}
                    >
                      {t("shell.portal")}
                    </Tag>
                  ) : null}
                </>
              )}
            </Flex>
          </Button>
        </Flex>
        <HeaderControls
          onSignOut={onSignOut}
          onSelectLanguage={onSelectLanguage}
          languagePending={languagePending}
        />
      </Flex>
    </Header>
  );
}

export function PortalShell({
  navigationItems,
  selectedKey,
  onSignOut,
  portalTag,
  onSelectLanguage,
  languagePending,
}: {
  navigationItems: ItemType[];
  selectedKey: string;
  onSignOut: () => Promise<void>;
  portalTag?: boolean;
  onSelectLanguage?: (language: FrontendLocale) => Promise<void>;
  languagePending?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const preferences = usePreferences();
  const { message } = App.useApp();
  const { pending } = usePendingOperations();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const heldBack = () => {
    if (!pending) return false;
    void message.warning(t("shell.operationInProgress"));
    return true;
  };
  const navigateFromMenu = (path: string) => {
    if (heldBack()) return;
    setNavigationOpen(false);
    navigate(path);
  };
  const signOut = async () => {
    if (heldBack()) return;
    await onSignOut();
    navigate("/login", { replace: true });
  };
  return (
    <Layout className="app-layout">
      <title>{t("shell.documentTitle")}</title>
      <AppHeader
        onNavigateHome={() => navigateFromMenu("/")}
        onOpenNavigation={() => setNavigationOpen(true)}
        onSignOut={() => void signOut()}
        portalTag={portalTag}
        onSelectLanguage={onSelectLanguage}
        languagePending={languagePending}
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

export function PublicShell({
  homePath = "/",
  guardNavigation = false,
  verticallyCentered = false,
  portalTag = false,
}: {
  homePath?: string;
  guardNavigation?: boolean;
  verticallyCentered?: boolean;
  portalTag?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { pending } = usePendingOperations();
  const navigateHome = () => {
    if (guardNavigation && pending) {
      void message.warning(t("shell.operationInProgress"));
      return;
    }
    navigate(homePath);
  };
  return (
    <Layout className="app-layout">
      <title>{t("shell.documentTitle")}</title>
      <AppHeader
        homePath={homePath}
        onNavigateHome={guardNavigation ? navigateHome : undefined}
        portalTag={portalTag}
      />
      <Flex
        component={Content}
        className="public-content"
        align={verticallyCentered ? "center" : undefined}
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

interface LoadableIdentity {
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}

export function ProtectedRoute({
  authenticated,
  identity,
  omitRootReturnTo = false,
}: {
  authenticated: boolean;
  identity: LoadableIdentity;
  omitRootReturnTo?: boolean;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  if (!authenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    const destination =
      omitRootReturnTo && returnTo === "/"
        ? "/login"
        : `/login?returnTo=${encodeURIComponent(returnTo)}`;
    return <Navigate replace to={destination} />;
  }
  if (identity.isPending) return <Spin fullscreen size="large" />;
  if (identity.isError) {
    return (
      <Flex className="route-error" vertical gap="middle">
        <Alert type="error" title={t("common.loadError")} />
        <Button onClick={() => void identity.refetch()}>
          {t("common.retry")}
        </Button>
      </Flex>
    );
  }
  return <Outlet />;
}

export function RecentAuthenticationRoute({
  authenticatedAt,
}: {
  authenticatedAt: string | undefined;
}) {
  const location = useLocation();
  if (authenticatedAt === undefined) return <Spin fullscreen size="large" />;
  const timestamp = Date.parse(authenticatedAt);
  if (!Number.isFinite(timestamp) || Date.now() - timestamp >= 4 * 60 * 1000) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        replace
        to={`/reauthenticate?returnTo=${encodeURIComponent(returnTo)}`}
      />
    );
  }
  return <Outlet />;
}

export function ReauthenticationAlert(): ReactNode {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  const { pending } = usePendingOperations();
  const signInAgain = () => {
    if (pending) {
      void message.warning(t("shell.operationInProgress"));
      return;
    }
    const returnTo = `${location.pathname}${location.search}`;
    navigate(`/reauthenticate?returnTo=${encodeURIComponent(returnTo)}`, {
      replace: true,
    });
  };
  return (
    <Alert
      type="warning"
      showIcon
      title={t("reauthentication.title")}
      description={t("reauthentication.description")}
      action={
        <Button size="small" disabled={pending} onClick={signInAgain}>
          {t("reauthentication.action")}
        </Button>
      }
    />
  );
}
