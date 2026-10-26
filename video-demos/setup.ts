// Off-camera fixtures for one run: the Hogwarts Hub users with full profiles
// (through dev-seed's hub-profiles mode), Hermione's alias, and the
// Gryffindor hiring Org with Minerva and a pipeline template. Sortinghat is
// not created here: its signup is on camera.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  LoginRequest as AdminLoginRequest,
  LoginAuthenticatedResponse as AdminSession,
} from "typespec/admin/auth/login";
import type { CreateRequest as CreateSignupDomainRequest } from "typespec/admin/hub-signup-domains/domains";
import type {
  LoginRequest as HubLoginRequest,
  LoginAuthenticatedResponse as HubSession,
} from "typespec/hub/auth/login";
import type { SetAliasRequest } from "typespec/hub/profile/alias";
import type {
  CompleteSignupRequest,
  currentTermsVersion,
  RequestSignupRequest,
} from "typespec/orgs/auth/signup";
import type { CreatePipelineTemplateRequest } from "typespec/orgs/hiring/pipelines";
import type { SetSubscriptionPlanRequest } from "typespec/orgs/subscriptions/subscriptions";
import type {
  AcceptInvitationRequest,
  InviteUsersRequest,
} from "typespec/orgs/users/invitations";
import {
  ALBUS,
  HERMIONE_ALIAS,
  HOGWARTS,
  HUB_USERS,
  type HubName,
  MINERVA,
  RUN_DIR,
} from "./cast.ts";
import {
  ADMIN,
  API,
  linkToken,
  literal,
  MAILPIT,
  mail,
  orgLogin,
  PASSWORD,
  post,
  REPO,
  SGP_ADMIN,
  sql,
} from "./stack.ts";
import { loadState, saveState } from "./state.ts";

// Typed against the contract, so a new terms version fails `typecheck`.
const TERMS: typeof currentTermsVersion = "2026-10-16-placeholder";

/** The dev-seed hub-profiles fixture shape (backend/cmd/dev-seed). */
interface ProfileFixture {
  biography: string;
  plan: "hub-free-tier" | "hub-silver-tier";
  billingInterval?: "month";
  workExperience: {
    employerDomain: string;
    jobTitle: string;
    startMonth: string;
    endMonth?: string;
    location: string;
    description?: string;
  }[];
  education: {
    institutionDomain: string;
    degree: string;
    startMonth: string;
    endMonth: string;
  }[];
  languages: { ability: "speaking" | "writing"; languageTag: string }[];
}

const PROFILES: Record<HubName, ProfileFixture> = {
  hermione: {
    biography:
      "Researcher in defensive magic and magical law. Top of every class at Hogwarts; founder of S.P.E.W. Happiest with a hard problem and a well-stocked library.",
    // An alias needs Silver, and the agency looks Hermione up by hers.
    plan: "hub-silver-tier",
    billingInterval: "month",
    workExperience: [
      {
        employerDomain: "ministry-of-magic.test",
        jobTitle: "Research Associate, Department of Magical Law Enforcement",
        startMonth: "2022-09",
        location: "London",
        description:
          "Drafts reforms on the rights of magical creatures and trains junior Aurors in defensive spells.",
      },
      {
        employerDomain: HOGWARTS,
        jobTitle: "Teaching Assistant, Defence Against the Dark Arts",
        startMonth: "2020-09",
        endMonth: "2022-07",
        location: "Scotland",
      },
    ],
    education: [
      {
        institutionDomain: HOGWARTS,
        degree: "N.E.W.T.s: Defence Against the Dark Arts, Charms, Arithmancy",
        startMonth: "2012-09",
        endMonth: "2019-06",
      },
    ],
    languages: [
      { ability: "speaking", languageTag: "en" },
      { ability: "writing", languageTag: "en" },
      { ability: "speaking", languageTag: "fr" },
    ],
  },
  draco: {
    biography:
      "Seeker, potions enthusiast, and heir to a very old family. Looking for a role worthy of my talents.",
    plan: "hub-free-tier",
    workExperience: [
      {
        employerDomain: "borgin-and-burkes.test",
        jobTitle: "Artefact Appraiser",
        startMonth: "2020-08",
        location: "Knockturn Alley, London",
      },
    ],
    education: [
      {
        institutionDomain: HOGWARTS,
        degree: "N.E.W.T.s: Potions, Transfiguration",
        startMonth: "2012-09",
        endMonth: "2019-06",
      },
    ],
    languages: [{ ability: "speaking", languageTag: "en" }],
  },
  voldemort: {
    biography:
      "Former Head Boy. Extensive hands-on experience with the Dark Arts. Seeking a teaching position at Hogwarts, again.",
    plan: "hub-free-tier",
    workExperience: [
      {
        employerDomain: "borgin-and-burkes.test",
        jobTitle: "Acquisitions Specialist",
        startMonth: "1945-09",
        endMonth: "1955-01",
        location: "London",
      },
    ],
    education: [
      {
        institutionDomain: HOGWARTS,
        degree: "Special Award for Services to the School",
        startMonth: "1938-09",
        endMonth: "1945-06",
      },
    ],
    languages: [
      { ability: "speaking", languageTag: "en" },
      { ability: "speaking", languageTag: "he" },
    ],
  },
};

