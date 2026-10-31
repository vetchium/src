import {
  type Capability,
  capabilityValues,
  isCapability,
  Sourcing,
} from "typespec/orgs/marketplace/capabilities";
import { paths } from "./paths.ts";

/**
 * The sidebar shows one workspace at a time, each holding Org-level pages for
 * one kind of work: Hiring, one per Capability the Org provides, and
 * Administration. Pages about the signed-in person belong to no workspace:
 * the ones they work from are pinned above the workspace, and their account
 * is in the account menu.
 */
export type WorkspaceKey = "hiring" | Capability | "administration";

export function isWorkspaceKey(value: unknown): value is WorkspaceKey {
  return (
    value === "hiring" || value === "administration" || isCapability(value)
  );
}

/** Names a page's label (`navigation.<key>`) and icon. */
export type PageKey =
  | "openings"
  | "pipelineTemplates"
  | "findProviders"
  | "jobs"
  | "contacts"
  | "creditedApplications"
  | "workQueue"
  | "clients"
  | "members"
  | "listings"
  | "plans"
  | "ai"
  | "settings"
  | "organizationSecurity"
  | "home"
  | "myInterviews"
  | "security"
  | "restoreDomain";

export interface Page {
  key: PageKey;
  path: string;
}

/** What the signed-in user may do and what the Org does in the marketplace. */
export interface WorkspaceAccess {
  manageOpenings: boolean;
  manageProviders: boolean;
  manageListings: boolean;
  fulfilEngagements: boolean;
  manageUsers: boolean;
  manageAI: boolean;
  manageBilling: boolean;
  superadmin: boolean;
  /** The Capabilities the Org provides. */
  capabilities: readonly Capability[];
}

export interface Workspace {
  key: WorkspaceKey;
  /** In menu order; the first opens when the workspace is chosen. */
  pages: Page[];
}

function present(pages: (Page | false)[]): Page[] {
  return pages.filter((page): page is Page => page !== false);
}

function providerPages(capability: Capability, access: WorkspaceAccess) {
  const work: (Page | false)[] =
    capability === Sourcing
      ? [
          access.fulfilEngagements && { key: "jobs", path: paths.jobs },
          access.fulfilEngagements && { key: "contacts", path: paths.contacts },
          access.fulfilEngagements && {
            key: "creditedApplications",
            path: paths.creditedApplications,
          },
        ]
      : [
          access.fulfilEngagements && {
            key: "workQueue",
            path: paths.workQueue(capability),
          },
        ];
  return present([
    ...work,
    access.manageListings && {
      key: "clients",
      path: paths.clients(capability),
    },
  ]);
}

/** The workspaces with at least one page this user may open. */
export function workspacesFor(access: WorkspaceAccess): Workspace[] {
  const workspaces: Workspace[] = [
    {
      key: "hiring",
      pages: present([
        { key: "openings", path: paths.openings },
        access.manageOpenings && {
          key: "pipelineTemplates",
          path: paths.pipelineTemplates,
        },
        access.manageProviders && {
          key: "findProviders",
          path: paths.findProviders,
        },
      ]),
    },
    // A Capability this portal does not know gets no workspace.
    ...capabilityValues
      .filter((capability) => access.capabilities.includes(capability))
      .map((capability) => ({
        key: capability,
        pages: providerPages(capability, access),
      })),
    {
      key: "administration",
      // Listings stays here for its editors so an Org can create its first.
      pages: present([
        access.manageUsers && { key: "members", path: paths.members },
        access.manageListings && { key: "listings", path: paths.listings },
        access.manageBilling && { key: "plans", path: paths.plans },
        access.manageAI && { key: "ai", path: paths.ai },
        access.superadmin && { key: "settings", path: paths.settings },
        access.superadmin && {
          key: "organizationSecurity",
          path: paths.organizationSecurity,
        },
      ]),
    },
  ];
  return workspaces.filter((workspace) => workspace.pages.length > 0);
}

/** The signed-in person's own work, pinned above every workspace. */
export const pinnedPages: readonly Page[] = [
  { key: "home", path: paths.home },
  { key: "myInterviews", path: paths.myInterviews },
];

/** The signed-in person's account, in the account menu. */
export const accountPages: readonly Page[] = [
  { key: "security", path: paths.security },
];

/** The page among pages that pathname shows, or one nested under it. */
export function pageOf(
  pathname: string,
  pages: readonly Page[],
): Page | undefined {
  return pages
    .filter(
      ({ path }) =>
        pathname === path ||
        (path !== paths.home && pathname.startsWith(`${path}/`)),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
}

// With nothing chosen yet, a provider user starts where their clients' work
// is, not on Hiring.
const firstChoice: readonly WorkspaceKey[] = [
  ...capabilityValues,
  "hiring",
  "administration",
];

/**
 * The workspace to show: the one holding the current page, as no page is in
 * two; on a personal page, the one last chosen, else the first of firstChoice
 * the user has.
 */
export function currentWorkspace(
  workspaces: readonly Workspace[],
  pathname: string,
  remembered: WorkspaceKey | undefined,
): Workspace | undefined {
  return (
    workspaces.find(
      (workspace) => pageOf(pathname, workspace.pages) !== undefined,
    ) ??
    workspaces.find((workspace) => workspace.key === remembered) ??
    firstChoice
      .map((key) => workspaces.find((workspace) => workspace.key === key))
      .find((workspace) => workspace !== undefined)
  );
}
