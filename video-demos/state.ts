// What a run learns as it goes (handles, the Opening and application
// numbers), kept on disk so scenes can be recorded again one at a time.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type HubName, RUN_DIR } from "./cast.ts";

export interface RunState {
  handles: Partial<Record<HubName, string>>;
  contactURL?: string;
  openingNumber?: number;
  applications: Partial<Record<HubName, number>>;
}

const FILE = join(RUN_DIR, "state.json");

export function loadState(): RunState {
  if (!existsSync(FILE)) return { handles: {}, applications: {} };
  return JSON.parse(readFileSync(FILE, "utf8")) as RunState;
}

export function saveState(state: RunState) {
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}
