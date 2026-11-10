// The demo story: after introducing Vetchium and its two portals, Hogwarts
// hires a Software Architect, partly through the Ollivanders sourcing agency,
// asking every applicant the same questions; three Hub users answer them and
// follow their own applications. Each scene prepares off camera, then records
// one window.
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
  REPO,
  sql,
} from "./stack.ts";
import { loadState, saveState } from "./state.ts";
import { type Card, CHROMIUM_ARGS, type DemoWindow, Studio } from "./studio.ts";

const expect = baseExpect.configure({ timeout: 15_000 });

const OPENING_TITLE = "Software Architect";
const DRAFT_INSTRUCTION =
  "Software Architect for Hogwarts, hybrid in Edinburgh, UK. Full time, one opening, bachelor's degree, 10+ years in large-scale distributed systems. Salary 140,000 to 180,000 GBP per year. They set the technical direction for our student platform and owl-post network, lead design reviews, and mentor senior engineers. Write the description in Markdown with the headings About the role, What you'll do, and What we're looking for.";
const INTERVIEW_STAGE = "System design interview";

/** The Opening's application questions, as Minerva types them. */
const QUESTION = {
  years: "How many years have you designed distributed systems?",
  edinburgh: "Can you work from our Edinburgh office three days a week?",
  clouds: "Which clouds have you run production services on?",
};
const CLOUDS = ["AWS", "Google Cloud", "Azure", "Own data centres"];

/** Each applicant's answers; the clouds question is optional. */
const ANSWERS: Record<
  HubName,
  { years: number; edinburgh: boolean; clouds: string[] }
> = {
  hermione: { years: 12, edinburgh: true, clouds: ["AWS", "Google Cloud"] },
  ron: { years: 8, edinburgh: true, clouds: ["AWS"] },
  draco: { years: 2, edinburgh: false, clouds: [] },
};

rmSync(join(RUN_DIR, "frames"), { recursive: true, force: true });
const browser = await chromium.launch({ args: CHROMIUM_ARGS });
const studio = new Studio(browser, RUN_DIR);
const state = loadState();
const say = (text: string) => studio.caption(text);
const chapter = (title: string, lines: string[]) =>
  studio.card({ title, lines } satisfies Card);
/** A card read aloud as `narration` rather than as its title and lines,
 * which is also captioned. */
const narrated = (card: Card & { narration: string }) => studio.card(card);

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

// ─── Introduction ──────────────────────────────────────────────────────────

/** A person's portal Home page for the portals card, captured off camera in
 * their own window, so it shows their colors and mode. */
async function portalShot(w: DemoWindow, url: string, file: string) {
  await w.goto(url);
  await w.pause(1500);
  const cursor = w.page.locator("#__demo_cursor");
  await cursor.evaluate((c: HTMLElement) => {
    c.style.visibility = "hidden";
  });
  const path = join(RUN_DIR, file);
  await w.page.screenshot({ path });
  await cursor.evaluate((c: HTMLElement) => {
    c.style.visibility = "";
  });
  return path;
}

async function intro() {
  narrated({
    title: "Vetchium",
    lines: [
      "An Open Source jobs platform",
      "Organizations hire people, and agencies help them with the work:",
      "finding candidates, interviewing, background checks, and more",
    ],
    image: join(REPO, "V.png"),
    narration:
      "Vetchium is an Open Source jobs platform. Organizations use it to hire people, and agencies use it to help those organizations with hiring work, like finding candidates, interviewing, and background checks.",
  });
  await ensureHub("hermione");
  await ensureOrg(minerva, MINERVA);
  const hubShot = await portalShot(hermione, `${HUB}/`, "portal-hub.png");
  const orgsShot = await portalShot(minerva, `${ORGS}/`, "portal-orgs.png");
  narrated({
    title: "Two portals",
    lines: ["One for individuals, one for organizations"],
    shots: [
      {
        file: hubShot,
        heading: "Hub, for individuals",
        text: "Hermione Granger's Home page",
      },
      {
        file: orgsShot,
        heading: "Orgs, for organizations",
        text: "Minerva McGonagall's Home page at Hogwarts",
      },
    ],
    narration:
      "Vetchium has two portals. The Hub is for individuals: your profile, Openings, applications, and messages. The Orgs portal is for organizations, both the companies that are hiring and the agencies that help them. Here are two of the people you will meet, each on their own portal.",
  });
  narrated({
    title: "One hire, seen by everyone involved",
    lines: [
      "Hogwarts, a made-up company, needs a Software Architect.",
      "It sets up its hiring stages, writes the Opening, and asks applicants a few questions.",
      "An agency helps find candidates. Three people apply, and one is hired.",
    ],
    narration:
      "Let us take you through an example. Hogwarts, a made-up company, needs a Software Architect. Its recruiter sets up the hiring stages, drafts the Opening with AI, and adds a few questions for applicants. The hiring manager approves it, and Hogwarts brings in Ollivanders, a recruitment agency, to help find candidates. Three people apply on the Hub. Hogwarts compares their answers, interviews two of them, and hires one. You will see each step through the eyes of everyone involved.",
  });
  const castLines = [
    "Each person has their own window, with their name in the bar on top,",
    "and keeps the same colors and light or dark mode all the way through",
  ];
  // Viewers also read the cast list.
  narrated({
    title: "The people in this story",
    lines: castLines,
    cast: true,
    narration: `Here are the people you will meet. ${castLines.join(" ")}.`,
    pauseSeconds: 2,
  });
  chapter("1 · Hogwarts gets ready to hire", [
    "Minerva sets up the hiring stages and drafts the Opening with AI.",
    "She adds questions for applicants, and Albus approves it",
  ]);
}

