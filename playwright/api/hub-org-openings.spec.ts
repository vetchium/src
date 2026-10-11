import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import type { OpeningContent } from "typespec/common/openings";
import type {
  GetOrgOpeningResponse,
  ListOrgOpeningsResponse,
} from "typespec/hub/openings/public";
import type { OrgOpening } from "typespec/orgs/openings/types";
import { expectProblem } from "../lib/admin-api.ts";
import {
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  seedActiveHubUser,
  seedHubSignupDomain,
} from "../lib/admin-db.ts";
import { test } from "../lib/admin-fixtures.ts";
import { deleteOrgVerificationRecord } from "../lib/dev-dns.ts";
import { HubAPI } from "../lib/hub-api.ts";
import { login, signup } from "../lib/hub-signup.ts";
import { makePNG } from "../lib/logo-fixtures.ts";
import {
  type MeshResponse,
  meshPeerRequest,
  meshRelayRequest,
} from "../lib/mesh.ts";
import {
  cleanupOrg,
  loginOrg,
  OrgsAPI,
  orgSQL,
  signupOrg,
} from "../lib/orgs-api.ts";

function content(title: string): OpeningContent {
  return {
    title,
    description: "Build reliable services",
    language: "en",
    employing_country: "SG",
    work_arrangement: "hybrid",
    employment_type: "full_time",
    positions: 1,
  };
}

function expectMeshProblem(
  response: MeshResponse,
  status: number,
  type: string,
) {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  expect(response.body).toMatchObject({
    status,
    type: `vetchium-problem-details/${type}`,
  });
}

async function publish(
  api: OrgsAPI,
  owner: string,
  email: string,
  title: string,
): Promise<OrgOpening> {
  const createdResponse = await api.createOpening(owner, {
    content: content(title),
    hiring_manager_email: email,
    recruiter_email: email,
    team_member_emails: [],
  });
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  const created = (await createdResponse.json()) as OrgOpening;
  const publishedResponse = await api.requestOpeningChange(owner, {
    opening_number: created.opening_number,
    version: created.version,
    kind: "publish",
  });
  expect(publishedResponse.status(), await publishedResponse.text()).toBe(200);
  return (await publishedResponse.json()) as OrgOpening;
}

