import {
  AimOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BranchesOutlined,
  ContactsOutlined,
  CreditCardOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  GlobalOutlined,
  HomeOutlined,
  InboxOutlined,
  LogoutOutlined,
  MailOutlined,
  MenuOutlined,
  MoonOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShopOutlined,
  SolutionOutlined,
  SunOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  UserOutlined,
  SearchOutlined,
  StarOutlined,
  IdcardOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Flex,
  Grid,
  Layout,
  Menu,
  Select,
  Switch,
  Tag,
  Typography,
  theme,
} from "antd";
import { createContext, type ReactNode, useContext } from "react";

const { Content, Footer, Header, Sider } = Layout;
export const DarkContext = createContext(false);

function AppHeader() {
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const compact = screens.sm !== true;
  const dark = useContext(DarkContext);
  return (
    <Header
      style={{
        height: 64,
        paddingInline: compact ? 12 : 24,
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
          {screens.lg !== true ? (
            <Button type="text" shape="circle" icon={<MenuOutlined />} />
          ) : null}
          <Button
            type="text"
            size="large"
            style={{ height: 48, paddingInline: compact ? 4 : 8 }}
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
                V
              </Avatar>
              {compact ? null : (
                <Typography.Text strong style={{ fontSize: token.fontSizeLG }}>
                  Vetchium
                </Typography.Text>
              )}
            </Flex>
          </Button>
        </Flex>
        <Flex gap="small" align="center" wrap={false}>
          <Select
            value="en-US"
            prefix={<GlobalOutlined />}
            style={{ width: compact ? 88 : 160 }}
            options={[
              {
                value: "en-US",
                label: compact ? "EN" : "English (United States)",
              },
            ]}
          />
          <Switch
            checked={dark}
            checkedChildren={<MoonOutlined />}
            unCheckedChildren={<SunOutlined />}
          />
          <Button
            type="text"
            shape={compact ? "circle" : undefined}
            icon={<LogoutOutlined />}
          >
            {compact ? null : "Sign out"}
          </Button>
        </Flex>
      </Flex>
    </Header>
  );
}

function Shell({
  items,
  selected,
  footer,
  children,
}: {
  items: any[];
  selected: string;
  footer: string;
  children: ReactNode;
}) {
  const screens = Grid.useBreakpoint();
  const dark = useContext(DarkContext);
  return (
    <Layout className="app-layout">
      <AppHeader />
      <Layout>
        {screens.lg === true ? (
          <Sider theme={dark ? "dark" : "light"} width={232}>
            <Menu mode="inline" selectedKeys={[selected]} items={items} />
          </Sider>
        ) : null}
        <Flex
          component={Content}
          className="app-content"
          orientation="vertical"
        >
          {children}
        </Flex>
      </Layout>
      <Footer>
        <Flex justify="center">
          <Typography.Text type="secondary">{footer}</Typography.Text>
        </Flex>
      </Footer>
    </Layout>
  );
}

const count = (label: string, n: number) => (
  <Flex justify="space-between" align="center">
    {label}
    <Badge count={n} size="small" />
  </Flex>
);

/** Which Orgs navigation groups show: MKT "Orgs portal" table. */
export type OrgKind = "consumer" | "provider" | "agency";

export function OrgsShell({
  kind = "consumer",
  selected,
  children,
}: {
  kind?: OrgKind;
  selected: string;
  children: ReactNode;
}) {
  const items: any[] = [
    { key: "overview", icon: <HomeOutlined />, label: "Overview" },
    {
      type: "group",
      key: "g-hiring",
      label: "Hiring",
      children: [
        { key: "openings", icon: <FileTextOutlined />, label: "Openings" },
        {
          key: "templates",
          icon: <BranchesOutlined />,
          label: "Pipeline templates",
        },
        { key: "providers", icon: <ShopOutlined />, label: "Find providers" },
      ],
    },
  ];
  if (kind !== "consumer")
    items.push({
      type: "group",
      key: "g-provider",
      label: "Provider",
      children: [
        { key: "listings", icon: <AppstoreOutlined />, label: "Listings" },
        {
          key: "clients",
          icon: <SolutionOutlined />,
          label: count("Clients", kind === "provider" ? 1 : 0),
        },
        { key: "work", icon: <UnorderedListOutlined />, label: "Work queue" },
      ],
    });
  if (kind === "agency")
    items.push({
      type: "group",
      key: "g-agency",
      label: "Agency",
      children: [
        { key: "jobs", icon: <AimOutlined />, label: "Jobs" },
        {
          key: "contacts",
          icon: <ContactsOutlined />,
          label: count("Contacts", 3),
        },
        {
          key: "credited",
          icon: <FileDoneOutlined />,
          label: "Credited applications",
        },
      ],
    });
  items.push({
    type: "group",
    key: "g-org",
    label: "Organization",
    children: [
      { key: "people", icon: <TeamOutlined />, label: "People" },
      { key: "ai", icon: <StarOutlined />, label: "AI" },
      { key: "company", icon: <SettingOutlined />, label: "Company" },
      {
        key: "orgsec",
        icon: <SafetyCertificateOutlined />,
        label: "Organization security",
      },
      { key: "billing", icon: <CreditCardOutlined />, label: "Billing" },
      { key: "account", icon: <AuditOutlined />, label: "My account" },
    ],
  });
  return (
    <Shell
      items={items}
      selected={selected}
      footer="Vetchium for organizations"
    >
      {children}
    </Shell>
  );
}

export function HubShell({
  selected,
  children,
}: {
  selected: string;
  children: ReactNode;
}) {
  const items: any[] = [
    { key: "home", icon: <HomeOutlined />, label: "Home" },
    { key: "profile", icon: <UserOutlined />, label: "My profile" },
    {
      key: "applications",
      icon: <IdcardOutlined />,
      label: count("Applications", 2),
    },
    { key: "messages", icon: <InboxOutlined />, label: count("Messages", 1) },
    { key: "plan", icon: <CreditCardOutlined />, label: "Plan" },
    {
      type: "group",
      key: "g-settings",
      label: "Settings",
      children: [
        {
          key: "security",
          icon: <SafetyCertificateOutlined />,
          label: "Account & security",
        },
        { key: "prefs", icon: <SettingOutlined />, label: "Preferences" },
        {
          key: "workemails",
          icon: <MailOutlined />,
          label: "Professional emails",
        },
      ],
    },
  ];
  return (
    <Shell items={items} selected={selected} footer="Vetchium">
      {children}
    </Shell>
  );
}

export function PageHeader({
  crumbs,
  title,
  tags,
  extra,
  intro,
  suffix,
}: {
  crumbs?: string[];
  title: ReactNode;
  tags?: ReactNode;
  extra?: ReactNode;
  intro?: ReactNode;
  suffix?: string;
}) {
  return (
    <Flex orientation="vertical" gap={4} style={{ marginBottom: 24 }}>
      {crumbs ? (
        <Breadcrumb
          style={{ marginBottom: 12 }}
          items={crumbs.map((c) => ({ title: c }))}
        />
      ) : null}
      <Flex justify="space-between" align="center" gap="middle" wrap>
        <Flex align="center" gap="small" wrap>
          <Typography.Title level={1} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {suffix ? (
            <Typography.Text type="secondary">{suffix}</Typography.Text>
          ) : null}
          {tags}
        </Flex>
        {extra ? (
          <Flex gap="small" wrap>
            {extra}
          </Flex>
        ) : null}
      </Flex>
      {intro ? (
        <Typography.Paragraph
          type="secondary"
          style={{ marginTop: 12, marginBottom: 0 }}
        >
          {intro}
        </Typography.Paragraph>
      ) : null}
    </Flex>
  );
}

export { Tag, SearchOutlined };
