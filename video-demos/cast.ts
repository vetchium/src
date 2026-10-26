// Everyone who appears in the demo, in one place. The story, the setup, and
// the title bar of each window read their names and addresses from here.
import { join } from "node:path";
import { HERE } from "./stack.ts";

/** Each run on one stack needs its own names; the final run uses none. */
export const RUN = process.env.DEMO_RUN ?? "";
const suffix = RUN === "" ? "" : `-${RUN}`;

/** Every file a run writes: state, fixtures, frames, timeline, video. */
export const RUN_DIR = join(HERE, "out", RUN === "" ? "final" : RUN);

export const GRYFFINDOR = `gryffindor${suffix}.test`;
export const SORTINGHAT = `sortinghat${suffix}.test`;
export const HOGWARTS = "hogwarts.test";

export interface OrgUser {
  domain: string;
  email: string;
}

export const ALBUS: OrgUser = {
  domain: GRYFFINDOR,
  email: `albus.dumbledore@${GRYFFINDOR}`,
};
export const MINERVA: OrgUser = {
  domain: GRYFFINDOR,
  email: `minerva.mcgonagall@${GRYFFINDOR}`,
};
export const HAT: OrgUser = {
  domain: SORTINGHAT,
  email: `the.hat@${SORTINGHAT}`,
};

export type HubName = "hermione" | "draco" | "voldemort";

export const hubEmail = (local: string) =>
  `${local}${RUN === "" ? "" : `.${RUN}`}@${HOGWARTS}`;

export const HUB_USERS: Record<
  HubName,
  { displayName: string; email: string }
> = {
  hermione: {
    displayName: "Hermione Granger",
    email: hubEmail("hermione.granger"),
  },
  draco: { displayName: "Draco Malfoy", email: hubEmail("draco.malfoy") },
  voldemort: { displayName: "Lord Voldemort", email: hubEmail("tom.riddle") },
};

/** The alias the agency types to find Hermione; aliases are global. */
export const HERMIONE_ALIAS = `hermione${RUN.replace(/[^a-z0-9]/g, "")}`;

/** A recorded window: who is signed in, shown in the title bar above it. */
export interface Role {
  id: string;
  title: string;
  subtitle: string;
  accent: string;
}

export const ROLES = {
  hat: {
    id: "hat",
    title: "Sortinghat",
    subtitle: `Recruitment agency · ${HAT.email}`,
    accent: "#7c4dff",
  },
  albus: {
    id: "albus",
    title: "Gryffindor",
    subtitle: `Hiring organization · ${ALBUS.email}`,
    accent: "#ae0001",
  },
  hermione: {
    id: "hermione",
    title: HUB_USERS.hermione.displayName,
    subtitle: `Hub user · ${HUB_USERS.hermione.email}`,
    accent: "#00897b",
  },
  draco: {
    id: "draco",
    title: HUB_USERS.draco.displayName,
    subtitle: `Hub user · ${HUB_USERS.draco.email}`,
    accent: "#2e7d32",
  },
  voldemort: {
    id: "voldemort",
    title: HUB_USERS.voldemort.displayName,
    subtitle: `Hub user · ${HUB_USERS.voldemort.email}`,
    accent: "#37474f",
  },
} as const satisfies Record<string, Role>;
