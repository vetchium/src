import {
  AimOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BranchesOutlined,
  CalendarOutlined,
  CommentOutlined,
  ContactsOutlined,
  CreditCardOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FormOutlined,
  HomeOutlined,
  SafetyOutlined,
  SettingOutlined,
  ShopOutlined,
  SolutionOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { usePendingOperations } from "@vetchium/portal-ui/pending-operations";
import { PortalShell } from "@vetchium/portal-ui/shell";
import { ThambiIcon } from "@vetchium/portal-ui/thambi";
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
import { isCapability, Sourcing } from "typespec/orgs/marketplace/capabilities";
import { paths } from "../../app/paths";
import { localeConfiguration } from "../../app/preferences";
import {
  currentWorkspace,
  isWorkspaceKey,
  type Page,
  type PageKey,
  pageOf,
  personalPages,
  type WorkspaceKey,
  workspacesFor,
} from "../../app/workspaces";
import { useAuth } from "../../auth/AuthContext";
import { useMyInfoQuery } from "../../features/account/queries";
import { DomainFailingBanner } from "../../features/domain/DomainFailingBanner";
import { capabilityLabel } from "../../features/marketplace/presentation";
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
  sourcing: <AimOutlined />,
  interviewing: <CommentOutlined />,
  assessment: <FormOutlined />,
  background_check: <FileSearchOutlined />,
  administration: <SettingOutlined />,
};

const pageIcons: Record<PageKey, ReactNode> = {
  openings: <FileTextOutlined />,
  pipelineTemplates: <BranchesOutlined />,
  findProviders: <ShopOutlined />,
  jobs: <AimOutlined />,
  contacts: <ContactsOutlined />,
  creditedApplications: <AuditOutlined />,
  workQueue: <UnorderedListOutlined />,
  clients: <SolutionOutlined />,
  members: <TeamOutlined />,
  listings: <AppstoreOutlined />,
  plans: <CreditCardOutlined />,
  ai: <ThambiIcon />,
  settings: <SettingOutlined />,
  organizationSecurity: <SafetyOutlined />,
  home: <HomeOutlined />,
  myInterviews: <CalendarOutlined />,
  security: <SafetyOutlined />,
  restoreDomain: <WarningOutlined />,
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
  const isAgency = me?.marketplace.capabilities.includes(Sourcing) === true;
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
        capabilities: me?.marketplace.capabilities ?? [],
      });
  const [remembered, setRemembered] = useState(rememberedWorkspace);
  const workspace = currentWorkspace(workspaces, location.pathname, remembered);
  useEffect(() => {
    if (workspace !== undefined && workspace.key !== remembered) {
      setRemembered(workspace.key);
      rememberWorkspace(workspace.key);
    }
  }, [workspace, remembered]);

  const pageItem = (page: Page): ItemType => ({
    key: page.path,
    icon: pageIcons[page.key],
    label:
      page.key === "contacts" && unreadCount > 0 ? (
        <Flex align="center" justify="space-between" gap="small">
          <span>{t(`navigation.${page.key}`)}</span>
          <Badge
            count={unreadCount}
            size="small"
            aria-label={t("navigation.unreadContacts", {
              count: unreadCount,
            })}
          />
        </Flex>
      ) : (
        t(`navigation.${page.key}`)
      ),
  });

  const sidebarPages: readonly Page[] = suspended
    ? [
        { key: "restoreDomain", path: paths.restoreDomain },
        ...(can(ManageBilling)
          ? [{ key: "plans", path: paths.plans } as const]
          : []),
      ]
    : (workspace?.pages ?? []);
  const accountPages: readonly Page[] = suspended
    ? [{ key: "security", path: paths.security }]
    : personalPages;
  const selectedKey =
    pageOf(location.pathname, [...sidebarPages, ...accountPages])?.path ?? "";

  const workspaceLabel = (key: WorkspaceKey) =>
    isCapability(key)
      ? capabilityLabel(t, key)
      : t(`navigation.workspaces.${key}`);

  const chooseWorkspace = (key: WorkspaceKey) => {
    const chosen = workspaces.find((candidate) => candidate.key === key);
    if (chosen === undefined) return;
    if (pending) {
      void message.warning(t("shell.operationInProgress"));
      return;
    }
    setRemembered(key);
    rememberWorkspace(key);
    navigate(chosen.pages[0]?.path ?? paths.home);
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
            title: workspaceLabel(candidate.key),
            label: (
              <Flex align="center" gap="small">
                {workspaceIcons[candidate.key]}
                <span>{workspaceLabel(candidate.key)}</span>
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