// Scene: Minerva builds the pipeline template the Opening will copy.
async function pipelineTemplate() {
  const p = minerva.page;
  const stage = INTERVIEW_STAGE;
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(`${ORGS}/`);
  await studio.onAir(minerva, async () => {
    await say(
      "This is Minerva McGonagall, Hogwarts' recruiter, on the Orgs portal. Before she writes the Opening, she decides how Hogwarts will hire for it.",
    );
    await minerva.pause(1500);
    await minerva.click(
      p.getByRole("menuitem", { name: /Pipeline templates/ }),
    );
    const create = p.getByRole("button", { name: "New template" }).first();
    await expect(create).toBeVisible();
    await say(
      "A pipeline is the list of stages every candidate goes through, in order. Hogwarts saves its pipelines as templates, so each Opening can start from one.",
    );
    await minerva.pause(2000);
    await minerva.click(create);
    const drawer = p.getByRole("dialog");
    await minerva.type(
      drawer.locator("#pipeline-template-name"),
      "Engineering leadership",
    );
    await say(
      "The first stage is a review, where someone at Hogwarts reads each application.",
    );
    await minerva.type(
      drawer.getByRole("textbox", { name: "Stage 1 name" }),
      "Application review",
    );
    await minerva.pointAt(
      drawer.getByRole("combobox", { name: "Stage 1 kind" }),
    );
    await minerva.pause(1200);
    await say(
      "Next comes a system design interview. A stage can be a review, an assessment, an interview, or a background check, and a pipeline can have up to fifteen of them.",
    );
    await minerva.click(drawer.getByRole("button", { name: "Add stage" }));
    await minerva.type(
      drawer.getByRole("textbox", { name: "Stage 2 name" }),
      stage,
    );
    await minerva.choose(
      drawer.getByRole("combobox", { name: "Stage 2 kind" }),
      "Interview",
    );
    await minerva.pause(800);
    await say(
      "An interview stage can have a feedback form, so every interviewer answers the same questions. Minerva adds two ratings and a yes or no.",
    );
    const toggle = drawer.getByRole("button", {
      // The arrow icon's label comes first in the name.
      name: new RegExp(`Feedback form for ${stage}`),
    });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await minerva.click(toggle);
    }
    for (const [i, text] of [
      "Designs for scale and for failure",
      "Explains trade-offs clearly",
      "Would you trust them with our architecture?",
    ].entries()) {
      await minerva.click(
        drawer.getByRole("button", { name: "Add criterion" }),
      );
      await minerva.type(
        drawer.getByRole("textbox", {
          name: `Criterion ${i + 1} of ${stage}`,
        }),
        text,
        { delay: 14 },
      );
      if (i === 2) {
        await minerva.choose(
          drawer.getByRole("combobox", {
            name: `Answer type of criterion 3 of ${stage}`,
          }),
          "Yes or no",
        );
      }
      await minerva.click(
        drawer.getByRole("checkbox", { name: "Required" }).nth(i),
      );
    }
    await minerva.pause(800);
    await say(
      "Offers and joining don't need stages of their own. They always come after the last one.",
    );
    await minerva.click(drawer.getByRole("button", { name: "Save template" }));
    await expect(
      p.getByText("Engineering leadership", { exact: true }).first(),
    ).toBeVisible();
    await minerva.pause(1500);
    await say(
      "Every new Opening gets its own copy of a template. Changing that copy later affects only that Opening, and candidates never see the stage names.",
    );
    await minerva.pause(2000);
  });
}

