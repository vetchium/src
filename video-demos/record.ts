// The demo story: Hogwarts hires a Software Architect, partly through the
// Ollivanders sourcing agency, and three Hub users follow their own
// applications. Each scene prepares off camera, then records one window.
// Chapter cards separate the acts. DEMO_SCENES=a,b records only those scenes
// and DEMO_FROM=a resumes from one, reusing state.json.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect as baseExpect, chromium, type Locator } from "@playwright/test";
import type { AcceptInterviewRequest } from "typespec/hub/applications/applications";
import type {
  LoginRequest as HubLoginRequest,
  LoginAuthenticatedResponse as HubSession,
} from "typespec/hub/auth/login";
import type { CriterionAnswer } from "typespec/orgs/applications/answers";
import type {
  ApplicationDetail,
  GetApplicationRequest,
  RecordInterviewOutcomeRequest,
  ScheduleInterviewRequest,
  SubmitInterviewFeedbackRequest,
} from "typespec/orgs/applications/applications";
import type { AcceptInvitationRequest } from "typespec/orgs/users/invitations";
import {
  ALBUS,
  GARRICK,
  HERMIONE_ALIAS,
  HOGWARTS,
  HUB_USERS,
  type HubName,
  MINERVA,
  OLLIVANDERS,
  type OrgUser,
  ROLES,
  RUN_DIR,
  SEVERUS,
} from "./cast.ts";
import {
  API,
  HUB,
  linkToken,
  literal,
  mail,
  ORGS,
  orgLogin,
  PASSWORD,
  post,
  sql,
} from "./stack.ts";
import { loadState, saveState } from "./state.ts";
import { type Card, CHROMIUM_ARGS, type DemoWindow, Studio } from "./studio.ts";

const expect = baseExpect.configure({ timeout: 15_000 });

const OPENING_TITLE = "Software Architect";
const DRAFT_INSTRUCTION =
  "Title: Software Architect. Employed in the United Kingdom; hybrid, based in Edinburgh; full time; one position; at least 10 years of experience; bachelor's degree minimum; salary 140,000 to 180,000 GBP per year. We are Hogwarts, building the student platform and the owl-post delivery network used by millions of students, parents, and staff. Write the description in Markdown with three sections. About the role: set the technical direction for the platform across teams. Responsibilities: design highly available, fault-tolerant services at very large scale; make consistency, partitioning, caching, and data modelling trade-offs; lead design reviews and write design documents; influence without authority and mentor senior and staff engineers; build security and privacy in by design. Requirements: 10+ years building large-scale distributed systems, including several years setting architecture across teams; deep experience with cloud infrastructure, microservices, event-driven systems, and observability; fluency in Java, Go, C++, or Python; BS or MS in Computer Science or equivalent experience. Preferred: running production services on call, cost and performance optimisation, ML or data platforms.";
const INTERVIEW_STAGE = "System design interview";

rmSync(join(RUN_DIR, "frames"), { recursive: true, force: true });
const browser = await chromium.launch({ args: CHROMIUM_ARGS });
const studio = new Studio(browser, RUN_DIR);
const state = loadState();
const say = (text: string) => studio.caption(text);
/** A card stays up as long as a caption of its words would. */
const cardSeconds = (title: string, lines: string[]) =>
  Math.ceil(`${title} ${lines.join(" ")}`.split(/\s+/).length / 2.4 + 1.5);
const chapter = (title: string, lines: string[]) =>
  studio.card({
    title,
    lines,
    seconds: cardSeconds(title, lines),
  } satisfies Card);

const albus = await studio.window(ROLES.albus);
const minerva = await studio.window(ROLES.minerva);
const severus = await studio.window(ROLES.severus);
const garrick = await studio.window(ROLES.garrick);
const hub: Record<HubName, DemoWindow> = {
  hermione: await studio.window(ROLES.hermione),
  ron: await studio.window(ROLES.ron),
  draco: await studio.window(ROLES.draco),
};
const { hermione, ron, draco } = hub;

const signedIn = new Set<DemoWindow>();

async function regionSgp(w: DemoWindow) {
  await w.choose(
    w.page.getByRole("combobox", { name: "Region" }),
    "Singapore (sgp)",
  );
}

async function orgSignIn(w: DemoWindow, user: OrgUser) {
  await w.goto(`${ORGS}/login?domain=${user.domain}`);
  await w.page.getByLabel("Email address").fill(user.email);
  await w.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await regionSgp(w);
  await w.page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    w.page.getByRole("button", { name: /^Account menu for / }),
  ).toBeVisible();
  signedIn.add(w);
}

async function ensureOrg(w: DemoWindow, user: OrgUser) {
  if (!signedIn.has(w)) await orgSignIn(w, user);
}

async function ensureHub(name: HubName) {
  const w = hub[name];
  if (signedIn.has(w)) return;
  await w.goto(`${HUB}/login?region=sgp`);
  await w.page.getByLabel("Email address").fill(HUB_USERS[name].email);
  await w.page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await regionSgp(w);
  await w.page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    w.page.getByRole("heading", { name: /Welcome back/ }),
  ).toBeVisible();
  signedIn.add(w);
}

/** Reloads off camera until `locator` shows: Hub views and agency lists are
 * projections that trail the Org's write by a moment. */
