import {
  HomeOutlined,
  SafetyOutlined,
  TeamOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { PortalShell } from "@vetchium/portal-ui/shell";
import { Flex, Typography } from "antd";
import type { ItemType } from "antd/es/menu/interface.js";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { DomainFailing, OrgSuspended } from "typespec/orgs/account/account";
import {
  holds,
  ManageUsers,
  Superadmin,
} from "typespec/orgs/authorization/types";
import { paths } from "../../app/paths";
import { localeConfiguration } from "../../app/preferences";
import { useAuth } from "../../auth/AuthContext";
import { useMyInfoQuery } from "../../features/account/queries";
import { DomainFailingBanner } from "../../features/domain/DomainFailingBanner";

export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const auth = useAuth();
  const { data: me } = useMyInfoQuery();
  const suspended = me?.org.org_state === OrgSuspended;

  const navigationItems: ItemType[] = suspended
    ? [
        {
          key: paths.restoreDomain,
          icon: <WarningOutlined />,
          label: t("navigation.restoreDomain"),
        },
        {
          key: paths.security,
          icon: <SafetyOutlined />,
          label: t("navigation.security"),
        },
      ]
    : [
        {
          key: paths.home,
          icon: <HomeOutlined />,
          label: t("navigation.home"),
        },
        ...(me !== undefined && holds(me.permissions, ManageUsers)
          ? [
              {
                key: paths.members,
                icon: <TeamOutlined />,
                label: t("navigation.members"),
              },
            ]
          : []),
        {
          key: paths.security,
          icon: <SafetyOutlined />,
          label: t("navigation.security"),
        },
      ];
  const selectedKey =
    navigationItems
      .map((item) => String(item?.key))
      .find(
        (key) =>
          location.pathname === key ||
          (key !== paths.home && location.pathname.startsWith(`${key}/`)),
      ) ?? "";

  const banner =
    me === undefined ? null : (
      <Flex orientation="vertical" gap="middle" className="shell-banner">
        <Flex
          gap="small"
          wrap
          align="baseline"
          aria-label={t("shell.signedInAs")}
          role="group"
        >
          <Typography.Text strong data-testid="shell-org-name">
            {me.org.display_name}
          </Typography.Text>
          <Typography.Text type="secondary" data-testid="shell-user-email">
            {me.email_address}
          </Typography.Text>
        </Flex>
        {me.org.domain.state === DomainFailing ? (
          <DomainFailingBanner
            domain={me.org.domain}
            canCheck={holds(me.permissions, Superadmin)}
          />
        ) : null}
      </Flex>
    );

  return (
    <PortalShell
      localization={localeConfiguration}
      navigationItems={navigationItems}
      selectedKey={selectedKey}
      onSignOut={auth.signOut}
      banner={banner}
    />
  );
}