test("Hub lists and reads local and remote Org Openings with only public fields", async ({
  request,
  apiCoverage,
}) => {
  const viewerDomain = `e2e-${randomUUID()}.example.test`;
  const viewerEmail = `e2e+${randomUUID()}@${viewerDomain}`;
  const ind1Email = `e2e+${randomUUID()}@e2e-${randomUUID()}.example.test`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const localAPI = new OrgsAPI(request, "sgp");
  const remoteAPI = new OrgsAPI(request, "usa1");
  let viewerCreated = false;
  let ind1ViewerCreated = false;
  let localOrg: Awaited<ReturnType<typeof signupOrg>> | undefined;
  let remoteOrg: Awaited<ReturnType<typeof signupOrg>> | undefined;
  try {
    seedHubSignupDomain(viewerDomain, "sgp");
    const viewer = await signup(request, "sgp", viewerEmail, keys);
    viewerCreated = true;
    const token = await login(request, "sgp", viewerEmail, viewer.password);
    localOrg = await signupOrg(localAPI);
    remoteOrg = await signupOrg(remoteAPI);
    const localOwner = await loginOrg(localAPI, localOrg);
    const remoteOwner = await loginOrg(remoteAPI, remoteOrg);
    const localOpening = await publish(
      localAPI,
      localOwner,
      localOrg.emailAddress,
      "Local Engineer",
    );
    const remoteOpening = await publish(
      remoteAPI,
      remoteOwner,
      remoteOrg.emailAddress,
      "Remote Engineer",
    );
    let secondRemote = await publish(
      remoteAPI,
      remoteOwner,
      remoteOrg.emailAddress,
      "Remote Architect",
    );
    const workingResponse = await remoteAPI.saveOpeningWorkingCopy(
      remoteOwner,
      {
        opening_number: secondRemote.opening_number,
        version: secondRemote.version,
        content: { title: "Private working title" },
      },
    );
    expect(workingResponse.status()).toBe(200);
    secondRemote = (await workingResponse.json()) as OrgOpening;
    const draftResponse = await remoteAPI.createOpening(remoteOwner, {
      content: content("Unpublished Engineer"),
      hiring_manager_email: remoteOrg.emailAddress,
      recruiter_email: remoteOrg.emailAddress,
      team_member_emails: [],
    });
    expect(draftResponse.status()).toBe(201);
    const draft = (await draftResponse.json()) as OrgOpening;

    const localList = await hub.listOrgOpenings(
      { domain: localOrg.domain },
      token,
    );
    expect(localList.status(), await localList.text()).toBe(200);
    expect(localList.headers()["cache-control"]).toBe("no-store");
    const localBody = (await localList.json()) as ListOrgOpeningsResponse;
    expect(localBody.org).toMatchObject({
      domain: localOrg.domain,
      display_name: "Playwright Org",
    });
    expect(localBody.org.logo_url).toBeUndefined();
    expect(localBody.openings).toMatchObject([
      { opening_number: localOpening.opening_number, title: "Local Engineer" },
    ]);
    const localDetail = await hub.getOrgOpening(
      { domain: localOrg.domain, opening_number: localOpening.opening_number },
      token,
    );
    expect(localDetail.status()).toBe(200);
    expect(
      ((await localDetail.json()) as GetOrgOpeningResponse).opening.state,
    ).toBe("published");

    const remoteList = await hub.listOrgOpenings(
      {
        domain: remoteOrg.domain,
        limit: 1,
      },
      token,
    );
    expect(remoteList.status(), await remoteList.text()).toBe(200);
    const firstPage = (await remoteList.json()) as ListOrgOpeningsResponse;
    expect(firstPage.openings).toHaveLength(1);
    expect(firstPage.openings[0]?.opening_number).toBe(
      secondRemote.opening_number,
    );
    expect(firstPage.openings[0]?.title).toBe("Remote Architect");
    expect(firstPage.org.logo_url).toBeUndefined();
    expect(firstPage.next_pagination_key).toBeDefined();
    const pageKey = firstPage.next_pagination_key;
    if (pageKey === undefined) throw new Error("missing pagination key");
    const nextPageResponse = await hub.listOrgOpenings(
      {
        domain: remoteOrg.domain,
        limit: 1,
        pagination_key: pageKey,
      },
      token,
    );
    expect(nextPageResponse.status(), await nextPageResponse.text()).toBe(200);
    const nextPage = (await nextPageResponse.json()) as ListOrgOpeningsResponse;
    expect(nextPage.openings).toMatchObject([
      {
        opening_number: remoteOpening.opening_number,
        title: "Remote Engineer",
      },
    ]);
    const filtered = await hub.listOrgOpenings(
      {
        domain: remoteOrg.domain,
        title_query: "architect",
        employing_country: "SG",
        work_arrangement: "hybrid",
        employment_type: "full_time",
      },
      token,
    );
    expect(filtered.status(), await filtered.text()).toBe(200);
    expect(
      ((await filtered.json()) as ListOrgOpeningsResponse).openings,
    ).toMatchObject([{ title: "Remote Architect" }]);

    const detail = await hub.getOrgOpening(
      {
        domain: remoteOrg.domain,
        opening_number: remoteOpening.opening_number,
      },
      token,
    );
    expect(detail.status(), await detail.text()).toBe(200);
    const publicDetail = (await detail.json()) as GetOrgOpeningResponse;
    expect(publicDetail.opening).toMatchObject({
      opening_number: remoteOpening.opening_number,
      state: "published",
      content: content("Remote Engineer"),
    });
    for (const value of [localBody, firstPage, publicDetail]) {
      expect(JSON.stringify(value)).not.toMatch(
        /hiring_manager|recruiter|team_members|internal_notes|version|working_content|pending_request|email/,
      );
    }

    const pausedResponse = await remoteAPI.requestOpeningChange(remoteOwner, {
      opening_number: remoteOpening.opening_number,
      version: remoteOpening.version,
      kind: "pause",
    });
    expect(pausedResponse.status(), await pausedResponse.text()).toBe(200);
    const paused = await hub.getOrgOpening(
      {
        domain: remoteOrg.domain,
        opening_number: remoteOpening.opening_number,
      },
      token,
    );
    expect(paused.status(), await paused.text()).toBe(200);
    expect((await paused.json()).opening).toEqual({
      opening_number: remoteOpening.opening_number,
      state: "not_accepting",
      title: "Remote Engineer",
    });
    const draftDetail = await hub.getOrgOpening(
      { domain: remoteOrg.domain, opening_number: draft.opening_number },
      token,
    );
    expect(draftDetail.status()).toBe(404);
    expect(
      (
        await remoteAPI.discardOpening(remoteOwner, {
          opening_number: draft.opening_number,
          version: draft.version,
        })
      ).status(),
    ).toBe(200);
    const discardedDetail = await hub.getOrgOpening(
      { domain: remoteOrg.domain, opening_number: draft.opening_number },
      token,
    );
    expect(discardedDetail.status()).toBe(404);
    const pausedList = await hub.listOrgOpenings(
      { domain: remoteOrg.domain },
      token,
    );
    expect(
      ((await pausedList.json()) as ListOrgOpeningsResponse).openings,
    ).toMatchObject([{ opening_number: secondRemote.opening_number }]);
    const missing = await hub.getOrgOpening(
      {
        domain: remoteOrg.domain,
        opening_number: 999999,
      },
      token,
    );
    expect(missing.status()).toBe(404);

    const signedOut = await hub.post("/list-org-openings", {
      domain: remoteOrg.domain,
    });
    expect(signedOut.status()).toBe(401);
    expect(signedOut.headers()["www-authenticate"]).toContain("Bearer");
    const wrongKey = await hub.listOrgOpenings(
      {
        domain: remoteOrg.domain,
        title_query: "engineer",
        limit: 1,
        pagination_key: pageKey,
      },
      token,
    );
    expect(wrongKey.status()).toBe(400);

    const relay = meshRelayRequest(
      "sgp",
      "/mesh/org-openings/list",
      { domain: remoteOrg.domain },
      apiCoverage,
    );
    expect(relay.status, JSON.stringify(relay.body)).toBe(200);
    expect(JSON.stringify(relay.body)).not.toMatch(
      /hiring_manager|recruiter|team_members|internal_notes|version|working_content|pending_request|email/,
    );
    const peer = meshPeerRequest(
      "sgp",
      "usa1",
      { domain: remoteOrg.domain, opening_number: secondRemote.opening_number },
      apiCoverage,
      { path: "/api/mesh/org-openings/get" },
    );
    expect(peer.status, JSON.stringify(peer.body)).toBe(200);
    expect(JSON.stringify(peer.body)).not.toMatch(
      /hiring_manager|recruiter|team_members|internal_notes|version|working_content|pending_request|email/,
    );
    expect(JSON.stringify(peer.body)).not.toContain("Private working title");
    const closedResponse = await remoteAPI.requestOpeningChange(remoteOwner, {
      opening_number: secondRemote.opening_number,
      version: secondRemote.version,
      kind: "close",
    });
    expect(closedResponse.status()).toBe(200);
    const closed = await hub.getOrgOpening(
      { domain: remoteOrg.domain, opening_number: secondRemote.opening_number },
      token,
    );
    expect((await closed.json()).opening).toEqual({
      opening_number: secondRemote.opening_number,
      state: "not_accepting",
      title: "Remote Architect",
    });
    const noCertificate = meshPeerRequest(
      "sgp",
      "usa1",
      { domain: remoteOrg.domain },
      [],
      { path: "/api/mesh/org-openings/list", withoutCertificate: true },
    );
    expect(noCertificate.status).toBe(0);
    const unavailable = meshRelayRequest(
      "ind1",
      "/mesh/org-openings/list",
      { domain: remoteOrg.domain },
      apiCoverage,
    );
    expect(unavailable.status, JSON.stringify(unavailable.body)).toBe(503);
    const ind1Viewer = seedActiveHubUser("ind1", ind1Email, "Ind1 Viewer");
    ind1ViewerCreated = true;
    const ind1Hub = new HubAPI(request, "ind1");
    const unavailableFromHub = await ind1Hub.listOrgOpenings(
      { domain: remoteOrg.domain },
      ind1Viewer.sessionToken,
    );
    expect(unavailableFromHub.status()).toBe(503);

    expect(
      (
        await remoteAPI.setSubscriptionPlan(remoteOwner, {
          plan_oid: "org-silver-tier",
          billing_interval: "month",
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await remoteAPI.uploadLogo(remoteOwner, "image/png", makePNG(200, 200))
      ).status(),
    ).toBe(204);
    const withLogo = await hub.listOrgOpenings(
      { domain: remoteOrg.domain },
      token,
    );
    expect(withLogo.status()).toBe(200);
    const logoURL = ((await withLogo.json()) as ListOrgOpeningsResponse).org
      .logo_url;
    expect(logoURL).toBeDefined();
    expect((await fetch(logoURL ?? "")).status).toBe(200);

    orgSQL(
      `UPDATE vetchium.org_openings SET opening_state = 'expired',
      created_at = now() - interval '181 days',
      first_published_at = now() - interval '180 days 1 minute',
      expires_at = now() - interval '1 minute', ended_at = now()
      WHERE org_did = (SELECT org_did FROM vetchium.org_domains
        WHERE domain = '${localOrg.domain}')
        AND opening_number = ${localOpening.opening_number}`,
      "sgp",
    );
    const expired = await hub.getOrgOpening(
      { domain: localOrg.domain, opening_number: localOpening.opening_number },
      token,
    );
    expect((await expired.json()).opening).toEqual({
      opening_number: localOpening.opening_number,
      state: "not_accepting",
      title: "Local Engineer",
    });

    orgSQL(
      `UPDATE vetchium.org_domains SET domain_state = 'released',
      released_at = now()
      WHERE domain = '${localOrg.domain}'`,
      "sgp",
    );
    const released = await hub.listOrgOpenings(
      { domain: localOrg.domain },
      token,
    );
    expect(released.status()).toBe(404);

    orgSQL(
      `UPDATE vetchium.orgs SET org_state = 'suspended',
      suspended_at = now() WHERE org_did =
      (SELECT org_did FROM vetchium.org_domains
       WHERE domain = '${remoteOrg.domain}')`,
      "usa1",
    );
    const suspended = await hub.listOrgOpenings(
      { domain: remoteOrg.domain },
      token,
    );
    expect(suspended.status()).toBe(404);
  } finally {
    if (localOrg !== undefined) {
      cleanupOrg(localOrg.domain, "sgp");
      await deleteOrgVerificationRecord(localOrg.domain);
    }
    if (remoteOrg !== undefined) {
      cleanupOrg(remoteOrg.domain, "usa1");
      await deleteOrgVerificationRecord(remoteOrg.domain);
    }
    if (viewerCreated) cleanupHubUser(viewerEmail, "sgp");
    if (ind1ViewerCreated) cleanupHubUser(ind1Email, "ind1");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(viewerDomain, "sgp");
  }
});

test("Hub Org Opening reads reject malformed, unauthorized, missing, and unavailable requests", async ({
  request,
}) => {
  const email = `e2e+${randomUUID()}@e2e-${randomUUID()}.example.test`;
  const viewer = seedActiveHubUser("sgp", email, "Opening Reader");
  const hub = new HubAPI(request, "sgp");
  const missingDomain = `missing-${randomUUID()}.example.test`;
  const ind1Email = `e2e+${randomUUID()}@e2e-${randomUUID()}.example.test`;
  let ind1Created = false;
  try {
    await expectProblem(
      await hub.postRaw("/list-org-openings", "{invalid", {
        token: viewer.sessionToken,
      }),
      400,
      "vetchium-problem-details/invalid-json",
    );
    await expectProblem(
      await hub.post(
        "/list-org-openings",
        { domain: "bad domain" },
        {
          token: viewer.sessionToken,
        },
      ),
      400,
      "vetchium-problem-details/validation-failed",
    );
    await expectProblem(
      await hub.postRaw("/get-org-opening", "{invalid", {
        token: viewer.sessionToken,
      }),
      400,
      "vetchium-problem-details/invalid-json",
    );
    await expectProblem(
      await hub.post(
        "/get-org-opening",
        {
          domain: missingDomain,
          opening_number: 0,
        },
        { token: viewer.sessionToken },
      ),
      400,
      "vetchium-problem-details/validation-failed",
    );
    await expectProblem(
      await hub.post("/get-org-opening", {
        domain: missingDomain,
        opening_number: 1,
      }),
      401,
      "vetchium-problem-details/hub-authentication-required",
    );
    await expectProblem(
      await hub.getOrgOpening(
        { domain: missingDomain, opening_number: 1 },
        viewer.sessionToken,
      ),
      404,
      "vetchium-problem-details/hub-org-not-found",
    );
    const ind1Viewer = seedActiveHubUser("ind1", ind1Email, "Ind1 Reader");
    ind1Created = true;
    await expectProblem(
      await new HubAPI(request, "ind1").getOrgOpening(
        { domain: missingDomain, opening_number: 1 },
        ind1Viewer.sessionToken,
      ),
      503,
      "vetchium-problem-details/hub-org-unavailable",
    );
  } finally {
    cleanupHubUser(email, "sgp");
    if (ind1Created) cleanupHubUser(ind1Email, "ind1");
  }
});

test("mesh Org Opening list and get routes enforce credentials, validation, and ownership", async ({
  request,
  apiCoverage,
}) => {
  const api = new OrgsAPI(request, "usa1");
  const org = await signupOrg(api);
  try {
    const owner = await loginOrg(api, org);
    const opening = await publish(
      api,
      owner,
      org.emailAddress,
      "Mesh Engineer",
    );
    const missingDomain = `missing-${randomUUID()}.example.test`;
    const listBody = { domain: org.domain };
    const getBody = {
      domain: org.domain,
      opening_number: opening.opening_number,
    };
    const relayList = "/mesh/org-openings/list";
    const relayGet = "/mesh/org-openings/get";
    const peerList = "/api/mesh/org-openings/list";
    const peerGet = "/api/mesh/org-openings/get";

    const relayDetail = meshRelayRequest("sgp", relayGet, getBody, apiCoverage);
    expect(relayDetail.status, JSON.stringify(relayDetail.body)).toBe(200);
    expect(relayDetail.body).toMatchObject({
      opening: { opening_number: opening.opening_number, state: "published" },
    });
    const peerListings = meshPeerRequest("sgp", "usa1", listBody, apiCoverage, {
      path: peerList,
    });
    expect(peerListings.status, JSON.stringify(peerListings.body)).toBe(200);
    expect(peerListings.body).toMatchObject({
      openings: [{ opening_number: opening.opening_number }],
    });

    for (const path of [relayList, relayGet]) {
      expectMeshProblem(
        meshRelayRequest("sgp", path, undefined, apiCoverage, {
          rawBody: "{invalid",
        }),
        400,
        "invalid-json",
      );
      expectMeshProblem(
        meshRelayRequest("sgp", path, { domain: "bad domain" }, apiCoverage),
        400,
        "validation-failed",
      );
      expectMeshProblem(
        meshRelayRequest("sgp", path, listBody, apiCoverage, {
          authorization: null,
        }),
        401,
        "mesh-relay-authentication-required",
      );
      expectMeshProblem(
        meshRelayRequest(
          "sgp",
          path,
          path === relayList
            ? { domain: missingDomain }
            : { domain: missingDomain, opening_number: 1 },
          apiCoverage,
        ),
        404,
        "hub-org-not-found",
      );
    }
    for (const path of [peerList, peerGet]) {
      expectMeshProblem(
        meshPeerRequest("sgp", "usa1", undefined, apiCoverage, {
          path,
          rawBody: "{invalid",
        }),
        400,
        "invalid-json",
      );
      expectMeshProblem(
        meshPeerRequest("sgp", "usa1", { domain: "bad domain" }, apiCoverage, {
          path,
        }),
        400,
        "validation-failed",
      );
      expectMeshProblem(
        meshPeerRequest(
          "sgp",
          "usa1",
          path === peerList
            ? { domain: missingDomain }
            : { domain: missingDomain, opening_number: 1 },
          apiCoverage,
          { path },
        ),
        404,
        "hub-org-not-found",
      );
    }
    for (const [path, peer] of [
      [relayList, false],
      [peerList, true],
    ] as const) {
      const body = { domain: org.domain, pagination_key: "garbage" };
      const response = peer
        ? meshPeerRequest("sgp", "usa1", body, apiCoverage, { path })
        : meshRelayRequest("sgp", path, body, apiCoverage);
      expectMeshProblem(response, 400, "invalid-pagination-key");
    }
    expectMeshProblem(
      meshRelayRequest(
        "sgp",
        relayGet,
        { domain: org.domain, opening_number: 999999 },
        apiCoverage,
      ),
      404,
      "hub-opening-not-found",
    );
    expectMeshProblem(
      meshPeerRequest(
        "sgp",
        "usa1",
        { domain: org.domain, opening_number: 999999 },
        apiCoverage,
        { path: peerGet },
      ),
      404,
      "hub-opening-not-found",
    );
    expectMeshProblem(
      meshRelayRequest("ind1", relayGet, getBody, apiCoverage),
      503,
      "hub-org-unavailable",
    );
  } finally {
    cleanupOrg(org.domain, "usa1");
    await deleteOrgVerificationRecord(org.domain);
  }
});
