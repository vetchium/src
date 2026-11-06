import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const composeFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docker-compose-ci.json",
);

const projectName = (() => {
  const compose: unknown = JSON.parse(readFileSync(composeFile, "utf8"));
  if (
    typeof compose !== "object" ||
    compose === null ||
    !("name" in compose) ||
    typeof compose.name !== "string"
  ) {
    throw new Error(`${composeFile} must pin the Compose project name`);
  }
  return compose.name;
})();

/**
 * The CI stack container running one service. Tests reach containers with
 * `docker exec` on this name rather than `docker compose exec`, which loads
 * the whole Compose project and costs about ten times the CPU per call.
 */
export function ciContainer(service: string): string {
  return `${projectName}-${service}-1`;
}
