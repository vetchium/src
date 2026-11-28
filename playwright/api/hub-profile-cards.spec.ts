import { randomUUID } from "node:crypto";
import type {
  PeerReadCardsRequest,
  ReadCardsResponse,
  RelayReadCardsRequest,
} from "typespec/hub/profile/cards";
import {
  InvalidJSONError,
  ValidationFailedError,
} from "typespec/problem/details";
import { AuthenticationRequiredError } from "typespec/problem/hub/authentication";
import {
  ProfileNotFoundError,
  ProfileUnavailableError,
} from "typespec/problem/hub/profile";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI } from "../lib/hub-api.ts";
import { Cast, expectProblem, HubPostsAPI } from "../lib/hub-posts.ts";
import { meshPeerRequest, meshRelayRequest } from "../lib/mesh.ts";

function unknownHandle(): string {
  return `${randomUUID().replaceAll("-", "").slice(0, 8)}-0123456789a`;
}

async function cards(
  response: Awaited<ReturnType<HubPostsAPI["readCards"]>>,
): Promise<ReadCardsResponse> {
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return (await response.json()) as ReadCardsResponse;
}

test("read-cards returns local and remote cards and lists an unknown handle as unavailable", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "usa1"));
  try {
    const viewer = await cast.user("usa1", "Viewer");
    const local = await cast.user("usa1", "Local Card");
    const remote = await cast.user("sgp", "Remote Card");
    const missing = unknownHandle();

    const both = await cards(
      await api.readCards(
        { handles: [local.handle, remote.handle, missing] },
        viewer.token,
      ),
    );
    expect(
      both.cards
        .map((card) => [card.handle, card.display_name])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual(
      [
        [local.handle, "Local Card"],
        [remote.handle, "Remote Card"],
      ].sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
    expect(both.unavailable).toEqual([missing]);
    for (const card of both.cards) expect(card.alias).toBeUndefined();

    const one = await cards(
      await api.readCards({ handles: [local.handle] }, viewer.token),
    );
    expect(one).toEqual({
      cards: [{ handle: local.handle, display_name: "Local Card" }],
      unavailable: [],
    });
    const onlyRemote = await cards(
      await api.readCards({ handles: [remote.handle] }, viewer.token),
    );
    expect(onlyRemote.cards.map((card) => card.handle)).toEqual([
      remote.handle,
    ]);
    const onlyMissing = await cards(
      await api.readCards({ handles: [missing] }, viewer.token),
    );
    expect(onlyMissing).toEqual({ cards: [], unavailable: [missing] });
  } finally {
    cast.cleanup();
  }
});

test("read-cards accepts 50 handles and refuses 0, 51, duplicates, bad handles, and malformed JSON", async ({
  request,
}) => {
  const cast = new Cast(request);
  const api = new HubPostsAPI(new HubAPI(request, "usa1"));
  try {
    const viewer = await cast.user("usa1");
    const fifty = Array.from({ length: 50 }, unknownHandle);
    const accepted = await cards(
      await api.readCards({ handles: fifty }, viewer.token),
    );
    expect(accepted.cards).toEqual([]);
    expect([...accepted.unavailable].sort()).toEqual([...fifty].sort());

    const duplicate = unknownHandle();
    for (const body of [
      { handles: [] },
      { handles: Array.from({ length: 51 }, unknownHandle) },
      { handles: [duplicate, duplicate] },
      { handles: [viewer.handle, viewer.handle] },
      { handles: ["Not A Handle"] },
      { handles: [""] },
      {},
    ]) {
      await expectProblem(
        await api.raw("/profile/read-cards", body, viewer.token),
        400,
        ValidationFailedError.type,
      );
    }
    await expectProblem(
      await api.raw("/profile/read-cards", { handles: "abc" }, viewer.token),
      400,
      InvalidJSONError.type,
    );
    await expectProblem(
      await api.rawJSON("/profile/read-cards", '{"handles":', viewer.token),
      400,
      InvalidJSONError.type,
    );
    for (const token of [undefined, "not-a-session"]) {
      await expectProblem(
        await api.raw("/profile/read-cards", { handles: [duplicate] }, token),
        401,
        AuthenticationRequiredError.type,
      );
    }
  } finally {
    cast.cleanup();
  }
});

