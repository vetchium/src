import { paths } from "./paths.ts";

/**
 * The sidebar shows one workspace at a time, each holding Org-level pages for
 * one kind of work. Pages about the signed-in person live in the account
 * menu instead, so the sidebar never mixes "mine" and "the Org's".
 */
export const workspaceKeys = [
  "hiring",
  "agency",
  "services",
  "administration",
] as const;

export type WorkspaceKey = (typeof workspaceKeys)[number];

export function isWorkspaceKey(value: unknown): value is WorkspaceKey {
  return workspaceKeys.includes(value as WorkspaceKey);
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
  agency: boolean;
  services: boolean;
}

export interface Workspace {
  key: WorkspaceKey;
  /** Routes, in menu order; the first opens when the workspace is chosen. */
  pages: string[];
}

function present(pages: (string | false)[]): string[] {
  return pages.filter((page): page is string => page !== false);
}

/** The workspaces with at least one page this user may open. */
export function workspacesFor(access: WorkspaceAccess): Workspace[] {
  const workspaces: Workspace[] = [
    {
      key: "hiring",
      pages: present([
        paths.openings,
        access.manageOpenings && paths.pipelineTemplates,
        access.manageProviders && paths.findProviders,
      ]),
    },
    {
      key: "agency",
      pages: access.agency
        ? present([
            access.fulfilEngagements && paths.jobs,
            access.fulfilEngagements && paths.contacts,
            access.fulfilEngagements && paths.creditedApplications,
            access.manageListings && paths.clients,
          ])
        : [],
    },
    {
      key: "services",
      pages: access.services
        ? present([
            access.fulfilEngagements && paths.workQueue,
            access.manageListings && paths.clients,
          ])
        : [],
    },
    {
      key: "administration",
      // Listings stays here for its editors so an Org can create its first.
      pages: present([
        access.manageUsers && paths.members,
        access.manageListings && paths.listings,
        access.manageBilling && paths.plans,
        access.manageAI && paths.ai,
        access.superadmin && paths.settings,
        access.superadmin && paths.organizationSecurity,
      ]),
    },
  ];
  return workspaces.filter((workspace) => workspace.pages.length > 0);
}

/** Pages about the signed-in person, in the account menu. */
export const personalPages = [
  paths.home,
  paths.myInterviews,
  paths.security,
] as const;

/** The page among pages that pathname shows, or one nested under it. */
export function pageOf(
  pathname: string,
  pages: readonly string[],
): string | undefined {
  return pages
    .filter(
      (page) =>
        pathname === page ||
        (page !== paths.home && pathname.startsWith(`${page}/`)),
    )
    .sort((a, b) => b.length - a.length)[0];
}

// With nothing chosen yet, an agency or provider user starts where their
// clients' work is, not on Hiring.
const firstChoice: readonly WorkspaceKey[] = [
  "agency",
  "services",
  "hiring",
  "administration",
];

/**
 * The workspace to show: one that holds the current page, preferring the one
 * last chosen when a page sits in two; on a personal page, the one last
 * chosen, else the first of firstChoice the user has.
 */
export function currentWorkspace(
  workspaces: readonly Workspace[],
  pathname: string,
  remembered: WorkspaceKey | undefined,
): Workspace | undefined {
  const holding = workspaces.filter(
    (workspace) => pageOf(pathname, workspace.pages) !== undefined,
  );
  return (
    holding.find((workspace) => workspace.key === remembered) ??
    holding[0] ??
    workspaces.find((workspace) => workspace.key === remembered) ??
    firstChoice
      .map((key) => workspaces.find((workspace) => workspace.key === key))
      .find((workspace) => workspace !== undefined)
  );
}