async function reloadUntil(w: DemoWindow, locator: Locator) {
  await expect(async () => {
    await w.page.reload();
    await expect(locator).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
}

async function awaitHub(w: DemoWindow, url: string, text: string) {
  await w.goto(url);
  await reloadUntil(w, w.page.getByText(text).first());
}

const lastPathNumber = (url: string) =>
  Number(new URL(url).pathname.split("/").pop());

function opening(): number {
  if (state.openingNumber === undefined) {
    throw new Error("no Opening yet: record openingDraft first");
  }
  return state.openingNumber;
}

function application(name: HubName): number {
  const number = state.applications[name];
  if (number === undefined) throw new Error(`${name} has not applied yet`);
  return number;
}

const appURL = (name: HubName) =>
  `${ORGS}/openings/${opening()}/applications/${application(name)}`;
const hubAppURL = (name: HubName) =>
  `${HUB}/applications/${HOGWARTS}/${opening()}/${application(name)}`;

const sessions = new Map<string, string>();
async function token(user: OrgUser): Promise<string> {
  const known = sessions.get(user.email);
  if (known) return known;
  const fresh = await orgLogin(user.domain, user.email);
  sessions.set(user.email, fresh);
  return fresh;
}

async function getApplication(name: HubName): Promise<ApplicationDetail> {
  return post<ApplicationDetail, GetApplicationRequest>(
    API,
    "/api/orgs/get-application",
    { opening_number: opening(), application_number: application(name) },
    await token(MINERVA),
  );
}

// ─── Act 1: Hogwarts gets ready to hire ────────────────────────────────────

async function intro() {
  const title = "One hire, seen by everyone involved";
  const lines = [
    "Hogwarts hires a Software Architect with ten years of experience,",
    "partly through Ollivanders, a sourcing agency.",
    "Each person below has their own window, color, and title bar.",
  ];
  // Viewers also read the cast list.
  studio.card({
    title,
    lines,
    cast: true,
    seconds: cardSeconds(title, lines) + 6,
  });
  chapter("1 · The hiring Org gets ready", [
    "Hogwarts on the Vetchium Orgs portal: a team with distinct permissions,",
    "an Opening drafted with AI, and an approval before it goes live",
  ]);
}

// Scene: Albus invites an interviewer and shows the team's permissions.
async function hogwartsTeam() {
  const p = albus.page;
  await ensureOrg(albus, ALBUS);
  await albus.goto(`${ORGS}/members`);
  await studio.onAir(albus, async () => {
    await say(
      "Albus Dumbledore set up Hogwarts on Vetchium. An Org is identified by its verified domain, so only people at hogwarts can join it.",
    );
    await albus.pause(2500);
    await say(
      "Minerva McGonagall is already here: she recruits and engages agencies. Albus invites Severus Snape, who will interview candidates.",
    );
    await albus.click(p.getByRole("button", { name: "Invite people" }));
    const dialog = p.getByRole("dialog", { name: "Invite people" });
    await albus.type(dialog.getByRole("textbox").first(), SEVERUS.email, {
      delay: 14,
    });
    await albus.click(dialog.getByRole("radio", { name: /^Member/ }));
    await say(
      "A role only pre-ticks permissions. A Member can sit on interview panels but cannot change Openings or decide on candidates.",
    );
    await albus.pause(2500);
    await albus.click(dialog.getByRole("button", { name: "Send invitations" }));
    await expect(dialog.getByText("Invited", { exact: true })).toBeVisible();
    await albus.pause(2000);
  });
  await p.keyboard.press("Escape");
  await post<unknown, AcceptInvitationRequest>(
    API,
    "/api/orgs/accept-invitation",
    {
      invitation_token: linkToken(
        await mail(SEVERUS.email, "invited to join"),
        "/accept-invitation",
      ),
      password: PASSWORD,
      preferred_language: "en-US",
    },
  );
  await albus.goto(`${ORGS}/members`);
  await expect(p.getByText(SEVERUS.email).first()).toBeVisible();
  await studio.onAir(albus, async () => {
    await say(
      "Severus accepted the emailed invitation. Each person's permissions are listed, and only a superadmin like Albus can grant approval of Openings.",
    );
    await albus.pointAt(p.getByText(MINERVA.email).first());
    await albus.pause(2000);
    await albus.pointAt(p.getByText(SEVERUS.email).first());
    await albus.pause(2500);
  });
}

// Scene: Minerva picks her color, then drafts the Opening with Thambi.
async function openingDraft() {
  const p = minerva.page;
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(`${ORGS}/`);
  await studio.onAir(minerva, async () => {
    await say(
      "Minerva signs in. Like everyone in this video, she picks her own portal color, so you can always tell whose screen you are watching.",
    );
    await minerva.pause(1500);
    await minerva.click(p.getByRole("button", { name: "Primary color" }));
    await minerva.click(p.getByRole("menuitem", { name: "Red orange" }));
    await minerva.pause(1500);
    await say("She starts a new Opening in the Hiring workspace.");
    await minerva.click(p.getByRole("menuitem", { name: /Openings/ }));
    await minerva.click(p.getByRole("button", { name: /New Opening/ }).first());
    await expect(p.getByRole("heading", { name: "New Opening" })).toBeVisible();
    await minerva.pause(1200);
    await say(
      "Instead of a blank form, she asks Thambi, Vetchium's AI assistant, for a first draft.",
    );
    await minerva.click(p.getByRole("button", { name: "Draft with AI" }));
    await minerva.typeLong(
      p.getByLabel("What should the AI write?"),
      DRAFT_INSTRUCTION,
    );
    await minerva.pause(1500);
    await say(
      "The model runs inside the region that holds Hogwarts' data. Each draft is metered in AI credits.",
    );
    await minerva.click(p.getByRole("button", { name: "Generate draft" }));
    await expect(p.getByText(/^Draft filled in\./)).toBeVisible({
      timeout: 120_000,
    });
    await minerva.pause(1500);
    await say(
      "The draft fills the editor, and nothing is saved yet. Minerva reviews every field, because AI can be wrong.",
    );
    await minerva.pointAt(p.getByText(/^Draft filled in\./));
    await minerva.pause(2500);
    const title = p.getByRole("textbox", { name: "Title" });
    await minerva.click(title);
    await title.fill("");
    await title.pressSequentially(OPENING_TITLE, { delay: 30 });
    await minerva.scroll(350);
    await minerva.pause(1500);
    await minerva.scroll(350);
    const minimum = p.getByLabel("Minimum years", { exact: true });
    await minerva.click(minimum);
    await minimum.fill("10");
    const maximum = p.getByLabel("Maximum years", { exact: true });
    await minerva.click(maximum);
    await maximum.fill("15");
    await minerva.pause(1200);
  });
}

// Scene: the hiring team and pipeline, then a request for approval.
async function openingSubmit() {
  const p = minerva.page;
  await studio.onAir(minerva, async () => {
    await say(
      "The hiring team stays internal: Albus is the hiring manager, Minerva the recruiter.",
    );
    const manager = p.getByLabel("Hiring manager", { exact: true });
    await minerva.pointAt(manager);
    await minerva.type(manager, ALBUS.email, { delay: 12 });
    await p.keyboard.press("Escape");
    const recruiter = p.getByLabel("Recruiter", { exact: true });
    await minerva.type(recruiter, MINERVA.email, { delay: 12 });
    await p.keyboard.press("Escape");
    await say(
      "The pipeline starts from Hogwarts' template: an application review, then a system design interview with a feedback form.",
    );
    await minerva.choose(
      p.getByRole("combobox", { name: "Start from" }),
      "Engineering leadership",
    );
    await minerva.pause(1500);
    await say(
      "Candidate preview shows the Opening exactly as Hub users will see it.",
    );
    await minerva.scrollToTop();
    await minerva.click(p.getByRole("tab", { name: "Candidate preview" }));
    await minerva.pause(2500);
    await minerva.scroll(400);
    await minerva.pause(2000);
    await say(
      "Minerva cannot publish on her own. Her button reads Save and submit for approval.",
    );
    const submit = p.getByRole("button", {
      name: "Save and submit for approval",
    });
    await minerva.pointAt(submit);
    await minerva.pause(1500);
    await minerva.click(submit);
    await expect(p).toHaveURL(/\/openings\/\d+/);
    state.openingNumber = Number(
      new URL(p.url()).pathname.match(/\/openings\/(\d+)/)?.[1],
    );
    saveState(state);
    await expect(p.getByText(/^Pending request/).first()).toBeVisible();
    await minerva.pause(1500);
    await say(
      "The Opening waits as a pending publish request. Its content is frozen until an approver decides.",
    );
    await minerva.pause(2500);
  });
}

// Scene: Albus approves the publish request.
async function openingApprove() {
  const p = albus.page;
  await ensureOrg(albus, ALBUS);
  await albus.goto(`${ORGS}/`);
  await reloadUntil(albus, p.getByText(OPENING_TITLE).first());
  await studio.onAir(albus, async () => {
    await say("On Albus's Home page, the request is waiting for his approval.");
    await albus.pause(2500);
    await albus.click(p.getByText(OPENING_TITLE).first());
    await expect(p.getByRole("button", { name: "Approve" })).toBeVisible();
    await say(
      "He sees who asked, when, and what will go live. He could reject it with a reason instead.",
    );
    await albus.pause(2500);
    await albus.scroll(300);
    await albus.pause(1500);
    await albus.scrollToTop();
    await albus.click(p.getByRole("button", { name: "Approve" }));
    const confirm = p.getByRole("dialog").getByRole("button", {
      name: /^(Approve|Confirm)$/,
    });
    if (await confirm.isVisible().catch(() => false)) {
      await albus.click(confirm);
    }
    await expect(
      p.getByText("Published", { exact: true }).first(),
    ).toBeVisible();
    await say(
      "Approved and published. The history records who requested and who approved it.",
    );
    await albus.pause(3000);
  });
}

// Scene: Albus reviews what AI did in his Org.
async function aiUsage() {
  const p = albus.page;
  await ensureOrg(albus, ALBUS);
  await albus.goto(`${ORGS}/ai`);
  await studio.onAir(albus, async () => {
    await say(
      "Albus also oversees AI. The AI page lists every AI request in the Org: who made it, which model, the tokens, and the credits.",
    );
    await albus.pause(3500);
    await albus.click(
      p.getByRole("button", { name: /^View the prompt and answer/ }).first(),
    );
    await say(
      "He can read Minerva's exact request and Thambi's answer. Both are kept for a limited time for review, then deleted.",
    );
    await albus.pause(3500);
    await albus.scroll(400);
    await albus.pause(2000);
    await p.keyboard.press("Escape");
    await albus.pause(800);
    await albus.click(p.getByRole("tab", { name: "Credits" }));
    await say(
      "Gold includes monthly credits, and packs add more. A superadmin can turn AI off for the whole Org at any time.",
    );
    await albus.pause(3500);
  });
}

// ─── Act 2: an agency joins ────────────────────────────────────────────────

async function actAgency() {
  chapter("2 · A sourcing agency joins", [
    "Ollivanders signs up on the same Orgs portal",
    "and lists the service it offers to hiring Orgs",
  ]);
}

// Scene: the agency signs up and moves to Silver.
async function agencySignup() {
  const p = garrick.page;
  await garrick.goto(`${ORGS}/signup`);
  await studio.onAir(garrick, async () => {
    await say(
      "Garrick Ollivander runs Ollivanders, a recruitment agency. He signs it up on the Vetchium Orgs portal.",
    );
    await garrick.pause(1800);
    await regionSgp(garrick);
    await garrick.type(p.getByLabel("Organization domain"), OLLIVANDERS);
    await garrick.type(
      p.getByLabel("Your email address"),
      GARRICK.email.slice(0, GARRICK.email.indexOf("@")),
    );
    await say(
      "Signup proves control of the domain: a link to a mailbox on it, and a DNS record to publish.",
    );
    await garrick.pause(1500);
    await garrick.click(p.getByRole("button", { name: "Send signup emails" }));
    await expect(p.getByTestId("signup-sent")).toBeVisible();
    await garrick.pause(2500);
  });

  const signupToken = linkToken(
    await mail(GARRICK.email, "Complete"),
    "/complete-signup",
  );
  await garrick.goto(`${ORGS}/complete-signup?region=sgp&token=${signupToken}`);
  await studio.onAir(garrick, async () => {
    await say(
      "From the emailed link, he publishes the TXT record and completes signup.",
    );
    await garrick.pause(2000);
    await garrick.type(p.getByLabel("Organization name"), "Ollivanders");
    await garrick.choose(
      p.getByRole("combobox", { name: "Country" }),
      "United Kingdom",
      { search: true },
    );
    await garrick.type(p.getByLabel("New password"), PASSWORD, { delay: 15 });
    await garrick.type(p.getByLabel("Confirm password"), PASSWORD, {
      delay: 15,
    });
    await garrick.click(
      p.getByRole("checkbox", {
        name: "I accept the terms for organizations on this organization's behalf.",
      }),
    );
    await garrick.click(
      p.getByRole("button", { name: "Verify domain and create organization" }),
    );
    await expect(p).toHaveURL(new RegExp(`/login\\?domain=${OLLIVANDERS}`));
    await garrick.pause(1200);
  });

  await orgSignIn(garrick, GARRICK);
  await studio.onAir(garrick, async () => {
    await say(
      "Ollivanders is in. Offering services on the marketplace needs the Silver plan or above.",
    );
    await garrick.pause(2500);
    await garrick.goto(`${ORGS}/plans`);
    await garrick.pause(1200);
    await garrick.click(
      p.getByRole("button", { name: "Change plan", exact: true }),
    );
    await garrick.click(
      p
        .getByTestId("plan-org-silver-tier")
        .getByRole("button", { name: "Upgrade", exact: true }),
    );
    await garrick.pause(1200);
    await garrick.click(
      p
        .getByRole("dialog")
        .getByRole("button", { name: "Upgrade", exact: true }),
    );
    await expect(p.getByTestId("current-plan")).toContainText("Silver");
    await garrick.pause(1500);
  });
}

// Scene: the agency publishes its Sourcing listing.
async function agencyListing() {
  const p = garrick.page;
  await ensureOrg(garrick, GARRICK);
  await garrick.goto(`${ORGS}/listings`);
  await studio.onAir(garrick, async () => {
    await say(
      "On Listings, Garrick describes the service Ollivanders offers: candidate sourcing.",
    );
    await garrick.pause(1500);
    const sourcing = p.locator(".ant-card", { hasText: "Sourcing" });
    await garrick.click(
      sourcing.getByRole("button", { name: "Create listing" }),
    );
    await expect(p).toHaveURL(`${ORGS}/listings/sourcing`);
    await garrick.type(
      p.getByPlaceholder(
        "E.g., Global Executive Technical Interviewing & Assessment",
      ),
      "The engineer chooses the team: senior technical sourcing",
    );
    await garrick.typeLong(
      p.getByPlaceholder(
        "Describe your methodology, team credentials, turnaround time",
        { exact: false },
      ),
      "For over two thousand years we have matched every witch and wizard with exactly the right wand. Now we match senior engineers and architects with the teams that need them.\n\n- Shortlists within ten days\n- Every candidate personally assessed by Garrick",
    );
    await garrick.type(
      p.getByPlaceholder("E.g., $150 per interview", { exact: false }),
      "15% of first-year salary, in Galleons",
    );
    // A multi-select without an accessible name; its search box takes keys.
    await garrick.click(
      p.locator(".ant-select").filter({ hasText: "Select languages" }),
    );
    await p.keyboard.type("English", { delay: 40 });
    await garrick.click(
      p
        .locator(".ant-select-dropdown:visible .ant-select-item-option")
        .getByText("English", { exact: true }),
    );
    await p.keyboard.press("Escape");
    await garrick.pause(800);
    await say(
      "Publishing the listing makes Ollivanders discoverable to every hiring Org on Vetchium.",
    );
    await garrick.click(
      p.getByRole("button", { name: "Publish", exact: true }),
    );
    await expect(p).toHaveURL(`${ORGS}/listings`);
    const listed = sourcing.getByText("Listed", { exact: true });
    await expect(listed).toBeVisible();
    await garrick.pointAt(listed);
    await garrick.pause(2000);
  });
}

// Scene: the agency looks Hermione up and keeps a private note on her.
async function agencyContactNote() {
  const p = garrick.page;
  await ensureOrg(garrick, GARRICK);
  await garrick.goto(`${ORGS}/sourcing/contacts`);
  await studio.onAir(garrick, async () => {
    await say(
      "A Sourcing workspace now appears. Contacts are the people the agency keeps track of.",
    );
    await garrick.pause(2000);
    await garrick.click(
      p.getByRole("button", { name: "Find a person" }).first(),
    );
    const dialog = p.getByRole("dialog");
    await say(
      "Garrick knows a brilliant architect. He looks her up by her public alias on the Hub.",
    );
    await garrick.type(
      dialog.getByPlaceholder("handle or alias"),
      HERMIONE_ALIAS,
    );
    await garrick.click(dialog.getByRole("button", { name: "View profile" }));
    await expect(
      p.getByRole("heading", { name: HUB_USERS.hermione.displayName }),
    ).toBeVisible();
    await say(
      "Hermione's profile shows exactly as Hub users see it: twelve years at the Ministry, Gringotts, and Flourish and Blotts. Viewing it is never recorded.",
    );
    await garrick.pause(1500);
    await garrick.scroll(450);
    await garrick.pause(2500);
    await say(
      "Notes are private to the agency. Hermione, the agency's clients, and other agencies never see them.",
    );
    await garrick.type(
      p.getByPlaceholder("Add a note for your agency"),
      "Twelve years in distributed systems; designed the Gringotts vault ledger and leads Ministry architecture reviews. Go and Java. Ideal for an architect role; open to hybrid in Scotland.",
      { delay: 16 },
    );
    await garrick.click(p.getByRole("button", { name: "Add note" }));
    await expect(p).toHaveURL(/\/sourcing\/contacts\/[0-9a-z-]+/);
    state.contactURL = p.url();
    saveState(state);
    await say(
      "The first note makes Hermione a Contact, shared by everyone at Ollivanders.",
    );
    await garrick.pause(2500);
  });
}

// ─── Act 3: the hiring Org engages the agency ──────────────────────────────

async function actEngage() {
  chapter("3 · Hogwarts engages the agency", [
    "Found in the marketplace, proposed, accepted, and assigned to one Opening.",
    "Vetchium records the work; prices and invoices stay between the two Orgs",
  ]);
}

// Scene: Hogwarts finds Ollivanders and proposes a sourcing engagement.
async function engagementPropose() {
  const p = minerva.page;
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(`${ORGS}/openings/${opening()}`);
  await studio.onAir(minerva, async () => {
    await say(
      "The Opening is live. To reach more senior candidates, Minerva looks for a sourcing agency.",
    );
    await minerva.pause(1500);
    await minerva.click(p.getByRole("menuitem", { name: /Find providers/ }));
    await expect(
      p.getByRole("heading", { name: "Find providers" }),
    ).toBeVisible();
    await minerva.pause(1200);
    const card = p.getByText(OLLIVANDERS).first();
    await minerva.pointAt(card);
    await minerva.pause(1500);
    await minerva.click(card);
    await expect(
      p.getByRole("button", { name: "Propose engagement" }),
    ).toBeVisible();
    await say(
      "The listing shows the service, the countries served, and an indicative price. Vetchium never handles the fees.",
    );
    await minerva.pause(3000);
    await minerva.type(
      p.getByPlaceholder("Describe the hiring or candidate needs..."),
      "We need a Software Architect with 10+ years in large-scale distributed systems to set the direction for our student and owl-post platform.",
      { delay: 15 },
    );
    await minerva.type(p.getByPlaceholder("PO-2026-…"), "HOG-ENG-0042");
    await minerva.click(p.getByRole("button", { name: "Propose engagement" }));
    await expect(p.locator(".ant-tag", { hasText: "Proposed" })).toBeVisible();
    await say(
      "The engagement is proposed. Ollivanders decides whether to take Hogwarts on as a client.",
    );
    await minerva.pause(2500);
  });
}

// Scene: Ollivanders accepts its new client.
async function engagementAccept() {
  const p = garrick.page;
  await ensureOrg(garrick, GARRICK);
  await garrick.goto(`${ORGS}/sourcing/clients`);
  await reloadUntil(garrick, p.getByText(HOGWARTS).first());
  await studio.onAir(garrick, async () => {
    await say(
      "Garrick sees Hogwarts' proposal under Clients, with its message and purchase order reference.",
    );
    await garrick.pause(2500);
    await garrick.click(p.getByRole("button", { name: "Accept" }).first());
    await expect(p.getByText("Engagement proposal accepted.")).toBeVisible();
    await say("Accepted. Hogwarts is now an active client.");
    await garrick.pause(2500);
  });
}

// Scene: Hogwarts assigns Ollivanders to the Opening.
async function agencyAssign() {
  const p = minerva.page;
  const agency = p
    .getByRole("dialog")
    .getByRole("radio", { name: new RegExp(OLLIVANDERS) });
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(`${ORGS}/openings/${opening()}?tab=providers`);
  // The accepted engagement reaches Hogwarts asynchronously.
  await expect(async () => {
    await p.reload();
    await p
      .getByRole("button", { name: "Assign agency" })
      .click({ timeout: 2000 });
    await expect(agency).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await p.keyboard.press("Escape");
  await studio.onAir(minerva, async () => {
    await say(
      "Back at Hogwarts, Minerva assigns Ollivanders to the Software Architect Opening.",
    );
    await minerva.pause(1800);
    await minerva.click(p.getByRole("button", { name: "Assign agency" }));
    await minerva.click(agency);
    const dialog = p.getByRole("dialog");
    await minerva.click(dialog.getByRole("button", { name: "Assign" }));
    await expect(dialog).toBeHidden();
    await say(
      "The agency sees this one Opening and nothing else of Hogwarts' hiring. Only applicants who name Ollivanders are credited to it.",
    );
    await minerva.pause(3000);
  });
}

// Scene: the Job appears at Ollivanders; Garrick owns it and asks Hermione.
async function agencyJob() {
  const p = garrick.page;
  await ensureOrg(garrick, GARRICK);
  // Jobs open on "Mine"; a new Job has no owner yet.
  await garrick.goto(`${ORGS}/sourcing/jobs?owner=all`);
  await reloadUntil(garrick, p.getByText(OPENING_TITLE).first());
  await garrick.goto(`${ORGS}/sourcing/jobs`);
  await studio.onAir(garrick, async () => {
    await say(
      "At Ollivanders, the Opening arrives as a Job. Garrick's own list is empty: no one owns it yet.",
    );
    await garrick.pause(2500);
    await garrick.click(p.getByText("Everyone's", { exact: true }));
    await expect(p.getByText(OPENING_TITLE).first()).toBeVisible();
    await say(
      "Everyone's Jobs shows it, with the client's name and when it was assigned.",
    );
    await garrick.pause(2500);
    await garrick.click(p.getByText(OPENING_TITLE).first());
    await expect(
      p.getByRole("button", { name: "Send chat request" }),
    ).toBeVisible();
    await say(
      "Garrick reads the Opening as candidates see it, and makes himself the Job's owner. Only his agency sees who owns it.",
    );
    await garrick.pause(2000);
    await garrick.scroll(350);
    await garrick.pause(1500);
    await garrick.scrollToTop();
    await garrick.click(p.getByRole("button", { name: "Change" }));
    await garrick.click(p.getByRole("button", { name: "Assign to me" }));
    await garrick.click(
      p.getByRole("dialog").getByRole("button", { name: "Save" }),
    );
    await expect(p.getByTestId("job-owner")).toContainText(GARRICK.email);
    await garrick.pause(1500);
    await say(
      "He asks Hermione to chat about this Opening. Agencies reach Hub users only about an Opening they recruit for.",
    );
    await garrick.click(p.getByRole("button", { name: "Send chat request" }));
    const dialog = p.getByRole("dialog", { name: "Send chat request" });
    await garrick.type(
      dialog.getByRole("textbox", { name: "Person" }),
      HERMIONE_ALIAS,
    );
    await garrick.pause(800);
    await garrick.type(
      dialog.getByLabel("Note (optional)"),
      "Hello Hermione! Hogwarts is hiring a Software Architect to lead a platform used by millions. Your Gringotts ledger and Ministry work fit it perfectly.",
      { delay: 12 },
    );
    await garrick.pause(800);
    await garrick.click(dialog.getByRole("button", { name: "Send request" }));
    await expect(dialog).toBeHidden();
    await say(
      "Nothing reaches Hermione's inbox or phone. She decides in Vetchium, and her contact details are never shared.",
    );
    await garrick.pause(2500);
  });
}

// ─── Act 4: candidates on the Hub ──────────────────────────────────────────

async function actApply() {
  chapter("4 · Candidates apply on the Hub", [
    "Hermione through the agency; Ron and Draco directly.",
    "Each chooses which agency, if any, gets the credit",
  ]);
}

// Scene: Hermione's own profile on the Hub.
async function hermioneProfile() {
  const p = hermione.page;
  await ensureHub("hermione");
  await hermione.goto(`${HUB}/`);
  await studio.onAir(hermione, async () => {
    await say(
      "Hermione signs in to the Vetchium Hub, the portal for individuals. Her Home page shows what needs her attention.",
    );
    await hermione.pause(2500);
    await hermione.click(p.getByRole("menuitem", { name: /My profile/ }));
    await say(
      "Her profile is her résumé, kept in one place: experience, education, and languages. Every application carries a snapshot of it.",
    );
    await hermione.pause(2500);
    await hermione.scroll(400);
    await hermione.pause(2500);
    await hermione.scroll(400);
    await say(
      "On the Silver plan she also has a memorable alias, which is how Garrick found her.",
    );
    await hermione.pause(3000);
  });
}

// Scene: Hermione accepts the chat request.
async function hermioneAcceptsRequest() {
  const p = hermione.page;
  await ensureHub("hermione");
  await awaitHub(hermione, `${HUB}/messages`, "Asks to chat about an Opening");
  await studio.onAir(hermione, async () => {
    await say(
      "In Messages, a chat request from Ollivanders is waiting for her answer.",
    );
    await hermione.pause(2000);
    await hermione.click(p.getByText("Ollivanders").first());
    const accept = p.getByRole("button", { name: "Accept", exact: true });
    await expect(accept).toBeVisible();
    await say(
      "It names the agency, the Opening, and Garrick's note. She may accept, or decline for this Opening or for a while.",
    );
    await hermione.pause(3000);
    await hermione.click(accept);
    await expect(p.getByPlaceholder("Write a reply")).toBeVisible();
    await say(
      "Accepted. Ollivanders and Hermione can now write to each other.",
    );
    await hermione.pause(2500);
  });
}

// Scene: Garrick suggests the Opening in the open conversation.
async function agencySuggests() {
  const p = garrick.page;
  if (!state.contactURL) throw new Error("record agencyContactNote first");
  const composer = p.getByPlaceholder("Write a message");
  await ensureOrg(garrick, GARRICK);
  await garrick.goto(state.contactURL);
  await reloadUntil(garrick, composer);
  await studio.onAir(garrick, async () => {
    await say(
      "On Hermione's Contact page, the conversation is open, beside the agency's private notes.",
    );
    await garrick.pause(2000);
    await garrick.type(
      composer,
      "Wonderful! The Opening is in the card above. The interview is a system design session; bring your ledger story.",
      { delay: 12 },
    );
    await garrick.click(p.getByRole("button", { name: /Send$/ }));
    await expect(composer).toHaveValue("");
    await garrick.pause(2500);
  });
}

// Scene: Hermione reads the message and applies through Ollivanders.
async function hermioneApplies() {
  const p = hermione.page;
  await ensureHub("hermione");
  await awaitHub(hermione, `${HUB}/messages`, "Ollivanders");
  await studio.onAir(hermione, async () => {
    await say("Hermione reads Garrick's reply.");
    await hermione.pause(1500);
    await hermione.click(p.getByText("Ollivanders").first());
    // The card's text also appears in the message preview, so wait on its button.
    await expect(
      p.getByRole("button", { name: "View and apply" }),
    ).toBeVisible();
    await hermione.pause(2500);
    await hermione.type(
      p.getByPlaceholder("Write a reply"),
      "Thank you, Mr Ollivander! Applying right away.",
    );
    await hermione.click(p.getByRole("button", { name: /Send/ }));
    await hermione.pause(1200);
    await hermione.click(p.getByRole("button", { name: "View and apply" }));
    await expect(
      p.locator("#apply-referral").getByText("Referred by"),
    ).toBeVisible();
    await say(
      "Because Ollivanders suggested this Opening, it is preselected under Referred by. The choice is Hermione's alone, and it is fixed once she applies.",
    );
    await hermione.pointAt(p.getByRole("radio", { name: /Ollivanders/ }));
    await hermione.pause(3500);
    await hermione.type(
      p.getByLabel("Cover note"),
      "I have set the architecture for the Ministry's case platform across six teams and designed the Gringotts vault ledger. I would love to do the same for Hogwarts.",
      { delay: 14 },
    );
    await say(
      "Her application carries a snapshot of her Hub profile, so she types no résumé.",
    );
    await hermione.click(p.getByRole("button", { name: "Submit application" }));
    await expect(p).toHaveURL(/\/applications\//);
    state.applications.hermione = lastPathNumber(p.url());
    saveState(state);
    await say(
      "Submitted. Hogwarts will credit this application to Ollivanders.",
    );
    await hermione.pause(3000);
  });
}

async function directApply(
  name: HubName,
  lines: { find: string; note: string; done: string },
) {
  const w = hub[name];
  const p = w.page;
  await ensureHub(name);
  await w.goto(`${HUB}/org/${HOGWARTS}`);
  await expect(p.getByText(OPENING_TITLE).first()).toBeVisible();
  await studio.onAir(w, async () => {
    await say(lines.find);
    await w.pause(2500);
    await w.click(p.getByRole("link", { name: OPENING_TITLE }).first());
    await expect(
      p.getByRole("button", { name: "Apply", exact: true }),
    ).toBeVisible();
    await w.pause(1500);
    await w.scroll(300);
    await w.pause(1200);
    await w.click(p.getByRole("button", { name: "Apply", exact: true }));
    await expect(p.getByRole("heading", { name: "Apply" })).toBeVisible();
    await w.pause(1200);
    await w.type(p.getByLabel("Cover note"), lines.note, { delay: 14 });
    await w.pointAt(p.getByRole("radio", { name: "No agency" }));
    await w.pause(1500);
    await w.click(p.getByRole("button", { name: "Submit application" }));
    await expect(p).toHaveURL(/\/applications\//);
    state.applications[name] = lastPathNumber(p.url());
    saveState(state);
    await say(lines.done);
    await w.pause(2500);
  });
}

async function ronApplies() {
  await directApply("ron", {
    find: "Ron Weasley follows the careers link Hogwarts shares. Its Hub page lists every published Opening.",
    note: "Ten years in engineering; I scaled the Weasleys' Wizard Wheezes store to millions of orders as Head of Engineering. Ready to set architecture at Hogwarts.",
    done: "A direct application: no agency is credited.",
  });
}

async function dracoApplies() {
  await directApply("draco", {
    find: "Draco Malfoy finds the same Opening and applies directly too.",
    note: "Ten years leading development of the Malfoy family systems. My father will hear about it if I am not shortlisted.",
    done: "Three applications are in.",
  });
}

// Scene: the Hub user's own view of an application.
async function ronTracksApplying() {
  const p = ron.page;
  await ensureHub("ron");
  await ron.goto(`${HUB}/applications`);
  await studio.onAir(ron, async () => {
    await say(
      "On the Hub, each applicant tracks their own applications. Ron's reads Applied.",
    );
    await ron.pause(2500);
    await ron.click(p.getByText(OPENING_TITLE).first());
    await ron.pause(2000);
    await say(
      "He sees the Opening as it was when he applied, his cover note, and every status change, but never Hogwarts' internal notes.",
    );
    await ron.scroll(300);
    await ron.pause(2500);
  });
}

// ─── Act 5: Hogwarts hires ─────────────────────────────────────────────────

async function actHire() {
  chapter("5 · Hogwarts processes the applications", [
    "Review, shortlist, interviews with blind feedback,",
    "an offer, and a joining date",
  ]);
}

// Scene: the Opening's own pipeline.
async function pipelineTab() {
  const p = minerva.page;
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(`${ORGS}/openings/${opening()}`);
  await studio.onAir(minerva, async () => {
    await say(
      "Before deciding, Minerva opens the Opening's Pipeline: its own copy of the template, with how many candidates sit at each stage.",
    );
    await minerva.pause(1500);
    await minerva.click(p.getByRole("tab", { name: /Pipeline/ }));
    await minerva.pause(2500);
    const form = p.getByRole("button", {
      name: /Feedback form for System design interview/,
    });
    // A stage whose form has criteria shows it open.
    await expect(form).toHaveAttribute("aria-expanded", "true");
    await minerva.pointAt(form);
    await say(
      "The interview stage carries its feedback form. Pipeline changes apply at once, need no approval, and candidates never see stage names.",
    );
    await minerva.pause(2500);
    await minerva.scroll(300);
    await minerva.pause(3000);
  });
}

// Scene: Hogwarts triages the applicants.
async function triage() {
  const p = minerva.page;
  const { hermione: her, ron: him, draco: other } = HUB_USERS;
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(`${ORGS}/openings/${opening()}?tab=applicants`);
  await reloadUntil(minerva, p.getByText(other.displayName).first());
  await studio.onAir(minerva, async () => {
    await say(
      "At Hogwarts, the Applicants tab lists everyone waiting for a decision, with the agency that referred them.",
    );
    await minerva.pause(2500);
    await minerva.scroll(320);
    await minerva.pointAt(p.getByRole("link", { name: her.displayName }));
    await minerva.pause(2000);
    await minerva.click(p.getByRole("link", { name: other.displayName }));
    await say(
      "Each application holds the profile snapshot and cover note. Minerva reads Draco's.",
    );
    await minerva.pause(2500);
    await minerva.scroll(400);
    await minerva.pause(2500);
    await minerva.page.goBack();
    await minerva.pause(1500);
    await say(
      "Draco has never designed systems at this scale. Minerva marks him as not progressing.",
    );
    await minerva.click(
      p.getByRole("button", {
        name: `Mark ${other.displayName} as not progressing`,
      }),
    );
    await minerva.pause(1500);
    await minerva.click(
      p
        .getByRole("dialog", {
          name: `Mark ${other.displayName} as not progressing?`,
        })
        .getByRole("button", { name: "Not progressing" }),
    );
    await expect(
      p.getByText(`${other.displayName} is marked as not progressing.`),
    ).toBeVisible();
    await minerva.pause(1500);
    await say(
      "Hermione and Ron are shortlisted straight to the system design interview. They become candidates.",
    );
    for (const { displayName } of [her, him]) {
      await minerva.click(
        p.getByRole("button", { name: `Shortlist ${displayName}` }),
      );
      const dialog = p.getByRole("dialog", {
        name: `Shortlist ${displayName}`,
      });
      await minerva.click(
        dialog.getByRole("radio", { name: new RegExp(`^${INTERVIEW_STAGE}`) }),
      );
      await minerva.pause(1000);
      await minerva.click(
        dialog.getByRole("button", { name: "Shortlist", exact: true }),
      );
      await expect(
        p.getByText(`${displayName} is now a candidate.`),
      ).toBeVisible();
      await minerva.pause(800);
    }
    await minerva.click(p.getByRole("tab", { name: /^Candidates/ }));
    await minerva.pause(3000);
  });
}

/** Opens the Opening from the Hub's Closed tab, where every ended
 * application (rejected or hired) is listed. */
async function openClosedApplication(w: DemoWindow) {
  await w.click(w.page.getByRole("tab", { name: /^Closed/ }));
  await w.pause(1500);
  await w.click(w.page.getByText(OPENING_TITLE).first());
}

// Scene: Draco sees where he stands.
async function dracoTracks() {
  await ensureHub("draco");
  await awaitHub(draco, hubAppURL("draco"), "Not selected");
  await draco.goto(`${HUB}/applications`);
  await studio.onAir(draco, async () => {
    await say(
      "Draco learns the outcome at once, instead of waiting for an email that never comes. His application has moved to Closed.",
    );
    await draco.pause(2000);
    await openClosedApplication(draco);
    await expect(draco.page.getByText("Not selected").first()).toBeVisible();
    await say(
      "No stage names, notes, or feedback reach the Hub. Only the status: Not selected.",
    );
    await draco.pause(3500);
  });
}

/** Tomorrow at 10:00 in the browser's zone, as a datetime-local value. */
function tomorrowAt10(): string {
  const date = new Date(Date.now() + 86_400_000);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T10:00`;
}

const utcDate = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Ron's interview is not worth showing twice. */
async function scheduleOffCamera(name: HubName) {
  const { version } = await getApplication(name);
  const start = new Date(Date.now() + 86_400_000);
  start.setUTCHours(7, 0, 0, 0);
  await post<unknown, ScheduleInterviewRequest>(
    API,
    "/api/orgs/schedule-interview",
    {
      opening_number: opening(),
      application_number: application(name),
      version,
      start_time: start.toISOString(),
      duration_minutes: 60,
      mode: "video",
      video_url: "https://meet.hogwarts.test/architect-panel-2",
      interviewer_emails: [SEVERUS.email, MINERVA.email],
    },
    await token(MINERVA),
  );
}

// Scene: Hogwarts schedules Hermione's interview.
async function scheduleInterview() {
  const p = minerva.page;
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(appURL("hermione"));
  await studio.onAir(minerva, async () => {
    await say(
      "Hermione's application shows her profile snapshot, her cover note, and the agency that referred her.",
    );
    await minerva.pause(2000);
    await minerva.pointAt(p.getByText("Referred by").first());
    await minerva.pause(2500);
    await minerva.click(p.getByRole("button", { name: "Schedule interview" }));
    const dialog = p.getByRole("dialog", { name: "Schedule an interview" });
    await say(
      "Minerva schedules a video interview, with Severus Snape and herself on the panel.",
    );
    await minerva.setDate(dialog.getByLabel("Start"), tomorrowAt10());
    await minerva.type(
      dialog.getByLabel("Meeting link"),
      "https://meet.hogwarts.test/architect-panel",
      { delay: 12 },
    );
    const interviewers = dialog.getByRole("combobox", { name: "Interviewers" });
    for (const { email } of [SEVERUS, MINERVA]) {
      await minerva.type(interviewers, email, { delay: 10 });
      await interviewers.press("Enter");
      await minerva.pause(400);
    }
    // Closes the open interviewers dropdown, which covers the Schedule button.
    await minerva.click(dialog.getByText(`Stage: ${INTERVIEW_STAGE}`));
    await minerva.click(
      dialog.getByRole("button", { name: "Schedule", exact: true }),
    );
    await expect(p.getByText("Interview scheduled.").first()).toBeVisible();
    await minerva.scroll(250);
    await minerva.pause(3000);
  });
  await scheduleOffCamera("ron");
}

// Scene: Hermione accepts the interview.
async function hermioneInterview() {
  const p = hermione.page;
  await ensureHub("hermione");
  await awaitHub(hermione, `${HUB}/applications`, "Respond to an interview");
  await studio.onAir(hermione, async () => {
    await say(
      "Hermione's application now reads Interviewing, and an interview is waiting for her answer.",
    );
    await hermione.pause(3000);
    await hermione.click(p.getByText(OPENING_TITLE).first());
    const card = p.locator(".ant-card", { hasText: "Interview 1" }).last();
    await hermione.pointAt(card);
    await hermione.pause(2500);
    await hermione.click(card.getByRole("button", { name: "Accept" }));
    await expect(card.getByText("Accepted")).toBeVisible();
    await say(
      "She accepts. She could also have asked for another time, with a note.",
    );
    await hermione.pause(3000);
  });
}

/** Two days ahead at 14:00 in the browser's zone, as a datetime-local value. */
function inTwoDaysAt14(): string {
  const date = new Date(Date.now() + 2 * 86_400_000);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T14:00`;
}

// Scene: Ron asks for another time.
async function ronAsksAnotherTime() {
  const p = ron.page;
  await ensureHub("ron");
  await awaitHub(ron, hubAppURL("ron"), "Request another time");
  await studio.onAir(ron, async () => {
    await say(
      "Ron is invited to the same interview stage, but the time clashes with a launch at the Wheezes.",
    );
    await ron.pause(2500);
    await ron.click(p.getByRole("button", { name: "Request another time" }));
    const dialog = p.getByRole("dialog", { name: "Request another time" });
    await ron.type(
      dialog.getByLabel("Note to the organization"),
      "We launch a new store that morning. Could we do the afternoon of the day after?",
      { delay: 14 },
    );
    await ron.click(dialog.getByRole("button", { name: "Send request" }));
    await expect(p.getByText("Another time requested").first()).toBeVisible();
    await say(
      "He asks for another time, with a note. No email threads, and no recruiter's phone number needed.",
    );
    await ron.pause(3000);
  });
}

// Scene: Minerva moves Ron's interview.
async function minervaReschedules() {
  const p = minerva.page;
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(appURL("ron"));
  await reloadUntil(minerva, p.getByText(/asked for another time/).first());
  await studio.onAir(minerva, async () => {
    await say("Minerva sees Ron's request and his note on his application.");
    await minerva.pointAt(p.getByText(/asked for another time/).first());
    await minerva.pause(3000);
    await minerva.click(
      p.getByRole("button", { name: "Change", exact: true }).first(),
    );
    const dialog = p.getByRole("dialog", { name: "Change the interview" });
    await minerva.setDate(dialog.getByLabel("Start"), inTwoDaysAt14());
    await minerva.click(dialog.getByRole("button", { name: "Save changes" }));
    await expect(p.getByText(/^Interview updated\./).first()).toBeVisible();
    await say(
      "She moves it to the afternoon he asked for. A new time asks Ron to respond again, and he accepts.",
    );
    await minerva.pause(3000);
  });
  const session = await post<HubSession, HubLoginRequest>(
    API,
    "/api/hub/login",
    { email_address: HUB_USERS.ron.email, password: PASSWORD },
  );
  await post<unknown, AcceptInterviewRequest>(
    API,
    "/api/hub/accept-application-interview",
    {
      domain: HOGWARTS,
      opening_number: opening(),
      application_number: application("ron"),
      interview_number: 1,
    },
    session.session_token,
  );
}

/** Answers every criterion of the interview's stage form. */
function criteriaAnswers(
  detail: ApplicationDetail,
  rating: number,
  trusted: boolean,
): CriterionAnswer[] {
  const form = detail.interviews[0]?.stage.feedback_form ?? [];
  return form.map((criterion) => ({
    criterion_id: criterion.id ?? "",
    value: criterion.type === "yes_no" ? trusted : rating,
  }));
}

/** As if both interviews took place: one in the future cannot be marked
 * completed. Minerva records them and gives her feedback off camera. */
async function interviewsHappen() {
  sql(`UPDATE vetchium.org_interviews AS t SET starts_at = now() - interval '2 hours'
       FROM vetchium.org_applications AS a
       JOIN vetchium.org_openings AS o USING (org_opening_id)
       WHERE a.org_application_id = t.org_application_id
         AND o.opening_number = ${opening()}
         AND o.org_did = (SELECT org_did FROM vetchium.org_domains
                          WHERE domain = ${literal(HOGWARTS)})`);
  const feedback: Record<
    "hermione" | "ron",
    [SubmitInterviewFeedbackRequest["recommendation"], number, boolean, string]
  > = {
    hermione: [
      "strong_yes",
      5,
      true,
      "Designed a multi-region owl-post service with clear partitioning and caching trade-offs, and failure modes we had not considered.",
    ],
    ron: [
      "no",
      3,
      false,
      "Strong leader who has scaled a real store, but the design stayed high level and skipped consistency and the data model.",
    ],
  };
  for (const name of ["hermione", "ron"] as const) {
    const [recommendation, rating, trusted, notes] = feedback[name];
    let detail = await getApplication(name);
    // A resumed rehearsal may have recorded these already.
    if (detail.interviews[0]?.state === "completed") continue;
    await post<unknown, RecordInterviewOutcomeRequest>(
      API,
      "/api/orgs/record-interview-outcome",
      {
        opening_number: opening(),
        application_number: application(name),
        version: detail.version,
        interview_number: 1,
        outcome: "completed",
      },
      await token(MINERVA),
    );
    detail = await getApplication(name);
    await post<unknown, SubmitInterviewFeedbackRequest>(
      API,
      "/api/orgs/submit-interview-feedback",
      {
        opening_number: opening(),
        application_number: application(name),
        version: detail.version,
        interview_number: 1,
        recommendation,
        notes,
        criteria_answers: criteriaAnswers(detail, rating, trusted),
      },
      await token(MINERVA),
    );
  }
  // Ron's second opinion is not worth showing twice either.
  const detail = await getApplication("ron");
  const given = detail.interviews[0]?.feedback ?? [];
  if (given.some((f) => f.interviewer_email === SEVERUS.email)) return;
  await post<unknown, SubmitInterviewFeedbackRequest>(
    API,
    "/api/orgs/submit-interview-feedback",
    {
      opening_number: opening(),
      application_number: application("ron"),
      version: detail.version,
      interview_number: 1,
      recommendation: "no",
      notes:
        "Confident, but could not explain how the system recovers when a region fails mid-delivery.",
      criteria_answers: criteriaAnswers(detail, 2, false),
    },
    await token(SEVERUS),
  );
}

// Scene: Severus gives his feedback without seeing Minerva's first.
async function severusFeedback() {
  const p = severus.page;
  await interviewsHappen();
  await ensureOrg(severus, SEVERUS);
  await severus.goto(`${ORGS}/my-interviews?tab=feedback_due`);
  await reloadUntil(
    severus,
    p.getByText(HUB_USERS.hermione.displayName).first(),
  );
  await severus.goto(`${ORGS}/my-interviews`);
  await studio.onAir(severus, async () => {
    await say(
      "Severus Snape signs in. He is only a Member, but My interviews lists every interview he sits on, with the feedback he owes.",
    );
    await severus.pause(2000);
    await severus.click(p.getByRole("tab", { name: /^Feedback due/ }));
    await expect(
      p.getByText(HUB_USERS.hermione.displayName).first(),
    ).toBeVisible();
    await severus.pause(2500);
    await severus.click(p.getByText(HUB_USERS.hermione.displayName).first());
    await expect(
      p.getByRole("button", { name: "Give feedback" }),
    ).toBeVisible();
    await say(
      "Minerva has already given her feedback, but Severus cannot read it until he submits his own, so hers cannot sway him.",
    );
    await severus.pointAt(
      p.getByText(
        "Give your feedback to read the other interviewers' feedback.",
      ),
    );
    await severus.pause(3000);
    await severus.click(p.getByRole("button", { name: "Give feedback" }));
    const dialog = p.getByRole("dialog", { name: "Feedback on interview 1" });
    await say(
      "The stage's feedback form asks the same questions of every interviewer.",
    );
    for (const criterion of [
      "Designs for scale and for failure",
      "Explains trade-offs clearly",
    ]) {
      await severus.click(
        dialog
          .getByRole("radiogroup", { name: criterion })
          .getByText("5", { exact: true }),
      );
    }
    await severus.click(
      dialog
        .getByRole("radiogroup", {
          name: "Would you trust them with our architecture?",
        })
        .getByText("Yes", { exact: true }),
    );
    await severus.click(
      dialog.getByRole("radio", { name: "Strong yes", exact: true }),
    );
    await severus.type(
      dialog.getByLabel("Notes"),
      "Irritatingly thorough. Her partitioning and failure analysis were better than mine. Hire her.",
      { delay: 14 },
    );
    await severus.click(
      dialog.getByRole("button", { name: "Submit feedback" }),
    );
    await expect(p.getByText(/^Feedback submitted\./).first()).toBeVisible();
    await say(
      "Submitted. Now both interviewers' answers sit side by side, criterion by criterion.",
    );
    await severus.scroll(400);
    await severus.pause(3500);
  });
}

// Scene: Minerva decides on Ron.
async function ronDecision() {
  const p = minerva.page;
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(appURL("ron"));
  await studio.onAir(minerva, async () => {
    await say(
      "Ron's panel agreed: a strong leader, but not this architect role. Minerva compares the feedback.",
    );
    await minerva.pause(1500);
    await minerva.scroll(450);
    await minerva.pause(3000);
    await say(
      "Ron does not progress. Ending a candidacy cancels anything still upcoming.",
    );
    await minerva.scrollToTop();
    await minerva.click(p.getByRole("button", { name: "Not progressing" }));
    await minerva.click(
      p
        .getByRole("dialog", {
          name: `Mark ${HUB_USERS.ron.displayName} as not progressing?`,
        })
        .getByRole("button", { name: "Not progressing" }),
    );
    await expect(
      p.getByText(
        "This application has ended, so there is nothing left to do.",
      ),
    ).toBeVisible();
    await minerva.pause(2500);
  });
}

// Scene: Ron sees his result.
async function ronTracks() {
  await ensureHub("ron");
  await awaitHub(ron, hubAppURL("ron"), "Not selected");
  await ron.goto(`${HUB}/applications`);
  await studio.onAir(ron, async () => {
    await say(
      "Ron reached the interview, and he too knows where he stands: Closed, Not selected.",
    );
    await ron.pause(1500);
    await openClosedApplication(ron);
    await expect(ron.page.getByText("Not selected").first()).toBeVisible();
    await ron.pause(3500);
  });
}

async function offerLetter(): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setContent(`<div style="font-family: Georgia, serif; padding: 60px; font-size: 15px; line-height: 1.6">
    <h1 style="color: ${ROLES.minerva.accent}">Hogwarts</h1>
    <p>Dear ${HUB_USERS.hermione.displayName},</p>
    <p>We are delighted to offer you the post of <b>${OPENING_TITLE}</b>,
    setting the architecture of our student and owl-post platform.</p>
    <p>Yours sincerely,<br/>Minerva McGonagall</p></div>`);
  const pdf = await page.pdf({ format: "A4" });
  await page.close();
  return pdf;
}

// Scene: Hogwarts extends an offer to Hermione.
async function extendOffer() {
  const p = minerva.page;
  const file = `Hogwarts offer - ${HUB_USERS.hermione.displayName}.pdf`;
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(appURL("hermione"));
  const letter = await offerLetter();
  await studio.onAir(minerva, async () => {
    await say(
      "Hermione's panel was unanimous. Minerva extends an offer, with the letter as a PDF and a date to answer by.",
    );
    await minerva.pause(1500);
    await minerva.click(p.getByRole("button", { name: "Extend offer" }));
    const dialog = p.getByRole("dialog", { name: "Extend an offer" });
    await dialog.locator('input[type="file"]').setInputFiles({
      name: file,
      mimeType: "application/pdf",
      buffer: letter,
    });
    await expect(dialog.getByText(file)).toBeVisible();
    await minerva.pause(800);
    await minerva.setDate(
      dialog.getByLabel("Proposed joining date"),
      utcDate(30),
    );
    const respond = dialog.getByLabel("Respond within");
    await minerva.click(respond);
    await respond.fill("7");
    await minerva.pause(600);
    await minerva.click(dialog.getByRole("button", { name: "Extend offer" }));
    await expect(p.getByText("Offer extended.").first()).toBeVisible();
    await minerva.pause(2500);
  });
}

// Scene: Hermione accepts the offer.
async function hermioneAccepts() {
  const p = hermione.page;
  await ensureHub("hermione");
  await awaitHub(hermione, hubAppURL("hermione"), "Proposed joining date");
  await studio.onAir(hermione, async () => {
    await say(
      "Hermione's application moves to Offer. She reads the letter and decides, all in one place.",
    );
    await hermione.pause(2500);
    const card = p.locator(".ant-card", { hasText: "Proposed joining date" });
    await hermione.pointAt(card);
    await hermione.pause(2000);
    await hermione.click(card.getByRole("button", { name: "Accept offer" }));
    await hermione.click(
      p
        .getByRole("dialog", { name: "Accept this offer?" })
        .getByRole("button", { name: "Accept offer" }),
    );
    await expect(card.getByText("Accepted")).toBeVisible();
    await say("Offer accepted.");
    await hermione.pause(2500);
  });
}

// Scene: Hogwarts records that Hermione joined.
async function recordJoined() {
  const p = minerva.page;
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(appURL("hermione"));
  await reloadUntil(minerva, p.getByRole("button", { name: "Record joined" }));
  await studio.onAir(minerva, async () => {
    await say("On her first day, Minerva records that Hermione joined.");
    await minerva.pause(2000);
    await minerva.click(p.getByRole("button", { name: "Record joined" }));
    const dialog = p.getByRole("dialog", { name: "Record joining date" });
    await minerva.setDate(dialog.getByLabel("Joined on"), utcDate(0));
    await minerva.click(dialog.getByRole("button", { name: "Record joined" }));
    await expect(p.getByText("Joined", { exact: true }).first()).toBeVisible();
    await say(
      "The history keeps every step and who took it, from application to joining.",
    );
    await minerva.scroll(500);
    await minerva.pause(3000);
  });
}

// ─── Act 6: where everyone stands ──────────────────────────────────────────

async function actOutcome() {
  chapter("6 · Where everyone stands", [
    "The candidate, the agency, and the hiring Org",
    "each see the outcome from their own side",
  ]);
}

// Scene: Hermione is hired.
async function hermioneJoined() {
  await ensureHub("hermione");
  await awaitHub(hermione, hubAppURL("hermione"), "Joined");
  await hermione.goto(`${HUB}/applications`);
  await studio.onAir(hermione, async () => {
    await say("For Hermione, the application is complete: Joined.");
    await hermione.pause(1500);
    await openClosedApplication(hermione);
    await hermione.pause(2500);
    await say(
      "Every step she went through is listed with its date: applied, interviewing, offer, and joined.",
    );
    await hermione.scroll(400);
    await hermione.pause(3000);
  });
}

// Scene: Ollivanders sees its credited hire and the month's billable facts.
async function agencyCredit() {
  const p = garrick.page;
  await ensureOrg(garrick, GARRICK);
  await garrick.goto(`${ORGS}/sourcing/credited-applications`);
  const handle = state.handles.hermione;
  if (!handle) throw new Error("run setup first");
  const row = p.getByRole("row", { name: new RegExp(handle) });
  await reloadUntil(garrick, row.getByText("Joined"));
  await studio.onAir(garrick, async () => {
    await say(
      "At Ollivanders, Credited applications shows Hermione's application, by her handle, with the same general status she sees: Joined.",
    );
    await garrick.pause(2500);
    await garrick.pointAt(row.getByText("Joined"));
    await garrick.pause(2000);
    await say(
      "Ron and Draco applied directly, so Ollivanders never sees them. Credit was fixed the moment Hermione applied.",
    );
    await garrick.pause(3000);
    await garrick.click(p.getByRole("menuitem", { name: /Clients/ }));
    await garrick.click(
      p
        .getByRole("row", { name: new RegExp(HOGWARTS) })
        .getByText("View", { exact: true }),
    );
    await expect(
      p.getByText("Activity statement — not an invoice").first(),
    ).toBeVisible();
    await garrick.pause(1500);
    await say(
      "The engagement's monthly activity statement lists the billable facts, such as the joining date. It is not an invoice: the two Orgs settle fees between themselves.",
    );
    await garrick.scroll(500);
    await garrick.pause(4000);
  });
}

// Scene: Hogwarts reads the same statement from its side.
async function hogwartsStatement() {
  const p = minerva.page;
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(`${ORGS}/providers`);
  await studio.onAir(minerva, async () => {
    await say(
      "Hogwarts sees the same engagement from its side, under Find providers, Your engagements.",
    );
    await minerva.pause(1500);
    await minerva.click(p.getByRole("tab", { name: "Your engagements" }));
    await minerva.pause(1500);
    await minerva.click(p.getByRole("link", { name: "Ollivanders" }).first());
    await expect(
      p.getByText("Activity statement — not an invoice").first(),
    ).toBeVisible();
    await say(
      "Its activity statement lists exactly the facts Ollivanders sees, so both Orgs start their invoicing from the same record.",
    );
    await minerva.pause(2000);
    await minerva.pointAt(
      p.getByText("Activity statement — not an invoice").first(),
    );
    await minerva.pause(3500);
  });
}

// Scene: Albus closes the filled Opening.
async function openingClose() {
  const p = albus.page;
  await ensureOrg(albus, ALBUS);
  await albus.goto(`${ORGS}/openings/${opening()}`);
  await studio.onAir(albus, async () => {
    await say(
      "The position is filled. As an approver, Albus closes the Opening directly; Minerva would have had to request it.",
    );
    await albus.pause(2000);
    await albus.click(p.getByRole("button", { name: "Close", exact: true }));
    const dialog = p.getByRole("dialog");
    await albus.pause(2000);
    await albus.click(
      dialog.getByRole("button", { name: /^(Close|Confirm)$/ }).last(),
    );
    await expect(p.getByText("Closed", { exact: true }).first()).toBeVisible();
    await say(
      "Closed. Every request, approval, application, and decision stays in the Opening's history.",
    );
    await albus.scroll(600);
    await albus.pause(3500);
  });
}

async function outro() {
  const title = "Hermione is hired";
  const lines = [
    "Hogwarts drafted, approved, and filled the Opening as one team.",
    "Ollivanders found her, and the credit was never in doubt.",
    "Hermione, Ron, and Draco always knew where they stood.",
  ];
  studio.card({ title, lines, seconds: cardSeconds(title, lines) });
}

const SCENES = {
  intro,
  hogwartsTeam,
  openingDraft,
  openingSubmit,
  openingApprove,
  aiUsage,
  actAgency,
  agencySignup,
  agencyListing,
  agencyContactNote,
  actEngage,
  engagementPropose,
  engagementAccept,
  agencyAssign,
  agencyJob,
  actApply,
  hermioneProfile,
  hermioneAcceptsRequest,
  agencySuggests,
  hermioneApplies,
  ronApplies,
  dracoApplies,
  ronTracksApplying,
  actHire,
  pipelineTab,
  triage,
  dracoTracks,
  scheduleInterview,
  hermioneInterview,
  ronAsksAnotherTime,
  minervaReschedules,
  severusFeedback,
  ronDecision,
  ronTracks,
  extendOffer,
  hermioneAccepts,
  recordJoined,
  actOutcome,
  hermioneJoined,
  agencyCredit,
  hogwartsStatement,
  openingClose,
  outro,
};

const names = Object.keys(SCENES);
const from = process.env.DEMO_FROM;
// DEMO_FROM=scene resumes a failed rehearsal: that scene and every later one.
const only =
  from === undefined
    ? process.env.DEMO_SCENES?.split(",").filter((name) => name !== "")
    : names.slice(Math.max(0, names.indexOf(from)));
if (from !== undefined && !names.includes(from)) {
  throw new Error(`unknown scene: ${from}`);
}

try {
  const unknown = only?.filter((name) => !(name in SCENES)) ?? [];
  if (unknown.length > 0) {
    throw new Error(`unknown scenes: ${unknown.join(", ")}`);
  }
  for (const [name, scene] of Object.entries(SCENES)) {
    if (only && !only.includes(name)) continue;
    console.log(`scene ${name}`);
    await scene();
  }
} catch (error) {
  for (const [i, context] of browser.contexts().entries()) {
    for (const page of context.pages()) {
      await page
        .screenshot({ path: join(RUN_DIR, `error-window-${i}.png`) })
        .catch(() => undefined);
    }
  }
  throw error;
} finally {
  saveState(state);
  studio.save();
  await browser.close();
}