test("mesh card reads serve a verified viewer and refuse an unverified one", async ({
  request,
  apiCoverage,
}) => {
  const cast = new Cast(request);
  try {
    const viewer = await cast.user("usa1", "Mesh Viewer");
    const remote = await cast.user("sgp", "Mesh Remote");
    const missing = unknownHandle();
    const peerBody: PeerReadCardsRequest = {
      viewer_hub_user_did: viewer.did,
      viewer_handle: viewer.handle,
      handles: [remote.handle, viewer.handle],
    };
    const peer = meshPeerRequest("usa1", "sgp", peerBody, apiCoverage, {
      path: "/api/mesh/profile/read-cards",
    });
    expect(peer.status, JSON.stringify(peer.body)).toBe(200);
    expect(
      (peer.body as ReadCardsResponse).cards.map((card) => card.handle),
    ).toEqual([remote.handle]);

    // The relay reads the handles this tenant does not home.
    const relayBody: RelayReadCardsRequest = {
      viewer_hub_user_did: viewer.did,
      viewer_handle: viewer.handle,
      handles: [remote.handle, missing],
    };
    const relay = meshRelayRequest(
      "usa1",
      "/mesh/profile/read-cards",
      relayBody,
      apiCoverage,
    );
    expect(relay.status, JSON.stringify(relay.body)).toBe(200);
    expect(relay.body).toMatchObject({
      cards: [{ handle: remote.handle, display_name: "Mesh Remote" }],
      unavailable: [missing],
    });

    // deu does not home the viewer, so sgp refuses and reveals nothing.
    const stranger = meshPeerRequest("deu", "sgp", peerBody, apiCoverage, {
      path: "/api/mesh/profile/read-cards",
    });
    expect(stranger.status, JSON.stringify(stranger.body)).toBe(404);
    expect(stranger.body).toMatchObject({ type: ProfileNotFoundError.type });
    expect(JSON.stringify(stranger.body)).not.toContain("Mesh Remote");

    // A viewer handle that does not match the viewer DID is refused too.
    const mismatch = meshRelayRequest(
      "usa1",
      "/mesh/profile/read-cards",
      { ...relayBody, viewer_handle: unknownHandle() },
      apiCoverage,
    );
    expect(mismatch.status, JSON.stringify(mismatch.body)).toBe(404);
    expect(mismatch.body).toMatchObject({ type: ProfileNotFoundError.type });
  } finally {
    cast.cleanup();
  }
});

test("mesh card reads reject malformed JSON, invalid fields, and a missing relay credential", async ({
  request,
  apiCoverage,
}) => {
  const cast = new Cast(request);
  try {
    const viewer = await cast.user("usa1");
    const valid: RelayReadCardsRequest = {
      viewer_hub_user_did: viewer.did,
      viewer_handle: viewer.handle,
      handles: [unknownHandle()],
    };
    const relayPath = "/mesh/profile/read-cards";
    const peerPath = "/api/mesh/profile/read-cards";

    const relayMalformed = meshRelayRequest(
      "usa1",
      relayPath,
      undefined,
      apiCoverage,
      { rawBody: "{not json" },
    );
    expect(relayMalformed.status).toBe(400);
    expect(relayMalformed.body).toMatchObject({ type: InvalidJSONError.type });
    const peerMalformed = meshPeerRequest(
      "usa1",
      "sgp",
      undefined,
      apiCoverage,
      { path: peerPath, rawBody: "{not json" },
    );
    expect(peerMalformed.status).toBe(400);
    expect(peerMalformed.body).toMatchObject({ type: InvalidJSONError.type });

    for (const handles of [[], [valid.handles[0], valid.handles[0]]]) {
      const invalid = { ...valid, handles };
      const relayInvalid = meshRelayRequest(
        "usa1",
        relayPath,
        invalid,
        apiCoverage,
      );
      expect(relayInvalid.status).toBe(400);
      expect(relayInvalid.body).toMatchObject({
        type: ValidationFailedError.type,
      });
      const peerInvalid = meshPeerRequest("usa1", "sgp", invalid, apiCoverage, {
        path: peerPath,
      });
      expect(peerInvalid.status).toBe(400);
      expect(peerInvalid.body).toMatchObject({
        type: ValidationFailedError.type,
      });
    }

    const missing = meshRelayRequest("usa1", relayPath, valid, apiCoverage, {
      authorization: null,
    });
    expect(missing.status).toBe(401);
    expect(missing.body).toMatchObject({
      type: "vetchium-problem-details/mesh-relay-authentication-required",
    });
  } finally {
    cast.cleanup();
  }
});

// ind1's coordinator link is deliberately broken in CI (config/ci/ind1.json),
// so ind1 cannot verify the viewer and answers unavailable.
test("mesh card read reports unavailable when the serving tenant cannot reach its directory", async ({
  apiCoverage,
}) => {
  const body: PeerReadCardsRequest = {
    viewer_hub_user_did: `018f7e32-7b5a-7d31-8fd0-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    viewer_handle: unknownHandle(),
    handles: [unknownHandle()],
  };
  const response = meshPeerRequest("sgp", "ind1", body, apiCoverage, {
    path: "/api/mesh/profile/read-cards",
  });
  expect(response.status, JSON.stringify(response.body)).toBe(503);
  expect(response.body).toMatchObject({ type: ProfileUnavailableError.type });
});
