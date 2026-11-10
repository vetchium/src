// Off-camera fixtures for one run: the three Hub users with full profiles and
// pictures (through dev-seed's hub-profiles mode), Hermione's alias, and the
// Hogwarts hiring Org with Minerva, Severus, and AI drafting. Ollivanders and
// the pipeline template are created on camera.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
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
  BuyAICreditPackRequest,
  OrgAITermsVersion,
  SetAISettingsRequest,
} from "typespec/orgs/ai/ai";
import type {
  CompleteSignupRequest,
  currentTermsVersion,
  RequestSignupRequest,
} from "typespec/orgs/auth/signup";
import type {
  ManageCandidacies,
  ManageOpenings,
  ManageProviders,
} from "typespec/orgs/authorization/types";
import type { SetSubscriptionPlanRequest } from "typespec/orgs/subscriptions/subscriptions";
import type {
  AcceptInvitationRequest,
  InviteUsersRequest,
} from "typespec/orgs/users/invitations";
import { writeAvatars } from "./avatars.ts";
import {
  ALBUS,
  HERMIONE_ALIAS,
  HUB_USERS,
  type HubName,
  MINERVA,
  OWLPOST,
  RUN_DIR,
  SCHOOL,
  SEVERUS,
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
const AI_TERMS: typeof OrgAITermsVersion = "ai-2026-10";
// Minerva recruits and also engages agencies for her Openings.
const RECRUITER: [
  typeof ManageOpenings,
  typeof ManageCandidacies,
  typeof ManageProviders,
] = ["org:manage_openings", "org:manage_candidacies", "org:manage_providers"];

/** The dev-seed hub-profiles fixture shape (backend/cmd/dev-seed). */
interface ProfileFixture {
  biography: string;
  // A picture and an alias need Silver.
  plan: "hub-silver-tier";
  billingInterval: "month";
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

// Against the Opening's requirements: Hermione fits best, Ron is solid,
// Draco is weaker.
const PROFILES: Record<HubName, ProfileFixture> = {
  hermione: {
    biography:
      "Software architect with twelve years of building large-scale distributed systems in Go and Java. I set architecture across teams, write the design documents, and mentor senior and staff engineers. Happiest with a hard consistency problem and a well-stocked library.",
    plan: "hub-silver-tier",
    billingInterval: "month",
    workExperience: [
      {
        employerDomain: "ministry-of-magic.test",
        jobTitle: "Principal Engineer, Magical Law Enforcement Platform",
        startMonth: "2019-03",
        location: "London",
        description:
          "Sets the architecture for six teams building the case management platform used by every Auror office: event-driven microservices on the cloud, multi-region failover, audit and privacy by design. Chairs the design review board and mentors staff engineers.",
      },
      {
        employerDomain: "gringotts.test",
        jobTitle: "Senior Software Engineer, Vault Ledger",
        startMonth: "2015-06",
        endMonth: "2019-02",
        location: "Diagon Alley, London",
        description:
          "Designed the distributed, double-entry vault ledger: partitioned by vault, strongly consistent transfers, millions of Galleon movements a day. Led the on-call rotation and halved storage costs.",
      },
      {
        employerDomain: "flourish-and-blotts.test",
        jobTitle: "Software Engineer, Search and Recommendations",
        startMonth: "2013-09",
        endMonth: "2015-05",
        location: "London",
        description:
          "Built the catalogue search and the first recommendation pipeline in Python.",
      },
    ],
    education: [
      {
        institutionDomain: SCHOOL,
        degree: "N.E.W.T.s: Arithmancy, Ancient Runes, Charms",
        startMonth: "2006-09",
        endMonth: "2013-06",
      },
    ],
    languages: [
      { ability: "speaking", languageTag: "en" },
      { ability: "writing", languageTag: "en" },
      { ability: "speaking", languageTag: "fr" },
    ],
  },
  ron: {
    biography:
      "Engineering leader who scaled Weasleys' Wizard Wheezes from one shop to a global online store with millions of orders. Python and Go; strong on teams and delivery. Strategic thinker; ask me about chess.",
    plan: "hub-silver-tier",
    billingInterval: "month",
    workExperience: [
      {
        employerDomain: "weasleys-wizard-wheezes.test",
        jobTitle: "Head of Engineering",
        startMonth: "2017-01",
        location: "Diagon Alley, London",
        description:
          "Leads twenty engineers running the online store, owl-order fulfilment, and the stock system on the cloud. Moved the store from one server to services that handle seasonal peaks.",
      },
      {
        employerDomain: "ministry-of-magic.test",
        jobTitle: "Software Engineer, Auror Office",
        startMonth: "2013-09",
        endMonth: "2016-12",
        location: "London",
        description: "Built internal case tools in Python.",
      },
    ],
    education: [
      {
        institutionDomain: SCHOOL,
        degree: "N.E.W.T.s: Defence Against the Dark Arts, Charms",
        startMonth: "2006-09",
        endMonth: "2013-06",
      },
    ],
    languages: [{ ability: "speaking", languageTag: "en" }],
  },
  draco: {
    biography:
      "Lead developer at a very old family business. Ten years of experience and the finest taste in frameworks. Looking for a role worthy of my talents.",
    plan: "hub-silver-tier",
    billingInterval: "month",
    workExperience: [
      {
        employerDomain: "malfoy-holdings.test",
        jobTitle: "Lead Developer",
        startMonth: "2015-04",
        location: "Wiltshire",
        description:
          "Maintains the family estate's accounting application, a single server and database, with two developers.",
      },
      {
        employerDomain: "borgin-and-burkes.test",
        jobTitle: "Developer, Inventory Systems",
        startMonth: "2013-08",
        endMonth: "2015-03",
        location: "Knockturn Alley, London",
      },
    ],
    education: [
      {
        institutionDomain: SCHOOL,
        degree: "N.E.W.T.s: Potions, Transfiguration",
        startMonth: "2006-09",
        endMonth: "2013-06",
      },
    ],
    languages: [{ ability: "speaking", languageTag: "en" }],
  },
};

/** Puts the Hub users' mail domain on the sgp Hub signup allowlist. */
async function allowOwlPost() {
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
      domain: OWLPOST,
    } satisfies CreateSignupDomainRequest),
  });
  // 409: an earlier run on this stack already added it.
  if (response.status !== 201 && response.status !== 409) {
    throw new Error(`allowlist ${OWLPOST}: ${response.status}`);
  }
}

