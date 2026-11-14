import { randomUUID } from "node:crypto";
import type { PublicProfile } from "typespec/hub/profile/public";
import type { MyInfoResponse } from "typespec/hub/users/profile";
import {
  InvalidJSONError,
  ValidationFailedError,
} from "typespec/problem/details";
import { AuthenticationRequiredError } from "typespec/problem/hub/authentication";
import { expectProblem, responseJSON } from "../lib/admin-api.ts";
import { hubAuditEventsForActor } from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import {
  type Applicant,
  cleanupApplicantsOf,
  seedApplicant,
} from "../lib/hub-applicant.ts";

const idealJobPath = "/set-ideal-job";
const lookingPath = "/set-looking-for-job";
const dismissPath = "/dismiss-job-search-prompt";

async function myInfo(user: Applicant): Promise<MyInfoResponse> {
  return responseJSON<MyInfoResponse>(await user.hub.myInfo(user.token));
}

test("job-search preferences default off and each setter saves its value (PROF-JOB-001, PROF-JOB-002)", async ({
  request,
}) => {
  const user = seedApplicant(request, "sgp", "Job Seeker");
  try {
    const initial = await myInfo(user);
    expect(initial).not.toHaveProperty("ideal_job");
    expect(initial.looking_for_job).toBe(false);
    expect(initial.job_search_prompt_dismissed).toBe(false);

    const saved = await user.hub.setIdealJob(user.token, {
      ideal_job: "Backend engineer",
    });
    expect(saved.status(), await saved.text()).toBe(204);
    expect(saved.headers()["cache-control"]).toBe("no-store");
    expect((await myInfo(user)).ideal_job).toBe("Backend engineer");

    expect(
      (
        await user.hub.setIdealJob(user.token, {
          ideal_job: " \n Staff engineer\n\nRemote first \t\n",
        })
      ).status(),
    ).toBe(204);
    expect((await myInfo(user)).ideal_job).toBe(
      "Staff engineer\n\nRemote first",
    );

    expect(
      (await user.hub.setIdealJob(user.token, { ideal_job: "" })).status(),
    ).toBe(204);
    expect(await myInfo(user)).not.toHaveProperty("ideal_job");

    expect(
      (
        await user.hub.setIdealJob(user.token, { ideal_job: "Designer" })
      ).status(),
    ).toBe(204);
    expect(
      (
        await user.hub.setIdealJob(user.token, { ideal_job: " \n\t " })
      ).status(),
    ).toBe(204);
    expect(await myInfo(user)).not.toHaveProperty("ideal_job");

    // Astral characters are one code point but two UTF-16 units.
    const longest = "😀".repeat(2000);
    expect(
      (
        await user.hub.setIdealJob(user.token, { ideal_job: ` ${longest} ` })
      ).status(),
    ).toBe(204);
    expect((await myInfo(user)).ideal_job).toBe(longest);
    await expectProblem(
      await user.hub.setIdealJob(user.token, { ideal_job: `${longest}😀` }),
      400,
      ValidationFailedError.type,
      ["ideal_job"],
    );
    expect((await myInfo(user)).ideal_job).toBe(longest);

    const looking = await user.hub.setLookingForJob(user.token, {
      looking_for_job: true,
    });
    expect(looking.status(), await looking.text()).toBe(204);
    expect(looking.headers()["cache-control"]).toBe("no-store");
    expect((await myInfo(user)).looking_for_job).toBe(true);
    expect(
      (
        await user.hub.setLookingForJob(user.token, { looking_for_job: false })
      ).status(),
    ).toBe(204);
    expect((await myInfo(user)).looking_for_job).toBe(false);

    const dismissed = await user.hub.dismissJobSearchPrompt(user.token);
    expect(dismissed.status(), await dismissed.text()).toBe(204);
    expect(dismissed.headers()["cache-control"]).toBe("no-store");
    expect((await myInfo(user)).job_search_prompt_dismissed).toBe(true);
    expect((await user.hub.dismissJobSearchPrompt(user.token)).status()).toBe(
      204,
    );
    expect((await myInfo(user)).job_search_prompt_dismissed).toBe(true);
  } finally {
    cleanupApplicantsOf([user], []);
  }
});

