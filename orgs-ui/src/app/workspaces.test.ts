import assert from "node:assert/strict";
import test from "node:test";
import { capabilityValues } from "typespec/orgs/marketplace/capabilities";
import { capabilityPath, paths } from "./paths.ts";
import {
  currentWorkspace,
  pageOf,
  type Workspace,
  type WorkspaceAccess,
  workspacesFor,
} from "./workspaces.ts";

const nothing: WorkspaceAccess = {
  manageOpenings: false,
  manageProviders: false,
  manageListings: false,
  fulfilEngagements: false,
  manageUsers: false,
  manageAI: false,
  manageBilling: false,
  superadmin: false,
  capabilities: [],
};

const everything: WorkspaceAccess = {
  ...(Object.fromEntries(
    Object.keys(nothing).map((key) => [key, true]),
  ) as unknown as WorkspaceAccess),
  capabilities: capabilityValues,
};

const pathsOf = (workspace: Workspace | undefined) =>
  workspace?.pages.map((page) => page.path);

test("a member without permissions sees only Hiring with Openings", () => {
  assert.deepEqual(workspacesFor(nothing), [
    { key: "hiring", pages: [{ key: "openings", path: paths.openings }] },
  ]);
});

test("each Capability the Org provides is its own workspace, in vocabulary order", () => {
  const workspaces = workspacesFor({
    ...everything,
    capabilities: ["background_check", "sourcing", "interviewing"],
  });
  assert.deepEqual(
    workspaces.map((workspace) => workspace.key),
    [
      "hiring",
      "sourcing",
      "interviewing",
      "background_check",
      "administration",
    ],
  );
  assert.deepEqual(pathsOf(workspaces[1]), [
    paths.jobs,
    paths.contacts,
    paths.creditedApplications,
    "/sourcing/clients",
  ]);
  assert.deepEqual(pathsOf(workspaces[2]), [
    "/interviewing/work",
    "/interviewing/clients",
  ]);
  assert.deepEqual(pathsOf(workspaces[3]), [
    "/background-check/work",
    "/background-check/clients",
  ]);
});

test("an agent sees their Capability's work but not Clients or administration", () => {
  const workspaces = workspacesFor({
    ...nothing,
    fulfilEngagements: true,
    capabilities: ["sourcing", "assessment"],
  });
  assert.deepEqual(
    workspaces.map((workspace) => [workspace.key, pathsOf(workspace)]),
    [
      ["hiring", [paths.openings]],
      ["sourcing", [paths.jobs, paths.contacts, paths.creditedApplications]],
      ["assessment", ["/assessment/work"]],
    ],
  );
});

test("Capability workspaces appear only when the Org provides them", () => {
  const keys = workspacesFor({ ...everything, capabilities: [] })
    .map((workspace) => workspace.key)
    .join();
  assert.equal(keys, "hiring,administration");
});

test("a Listings editor reaches Listings before the Org is a provider", () => {
  const workspaces = workspacesFor({ ...nothing, manageListings: true });
  assert.deepEqual(workspaces.at(-1), {
    key: "administration",
    pages: [{ key: "listings", path: paths.listings }],
  });
});

test("no page is in two workspaces", () => {
  const all = workspacesFor(everything).flatMap((workspace) =>
    workspace.pages.map((page) => page.path),
  );
  assert.equal(new Set(all).size, all.length);
  assert.equal(capabilityPath("background_check"), "/background-check");
});

test("nested routes belong to their page", () => {
  const pages = [
    { key: "openings", path: paths.openings },
    { key: "findProviders", path: paths.findProviders },
    { key: "listings", path: paths.listings },
  ] as const;
  assert.equal(pageOf("/openings/12/edit", pages)?.path, paths.openings);
  assert.equal(
    pageOf("/providers/listings/a.test/sourcing", pages)?.path,
    "/providers",
  );
  assert.equal(pageOf("/listings/sourcing", pages)?.path, paths.listings);
  assert.equal(pageOf("/openingsx", pages), undefined);
  assert.equal(
    pageOf("/sourcing/jobs", [{ key: "home", path: paths.home }]),
    undefined,
  );
});

test("a link opens the workspace of its Capability, whatever was chosen last", () => {
  const workspaces = workspacesFor(everything);
  const at = (pathname: string) =>
    currentWorkspace(workspaces, pathname, "sourcing")?.key;
  assert.equal(
    at(paths.clientEngagementDetail("interviewing", "e1")),
    "interviewing",
  );
  assert.equal(
    at(paths.workItem("background_check", "e1", "w1")),
    "background_check",
  );
  assert.equal(at(paths.clients("assessment")), "assessment");
  assert.equal(
    currentWorkspace(workspaces, paths.contactDetail("c1"), "hiring")?.key,
    "sourcing",
  );
});

test("a personal page keeps the workspace last chosen", () => {
  const workspaces = workspacesFor(everything);
  assert.equal(
    currentWorkspace(workspaces, paths.myInterviews, "administration")?.key,
    "administration",
  );
  assert.equal(
    currentWorkspace(workspaces, paths.home, "assessment")?.key,
    "assessment",
  );
  assert.equal(
    currentWorkspace(workspaces, paths.home, undefined)?.key,
    "sourcing",
  );
  assert.equal(
    currentWorkspace(
      workspacesFor({ ...everything, capabilities: ["assessment"] }),
      paths.home,
      undefined,
    )?.key,
    "assessment",
  );
  assert.equal(
    currentWorkspace(workspacesFor(nothing), paths.home, undefined)?.key,
    "hiring",
  );
});