/** Puts hogwarts.test on the sgp Hub signup allowlist. */
async function allowHogwarts() {
  const admin = await post<AdminSession, AdminLoginRequest>(
    ADMIN,
    "/api/admin/login",
    { email_address: SGP_ADMIN, password: PASSWORD },
  );
  const response = await fetch(`${ADMIN}/api/admin/create-hub-signup-domain`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${admin.session_token}`,
    },
    body: JSON.stringify({
      domain: HOGWARTS,
    } satisfies CreateSignupDomainRequest),
  });
  // 409: an earlier run on this stack already added it.
  if (response.status !== 201 && response.status !== 409) {
    throw new Error(`allowlist ${HOGWARTS}: ${response.status}`);
  }
}

function seedHubUsers() {
  mkdirSync(RUN_DIR, { recursive: true });
  const fixture = join(RUN_DIR, "hub-profiles.json");
  const users = (Object.keys(PROFILES) as HubName[]).map((name) => ({
    ...PROFILES[name],
    email: HUB_USERS[name].email,
    displayName: HUB_USERS[name].displayName,
    preferredLanguage: "en-US",
    residentCountry: "GB",
  }));
  writeFileSync(fixture, JSON.stringify({ users }));
  execFileSync("go", ["run", "./cmd/dev-seed"], {
    cwd: join(REPO, "backend"),
    stdio: "inherit",
    env: {
      ...process.env,
      DEV_SEED_MODE: "hub-profiles",
      DEV_SEED_HUB_ORIGIN: API,
      DEV_SEED_MAILPIT_URL: MAILPIT,
      DEV_SEED_HUB_PROFILES_FILE: fixture,
    },
  });
  const state = loadState();
  for (const name of Object.keys(PROFILES) as HubName[]) {
    state.handles[name] = sql(
      `SELECT handle FROM vetchium.hub_users
       WHERE email_address = ${literal(HUB_USERS[name].email)}`,
    );
  }
  saveState(state);
}

async function setHermioneAlias() {
  const session = await post<HubSession, HubLoginRequest>(
    API,
    "/api/hub/login",
    { email_address: HUB_USERS.hermione.email, password: PASSWORD },
  );
  await post<unknown, SetAliasRequest>(
    API,
    "/api/hub/profile/alias/set",
    { profile_alias: HERMIONE_ALIAS },
    session.session_token,
  );
}

async function signupGryffindor() {
  await post<unknown, RequestSignupRequest>(API, "/api/orgs/request-signup", {
    email_address: ALBUS.email,
    preferred_language: "en-US",
  });
  await post<unknown, CompleteSignupRequest>(API, "/api/orgs/complete-signup", {
    signup_token: linkToken(
      await mail(ALBUS.email, "Complete"),
      "/complete-signup",
    ),
    org_display_name: "Gryffindor",
    org_country: "GB",
    accepted_terms_version: TERMS,
    password: PASSWORD,
  });
  const albus = await orgLogin(ALBUS.domain, ALBUS.email);
  await post<unknown, SetSubscriptionPlanRequest>(
    API,
    "/api/orgs/set-subscription-plan",
    { plan_oid: "org-gold-tier", billing_interval: "month" },
    albus,
  );
  await post<unknown, InviteUsersRequest>(
    API,
    "/api/orgs/invite-users",
    { email_addresses: [MINERVA.email] },
    albus,
  );
  await post<unknown, AcceptInvitationRequest>(
    API,
    "/api/orgs/accept-invitation",
    {
      invitation_token: linkToken(
        await mail(MINERVA.email, "invited to join"),
        "/accept-invitation",
      ),
      password: PASSWORD,
      preferred_language: "en-US",
    },
  );
  await post<unknown, CreatePipelineTemplateRequest>(
    API,
    "/api/orgs/create-pipeline-template",
    {
      name: "Faculty hiring",
      stages: [
        { name: "Application review", kind: "review" },
        { name: "Interview panel", kind: "interview" },
      ],
    },
    albus,
  );
}

await allowHogwarts();
seedHubUsers();
await setHermioneAlias();
await signupGryffindor();
console.log(`setup done; state in ${RUN_DIR}`);