test("job-search setters refuse malformed bodies and unauthenticated calls", async ({
  request,
}) => {
  const user = seedApplicant(request, "sgp", "Job Seeker");
  try {
    expect(
      (await user.hub.setIdealJob(user.token, { ideal_job: "Kept" })).status(),
    ).toBe(204);
    for (const body of [{}, { ideal_job: null }]) {
      await expectProblem(
        await user.hub.post(idealJobPath, body, { token: user.token }),
        400,
        ValidationFailedError.type,
        ["ideal_job"],
      );
    }
    await expectProblem(
      await user.hub.post(
        idealJobPath,
        { ideal_job: 7 },
        { token: user.token },
      ),
      400,
      InvalidJSONError.type,
    );
    for (const body of [
      {},
      { looking_for_job: null },
      { looking_for_job: "true" },
    ]) {
      const response = await user.hub.post(lookingPath, body, {
        token: user.token,
      });
      if (typeof body.looking_for_job === "string") {
        await expectProblem(response, 400, InvalidJSONError.type);
      } else {
        await expectProblem(response, 400, ValidationFailedError.type, [
          "looking_for_job",
        ]);
      }
    }
    for (const path of [idealJobPath, lookingPath, dismissPath]) {
      await expectProblem(
        await user.hub.postRaw(path, "{", { token: user.token }),
        400,
        InvalidJSONError.type,
      );
      await expectProblem(
        await user.hub.post(path, { unknown: true }, { token: user.token }),
        400,
        InvalidJSONError.type,
      );
      const anonymous = await user.hub.post(
        path,
        path === idealJobPath
          ? { ideal_job: "Engineer" }
          : path === lookingPath
            ? { looking_for_job: true }
            : {},
      );
      await expectProblem(anonymous, 401, AuthenticationRequiredError.type);
      expect(anonymous.headers()["www-authenticate"]).toContain("Bearer");
    }

    const unchanged = await myInfo(user);
    expect(unchanged.ideal_job).toBe("Kept");
    expect(unchanged.looking_for_job).toBe(false);
    expect(unchanged.job_search_prompt_dismissed).toBe(false);
  } finally {
    cleanupApplicantsOf([user], []);
  }
});

test("job-search writes are audited without the ideal-job text (PROF-JOB-003)", async ({
  request,
}) => {
  const user = seedApplicant(request, "sgp", "Job Seeker");
  const secret = `ideal-${randomUUID()}`;
  try {
    expect(
      (await user.hub.setIdealJob(user.token, { ideal_job: secret })).status(),
    ).toBe(204);
    expect(
      (await user.hub.setIdealJob(user.token, { ideal_job: "" })).status(),
    ).toBe(204);
    expect(
      (
        await user.hub.setLookingForJob(user.token, { looking_for_job: true })
      ).status(),
    ).toBe(204);
    expect((await user.hub.dismissJobSearchPrompt(user.token)).status()).toBe(
      204,
    );

    const idealJobEvents = hubAuditEventsForActor(
      user.did,
      "hub.profile.ideal-job-set",
    );
    expect(idealJobEvents.map((event) => event.payload)).toEqual([
      { ideal_job_set: true },
      { ideal_job_set: false },
    ]);
    const lookingEvents = hubAuditEventsForActor(
      user.did,
      "hub.profile.looking-for-job-set",
    );
    expect(lookingEvents.map((event) => event.payload)).toEqual([
      { looking_for_job: true },
    ]);
    const dismissEvents = hubAuditEventsForActor(
      user.did,
      "hub.profile.job-search-prompt-dismissed",
    );
    expect(dismissEvents.map((event) => event.payload)).toEqual([{}]);
    for (const event of [
      ...idealJobEvents,
      ...lookingEvents,
      ...dismissEvents,
    ]) {
      expect(event).toMatchObject({
        tenant_id: "sgp",
        entity_type: "hub_user",
        entity_id: user.did,
        actor_type: "hub_user",
        actor_id: user.did,
        source: "hub-api",
      });
      expect(JSON.stringify(event)).not.toContain(secret);
    }
  } finally {
    cleanupApplicantsOf([user], []);
  }
});

test("profile reads carry neither job-search preference (PROF-JOB-004, PROF-JOB-005)", async ({
  request,
}) => {
  const owner = seedApplicant(request, "sgp", "Job Seeker");
  const localViewer = seedApplicant(request, "sgp", "Local Viewer");
  const remoteViewer = seedApplicant(request, "usa1", "Remote Viewer");
  const secret = `ideal-${randomUUID()}`;
  try {
    expect(
      (
        await owner.hub.setIdealJob(owner.token, { ideal_job: secret })
      ).status(),
    ).toBe(204);
    expect(
      (
        await owner.hub.setLookingForJob(owner.token, { looking_for_job: true })
      ).status(),
    ).toBe(204);

    for (const viewer of [owner, localViewer, remoteViewer]) {
      const read = await viewer.hub.readProfile(
        { address: owner.handle },
        viewer.token,
      );
      expect(read.status(), await read.text()).toBe(200);
      const text = await read.text();
      const profile = JSON.parse(text) as PublicProfile;
      expect(profile.handle).toBe(owner.handle);
      expect(text).not.toContain(secret);
      expect(text).not.toContain("ideal_job");
      expect(text).not.toContain("looking_for_job");
    }
  } finally {
    cleanupApplicantsOf([owner, localViewer, remoteViewer], []);
  }
});
