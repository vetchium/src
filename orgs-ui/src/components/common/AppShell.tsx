import {
  BranchesOutlined,
  CreditCardOutlined,
  FileTextOutlined,
  HomeOutlined,
  SafetyOutlined,
  SettingOutlined,
  TeamOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { PortalShell } from "@vetchium/portal-ui/shell";
import type { ItemType } from "antd/es/menu/interface.js";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { DomainFailing, OrgSuspended } from "typespec/orgs/account/account";
import {
  holds,
  ManageAI,
  ManageBilling,
  ManageOpenings,
  ManageUsers,
  Superadmin,
} from "typespec/orgs/authorization/types";
import { paths } from "../../app/paths";
import { localeConfiguration } from "../../app/preferences";
import { useAuth } from "../../auth/AuthContext";
import { useMyInfoQuery } from "../../features/account/queries";
import { VetchiumAIIcon } from "../../features/ai/VetchiumAIIcon";
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
        ...(me !== undefined && holds(me.permissions, ManageBilling)
          ? [
              {
                key: paths.plans,
                icon: <CreditCardOutlined />,
                label: t("navigation.plans"),
              },
            ]
          : []),
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
        // Later hiring screens (such as Find providers) join this group.
        {
          type: "group",
          key: "hiring",
          label: t("navigation.hiring"),
          children: [
            {
              key: paths.openings,
              icon: <FileTextOutlined />,
              label: t("navigation.openings"),
            },
            ...(me !== undefined && holds(me.permissions, ManageOpenings)
              ? [
                  {
                    key: paths.pipelineTemplates,
                    icon: <BranchesOutlined />,
                    label: t("navigation.pipelineTemplates"),
                  },
                ]
              : []),
          ],
        },
        {
          type: "group",
          key: "organization",
          label: t("navigation.organization"),
          children: [
            ...(me !== undefined && holds(me.permissions, ManageUsers)
              ? [
                  {
                    key: paths.members,
                    icon: <TeamOutlined />,
                    label: t("navigation.members"),
                  },
                ]
              : []),
            ...(me !== undefined && holds(me.permissions, ManageAI)
              ? [
                  {
                    key: paths.ai,
                    icon: <VetchiumAIIcon />,
                    label: t("navigation.ai"),
                  },
                ]
              : []),
            ...(me !== undefined && holds(me.permissions, Superadmin)
              ? [
                  {
                    key: paths.settings,
                    icon: <SettingOutlined />,
                    label: t("navigation.settings"),
                  },
                  {
                    key: paths.organizationSecurity,
                    icon: <SafetyOutlined />,
                    label: t("navigation.organizationSecurity"),
                  },
                ]
              : []),
            ...(me !== undefined && holds(me.permissions, ManageBilling)
              ? [
                  {
                    key: paths.plans,
                    icon: <CreditCardOutlined />,
                    label: t("navigation.plans"),
                  },
                ]
              : []),
            {
              key: paths.security,
              icon: <SafetyOutlined />,
              label: t("navigation.security"),
            },
          ],
        },
      ];
  const navigationKeys = navigationItems.flatMap((item) => {
    if (item === null) return [];
    const children =
      "children" in item && Array.isArray(item.children) ? item.children : [];
    return children.length > 0 ? children : [item];
  });
  const selectedKey =
    navigationKeys
      .map((item) => String(item?.key))
      .find(
        (key) =>
          location.pathname === key ||
          (key !== paths.home && location.pathname.startsWith(`${key}/`)),
      ) ?? "";

  const banner =
    me?.org.domain.state === DomainFailing ? (
      <div className="shell-banner">
        <DomainFailingBanner
          domain={me.org.domain}
          canCheck={holds(me.permissions, Superadmin)}
        />
      </div>
    ) : null;

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