// Scene: Minerva drafts the Opening with Thambi.
async function openingDraft() {
  const p = minerva.page;
  await ensureOrg(minerva, MINERVA);
  await studio.onAir(minerva, async () => {
    await say("Now Minerva starts the Opening itself.");
    await minerva.click(p.getByRole("menuitem", { name: /Openings/ }));
    await minerva.click(p.getByRole("button", { name: /New Opening/ }).first());
    await expect(p.getByRole("heading", { name: "New Opening" })).toBeVisible();
    await minerva.pause(1200);
    await say(
      "Rather than start from a blank form, she gives Thambi, the built-in AI assistant, a few lines about the role.",
    );
    await minerva.click(p.getByRole("button", { name: "Draft with AI" }));
    await minerva.type(
      p.getByLabel("What should the AI write?"),
      DRAFT_INSTRUCTION,
      {
        delay: 8,
      },
    );
    await minerva.pause(1500);
    await say(
      "The AI runs in the same region as Hogwarts' data, and each draft uses a few AI credits.",
    );
    await minerva.click(p.getByRole("button", { name: "Generate draft" }));
    await expect(p.getByText(/^Draft filled in\./)).toBeVisible({
      timeout: 120_000,
    });
    await minerva.pause(1500);
    await say(
      "Thambi fills in the form, but nothing is saved yet. Minerva checks each field, since AI can get things wrong.",
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
    await minerva.pause(800);
    // The local model sometimes misreads the salary; Minerva sets it as asked.
    const salaryMin = p.getByLabel("Minimum salary", { exact: true });
    if (await salaryMin.isVisible()) {
      await minerva.choose(
        p.getByRole("combobox", { name: "Currency" }),
        "GBP",
        { search: true },
      );
      await minerva.click(salaryMin);
      await salaryMin.fill("140000");
      const salaryMax = p.getByLabel("Maximum salary", { exact: true });
      await minerva.click(salaryMax);
      await salaryMax.fill("180000");
      await minerva.choose(
        p.getByRole("combobox", { name: "Salary period" }),
        "per year",
      );
    }
    await minerva.pause(1200);
  });
}

/** The question panel at `index` inside the editor's questions section. */
function questionPanel(index: number): Locator {
  return minerva.page
    .locator(".ant-collapse-item")
    .filter({ has: minerva.page.getByRole("button", { name: "Add question" }) })
    .locator(".ant-collapse-item")
    .nth(index);
}

async function addQuestion(
  index: number,
  text: string,
  type: string,
  required: boolean,
) {
  const p = minerva.page;
  await minerva.click(p.getByRole("button", { name: "Add question" }));
  const panel = questionPanel(index);
  await minerva.type(panel.getByLabel("Question", { exact: true }), text, {
    delay: 14,
  });
  await minerva.choose(
    panel.getByRole("combobox", { name: "Answer type" }),
    type,
  );
  if (required) {
    await minerva.click(panel.getByRole("switch", { name: "Answer required" }));
  }
  return panel;
}

// Scene: Minerva asks every applicant the same questions.
async function openingQuestions() {
  const p = minerva.page;
  await studio.onAir(minerva, async () => {
    await say(
      "Next come the application questions. Hogwarts can ask up to ten, and every applicant answers them when they apply.",
    );
    // A draft with a salary opens every section, this one included.
    const header = p.locator('[data-editor-section="questions"]');
    if (await p.getByRole("button", { name: "Add question" }).isVisible()) {
      await minerva.pointAt(header);
    } else {
      await minerva.click(header);
    }
    await minerva.pause(1500);
    await say(
      "She asks how many years they have designed distributed systems, and whether they can work from Edinburgh. Both need an answer.",
    );
    await addQuestion(0, QUESTION.years, "Whole number", true);
    await addQuestion(1, QUESTION.edinburgh, "Yes or no", true);
    await minerva.pause(800);
    await say(
      "The third question is optional: which clouds have they run production services on?",
    );
    const clouds = await addQuestion(
      2,
      QUESTION.clouds,
      "Several choices",
      false,
    );
    for (const [i, option] of CLOUDS.entries()) {
      if (i >= 2) {
        await minerva.click(clouds.getByRole("button", { name: "Add option" }));
      }
      await minerva.type(
        clouds.getByRole("textbox", { name: `Option ${i + 1}` }),
        option,
        { delay: 20 },
      );
    }
    await minerva.pause(1000);
    await say(
      "The answers are there for the hiring team to read. Vetchium doesn't score applicants or reject anyone based on them.",
    );
    await minerva.pointAt(
      p.getByText(/^Optional\. Ask applicants up to 10 questions/),
    );
    await minerva.pause(2500);
  });
}

// Scene: the hiring team and pipeline, a look at the preview, then a request
// for approval.
async function openingSubmit() {
  const p = minerva.page;
  await studio.onAir(minerva, async () => {
    await say(
      "Albus will be the hiring manager and Minerva the recruiter. Applicants don't see this part.",
    );
    const manager = p.getByLabel("Hiring manager", { exact: true });
    await minerva.pointAt(manager);
    await minerva.type(manager, ALBUS.email, { delay: 12 });
    await p.keyboard.press("Escape");
    const recruiter = p.getByLabel("Recruiter", { exact: true });
    await minerva.type(recruiter, MINERVA.email, { delay: 12 });
    await p.keyboard.press("Escape");
    await say(
      "For the stages, she picks the Engineering leadership template she just made.",
    );
    await minerva.choose(
      p.getByRole("combobox", { name: "Start from" }),
      "Engineering leadership",
    );
    await minerva.pause(1500);
    await say(
      "Before sending it for approval, she opens the candidate preview: the Opening as people on the Hub will see it, written from Thambi's draft.",
    );
    await minerva.scrollToTop();
    await minerva.click(p.getByRole("tab", { name: "Candidate preview" }));
    await minerva.pause(3000);
    await say("She reads through the whole description once more.");
    for (let i = 0; i < 5; i++) {
      await minerva.scroll(260);
      await minerva.pause(2000);
    }
    await minerva.scrollToTop();
    await say(
      "The Application form tab shows the questions applicants will answer.",
    );
    await minerva.click(p.getByText("Application form", { exact: true }));
    await minerva.pause(1500);
    await minerva.scroll(450);
    await minerva.pause(2500);
    await say(
      "Minerva can't publish Openings herself, so her button says Save and submit for approval.",
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
      "The Opening now waits for approval, and its content can't change in the meantime.",
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
    await say(
      "Albus Dumbledore, the hiring manager, approves Openings at Hogwarts. Minerva's request is waiting on his Home page.",
    );
    await albus.pause(2500);
    await albus.click(p.getByText(OPENING_TITLE).first());
    await expect(p.getByRole("button", { name: "Approve" })).toBeVisible();
    await say(
      "He can see who asked, when, and exactly what will go live. If something is off, he can send it back with a reason.",
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
      "He approves it, and the Opening is published. Its history shows who asked for it and who approved it.",
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
      "Albus also keeps an eye on AI use. This page lists every AI request made at Hogwarts: who made it, which model answered, and how many credits it used.",
    );
    await albus.pause(3500);
    await albus.click(
      p.getByRole("button", { name: /^View the prompt and answer/ }).first(),
    );
    await say(
      "He can even read Minerva's request and Thambi's reply. They are kept for a while for review, then deleted.",
    );
    await albus.pause(3500);
    await albus.scroll(400);
    await albus.pause(2000);
    await p.keyboard.press("Escape");
    await albus.pause(800);
    await albus.click(p.getByRole("tab", { name: "Credits" }));
    await say(
      "The Gold plan comes with monthly AI credits, and Hogwarts can buy more. Albus can switch AI off for everyone at any time.",
    );
    await albus.pause(3500);
  });
}

// ─── Act 2: an agency joins ────────────────────────────────────────────────

async function actAgency() {
  chapter("2 · A recruitment agency joins", [
    "Ollivanders signs up on the same Orgs portal",
    "and lists the service it offers",
  ]);
}

// Scene: the agency signs up and moves to Silver.
async function agencySignup() {
  const p = garrick.page;
  await garrick.goto(`${ORGS}/signup`);
  await studio.onAir(garrick, async () => {
    await say(
      "Meet Garrick Ollivander. He runs Ollivanders, a recruitment agency, and he is signing it up on the same Orgs portal.",
    );
    await garrick.pause(1800);
    await regionSgp(garrick);
    await garrick.type(p.getByLabel("Organization domain"), OLLIVANDERS);
    await garrick.type(
      p.getByLabel("Your email address"),
      GARRICK.email.slice(0, GARRICK.email.indexOf("@")),
    );
    await say(
      "To show that Ollivanders owns its domain, Vetchium emails a link to an address on that domain and asks for a DNS record.",
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
      "He opens the link from the email, adds the DNS record, and finishes signing up.",
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
      "Ollivanders is in. To offer services to other organizations it needs the Silver plan, so Garrick upgrades.",
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
      "Under Listings, Garrick describes what Ollivanders offers: finding candidates.",
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
      "Once he publishes it, any organization hiring on Vetchium can find Ollivanders.",
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
      "Garrick now has a Sourcing area. Contacts are the people his agency keeps track of.",
    );
    await garrick.pause(2000);
    await garrick.click(
      p.getByRole("button", { name: "Find a person" }).first(),
    );
    const dialog = p.getByRole("dialog");
    await say(
      "He knows a brilliant architect, and looks her up by the alias she uses on the Hub.",
    );
    await garrick.type(
      dialog.getByPlaceholder("handle or alias"),
      HERMIONE_ALIAS,
    );
    await garrick.click(dialog.getByRole("button", { name: "View profile" }));
    await expect(
      p.getByRole("heading", { name: HUB_USERS.hermione.displayName }),
    ).toBeVisible();
    // The page opens on the agency's Notes; the profile is its own tab.
    await garrick.click(p.getByRole("tab", { name: "Profile", exact: true }));
    await say(
      "Here is Hermione's public profile: twelve years at the Ministry, Gringotts, and Flourish and Blotts. Vetchium doesn't track who views a profile.",
    );
    await garrick.pause(2500);
    await garrick.scroll(450);
    await garrick.pause(2500);
    await garrick.scrollToTop();
    await garrick.click(p.getByRole("tab", { name: "Notes", exact: true }));
    await say(
      "He adds a note. Notes stay inside Ollivanders. Hermione, clients, and other agencies can't see them.",
    );
    await garrick.type(
      p.getByPlaceholder("Add a note for your agency"),
      "Twelve years in distributed systems; designed the Gringotts vault ledger and leads Ministry architecture reviews. Go and Java. Ideal for an architect role; open to hybrid in Scotland.",
      { delay: 16 },
    );
    await garrick.click(p.getByRole("button", { name: "Add note" }));
    await expect(p).toHaveURL(/\/sourcing\/contacts\/[0-9a-z-]+/);
    // Without the tab, the page reopens on the conversation once there is one.
    const contact = new URL(p.url());
    contact.search = "";
    state.contactURL = contact.toString();
    saveState(state);
    await say(
      "With that first note, Hermione becomes a Contact that everyone at Ollivanders can see.",
    );
    await garrick.pause(2500);
  });
}

// ─── Act 3: the hiring Org engages the agency ──────────────────────────────

async function actEngage() {
  chapter("3 · Hogwarts brings in the agency", [
    "Minerva finds Ollivanders and proposes working together on the Opening.",
    "Fees are agreed between the two companies, outside Vetchium",
  ]);
}

// Scene: Hogwarts finds Ollivanders and proposes a sourcing engagement.
async function engagementPropose() {
  const p = minerva.page;
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(`${ORGS}/openings/${opening()}`);
  await studio.onAir(minerva, async () => {
    await say(
      "Back at Hogwarts, the Opening is live. To reach more senior people, Minerva looks for a recruitment agency.",
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
      "Ollivanders' listing shows the service, the countries it covers, and a rough price. Any fees are paid between the two companies, not through Vetchium.",
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
      "She proposes working together. Now it's up to Ollivanders to take Hogwarts on as a client.",
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
      "Garrick sees the proposal under Clients, with Minerva's message and purchase order number.",
    );
    await garrick.pause(2500);
    await garrick.click(p.getByRole("button", { name: "Accept" }).first());
    await expect(p.getByText("Engagement proposal accepted.")).toBeVisible();
    await say("He accepts. Hogwarts is now a client.");
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
    await say("Minerva assigns Ollivanders to the Software Architect Opening.");
    await minerva.pause(1800);
    await minerva.click(p.getByRole("button", { name: "Assign agency" }));
    await minerva.click(agency);
    const dialog = p.getByRole("dialog");
    await minerva.click(dialog.getByRole("button", { name: "Assign" }));
    await expect(dialog).toBeHidden();
    await say(
      "Ollivanders can see this Opening, but nothing else about Hogwarts' hiring. It gets credit only for applicants who say Ollivanders referred them.",
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
      "At Ollivanders, the Opening shows up as a Job. Garrick's own list is empty, because nobody owns it yet.",
    );
    await garrick.pause(2500);
    await garrick.click(p.getByText("Everyone's", { exact: true }));
    await expect(p.getByText(OPENING_TITLE).first()).toBeVisible();
    await say(
      "Under Everyone's, there it is, with the client's name and the date it was assigned.",
    );
    await garrick.pause(2500);
    await garrick.click(p.getByText(OPENING_TITLE).first());
    await expect(
      p.getByRole("button", { name: "Send chat request" }),
    ).toBeVisible();
    await say(
      "Garrick reads the Opening and takes the Job on himself. Only people at Ollivanders see who owns it.",
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
      "He asks Hermione if she'd like to talk about this role. Agencies can only contact Hub users about an Opening they are recruiting for.",
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
      "Hermione won't get an email or a phone call. She'll see the request in Vetchium, and her contact details stay private.",
    );
    await garrick.pause(2500);
  });
}

// ─── Act 4: candidates on the Hub ──────────────────────────────────────────

async function actApply() {
  chapter("4 · People apply on the Hub", [
    "Hermione through Ollivanders, Ron and Draco on their own.",
    "Each of them answers Hogwarts' questions",
  ]);
}

// Scene: Hermione's own profile on the Hub.
async function hermioneProfile() {
  const p = hermione.page;
  await ensureHub("hermione");
  await hermione.goto(`${HUB}/`);
  await studio.onAir(hermione, async () => {
    await say(
      "Now over to Hermione Granger on the Hub, the portal for individuals. Her Home page shows what needs her attention.",
    );
    await hermione.pause(2500);
    await hermione.click(p.getByRole("menuitem", { name: /My profile/ }));
    await say(
      "Her profile works like a résumé, with her picture, experience, education, and languages. When she applies, a copy of it goes along.",
    );
    await hermione.pause(2500);
    await hermione.scroll(400);
    await hermione.pause(2500);
    await hermione.scroll(400);
    await say("She also has a short alias, which is how Garrick found her.");
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
      "In Messages, the chat request from Ollivanders is waiting for her.",
    );
    await hermione.pause(2000);
    await hermione.click(p.getByText("Ollivanders").first());
    const accept = p.getByRole("button", { name: "Accept", exact: true });
    await expect(accept).toBeVisible();
    await say(
      "It shows the agency, the Opening, and Garrick's note. She can accept, or turn it down.",
    );
    await hermione.pause(3000);
    await hermione.click(accept);
    await expect(p.getByPlaceholder("Write a reply")).toBeVisible();
    await say("She accepts, and now the two of them can message each other.");
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
      "On Hermione's Contact page, Garrick sees the conversation right next to his notes.",
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

/** Fills Hogwarts' questions on the Hub apply page. */
async function answerQuestions(w: DemoWindow, name: HubName) {
  const p = w.page;
  const answers = ANSWERS[name];
  await w.type(
    p.getByRole("spinbutton", { name: QUESTION.years }),
    String(answers.years),
  );
  await w.click(
    p
      .getByRole("radiogroup", { name: QUESTION.edinburgh })
      .getByText(answers.edinburgh ? "Yes" : "No", { exact: true }),
  );
  const clouds = p.getByRole("group", { name: QUESTION.clouds });
  if (answers.clouds.length === 0) await w.pointAt(clouds);
  for (const cloud of answers.clouds) {
    await w.click(clouds.getByText(cloud, { exact: true }));
  }
  await w.pause(800);
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
      "Since Ollivanders suggested this Opening, it's already picked under Referred by. Hermione can change that until she applies.",
    );
    await hermione.pointAt(p.getByRole("radio", { name: /Ollivanders/ }));
    await hermione.pause(3500);
    await say(
      "Then she answers Hogwarts' questions: twelve years, yes to Edinburgh, and the clouds she has worked with.",
    );
    await answerQuestions(hermione, "hermione");
    await hermione.type(
      p.getByLabel("Cover note"),
      "I have set the architecture for the Ministry's case platform across six teams and designed the Gringotts vault ledger. I would love to do the same for Hogwarts.",
      { delay: 14 },
    );
    await say(
      "Her profile goes with the application, so there's no résumé to upload.",
    );
    await hermione.click(p.getByRole("button", { name: "Submit application" }));
    await expect(p).toHaveURL(/\/applications\//);
    state.applications.hermione = lastPathNumber(p.url());
    saveState(state);
    await say("Done. Hogwarts will see that Ollivanders referred her.");
    await hermione.pause(3000);
  });
}

async function directApply(
  name: HubName,
  lines: { find: string; answer: string; note: string; done: string },
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
    await say(lines.answer);
    await answerQuestions(w, name);
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
    find: "Ron Weasley comes in through Hogwarts' careers link. Hogwarts' page on the Hub lists all its open roles.",
    answer:
      "Ron gets the same questions: eight years, yes to Edinburgh, and AWS.",
    note: "Ten years in engineering; I scaled the Weasleys' Wizard Wheezes store to millions of orders as Head of Engineering. Ready to set architecture at Hogwarts.",
    done: "He applies on his own, so no agency is involved.",
  });
}

