// The demo story: an agency and a hiring Org take three Hub users from
// application to outcome. Each scene prepares off camera, then records one
// window. DEMO_SCENES=a,b records only those scenes, reusing state.json.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect as baseExpect, chromium, type Locator } from "@playwright/test";
import type {
  ApplicationDetail,
  GetApplicationRequest,
  ScheduleInterviewRequest,
} from "typespec/orgs/applications/applications";
import {
  ALBUS,
  GRYFFINDOR,
  HAT,
  HERMIONE_ALIAS,
  HUB_USERS,
  type HubName,
  MINERVA,
  type OrgUser,
  ROLES,
  RUN_DIR,
  SORTINGHAT,
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
import { CHROMIUM_ARGS, type DemoWindow, Studio } from "./studio.ts";

const expect = baseExpect.configure({ timeout: 15_000 });

const OPENING_TITLE = "Professor of Defence Against the Dark Arts";

rmSync(join(RUN_DIR, "frames"), { recursive: true, force: true });
const browser = await chromium.launch({ args: CHROMIUM_ARGS });
const studio = new Studio(browser, RUN_DIR);
const state = loadState();
const say = (text: string) => studio.caption(text);

const hat = await studio.window(ROLES.hat);
const albus = await studio.window(ROLES.albus);
const hub: Record<HubName, DemoWindow> = {
  hermione: await studio.window(ROLES.hermione),
  draco: await studio.window(ROLES.draco),
  voldemort: await studio.window(ROLES.voldemort),
};
const { hermione, draco, voldemort } = hub;

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
    throw new Error("no Opening yet: record openingCreate first");
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
  `${HUB}/applications/${GRYFFINDOR}/${opening()}/${application(name)}`;

// Scene: the agency signs up and moves to Silver.
async function agencySignup() {
  const p = hat.page;
  await hat.goto(`${ORGS}/signup`);
  await studio.onAir(hat, async () => {
    await say(
      "Sortinghat, a recruitment agency, signs up on the Vetchium Orgs portal.",
    );
    await hat.pause(1800);
    await regionSgp(hat);
    await hat.type(p.getByLabel("Organization domain"), SORTINGHAT);
    await hat.type(
      p.getByLabel("Your email address"),
      HAT.email.slice(0, HAT.email.indexOf("@")),
    );
    await say(
      "An organization is identified by its domain. Vetchium emails a signup link and a DNS record to prove ownership.",
    );
    await hat.pause(1500);
    await hat.click(p.getByRole("button", { name: "Send signup emails" }));
    await expect(p.getByTestId("signup-sent")).toBeVisible();
    await hat.pause(2500);
  });

  const token = linkToken(
    await mail(HAT.email, "Complete"),
    "/complete-signup",
  );
  await hat.goto(`${ORGS}/complete-signup?region=sgp&token=${token}`);
  await studio.onAir(hat, async () => {
    await say(
      "From the emailed link, the agency publishes the TXT record and completes signup.",
    );
    await hat.pause(2000);
    await hat.type(p.getByLabel("Organization name"), "Sortinghat");
    await hat.choose(
      p.getByRole("combobox", { name: "Country" }),
      "United Kingdom",
      { search: true },
    );
    await hat.type(p.getByLabel("New password"), PASSWORD, { delay: 15 });
    await hat.type(p.getByLabel("Confirm password"), PASSWORD, { delay: 15 });
    await hat.click(
      p.getByRole("checkbox", {
        name: "I accept the terms for organizations on this organization's behalf.",
      }),
    );
    await hat.click(
      p.getByRole("button", { name: "Verify domain and create organization" }),
    );
    await expect(p).toHaveURL(new RegExp(`/login\\?domain=${SORTINGHAT}`));
    await hat.pause(1200);
  });

  await orgSignIn(hat, HAT);
  await studio.onAir(hat, async () => {
    await say(
      "Sortinghat is in. Listing services on the marketplace needs the Silver plan or above.",
    );
    await hat.pause(2500);
    await hat.goto(`${ORGS}/plans`);
    await hat.pause(1200);
    await hat.click(
      p.getByRole("button", { name: "Change plan", exact: true }),
    );
    await hat.click(
      p
        .getByTestId("plan-org-silver-tier")
        .getByRole("button", { name: "Upgrade", exact: true }),
    );
    await hat.pause(1200);
    await hat.click(
      p
        .getByRole("dialog")
        .getByRole("button", { name: "Upgrade", exact: true }),
    );
    await expect(p.getByTestId("current-plan")).toContainText("Silver");
    await hat.pause(1500);
  });
}

// Scene: the agency publishes its Sourcing listing.
async function agencyListing() {
  const p = hat.page;
  await ensureOrg(hat, HAT);
  await hat.goto(`${ORGS}/listings`);
  await studio.onAir(hat, async () => {
    await say(
      "On Listings, Sortinghat describes the service it offers: candidate sourcing.",
    );
    await hat.pause(1500);
    const sourcing = p.locator(".ant-card", { hasText: "Sourcing" });
    await hat.click(sourcing.getByRole("button", { name: "Create listing" }));
    await expect(p).toHaveURL(`${ORGS}/listings/sourcing`);
    await hat.type(
      p.getByPlaceholder(
        "E.g., Global Executive Technical Interviewing & Assessment",
      ),
      "Finding the right house for every witch and wizard",
    );
    await hat.typeLong(
      p.getByPlaceholder(
        "Describe your methodology, team credentials, turnaround time",
        { exact: false },
      ),
      "We have read the minds of every Hogwarts student for a thousand years. We find teachers, Aurors, and curse-breakers with the courage, wit, loyalty, or ambition your team needs.\n\n- Shortlists within a week\n- Candidates from all four houses",
    );
    await hat.type(
      p.getByPlaceholder("E.g., $150 per interview", { exact: false }),
      "12% of first-year salary, in Galleons",
    );
    // A multi-select without an accessible name; its search box takes keys.
    await hat.click(
      p.locator(".ant-select").filter({ hasText: "Select languages" }),
    );
    await p.keyboard.type("English", { delay: 40 });
    await hat.click(
      p
        .locator(".ant-select-dropdown:visible .ant-select-item-option")
        .getByText("English", { exact: true }),
    );
    await p.keyboard.press("Escape");
    await hat.pause(800);
    await say(
      "Publishing the listing makes Sortinghat discoverable to every hiring organization on Vetchium.",
    );
    await hat.click(p.getByRole("button", { name: "Publish", exact: true }));
    await expect(p).toHaveURL(`${ORGS}/listings`);
    const listed = sourcing.getByText("Listed", { exact: true });
    await expect(listed).toBeVisible();
    await hat.pointAt(listed);
    await hat.pause(2000);
  });
}

// Scene: the agency looks Hermione up and keeps a private note on her.
async function agencyContactNote() {
  const p = hat.page;
  await ensureOrg(hat, HAT);
  await hat.goto(`${ORGS}/sourcing/contacts`);
  await studio.onAir(hat, async () => {
    await say(
      "A Sourcing workspace now appears. Contacts are the people the agency keeps track of.",
    );
    await hat.pause(2000);
    await hat.click(p.getByRole("button", { name: "New contact" }));
    const dialog = p.getByRole("dialog");
    await say(
      "The agency looks up a Hub user by their public handle or alias.",
    );
    await hat.type(dialog.getByPlaceholder("handle"), HERMIONE_ALIAS);
    await hat.click(dialog.getByRole("button", { name: "View profile" }));
    await expect(
      p.getByRole("heading", { name: HUB_USERS.hermione.displayName }),
    ).toBeVisible();
    await say(
      "Hermione's profile shows live, exactly as Hub users see it. Viewing it is never recorded.",
    );
    await hat.pause(1500);
    await hat.scroll(450);
    await hat.pause(1500);
    await say(
      "Notes are private to the agency. Hermione, the clients, and other agencies never see them.",
    );
    await hat.type(
      p.getByPlaceholder("Add a note for your agency"),
      "Brilliant at Defence Against the Dark Arts. Open to a teaching role. Wants a team that values preparation.",
      { delay: 18 },
    );
    await hat.click(p.getByRole("button", { name: "Add note" }));
    await expect(p).toHaveURL(/\/sourcing\/contacts\/[0-9a-f-]{36}/);
    state.contactURL = p.url();
    await say(
      "The first note creates a Contact for Hermione, shared by everyone at Sortinghat.",
    );
    await hat.pause(2500);
  });
}

// Scene: Gryffindor creates and publishes an Opening.
async function openingCreate() {
  const p = albus.page;
  await ensureOrg(albus, ALBUS);
  await albus.goto(`${ORGS}/openings`);
  await studio.onAir(albus, async () => {
    await say(
      "Meanwhile, Gryffindor needs a new professor. Albus Dumbledore opens the Hiring workspace.",
    );
    await albus.pause(2000);
    await albus.click(p.getByRole("button", { name: /New Opening/ }).first());
    await expect(p.getByRole("heading", { name: "New Opening" })).toBeVisible();
    await say(
      "He describes the role for candidates. A checklist shows what publishing still needs.",
    );
    await albus.type(p.getByRole("textbox", { name: "Title" }), OPENING_TITLE);
    await albus.typeLong(
      p.getByRole("textbox", { name: "Description" }),
      "Gryffindor is looking for a **Professor of Defence Against the Dark Arts** for the coming school year.\n\n- Teach years one to seven\n- Prepare students for their O.W.L.s and N.E.W.T.s\n- Lead the duelling club\n\nApplicants who have previously been refused this post need not apply again.",
    );
    await albus.choose(
      p.getByRole("combobox", { name: "Work arrangement" }),
      "On site",
    );
    await albus.type(
      p.getByRole("textbox", { name: "Location details" }),
      "Hogwarts Castle, Scotland",
    );
    await albus.choose(
      p.getByRole("combobox", { name: "Employment type" }),
      "Full time",
    );
    await albus.type(p.getByLabel("Positions", { exact: true }), "1");
    await albus.type(p.getByLabel("Minimum years", { exact: true }), "3");
    await say(
      "Albus is the hiring manager; Minerva McGonagall recruits. The pipeline starts from a template.",
    );
    await albus.type(
      p.getByLabel("Hiring manager", { exact: true }),
      ALBUS.email,
      {
        delay: 12,
      },
    );
    await p.keyboard.press("Escape");
    await albus.type(
      p.getByLabel("Recruiter", { exact: true }),
      MINERVA.email,
      {
        delay: 12,
      },
    );
    await p.keyboard.press("Escape");
    await albus.choose(
      p.getByRole("combobox", { name: "Start from" }),
      "Faculty hiring",
    );
    await albus.pause(800);
    await albus.click(p.getByRole("tab", { name: "Candidate preview" }));
    await albus.pause(2500);
    await albus.click(p.getByRole("button", { name: "Create draft" }));
    await expect(p).toHaveURL(/\/openings\/\d+$/);
    state.openingNumber = lastPathNumber(p.url());
    saveState(state);
    await albus.pause(1500);
    await say(
      "As a superadmin, Albus can publish directly. Other managers would submit it for approval.",
    );
    await albus.click(p.getByRole("button", { name: "Publish", exact: true }));
    await albus.click(
      p
        .getByRole("dialog")
        .getByRole("button", { name: /^(Confirm|Publish)$/ }),
    );
    await expect(
      p.getByText("Published", { exact: true }).first(),
    ).toBeVisible();
    await albus.pause(2500);
  });
}

// Scene: Gryffindor finds Sortinghat and proposes a sourcing engagement.
async function engagementPropose() {
  const p = albus.page;
  await ensureOrg(albus, ALBUS);
  await albus.goto(`${ORGS}/openings/${opening()}`);
  await studio.onAir(albus, async () => {
    await say(
      "To reach more candidates, Gryffindor looks for a sourcing agency in the marketplace.",
    );
    await albus.pause(1200);
    await albus.click(p.getByRole("menuitem", { name: /Find providers/ }));
    await expect(
      p.getByRole("heading", { name: "Find providers" }),
    ).toBeVisible();
    await albus.pause(1200);
    const card = p.getByText(SORTINGHAT).first();
    await albus.pointAt(card);
    await albus.pause(1500);
    await albus.click(card);
    await expect(
      p.getByRole("button", { name: "Propose engagement" }),
    ).toBeVisible();
    await say(
      "Sortinghat's listing shows its service, coverage, and indicative price. Vetchium never handles fees.",
    );
    await albus.pause(3000);
    await albus.type(
      p.getByPlaceholder("Describe the hiring or candidate needs..."),
      "We need a brave and well-prepared Defence Against the Dark Arts professor by September.",
      { delay: 15 },
    );
    await albus.type(p.getByPlaceholder("PO-2026-…"), "GRY-MSA-1991");
    await albus.click(p.getByRole("button", { name: "Propose engagement" }));
    await expect(p.locator(".ant-tag", { hasText: "Proposed" })).toBeVisible();
    await say(
      "The engagement is proposed. Sortinghat decides whether to take Gryffindor on as a client.",
    );
    await albus.pause(2500);
  });
}

// Scene: Sortinghat accepts its new client.
async function engagementAccept() {
  const p = hat.page;
  await ensureOrg(hat, HAT);
  await hat.goto(`${ORGS}/sourcing/clients`);
  await reloadUntil(hat, p.getByText(GRYFFINDOR).first());
  await studio.onAir(hat, async () => {
    await say(
      "Sortinghat sees Gryffindor's proposal under Clients, with its message and reference.",
    );
    await hat.pause(2500);
    await hat.click(p.getByRole("button", { name: "Accept" }).first());
    await expect(p.getByText("Engagement proposal accepted.")).toBeVisible();
    await say("Accepted. The engagement is now active.");
    await hat.pause(2500);
  });
}

// Scene: Gryffindor assigns Sortinghat to the Opening.
async function agencyAssign() {
  const p = albus.page;
  const sortinghat = p
    .getByRole("dialog")
    .getByRole("radio", { name: new RegExp(SORTINGHAT) });
  await ensureOrg(albus, ALBUS);
  await albus.goto(`${ORGS}/openings/${opening()}?tab=providers`);
  // The accepted engagement reaches Gryffindor asynchronously.
  await expect(async () => {
    await p.reload();
    await p
      .getByRole("button", { name: "Assign agency" })
      .click({ timeout: 2000 });
    await expect(sortinghat).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await p.keyboard.press("Escape");
  await studio.onAir(albus, async () => {
    await say(
      "Back at Gryffindor, Albus assigns Sortinghat to the professor Opening.",
    );
    await albus.pause(1800);
    await albus.click(p.getByRole("button", { name: "Assign agency" }));
    await albus.click(sortinghat);
    const dialog = p.getByRole("dialog");
    await albus.click(dialog.getByRole("button", { name: "Assign" }));
    await expect(dialog).toBeHidden();
    await say(
      "Only applications that name Sortinghat will be credited to it. The agency sees nothing else of Gryffindor's hiring.",
    );
    await albus.pause(3000);
  });
}

// Scene: Sortinghat messages Hermione and suggests the Opening.
async function agencySuggest() {
  const p = hat.page;
  if (!state.contactURL) throw new Error("record agencyContactNote first");
  await ensureOrg(hat, HAT);
  await hat.goto(state.contactURL);
  await studio.onAir(hat, async () => {
    await say(
      "Sortinghat now has a job to fill. Hermione, from its Contacts, looks like a perfect fit.",
    );
    await hat.pause(2000);
    await hat.click(p.getByRole("button", { name: "Send first message" }));
    const dialog = p.getByRole("dialog");
    await hat.type(
      dialog.getByPlaceholder("Write a message"),
      "Hello Hermione! Gryffindor is hiring a Defence Against the Dark Arts professor, and we think you would be brilliant.",
      { delay: 14 },
    );
    await hat.click(dialog.getByRole("button", { name: "Send", exact: true }));
    await expect(dialog).toBeHidden();
    await say(
      "Agencies message Hub users inside Vetchium. Hermione's email address is never shared.",
    );
    await hat.pause(1500);
    await hat.click(p.getByRole("button", { name: "Suggest an Opening" }));
    const suggest = p.getByRole("dialog");
    await hat.click(suggest.locator(".ant-select"));
    await hat.click(
      p.locator(".ant-select-dropdown:visible .ant-select-item-option").first(),
    );
    await hat.pause(800);
    await hat.click(suggest.getByRole("button", { name: "Send suggestion" }));
    await expect(suggest).toBeHidden();
    await say("The suggestion arrives as an Opening card in the conversation.");
    await hat.pause(3000);
  });
}

// Scene: Hermione reads the message and applies through Sortinghat.
async function hermioneApplies() {
  const p = hermione.page;
  await ensureHub("hermione");
  await studio.onAir(hermione, async () => {
    await say("Hermione signs in to the Vetchium Hub and sees a new message.");
    await hermione.pause(2000);
    await hermione.click(p.getByRole("menuitem", { name: /Messages/ }));
    await hermione.click(p.getByText("Sortinghat").first());
    // The card's text also appears in the message preview, so wait on its button.
    await expect(
      p.getByRole("button", { name: "View and apply" }),
    ).toBeVisible();
    await hermione.pause(2500);
    await hermione.type(
      p.getByPlaceholder("Write a reply"),
      "Thank you! Applying right away.",
    );
    await hermione.click(p.getByRole("button", { name: /Send/ }));
    await hermione.pause(1200);
    await hermione.click(p.getByRole("button", { name: "View and apply" }));
    await expect(p.getByText("Referred by")).toBeVisible();
    await say(
      "Because Sortinghat suggested this Opening, it is preselected under Referred by. The choice is Hermione's alone.",
    );
    await hermione.pointAt(p.getByRole("radio", { name: /Sortinghat/ }));
    await hermione.pause(3000);
    await hermione.type(
      p.getByLabel("Cover note"),
      "I have studied defensive magic since my first year, and I would love to teach it.",
      { delay: 16 },
    );
    await hermione.click(p.getByRole("button", { name: "Submit application" }));
    await expect(p).toHaveURL(/\/applications\//);
    state.applications.hermione = lastPathNumber(p.url());
    saveState(state);
    await say(
      "Submitted. Gryffindor will credit this application to Sortinghat.",
    );
    await hermione.pause(3000);
  });
}

async function directApply(
  name: HubName,
  intro: string,
  note: string,
  outro: string,
) {
  const w = hub[name];
  const p = w.page;
  await ensureHub(name);
  await w.goto(`${HUB}/org/${GRYFFINDOR}/openings/${opening()}`);
  await studio.onAir(w, async () => {
    await say(intro);
    await w.pause(2500);
    await w.scroll(300);
    await w.click(p.getByRole("button", { name: "Apply", exact: true }));
    await expect(p.getByRole("heading", { name: "Apply" })).toBeVisible();
    await w.pause(1200);
    await w.type(p.getByLabel("Cover note"), note, { delay: 16 });
    await w.pointAt(p.getByRole("radio", { name: "No agency" }));
    await w.pause(1500);
    await w.click(p.getByRole("button", { name: "Submit application" }));
    await expect(p).toHaveURL(/\/applications\//);
    state.applications[name] = lastPathNumber(p.url());
    saveState(state);
    await say(outro);
    await w.pause(2500);
  });
}

async function dracoApplies() {
  await directApply(
    "draco",
    "Draco Malfoy finds the Opening on Gryffindor's public page and applies directly, without an agency.",
    "My father will hear about it if I am not shortlisted.",
    "A direct application: no agency is credited.",
  );
}

async function voldemortApplies() {
  await directApply(
    "voldemort",
    "Lord Voldemort applies too. Not for the first time.",
    "I have applied for this post before. I trust Gryffindor will see sense this time.",
    "Three applications are in.",
  );
}

// Scene: Gryffindor triages the applicants.
async function triage() {
  const p = albus.page;
  const { hermione: her, draco: him, voldemort: you } = HUB_USERS;
  await ensureOrg(albus, ALBUS);
  await albus.goto(`${ORGS}/openings/${opening()}?tab=applicants`);
  await expect(p.getByText(you.displayName).first()).toBeVisible();
  await studio.onAir(albus, async () => {
    await say(
      "Back at Gryffindor, the Applicants tab lists everyone waiting for a decision.",
    );
    await albus.pause(2500);
    await albus.scroll(320);
    await albus.pointAt(p.getByRole("link", { name: her.displayName }));
    await albus.pause(2500);
    await say(
      "Voldemort is turned down at once: Gryffindor marks him as not progressing.",
    );
    await albus.click(
      p.getByRole("button", {
        name: `Mark ${you.displayName} as not progressing`,
      }),
    );
    await albus.pause(1500);
    await albus.click(
      p
        .getByRole("dialog", {
          name: `Mark ${you.displayName} as not progressing?`,
        })
        .getByRole("button", { name: "Not progressing" }),
    );
    await expect(
      p.getByText(`${you.displayName} is marked as not progressing.`),
    ).toBeVisible();
    await albus.pause(1500);
    await say(
      "Hermione and Draco are shortlisted straight to the interview panel. They become candidates.",
    );
    for (const { displayName } of [her, him]) {
      await albus.click(
        p.getByRole("button", { name: `Shortlist ${displayName}` }),
      );
      const dialog = p.getByRole("dialog", {
        name: `Shortlist ${displayName}`,
      });
      await albus.click(
        dialog.getByRole("radio", { name: /^Interview panel/ }),
      );
      await albus.pause(1200);
      await albus.click(
        dialog.getByRole("button", { name: "Shortlist", exact: true }),
      );
      await expect(
        p.getByText(`${displayName} is now a candidate.`),
      ).toBeVisible();
      await albus.pause(1000);
    }
    await albus.click(p.getByRole("tab", { name: /^Candidates/ }));
    await albus.pause(3000);
  });
}

/** Opens the Opening from the Hub's Closed tab, where every ended
 * application (rejected or hired) is listed. */
async function openClosedApplication(w: DemoWindow) {
  await w.click(w.page.getByRole("tab", { name: /^Closed/ }));
  await w.pause(1500);
  await w.click(w.page.getByText(OPENING_TITLE).first());
}

// Scene: Voldemort sees where he stands.
async function voldemortTracks() {
  await ensureHub("voldemort");
  await awaitHub(voldemort, hubAppURL("voldemort"), "Not selected");
  await voldemort.goto(`${HUB}/applications`);
  await studio.onAir(voldemort, async () => {
    await say(
      "Every applicant can track their own status. Voldemort's application has moved to Closed.",
    );
    await voldemort.pause(2000);
    await openClosedApplication(voldemort);
    await expect(
      voldemort.page.getByText("Not selected").first(),
    ).toBeVisible();
    await say(
      "No stage names, notes, or feedback ever reach the Hub. Only the status.",
    );
    await voldemort.pause(3500);
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

/** Draco's interview is not worth showing twice. */
async function scheduleOffCamera(name: HubName) {
  const token = await orgLogin(ALBUS.domain, ALBUS.email);
  const { version } = await post<ApplicationDetail, GetApplicationRequest>(
    API,
    "/api/orgs/get-application",
    { opening_number: opening(), application_number: application(name) },
    token,
  );
  const start = new Date(Date.now() + 86_400_000);
  start.setUTCHours(6, 0, 0, 0);
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
      video_url: "https://meet.hogwarts.test/dada-panel-2",
      interviewer_emails: [ALBUS.email, MINERVA.email],
    },
    token,
  );
}

// Scene: Gryffindor schedules Hermione's interview.
async function scheduleInterview() {
  const p = albus.page;
  await ensureOrg(albus, ALBUS);
  await albus.goto(appURL("hermione"));
  await studio.onAir(albus, async () => {
    await say(
      "Hermione's application shows her profile snapshot, cover note, and the agency that referred her.",
    );
    await albus.pause(2000);
    await albus.pointAt(p.getByText("Referred by").first());
    await albus.pause(2500);
    await albus.click(p.getByRole("button", { name: "Schedule interview" }));
    const dialog = p.getByRole("dialog", { name: "Schedule an interview" });
    await say(
      "Albus schedules a video interview with himself and Minerva McGonagall on the panel.",
    );
    await albus.setDate(dialog.getByLabel("Start"), tomorrowAt10());
    await albus.type(
      dialog.getByLabel("Meeting link"),
      "https://meet.hogwarts.test/dada-panel",
      { delay: 14 },
    );
    const interviewers = dialog.getByRole("combobox", { name: "Interviewers" });
    for (const { email } of [ALBUS, MINERVA]) {
      await albus.type(interviewers, email, { delay: 10 });
      await interviewers.press("Enter");
      await albus.pause(400);
    }
    // Closes the open interviewers dropdown, which covers the Schedule button.
    await albus.click(dialog.getByText("Stage: Interview panel"));
    await albus.click(
      dialog.getByRole("button", { name: "Schedule", exact: true }),
    );
    await expect(p.getByText("Interview scheduled.").first()).toBeVisible();
    await albus.scroll(250);
    await albus.pause(3000);
  });
  await scheduleOffCamera("draco");
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
  // As if both interviews took place: an interview in the future cannot be
  // marked completed.
  sql(`UPDATE vetchium.org_interviews AS t SET starts_at = now() - interval '2 hours'
       FROM vetchium.org_applications AS a
       JOIN vetchium.org_openings AS o USING (org_opening_id)
       WHERE a.org_application_id = t.org_application_id
         AND o.opening_number = ${opening()}
         AND o.org_did = (SELECT org_did FROM vetchium.org_domains
                          WHERE domain = ${literal(GRYFFINDOR)})`);
}

async function interviewFeedback(recommendation: string, notes: string) {
  const p = albus.page;
  await albus.click(p.getByRole("button", { name: "Mark completed" }));
  await albus.click(
    p
      .getByRole("dialog", { name: /took place/ })
      .getByRole("button", { name: "Mark completed" }),
  );
  await expect(p.getByText("Interview marked as completed.")).toBeVisible();
  await albus.pause(800);
  await albus.click(p.getByRole("button", { name: "Give feedback" }));
  const feedback = p.getByRole("dialog", { name: "Feedback on interview 1" });
  await albus.click(
    feedback.getByRole("radio", { name: recommendation, exact: true }),
  );
  await albus.type(feedback.getByLabel("Notes"), notes, { delay: 12 });
  await albus.click(feedback.getByRole("button", { name: "Submit feedback" }));
  await expect(p.getByText("Feedback submitted.").first()).toBeVisible();
}

// Scene: feedback after the interviews, and a decision on Draco.
async function afterInterviews() {
  const p = albus.page;
  await ensureOrg(albus, ALBUS);
  await albus.goto(appURL("draco"));
  await studio.onAir(albus, async () => {
    await say(
      "After the interviews, Albus records that Draco's interview took place and gives his feedback.",
    );
    await albus.pause(2000);
    await interviewFeedback(
      "No",
      "Talented, but sneered at every question about protecting students.",
    );
    await albus.pause(1500);
    await say(
      "Draco does not progress. Ending a candidacy cancels anything still upcoming.",
    );
    await albus.click(p.getByRole("button", { name: "Not progressing" }));
    await albus.click(
      p
        .getByRole("dialog", {
          name: `Mark ${HUB_USERS.draco.displayName} as not progressing?`,
        })
        .getByRole("button", { name: "Not progressing" }),
    );
    await expect(
      p.getByText(
        "This application has ended, so there is nothing left to do.",
      ),
    ).toBeVisible();
    await albus.pause(2500);
  });
  await albus.goto(appURL("hermione"));
  await studio.onAir(albus, async () => {
    await say("Hermione's panel went brilliantly.");
    await albus.pause(1500);
    await interviewFeedback(
      "Strong yes",
      "Outstanding. Taught the panel two counter-curses we had never seen.",
    );
    await albus.pause(2500);
  });
}

// Scene: Draco sees his result.
async function dracoTracks() {
  await ensureHub("draco");
  await awaitHub(draco, hubAppURL("draco"), "Not selected");
  await draco.goto(`${HUB}/applications`);
  await studio.onAir(draco, async () => {
    await say(
      "Draco reached the interviews, but his application is now Closed: Not selected.",
    );
    await draco.pause(1500);
    await openClosedApplication(draco);
    await expect(draco.page.getByText("Not selected").first()).toBeVisible();
    await draco.pause(3500);
  });
}

async function offerLetter(): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setContent(`<div style="font-family: Georgia, serif; padding: 60px; font-size: 15px; line-height: 1.6">
    <h1 style="color: ${ROLES.albus.accent}">Gryffindor</h1>
    <p>Dear ${HUB_USERS.hermione.displayName},</p>
    <p>We are delighted to offer you the post of <b>${OPENING_TITLE}</b>,
    beginning on the first of September.</p>
    <p>Yours sincerely,<br/>Albus Dumbledore</p></div>`);
  const pdf = await page.pdf({ format: "A4" });
  await page.close();
  return pdf;
}

// Scene: Gryffindor extends an offer to Hermione.
async function extendOffer() {
  const p = albus.page;
  const file = `Gryffindor offer - ${HUB_USERS.hermione.displayName}.pdf`;
  await ensureOrg(albus, ALBUS);
  await albus.goto(appURL("hermione"));
  const letter = await offerLetter();
  await studio.onAir(albus, async () => {
    await say(
      "Gryffindor extends an offer to Hermione, with the letter as a PDF and a date to answer by.",
    );
    await albus.pause(1500);
    await albus.click(p.getByRole("button", { name: "Extend offer" }));
    const dialog = p.getByRole("dialog", { name: "Extend an offer" });
    await dialog.locator('input[type="file"]').setInputFiles({
      name: file,
      mimeType: "application/pdf",
      buffer: letter,
    });
    await expect(dialog.getByText(file)).toBeVisible();
    await albus.pause(800);
    await albus.setDate(
      dialog.getByLabel("Proposed joining date"),
      utcDate(30),
    );
    const respond = dialog.getByLabel("Respond within");
    await albus.click(respond);
    await respond.fill("7");
    await albus.pause(600);
    await albus.click(dialog.getByRole("button", { name: "Extend offer" }));
    await expect(p.getByText("Offer extended.").first()).toBeVisible();
    await albus.pause(2500);
  });
}

// Scene: Hermione accepts the offer.
async function hermioneAccepts() {
  const p = hermione.page;
  await ensureHub("hermione");
  await awaitHub(hermione, hubAppURL("hermione"), "Proposed joining date");
  await studio.onAir(hermione, async () => {
    await say(
      "Hermione's application moves to Offer. She can read the letter and accept or decline.",
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

// Scene: Gryffindor records that Hermione joined.
async function recordJoined() {
  const p = albus.page;
  await ensureOrg(albus, ALBUS);
  await albus.goto(appURL("hermione"));
  await reloadUntil(albus, p.getByRole("button", { name: "Record joined" }));
  await studio.onAir(albus, async () => {
    await say("On her first day, Gryffindor records that Hermione joined.");
    await albus.pause(2000);
    await albus.click(p.getByRole("button", { name: "Record joined" }));
    const dialog = p.getByRole("dialog", { name: "Record joining date" });
    await albus.setDate(dialog.getByLabel("Joined on"), utcDate(0));
    await albus.click(dialog.getByRole("button", { name: "Record joined" }));
    await expect(p.getByText("Joined", { exact: true }).first()).toBeVisible();
    await say("The history keeps every step, from application to joining.");
    await albus.scroll(500);
    await albus.pause(3000);
  });
}

// Scene: Hermione is hired; Sortinghat sees its credited hire.
async function finale() {
  await ensureHub("hermione");
  await awaitHub(hermione, hubAppURL("hermione"), "Joined");
  await hermione.goto(`${HUB}/applications`);
  await studio.onAir(hermione, async () => {
    await say("For Hermione, the application is complete: Joined.");
    await hermione.pause(1500);
    await openClosedApplication(hermione);
    await hermione.pause(3500);
  });
  await ensureOrg(hat, HAT);
  await hat.goto(`${ORGS}/sourcing/credited-applications`);
  await studio.onAir(hat, async () => {
    await say(
      "And Sortinghat sees the result too: its credited application, with Hermione's status, Joined.",
    );
    await hat.pause(3000);
    await hat.pointAt(
      hat.page.getByText(HUB_USERS.hermione.displayName).first(),
    );
    await hat.pause(2000);
    await say(
      "From agency signup to a hire, every party tracked each step on Vetchium.",
    );
    await hat.pause(3500);
  });
}

const SCENES = {
  agencySignup,
  agencyListing,
  agencyContactNote,
  openingCreate,
  engagementPropose,
  engagementAccept,
  agencyAssign,
  agencySuggest,
  hermioneApplies,
  dracoApplies,
  voldemortApplies,
  triage,
  voldemortTracks,
  scheduleInterview,
  hermioneInterview,
  afterInterviews,
  dracoTracks,
  extendOffer,
  hermioneAccepts,
  recordJoined,
  finale,
};

const only = process.env.DEMO_SCENES?.split(",").filter((name) => name !== "");

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
