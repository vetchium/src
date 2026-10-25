import assert from "node:assert/strict";
import test from "node:test";
import { paths } from "./paths.ts";
import {
  currentWorkspace,
  pageOf,
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
  agency: false,
  services: false,
};

const everything: WorkspaceAccess = Object.fromEntries(
  Object.keys(nothing).map((key) => [key, true]),
) as unknown as WorkspaceAccess;

test("a member without permissions sees only Hiring with Openings", () => {
  assert.deepEqual(workspacesFor(nothing), [
    { key: "hiring", pages: [paths.openings] },
  ]);
});

test("an agent sees the agency pages but not Clients or administration", () => {
  const workspaces = workspacesFor({
    ...nothing,
    agency: true,
    fulfilEngagements: true,
  });
  assert.deepEqual(
    workspaces.map((workspace) => workspace.key),
    ["hiring", "agency"],
  );
  assert.deepEqual(workspaces[1]?.pages, [
    paths.jobs,
    paths.contacts,
    paths.creditedApplications,
  ]);
});

test("agency and services workspaces appear only when the Org does that work", () => {
  const keys = workspacesFor({ ...everything, agency: false, services: false })
    .map((workspace) => workspace.key)
    .join();
  assert.equal(keys, "hiring,administration");
});

test("a Listings editor reaches Listings before the Org is a provider", () => {
  const workspaces = workspacesFor({ ...nothing, manageListings: true });
  assert.deepEqual(workspaces.at(-1), {
    key: "administration",
    pages: [paths.listings],
  });
});

test("nested routes belong to their page", () => {
  const pages = [paths.openings, paths.findProviders, paths.listings];
  assert.equal(pageOf("/openings/12/edit", pages), paths.openings);
  assert.equal(
    pageOf("/providers/listings/a.test/sourcing", pages),
    "/providers",
  );
  assert.equal(pageOf("/listings/sourcing", pages), paths.listings);
  assert.equal(pageOf("/openingsx", pages), undefined);
  assert.equal(pageOf("/jobs", [paths.home]), undefined);
});

test("a page in two workspaces keeps the one last chosen", () => {
  const workspaces = workspacesFor(everything);
  assert.equal(
    currentWorkspace(workspaces, "/clients/42", "services")?.key,
    "services",
  );
  assert.equal(
    currentWorkspace(workspaces, "/clients/42", "hiring")?.key,
    "agency",
  );
  assert.equal(
    currentWorkspace(workspaces, "/jobs", "services")?.key,
    "agency",
  );
});

test("a personal page keeps the workspace last chosen", () => {
  const workspaces = workspacesFor(everything);
  assert.equal(
    currentWorkspace(workspaces, paths.myInterviews, "administration")?.key,
    "administration",
  );
  assert.equal(
    currentWorkspace(workspaces, paths.home, undefined)?.key,
    "agency",
  );
  assert.equal(
    currentWorkspace(workspacesFor(nothing), paths.home, undefined)?.key,
    "hiring",
  );
});
