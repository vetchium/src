// Everyone who appears in the demo, in one place. The story, the setup, and
// the title bar of each window read their names, addresses, and colors from
// here.
import { join } from "node:path";
import { HERE } from "./stack.ts";

/** Each run on one stack needs its own names; the final run uses none. */
export const RUN = process.env.DEMO_RUN ?? "";
const suffix = RUN === "" ? "" : `-${RUN}`;

/** Every file a run writes: state, fixtures, frames, timeline, video. */
export const RUN_DIR = join(HERE, "out", RUN === "" ? "final" : RUN);

export const HOGWARTS = `hogwarts${suffix}.test`;
export const OLLIVANDERS = `ollivanders${suffix}.test`;
/** The Hub users' mail domain, on the sgp Hub signup allowlist. */
export const OWLPOST = "owlpost.test";
/** Employer and school domains on Hub profiles; never a run's Org. */
export const SCHOOL = "hogwarts.test";

export interface OrgUser {
  domain: string;
  email: string;
  displayName: string;
}

export const ALBUS: OrgUser = {
  domain: HOGWARTS,
  email: `albus.dumbledore@${HOGWARTS}`,
  displayName: "Albus Dumbledore",
};
export const MINERVA: OrgUser = {
  domain: HOGWARTS,
  email: `minerva.mcgonagall@${HOGWARTS}`,
  displayName: "Minerva McGonagall",
};
export const SEVERUS: OrgUser = {
  domain: HOGWARTS,
  email: `severus.snape@${HOGWARTS}`,
  displayName: "Severus Snape",
};
export const GARRICK: OrgUser = {
  domain: OLLIVANDERS,
  email: `garrick@${OLLIVANDERS}`,
  displayName: "Garrick Ollivander",
};

export type HubName = "hermione" | "ron" | "draco";

export const hubEmail = (local: string) =>
  `${local}${RUN === "" ? "" : `.${RUN}`}@${OWLPOST}`;

export const HUB_USERS: Record<
  HubName,
  { displayName: string; email: string }
> = {
  hermione: {
    displayName: "Hermione Granger",
    email: hubEmail("hermione.granger"),
  },
  ron: { displayName: "Ron Weasley", email: hubEmail("ron.weasley") },
  draco: { displayName: "Draco Malfoy", email: hubEmail("draco.malfoy") },
};

/** The alias the agency types to find Hermione; aliases are global. */
export const HERMIONE_ALIAS = `hermione${RUN.replace(/[^a-z0-9]/g, "")}`;

/** A primary color key the Hub and Orgs portals offer (AppProviders.tsx). */
export type PortalColor = "geekblue" | "purple" | "magenta" | "volcano";

/** Ant Design's seed for each offered key, for the title bar and cast card. */
const SEED: Record<PortalColor, string> = {
  geekblue: "#2f54eb",
  purple: "#722ed1",
  magenta: "#eb2f96",
  volcano: "#fa541c",
};

/** A recorded window: who is signed in, shown in the title bar above it. */
export interface Role {
  id: string;
  title: string;
  subtitle: string;
  /** What this person does in the story, for the cast card. */
  part: string;
  accent: string;
  color: PortalColor;
  theme: "light" | "dark";
}

const role = (
  id: string,
  title: string,
  subtitle: string,
  part: string,
  color: PortalColor,
  theme: "light" | "dark",
): Role => ({
  id,
  title,
  subtitle,
  part,
  accent: SEED[color],
  color,
  theme,
});

// Within the video, every person has a different color and mode pair.
export const ROLES = {
  albus: role(
    "albus",
    ALBUS.displayName,
    `Hogwarts · Headmaster, approves Openings · ${ALBUS.email}`,
    "Hogwarts · Headmaster and approver",
    "purple",
    "light",
  ),
  minerva: role(
    "minerva",
    MINERVA.displayName,
    `Hogwarts · Recruiter · ${MINERVA.email}`,
    "Hogwarts · Recruiter",
    "volcano",
    "dark",
  ),
  severus: role(
    "severus",
    SEVERUS.displayName,
    `Hogwarts · Interviewer · ${SEVERUS.email}`,
    "Hogwarts · Interviewer",
    "geekblue",
    "dark",
  ),
  garrick: role(
    "garrick",
    GARRICK.displayName,
    `Ollivanders · Sourcing agency · ${GARRICK.email}`,
    "Ollivanders · Sourcing agency",
    "magenta",
    "dark",
  ),
  hermione: role(
    "hermione",
    HUB_USERS.hermione.displayName,
    `Hub user · ${HUB_USERS.hermione.email}`,
    "Hub user · applies through the agency",
    "magenta",
    "light",
  ),
  ron: role(
    "ron",
    HUB_USERS.ron.displayName,
    `Hub user · ${HUB_USERS.ron.email}`,
    "Hub user · applies directly",
    "volcano",
    "light",
  ),
  draco: role(
    "draco",
    HUB_USERS.draco.displayName,
    `Hub user · ${HUB_USERS.draco.email}`,
    "Hub user · applies directly",
    "geekblue",
    "light",
  ),
} as const satisfies Record<string, Role>;
