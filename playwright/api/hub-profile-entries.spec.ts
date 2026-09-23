import { randomUUID } from "node:crypto";
import type {
  Certification,
  EducationalQualification,
  LanguageAbilityEntry,
  PublicProfile,
  WorkExperience,
} from "typespec/hub/profile/public";
import { IdempotencyKeyConflictError } from "typespec/problem/common";
import {
  InvalidJSONError,
  ValidationFailedError,
} from "typespec/problem/details";
import { AuthenticationRequiredError } from "typespec/problem/hub/authentication";
import { ProfileConflictError } from "typespec/problem/hub/profile";
import {
  cleanupHubIdempotency,
  cleanupHubSignupDomain,
  cleanupHubUser,
  seedHubSignupDomain,
} from "../lib/admin-db.ts";
import { expect, test } from "../lib/admin-fixtures.ts";
import { HubAPI, hubIdempotencyKey } from "../lib/hub-api.ts";
import { login, signup } from "../lib/hub-signup.ts";

/** The first day of the month one month after the current UTC month. */
function futureMonth(): string {
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 2; // current UTC month (1-based) + 1
  if (month > 12) {
    month -= 12;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

async function readProfile(
  hub: HubAPI,
  address: string,
  token: string,
): Promise<PublicProfile> {
  const response = await hub.readProfile({ address }, token);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as PublicProfile;
}

test("work experience entries round-trip, order current-first then by descending start month, and validate months and title length", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const label = randomUUID().replaceAll("-", "");
  const domainFor = (tag: string) => `wexp-${tag}-${label}.example.test`;
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Work Experience Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    async function create(body: {
      employer_domain: string;
      job_title: string;
      start_month: string;
      end_month?: string;
    }) {
      const key = hubIdempotencyKey();
      keys.push(key);
      return hub.saveWorkExperience(body, { token, idempotencyKey: key });
    }

    const currentTitle = `Current Role ${label}`;
    const recentTitle = `Recent Past Role ${label}`;
    const olderTitle = `Older Past Role ${label}`;

    expect(
      (
        await create({
          employer_domain: domainFor("current"),
          job_title: currentTitle,
          start_month: "2015-01",
        })
      ).status(),
    ).toBe(204);
    expect(
      (
        await create({
          employer_domain: domainFor("recent"),
          job_title: recentTitle,
          start_month: "2020-01",
          end_month: "2021-01",
        })
      ).status(),
    ).toBe(204);
    expect(
      (
        await create({
          employer_domain: domainFor("older"),
          job_title: olderTitle,
          start_month: "2010-01",
          end_month: "2011-01",
        })
      ).status(),
    ).toBe(204);

    let profile = await readProfile(hub, user.handle, token);
    const titles = profile.work_experiences.map((w) => w.job_title);
    // PROF-EXP-007: the current role leads regardless of start month, then
    // the rest fall by descending start month.
    expect(titles.indexOf(currentTitle)).toBeLessThan(
      titles.indexOf(recentTitle),
    );
    expect(titles.indexOf(recentTitle)).toBeLessThan(
      titles.indexOf(olderTitle),
    );

    const recentEntry = profile.work_experiences.find(
      (w) => w.job_title === recentTitle,
    ) as WorkExperience;
    expect(recentEntry).toBeDefined();

    const updatedTitle = `${recentTitle} Updated`;
    const updateKey = hubIdempotencyKey();
    keys.push(updateKey);
    const updated = await hub.saveWorkExperience(
      {
        id: recentEntry.id,
        employer_domain: domainFor("recent"),
        job_title: updatedTitle,
        start_month: "2020-01",
        end_month: "2021-01",
      },
      { token, idempotencyKey: updateKey },
    );
    expect(updated.status(), await updated.text()).toBe(204);
    profile = await readProfile(hub, user.handle, token);
    expect(
      profile.work_experiences.some((w) => w.job_title === updatedTitle),
    ).toBe(true);

    const deleteKey = hubIdempotencyKey();
    keys.push(deleteKey);
    const deleted = await hub.deleteWorkExperience(
      { id: recentEntry.id },
      { token, idempotencyKey: deleteKey },
    );
    expect(deleted.status(), await deleted.text()).toBe(204);
    profile = await readProfile(hub, user.handle, token);
    expect(profile.work_experiences.some((w) => w.id === recentEntry.id)).toBe(
      false,
    );

    const invalidRange = await create({
      employer_domain: domainFor("invalid-range"),
      job_title: `Invalid Range ${label}`,
      start_month: "2020-06",
      end_month: "2020-01",
    });
    expect(invalidRange.status()).toBe(400);
    const invalidRangeBody = await invalidRange.json();
    expect(invalidRangeBody.type).toBe(ValidationFailedError.type);
    expect(invalidRangeBody.fields).toContain("end_month");

    const futureCreate = await create({
      employer_domain: domainFor("future"),
      job_title: `Future Role ${label}`,
      start_month: futureMonth(),
    });
    expect(futureCreate.status()).toBe(400);
    const futureBody = await futureCreate.json();
    expect(futureBody.type).toBe(ValidationFailedError.type);
    expect(futureBody.fields).toContain("start_month");

    // A multi-byte character (3 bytes in UTF-8) so a byte-length bug would
    // reject the 200-code-point title and accept (or misjudge) the 201 one.
    const boundaryTitle = "字".repeat(200);
    const overLimitTitle = "字".repeat(201);
    expect([...boundaryTitle].length).toBe(200);
    expect([...overLimitTitle].length).toBe(201);

    const overLimitCreate = await create({
      employer_domain: domainFor("long-title"),
      job_title: overLimitTitle,
      start_month: "2015-01",
    });
    expect(overLimitCreate.status()).toBe(400);
    const overLimitBody = await overLimitCreate.json();
    expect(overLimitBody.type).toBe(ValidationFailedError.type);
    expect(overLimitBody.fields).toContain("job_title");

    const boundaryCreate = await create({
      employer_domain: domainFor("boundary-title"),
      job_title: boundaryTitle,
      start_month: "2015-01",
    });
    expect(boundaryCreate.status(), await boundaryCreate.text()).toBe(204);
    profile = await readProfile(hub, user.handle, token);
    expect(
      profile.work_experiences.some((w) => w.job_title === boundaryTitle),
    ).toBe(true);
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("certifications round-trip, order newest-created-first, and reject non-HTTPS, credentialed, and fragment URLs", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const label = randomUUID().replaceAll("-", "");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Certification Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    async function create(title: string, credentialUrl: string) {
      const key = hubIdempotencyKey();
      keys.push(key);
      return hub.saveCertification(
        { title, credential_url: credentialUrl },
        { token, idempotencyKey: key },
      );
    }

    const oldestTitle = `Oldest Cert ${label}`;
    const middleTitle = `Middle Cert ${label}`;
    const newestTitle = `Newest Cert ${label}`;
    for (const title of [oldestTitle, middleTitle, newestTitle]) {
      const created = await create(
        title,
        `https://cert-${label}.example.test/${encodeURIComponent(title)}`,
      );
      expect(created.status(), await created.text()).toBe(204);
    }

    let profile = await readProfile(hub, user.handle, token);
    const titles = profile.certifications.map((c) => c.title);
    // PROF-CER-004: newest created first.
    expect(titles.indexOf(newestTitle)).toBeLessThan(
      titles.indexOf(middleTitle),
    );
    expect(titles.indexOf(middleTitle)).toBeLessThan(
      titles.indexOf(oldestTitle),
    );

    const middleEntry = profile.certifications.find(
      (c) => c.title === middleTitle,
    ) as Certification;
    expect(middleEntry).toBeDefined();

    const updatedURL = `https://cert-${label}.example.test/updated`;
    const updateKey = hubIdempotencyKey();
    keys.push(updateKey);
    const updated = await hub.saveCertification(
      { id: middleEntry.id, title: middleTitle, credential_url: updatedURL },
      { token, idempotencyKey: updateKey },
    );
    expect(updated.status(), await updated.text()).toBe(204);
    profile = await readProfile(hub, user.handle, token);
    expect(
      profile.certifications.find((c) => c.id === middleEntry.id)
        ?.credential_url,
    ).toBe(updatedURL);

    const deleteKey = hubIdempotencyKey();
    keys.push(deleteKey);
    const deleted = await hub.deleteCertification(
      { id: middleEntry.id },
      { token, idempotencyKey: deleteKey },
    );
    expect(deleted.status(), await deleted.text()).toBe(204);
    profile = await readProfile(hub, user.handle, token);
    expect(profile.certifications.some((c) => c.id === middleEntry.id)).toBe(
      false,
    );

    // PROF-CER-003: host required, no credentials, no fragment.
    const nonHTTPS = await create(
      `Non-HTTPS ${label}`,
      `http://cert-${label}.example.test/badge`,
    );
    expect(nonHTTPS.status()).toBe(400);
    const nonHTTPSBody = await nonHTTPS.json();
    expect(nonHTTPSBody.type).toBe(ValidationFailedError.type);
    expect(nonHTTPSBody.fields).toContain("credential_url");

    const withCredentials = await create(
      `With Credentials ${label}`,
      `https://user:pass@cert-${label}.example.test/badge`,
    );
    expect(withCredentials.status()).toBe(400);
    const withCredentialsBody = await withCredentials.json();
    expect(withCredentialsBody.type).toBe(ValidationFailedError.type);
    expect(withCredentialsBody.fields).toContain("credential_url");

    const withFragment = await create(
      `With Fragment ${label}`,
      `https://cert-${label}.example.test/badge#section`,
    );
    expect(withFragment.status()).toBe(400);
    const withFragmentBody = await withFragment.json();
    expect(withFragmentBody.type).toBe(ValidationFailedError.type);
    expect(withFragmentBody.fields).toContain("credential_url");
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("educational qualifications round-trip, independently-optional months, and the four-group ordering of PROF-EDU-005", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const label = randomUUID().replaceAll("-", "");
  const domainFor = (tag: string) => `edu-${tag}-${label}.example.test`;
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Education Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    async function create(body: {
      institution_domain: string;
      degree: string;
      start_month?: string;
      end_month?: string;
    }) {
      const key = hubIdempotencyKey();
      keys.push(key);
      return hub.saveEducation(body, { token, idempotencyKey: key });
    }

    const newerOngoing = `Newer Ongoing ${label}`;
    const olderOngoing = `Older Ongoing ${label}`;
    const dated = `Dated ${label}`;
    const endOnly = `End Only ${label}`;
    const undated = `Undated ${label}`;

    expect(
      (
        await create({
          institution_domain: domainFor("newer-ongoing"),
          degree: newerOngoing,
          start_month: "2019-01",
        })
      ).status(),
    ).toBe(204);
    expect(
      (
        await create({
          institution_domain: domainFor("older-ongoing"),
          degree: olderOngoing,
          start_month: "2015-01",
        })
      ).status(),
    ).toBe(204);
    expect(
      (
        await create({
          institution_domain: domainFor("dated"),
          degree: dated,
          start_month: "2010-01",
          end_month: "2012-01",
        })
      ).status(),
    ).toBe(204);
    expect(
      (
        await create({
          institution_domain: domainFor("end-only"),
          degree: endOnly,
          end_month: "2005-01",
        })
      ).status(),
    ).toBe(204);
    expect(
      (
        await create({
          institution_domain: domainFor("undated"),
          degree: undated,
        })
      ).status(),
    ).toBe(204);

    let profile = await readProfile(hub, user.handle, token);
    const degrees = profile.educational_qualifications.map((e) => e.degree);
    expect(degrees).toEqual([
      newerOngoing,
      olderOngoing,
      dated,
      endOnly,
      undated,
    ]);

    const datedEntry = profile.educational_qualifications.find(
      (e) => e.degree === dated,
    ) as EducationalQualification;
    expect(datedEntry).toBeDefined();

    const updatedDegree = `${dated} Updated`;
    const updateKey = hubIdempotencyKey();
    keys.push(updateKey);
    const updated = await hub.saveEducation(
      {
        id: datedEntry.id,
        institution_domain: domainFor("dated"),
        degree: updatedDegree,
        start_month: "2010-01",
        end_month: "2012-01",
      },
      { token, idempotencyKey: updateKey },
    );
    expect(updated.status(), await updated.text()).toBe(204);
    profile = await readProfile(hub, user.handle, token);
    expect(
      profile.educational_qualifications.some(
        (e) => e.degree === updatedDegree,
      ),
    ).toBe(true);

    const deleteKey = hubIdempotencyKey();
    keys.push(deleteKey);
    const deleted = await hub.deleteEducation(
      { id: datedEntry.id },
      { token, idempotencyKey: deleteKey },
    );
    expect(deleted.status(), await deleted.text()).toBe(204);
    profile = await readProfile(hub, user.handle, token);
    expect(
      profile.educational_qualifications.some((e) => e.id === datedEntry.id),
    ).toBe(false);

    const invalidRange = await create({
      institution_domain: domainFor("invalid-range"),
      degree: `Invalid Range ${label}`,
      start_month: "2020-06",
      end_month: "2020-01",
    });
    expect(invalidRange.status()).toBe(400);
    const invalidRangeBody = await invalidRange.json();
    expect(invalidRangeBody.type).toBe(ValidationFailedError.type);
    expect(invalidRangeBody.fields).toContain("end_month");
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("language abilities can be added per ability and deleted, reject duplicates within one ability, and validate the catalog", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Language Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    async function add(
      ability: "speaking" | "reading" | "writing",
      tag: string,
    ) {
      const key = hubIdempotencyKey();
      keys.push(key);
      return hub.addLanguageAbility(
        { ability, language_tag: tag },
        { token, idempotencyKey: key },
      );
    }

    const speakingEnglish = await add("speaking", "en");
    expect(speakingEnglish.status(), await speakingEnglish.text()).toBe(204);
    const readingFrench = await add("reading", "fr");
    expect(readingFrench.status(), await readingFrench.text()).toBe(204);
    const writingGerman = await add("writing", "de");
    expect(writingGerman.status(), await writingGerman.text()).toBe(204);

    let profile = await readProfile(hub, user.handle, token);
    const has = (ability: string, tag: string) =>
      profile.language_abilities.some(
        (l: LanguageAbilityEntry) =>
          l.ability === ability && l.language_tag === tag,
      );
    expect(has("speaking", "en")).toBe(true);
    expect(has("reading", "fr")).toBe(true);
    expect(has("writing", "de")).toBe(true);

    // PROF-LAN-005: the same tag twice in one ability is rejected...
    const duplicateWithinAbility = await add("speaking", "en");
    expect(duplicateWithinAbility.status()).toBe(409);
    expect((await duplicateWithinAbility.json()).type).toBe(
      ProfileConflictError.type,
    );

    // ...but the same tag across two abilities is accepted.
    const sameTagOtherAbility = await add("reading", "en");
    expect(sameTagOtherAbility.status(), await sameTagOtherAbility.text()).toBe(
      204,
    );
    profile = await readProfile(hub, user.handle, token);
    expect(has("reading", "en")).toBe(true);

    // PROF-LAN-003: script/region-qualified tags are rejected.
    const scriptVariant = await add("speaking", "zh-Hans");
    expect(scriptVariant.status()).toBe(400);
    const scriptVariantBody = await scriptVariant.json();
    expect(scriptVariantBody.type).toBe(ValidationFailedError.type);
    expect(scriptVariantBody.fields).toContain("language_tag");

    // PROF-LAN-004: deprecated tags are rejected when a replacement exists
    // ("iw" is the deprecated predecessor of "he").
    const deprecatedTag = await add("speaking", "iw");
    expect(deprecatedTag.status()).toBe(400);
    const deprecatedTagBody = await deprecatedTag.json();
    expect(deprecatedTagBody.type).toBe(ValidationFailedError.type);
    expect(deprecatedTagBody.fields).toContain("language_tag");

    const deleteKey = hubIdempotencyKey();
    keys.push(deleteKey);
    const deleted = await hub.deleteLanguageAbility(
      { ability: "speaking", language_tag: "en" },
      { token, idempotencyKey: deleteKey },
    );
    expect(deleted.status(), await deleted.text()).toBe(204);
    profile = await readProfile(hub, user.handle, token);
    expect(has("speaking", "en")).toBe(false);
    expect(has("reading", "en")).toBe(true);
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("work experience, certification, and education writes require authentication and reject a missing or malformed entry id", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  const label = randomUUID().replaceAll("-", "");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Mutation Guard Owner",
    });
    const token = await login(request, "sgp", accountEmail, user.password);
    const foreignID = randomUUID();

    // PROF-GEN-002: every write requires an authenticated session.
    for (const [path, body] of [
      [
        "/profile/save-work-experience",
        {
          employer_domain: `wexp-${label}.example.test`,
          job_title: "Unauthenticated",
          start_month: "2015-01",
        },
      ],
      ["/profile/delete-work-experience", { id: foreignID }],
      [
        "/profile/save-certification",
        { title: "Unauthenticated", credential_url: "https://example.test/c" },
      ],
      ["/profile/delete-certification", { id: foreignID }],
      [
        "/profile/save-education",
        {
          institution_domain: `edu-${label}.example.test`,
          degree: "Unauthenticated",
        },
      ],
      ["/profile/delete-education", { id: foreignID }],
    ] as const) {
      const unauthenticated = await hub.post(path, body, {
        idempotencyKey: hubIdempotencyKey(),
      });
      expect(unauthenticated.status(), path).toBe(401);
      expect((await unauthenticated.json()).type).toBe(
        AuthenticationRequiredError.type,
      );
      expect(unauthenticated.headers()["www-authenticate"]).toContain("Bearer");
    }

    // 400: a malformed entry id fails validation before any lookup.
    const malformedWorkKey = hubIdempotencyKey();
    keys.push(malformedWorkKey);
    const malformedWork = await hub.deleteWorkExperience(
      { id: "not-a-uuid" },
      { token, idempotencyKey: malformedWorkKey },
    );
    expect(malformedWork.status()).toBe(400);
    const malformedWorkBody = await malformedWork.json();
    expect(malformedWorkBody.type).toBe(ValidationFailedError.type);
    expect(malformedWorkBody.fields).toContain("id");

    const malformedCertKey = hubIdempotencyKey();
    keys.push(malformedCertKey);
    const malformedCert = await hub.deleteCertification(
      { id: "not-a-uuid" },
      { token, idempotencyKey: malformedCertKey },
    );
    expect(malformedCert.status()).toBe(400);
    expect((await malformedCert.json()).fields).toContain("id");

    const malformedEduKey = hubIdempotencyKey();
    keys.push(malformedEduKey);
    const malformedEdu = await hub.deleteEducation(
      { id: "not-a-uuid" },
      { token, idempotencyKey: malformedEduKey },
    );
    expect(malformedEdu.status()).toBe(400);
    expect((await malformedEdu.json()).fields).toContain("id");

    // 409: a well-formed id that names no owned entry is a conflict, for
    // both an update (save) and a delete, rather than a silent no-op.
    const foreignSaveWorkKey = hubIdempotencyKey();
    keys.push(foreignSaveWorkKey);
    const foreignSaveWork = await hub.saveWorkExperience(
      {
        id: foreignID,
        employer_domain: `wexp-foreign-${label}.example.test`,
        job_title: "Foreign",
        start_month: "2015-01",
      },
      { token, idempotencyKey: foreignSaveWorkKey },
    );
    expect(foreignSaveWork.status()).toBe(409);
    expect((await foreignSaveWork.json()).type).toBe(ProfileConflictError.type);

    const foreignDeleteWorkKey = hubIdempotencyKey();
    keys.push(foreignDeleteWorkKey);
    const foreignDeleteWork = await hub.deleteWorkExperience(
      { id: foreignID },
      { token, idempotencyKey: foreignDeleteWorkKey },
    );
    expect(foreignDeleteWork.status()).toBe(409);
    expect((await foreignDeleteWork.json()).type).toBe(
      ProfileConflictError.type,
    );

    const foreignSaveCertKey = hubIdempotencyKey();
    keys.push(foreignSaveCertKey);
    const foreignSaveCert = await hub.saveCertification(
      {
        id: foreignID,
        title: "Foreign",
        credential_url: "https://example.test/foreign",
      },
      { token, idempotencyKey: foreignSaveCertKey },
    );
    expect(foreignSaveCert.status()).toBe(409);
    expect((await foreignSaveCert.json()).type).toBe(ProfileConflictError.type);

    const foreignDeleteCertKey = hubIdempotencyKey();
    keys.push(foreignDeleteCertKey);
    const foreignDeleteCert = await hub.deleteCertification(
      { id: foreignID },
      { token, idempotencyKey: foreignDeleteCertKey },
    );
    expect(foreignDeleteCert.status()).toBe(409);
    expect((await foreignDeleteCert.json()).type).toBe(
      ProfileConflictError.type,
    );

    const foreignSaveEduKey = hubIdempotencyKey();
    keys.push(foreignSaveEduKey);
    const foreignSaveEdu = await hub.saveEducation(
      {
        id: foreignID,
        institution_domain: `edu-foreign-${label}.example.test`,
        degree: "Foreign",
      },
      { token, idempotencyKey: foreignSaveEduKey },
    );
    expect(foreignSaveEdu.status()).toBe(409);
    expect((await foreignSaveEdu.json()).type).toBe(ProfileConflictError.type);

    const foreignDeleteEduKey = hubIdempotencyKey();
    keys.push(foreignDeleteEduKey);
    const foreignDeleteEdu = await hub.deleteEducation(
      { id: foreignID },
      { token, idempotencyKey: foreignDeleteEduKey },
    );
    expect(foreignDeleteEdu.status()).toBe(409);
    expect((await foreignDeleteEdu.json()).type).toBe(
      ProfileConflictError.type,
    );

    // 400 invalid-json: a malformed body is rejected before validation runs,
    // for every work experience, certification, and education write.
    for (const path of [
      "/profile/save-work-experience",
      "/profile/delete-work-experience",
      "/profile/save-certification",
      "/profile/delete-certification",
      "/profile/save-education",
      "/profile/delete-education",
    ] as const) {
      const key = hubIdempotencyKey();
      keys.push(key);
      const malformed = await hub.postRaw(path, "{not json", {
        token,
        idempotencyKey: key,
      });
      expect(malformed.status(), path).toBe(400);
      expect((await malformed.json()).type, path).toBe(InvalidJSONError.type);
    }

    // 409 idempotency-key-conflict: replaying a save with a different body.
    const workConflictKey = hubIdempotencyKey();
    keys.push(workConflictKey);
    const firstWorkSave = await hub.saveWorkExperience(
      {
        employer_domain: `wexp-conflict-${label}.example.test`,
        job_title: `Conflict Base ${label}`,
        start_month: "2015-01",
      },
      { token, idempotencyKey: workConflictKey },
    );
    expect(firstWorkSave.status(), await firstWorkSave.text()).toBe(204);
    const conflictingWorkSave = await hub.saveWorkExperience(
      {
        employer_domain: `wexp-conflict-2-${label}.example.test`,
        job_title: `Conflict Changed ${label}`,
        start_month: "2016-01",
      },
      { token, idempotencyKey: workConflictKey },
    );
    expect(conflictingWorkSave.status()).toBe(409);
    expect((await conflictingWorkSave.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );

    const certConflictKey = hubIdempotencyKey();
    keys.push(certConflictKey);
    const firstCertSave = await hub.saveCertification(
      {
        title: `Conflict Cert ${label}`,
        credential_url: `https://cert-conflict-${label}.example.test/a`,
      },
      { token, idempotencyKey: certConflictKey },
    );
    expect(firstCertSave.status(), await firstCertSave.text()).toBe(204);
    const conflictingCertSave = await hub.saveCertification(
      {
        title: `Conflict Cert Changed ${label}`,
        credential_url: `https://cert-conflict-${label}.example.test/b`,
      },
      { token, idempotencyKey: certConflictKey },
    );
    expect(conflictingCertSave.status()).toBe(409);
    expect((await conflictingCertSave.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );

    const eduConflictKey = hubIdempotencyKey();
    keys.push(eduConflictKey);
    const firstEduSave = await hub.saveEducation(
      {
        institution_domain: `edu-conflict-${label}.example.test`,
        degree: `Conflict Degree ${label}`,
      },
      { token, idempotencyKey: eduConflictKey },
    );
    expect(firstEduSave.status(), await firstEduSave.text()).toBe(204);
    const conflictingEduSave = await hub.saveEducation(
      {
        institution_domain: `edu-conflict-${label}.example.test`,
        degree: `Conflict Degree Changed ${label}`,
      },
      { token, idempotencyKey: eduConflictKey },
    );
    expect(conflictingEduSave.status()).toBe(409);
    expect((await conflictingEduSave.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );

    // 409 idempotency-key-conflict: replaying a delete against a different
    // entry id.
    async function createWorkEntry(tag: string): Promise<string> {
      const entryKey = hubIdempotencyKey();
      keys.push(entryKey);
      const created = await hub.saveWorkExperience(
        {
          employer_domain: `wexp-delete-${tag}-${label}.example.test`,
          job_title: `Delete Target ${tag} ${label}`,
          start_month: "2015-01",
        },
        { token, idempotencyKey: entryKey },
      );
      expect(created.status(), await created.text()).toBe(204);
      const profile = await readProfile(hub, user.handle, token);
      const entry = profile.work_experiences.find(
        (w) => w.job_title === `Delete Target ${tag} ${label}`,
      ) as WorkExperience;
      expect(entry).toBeDefined();
      return entry.id;
    }
    const workDeleteA = await createWorkEntry("a");
    const workDeleteB = await createWorkEntry("b");
    const workDeleteConflictKey = hubIdempotencyKey();
    keys.push(workDeleteConflictKey);
    const firstWorkDelete = await hub.deleteWorkExperience(
      { id: workDeleteA },
      { token, idempotencyKey: workDeleteConflictKey },
    );
    expect(firstWorkDelete.status(), await firstWorkDelete.text()).toBe(204);
    const conflictingWorkDelete = await hub.deleteWorkExperience(
      { id: workDeleteB },
      { token, idempotencyKey: workDeleteConflictKey },
    );
    expect(conflictingWorkDelete.status()).toBe(409);
    expect((await conflictingWorkDelete.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );

    async function createCertEntry(tag: string): Promise<string> {
      const entryKey = hubIdempotencyKey();
      keys.push(entryKey);
      const title = `Delete Target Cert ${tag} ${label}`;
      const created = await hub.saveCertification(
        {
          title,
          credential_url: `https://cert-delete-${tag}-${label}.example.test/badge`,
        },
        { token, idempotencyKey: entryKey },
      );
      expect(created.status(), await created.text()).toBe(204);
      const profile = await readProfile(hub, user.handle, token);
      const entry = profile.certifications.find(
        (c) => c.title === title,
      ) as Certification;
      expect(entry).toBeDefined();
      return entry.id;
    }
    const certDeleteA = await createCertEntry("a");
    const certDeleteB = await createCertEntry("b");
    const certDeleteConflictKey = hubIdempotencyKey();
    keys.push(certDeleteConflictKey);
    const firstCertDelete = await hub.deleteCertification(
      { id: certDeleteA },
      { token, idempotencyKey: certDeleteConflictKey },
    );
    expect(firstCertDelete.status(), await firstCertDelete.text()).toBe(204);
    const conflictingCertDelete = await hub.deleteCertification(
      { id: certDeleteB },
      { token, idempotencyKey: certDeleteConflictKey },
    );
    expect(conflictingCertDelete.status()).toBe(409);
    expect((await conflictingCertDelete.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );

    async function createEduEntry(tag: string): Promise<string> {
      const entryKey = hubIdempotencyKey();
      keys.push(entryKey);
      const degree = `Delete Target Edu ${tag} ${label}`;
      const created = await hub.saveEducation(
        {
          institution_domain: `edu-delete-${tag}-${label}.example.test`,
          degree,
        },
        { token, idempotencyKey: entryKey },
      );
      expect(created.status(), await created.text()).toBe(204);
      const profile = await readProfile(hub, user.handle, token);
      const entry = profile.educational_qualifications.find(
        (e) => e.degree === degree,
      ) as EducationalQualification;
      expect(entry).toBeDefined();
      return entry.id;
    }
    const eduDeleteA = await createEduEntry("a");
    const eduDeleteB = await createEduEntry("b");
    const eduDeleteConflictKey = hubIdempotencyKey();
    keys.push(eduDeleteConflictKey);
    const firstEduDelete = await hub.deleteEducation(
      { id: eduDeleteA },
      { token, idempotencyKey: eduDeleteConflictKey },
    );
    expect(firstEduDelete.status(), await firstEduDelete.text()).toBe(204);
    const conflictingEduDelete = await hub.deleteEducation(
      { id: eduDeleteB },
      { token, idempotencyKey: eduDeleteConflictKey },
    );
    expect(conflictingEduDelete.status()).toBe(409);
    expect((await conflictingEduDelete.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});

test("language ability writes require authentication, reject an invalid tag on delete, and treat a missing ability as a conflict", async ({
  request,
}) => {
  const accountDomain = `e2e-${randomUUID()}.example.test`;
  const accountEmail = `e2e+${randomUUID()}@${accountDomain}`;
  const keys: string[] = [];
  const hub = new HubAPI(request, "sgp");
  try {
    seedHubSignupDomain(accountDomain, "sgp");
    const user = await signup(request, "sgp", accountEmail, keys, {
      displayName: "Language Mutation Guard",
    });
    const token = await login(request, "sgp", accountEmail, user.password);

    // PROF-GEN-002: every write requires an authenticated session.
    const unauthenticatedAdd = await hub.post(
      "/profile/add-language",
      { ability: "speaking", language_tag: "en" },
      { idempotencyKey: hubIdempotencyKey() },
    );
    expect(unauthenticatedAdd.status()).toBe(401);
    expect((await unauthenticatedAdd.json()).type).toBe(
      AuthenticationRequiredError.type,
    );

    const unauthenticatedDelete = await hub.post(
      "/profile/delete-language",
      { ability: "speaking", language_tag: "en" },
      { idempotencyKey: hubIdempotencyKey() },
    );
    expect(unauthenticatedDelete.status()).toBe(401);

    // 400 invalid-json: a malformed body is rejected before validation runs.
    const malformedAddKey = hubIdempotencyKey();
    keys.push(malformedAddKey);
    const malformedAdd = await hub.postRaw(
      "/profile/add-language",
      "{not json",
      { token, idempotencyKey: malformedAddKey },
    );
    expect(malformedAdd.status()).toBe(400);
    expect((await malformedAdd.json()).type).toBe(InvalidJSONError.type);

    const malformedDeleteKey = hubIdempotencyKey();
    keys.push(malformedDeleteKey);
    const malformedDelete = await hub.postRaw(
      "/profile/delete-language",
      "{not json",
      { token, idempotencyKey: malformedDeleteKey },
    );
    expect(malformedDelete.status()).toBe(400);
    expect((await malformedDelete.json()).type).toBe(InvalidJSONError.type);

    // 400 validation-failed: an unrecognized tag is rejected on delete too.
    const invalidDeleteKey = hubIdempotencyKey();
    keys.push(invalidDeleteKey);
    const invalidDelete = await hub.deleteLanguageAbility(
      { ability: "speaking", language_tag: "zh-Hans" },
      { token, idempotencyKey: invalidDeleteKey },
    );
    expect(invalidDelete.status()).toBe(400);
    const invalidDeleteBody = await invalidDelete.json();
    expect(invalidDeleteBody.type).toBe(ValidationFailedError.type);
    expect(invalidDeleteBody.fields).toContain("language_tag");

    // 409: deleting an ability/tag the user never added is a conflict.
    const missingDeleteKey = hubIdempotencyKey();
    keys.push(missingDeleteKey);
    const missingDelete = await hub.deleteLanguageAbility(
      { ability: "writing", language_tag: "fr" },
      { token, idempotencyKey: missingDeleteKey },
    );
    expect(missingDelete.status()).toBe(409);
    expect((await missingDelete.json()).type).toBe(ProfileConflictError.type);

    // 409 idempotency-key-conflict: replaying a key with a different body.
    const reusedKey = hubIdempotencyKey();
    keys.push(reusedKey);
    const firstAdd = await hub.addLanguageAbility(
      { ability: "reading", language_tag: "de" },
      { token, idempotencyKey: reusedKey },
    );
    expect(firstAdd.status(), await firstAdd.text()).toBe(204);
    const conflictingReplay = await hub.addLanguageAbility(
      { ability: "reading", language_tag: "es" },
      { token, idempotencyKey: reusedKey },
    );
    expect(conflictingReplay.status()).toBe(409);
    expect((await conflictingReplay.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );

    // The delete ledger is keyed by its own operation, so it conflicts
    // independently of the add above.
    const reusedDeleteKey = hubIdempotencyKey();
    keys.push(reusedDeleteKey);
    const firstDelete = await hub.deleteLanguageAbility(
      { ability: "reading", language_tag: "de" },
      { token, idempotencyKey: reusedDeleteKey },
    );
    expect(firstDelete.status(), await firstDelete.text()).toBe(204);
    const conflictingDeleteReplay = await hub.deleteLanguageAbility(
      { ability: "reading", language_tag: "es" },
      { token, idempotencyKey: reusedDeleteKey },
    );
    expect(conflictingDeleteReplay.status()).toBe(409);
    expect((await conflictingDeleteReplay.json()).type).toBe(
      IdempotencyKeyConflictError.type,
    );
  } finally {
    cleanupHubUser(accountEmail, "sgp");
    cleanupHubIdempotency(keys, "sgp");
    cleanupHubSignupDomain(accountDomain, "sgp");
  }
});