async function seedHubUsers() {
  mkdirSync(RUN_DIR, { recursive: true });
  const fixture = join(RUN_DIR, "hub-profiles.json");
  // dev-seed resolves each picture beside the fixture file.
  const browser = await chromium.launch();
  const pictures = await writeAvatars(browser, RUN_DIR);
  await browser.close();
  const users = (Object.keys(PROFILES) as HubName[]).map((name) => ({
    ...PROFILES[name],
    profilePicture: pictures[name],
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

async function signupHogwarts() {
  await post<unknown, RequestSignupRequest>(API, "/api/orgs/request-signup", {
    email_address: ALBUS.email,
    preferred_language: "en-US",
  });
  await post<unknown, CompleteSignupRequest>(API, "/api/orgs/complete-signup", {
    signup_token: linkToken(
      await mail(ALBUS.email, "Complete"),
      "/complete-signup",
    ),
    org_display_name: "Hogwarts",
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
  // The monthly grant waits for a worker run; a pack is credited at once.
  await post<unknown, SetAISettingsRequest>(
    API,
    "/api/orgs/set-ai-settings",
    { enabled: true, accept_terms_version: AI_TERMS, policies: [] },
    albus,
  );
  await post<unknown, BuyAICreditPackRequest>(
    API,
    "/api/orgs/buy-ai-credit-pack",
    { pack_id: "credits-100k" },
    albus,
  );
  // Severus is a Member: he only sits on interview panels.
  for (const [user, permissions] of [
    [MINERVA, RECRUITER],
    [SEVERUS, []],
  ] as const) {
    await post<unknown, InviteUsersRequest>(
      API,
      "/api/orgs/invite-users",
      { email_addresses: [user.email], permissions: [...permissions] },
      albus,
    );
    await post<unknown, AcceptInvitationRequest>(
      API,
      "/api/orgs/accept-invitation",
      {
        invitation_token: linkToken(
          await mail(user.email, "invited to join"),
          "/accept-invitation",
        ),
        password: PASSWORD,
        preferred_language: "en-US",
      },
    );
  }
}

await allowOwlPost();
await seedHubUsers();
await setHermioneAlias();
await signupHogwarts();
console.log(`setup done; state in ${RUN_DIR}`);
