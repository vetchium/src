import {
  AimOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BranchesOutlined,
  CalendarOutlined,
  ContactsOutlined,
  CreditCardOutlined,
  FileTextOutlined,
  HomeOutlined,
  SafetyOutlined,
  SettingOutlined,
  ShopOutlined,
  SolutionOutlined,
  TeamOutlined,
  ToolOutlined,
  UnorderedListOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { usePendingOperations } from "@vetchium/portal-ui/pending-operations";
import { PortalShell } from "@vetchium/portal-ui/shell";
import { App, Badge, Flex, Select, Typography } from "antd";
import type { ItemType } from "antd/es/menu/interface.js";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { DomainFailing, OrgSuspended } from "typespec/orgs/account/account";
import {
  FulfilEngagements,
  holds,
  ManageAI,
  ManageBilling,
  ManageListings,
  ManageOpenings,
  ManageProviders,
  ManageUsers,
  Superadmin,
} from "typespec/orgs/authorization/types";
import { paths } from "../../app/paths";
import { localeConfiguration } from "../../app/preferences";
import {
  currentWorkspace,
  isWorkspaceKey,
  pageOf,
  personalPages,
  type WorkspaceKey,
  workspacesFor,
} from "../../app/workspaces";
import { useAuth } from "../../auth/AuthContext";
import { useMyInfoQuery } from "../../features/account/queries";
import { VetchiumAIIcon } from "../../features/ai/VetchiumAIIcon";
import { DomainFailingBanner } from "../../features/domain/DomainFailingBanner";
import { useContactsQuery } from "../../features/marketplace/queries";

const workspaceStorageKey = "vetchium.orgs.workspace";

function rememberedWorkspace(): WorkspaceKey | undefined {
  try {
    const stored = globalThis.localStorage?.getItem(workspaceStorageKey);
    return isWorkspaceKey(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

function rememberWorkspace(key: WorkspaceKey): void {
  try {
    globalThis.localStorage?.setItem(workspaceStorageKey, key);
  } catch {
    // The choice still holds for this page.
  }
}

const workspaceIcons: Record<WorkspaceKey, ReactNode> = {
  hiring: <SolutionOutlined />,
  agency: <AimOutlined />,
  services: <ToolOutlined />,
  administration: <SettingOutlined />,
};

const pageIcons: Record<string, ReactNode> = {
  [paths.openings]: <FileTextOutlined />,
  [paths.pipelineTemplates]: <BranchesOutlined />,
  [paths.findProviders]: <ShopOutlined />,
  [paths.jobs]: <AimOutlined />,
  [paths.contacts]: <ContactsOutlined />,
  [paths.creditedApplications]: <AuditOutlined />,
  [paths.clients]: <SolutionOutlined />,
  [paths.workQueue]: <UnorderedListOutlined />,
  [paths.members]: <TeamOutlined />,
  [paths.listings]: <AppstoreOutlined />,
  [paths.plans]: <CreditCardOutlined />,
  [paths.ai]: <VetchiumAIIcon />,
  [paths.settings]: <SettingOutlined />,
  [paths.organizationSecurity]: <SafetyOutlined />,
  [paths.home]: <HomeOutlined />,
  [paths.myInterviews]: <CalendarOutlined />,
  [paths.security]: <SafetyOutlined />,
  [paths.restoreDomain]: <WarningOutlined />,
};

const pageLabelKeys: Record<string, string> = {
  [paths.openings]: "navigation.openings",
  [paths.pipelineTemplates]: "navigation.pipelineTemplates",
  [paths.findProviders]: "navigation.findProviders",
  [paths.jobs]: "navigation.jobs",
  [paths.contacts]: "navigation.contacts",
  [paths.creditedApplications]: "navigation.creditedApplications",
  [paths.clients]: "navigation.clients",
  [paths.workQueue]: "navigation.workQueue",
  [paths.members]: "navigation.members",
  [paths.listings]: "navigation.listings",
  [paths.plans]: "navigation.plans",
  [paths.ai]: "navigation.ai",
  [paths.settings]: "navigation.settings",
  [paths.organizationSecurity]: "navigation.organizationSecurity",
  [paths.home]: "navigation.home",
  [paths.myInterviews]: "navigation.myInterviews",
  [paths.security]: "navigation.security",
  [paths.restoreDomain]: "navigation.restoreDomain",
};

export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { pending } = usePendingOperations();
  const auth = useAuth();
  const { data: me } = useMyInfoQuery();
  const suspended = me?.org.org_state === OrgSuspended;
  const can = (permission: Parameters<typeof holds>[1]) =>
    me !== undefined && holds(me.permissions, permission);
  const canFulfil = can(FulfilEngagements);
  const isAgency = me?.marketplace.agency === true;
  const { data: unreadContactsData } = useContactsQuery(
    { filter: "unread", limit: 1 },
    canFulfil && isAgency && !suspended,
  );
  const unreadCount = unreadContactsData?.counts.unread ?? 0;

  const workspaces = suspended
    ? []
    : workspacesFor({
        manageOpenings: can(ManageOpenings),
        manageProviders: can(ManageProviders),
        manageListings: can(ManageListings),
        fulfilEngagements: canFulfil,
        manageUsers: can(ManageUsers),
        manageAI: can(ManageAI),
        manageBilling: can(ManageBilling),
        superadmin: can(Superadmin),
        agency: isAgency,
        services: me?.marketplace.services === true,
      });
  const [remembered, setRemembered] = useState(rememberedWorkspace);
  const workspace = currentWorkspace(workspaces, location.pathname, remembered);
  useEffect(() => {
    if (workspace !== undefined && workspace.key !== remembered) {
      setRemembered(workspace.key);
      rememberWorkspace(workspace.key);
    }
  }, [workspace, remembered]);

  const pageItem = (page: string): ItemType => ({
    key: page,
    icon: pageIcons[page],
    label:
      page === paths.contacts && unreadCount > 0 ? (
        <Flex align="center" justify="space-between" gap="small">
          <span>{t(pageLabelKeys[page] ?? page)}</span>
          <Badge
            count={unreadCount}
            size="small"
            aria-label={t("navigation.unreadContacts", {
              count: unreadCount,
            })}
          />
        </Flex>
      ) : (
        t(pageLabelKeys[page] ?? page)
      ),
  });

  const sidebarPages = suspended
    ? [paths.restoreDomain, ...(can(ManageBilling) ? [paths.plans] : [])]
    : (workspace?.pages ?? []);
  const accountPages: string[] = suspended
    ? [paths.security]
    : [...personalPages];
  const selectedKey =
    pageOf(location.pathname, [...sidebarPages, ...accountPages]) ?? "";

  const chooseWorkspace = (key: WorkspaceKey) => {
    const chosen = workspaces.find((candidate) => candidate.key === key);
    if (chosen === undefined) return;
    if (pending) {
      void message.warning(t("shell.operationInProgress"));
      return;
    }
    setRemembered(key);
    rememberWorkspace(key);
    navigate(chosen.pages[0] ?? paths.home);
  };

  const navigationHeader =
    workspaces.length > 1 && workspace !== undefined ? (
      <Flex vertical gap={4}>
        <Typography.Text type="secondary" id="workspace-label">
          {t("navigation.workspace")}
        </Typography.Text>
        <Select<WorkspaceKey>
          aria-labelledby="workspace-label"
          value={workspace.key}
          onChange={chooseWorkspace}
          style={{ width: "100%" }}
          options={workspaces.map((candidate) => ({
            value: candidate.key,
            title: t(`navigation.workspaces.${candidate.key}`),
            label: (
              <Flex align="center" gap="small">
                {workspaceIcons[candidate.key]}
                <span>{t(`navigation.workspaces.${candidate.key}`)}</span>
              </Flex>
            ),
          }))}
        />
      </Flex>
    ) : undefined;

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
      navigationItems={sidebarPages.map(pageItem)}
      selectedKey={selectedKey}
      onSignOut={auth.signOut}
      banner={banner}
      navigationHeader={navigationHeader}
      account={
        me === undefined
          ? undefined
          : { label: me.email_address, items: accountPages.map(pageItem) }
      }
    />
  );
}