async function dracoApplies() {
  await directApply("draco", {
    find: "Draco Malfoy applies on his own too.",
    answer:
      "Draco puts two years and no to Edinburgh, and skips the optional question.",
    note: "Ten years leading development of the Malfoy family systems. My father will hear about it if I am not shortlisted.",
    done: "That makes three applications.",
  });
}

// Scene: the Hub user's own view of an application.
async function ronTracksApplying() {
  const p = ron.page;
  await ensureHub("ron");
  await ron.goto(`${HUB}/applications`);
  await studio.onAir(ron, async () => {
    await say(
      "Ron can follow his application on the Hub. Right now it says Applied.",
    );
    await ron.pause(2500);
    await ron.click(p.getByText(OPENING_TITLE).first());
    await ron.pause(2000);
    await say(
      "He sees the Opening as it was when he applied, his cover note, and each change of status. Hogwarts' internal notes stay hidden.",
    );
    await ron.scroll(300);
    await ron.pause(2500);
  });
}

// ─── Act 5: Hogwarts hires ─────────────────────────────────────────────────

async function actHire() {
  chapter("5 · Hogwarts decides", [
    "Comparing answers, interviews with independent feedback,",
    "an offer, and a first day",
  ]);
}

// Scene: the Opening's own pipeline.
async function pipelineTab() {
  const p = minerva.page;
  await ensureOrg(minerva, MINERVA);
  await minerva.goto(`${ORGS}/openings/${opening()}`);
  await studio.onAir(minerva, async () => {
    await say(
      "Back at Hogwarts, the Opening's Pipeline tab shows its own copy of the template, and how many candidates are at each stage.",
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
      "The interview stage brought its feedback form along. Minerva could add or rename stages here for this Opening alone, and no approval is needed.",
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
      "The Applicants tab lists everyone waiting for a first decision, and which agency referred them.",
    );
    await minerva.pause(2500);
    await minerva.scroll(320);
    await minerva.pointAt(p.getByRole("link", { name: her.displayName }));
    await minerva.pause(1500);
    await say(
      "Minerva adds two of the answers as columns: years of experience, and Edinburgh.",
    );
    await minerva.click(p.getByRole("combobox", { name: /^Answer columns/ }));
    for (const question of [QUESTION.years, QUESTION.edinburgh]) {
      await minerva.click(
        p
          .locator(".ant-select-dropdown:visible .ant-select-item-option")
          .filter({ hasText: question })
          .first(),
      );
    }
    await p.keyboard.press("Escape");
    await minerva.pause(1200);
    await say(
      "Draco: two years, and no. Ron: eight, and yes. Hermione: twelve, and yes.",
    );
    await minerva.pointAt(p.getByRole("link", { name: other.displayName }));
    await minerva.pause(2500);
    await minerva.pointAt(p.getByRole("link", { name: her.displayName }));
    await minerva.pause(3000);
    await minerva.click(p.getByRole("link", { name: other.displayName }));
    await say(
      "Each application has the profile, the answers, and the cover note. She opens Draco's.",
    );
    await minerva.pause(2000);
    await minerva.pointAt(p.getByText(QUESTION.years).first());
    await minerva.pause(2500);
    await minerva.scroll(400);
    await minerva.pause(2000);
    await minerva.page.goBack();
    await minerva.pause(1500);
    await say(
      "Draco hasn't worked at this scale and can't come to Edinburgh, so Minerva doesn't take him forward.",
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
      "Hermione and Ron go straight to the system design interview. They're now candidates.",
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
      "Draco finds out right away, instead of waiting for an email that never comes. His application is now under Closed.",
    );
    await draco.pause(2000);
    await openClosedApplication(draco);
    await expect(draco.page.getByText("Not selected").first()).toBeVisible();
    await say(
      "He only sees the status, Not selected. Stage names, notes, and feedback stay with Hogwarts.",
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
      "Hermione's application shows her profile, her cover note, and that Ollivanders referred her.",
    );
    await minerva.pause(2000);
    await minerva.pointAt(p.getByText("Referred by").first());
    await minerva.pause(2500);
    await minerva.click(p.getByRole("button", { name: "Schedule interview" }));
    const dialog = p.getByRole("dialog", { name: "Schedule an interview" });
    await say(
      "Minerva schedules a video interview, with Severus Snape and herself as the panel.",
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
      "On the Hub, Hermione's application now says Interviewing, and the interview is waiting for her reply.",
    );
    await hermione.pause(3000);
    await hermione.click(p.getByText(OPENING_TITLE).first());
    const card = p.locator(".ant-card", { hasText: "Interview 1" }).last();
    await hermione.pointAt(card);
    await hermione.pause(2500);
    await hermione.click(card.getByRole("button", { name: "Accept" }));
    await expect(card.getByText("Accepted")).toBeVisible();
    await say("She accepts. She could also have asked for a different time.");
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
      "Ron is invited too, but the time clashes with a product launch at the Wheezes.",
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
      "So he asks for another time and leaves a note. No back-and-forth emails needed.",
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
    await say("Minerva sees Ron's request and his note.");
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
      "She moves it to the afternoon he suggested. Ron is asked to confirm the new time, and he does.",
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
      "Severus Snape is a regular Member at Hogwarts. My interviews shows the interviews he is on, and the feedback he still owes.",
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
      "Minerva has already written her feedback, but Severus can't see it until he submits his own. That way, hers can't sway him.",
    );
    await severus.pointAt(
      p.getByText(
        "Give your feedback to read the other interviewers' feedback.",
      ),
    );
    await severus.pause(3000);
    await severus.click(p.getByRole("button", { name: "Give feedback" }));
    const dialog = p.getByRole("dialog", { name: "Feedback on interview 1" });
    await say("He fills in the feedback form Minerva set up for this stage.");
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
    await say("Once he submits, both sets of feedback appear side by side.");
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
      "For Ron, both interviewers agreed: a strong leader, but not the right fit for this role.",
    );
    await minerva.pause(1500);
    await minerva.scroll(450);
    await minerva.pause(3000);
    await say(
      "Minerva doesn't take him forward, and anything still scheduled for him is cancelled.",
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
      "Ron knows where he stands, too: his application is Closed, Not selected.",
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
      "Both interviewers loved Hermione. Minerva sends her an offer, with the letter attached and a date to reply by.",
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
      "Hermione sees the offer on the Hub. She can read the letter and reply in one place.",
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
    await say("She accepts.");
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
    await say("On her first day, Minerva marks Hermione as joined.");
    await minerva.pause(2000);
    await minerva.click(p.getByRole("button", { name: "Record joined" }));
    const dialog = p.getByRole("dialog", { name: "Record joining date" });
    await minerva.setDate(dialog.getByLabel("Joined on"), utcDate(0));
    await minerva.click(dialog.getByRole("button", { name: "Record joined" }));
    await expect(p.getByText("Joined", { exact: true }).first()).toBeVisible();
    await say(
      "The history shows every step, and who took it, from application to joining.",
    );
    await minerva.scroll(500);
    await minerva.pause(3000);
  });
}

