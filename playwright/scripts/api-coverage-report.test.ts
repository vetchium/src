import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const reportScript = join(
  dirname(fileURLToPath(import.meta.url)),
  "api-coverage-report.ts",
);

const openAPI = {
  openapi: "3.1.0",
  paths: {
    "/api/widgets/{widget_id}": {
      get: {
        operationId: "Widgets_get",
        responses: {
          "200": {
            description: "Widget",
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
          "404": {
            description: "Not found",
            content: {
              "application/problem+json": {
                schema: { $ref: "#/components/schemas/NotFound" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      NotFound: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["vetchium-problem-details/widget-not-found"],
          },
        },
      },
    },
  },
};

async function runReport(observations: unknown[]) {
  const root = await mkdtemp(join(tmpdir(), "vetchium-api-coverage-"));
  const observationDirectory = join(root, "observations");
  const documentPath = join(root, "openapi.json");
  await mkdir(observationDirectory);
  await Promise.all([
    writeFile(documentPath, JSON.stringify(openAPI)),
    writeFile(
      join(observationDirectory, "worker.json"),
      JSON.stringify({ test: ["fixture"], observations }),
    ),
  ]);
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      reportScript,
      documentPath,
      observationDirectory,
    ],
    { encoding: "utf8" },
  );
  await rm(root, { recursive: true });
  return result;
}

test("reports operation, status, variant, and non-contract 404 coverage", async () => {
  const result = await runReport([
    { method: "GET", path: "/api/widgets/one", status: 200 },
    {
      method: "GET",
      path: "/api/widgets/missing",
      status: 404,
      problemType: "vetchium-problem-details/widget-not-found",
    },
    {
      method: "POST",
      path: "/api/admin/delete-hub-signup-domain",
      status: 404,
    },
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Operations\s+100\.0% \(1\/1\)/);
  assert.match(result.stdout, /All statuses\s+100\.0% \(2\/2\)/);
  assert.match(result.stdout, /Response variants\s+100\.0% \(2\/2\)/);
  assert.match(
    result.stdout,
    /Non-contract 404 probes:\s+POST \/api\/admin\/delete-hub-signup-domain/,
  );
  assert.match(result.stdout, /Contract mismatches: none/);
});

test("fails for an observed operation that the contract does not declare", async () => {
  const result = await runReport([
    { method: "POST", path: "/api/widgets", status: 404 },
  ]);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Contract mismatches:\s+undeclared operation POST \/api\/widgets/,
  );
});