// ─── Act 6: where everyone stands ──────────────────────────────────────────

async function actOutcome() {
  chapter("6 · How it ends for everyone", [
    "Hermione, Ollivanders, and Hogwarts",
    "each see the result from their own side",
  ]);
}

// Scene: Hermione is hired.
async function hermioneJoined() {
  await ensureHub("hermione");
  await awaitHub(hermione, hubAppURL("hermione"), "Joined");
  await hermione.goto(`${HUB}/applications`);
  await studio.onAir(hermione, async () => {
    await say("For Hermione, the application is now complete: Joined.");
    await hermione.pause(1500);
    await openClosedApplication(hermione);
    await hermione.pause(2500);
    await say(
      "She can see every step with its date: applied, interviewing, offer, and joined.",
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
      "At Ollivanders, Credited applications lists Hermione's application by her handle, with the same status she sees: Joined.",
    );
    await garrick.pause(2500);
    await garrick.pointAt(row.getByText("Joined"));
    await garrick.pause(2000);
    await say(
      "Ron and Draco applied on their own, so Ollivanders doesn't see them at all.",
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
      "Each month there's an activity statement of what happened, like Hermione's joining date. It isn't an invoice; the two companies sort out payment themselves.",
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
      "Hogwarts sees the same engagement from its side, under Find providers.",
    );
    await minerva.pause(1500);
    await minerva.click(p.getByRole("tab", { name: "Your engagements" }));
    await minerva.pause(1500);
    await minerva.click(p.getByRole("link", { name: "Ollivanders" }).first());
    await expect(
      p.getByText("Activity statement — not an invoice").first(),
    ).toBeVisible();
    await say(
      "Its activity statement shows the same facts, so both sides work from the same record.",
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
      "The role is filled. Albus is an approver, so he can close the Opening himself.",
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
      "It's closed. The Opening's history keeps every request, approval, application, and decision.",
    );
    await albus.scroll(600);
    await albus.pause(3500);
  });
}

async function outro() {
  chapter("Hermione got the job", [
    "Hogwarts ran the whole hire in one place, from the first draft to her first day.",
    "Ollivanders found her, and is credited for it.",
    "Ron and Draco always knew where they stood, too.",
    "Vetchium is Open Source. Thanks for watching.",
  ]);
}

const SCENES = {
  intro,
  pipelineTemplate,
  openingDraft,
  openingQuestions,
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
